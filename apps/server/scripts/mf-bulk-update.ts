// MF の「一括更新」ボタンを押すだけのスクリプト。
// 完了確認は mf-check-status.ts、SBI 単体は mf-update-sbi.ts。
// 呼び出し側 (cron / task scheduler / 手動) がタイミングを制御する想定。
//
// 使い方:
//   tsx scripts/mf-bulk-update.ts [--headless]

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

// 一括更新ボタンの候補 selector (MF の DOM 変更に追従しやすいよう複数並列で試す)
const BULK_UPDATE_SELECTORS = [
  'input[type="submit"][value*="一括更新"]',
  'button:has-text("一括更新")',
  'a:has-text("一括更新")',
  '.btn-aggregate',
  '#js-aggregate-all',
];

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

    let clicked = false;
    for (const sel of BULK_UPDATE_SELECTORS) {
      const el = page.locator(sel).first();
      const count = await el.count();
      if (count === 0) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      try {
        await el.click({ timeout: 5000 });
        console.log(`[mf-bulk-update] clicked: ${sel}`);
        clicked = true;
        break;
      } catch (err) {
        console.warn(`[mf-bulk-update] click failed for ${sel}: ${(err as Error).message}`);
      }
    }

    if (!clicked) {
      await dumpDebug(page, 'bulk-update-button-not-found');
      throw new Error(
        '一括更新ボタンが見つかりませんでした。MF の DOM が変わった可能性があります。data/mf-debug/ の dump を確認してください。',
      );
    }

    // クリック直後の DOM 変化が反映される時間だけ待つ。完了は別スクリプトで polling する。
    await page.waitForTimeout(3000);
    console.log('[mf-bulk-update] 一括更新を開始しました。完了確認は mf-check-status.ts を別途実行してください。');
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
