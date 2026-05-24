// MF adapter を実行して DB に persist する (server を起動せず直接実行)。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run mf:run
//
// runAdapter('moneyforward') 内部で scraper → persist (Prisma) を一括実行。
// 同日中の再実行は AccountSnapshot/HoldingSnapshot を上書き (capturedDate で upsert)。
//
// HEADFUL=1 でブラウザ可視化 (デバッグ時)

import '../src/env.js';
import { runAdapter } from '../src/worker/runAll.js';

const headful = process.env.HEADFUL === '1';
console.log(`MF adapter 実行中 (${headful ? 'headful' : 'headless'})...`);
const start = Date.now();
const result = await runAdapter('moneyforward');
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\n--- 結果 (${elapsed}s) ---`);
console.log(`  runId:           ${result.runId}`);
console.log(`  source:          ${result.source}`);
console.log(`  status:          ${result.status}`);
console.log(`  accountsTouched: ${result.accountsTouched}`);
if (result.errorMsg) {
  console.log(`  errorMsg:        ${result.errorMsg}`);
}

process.exit(result.status === 'ok' ? 0 : 1);
