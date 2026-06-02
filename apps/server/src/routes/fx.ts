import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

const TTL_HOURS = 6;
const PROVIDER = 'frankfurter.app (ECB)';

// 各 (base, quote) ペアの最新レートを返す
export function registerFxRoutes(app: FastifyInstance): void {
  app.get('/api/fx/rates', async () => {
    const rows = await prisma.fxRate.findMany({
      orderBy: { capturedAt: 'desc' },
    });
    // (base, quote) ごとに最新 1 件
    const seen = new Set<string>();
    const rates = [];
    for (const r of rows) {
      const k = `${r.base}/${r.quote}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rates.push({
        base: r.base,
        quote: r.quote,
        rate: Number(r.rate),
        capturedAt: r.capturedAt.toISOString(),
        capturedDate: r.capturedDate,
      });
    }
    return { rates, ttlHours: TTL_HOURS, provider: PROVIDER };
  });
}
