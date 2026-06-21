// MF /accounts の各連携口座の更新ステータスを取得する。
// DOM 構造 (検証済み):
//   <tr id="{accountId}">
//     <td class="service">機関名リンク + (本サイト)</td>
//     <td class="number">残高</td>
//     <td class="created">
//       <p>登録日 yyyy/mm/dd</p>
//       <p>(MM/DD HH:mm)  ← 最終更新時刻</p>
//     </td>
//     <td class="account-status">
//       <span style="display:none">更新中</span>  ← 隠れている方
//       <span>正常 / 失敗 / 取得中 など</span>    ← 表示されている方
//     </td>
//   </tr>
//
// 使い方:
//   tsx scripts/mf-check-status.ts [--headless] [--dump]
// exit code:
//   0 = 全口座 idle / 1 = まだ更新中の口座あり / 2 = エラー (要再連携 / 認証失敗) あり

import '../src/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { MF_USER_DATA_DIR, MF_URLS } from '../src/adapters/moneyforward/profile.js';
import { NeedsLoginError } from '../src/adapters/types.js';
import { env } from '../src/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'mf-debug');
const HEADLESS = process.argv.includes('--headless');
const DUMP = process.argv.includes('--dump');
// --post: 結果を env.SYNC_TARGET の Pi に POST /api/mf-status する
const POST = process.argv.includes('--post');

// このツールが MF 経由で取得対象としている機関のみを返す (= scraper.ts の
// INSTITUTION_MAP と同じセット)。MF 上の他の連携 (カード類 / ポイント等) は無視。
const TRACKED_INSTITUTIONS = new Set([
  '楽天銀行',
  '三菱UFJ銀行',
  '住信SBIネット銀行',
  '楽天証券',
  'SBI証券',
]);

interface AccountStatus {
  accountId: string;
  name: string;
  inProgress: boolean;
  error: boolean;
  errorMessage: string | null;
  // ISO 8601 (例: '2026-06-22T00:25:00+09:00') もしくは null
  lastUpdated: string | null;
}

async function dumpDebug(page: Page, slug: string): Promise<void> {
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    await page.screenshot({ path: path.join(DEBUG_DIR, `${slug}.png`), fullPage: true });
    writeFileSync(path.join(DEBUG_DIR, `${slug}.html`), await page.content(), 'utf8');
    console.error(`[debug] dumped: ${DEBUG_DIR}/${slug}.{png,html}`);
  } catch {
    // ignore
  }
}

// 「(06/22 00:25)」 のような MF 表示を ISO 8601 文字列に変換。
// 年を含まないので今年とみなし、未来日付ならば前年と判定する。
function parseMfTimestamp(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
  if (!m) return null;
  const now = new Date();
  const month = Number(m[1]);
  const day = Number(m[2]);
  const hour = Number(m[3]);
  const min = Number(m[4]);
  // JST で組み立て: +09:00 オフセット
  let year = now.getFullYear();
  const candidate = new Date(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`,
  );
  // 未来日付 (= 今より 1 日以上先) なら前年扱い
  if (candidate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    year -= 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`;
  }
  return candidate.toISOString();
}

async function main(): Promise<void> {
  const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(MF_URLS.accounts, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    if (page.url().includes('sign_in') || page.url().includes('id.moneyforward.com')) {
      throw new NeedsLoginError('moneyforward', 'セッションが切れています');
    }

    if (DUMP) await dumpDebug(page, 'check-status');

    // 「本サイト」を含む tr (= MF 自動連携の口座行) を全部拾う
    const rowsLocator = page.locator('tr').filter({ hasText: '本サイト' });
    const count = await rowsLocator.count();
    if (count === 0) {
      await dumpDebug(page, 'check-status-no-rows');
      throw new Error('連携口座行が見つかりませんでした。data/mf-debug/ の dump で DOM を確認してください。');
    }

    const accounts: AccountStatus[] = [];
    for (let i = 0; i < count; i++) {
      const row = rowsLocator.nth(i);
      // 機関名: td.service の最初の <a> のテキスト
      const name = (await row.locator('td.service a').first().innerText().catch(() => '')).trim();
      if (!name) continue;
      if (!TRACKED_INSTITUTIONS.has(name)) continue;
      const accountId = (await row.getAttribute('id')) ?? '';

      // 最終更新: td.created の 2 番目の <p>
      const rawUpdated = (
        await row.locator('td.created p').nth(1).innerText().catch(() => '')
      ).trim();
      const lastUpdated = rawUpdated ? parseMfTimestamp(rawUpdated) : null;

      // ステータス: td.account-status の表示されている方 (display:none 以外) の span
      // MF は js-status-sentence-span にメインのテキストを入れる。
      const visibleStatusText = (
        await row.locator('td.account-status span:not([style*="display: none"])').last().innerText().catch(() => '')
      ).trim();
      const inProgress = /更新中|取得中|処理中/.test(visibleStatusText);
      const error = /失敗|エラー|再連携|要ログイン|認証/.test(visibleStatusText);
      const errorMessage = error ? visibleStatusText : null;

      accounts.push({ accountId, name, inProgress, error, errorMessage, lastUpdated });
    }

    const inProgress = accounts.filter((a) => a.inProgress).map((a) => a.name);
    const errors = accounts.filter((a) => a.error);
    const allDone = inProgress.length === 0;

    const result = {
      allDone,
      inProgress,
      errors: errors.map((a) => ({ name: a.name, message: a.errorMessage })),
      accounts,
    };
    console.log(JSON.stringify(result, null, 2));

    if (POST && env.SYNC_TARGET) {
      try {
        const res = await fetch(`${env.SYNC_TARGET.replace(/\/$/, '')}/api/mf-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.ASSET_TRACKER_TOKEN}`,
          },
          body: JSON.stringify({
            phase: 'manual',
            checkedAt: new Date().toISOString(),
            accounts: accounts.map((a) => ({
              name: a.name,
              inProgress: a.inProgress,
              error: a.error,
              errorMessage: a.errorMessage,
              lastUpdated: a.lastUpdated,
            })),
          }),
        });
        if (!res.ok) {
          console.error(`[mf-check-status] POST 失敗 status=${res.status}: ${await res.text().catch(() => '')}`);
        } else {
          console.error(`[mf-check-status] POST OK (${accounts.length} accounts → ${env.SYNC_TARGET})`);
        }
      } catch (e) {
        console.error(`[mf-check-status] POST 例外: ${(e as Error).message}`);
      }
    }

    if (errors.length > 0) process.exitCode = 2;
    else if (!allDone) process.exitCode = 1;
    else process.exitCode = 0;
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
