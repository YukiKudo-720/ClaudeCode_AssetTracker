import { existsSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { NeedsLoginError } from '../types.js';
import { MF_USER_DATA_DIR, MF_URLS, PLAYWRIGHT_BROWSERS_PATH } from './profile.js';
import type { AccountUpdate } from '../types.js';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= PLAYWRIGHT_BROWSERS_PATH;

/** MF サイトをヘッドレスでスクレイピングし、口座 + 保有銘柄を抽出する */
export async function scrapeMoneyForward(opts: {
  headless?: boolean;
} = {}): Promise<AccountUpdate[]> {
  if (!existsSync(MF_USER_DATA_DIR)) {
    throw new NeedsLoginError(
      'moneyforward',
      `${MF_USER_DATA_DIR} が無い。\`pnpm --filter @asset-tracker/server run mf:login\` を実行してください`,
    );
  }

  const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
    headless: opts.headless ?? true,
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    // ログイン状態チェック (sign_in に redirect されたら未ログイン)
    await page.goto(MF_URLS.home, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('sign_in') || page.url().includes('id.moneyforward.com')) {
      throw new NeedsLoginError('moneyforward', 'セッションが切れています。再ログインしてください');
    }

    const updates: AccountUpdate[] = [];
    updates.push(...(await scrapeAccountsPage(page)));
    return updates;
  } finally {
    await context.close();
  }
}

/**
 * 口座一覧ページから機関ごとの残高と (証券口座は) 保有銘柄を抽出する。
 *
 * TODO: 実セレクタは Playwright Inspector でライブデバッグして確定する。
 * 現状はスキャフォルド: ログイン状態チェックだけして空配列を返す。
 *
 * 抽出予定:
 * - 機関名 (institution へマッピング)
 * - 表示ラベル (Account.label に流用)
 * - 残高 (BankAccount → AccountSnapshot.cashNative)
 * - 通貨 (デフォルト JPY、Webull/Moomoo MF 接続なら USD/HKD)
 * - 証券口座は銘柄リスト (symbol, name, qty, marketPrice, avgCost)
 */
async function scrapeAccountsPage(page: Page): Promise<AccountUpdate[]> {
  await page.goto(MF_URLS.accounts, { waitUntil: 'domcontentloaded' });
  // TODO: live debug でセレクタ確定後に実装
  return [];
}

export async function withMoneyForwardPage<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
  opts: { headless?: boolean } = {},
): Promise<T> {
  const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
    headless: opts.headless ?? true,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return await fn(page, context);
  } finally {
    await context.close();
  }
}
