// Webull adapter を実行して DB に persist (server 起動不要)。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run webull:run
//
// 前提: WEBULL_APP_KEY / WEBULL_APP_SECRET が .env 設定、IP whitelist 登録済。

import '../src/env.js';
import { runAdapter } from '../src/worker/runAll.js';

console.log('Webull adapter 実行中...');
const start = Date.now();
const result = await runAdapter('webull_api');
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\n--- 結果 (${elapsed}s) ---`);
console.log(`  runId:           ${result.runId}`);
console.log(`  status:          ${result.status}`);
console.log(`  accountsTouched: ${result.accountsTouched}`);
if (result.errorMsg) {
  console.log(`  errorMsg:        ${result.errorMsg}`);
}
process.exit(result.status === 'ok' ? 0 : 1);
