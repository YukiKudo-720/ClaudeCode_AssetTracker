// MoneyForward ME ログイン wizard (初回 / 30 日 expire 後に手動実行する用)
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run mf:login
//
// ブラウザが開くので Passkey でログインし、ログイン後にこのターミナルで Enter。
// セッションは data/playwright-profiles/moneyforward/ に保存される。

import { runLoginWizard } from '../src/adapters/moneyforward/login-wizard.js';

runLoginWizard()
  .then(() => {
    console.log('完了');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
