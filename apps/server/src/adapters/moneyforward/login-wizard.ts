// 注: env var (PLAYWRIGHT_BROWSERS_PATH 等) は entry script で env.ts を import 済みの前提
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { MF_USER_DATA_DIR, MF_URLS } from './profile.js';

// 初回ログイン専用のヘッドフル wizard。ユーザーが Passkey で手動ログインし、
// セッションを userDataDir に保存。以後の cron はヘッドレスで同じ profile を使う。
export async function runLoginWizard(): Promise<void> {
  mkdirSync(MF_USER_DATA_DIR, { recursive: true });

  console.log('--- MoneyForward ログイン wizard ---');
  console.log('ブラウザを開きます。Passkey でログインしてください。');
  console.log(`profile 保存先: ${MF_USER_DATA_DIR}`);
  console.log('ログイン完了後、このターミナルで Enter を押してください。');

  const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(MF_URLS.signIn, { waitUntil: 'domcontentloaded' });

  // ユーザー入力待ち (Enter で確定)
  await waitForEnter();

  console.log('セッションを保存して終了します。');
  await context.close();
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const onData = (): void => {
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve();
    };
    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}
