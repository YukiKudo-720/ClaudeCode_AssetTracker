import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DataSourceSchema, INSTITUTION_KIND, type Institution } from '@asset-tracker/shared';
import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { createFxCache } from '../fx.js';
import { persistAccountUpdate } from '../worker/persist.js';
import type { AccountUpdate, AdapterContext } from '../adapters/types.js';

// 他ホスト (PC 等) から scrape 結果を受け取って persist するエンドポイント。
// 主用途: PC で MF/moomoo scrape → Pi 側にデータ反映。
// PC scrape-all は SYNC_TARGET 環境変数を見て、ここに POST する。

const HoldingUpdateSchema = z.object({
  symbol: z.string(),
  exchange: z.string().optional(),
  name: z.string(),
  currency: z.string(),
  assetClass: z.string(),
  region: z.string().optional(),
  sector: z.string().optional(),
  quantity: z.number(),
  marketPriceNative: z.number(),
  avgCostNative: z.number().optional(),
});

const AccountUpdateSchema = z.object({
  institution: z.string(),
  kind: z.string().optional(),
  label: z.string(),
  capturedAt: z.string().datetime(),
  baseCurrency: z.string(),
  cashNative: z.number(),
  holdings: z.array(HoldingUpdateSchema),
});

const SyncBodySchema = z.object({
  source: DataSourceSchema,
  accountUpdates: z.array(AccountUpdateSchema),
});

export function registerSyncRoutes(app: FastifyInstance): void {
  app.post('/api/sync', async (req, reply) => {
    const parsed = SyncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.format() });
    }
    const { source, accountUpdates } = parsed.data;

    const ctx: AdapterContext = {
      prisma,
      logger: logger.child({ source, mode: 'sync' }),
      getFxToJpy: createFxCache(logger),
    };

    // PC 側で作られた ScrapeRun と等価な行を Pi 側にも残しておくと、SyncIndicator
    // (/api/runs ベース) が最新 sync の時刻を表示できる。失敗時の status='error' は
    // 持たない (PC 側が成功してから sync POST するため、ここに到達 = 成功扱い)。
    const run = await prisma.scrapeRun.create({
      data: { source, status: 'running' },
    });

    let touched = 0;
    for (const upd of accountUpdates) {
      // institution は Institution 型として再キャスト (zod では string にしてある)
      // kind の validate は persistAccountUpdate 側で INSTITUTION_KIND fallback も行うので緩く扱う
      const update: AccountUpdate = {
        institution: upd.institution as Institution,
        ...(upd.kind ? { kind: upd.kind as AccountUpdate['kind'] } : {}),
        label: upd.label,
        capturedAt: new Date(upd.capturedAt),
        baseCurrency: upd.baseCurrency,
        cashNative: upd.cashNative,
        holdings: upd.holdings.map((h) => ({
          symbol: h.symbol,
          ...(h.exchange ? { exchange: h.exchange } : {}),
          name: h.name,
          currency: h.currency,
          assetClass: h.assetClass as AccountUpdate['holdings'][number]['assetClass'],
          ...(h.region ? { region: h.region as AccountUpdate['holdings'][number]['region'] } : {}),
          ...(h.sector ? { sector: h.sector } : {}),
          quantity: h.quantity,
          marketPriceNative: h.marketPriceNative,
          ...(h.avgCostNative != null ? { avgCostNative: h.avgCostNative } : {}),
        })),
      };
      // institution が INSTITUTION_KIND にない値だと fallback で undefined。基本ありえないが念のため。
      if (!update.kind && !INSTITUTION_KIND[update.institution]) {
        ctx.logger.warn({ institution: update.institution }, 'unknown institution, skip');
        continue;
      }
      await persistAccountUpdate(ctx, update, source);
      touched += 1;
    }

    await prisma.scrapeRun.update({
      where: { id: run.id },
      data: { status: 'ok', finishedAt: new Date(), accountsTouched: touched },
    });

    ctx.logger.info({ source, touched, runId: run.id }, 'sync persist complete');
    return { ok: true, source, touched };
  });
}
