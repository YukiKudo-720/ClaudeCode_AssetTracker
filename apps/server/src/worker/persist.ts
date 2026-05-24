import type { AccountUpdate, AdapterContext } from '../adapters/types.js';
import { INSTITUTION_KIND } from '@asset-tracker/shared';
import { toJstDateString } from '../lib/date.js';

// AdapterResult を Prisma へ反映する共通ロジック。
//
// 同日中の再 scrape は AccountSnapshot/HoldingSnapshot を上書き (capturedDate で upsert)。
// 日跨ぎは新行。過去の Holding は update に含まれなくても削除しない (履歴を残す)。

export async function persistAccountUpdate(
  ctx: AdapterContext,
  update: AccountUpdate,
  source: string,
): Promise<{ accountId: string; snapshotId: string }> {
  const { prisma } = ctx;
  const capturedDate = toJstDateString(update.capturedAt);

  // 1. Account を find-or-create ((institution, label) で一意)
  const account = await prisma.account.upsert({
    where: { institution_label: { institution: update.institution, label: update.label } },
    update: { updatedAt: new Date() },
    create: {
      kind: INSTITUTION_KIND[update.institution],
      institution: update.institution,
      source,
      label: update.label,
      baseCurrency: update.baseCurrency,
    },
  });

  // 2. 各 Holding の Security と Holding を find-or-create + HoldingSnapshot 用データ計算
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
  let holdingsValueInAccountCurrency = 0;
  const accountFx = await ctx.getFxToJpy(update.baseCurrency);

  for (const h of update.holdings) {
    // Security の upsert: exchange が nullable な複合 unique のため
    // Prisma の upsert は null をうまく扱えない (null !== '' で毎回新規作成される) →
    // findFirst + create/update のフォールバックで対処
    const exchangeValue = h.exchange ?? null;
    let security = await prisma.security.findFirst({
      where: { symbol: h.symbol, exchange: exchangeValue },
    });
    if (security) {
      security = await prisma.security.update({
        where: { id: security.id },
        data: { name: h.name, updatedAt: new Date() },
      });
    } else {
      security = await prisma.security.create({
        data: {
          symbol: h.symbol,
          exchange: exchangeValue,
          name: h.name,
          currency: h.currency,
          assetClass: h.assetClass,
          region: h.region ?? null,
          sector: h.sector ?? null,
        },
      });
    }

    // Holding は subAccount が nullable な複合 unique。Prisma の upsert が
    // null を含む where を扱いにくいので findFirst + create フォールバック
    let holding = await prisma.holding.findFirst({
      where: { accountId: account.id, securityId: security.id, subAccount: null },
    });
    if (!holding) {
      holding = await prisma.holding.create({
        data: { accountId: account.id, securityId: security.id, subAccount: null },
      });
    }

    const holdingFx = await ctx.getFxToJpy(h.currency);
    const marketValueNative = h.quantity * h.marketPriceNative;
    const marketValueJpy = marketValueNative * holdingFx;

    // 口座総額 (口座通貨ベース) に積む — クロス通貨の場合は accountFx で正規化
    holdingsValueInAccountCurrency +=
      h.currency === update.baseCurrency
        ? marketValueNative
        : marketValueJpy / accountFx;

    resolved.push({
      holdingId: holding.id,
      quantity: h.quantity,
      marketPriceNative: h.marketPriceNative,
      marketPriceJpy: h.marketPriceNative * holdingFx,
      marketValueNative,
      marketValueJpy,
      ...(h.avgCostNative !== undefined ? { avgCostNative: h.avgCostNative } : {}),
    });
  }

  // 3. AccountSnapshot を upsert ((accountId, capturedDate) で同日上書き)
  //    cash は holdings 側に統一されたので、cashJpy は assetClass='cash' の holdings 合計から計算
  let cashJpy = 0;
  for (let i = 0; i < update.holdings.length; i++) {
    if (update.holdings[i]!.assetClass === 'cash') {
      cashJpy += resolved[i]!.marketValueJpy;
    }
  }
  // update.cashNative は廃止予定 (adapter は 0 を送る) だが、後方互換のため
  // 0 でない場合は holdings に未統合な cash として加算
  const totalValueNative = update.cashNative + holdingsValueInAccountCurrency;
  const totalValueJpy = totalValueNative * accountFx;
  cashJpy += update.cashNative * accountFx;
  const cashNative = accountFx > 0 ? cashJpy / accountFx : cashJpy;

  const snapshot = await prisma.accountSnapshot.upsert({
    where: { accountId_capturedDate: { accountId: account.id, capturedDate } },
    update: {
      capturedAt: update.capturedAt,
      totalValueNative,
      totalValueJpy,
      cashNative,
      cashJpy,
      fxRate: accountFx,
    },
    create: {
      accountId: account.id,
      capturedAt: update.capturedAt,
      capturedDate,
      totalValueNative,
      totalValueJpy,
      cashNative,
      cashJpy,
      fxRate: accountFx,
    },
  });

  // 4. HoldingSnapshot を各 holding ごとに upsert ((holdingId, capturedDate))
  //    今 update に含まれない過去の Holding の Snapshot には触らない (履歴保持)
  for (const r of resolved) {
    await prisma.holdingSnapshot.upsert({
      where: { holdingId_capturedDate: { holdingId: r.holdingId, capturedDate } },
      update: {
        snapshotId: snapshot.id,
        quantity: r.quantity,
        marketPriceNative: r.marketPriceNative,
        marketPriceJpy: r.marketPriceJpy,
        marketValueNative: r.marketValueNative,
        marketValueJpy: r.marketValueJpy,
        ...(r.avgCostNative !== undefined ? { avgCostNative: r.avgCostNative } : {}),
      },
      create: {
        snapshotId: snapshot.id,
        holdingId: r.holdingId,
        capturedDate,
        quantity: r.quantity,
        marketPriceNative: r.marketPriceNative,
        marketPriceJpy: r.marketPriceJpy,
        marketValueNative: r.marketValueNative,
        marketValueJpy: r.marketValueJpy,
        ...(r.avgCostNative !== undefined ? { avgCostNative: r.avgCostNative } : {}),
      },
    });
  }

  return { accountId: account.id, snapshotId: snapshot.id };
}
