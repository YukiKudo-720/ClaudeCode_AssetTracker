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
}
