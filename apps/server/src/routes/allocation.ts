import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { recentThresholdDateString } from '../lib/date.js';

const QuerySchema = z.object({
  by: z.enum(['currency', 'assetClass', 'region', 'institution']).default('assetClass'),
});

// 最新時点の資産配分 (ダッシュボードの円グラフ用)。
// 集計軸 (by) は currency / assetClass / region / institution。
//
// 全ルートで統一: HoldingSnapshot + marketDate ベース。
// 各 holding の最新 marketDate のスナップショットを採用 (2 重カウント無し)。
// 直近 N 日に動きが無い holding は除外 (= adapter から消えた持ち高の残骸対策)。
export function registerAllocationRoutes(app: FastifyInstance): void {
  app.get('/api/allocation', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', detail: parsed.error.format() });
    }
    const { by } = parsed.data;

    const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const sinceStr = new Date(sinceMs).toISOString().slice(0, 10);
    const allSnaps = await prisma.holdingSnapshot.findMany({
      where: { marketDate: { gte: sinceStr } },
      include: { holding: { include: { security: true, account: true } } },
      orderBy: { marketDate: 'desc' },
    });
    if (allSnaps.length === 0) {
      return { capturedDate: null, by, totalJpy: 0, buckets: [] };
    }

    // holding ごとに最新 marketDate
    const byHolding = new Map<string, typeof allSnaps>();
    for (const hs of allSnaps) {
      const arr = byHolding.get(hs.holdingId) ?? [];
      arr.push(hs);
      byHolding.set(hs.holdingId, arr);
    }
    const recentDate = recentThresholdDateString();
    const latestSnaps: typeof allSnaps = [];
    for (const arr of byHolding.values()) {
      if (arr[0] && arr[0].marketDate >= recentDate) latestSnaps.push(arr[0]);
    }

    const totalJpy = latestSnaps.reduce((s, hs) => s + Number(hs.marketValueJpy), 0);
    const headerDate = [...new Set(latestSnaps.map((hs) => hs.marketDate))]
      .sort()
      .reverse()[0] ?? null;

    const map = new Map<string, { label: string; valueJpy: number }>();
    function add(key: string, label: string, valueJpy: number): void {
      const cur = map.get(key) ?? { label, valueJpy: 0 };
      cur.valueJpy += valueJpy;
      map.set(key, cur);
    }

    for (const hs of latestSnaps) {
      const valueJpy = Number(hs.marketValueJpy);
      const s = hs.holding.security;
      const a = hs.holding.account;
      switch (by) {
        case 'currency':
          add(s.currency, s.currency, valueJpy);
          break;
        case 'assetClass':
          add(s.assetClass, s.assetClass, valueJpy);
          break;
        case 'region':
          add(s.region ?? 'unknown', s.region ?? 'unknown', valueJpy);
          break;
        case 'institution':
          add(a.institution, a.institution, valueJpy);
          break;
      }
    }

    const buckets = Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: v.label,
        valueJpy: v.valueJpy,
        ratio: totalJpy > 0 ? v.valueJpy / totalJpy : 0,
      }))
      .sort((a, b) => b.valueJpy - a.valueJpy);

    return { capturedDate: headerDate, by, totalJpy, buckets };
  });
}
