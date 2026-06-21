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
  // ratio = 評価額騰落率 (%) [株数変動の影響を含む]
  // price_ratio = 単価騰落率 (%) [純粋な株価の動き]
  // amount = 騰落額 (¥), value = 評価額 (¥)
  sortBy: z.enum(['ratio', 'price_ratio', 'amount', 'value']).default('ratio'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  accountId: z.string().optional(),
  // assetClass フィルタ (stock / etf / mutual_fund / reit / bond / crypto / commodity / fx / other)
  assetClass: z.string().optional(),
  // 比較基準日 (YYYY-MM-DD)。未指定 = 各 holding の最新 marketDate。
  // 指定時はその日以前で最新のスナップショットを「当日」とし、それより前を「前日」として比較。
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export function registerRankingRoutes(app: FastifyInstance): void {
  app.get('/api/ranking', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', detail: parsed.error.format() });
    }
    const { sortBy, dir, accountId, assetClass, date } = parsed.data;

    // 注: HoldingSnapshot の where では holding が 1 つの object なので、
    // accountId と assetClass を同時に絞るには holding 内でマージする必要がある。
    const holdingWhere: { accountId?: string; security?: { assetClass: string } } = {};
    if (accountId) holdingWhere.accountId = accountId;
    if (assetClass) holdingWhere.security = { assetClass };
    const where = Object.keys(holdingWhere).length > 0 ? { holding: holdingWhere } : {};

    // 直近 14 日のスナップショットを集めて、holdingId ごとに最新 marketDate と前日 marketDate を抽出。
    // 日本株と米株で「1 日」がずれていても銘柄ごとに独立した前日比が出る。
    const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const sinceStr = new Date(sinceMs).toISOString().slice(0, 10);
    const all = await prisma.holdingSnapshot.findMany({
      where: { marketDate: { gte: sinceStr }, ...where },
      include: {
        holding: {
          include: {
            security: { include: { categories: { include: { category: true } } } },
            account: true,
          },
        },
      },
      orderBy: { marketDate: 'desc' },
    });
    if (all.length === 0) {
      return { capturedDate: null, prevCapturedDate: null, items: [] };
    }
    const byHolding = new Map<string, typeof all>();
    for (const hs of all) {
      const arr = byHolding.get(hs.holdingId) ?? [];
      arr.push(hs);
      byHolding.set(hs.holdingId, arr);
    }

    // 各 holding ごとに「target 以前で最新」を today、それより前を prev として選定。
    // date 未指定なら今までと同じ (最新 + 前日)。
    const todaySnaps: typeof all = [];
    const prevSnaps: typeof all = [];
    for (const arr of byHolding.values()) {
      if (date) {
        const idx = arr.findIndex((hs) => hs.marketDate <= date);
        if (idx < 0) continue; // 指定日以前のスナップショット無し
        const today = arr[idx];
        const prev = arr[idx + 1];
        if (today) todaySnaps.push(today);
        if (prev) prevSnaps.push(prev);
      } else {
        if (arr[0]) todaySnaps.push(arr[0]);
        if (arr[1]) prevSnaps.push(arr[1]);
      }
    }
    if (todaySnaps.length === 0) {
      return { capturedDate: null, prevCapturedDate: null, items: [] };
    }
    const latestDateSet = new Set(todaySnaps.map((hs) => hs.marketDate));
    const allDatesDesc = [...latestDateSet].sort().reverse();
    const headerLatest = allDatesDesc[0] ?? null;
    const prevDateSet = new Set(prevSnaps.map((hs) => hs.marketDate));
    const prevDatesDesc = [...prevDateSet].sort().reverse();
    const headerPrev = prevDatesDesc[0] ?? null;

    type Agg = {
      securityId: string;
      symbol: string;
      name: string;
      currency: string;
      assetClass: string;
      totalValueJpy: number;
      // (symbol, currency) の代表単価 (= 最初に出会った HoldingSnapshot の値)。
      // 同銘柄を別口座で持っていても adapter が同じなら同値、別 adapter でも
      // 通常は同じ price になるので「最初の 1 つ」で十分。
      todayPriceNative: number | null;
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
          todayPriceNative: Number(hs.marketPriceNative),
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
    // 同時に (symbol, currency) → 代表単価 もマップ化 (最初に出会った 1 つを採用)
    const prevMap = new Map<string, number>();
    const prevPriceMap = new Map<string, number>();
    for (const hs of prevSnaps) {
      const s = hs.holding.security;
      const key = `${s.symbol}|${s.currency}`;
      prevMap.set(key, (prevMap.get(key) ?? 0) + Number(hs.marketValueJpy));
      if (!prevPriceMap.has(key)) {
        prevPriceMap.set(key, Number(hs.marketPriceNative));
      }
    }

    const items = [...map.values()].map((a) => {
      const key = `${a.symbol}|${a.currency}`;
      const prevValueJpy = prevMap.get(key) ?? 0;
      const diffJpy = prevValueJpy > 0 ? a.totalValueJpy - prevValueJpy : 0;
      const diffRatio = prevValueJpy > 0 ? diffJpy / prevValueJpy : null;
      // 単価ベース騰落率: 株数の影響を除いた純粋な株価の動き
      const prevPriceNative = prevPriceMap.get(key) ?? null;
      const priceDiffRatio =
        a.todayPriceNative != null && prevPriceNative != null && prevPriceNative > 0
          ? (a.todayPriceNative - prevPriceNative) / prevPriceNative
          : null;
      const hasPrev = prevValueJpy > 0;
      return {
        securityId: a.securityId,
        symbol: a.symbol,
        name: a.name,
        currency: a.currency,
        assetClass: a.assetClass,
        totalValueJpy: a.totalValueJpy,
        prevValueJpy: hasPrev ? prevValueJpy : null,
        diffJpy,
        diffRatio,
        priceDiffRatio,
        accounts: a.accounts,
        categories: a.categories,
      };
    });

    items.sort((x, y) => {
      if (sortBy === 'ratio') {
        // ratio は null を末尾に寄せる
        const xr = x.diffRatio ?? -Infinity;
        const yr = y.diffRatio ?? -Infinity;
        return xr - yr;
      }
      if (sortBy === 'price_ratio') {
        const xr = x.priceDiffRatio ?? -Infinity;
        const yr = y.priceDiffRatio ?? -Infinity;
        return xr - yr;
      }
      if (sortBy === 'value') return x.totalValueJpy - y.totalValueJpy;
      return x.diffJpy - y.diffJpy;
    });
    if (dir === 'desc') items.reverse();

    return {
      capturedDate: headerLatest,
      prevCapturedDate: headerPrev,
      items,
    };
  });
}
