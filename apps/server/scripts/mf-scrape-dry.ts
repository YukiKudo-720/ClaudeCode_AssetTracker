// MF scraper を実行して結果をダンプするだけ (DB 書き込みなし)。
// セレクタが期待通り抽出できてるか目視確認するための drying script。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run mf:scrape-dry
//
// HEADFUL=1 で起動するとブラウザが見える (デバッグ時)

import '../src/env.js';
import { scrapeMoneyForward } from '../src/adapters/moneyforward/scraper.js';

const headful = process.env.HEADFUL === '1';
console.log(`MF scrape (dry run, ${headful ? 'headful' : 'headless'})...`);

const start = Date.now();
const updates = await scrapeMoneyForward({ headless: !headful });
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

console.log(`\n--- 結果 (${elapsed}s, ${updates.length} 機関) ---\n`);

for (const u of updates) {
  const total =
    u.cashNative +
    u.holdings.reduce((s, h) => s + h.quantity * h.marketPriceNative, 0);
  console.log(`■ ${u.institution} (${u.label})`);
  console.log(`  現金: ¥${u.cashNative.toLocaleString('ja-JP')}`);
  if (u.holdings.length > 0) {
    console.log(`  保有: ${u.holdings.length} 銘柄`);
    for (const h of u.holdings.slice(0, 5)) {
      const value = (h.quantity * h.marketPriceNative).toLocaleString('ja-JP', {
        maximumFractionDigits: 0,
      });
      const ex = h.exchange ? `(${h.exchange})` : '';
      console.log(
        `    ${h.symbol}${ex} ${h.name} x${h.quantity} = ¥${value} [${h.assetClass}/${h.region ?? '?'}]`,
      );
    }
    if (u.holdings.length > 5) console.log(`    ... +${u.holdings.length - 5} more`);
  }
  console.log(`  口座合計: ¥${total.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}\n`);
}

console.log('--- 終了 ---');
process.exit(0);
