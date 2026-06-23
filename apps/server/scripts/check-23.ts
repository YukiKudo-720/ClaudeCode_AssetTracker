import '../src/env.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  console.log('=== 6/23 HoldingSnapshot 全件 (assetClass 別合計) ===');
  const rows = await prisma.holdingSnapshot.findMany({
    where: { capturedDate: '2026-06-23' },
    include: {
      holding: { include: { security: true, account: true } },
    },
  });
  const byClass = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const cls = r.holding.security.assetClass;
    const v = Number(r.marketValueJpy);
    byClass.set(cls, (byClass.get(cls) ?? 0) + v);
    total += v;
  }
  for (const [cls, v] of byClass) {
    console.log(`  ${cls}: ¥${Math.round(v).toLocaleString()}`);
  }
  console.log(`  合計: ¥${Math.round(total).toLocaleString()} (${rows.length} 行)`);
  
  console.log('\n=== 6/23 の HoldingSnapshot 個別 (marketDate ごと) ===');
  const byMd = new Map<string, number>();
  const byMdCount = new Map<string, number>();
  for (const r of rows) {
    byMd.set(r.marketDate, (byMd.get(r.marketDate) ?? 0) + Number(r.marketValueJpy));
    byMdCount.set(r.marketDate, (byMdCount.get(r.marketDate) ?? 0) + 1);
  }
  for (const [md, v] of byMd) {
    console.log(`  marketDate=${md}: ¥${Math.round(v).toLocaleString()} (${byMdCount.get(md)} 行)`);
  }
  
  console.log('\n=== 6/22 HoldingSnapshot 全件 ===');
  const rows22 = await prisma.holdingSnapshot.findMany({
    where: { capturedDate: '2026-06-22' },
  });
  let total22 = 0;
  for (const r of rows22) total22 += Number(r.marketValueJpy);
  console.log(`  合計: ¥${Math.round(total22).toLocaleString()} (${rows22.length} 行)`);
  
  await prisma.$disconnect();
}
main();
