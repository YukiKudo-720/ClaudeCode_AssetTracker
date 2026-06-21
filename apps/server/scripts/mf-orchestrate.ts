// MF 更新オーケストレータ。Pi cron から発火される 2 種類のフェーズを処理する。
//
//   --phase=A         新規メインサイクル: 既存 state を破棄、bulk-update → 5min →
//                     poll until non-SBI 全完了 → scrape:all → SBI 未完了なら state
//                     を残してフェーズ B 経路に渡す
//   --phase=B-check   フェーズ B チェック (Pi cron が 30 分毎に叩く想定):
//                     state.json を見て、nextRetryAt 経過していれば SBI 個別更新 +
//                     5 分待 + check → 完了なら scrape:all + state クリア、未完了
//                     なら nextRetryAt 更新。startedAt から 3 時間経過なら state
//                     破棄して諦め。
//
// state.json schema:
//   { startedAt: ISO, nextRetryAt: ISO, lastCheckedAt: ISO|null, attempts: number }
//
// 同時実行ガード: data/mf-orchestrate.lock に PID を書き、A 起動時に既存 PID を kill。
//
// 状態反映: 各 mf:check-status 後に Pi の /api/mf-status へ POST して PWA に表示する。

import '../src/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { env } from '../src/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'mf-orchestrate-state.json');
const LOCK_FILE = path.join(DATA_DIR, 'mf-orchestrate.lock');
const LOG_FILE = path.join(__dirname, '..', '..', '..', 'logs', 'mf-orchestrate.log');

const SBI_INSTITUTIONS = ['SBI証券', '住信SBIネット銀行'];

// タイミング定数 (ms)
const PHASE_A_INITIAL_WAIT_MS = 5 * 60 * 1000;
const PHASE_A_POLL_INTERVAL_MS = 60 * 1000;
const PHASE_B_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const PHASE_B_POST_UPDATE_WAIT_MS = 5 * 60 * 1000;
const PHASE_B_MAX_DURATION_MS = 3 * 60 * 60 * 1000;

interface OrchestrateState {
  startedAt: string;
  nextRetryAt: string;
  lastCheckedAt: string | null;
  attempts: number;
}

interface CheckStatusResult {
  allDone: boolean;
  inProgress: string[];
  errors: Array<{ name: string; message: string | null }>;
  accounts: Array<{
    name: string;
    inProgress: boolean;
    error: boolean;
    errorMessage: string | null;
    lastUpdated: string | null;
  }>;
}

function log(msg: string): void {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    writeFileSync(LOG_FILE, line + '\n', { flag: 'a' });
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readState(): OrchestrateState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as OrchestrateState;
  } catch {
    return null;
  }
}

function writeState(s: OrchestrateState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8');
}

function clearState(): void {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}

function takeLock(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  // 既存ロック PID を読み、生きていれば kill
  if (existsSync(LOCK_FILE)) {
    const oldPid = Number(readFileSync(LOCK_FILE, 'utf8').trim());
    if (oldPid && oldPid !== process.pid) {
      try {
        process.kill(oldPid, 0); // 生存確認 (kill しない)
        log(`既存プロセス PID=${oldPid} を kill します`);
        process.kill(oldPid, 'SIGTERM');
      } catch {
        // 既に死んでいる
      }
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
}

function releaseLock(): void {
  if (existsSync(LOCK_FILE)) {
    const pid = Number(readFileSync(LOCK_FILE, 'utf8').trim());
    if (pid === process.pid) unlinkSync(LOCK_FILE);
  }
}

// tsx scripts/{name}.ts を呼んで stdout/stderr を集める
async function runScript(
  scriptFile: string,
  args: string[] = [],
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const scriptPath = path.join(__dirname, scriptFile);
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', scriptPath, ...args], {
      cwd: path.join(__dirname, '..'),
      shell: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ exit: code ?? 1, stdout, stderr });
    });
  });
}

async function checkStatus(): Promise<CheckStatusResult> {
  const r = await runScript('mf-check-status.ts', ['--headless']);
  // exit code 0/1/2 はどれもデータ取得は成功。1=更新中残, 2=エラーあり
  if (r.exit > 2) throw new Error(`mf-check-status 失敗 exit=${r.exit}: ${r.stderr}`);
  // stdout の最初の JSON ブロックを取り出す
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`check-status の出力に JSON が含まれません: ${r.stdout}`);
  return JSON.parse(m[0]) as CheckStatusResult;
}

// 状態を Pi の API に POST (失敗しても継続)
async function postStatusToPi(result: CheckStatusResult, phase: string): Promise<void> {
  try {
    const url = env.SYNC_TARGET;
    if (!url) {
      log('SYNC_TARGET 未設定。Pi への状態送信をスキップ');
      return;
    }
    const res = await fetch(`${url.replace(/\/$/, '')}/api/mf-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.ASSET_TRACKER_TOKEN}`,
      },
      body: JSON.stringify({ phase, accounts: result.accounts, checkedAt: new Date().toISOString() }),
    });
    if (!res.ok) {
      log(`Pi への状態送信失敗 status=${res.status}: ${await res.text().catch(() => '')}`);
    }
  } catch (e) {
    log(`Pi への状態送信例外: ${(e as Error).message}`);
  }
}

