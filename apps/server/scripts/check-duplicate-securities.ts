// 重複 Security 検査 (read-only).
// 表示は (symbol, currency) で集約しているが、DB 上は (symbol, exchange) unique なので
// adapter ごとの exchange 表記差で同じ銘柄が複数行に割れている可能性がある。
// このスクリプトは削除はせず、状況だけ列挙する。
import '../src/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const securities = await prisma.security.findMany({
    orderBy: [{ symbol: 'asc' }, { createdAt: 'asc' }],
    include: {
      holdings: {
        include: {
          account: { select: { institution: true, label: true } },
          snapshots: {
            orderBy: { capturedDate: 'desc' },
            take: 1,
            select: { capturedDate: true, marketValueJpy: true },
          },
        },
      },
    },
  });

  const byKey = new Map<string, typeof securities>();
  for (const s of securities) {
    const key = `${s.symbol}|${s.currency}`;
    const arr = byKey.get(key) ?? [];
    arr.push(s);
    byKey.set(key, arr);
  }

  const dups = [...byKey.entries()].filter(([, arr]) => arr.length > 1);
  if (dups.length === 0) {
    console.log('OK: 重複なし');
    return;
  }

  console.log(`重複 ${dups.length} 件:`);
  for (const [key, arr] of dups) {
    console.log(`\n[${key}]`);
    for (const s of arr) {
      const holdingCount = s.holdings.length;
      const accs = s.holdings
        .map((h) => `${h.account.institution}/${h.account.label}`)
        .join(', ');
      const latest = s.holdings
        .flatMap((h) => h.snapshots)
        .sort((a, b) => b.capturedDate.localeCompare(a.capturedDate))[0];
      console.log(
        `  id=${s.id} exchange=${s.exchange ?? 'null'} name="${s.name}" createdAt=${s.createdAt.toISOString()}`,
      );
      console.log(
        `    holdings=${holdingCount} accounts=[${accs}] latestSnapshot=${latest?.capturedDate ?? 'none'} ¥${latest?.marketValueJpy ?? 0}`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
