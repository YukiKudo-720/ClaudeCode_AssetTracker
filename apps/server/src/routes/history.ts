import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const QuerySchema = z.object({
  // 表示期間 (日数)
  days: z.coerce.number().int().positive().max(3650).default(90),
});

// 全口座合算の総資産推移。日単位 (capturedDate)。
// totalJpy / cashJpy に加え、assetClass 別の合計 (stock/etf/mutual_fund/reit/...)
// を flat に同梱する (recharts の dataKey に直接渡せるように)。
export function registerHistoryRoutes(app: FastifyInstance): void {
  app.get('/api/history/total', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', detail: parsed.error.format() });
    }
    const { days } = parsed.data;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().slice(0, 10);

    const [accAll, holdingSnaps] = await Promise.all([
      // groupBy ではなく account 単位で取って、異常 snap (= 前日比 50% 以上減 = adapter
      // 部分失敗の証拠) を弾いてから集計する。
      prisma.accountSnapshot.findMany({
        where: { capturedDate: { gte: sinceStr } },
        orderBy: [{ accountId: 'asc' }, { capturedDate: 'desc' }],
        select: { accountId: true, capturedDate: true, totalValueJpy: true, cashJpy: true },
      }),
      prisma.holdingSnapshot.findMany({
        where: { capturedDate: { gte: sinceStr } },
        select: {
          capturedDate: true,
          marketValueJpy: true,
          holding: { select: { security: { select: { assetClass: true } } } },
        },
      }),
    ]);

    // 異常 snap を除外: account ごとに新しい順に並べ、各 snap が「1 つ古い snap の
    // 50% 未満」なら除外。
    const byAccount = new Map<string, typeof accAll>();
    for (const s of accAll) {
      const arr = byAccount.get(s.accountId) ?? [];
      arr.push(s);
      byAccount.set(s.accountId, arr);
    }
    const byDateTotals = new Map<string, { total: number; cash: number }>();
    for (const arr of byAccount.values()) {
      // arr は capturedDate desc 順
      for (let i = 0; i < arr.length; i++) {
        const snap = arr[i]!;
        const next = arr[i + 1];
        const baseline = next ? Number(next.totalValueJpy) : null;
        const v = Number(snap.totalValueJpy);
        if (baseline != null && baseline > 0 && v < baseline * 0.5) continue;
        const acc = byDateTotals.get(snap.capturedDate) ?? { total: 0, cash: 0 };
        acc.total += v;
        acc.cash += Number(snap.cashJpy);
        byDateTotals.set(snap.capturedDate, acc);
      }
    }
    const accGrouped = [...byDateTotals.entries()]
      .map(([date, v]) => ({ capturedDate: date, total: v.total, cash: v.cash }))
      .sort((a, b) => a.capturedDate.localeCompare(b.capturedDate));

    // date -> assetClass -> sum(marketValueJpy)
    const byDate = new Map<string, Map<string, number>>();
    for (const hs of holdingSnaps) {
      const cls = hs.holding.security.assetClass;
      const v = Number(hs.marketValueJpy);
      let m = byDate.get(hs.capturedDate);
      if (!m) {
        m = new Map();
        byDate.set(hs.capturedDate, m);
      }
      m.set(cls, (m.get(cls) ?? 0) + v);
    }

    return {
      points: accGrouped.map((g) => {
        const buckets = byDate.get(g.capturedDate);
        const valueOf = (cls: string): number => buckets?.get(cls) ?? 0;
        return {
          date: g.capturedDate,
          totalJpy: g.total,
          cashJpy: g.cash,
          // assetClass 別 (該当無しは 0)
          cash: valueOf('cash'),
          fx: valueOf('fx'),
          stock: valueOf('stock'),
          etf: valueOf('etf'),
          mutual_fund: valueOf('mutual_fund'),
          reit: valueOf('reit'),
          bond: valueOf('bond'),
          crypto: valueOf('crypto'),
          commodity: valueOf('commodity'),
          other: valueOf('other'),
        };
      }),
    };
  });
}
