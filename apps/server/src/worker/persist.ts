import type { AccountUpdate, AdapterContext } from '../adapters/types.js';
import { INSTITUTION_KIND } from '@asset-tracker/shared';

// AdapterResult を Prisma へ反映する共通ロジック。
// 機関+ラベルで Account を find-or-create、銘柄も Security を find-or-create し、
// 1 つの AccountSnapshot に紐付く HoldingSnapshot 群を書き込む。

export async function persistAccountUpdate(
  ctx: AdapterContext,
  update: AccountUpdate,
  source: string,
): Promise<{ accountId: string; snapshotId: string }> {
  const { prisma } = ctx;

  // 1. Account の find-or-create
  const account = await prisma.account.upsert({
    where: {
      // institution + label の組み合わせで一意 (将来 unique 制約を schema に追加候補)
      id: (
        await prisma.account.findFirst({
          where: { institution: update.institution, label: update.label },
          select: { id: true },
        })
      )?.id ?? '__new__',
    },
    update: { updatedAt: new Date() },
    create: {
      kind: INSTITUTION_KIND[update.institution],
      institution: update.institution,
      source,
      label: update.label,
      baseCurrency: update.baseCurrency,
      tags: '[]',
      meta: '{}',
      enabled: true,
    },
  });

  // 2. 各 Holding の Security と Holding を find-or-create
  type ResolvedHolding = {
    holdingId: string;
    quantity: number;
    marketPriceNative: number;
    marketPriceJpy: number;
    marketValueNative: number;
    marketValueJpy: number;
    avgCostNative?: number;
  };

  const resolved: ResolvedHolding[] = [];
  let holdingsValueNative = 0;

  for (const h of update.holdings) {
    const security = await prisma.security.upsert({
      where: { symbol_exchange: { symbol: h.symbol, exchange: h.exchange ?? '' } },
      update: { name: h.name, updatedAt: new Date() },
      create: {
        symbol: h.symbol,
        exchange: h.exchange ?? null,
        name: h.name,
        currency: h.currency,
        assetClass: h.assetClass,
        region: h.region ?? null,
        sector: h.sector ?? null,
      },
    });

    const holding = await prisma.holding.upsert({
      where: {
        accountId_securityId_subAccount: {
          accountId: account.id,
          securityId: security.id,
          subAccount: '',
        },
      },
      update: {},
      create: {
        accountId: account.id,
        securityId: security.id,
        subAccount: null,
      },
    });

    const fx = await ctx.getFxToJpy(h.currency);
    const marketValueNative = h.quantity * h.marketPriceNative;
    const marketValueJpy = marketValueNative * fx;
    holdingsValueNative += h.currency === update.baseCurrency
      ? marketValueNative
      : marketValueNative * (fx / (await ctx.getFxToJpy(update.baseCurrency)));

    resolved.push({
      holdingId: holding.id,
      quantity: h.quantity,
      marketPriceNative: h.marketPriceNative,
      marketPriceJpy: h.marketPriceNative * fx,
      marketValueNative,
      marketValueJpy,
      ...(h.avgCostNative !== undefined ? { avgCostNative: h.avgCostNative } : {}),
    });
  }

  // 3. AccountSnapshot 作成
  const accountFx = await ctx.getFxToJpy(update.baseCurrency);
  const totalValueNative = update.cashNative + holdingsValueNative;
  const totalValueJpy = totalValueNative * accountFx;
  const cashJpy = update.cashNative * accountFx;

  const snapshot = await prisma.accountSnapshot.create({
    data: {
      accountId: account.id,
      capturedAt: update.capturedAt,
      totalValueNative,
      totalValueJpy,
      cashNative: update.cashNative,
      cashJpy,
      fxRate: accountFx,
    },
  });

  // 4. HoldingSnapshot 群を作成
  if (resolved.length > 0) {
    await prisma.holdingSnapshot.createMany({
      data: resolved.map((r) => ({
        snapshotId: snapshot.id,
        holdingId: r.holdingId,
        quantity: r.quantity,
        marketPriceNative: r.marketPriceNative,
        marketPriceJpy: r.marketPriceJpy,
        marketValueNative: r.marketValueNative,
        marketValueJpy: r.marketValueJpy,
        ...(r.avgCostNative !== undefined ? { avgCostNative: r.avgCostNative } : {}),
      })),
    });
  }

  return { accountId: account.id, snapshotId: snapshot.id };
}
