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

    const [accGrouped, holdingSnaps] = await Promise.all([
      prisma.accountSnapshot.groupBy({
        by: ['capturedDate'],
        where: { capturedDate: { gte: sinceStr } },
        _sum: { totalValueJpy: true, cashJpy: true },
        orderBy: { capturedDate: 'asc' },
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
          totalJpy: Number(g._sum.totalValueJpy ?? 0),
          cashJpy: Number(g._sum.cashJpy ?? 0),
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
