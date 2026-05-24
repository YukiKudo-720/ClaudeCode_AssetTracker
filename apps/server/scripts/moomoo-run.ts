// Moomoo adapter を実行して DB に persist (server 起動不要)。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run moomoo:run
//
// 前提: OpenD が 127.0.0.1:11111 で起動済み。

import '../src/env.js';
import { runAdapter } from '../src/worker/runAll.js';

console.log('Moomoo adapter 実行中...');
const start = Date.now();
const result = await runAdapter('moomoo_api');
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\n--- 結果 (${elapsed}s) ---`);
console.log(`  runId:           ${result.runId}`);
console.log(`  status:          ${result.status}`);
console.log(`  accountsTouched: ${result.accountsTouched}`);
if (result.errorMsg) {
  console.log(`  errorMsg:        ${result.errorMsg}`);
}
process.exit(result.status === 'ok' ? 0 : 1);
