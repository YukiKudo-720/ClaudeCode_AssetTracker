import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const QuerySchema = z.object({
  // 表示期間 (日数)
  days: z.coerce.number().int().positive().max(3650).default(90),
});

// 全口座合算の総資産推移。日単位 (capturedDate)。
export function registerHistoryRoutes(app: FastifyInstance): void {
  app.get('/api/history/total', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', detail: parsed.error.format() });
    }
    const { days } = parsed.data;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceStr = since.toISOString().slice(0, 10);

    const grouped = await prisma.accountSnapshot.groupBy({
      by: ['capturedDate'],
      where: { capturedDate: { gte: sinceStr } },
      _sum: { totalValueJpy: true, cashJpy: true },
      orderBy: { capturedDate: 'asc' },
    });

    return {
      points: grouped.map((g) => ({
        date: g.capturedDate,
        totalJpy: Number(g._sum.totalValueJpy ?? 0),
        cashJpy: Number(g._sum.cashJpy ?? 0),
      })),
    };
  });
}