function sbiStillInProgress(result: CheckStatusResult): boolean {
  return result.inProgress.some((n) => SBI_INSTITUTIONS.includes(n));
}

function nonSbiStillInProgress(result: CheckStatusResult): boolean {
  return result.inProgress.some((n) => !SBI_INSTITUTIONS.includes(n));
}

async function phaseA(): Promise<void> {
  log('=== phase A 開始 (既存 state を破棄) ===');
  clearState();

  log('mf-bulk-update を実行');
  const bulk = await runScript('mf-bulk-update.ts', ['--headless']);
  if (bulk.exit !== 0) {
    log(`mf-bulk-update 失敗 exit=${bulk.exit} stderr=${bulk.stderr.slice(0, 300)}`);
    throw new Error('bulk-update failed');
  }

  log(`初回チェックまで ${PHASE_A_INITIAL_WAIT_MS / 1000}s 待機`);
  await sleep(PHASE_A_INITIAL_WAIT_MS);

  // SBI 除く全完了まで 1 分毎ループ
  while (true) {
    const status = await checkStatus();
    await postStatusToPi(status, 'A');
    if (!nonSbiStillInProgress(status)) {
      log('SBI 系除く全口座が完了。scrape:all へ移行');
      break;
    }
    const stillUpdating = status.inProgress.filter((n) => !SBI_INSTITUTIONS.includes(n));
    log(`まだ更新中 (SBI 系除く): ${stillUpdating.join(', ')}。${PHASE_A_POLL_INTERVAL_MS / 1000}s 後再確認`);
    await sleep(PHASE_A_POLL_INTERVAL_MS);
  }

  log('scrape:all 実行');
  const scrape = await runScript('scrape-all.ts');
  if (scrape.exit !== 0) {
    log(`scrape:all 失敗 exit=${scrape.exit} stderr=${scrape.stderr.slice(0, 300)}`);
  }

  // SBI 状態確認
  const sbiStatus = await checkStatus();
  await postStatusToPi(sbiStatus, 'A');
  if (sbiStillInProgress(sbiStatus)) {
    log('SBI 系が未完了。フェーズ B に引き継ぎ');
    const now = new Date();
    writeState({
      startedAt: now.toISOString(),
      nextRetryAt: new Date(now.getTime() + PHASE_B_RETRY_INTERVAL_MS).toISOString(),
      lastCheckedAt: now.toISOString(),
      attempts: 0,
    });
  } else {
    log('SBI 系も完了。サイクル終了');
  }
}

async function phaseBCheck(): Promise<void> {
  const state = readState();
  if (!state) {
    log('state なし。何もしない');
    return;
  }
  const now = Date.now();
  const elapsed = now - new Date(state.startedAt).getTime();
  if (elapsed > PHASE_B_MAX_DURATION_MS) {
    log(`フェーズ B 開始から ${Math.round(elapsed / 60000)}分 経過。3 時間上限を超えたので諦めて state 破棄`);
    clearState();
    return;
  }
  if (new Date(state.nextRetryAt).getTime() > now) {
    log(`次リトライ時刻 ${state.nextRetryAt} まで待機 (現在 ${new Date(now).toISOString()})`);
    return;
  }

  log(`SBI 個別更新を実行 (attempt #${state.attempts + 1})`);
  for (const inst of SBI_INSTITUTIONS) {
    const r = await runScript('mf-update-sbi.ts', ['--headless', `--institution=${inst}`]);
    if (r.exit !== 0) {
      log(`${inst} の個別更新失敗 exit=${r.exit}: ${r.stderr.slice(0, 200)}`);
    }
  }

  log(`SBI 完了確認まで ${PHASE_B_POST_UPDATE_WAIT_MS / 1000}s 待機`);
  await sleep(PHASE_B_POST_UPDATE_WAIT_MS);

  const status = await checkStatus();
  await postStatusToPi(status, 'B');
  if (!sbiStillInProgress(status)) {
    log('SBI 系完了。scrape:all 実行 + state クリア');
    await runScript('scrape-all.ts');
    clearState();
  } else {
    log('SBI 系まだ更新中。MF サーバ遅延と判定。30 分後に再試行');
    const next = new Date(now + PHASE_B_RETRY_INTERVAL_MS).toISOString();
    writeState({
      ...state,
      nextRetryAt: next,
      lastCheckedAt: new Date(now).toISOString(),
      attempts: state.attempts + 1,
    });
  }
}

async function main(): Promise<void> {
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
  const phase = phaseArg?.split('=')[1] ?? 'A';

  takeLock();
  try {
    if (phase === 'A') {
      await phaseA();
    } else if (phase === 'B-check') {
      await phaseBCheck();
    } else {
      throw new Error(`未知の phase: ${phase}`);
    }
  } finally {
    releaseLock();
  }
}

main().catch((err) => {
  log(`fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
