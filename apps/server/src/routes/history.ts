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

    const accAll = await prisma.accountSnapshot.findMany({
      where: { capturedDate: { gte: sinceStr } },
      orderBy: [{ accountId: 'asc' }, { capturedDate: 'desc' }],
      select: { accountId: true, capturedDate: true, totalValueJpy: true, cashJpy: true },
    });

    // 日付ベースの集計: 各日付について「その日付以下で各口座の最新 valid snap」
    // を採用して合計。これにより異常 snap (= 前日比 50% 以上減 = adapter 部分失敗)
    // は除外され、代わりに前の正常値が継続して使われる (= ダッシュボードの値とも
    // 一致)。
    const byAccount = new Map<string, typeof accAll>();
    for (const s of accAll) {
      const arr = byAccount.get(s.accountId) ?? [];
      arr.push(s);
      byAccount.set(s.accountId, arr);
    }
    const allDates = [...new Set(accAll.map((s) => s.capturedDate))].sort();
    const byDateTotals = new Map<string, { total: number; cash: number }>();
    for (const date of allDates) {
      let totalSum = 0;
      let cashSum = 0;
      for (const snaps of byAccount.values()) {
        // snaps は capturedDate desc 順。date 以下で最新の valid snap を探す
        let i = 0;
        while (i < snaps.length && snaps[i]!.capturedDate > date) i++;
        while (i < snaps.length) {
          const snap = snaps[i]!;
          const next = snaps[i + 1];
          const baseline = next ? Number(next.totalValueJpy) : null;
          const v = Number(snap.totalValueJpy);
          if (baseline != null && baseline > 0 && v < baseline * 0.5) {
            i++;
            continue;
          }
          totalSum += v;
          cashSum += Number(snap.cashJpy);
          break;
        }
      }
      byDateTotals.set(date, { total: totalSum, cash: cashSum });
    }
    const accGrouped = [...byDateTotals.entries()]
      .map(([date, v]) => ({ capturedDate: date, total: v.total, cash: v.cash }))
      .sort((a, b) => a.capturedDate.localeCompare(b.capturedDate));

    // 同一 (capturedDate, holdingId) に複数 marketDate がある場合 (= JST 9:00 を
    // 跨いで複数回 scrape された日) は最新 marketDate のみ採用して 2 重カウントを
    // 防ぐ。
    // ※HoldingSnapshot 1 件で (capturedDate, marketDate) は 1 つ。同じ holding が
    //  同じ capturedDate で別 marketDate の 2 行ある場合、新しい marketDate を採用。
    const allSnaps = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: { gte: sinceStr } },
      orderBy: { marketDate: 'desc' },
      select: {
        capturedDate: true,
        marketDate: true,
        holdingId: true,
        marketValueJpy: true,
        holding: { select: { security: { select: { assetClass: true } } } },
      },
    });
    // dedup: (capturedDate, holdingId) -> 最新 marketDate のみ採用
    const seen = new Set<string>();
    const dedupedHoldings: typeof allSnaps = [];
    for (const hs of allSnaps) {
      const k = `${hs.capturedDate}|${hs.holdingId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedupedHoldings.push(hs);
    }

    // date -> assetClass -> sum(marketValueJpy)
    const byDate = new Map<string, Map<string, number>>();
    for (const hs of dedupedHoldings) {
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
