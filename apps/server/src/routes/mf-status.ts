import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

// PC の mf-orchestrate.ts が check-status 結果を Pi に POST する用の endpoint。
// 既存の MfAccountStatus 行を機関ごとに upsert (institution が primary key)。

const PostBodySchema = z.object({
  phase: z.string(), // 'A' | 'B'
  checkedAt: z.string(),
  accounts: z.array(
    z.object({
      name: z.string(),
      inProgress: z.boolean(),
      error: z.boolean(),
      errorMessage: z.string().nullable(),
      lastUpdated: z.string().nullable(),
    }),
  ),
});

export function registerMfStatusRoutes(app: FastifyInstance): void {
  app.post('/api/mf-status', async (req, reply) => {
    const parsed = PostBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }
    const { phase, checkedAt, accounts } = parsed.data;
    const checked = new Date(checkedAt);
    // フィルタが厳格化されたため、受信リストに含まれない古いレコード (トラッキング
    // 対象外の機関) は削除して綺麗に保つ (リスト全置換セマンティクス)。
    const receivedNames = accounts.map((a) => a.name);
    await prisma.mfAccountStatus.deleteMany({
      where: { institution: { notIn: receivedNames } },
    });
    for (const a of accounts) {
      await prisma.mfAccountStatus.upsert({
        where: { institution: a.name },
        update: {
          inProgress: a.inProgress,
          hasError: a.error,
          errorMessage: a.errorMessage,
          lastUpdated: a.lastUpdated,
          checkedAt: checked,
          phase,
        },
        create: {
          institution: a.name,
          inProgress: a.inProgress,
          hasError: a.error,
          errorMessage: a.errorMessage,
          lastUpdated: a.lastUpdated,
          checkedAt: checked,
          phase,
        },
      });
    }
    return { ok: true, count: accounts.length };
  });

  // PWA 表示用。最新スナップショットを institution 順で返す。
  app.get('/api/mf-status', async () => {
    const rows = await prisma.mfAccountStatus.findMany({
      orderBy: { institution: 'asc' },
    });
    return {
      checkedAt: rows[0]?.checkedAt.toISOString() ?? null,
      accounts: rows.map((r) => ({
        institution: r.institution,
        inProgress: r.inProgress,
        hasError: r.hasError,
        errorMessage: r.errorMessage,
        lastUpdated: r.lastUpdated,
        checkedAt: r.checkedAt.toISOString(),
        phase: r.phase,
      })),
    };
  });
}
