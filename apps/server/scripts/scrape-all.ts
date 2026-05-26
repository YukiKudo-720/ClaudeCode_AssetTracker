// 全 adapter を順次実行して DB に persist (server 起動不要)。
// スケジュールタスクから呼ばれる。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run scrape:all

import '../src/env.js';
import { runAllAdapters } from '../src/worker/runAll.js';

console.log('全 adapter 実行中...');
const start = Date.now();
const results = await runAllAdapters();
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\n--- 結果 (${elapsed}s) ---`);
let failed = 0;
for (const r of results) {
  console.log(
    `  ${r.source.padEnd(14)} ${r.status.padEnd(10)} touched=${r.accountsTouched}`,
  );
  if (r.errorMsg) console.log(`    ${r.errorMsg}`);
  if (r.status !== 'ok') failed += 1;
}

console.log(`\nok=${results.length - failed} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
