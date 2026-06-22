import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { recentThresholdDateString } from '../lib/date.js';

// 口座総額と breakdown を HoldingSnapshot ベースで集約。
// 各 holding ごとに最新 marketDate / 前日 marketDate の値を使うので、
// 日本株と米株で「1 日」がずれていても口座総額の前日比が正しく出る。
export function registerAccountRoutes(app: FastifyInstance): void {
  app.get('/api/accounts', async () => {
    const accounts = await prisma.account.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    // 直近 14 日の全 HoldingSnapshot を取得 (各 holding ごとに最新と前日を選定)
    const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const sinceStr = new Date(sinceMs).toISOString().slice(0, 10);
    const allSnapshots = await prisma.holdingSnapshot.findMany({
      where: { marketDate: { gte: sinceStr } },
      include: {
        holding: { include: { security: { select: { assetClass: true } } } },
      },
      orderBy: { marketDate: 'desc' },
    });

    // holdingId ごとに [latest, prev, ...] (marketDate 降順)
    const byHolding = new Map<string, typeof allSnapshots>();
    for (const hs of allSnapshots) {
      const arr = byHolding.get(hs.holdingId) ?? [];
      arr.push(hs);
      byHolding.set(hs.holdingId, arr);
    }
    // 直近 N 日に動きがない holding は除外
    const recentDate = recentThresholdDateString();
    for (const [hid, arr] of byHolding) {
      if (!arr[0] || arr[0].marketDate < recentDate) byHolding.delete(hid);
    }

    const summaries = await Promise.all(
      accounts.map(async (a) => {
        // 既存の latestCapturedAt 用に AccountSnapshot は引き続き参照
        const latestAccSnap = await prisma.accountSnapshot.findFirst({
          where: { accountId: a.id },
          orderBy: { capturedDate: 'desc' },
        });

        // この account に紐づく holding の最新 / 前日 HoldingSnapshot を抜き出す
        const accountHoldings = await prisma.holding.findMany({
          where: { accountId: a.id },
          select: { id: true },
        });
        const accountHoldingIds = new Set(accountHoldings.map((h) => h.id));

        const latestSnaps: typeof allSnapshots = [];
        const prevSnaps: typeof allSnapshots = [];
        for (const [holdingId, arr] of byHolding) {
          if (!accountHoldingIds.has(holdingId)) continue;
          if (arr[0]) latestSnaps.push(arr[0]);
          if (arr[1]) prevSnaps.push(arr[1]);
        }

        function aggregateByAssetClass(
          snaps: typeof allSnapshots,
        ): { total: number; map: Map<string, number> } {
          let total = 0;
          const map = new Map<string, number>();
          for (const hs of snaps) {
            const cls = hs.holding.security.assetClass;
            const v = Number(hs.marketValueJpy);
            total += v;
            map.set(cls, (map.get(cls) ?? 0) + v);
          }
          return { total, map };
        }

        const today = aggregateByAssetClass(latestSnaps);
        const prev = aggregateByAssetClass(prevSnaps);
        const hasPrev = prevSnaps.length > 0;

        const allClasses = new Set([...today.map.keys(), ...prev.map.keys()]);
        const breakdown = [...allClasses]
          .map((cls) => ({
            assetClass: cls,
            valueJpy: today.map.get(cls) ?? 0,
            prevValueJpy: hasPrev ? prev.map.get(cls) ?? 0 : null,
          }))
          .sort((x, y) => y.valueJpy - x.valueJpy);

        // 表示用日付: holding の中で一番新しい marketDate / その前
        const dateSet = new Set(latestSnaps.map((hs) => hs.marketDate));
        const allDatesDesc = [...dateSet].sort().reverse();

        return {
          id: a.id,
          kind: a.kind,
          institution: a.institution,
          source: a.source,
          label: a.label,
          baseCurrency: a.baseCurrency,
          tags: JSON.parse(a.tags) as string[],
          enabled: a.enabled,
          latestTotalJpy: latestSnaps.length > 0 ? today.total : null,
          latestCapturedAt: latestAccSnap ? latestAccSnap.capturedAt.toISOString() : null,
          prevTotalJpy: hasPrev ? prev.total : null,
          prevCapturedDate: allDatesDesc[1] ?? null,
          breakdown,
        };
      }),
    );
    return summaries;
  });

  app.get<{ Params: { id: string } }>('/api/accounts/:id', async (req, reply) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) return reply.code(404).send({ error: 'not_found' });
    return account;
  });

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/api/accounts/:id/snapshots',
    async (req) => {
      const where: { accountId: string; capturedAt?: { gte?: Date; lte?: Date } } = {
        accountId: req.params.id,
      };
      if (req.query.from || req.query.to) {
        where.capturedAt = {};
        if (req.query.from) where.capturedAt.gte = new Date(req.query.from);
        if (req.query.to) where.capturedAt.lte = new Date(req.query.to);
      }
      return prisma.accountSnapshot.findMany({
        where,
        orderBy: { capturedAt: 'asc' },
      });
    },
  );
}
