// MoneyForward の「資産の更新」モーダルに Webull 総額を自動入力する。
//
// 動作:
//   1. DB 直近 capturedDate の Webull (institution='webull') AccountSnapshot から totalValueJpy 取得
//   2. MF /bs/portfolio を Playwright で開き、webull証券の「株式+現金」行を特定
//   3. 「変更」モーダルを開いて「現在の価値」を totalValueJpy で上書き → 登録
//
// 前提:
//   - MF Persistent Context が mf:login で確立済
//   - MF 側で「資産の追加」で 1 行作成済 (本スクリプトは update 専用、create はしない)
//   - HEADLESS=1 で headless 動作可能だが MF が 403 する場合あり、通常は headful 推奨
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run mf:push-webull

import '../src/env.js'; // PLAYWRIGHT_BROWSERS_PATH を先に設定
import { chromium } from 'playwright';
import { prisma } from '../src/db.js';
import { MF_USER_DATA_DIR, MF_URLS } from '../src/adapters/moneyforward/profile.js';

const HEADLESS = process.env.HEADLESS === '1';
const SUB_ACCOUNT_NAME_RE = /webull/i;

async function main(): Promise<void> {
  // 1. DB から Webull 総額取得
  const acc = await prisma.account.findFirst({ where: { institution: 'webull' } });
  if (!acc) {
    console.error('Webull account が DB に無い (まず webull:run を先に実行)');
    process.exit(1);
  }
  const accSnap = await prisma.accountSnapshot.findFirst({
    where: { accountId: acc.id },
    orderBy: { capturedDate: 'desc' },
  });
  if (!accSnap) {
    console.error('Webull AccountSnapshot 無し');
    process.exit(1);
  }
  const total = Math.round(Number(accSnap.totalValueJpy));
  console.log(`[mf-push-webull] DB Webull 総額: ¥${total.toLocaleString('ja-JP')} (capturedDate=${accSnap.capturedDate})`);

  // 2. Playwright 起動
  const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    console.log('[mf-push-webull] /bs/portfolio へ移動');
    await page.goto(MF_URLS.portfolio, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000); // 動的レンダリング待ち

    // 3. webull の手動登録行を探す: tr の中に「webull証券」テキスト + 変更 link
    const rows = page.locator('tr', { has: page.locator('a[href^="#modal_asset"]') });
    const count = await rows.count();
    let editLink: ReturnType<typeof page.locator> | null = null;
    let assetId: string | null = null;
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const text = (await row.innerText()).toLowerCase();
      if (SUB_ACCOUNT_NAME_RE.test(text)) {
        editLink = row.locator('a[href^="#modal_asset"]').first();
        const href = await editLink.getAttribute('href');
        assetId = href?.replace('#modal_asset', '') ?? null;
        if (assetId) break;
      }
    }
    if (!editLink || !assetId) {
      console.error('[mf-push-webull] webull行が見つからない。MFで「資産の追加」を1度実行してください');
      process.exit(1);
    }
    console.log(`[mf-push-webull] webull asset_id=${assetId}`);

    // 4. モーダルを開く
    await editLink.click();
    const modal = page.locator(`#modal_asset${assetId}`);
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    // 5. 「現在の価値」上書き
    const valueInput = modal.locator('input[name="user_asset_det[value]"]');
    await valueInput.fill(String(total));
    const filled = await valueInput.inputValue();
    console.log(`[mf-push-webull] 現在の価値を ${filled} に更新`);

    // 6. 登録ボタン
    await modal.locator('input[type="submit"][value="この内容で登録する"]').click();

    // 7. 完了待ち (ページ遷移 or モーダル close)
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    console.log('[mf-push-webull] 登録完了');
  } finally {
    await context.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[mf-push-webull] FAIL', e);
  process.exit(1);
});
