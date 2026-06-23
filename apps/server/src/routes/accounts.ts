import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { recentThresholdDateString } from '../lib/date.js';

// 口座総額は AccountSnapshot (= adapter が直接返した値) ベースで一貫させる。
// 前日比も AccountSnapshot 同士で比較するので JST capturedDate 基準。
// 一方、assetClass 別 breakdown は HoldingSnapshot から集計するため、
// 日本株は JST 9:00 区切り、米株は ET 0:00 区切りの marketDate ベース。
//
// 両者の境界が違うので「口座総額」と「breakdown の合計」がぴったり一致しない
// ことがあるが、これは設計上の妥協 (adapter ベース vs 銘柄ベースの目的の違い)。
export function registerAccountRoutes(app: FastifyInstance): void {
  app.get('/api/accounts', async () => {
    const accounts = await prisma.account.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    // breakdown 用: 直近 14 日の HoldingSnapshot
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

    const summaries = await Promise.all(
      accounts.map(async (a) => {
        // 口座総額: AccountSnapshot から直近 5 件を取って、異常 (前日比 50% 以上減) の
        // ものを scrape 部分失敗とみなしてスキップ。1 日で 50% 以上減るのは
        // 通常運用ではあり得ない (= adapter が銘柄を取りこぼした証拠)。
        const recentAccSnaps = await prisma.accountSnapshot.findMany({
          where: { accountId: a.id },
          orderBy: { capturedDate: 'desc' },
          take: 5,
        });
        // 各 snap を「1 つ古い snap」と比較し、50% 未満なら異常 (= adapter 部分失敗)
        // と判定してスキップ。残ったうち最新 / 次を採用。
        const goodSnaps: typeof recentAccSnaps = [];
        for (let i = 0; i < recentAccSnaps.length; i++) {
          const snap = recentAccSnaps[i]!;
          const next = recentAccSnaps[i + 1];
          const baseline = next ? Number(next.totalValueJpy) : null;
          const v = Number(snap.totalValueJpy);
          if (baseline != null && baseline > 0 && v < baseline * 0.5) continue;
          goodSnaps.push(snap);
          if (goodSnaps.length >= 2) break;
        }
        const latestAcc = goodSnaps[0] ?? null;
        const prevAcc = goodSnaps[1] ?? null;

        // breakdown: この account に紐づく holding の最新 / 前日 HoldingSnapshot
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
        ): Map<string, number> {
          const m = new Map<string, number>();
          for (const hs of snaps) {
            const cls = hs.holding.security.assetClass;
            const v = Number(hs.marketValueJpy);
            m.set(cls, (m.get(cls) ?? 0) + v);
          }
          return m;
        }
        const todayMap = aggregateByAssetClass(latestSnaps);
        const prevMap = aggregateByAssetClass(prevSnaps);
        const hasPrevBreakdown = prevSnaps.length > 0;

        const allClasses = new Set([...todayMap.keys(), ...prevMap.keys()]);
        const breakdown = [...allClasses]
          .map((cls) => ({
            assetClass: cls,
            valueJpy: todayMap.get(cls) ?? 0,
            prevValueJpy: hasPrevBreakdown ? prevMap.get(cls) ?? 0 : null,
          }))
          .sort((x, y) => y.valueJpy - x.valueJpy);

        return {
          id: a.id,
          kind: a.kind,
          institution: a.institution,
          source: a.source,
          label: a.label,
          baseCurrency: a.baseCurrency,
          tags: JSON.parse(a.tags) as string[],
          enabled: a.enabled,
          latestTotalJpy: latestAcc ? Number(latestAcc.totalValueJpy) : null,
          latestCapturedAt: latestAcc ? latestAcc.capturedAt.toISOString() : null,
          latestCapturedDate: latestAcc ? latestAcc.capturedDate : null,
          prevTotalJpy: prevAcc ? Number(prevAcc.totalValueJpy) : null,
          prevCapturedDate: prevAcc ? prevAcc.capturedDate : null,
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
