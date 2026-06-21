import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

// Category 別の保有資産集計。各 holding ごとに最新 marketDate と前日 marketDate を
// 採用するので、日本株と米株で「1 日」がずれる場合も独立して正しく前日比が出る。
export function registerCategoriesRoutes(app: FastifyInstance): void {
  app.get('/api/categories', async () => {
    const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const sinceStr = new Date(sinceMs).toISOString().slice(0, 10);

    const all = await prisma.holdingSnapshot.findMany({
      where: { marketDate: { gte: sinceStr } },
      include: {
        holding: {
          include: {
            security: { include: { categories: true } },
            account: true,
          },
        },
      },
      orderBy: { marketDate: 'desc' },
    });
    if (all.length === 0) {
      return {
        capturedDate: null,
        prevCapturedDate: null,
        categories: [],
        untagged: [],
        totalJpy: 0,
        untaggedJpy: 0,
      };
    }

    // holdingId ごとに [latest, prev, ...] (marketDate 降順)
    const byHolding = new Map<string, typeof all>();
    for (const hs of all) {
      const arr = byHolding.get(hs.holdingId) ?? [];
      arr.push(hs);
      byHolding.set(hs.holdingId, arr);
    }

    // 全 holding の最新 snapshot (Security.createdAt で canonical 順にソート)
    const latestSnapshots = [...byHolding.values()]
      .map((arr) => arr[0]!)
      .filter(Boolean)
      .sort(
        (x, y) =>
          x.holding.security.createdAt.getTime() - y.holding.security.createdAt.getTime(),
      );

    // 表示用日付
    const latestDateSet = new Set(latestSnapshots.map((hs) => hs.marketDate));
    const allDatesDesc = [...latestDateSet].sort().reverse();
    const headerLatest = allDatesDesc[0] ?? null;
    const headerPrev = allDatesDesc[1] ?? null;

    // 前日 (symbol, currency) -> sum(marketValueJpy)
    const prevValueBySymCur = new Map<string, number>();
    let hasPrev = false;
    for (const arr of byHolding.values()) {
      const prev = arr[1];
      if (!prev) continue;
      hasPrev = true;
      const sec = prev.holding.security;
      const key = `${sec.symbol}|${sec.currency}`;
      prevValueBySymCur.set(
        key,
        (prevValueBySymCur.get(key) ?? 0) + Number(prev.marketValueJpy),
      );
    }

    // 全体合計 (現金含む)
    const totalJpy = latestSnapshots.reduce((s, hs) => s + Number(hs.marketValueJpy), 0);

    const cats = await prisma.category.findMany({
      where: { kind: 'theme' },
      orderBy: { sortOrder: 'asc' },
    });

    interface CatAgg {
      id: string;
      slug: string;
      name: string;
      sortOrder: number;
      securityCount: number;
      valueJpy: number;
      prevValueJpy: number;
      securities: Array<{
        securityId: string;
        symbol: string;
        name: string;
        assetClass: string;
        weight: number;
        totalValueJpy: number;
        weightedValueJpy: number;
      }>;
    }

    const catMap = new Map<string, CatAgg>();
    for (const c of cats) {
      catMap.set(c.id, {
        id: c.id,
        slug: c.slug,
        name: c.name,
        sortOrder: c.sortOrder,
        securityCount: 0,
        valueJpy: 0,
        prevValueJpy: 0,
        securities: [],
      });
    }

    const secAggMap = new Map<
      string,
      {
        secId: string;
        symbol: string;
        currency: string;
        name: string;
        assetClass: string;
        valueJpy: number;
        categories: Array<{ id: string; weight: number }>;
      }
    >();
    for (const hs of latestSnapshots) {
      const sec = hs.holding.security;
      const valueJpy = Number(hs.marketValueJpy);
      const key = `${sec.symbol}|${sec.currency}`;
      let agg = secAggMap.get(key);
      if (!agg) {
        agg = {
          secId: sec.id,
          symbol: sec.symbol,
          currency: sec.currency,
          name: sec.name,
          assetClass: sec.assetClass,
          valueJpy: 0,
          categories: sec.categories.map((c) => ({
            id: c.categoryId,
            weight: Number(c.weight),
          })),
        };
        secAggMap.set(key, agg);
      } else {
        for (const c of sec.categories) {
          if (!agg.categories.some((existing) => existing.id === c.categoryId)) {
            agg.categories.push({ id: c.categoryId, weight: Number(c.weight) });
          }
        }
      }
      agg.valueJpy += valueJpy;
    }

    const untagged: Array<{
      securityId: string;
      symbol: string;
      name: string;
      assetClass: string;
      valueJpy: number;
    }> = [];
    let untaggedJpy = 0;

    for (const sec of secAggMap.values()) {
      if (sec.assetClass === 'cash') continue;
      if (sec.categories.length === 0) {
        untagged.push({
          securityId: sec.secId,
          symbol: sec.symbol,
          name: sec.name,
          assetClass: sec.assetClass,
          valueJpy: sec.valueJpy,
        });
        untaggedJpy += sec.valueJpy;
        continue;
      }
      const prevSecValue = prevValueBySymCur.get(`${sec.symbol}|${sec.currency}`) ?? 0;
      for (const link of sec.categories) {
        const cat = catMap.get(link.id);
        if (!cat) continue;
        const weightedValue = sec.valueJpy * link.weight;
        cat.securities.push({
          securityId: sec.secId,
          symbol: sec.symbol,
          name: sec.name,
          assetClass: sec.assetClass,
          weight: link.weight,
          totalValueJpy: sec.valueJpy,
          weightedValueJpy: weightedValue,
        });
        cat.valueJpy += weightedValue;
        cat.prevValueJpy += prevSecValue * link.weight;
        cat.securityCount += 1;
      }
    }

    const categories = Array.from(catMap.values())
      .filter((c) => c.securityCount > 0)
      .map((c) => ({
        ...c,
        ratio: totalJpy > 0 ? c.valueJpy / totalJpy : 0,
        prevValueJpy: hasPrev ? c.prevValueJpy : null,
        securities: c.securities.sort((a, b) => b.weightedValueJpy - a.weightedValueJpy),
      }))
      .sort((a, b) => b.valueJpy - a.valueJpy);

    untagged.sort((a, b) => b.valueJpy - a.valueJpy);

    return {
      capturedDate: headerLatest,
      prevCapturedDate: headerPrev,
      totalJpy,
      untaggedJpy,
      categories,
      untagged,
    };
  });
}
