import '../src/env.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const accounts = await prisma.account.findMany({ where: { enabled: true } });
  for (const a of accounts) {
    // 直近 3 日の AccountSnapshot
    const snaps = await prisma.accountSnapshot.findMany({
      where: { accountId: a.id },
      orderBy: { capturedDate: 'desc' },
      take: 3,
    });
    if (snaps.length === 0) continue;
    console.log(`\n[${a.institution}/${a.label}]`);
    for (const s of snaps) {
      // 同じ capturedDate の HoldingSnapshot 合計
      const hs = await prisma.holdingSnapshot.findMany({
        where: {
          capturedDate: s.capturedDate,
          holding: { accountId: a.id },
        },
        include: { holding: { include: { security: { select: { symbol: true } } } } },
      });
      let hsSum = 0;
      const symbols: string[] = [];
      for (const h of hs) {
        hsSum += Number(h.marketValueJpy);
        symbols.push(h.holding.security.symbol);
      }
      const accV = Number(s.totalValueJpy);
      const diff = accV - hsSum;
      const pct = accV > 0 ? (diff / accV) * 100 : 0;
      console.log(`  ${s.capturedDate}: Acc=¥${Math.round(accV).toLocaleString()} HS合計=¥${Math.round(hsSum).toLocaleString()} 差=¥${Math.round(diff).toLocaleString()} (${pct.toFixed(1)}%) [HS銘柄=${symbols.length}件: ${symbols.slice(0,8).join(',')}${symbols.length>8?'...':''}]`);
    }
  }
  await prisma.$disconnect();
}
main();
