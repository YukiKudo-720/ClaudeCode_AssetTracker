import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

// 銘柄 (Security) 単位で全口座を跨いで集約。最新の capturedDate を採用。
// prev 比較用に、最新より前の最新 capturedDate も別途取得して per-security 集計。
export function registerHoldingsRoutes(app: FastifyInstance): void {
  app.get('/api/holdings', async () => {
    const latest = await prisma.holdingSnapshot.findFirst({
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });
    if (!latest) {
      return { capturedDate: null, prevCapturedDate: null, holdings: [] };
    }

    // 直前の日 (= 最新 capturedDate より strictly 前で最も新しい日)
    const prev = await prisma.holdingSnapshot.findFirst({
      where: { capturedDate: { lt: latest.capturedDate } },
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });

    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: latest.capturedDate },
      include: {
        holding: {
          include: { security: true, account: true },
        },
      },
    });

    // 前日 snapshot を (symbol, currency) -> sum(marketValueJpy) でマップ化。
    // securityId ではなく (symbol, currency) を key にするのは、adapter ごとの exchange 表記差で
    // Security が割れて 2 行になる事故 (e.g. MVLL が SBI/MF=null, Webull='NASDAQ') を吸収するため。
    const prevValueBySymCur = new Map<string, number>();
    if (prev) {
      const prevSnapshots = await prisma.holdingSnapshot.findMany({
        where: { capturedDate: prev.capturedDate },
        include: {
          holding: {
            include: { security: { select: { symbol: true, currency: true } } },
          },
        },
      });
      for (const ps of prevSnapshots) {
        const sec = ps.holding.security;
        const key = `${sec.symbol}|${sec.currency}`;
        const v = Number(ps.marketValueJpy);
        prevValueBySymCur.set(key, (prevValueBySymCur.get(key) ?? 0) + v);
      }
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

    // canonical (= 最古) を先に確定させるため Security.createdAt 昇順でソート。
    // 後続イテレーションで最初に登録された Security のメタデータが採用される。
    snapshots.sort(
      (x, y) =>
        x.holding.security.createdAt.getTime() - y.holding.security.createdAt.getTime(),
    );

    const map = new Map<string, Agg>();
    for (const hs of snapshots) {
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

    // cash は adapter 側で Holdings (assetClass='cash') として emit 済みなので、
    // ここで synthetic 追加する必要は無い

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
      capturedDate: latest.capturedDate,
      prevCapturedDate: prev?.capturedDate ?? null,
      holdings,
    };
  });
}
