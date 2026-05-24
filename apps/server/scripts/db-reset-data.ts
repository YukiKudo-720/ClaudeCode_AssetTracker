// データ系テーブル (Account/Security/Holding/Snapshot/Run) を全削除。
// Category seed は保持。次の scrape で fresh に再構築される。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server exec tsx scripts/db-reset-data.ts

import '../src/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 外部キー順に削除
  const r1 = await prisma.holdingSnapshot.deleteMany({});
  const r2 = await prisma.accountSnapshot.deleteMany({});
  const r3 = await prisma.priceSnapshot.deleteMany({});
  const r4 = await prisma.dividend.deleteMany({});
  const r5 = await prisma.transaction.deleteMany({});
  const r6 = await prisma.securityCategory.deleteMany({});
  const r7 = await prisma.holding.deleteMany({});
  const r8 = await prisma.security.deleteMany({});
  const r9 = await prisma.account.deleteMany({});
  const r10 = await prisma.scrapeRun.deleteMany({});
  const r11 = await prisma.fxRate.deleteMany({});
  console.log('Deleted:');
  console.log(`  HoldingSnapshot: ${r1.count}`);
  console.log(`  AccountSnapshot: ${r2.count}`);
  console.log(`  PriceSnapshot:   ${r3.count}`);
  console.log(`  Dividend:        ${r4.count}`);
  console.log(`  Transaction:     ${r5.count}`);
  console.log(`  SecurityCategory:${r6.count}`);
  console.log(`  Holding:         ${r7.count}`);
  console.log(`  Security:        ${r8.count}`);
  console.log(`  Account:         ${r9.count}`);
  console.log(`  ScrapeRun:       ${r10.count}`);
  console.log(`  FxRate:          ${r11.count}`);
  const catCount = await prisma.category.count();
  console.log(`Category 保持: ${catCount} 件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
