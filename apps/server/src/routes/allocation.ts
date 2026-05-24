import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const QuerySchema = z.object({
  by: z.enum(['currency', 'assetClass', 'region', 'institution']).default('assetClass'),
});

// 最新時点の資産配分。軸 (by) は currency / assetClass / region / institution。
// 現金 (assetClass='cash') も含まれる。
export function registerAllocationRoutes(app: FastifyInstance): void {
  app.get('/api/allocation', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_query', detail: parsed.error.format() });
    }
    const { by } = parsed.data;

    const latest = await prisma.accountSnapshot.findFirst({
      orderBy: { capturedDate: 'desc' },
      select: { capturedDate: true },
    });
    if (!latest) {
      return { capturedDate: null, by, totalJpy: 0, buckets: [] };
    }

    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: latest.capturedDate },
      include: {
        holding: {
          include: { security: true, account: true },
        },
      },
    });

    // 集計
    const map = new Map<string, { label: string; valueJpy: number }>();
    let totalJpy = 0;

    for (const hs of snapshots) {
      const valueJpy = Number(hs.marketValueJpy);
      totalJpy += valueJpy;

      const s = hs.holding.security;
      const a = hs.holding.account;
      let key: string;
      let label: string;
      switch (by) {
        case 'currency':
          key = s.currency;
          label = s.currency;
          break;
        case 'assetClass':
          key = s.assetClass;
          label = s.assetClass;
          break;
        case 'region':
          key = s.region ?? 'unknown';
          label = s.region ?? '未分類';
          break;
        case 'institution':
          key = a.institution;
          label = a.institution;
          break;
      }
      const cur = map.get(key) ?? { label, valueJpy: 0 };
      cur.valueJpy += valueJpy;
      map.set(key, cur);
    }

    const buckets = Array.from(map.entries())
      .map(([key, v]) => ({
        key,
        label: v.label,
        valueJpy: v.valueJpy,
        ratio: totalJpy > 0 ? v.valueJpy / totalJpy : 0,
      }))
      .sort((a, b) => b.valueJpy - a.valueJpy);

    return { capturedDate: latest.capturedDate, by, totalJpy, buckets };
  });
}
