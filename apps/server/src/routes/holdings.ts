import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

// 銘柄 (Security) 単位で全口座を跨いで集約。
// 各 holding ごとに最新 marketDate (= 銘柄ごとの「市場の今日」) と前日 marketDate の値を使う。
// 日本株は JST 24:00 区切り、米株は JST 06:00 区切りなので、
// 日本株と米株で最新 marketDate がずれることがある (それぞれ独立した「1 日」で正常)。
//
// 表示用の capturedDate / prevCapturedDate は全 holding 最新 marketDate の最大値 / 次最大値を返す。
export function registerHoldingsRoutes(app: FastifyInstance): void {
  app.get('/api/holdings', async () => {
    // 直近 14 日に絞って holding ごとの latest/prev を抽出。集計対象なら十分なマージン。
    const sinceMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const sinceStr = new Date(sinceMs).toISOString().slice(0, 10);

    const all = await prisma.holdingSnapshot.findMany({
      where: { marketDate: { gte: sinceStr } },
      include: { holding: { include: { security: true, account: true } } },
      orderBy: { marketDate: 'desc' },
    });
    if (all.length === 0) {
      return { capturedDate: null, prevCapturedDate: null, holdings: [] };
    }

    // holdingId ごとに [latest, prev, ...] (marketDate 降順)
    const byHolding = new Map<string, typeof all>();
    for (const hs of all) {
      const arr = byHolding.get(hs.holdingId) ?? [];
      arr.push(hs);
      byHolding.set(hs.holdingId, arr);
    }

    type Acc = {
      accountId: string;
      institution: string;
      label: string;
      quantity: number;
      valueJpy: number;
      avgCostNative: number | null;
    };
    type Agg = {
      securityId: string;
      symbol: string;
      name: string;
      exchange: string | null;
      currency: string;
      assetClass: string;
      region: string | null;
      sector: string | null;
      totalQuantity: number;
      totalValueJpy: number;
      totalCostJpy: number;
      accounts: Acc[];
    };

    // 全 holding の最新分を Security.createdAt 昇順で並べる (canonical 確定のため)
    const latestList = [...byHolding.values()]
      .map((arr) => arr[0]!)
      .filter(Boolean)
      .sort(
        (x, y) =>
          x.holding.security.createdAt.getTime() - y.holding.security.createdAt.getTime(),
      );

    // 表示用日付: 全 holding 最新 marketDate の最大 / 次最大
    const latestDateSet = new Set(latestList.map((hs) => hs.marketDate));
    const allDatesDesc = [...latestDateSet].sort().reverse();
    const headerLatest = allDatesDesc[0] ?? null;
    const headerPrev = allDatesDesc[1] ?? null;

    // 前日値マップ (symbol, currency) → sum(marketValueJpy)
    const prevValueBySymCur = new Map<string, number>();
    for (const arr of byHolding.values()) {
      const prev = arr[1];
      if (!prev) continue;
      const s = prev.holding.security;
      const key = `${s.symbol}|${s.currency}`;
      prevValueBySymCur.set(
        key,
        (prevValueBySymCur.get(key) ?? 0) + Number(prev.marketValueJpy),
      );
    }

    const map = new Map<string, Agg>();
    for (const hs of latestList) {
      const s = hs.holding.security;
      const a = hs.holding.account;
      const qty = Number(hs.quantity);
      const valueJpy = Number(hs.marketValueJpy);
      const avgCostNative = hs.avgCostNative != null ? Number(hs.avgCostNative) : null;
      const priceNative = Number(hs.marketPriceNative);
      const fx = qty > 0 && priceNative > 0 ? valueJpy / (qty * priceNative) : 1;
      const costJpy = avgCostNative != null ? avgCostNative * qty * fx : 0;

      const key = `${s.symbol}|${s.currency}`;
      let agg = map.get(key);
      if (!agg) {
        agg = {
          securityId: s.id,
          symbol: s.symbol,
          name: s.name,
          exchange: s.exchange,
          currency: s.currency,
          assetClass: s.assetClass,
          region: s.region,
          sector: s.sector,
          totalQuantity: 0,
          totalValueJpy: 0,
          totalCostJpy: 0,
          accounts: [],
        };
        map.set(key, agg);
      }
      agg.totalQuantity += qty;
      agg.totalValueJpy += valueJpy;
      agg.totalCostJpy += costJpy;
      agg.accounts.push({
        accountId: a.id,
        institution: a.institution,
        label: a.label,
        quantity: qty,
        valueJpy,
        avgCostNative,
      });
    }

    const holdings = Array.from(map.values())
      .map((h) => ({
        ...h,
        unrealizedPnlJpy: h.totalCostJpy > 0 ? h.totalValueJpy - h.totalCostJpy : null,
        unrealizedPnlRatio:
          h.totalCostJpy > 0 ? (h.totalValueJpy - h.totalCostJpy) / h.totalCostJpy : null,
        prevTotalValueJpy: prevValueBySymCur.get(`${h.symbol}|${h.currency}`) ?? null,
      }))
      .sort((a, b) => b.totalValueJpy - a.totalValueJpy);

    return {
      capturedDate: headerLatest,
      prevCapturedDate: headerPrev,
      holdings,
    };
  });
}
