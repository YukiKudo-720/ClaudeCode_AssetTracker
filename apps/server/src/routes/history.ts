import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const QuerySchema = z.object({
  days: z.coerce.number().int().positive().max(3650).default(90),
});

// 全資産の総額推移を marketDate ベースで返す。
//
// 設計:
//   - 集計は HoldingSnapshot を marketDate でグルーピングしたもの。
//     (holdingId, marketDate) unique なので 2 重カウント無し。
//   - AccountSnapshot は capturedDate ベース (scrape 時刻) なので集計に使わない。
//     adapter からの参考値として残ってはいる。
//   - 日本株は JST 9:00 区切り、米株は ET 0:00 区切りで marketDate が決まる。
//     ある日付の総額 = その日付の marketDate を持つ全 holding の marketValueJpy 合計。
//
// 集計軸の統一: ダッシュボード / 口座 / テーマ / 東大 / 履歴 すべて HoldingSnapshot
// + marketDate ベースなので全画面で総額が一致する。
export function registerHistoryRoutes(app: FastifyInstance): void {
  app.get('/api/history/total', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', detail: parsed.error.format() });
    }
    const { days } = parsed.data;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().slice(0, 10);

    const snaps = await prisma.holdingSnapshot.findMany({
      where: { marketDate: { gte: sinceStr } },
      select: {
        marketDate: true,
        marketValueJpy: true,
        holding: { select: { security: { select: { assetClass: true } } } },
      },
      orderBy: { marketDate: 'asc' },
    });

    // marketDate -> { total, cash, byClass }
    const byDate = new Map<
      string,
      { total: number; cash: number; byClass: Map<string, number> }
    >();
    for (const hs of snaps) {
      const cls = hs.holding.security.assetClass;
      const v = Number(hs.marketValueJpy);
      let bucket = byDate.get(hs.marketDate);
      if (!bucket) {
        bucket = { total: 0, cash: 0, byClass: new Map() };
        byDate.set(hs.marketDate, bucket);
      }
      bucket.total += v;
      if (cls === 'cash') bucket.cash += v;
      bucket.byClass.set(cls, (bucket.byClass.get(cls) ?? 0) + v);
    }

    const points = [...byDate.entries()]
      .map(([date, b]) => {
        const valueOf = (cls: string): number => b.byClass.get(cls) ?? 0;
        return {
          date,
          totalJpy: b.total,
          cashJpy: b.cash,
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
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    return { points };
  });
}
