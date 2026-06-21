// SBI証券 を MF 上で個別に再更新する。
// MF /accounts ページから SBI証券 の詳細ページを開き、その中の「更新」ボタンを押す。
// 一括更新が SBI でこける症状の救済用。
//
// 使い方:
//   tsx scripts/mf-update-sbi.ts [--headless] [--institution=SBI証券]

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

// 機関名を引数で上書き可能 (将来「SBI証券（FX）」「楽天証券」等に流用)。
const INSTITUTION_ARG = process.argv.find((a) => a.startsWith('--institution='));
const TARGET_INSTITUTION = INSTITUTION_ARG?.split('=')[1] ?? 'SBI証券';

// 個別口座詳細ページ内の「更新」ボタンの候補。
const UPDATE_BUTTON_SELECTORS = [
  'input[type="submit"][value*="更新"]',
  'button:has-text("更新")',
  'a:has-text("更新")',
  '.btn-aggregate-now',
  '.js-aggregation-trigger',
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

    // 対象機関名のリンクを探して詳細ページへ遷移
    const link = page.locator('a').filter({ hasText: TARGET_INSTITUTION }).first();
    if ((await link.count()) === 0) {
      await dumpDebug(page, `update-${TARGET_INSTITUTION}-link-not-found`);
      throw new Error(
        `${TARGET_INSTITUTION} へのリンクが /accounts 上で見つかりません。data/mf-debug/ を確認してください。`,
      );
    }
    await link.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    console.log(`[mf-update-${TARGET_INSTITUTION}] 詳細ページに遷移: ${page.url()}`);

    // 更新ボタンを試す
    let clicked = false;
    for (const sel of UPDATE_BUTTON_SELECTORS) {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      try {
        await el.click({ timeout: 5000 });
        console.log(`[mf-update-${TARGET_INSTITUTION}] clicked: ${sel}`);
        clicked = true;
        break;
      } catch (err) {
        console.warn(`[mf-update-${TARGET_INSTITUTION}] click failed for ${sel}: ${(err as Error).message}`);
      }
    }

    if (!clicked) {
      await dumpDebug(page, `update-${TARGET_INSTITUTION}-button-not-found`);
      throw new Error(
        `更新ボタンが ${TARGET_INSTITUTION} 詳細ページに見つかりません。data/mf-debug/ を確認してください。`,
      );
    }

    await page.waitForTimeout(3000);
    console.log(
      `[mf-update-${TARGET_INSTITUTION}] 個別更新を開始しました。完了確認は mf-check-status.ts を別途実行してください。`,
    );
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
