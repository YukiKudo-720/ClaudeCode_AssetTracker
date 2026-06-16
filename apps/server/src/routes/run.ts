import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { DataSourceSchema } from '@asset-tracker/shared';
import { logger } from '../logger.js';
import { runAdapter, runAllAdapters } from '../worker/runAll.js';

const RunBodySchema = z.object({
  source: DataSourceSchema.optional(),
});

export function registerRunRoutes(app: FastifyInstance): void {
  // 即時スクレイピング実行。body.source 指定で 1 adapter のみ、未指定で全 adapter。
  // 非同期で走らせて 202 Accepted を返し、進捗は /api/runs で参照。
  app.post('/api/run-now', async (req, reply) => {
    const parsed = RunBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }

    if (parsed.data.source) {
      const source = parsed.data.source;
      // fire-and-forget; client polls /api/runs to see status
      void runAdapter(source).catch((err) => logger.error({ err, source }, 'run-now failed'));
      return reply.code(202).send({ status: 'queued', source });
    }

    void runAllAdapters().catch((err) => logger.error({ err }, 'run-all failed'));
    return reply.code(202).send({ status: 'queued', source: 'all' });
  });

  app.get('/api/runs', async () => {
    return prisma.scrapeRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  });

  // source ごとの同期状況サマリ。バナー / Settings の「更新状況」セクション用。
  // - latestRun: 最新 run (status 込み)
  // - latestSuccessAt: 直近 ok の startedAt (失敗続きでも以前の成功時刻を見せる)
  // - isStale: STALE_THRESHOLD_HOURS 以内に ok 完了が無ければ true
  // overall は bySource を OR で集約 (1 つでも error/stale → 'error')。
  app.get('/api/sync-status', async () => {
    const EXPECTED_SOURCES = ['moneyforward', 'webull_api', 'moomoo_api'] as const;
    const STALE_THRESHOLD_HOURS = 24;

    const since = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

    const bySource = await Promise.all(
      EXPECTED_SOURCES.map(async (source) => {
        const [latestRun, latestSuccess] = await Promise.all([
          prisma.scrapeRun.findFirst({
            where: { source },
            orderBy: { startedAt: 'desc' },
          }),
          prisma.scrapeRun.findFirst({
            where: { source, status: 'ok' },
            orderBy: { startedAt: 'desc' },
          }),
        ]);

        const isStale = !latestSuccess || latestSuccess.startedAt < since;

        return {
          source,
          latestRun: latestRun
            ? {
                id: latestRun.id,
                startedAt: latestRun.startedAt.toISOString(),
                finishedAt: latestRun.finishedAt?.toISOString() ?? null,
                status: latestRun.status,
                errorMsg: latestRun.errorMsg,
                accountsTouched: latestRun.accountsTouched,
              }
            : null,
          latestSuccessAt: latestSuccess?.startedAt.toISOString() ?? null,
          isStale,
        };
      }),
    );

    const overall = bySource.some(
      (s) => s.isStale || s.latestRun?.status === 'error' || s.latestRun?.status === 'needs_2fa',
    )
      ? 'error'
      : 'ok';

    return {
      overall,
      staleThresholdHours: STALE_THRESHOLD_HOURS,
      bySource,
    };
  });
}
