import type { DataSource } from '@asset-tracker/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { createFxCache } from '../fx.js';
import { moneyforwardAdapter } from '../adapters/moneyforward/index.js';
import { moomooAdapter } from '../adapters/moomoo/index.js';
import { webullAdapter } from '../adapters/webull/index.js';
import { env } from '../env.js';
import { postSync } from '../sync-client.js';
import type { Adapter, AdapterContext } from '../adapters/types.js';
import { NeedsLoginError } from '../adapters/types.js';
import { persistAccountUpdate } from './persist.js';
import { toJstDateString, toMarketDateString } from '../lib/date.js';

const ADAPTERS: Record<DataSource, Adapter | null> = {
  moneyforward: moneyforwardAdapter,
  webull_api: webullAdapter,
  moomoo_api: moomooAdapter,
  direct_scrape: null,
  manual: null,
};

export interface RunResult {
  runId: string;
  source: DataSource;
  status: 'ok' | 'error' | 'needs_2fa';
  accountsTouched: number;
  errorMsg?: string;
}

/** 1 つの adapter を走らせる。冪等性のため事前に ScrapeRun を作って ID を渡す */
export async function runAdapter(source: DataSource): Promise<RunResult> {
  const adapter = ADAPTERS[source];
  if (!adapter) {
    throw new Error(`adapter not implemented: ${source}`);
  }

  const run = await prisma.scrapeRun.create({
    data: { source, status: 'running' },
  });

  const ctx: AdapterContext = {
    prisma,
    logger: logger.child({ source }),
    getFxToJpy: createFxCache(logger.child({ source })),
  };

  try {
    const result = await adapter.run(ctx);
    let touched = 0;
    for (const update of result.accountUpdates) {
      await persistAccountUpdate(ctx, update, source);
      touched += 1;
    }
    // SYNC_TARGET 設定があれば Pi (or 他ホスト) にも同期。失敗してもローカル
    // persist は完了しているので run 自体は成功扱い (warn ログのみ)
    if (env.SYNC_TARGET && result.accountUpdates.length > 0) {
      try {
        await postSync({
          target: env.SYNC_TARGET,
          token: env.ASSET_TRACKER_TOKEN,
          source,
          accountUpdates: result.accountUpdates,
          logger: ctx.logger,
        });
        ctx.logger.info({ syncedTo: env.SYNC_TARGET, count: result.accountUpdates.length }, 'synced to remote');
      } catch (syncErr) {
        ctx.logger.warn({ err: syncErr, syncTarget: env.SYNC_TARGET }, 'remote sync failed (local persist succeeded)');
      }
    }
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: 'ok', finishedAt: new Date(), accountsTouched: touched },
    });
    return { runId: run.id, source, status: 'ok', accountsTouched: touched };
  } catch (err) {
    const status = err instanceof NeedsLoginError ? 'needs_2fa' : 'error';
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), errorMsg: msg },
    });
    logger.error({ err, source }, 'adapter run failed');

    // adapter 失敗時の carry-over: その source の Account について、当日
    // AccountSnapshot が無いものを前日値で埋める。失敗が続く間も前日比が
    // 連続性を保てる (= 「Webull 復活で +80 万」みたいな誤差分を防ぐ)。
    try {
      const copied = await carryOverFailedSource(source);
      if (copied > 0) {
        logger.info({ source, copied }, 'carried over from previous day after adapter failure');
      }
    } catch (carryErr) {
      logger.warn({ err: carryErr, source }, 'carry-over failed (non-fatal)');
    }

    return { runId: run.id, source, status, accountsTouched: 0, errorMsg: msg };
  }
}

// adapter 失敗時に、その source に紐づく enabled Account のうち当日 snapshot が
// 無いものを前日値でコピーする。返り値はコピーした Account 数。
//
// 銘柄レベルの注意: 「売って 0 になった」を口座成功時の差分で表現するため、
// 失敗 → carry-over でだけ前日 HoldingSnapshot を当日にコピーする。adapter が
// 成功した日は通常通り persist が当日 upsert するので、消えた銘柄は自然に 0 になる。
async function carryOverFailedSource(source: DataSource): Promise<number> {
  const today = toJstDateString(new Date());
  const accounts = await prisma.account.findMany({
    where: { enabled: true, source },
  });

  let copied = 0;
  for (const a of accounts) {
    // 既に当日 snapshot がある (= 別経路や同日内の別 run で更新済み) → 触らない
    const existing = await prisma.accountSnapshot.findUnique({
      where: { accountId_capturedDate: { accountId: a.id, capturedDate: today } },
    });
    if (existing) continue;

    const prev = await prisma.accountSnapshot.findFirst({
      where: { accountId: a.id, capturedDate: { lt: today } },
      orderBy: { capturedDate: 'desc' },
    });
    if (!prev) continue; // 履歴自体ゼロ → 復元元無し

    const newSnap = await prisma.accountSnapshot.create({
      data: {
        accountId: a.id,
        capturedAt: new Date(),
        capturedDate: today,
        totalValueNative: prev.totalValueNative,
        totalValueJpy: prev.totalValueJpy,
        cashNative: prev.cashNative,
        cashJpy: prev.cashJpy,
        fxRate: prev.fxRate,
      },
    });

    // 前日 (= prev.capturedDate) の HoldingSnapshot を holding 単位で取り、
    // 当日の marketDate (region 別) で upsert する。日本株は JST 9h ベース、
    // 米株は ET ベースなので、carry-over でも marketDate が銘柄ごとに正しく入る。
    const prevHoldings = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: prev.capturedDate, holding: { accountId: a.id } },
      include: { holding: { include: { security: { select: { region: true } } } } },
    });
    const now = new Date();
    for (const hs of prevHoldings) {
      const region = hs.holding.security.region;
      const marketDate = toMarketDateString(now, region);
      // 当日の marketDate に既に snapshot がある (= 別経路で更新済み) なら触らない
      const existed = await prisma.holdingSnapshot.findUnique({
        where: { holdingId_marketDate: { holdingId: hs.holdingId, marketDate } },
      });
      if (existed) continue;
      await prisma.holdingSnapshot.create({
        data: {
          snapshotId: newSnap.id,
          holdingId: hs.holdingId,
          capturedDate: today,
          marketDate,
          quantity: hs.quantity,
          marketPriceNative: hs.marketPriceNative,
          marketPriceJpy: hs.marketPriceJpy,
          marketValueNative: hs.marketValueNative,
          marketValueJpy: hs.marketValueJpy,
          ...(hs.avgCostNative != null ? { avgCostNative: hs.avgCostNative } : {}),
        },
      });
    }
    copied += 1;
  }
  return copied;
}

/** すべての enabled な source を順次実行 */
export async function runAllAdapters(): Promise<RunResult[]> {
  const results: RunResult[] = [];
  for (const source of Object.keys(ADAPTERS) as DataSource[]) {
    if (!ADAPTERS[source]) continue;
    results.push(await runAdapter(source));
  }
  return results;
}
