import '../src/env.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows = await prisma.holdingSnapshot.findMany({
    where: {
      holding: { account: { institution: 'webull' } },
    },
    include: {
      holding: { include: { security: true, account: true } },
    },
    orderBy: { marketDate: 'desc' },
    take: 30,
  });
  for (const r of rows) {
    console.log(JSON.stringify({
      marketDate: r.marketDate,
      capturedDate: r.capturedDate,
      symbol: r.holding.security.symbol,
      assetClass: r.holding.security.assetClass,
      region: r.holding.security.region,
      currency: r.holding.security.currency,
      securityId: r.holding.security.id,
      qty: Number(r.quantity),
      valueJpy: Number(r.marketValueJpy),
    }));
  }
  await prisma.$disconnect();
}
main();
