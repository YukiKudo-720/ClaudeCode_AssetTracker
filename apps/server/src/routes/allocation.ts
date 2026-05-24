import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const QuerySchema = z.object({
  by: z.enum(['currency', 'assetClass', 'region', 'institution']).default('assetClass'),
});

// baseCurrency → region 推定 (cash の region 軸用、銀行・証券口座の所在国とほぼ一致)
function regionFromCurrency(currency: string): string {
  switch (currency) {
    case 'JPY': return 'jp';
    case 'USD': return 'us';
    case 'HKD': return 'hk';
    case 'CNY':
    case 'CNH': return 'cn';
    case 'EUR': return 'eu';
    default: return 'other';
  }
}

// 最新時点の資産配分。軸 (by) は currency / assetClass / region / institution。
// 銀行残高や証券口座内の現金 (AccountSnapshot.cashJpy) もここで合算する。
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

    // 全体合計 = AccountSnapshot.totalValueJpy の合計 (cash + holdings 含む)
    const accountSnapshots = await prisma.accountSnapshot.findMany({
      where: { capturedDate: latest.capturedDate },
      include: { account: true },
    });
    const totalJpy = accountSnapshots.reduce((s, as) => s + Number(as.totalValueJpy), 0);

    const holdingSnapshots = await prisma.holdingSnapshot.findMany({
      where: { capturedDate: latest.capturedDate },
      include: { holding: { include: { security: true, account: true } } },
    });

    const map = new Map<string, { label: string; valueJpy: number }>();

    function add(key: string, label: string, valueJpy: number): void {
      const cur = map.get(key) ?? { label, valueJpy: 0 };
      cur.valueJpy += valueJpy;
      map.set(key, cur);
    }

    // 1. Holdings 部分の集計
    for (const hs of holdingSnapshots) {
      const valueJpy = Number(hs.marketValueJpy);
      const s = hs.holding.security;
      const a = hs.holding.account;
      switch (by) {
        case 'currency':
          add(s.currency, s.currency, valueJpy);
          break;
        case 'assetClass':
          add(s.assetClass, s.assetClass, valueJpy);
          break;
        case 'region':
          add(s.region ?? 'unknown', s.region ?? 'unknown', valueJpy);
          break;
        case 'institution':
          add(a.institution, a.institution, valueJpy);
          break;
      }
    }

    // cash は adapter 側で Holdings (assetClass='cash') として emit されるため、
    // ここで synthetic 追加は不要 (上の holdings ループで自然に集計される)

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
