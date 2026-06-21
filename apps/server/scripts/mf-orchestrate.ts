// MF 更新オーケストレータ。
//
// 設計方針:
//   このスクリプトは「単発の一連操作」のみを行う。リトライ周期や上限などの
//   スケジューリング判断は Pi 側 (scripts/pi-mf-orchestrate-controller.sh)
//   で行い、状態は Pi 上の data/mf-orchestrate-state.json に保持する。
//
// 引数:
//   --phase=A         メインサイクル: bulk-update → 5min → poll (SBI除く全完了
//                     まで 1 分毎) → scrape:all → 状態を Pi に POST → 終了
//   --phase=B-step    SBI リトライ 1 ステップ: SBI 個別更新 → 5min → check →
//                     完了なら scrape:all → 状態を Pi に POST → 終了
//
// 状態送信: 各 mf:check-status の結果を Pi の POST /api/mf-status へ送信。
//           Pi は受信した accounts から SBI 系の inProgress を判定して state を更新する。

import '../src/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { env } from '../src/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '..', '..', '..', 'logs', 'mf-orchestrate.log');

const SBI_INSTITUTIONS = ['SBI証券', '住信SBIネット銀行'];

const PHASE_A_INITIAL_WAIT_MS = 5 * 60 * 1000;
const PHASE_A_POLL_INTERVAL_MS = 60 * 1000;
const PHASE_A_POLL_MAX_DURATION_MS = 20 * 60 * 1000; // フェーズ A の poll は最大 20 分で打ち切り
const PHASE_B_POST_UPDATE_WAIT_MS = 5 * 60 * 1000;

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
  if (r.exit > 2) throw new Error(`mf-check-status 失敗 exit=${r.exit}: ${r.stderr}`);
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`check-status の出力に JSON が含まれません: ${r.stdout}`);
  return JSON.parse(m[0]) as CheckStatusResult;
}

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
      body: JSON.stringify({
        phase,
        accounts: result.accounts,
        checkedAt: new Date().toISOString(),
      }),
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
  log('=== phase A 開始 ===');

  log('mf-bulk-update を実行');
  const bulk = await runScript('mf-bulk-update.ts', ['--headless']);
  if (bulk.exit !== 0) {
    log(`mf-bulk-update 失敗 exit=${bulk.exit} stderr=${bulk.stderr.slice(0, 300)}`);
    throw new Error('bulk-update failed');
  }

  log(`初回チェックまで ${PHASE_A_INITIAL_WAIT_MS / 1000}s 待機`);
  await sleep(PHASE_A_INITIAL_WAIT_MS);

  const pollStart = Date.now();
  while (true) {
    const status = await checkStatus();
    await postStatusToPi(status, 'A');
    if (!nonSbiStillInProgress(status)) {
      log('SBI 系除く全口座が完了。scrape:all へ移行');
      break;
    }
    if (Date.now() - pollStart > PHASE_A_POLL_MAX_DURATION_MS) {
      log(`poll 上限 ${PHASE_A_POLL_MAX_DURATION_MS / 60000}分 を超過。打ち切って scrape:all へ進む`);
      break;
    }
    const stillUpdating = status.inProgress.filter((n) => !SBI_INSTITUTIONS.includes(n));
    log(
      `まだ更新中 (SBI 系除く): ${stillUpdating.join(', ')}。${PHASE_A_POLL_INTERVAL_MS / 1000}s 後再確認`,
    );
    await sleep(PHASE_A_POLL_INTERVAL_MS);
  }

  log('scrape:all 実行');
  const scrape = await runScript('scrape-all.ts');
  if (scrape.exit !== 0) {
    log(`scrape:all 失敗 exit=${scrape.exit} stderr=${scrape.stderr.slice(0, 300)}`);
  }

  // 最終状態を Pi に POST。SBI 系の inProgress を見て Pi が state を作るか判断する。
  const final = await checkStatus();
  await postStatusToPi(final, 'A');
  log('=== phase A 終了 ===');
}

async function phaseBStep(): Promise<void> {
  log('=== phase B step 開始 ===');
  log('SBI 系の個別更新を実行');
  for (const inst of SBI_INSTITUTIONS) {
    const r = await runScript('mf-update-sbi.ts', ['--headless', `--institution=${inst}`]);
    if (r.exit !== 0) {
      log(`${inst} の個別更新失敗 exit=${r.exit}: ${r.stderr.slice(0, 200)}`);
    }
  }

  log(`完了確認まで ${PHASE_B_POST_UPDATE_WAIT_MS / 1000}s 待機`);
  await sleep(PHASE_B_POST_UPDATE_WAIT_MS);

  const status = await checkStatus();
  await postStatusToPi(status, 'B');
  if (!sbiStillInProgress(status)) {
    log('SBI 系完了。scrape:all 実行');
    await runScript('scrape-all.ts');
    const final = await checkStatus();
    await postStatusToPi(final, 'B');
  } else {
    log('SBI 系まだ更新中。次回 B-step は Pi のスケジューラが判断する');
  }
  log('=== phase B step 終了 ===');
}

async function main(): Promise<void> {
  const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
  const phase = phaseArg?.split('=')[1] ?? 'A';

  if (phase === 'A') {
    await phaseA();
  } else if (phase === 'B-step') {
    await phaseBStep();
  } else {
    throw new Error(`未知の phase: ${phase} (A | B-step)`);
  }
}

main().catch((err) => {
  log(`fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
