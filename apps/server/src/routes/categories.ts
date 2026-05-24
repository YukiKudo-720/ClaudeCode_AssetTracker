import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

// Category 別の保有資産集計。Security に weight 付き紐付け済みの SecurityCategory を辿って
// 最新 HoldingSnapshot から評価額を計算。
// 1 銘柄が複数テーマに紐付く場合、ratio 表示には weight が効く。
export function registerCategoriesRoutes(app: FastifyInstance): void {
  app.get('/api/categories', async () => {
    const latest = await prisma.holdingSnapshot.findFirst({
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });
    if (!latest) {
      return { capturedDate: null, categories: [], untagged: [], totalJpy: 0, untaggedJpy: 0 };
    }

    // すべての Category (theme)
    const cats = await prisma.category.findMany({
      where: { kind: 'theme' },
      orderBy: { sortOrder: 'asc' },
    });

    // 最新スナップショット + security + securityCategory を全取得
    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: latest.capturedDate },
      include: {
        holding: {
          include: {
            security: { include: { categories: true } },
            account: true,
          },
        },
      },
    });

    // 全体合計 (現金含む)
    const totalJpy = snapshots.reduce((s, hs) => s + Number(hs.marketValueJpy), 0);

    // Category 別集計
    interface CatAgg {
      id: string;
      slug: string;
      name: string;
      sortOrder: number;
      securityCount: number;
      valueJpy: number;
      securities: Array<{
        securityId: string;
        symbol: string;
        name: string;
        assetClass: string;
        weight: number;
        totalValueJpy: number; // この銘柄の総評価額
        weightedValueJpy: number; // weight 適用後 (このカテゴリへの貢献)
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
        securities: [],
      });
    }

    // Security 単位に集約 (口座またぎ)
    const secAggMap = new Map<
      string,
      {
        secId: string;
        symbol: string;
        name: string;
        assetClass: string;
        valueJpy: number;
        categories: Array<{ id: string; weight: number }>;
      }
    >();
    for (const hs of snapshots) {
      const sec = hs.holding.security;
      const valueJpy = Number(hs.marketValueJpy);
      let agg = secAggMap.get(sec.id);
      if (!agg) {
        agg = {
          secId: sec.id,
          symbol: sec.symbol,
          name: sec.name,
          assetClass: sec.assetClass,
          valueJpy: 0,
          categories: sec.categories.map((c) => ({ id: c.categoryId, weight: Number(c.weight) })),
        };
        secAggMap.set(sec.id, agg);
      }
      agg.valueJpy += valueJpy;
    }

    // 未タグ銘柄 (現金除く)
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
        cat.securityCount += 1;
      }
    }

    const categories = Array.from(catMap.values())
      .filter((c) => c.securityCount > 0)
      .map((c) => ({
        ...c,
        ratio: totalJpy > 0 ? c.valueJpy / totalJpy : 0,
        securities: c.securities.sort((a, b) => b.weightedValueJpy - a.weightedValueJpy),
      }))
      .sort((a, b) => b.valueJpy - a.valueJpy);

    untagged.sort((a, b) => b.valueJpy - a.valueJpy);

    return {
      capturedDate: latest.capturedDate,
      totalJpy,
      untaggedJpy,
      categories,
      untagged,
    };
  });
}
