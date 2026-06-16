import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export function registerAccountRoutes(app: FastifyInstance): void {
  app.get('/api/accounts', async () => {
    const accounts = await prisma.account.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    // 各口座について、最新と前日の AccountSnapshot を取って、その日の
    // HoldingSnapshot を assetClass で集約 (breakdown)。
    // 「前日」は最新 capturedDate より strictly 前で最も新しい日。
    const summaries = await Promise.all(
      accounts.map(async (a) => {
        const latest = await prisma.accountSnapshot.findFirst({
          where: { accountId: a.id },
          orderBy: { capturedDate: 'desc' },
        });
        const prev = latest
          ? await prisma.accountSnapshot.findFirst({
              where: { accountId: a.id, capturedDate: { lt: latest.capturedDate } },
              orderBy: { capturedDate: 'desc' },
            })
          : null;

        async function aggregateByAssetClass(capturedDate: string): Promise<Map<string, number>> {
          const snaps = await prisma.holdingSnapshot.findMany({
            where: { capturedDate, holding: { accountId: a.id } },
            include: {
              holding: { include: { security: { select: { assetClass: true } } } },
            },
          });
          const m = new Map<string, number>();
          for (const hs of snaps) {
            const cls = hs.holding.security.assetClass;
            m.set(cls, (m.get(cls) ?? 0) + Number(hs.marketValueJpy));
          }
          return m;
        }

        const latestAgg = latest
          ? await aggregateByAssetClass(latest.capturedDate)
          : new Map<string, number>();
        const prevAgg = prev
          ? await aggregateByAssetClass(prev.capturedDate)
          : new Map<string, number>();

        const allClasses = new Set([...latestAgg.keys(), ...prevAgg.keys()]);
        const breakdown = [...allClasses]
          .map((cls) => ({
            assetClass: cls,
            valueJpy: latestAgg.get(cls) ?? 0,
            prevValueJpy: prev ? (prevAgg.get(cls) ?? 0) : null,
          }))
          .sort((x, y) => y.valueJpy - x.valueJpy);

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
          prevTotalJpy: prev ? Number(prev.totalValueJpy) : null,
          prevCapturedDate: prev ? prev.capturedDate : null,
          breakdown,
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
