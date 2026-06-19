import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

// 当日 (= 最新 capturedDate) と前日の HoldingSnapshot を (symbol, currency) で集約し、
// 騰落額 / 騰落率でランキング。口座 (accountId) とテーマ (categoryId) でフィルタ可能。
//
// 並び替え:
//   sortBy=ratio: 騰落率順 (デフォルト)、sortBy=amount: 騰落額順
//   dir=desc: 大きい順 (デフォルト)、dir=asc: 小さい順
//
// cash は除外 (騰落率の概念が無い)。

const QuerySchema = z.object({
  sortBy: z.enum(['ratio', 'amount']).default('ratio'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
});

export function registerRankingRoutes(app: FastifyInstance): void {
  app.get('/api/ranking', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', detail: parsed.error.format() });
    }
    const { sortBy, dir, accountId, categoryId } = parsed.data;

    const latest = await prisma.holdingSnapshot.findFirst({
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });
    if (!latest) {
      return { capturedDate: null, prevCapturedDate: null, items: [] };
    }
    const prev = await prisma.holdingSnapshot.findFirst({
      where: { capturedDate: { lt: latest.capturedDate } },
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });

    const where = {
      ...(accountId ? { holding: { accountId } } : {}),
      ...(categoryId
        ? { holding: { security: { categories: { some: { categoryId } } } } }
        : {}),
    };

    const [todaySnaps, prevSnaps] = await Promise.all([
      prisma.holdingSnapshot.findMany({
        where: { capturedDate: latest.capturedDate, ...where },
        include: {
          holding: {
            include: {
              security: { include: { categories: { include: { category: true } } } },
              account: true,
            },
          },
        },
      }),
      prev
        ? prisma.holdingSnapshot.findMany({
            where: { capturedDate: prev.capturedDate, ...where },
            include: {
              holding: {
                include: { security: { select: { symbol: true, currency: true } } },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    type Agg = {
      securityId: string;
      symbol: string;
      name: string;
      currency: string;
      assetClass: string;
      totalValueJpy: number;
      accounts: Array<{ institution: string; label: string }>;
      categories: Array<{ id: string; name: string }>;
    };

    // canonical (= 最古) を先に決めるため createdAt asc でソート
    todaySnaps.sort(
      (a, b) =>
        a.holding.security.createdAt.getTime() - b.holding.security.createdAt.getTime(),
    );

    const map = new Map<string, Agg>();
    for (const hs of todaySnaps) {
      const s = hs.holding.security;
      if (s.assetClass === 'cash') continue;
      const key = `${s.symbol}|${s.currency}`;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          securityId: s.id,
          symbol: s.symbol,
          name: s.name,
          currency: s.currency,
          assetClass: s.assetClass,
          totalValueJpy: 0,
          accounts: [],
          categories: s.categories.map((c) => ({ id: c.categoryId, name: c.category.name })),
        };
        map.set(key, agg);
      } else {
        // 同 (symbol, currency) の重複 Security: タグを union
        for (const c of s.categories) {
          if (!agg.categories.some((existing) => existing.id === c.categoryId)) {
            agg.categories.push({ id: c.categoryId, name: c.category.name });
          }
        }
      }
      agg.totalValueJpy += Number(hs.marketValueJpy);
      const a = hs.holding.account;
      if (!agg.accounts.some((x) => x.institution === a.institution && x.label === a.label)) {
        agg.accounts.push({ institution: a.institution, label: a.label });
      }
    }

    // 前日 snapshot を (symbol, currency) → sum(jpy) でマップ化
    const prevMap = new Map<string, number>();
    for (const hs of prevSnaps) {
      const s = hs.holding.security;
      const key = `${s.symbol}|${s.currency}`;
      prevMap.set(key, (prevMap.get(key) ?? 0) + Number(hs.marketValueJpy));
    }

    const items = [...map.values()].map((a) => {
      const prevValueJpy = prevMap.get(`${a.symbol}|${a.currency}`) ?? 0;
      const diffJpy = prevValueJpy > 0 ? a.totalValueJpy - prevValueJpy : 0;
      const diffRatio = prevValueJpy > 0 ? diffJpy / prevValueJpy : null;
      return {
        securityId: a.securityId,
        symbol: a.symbol,
        name: a.name,
        currency: a.currency,
        assetClass: a.assetClass,
        totalValueJpy: a.totalValueJpy,
        prevValueJpy: prev ? prevValueJpy : null,
        diffJpy,
        diffRatio,
        accounts: a.accounts,
        categories: a.categories,
      };
    });

    items.sort((x, y) => {
      // ratio は null を末尾に寄せる
      if (sortBy === 'ratio') {
        const xr = x.diffRatio ?? -Infinity;
        const yr = y.diffRatio ?? -Infinity;
        return xr - yr;
      }
      return x.diffJpy - y.diffJpy;
    });
    if (dir === 'desc') items.reverse();

    return {
      capturedDate: latest.capturedDate,
      prevCapturedDate: prev?.capturedDate ?? null,
      items,
    };
  });
}
