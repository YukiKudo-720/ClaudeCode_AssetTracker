// 欠落 AccountSnapshot の backfill (one-shot migration).
//
// 動作:
//   全 Account について、最古 AccountSnapshot 日 〜 今日 までの全 JST 日付を生成。
//   各日について snapshot が無い口座を検出し、直近の前日 snapshot を当日にコピーする。
//   HoldingSnapshot も併せてコピー (= 構成銘柄は前日と同じ値で持ち越し)。
//
// 銘柄レベルの注意:
//   adapter が成功した日の銘柄消失 (= 売却) は当日 HoldingSnapshot が無いことで表現される。
//   ここで埋めるのは「AccountSnapshot 自体が無い日」だけなので、売却の表現を壊さない。
//
// 使い方:
//   tsx scripts/backfill-missing-snapshots.ts            # dry-run (DB 書込なし)
//   tsx scripts/backfill-missing-snapshots.ts --apply    # 実行

import '../src/env.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// JST 日付 YYYY-MM-DD を 1 日進める。
// 注意: Date を JST で作っても .toISOString().slice(0,10) は UTC 日付を返すので、
// JST 24:00:00 を跨がず同じ日付が返って無限ループになる。日付文字列を直接分解して
// Date.UTC で繰上げ計算する (タイムゾーン非依存)。
function nextDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  if (y == null || m == null || d == null) throw new Error(`invalid date: ${yyyymmdd}`);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function todayJst(): string {
  const now = new Date();
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  return new Date(now.getTime() + jstOffsetMs).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });

  const today = todayJst();
  let totalCopied = 0;

  console.log(`mode=${APPLY ? 'APPLY' : 'dry-run'} today(JST)=${today}\n`);

  for (const a of accounts) {
    const first = await prisma.accountSnapshot.findFirst({
      where: { accountId: a.id },
      orderBy: { capturedDate: 'asc' },
    });
    if (!first) {
      console.log(`[${a.institution}/${a.label}] スナップショット無し → skip`);
      continue;
    }

    const existing = await prisma.accountSnapshot.findMany({
      where: { accountId: a.id },
      select: { capturedDate: true },
    });
    const existingDates = new Set(existing.map((s) => s.capturedDate));

    const missing: string[] = [];
    let cur = first.capturedDate;
    while (cur <= today) {
      if (!existingDates.has(cur)) missing.push(cur);
      cur = nextDate(cur);
    }

    if (missing.length === 0) {
      console.log(`[${a.institution}/${a.label}] 欠落なし`);
      continue;
    }

    console.log(`[${a.institution}/${a.label}] 欠落 ${missing.length} 日: ${missing.join(', ')}`);

    if (!APPLY) {
      totalCopied += missing.length;
      continue;
    }

    for (const date of missing) {
      // この時点で「date より strictly 前で最新」の snapshot を引く
      const prev = await prisma.accountSnapshot.findFirst({
        where: { accountId: a.id, capturedDate: { lt: date } },
        orderBy: { capturedDate: 'desc' },
      });
      if (!prev) continue; // 履歴より前の日 = 復元元なし

      const newSnap = await prisma.accountSnapshot.create({
        data: {
          accountId: a.id,
          capturedAt: new Date(`${date}T12:00:00+09:00`),
          capturedDate: date,
          totalValueNative: prev.totalValueNative,
          totalValueJpy: prev.totalValueJpy,
          cashNative: prev.cashNative,
          cashJpy: prev.cashJpy,
          fxRate: prev.fxRate,
        },
      });

      const prevHoldings = await prisma.holdingSnapshot.findMany({
        where: { capturedDate: prev.capturedDate, holding: { accountId: a.id } },
      });
      for (const hs of prevHoldings) {
        // 当日 HoldingSnapshot が既に他経路であるなら触らない
        const existed = await prisma.holdingSnapshot.findUnique({
          where: { holdingId_capturedDate: { holdingId: hs.holdingId, capturedDate: date } },
        });
        if (existed) continue;
        await prisma.holdingSnapshot.create({
          data: {
            snapshotId: newSnap.id,
            holdingId: hs.holdingId,
            capturedDate: date,
            quantity: hs.quantity,
            marketPriceNative: hs.marketPriceNative,
            marketPriceJpy: hs.marketPriceJpy,
            marketValueNative: hs.marketValueNative,
            marketValueJpy: hs.marketValueJpy,
            ...(hs.avgCostNative != null ? { avgCostNative: hs.avgCostNative } : {}),
          },
        });
      }
      totalCopied += 1;
    }
  }

  console.log(`\n${APPLY ? 'コピー' : '欠落'}合計: ${totalCopied} 日分`);
  if (!APPLY) {
    console.log('--apply を付けて再実行すると実際に backfill します。');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
