import '../src/env.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const accounts = await prisma.account.findMany({ where: { enabled: true } });
  let totalLatest = 0;
  console.log('=== 各 Account 最新 AccountSnapshot ===');
  for (const a of accounts) {
    const snaps = await prisma.accountSnapshot.findMany({
      where: { accountId: a.id },
      orderBy: { capturedDate: 'desc' },
      take: 3,
      select: { capturedDate: true, totalValueJpy: true },
    });
    const latest = Number(snaps[0]?.totalValueJpy ?? 0);
    totalLatest += latest;
    console.log(`[${a.institution}/${a.label}]`);
    for (const s of snaps) {
      console.log(`  ${s.capturedDate}: ¥${Number(s.totalValueJpy).toLocaleString()}`);
    }
  }
  console.log(`\n=== 全口座 latestTotalJpy 合計: ¥${totalLatest.toLocaleString()} ===`);

  console.log('\n=== /api/history/total 直近 7 日 (groupBy capturedDate) ===');
  const grouped = await prisma.accountSnapshot.groupBy({
    by: ['capturedDate'],
    where: { capturedDate: { gte: '2026-06-16' } },
    _sum: { totalValueJpy: true, cashJpy: true },
    orderBy: { capturedDate: 'asc' },
  });
  for (const g of grouped) {
    console.log(`  ${g.capturedDate}: ¥${Number(g._sum.totalValueJpy ?? 0).toLocaleString()}`);
  }
  await prisma.$disconnect();
}
main();
