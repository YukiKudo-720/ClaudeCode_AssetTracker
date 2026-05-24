import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

// 銘柄 (Security) 単位で全口座を跨いで集約。最新の capturedDate を採用。
// 現金 (AccountSnapshot.cashJpy) は通貨ごとに synthetic security 1 行として追加。
export function registerHoldingsRoutes(app: FastifyInstance): void {
  app.get('/api/holdings', async () => {
    const latest = await prisma.holdingSnapshot.findFirst({
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });
    if (!latest) {
      return { capturedDate: null, holdings: [] };
    }

    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: latest.capturedDate },
      include: {
        holding: {
          include: { security: true, account: true },
        },
      },
    });

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

      let agg = map.get(s.id);
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
        map.set(s.id, agg);
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
      }))
      .sort((a, b) => b.totalValueJpy - a.totalValueJpy);

    return { capturedDate: latest.capturedDate, holdings };
  });
}
