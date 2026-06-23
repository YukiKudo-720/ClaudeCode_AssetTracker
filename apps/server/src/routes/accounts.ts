import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { recentThresholdDateString } from '../lib/date.js';

// 口座総額 / 前日比 / breakdown を HoldingSnapshot ベースで一貫させる。
//
// AccountSnapshot は capturedDate ベース (scrape 時刻) で、upsert 更新時に
// capturedDate が後で書き換わるため日付軸として信用できない (= JST 9:00 跨ぎ
// や SBI リトライで上書きされる)。集計には使わず参考値として残しておく。
//
// HoldingSnapshot は (holdingId, marketDate) unique なので 2 重カウントなし。
// 日本株は JST 9:00 区切り、米株は ET 0:00 区切りで marketDate が決まる。
// 「latest = 各 holding の最新 marketDate」「prev = その前」で集計し、口座総額は
// その合計値。
export function registerAccountRoutes(app: FastifyInstance): void {
  app.get('/api/accounts', async () => {
    const accounts = await prisma.account.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    // 直近 14 日の全 HoldingSnapshot を取って holding ごとに最新/前日を抽出。
    const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const sinceStr = new Date(sinceMs).toISOString().slice(0, 10);
    const allSnapshots = await prisma.holdingSnapshot.findMany({
      where: { marketDate: { gte: sinceStr } },
      include: {
        holding: { include: { security: { select: { assetClass: true } } } },
      },
      orderBy: { marketDate: 'desc' },
    });

    const byHolding = new Map<string, typeof allSnapshots>();
    for (const hs of allSnapshots) {
      const arr = byHolding.get(hs.holdingId) ?? [];
      arr.push(hs);
      byHolding.set(hs.holdingId, arr);
    }
    // 直近 N 日に動きが無い holding は除外 (adapter から消えた持ち高の残骸対策)
    const recentDate = recentThresholdDateString();
    for (const [hid, arr] of byHolding) {
      if (!arr[0] || arr[0].marketDate < recentDate) byHolding.delete(hid);
    }

    const summaries = accounts.map((a) => {
      // この account に紐づく holding の最新 / 前日 HoldingSnapshot
      const latestSnaps: typeof allSnapshots = [];
      const prevSnaps: typeof allSnapshots = [];
      for (const [, arr] of byHolding) {
        if (!arr[0] || arr[0].holding.accountId !== a.id) continue;
        latestSnaps.push(arr[0]);
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

      // 表示用日付
      const latestDateSet = new Set(latestSnaps.map((hs) => hs.marketDate));
      const allLatestDesc = [...latestDateSet].sort().reverse();
      const latestDate = allLatestDesc[0] ?? null;
      const prevDateSet = new Set(prevSnaps.map((hs) => hs.marketDate));
      const allPrevDesc = [...prevDateSet].sort().reverse();
      const prevDate = allPrevDesc[0] ?? null;

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
        // 既存 schema 互換のため latestCapturedAt は marketDate を ISO に
        latestCapturedAt: latestDate ? `${latestDate}T00:00:00+09:00` : null,
        latestCapturedDate: latestDate,
        prevTotalJpy: hasPrev ? prev.total : null,
        prevCapturedDate: prevDate,
        breakdown,
      };
    });
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
