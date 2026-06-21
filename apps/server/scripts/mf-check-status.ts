// MF の各連携口座の更新ステータスを取得する。
// /accounts ページの各口座行を解析して、更新中フラグ / エラー / 最終更新時刻 を返す。
//
// 使い方:
//   tsx scripts/mf-check-status.ts [--headless]
//
// exit code:
//   0 = 全口座 idle (= 更新中なし、エラーなし)
//   1 = まだ更新中の口座あり
//   2 = エラー (要再連携 / 認証失敗) の口座あり

import '../src/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { MF_USER_DATA_DIR, MF_URLS } from '../src/adapters/moneyforward/profile.js';
import { NeedsLoginError } from '../src/adapters/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'mf-debug');
const HEADLESS = process.argv.includes('--headless');
const DUMP = process.argv.includes('--dump');

interface AccountStatus {
  name: string;
  inProgress: boolean;
  error: boolean;
  errorMessage: string | null;
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

// MF の口座行のテキストから状態を抽出。
// MF は「更新中」「再連携が必要です」「○分前」「○時間前」「○月○日」のような文言を出すので
// 正規表現で柔軟に拾う。
function parseRowText(name: string, text: string): AccountStatus {
  const inProgress = /更新中|aggregating|処理中/i.test(text);
  const errorRegex = /再連携|要ログイン|エラー|失敗|認証|有効期限|expired|expired session/i;
  const error = errorRegex.test(text);
  const errorMatch = text.match(/再連携[^\n]*|要ログイン[^\n]*|エラー[^\n]*|失敗[^\n]*/);
  const lastUpdatedMatch = text.match(
    /(\d{4}\/\d{1,2}\/\d{1,2}\s*\d{1,2}:\d{2})|(\d+\s*(?:分|時間|日)\s*前)|(今)/,
  );
  return {
    name,
    inProgress,
    error,
    errorMessage: error ? (errorMatch?.[0]?.trim() ?? '不明') : null,
    lastUpdated: lastUpdatedMatch?.[0]?.trim() ?? null,
  };
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

    // 口座行: テーブル形式とリスト形式の両方を試す
    const rowsLocator = page.locator(
      'table tbody tr, .account_list li, [data-account], section.account',
    );
    const count = await rowsLocator.count();
    if (count === 0) {
      await dumpDebug(page, 'check-status-no-rows');
      throw new Error(
        '口座行が見つかりませんでした。data/mf-debug/ の dump で DOM を確認してください。',
      );
    }

    const accounts: AccountStatus[] = [];
    for (let i = 0; i < count; i++) {
      const row = rowsLocator.nth(i);
      const text = (await row.innerText().catch(() => '')).trim();
      if (!text) continue;
      const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
      const name = lines[0] ?? '';
      // フィルタ:
      // - 「(本サイト)」を含む行 = MF の自動連携口座のみ対象 (更新の概念がある)
      // - 手動口座 (「現金保有」「webull証券」など) や表ヘッダー行は除外
      if (!/本サイト/.test(text)) continue;
      if (!name || name.length > 80) continue;
      // 末尾の「(  本サイト )」を機関名から除去して読みやすく
      const cleanedName = name.replace(/\s*\(\s*本サイト\s*\)\s*$/, '').trim();
      accounts.push(parseRowText(cleanedName, text));
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
