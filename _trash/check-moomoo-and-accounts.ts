import '../src/env.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  console.log('=== moomoo HoldingSnapshot ===');
  const moo = await prisma.holdingSnapshot.findMany({
    where: { holding: { account: { institution: 'moomoo' } } },
    include: { holding: { include: { security: true } } },
    orderBy: { marketDate: 'desc' },
    take: 30,
  });
  for (const r of moo) {
    console.log(JSON.stringify({
      marketDate: r.marketDate,
      symbol: r.holding.security.symbol,
      region: r.holding.security.region,
      currency: r.holding.security.currency,
      qty: Number(r.quantity),
      valueJpy: Number(r.marketValueJpy),
    }));
  }
  console.log('\n=== 各 Account の AccountSnapshot 直近 5 件 ===');
  const accounts = await prisma.account.findMany({ where: { enabled: true } });
  for (const a of accounts) {
    const snaps = await prisma.accountSnapshot.findMany({
      where: { accountId: a.id },
      orderBy: { capturedDate: 'desc' },
      take: 5,
      select: { capturedDate: true, totalValueJpy: true },
    });
    console.log(`\n[${a.institution}/${a.label}]`);
    for (const s of snaps) {
      console.log(`  ${s.capturedDate}: ¥${Number(s.totalValueJpy).toLocaleString()}`);
    }
  }
  await prisma.$disconnect();
}
main();
