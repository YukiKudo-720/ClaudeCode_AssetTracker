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
    return { runId: run.id, source, status, accountsTouched: 0, errorMsg: msg };
  }
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
