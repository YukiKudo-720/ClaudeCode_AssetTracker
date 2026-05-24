import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export function registerAccountRoutes(app: FastifyInstance): void {
  app.get('/api/accounts', async () => {
    const accounts = await prisma.account.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    const summaries = await Promise.all(
      accounts.map(async (a) => {
        const latest = await prisma.accountSnapshot.findFirst({
          where: { accountId: a.id },
          orderBy: { capturedAt: 'desc' },
        });
        return {
          id: a.id,
          kind: a.kind,
          institution: a.institution,
          source: a.source,
          label: a.label,
          baseCurrency: a.baseCurrency,
          tags: JSON.parse(a.tags) as string[],
          enabled: a.enabled,
          latestTotalJpy: latest ? Number(latest.totalValueJpy) : null,
          latestCapturedAt: latest ? latest.capturedAt.toISOString() : null,
        };
      }),
    );
    return summaries;
  });

  app.get<{ Params: { id: string } }>('/api/accounts/:id', async (req, reply) => {
    const account = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!account) return reply.code(404).send({ error: 'not_found' });
    return account;
  });

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/api/accounts/:id/snapshots',
    async (req) => {
      const where: { accountId: string; capturedAt?: { gte?: Date; lte?: Date } } = {
        accountId: req.params.id,
      };
      if (req.query.from || req.query.to) {
        where.capturedAt = {};
        if (req.query.from) where.capturedAt.gte = new Date(req.query.from);
        if (req.query.to) where.capturedAt.lte = new Date(req.query.to);
      }
      return prisma.accountSnapshot.findMany({
        where,
        orderBy: { capturedAt: 'asc' },
      });
    },
  );
}
