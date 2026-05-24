import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/playwright-profiles/moneyforward/ にセッション (Cookie / localStorage 等) を永続化
// Passkey + 30 日セッション運用なので、初回ログイン後はこの profile を使い回す
export const MF_USER_DATA_DIR = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'data',
  'playwright-profiles',
  'moneyforward',
);

// Playwright Chromium のキャッシュ位置 (プロジェクトローカル)
export const PLAYWRIGHT_BROWSERS_PATH = path.resolve(
  __dirname,
  '..', '..', '..', '..', '..',
  'data',
  'playwright-cache',
);

export const MF_URLS = {
  signIn: 'https://moneyforward.com/sign_in',
  home: 'https://moneyforward.com/',
  /** 資産バランスシート (口座/銘柄一覧) */
  balanceSheet: 'https://moneyforward.com/bs',
  /** 口座一覧 (個別口座詳細へのリンク) */
  accounts: 'https://moneyforward.com/accounts',
} as const;
