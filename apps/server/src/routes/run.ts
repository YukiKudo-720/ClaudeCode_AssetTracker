import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { DataSourceSchema } from '@asset-tracker/shared';
import { logger } from '../logger.js';

const RunBodySchema = z.object({
  source: DataSourceSchema.optional(),
});

export function registerRunRoutes(app: FastifyInstance): void {
  app.post('/api/run-now', async (req, reply) => {
    const parsed = RunBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }
    const source = parsed.data.source ?? 'moneyforward';

    // TODO: ここで Worker キューに投入 (実装は後続フェーズ)
    logger.warn({ source }, 'run-now invoked but worker not implemented yet');

    const run = await prisma.scrapeRun.create({
      data: { source, status: 'running' },
    });

    return reply.code(202).send({ runId: run.id, status: 'queued', source });
  });

  app.get('/api/runs', async () => {
    return prisma.scrapeRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  });
}
