import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './env.js';
import { logger } from './logger.js';
import { bearerAuth } from './auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerRunRoutes } from './routes/run.js';
import { registerHoldingsRoutes } from './routes/holdings.js';
import { registerAllocationRoutes } from './routes/allocation.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerCategoriesRoutes } from './routes/categories.js';

async function main(): Promise<void> {
  const app = Fastify({ loggerInstance: logger });

  // CORS: PWA (別オリジン) からの fetch を許可
  // v1 は reflect-origin (リクエストの Origin をそのまま返す)、
  // production は Tailscale 経由の同一オリジン配信予定なのでこれで十分
  await app.register(cors, {
    origin: true,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  // 認証不要 (生存確認のみ)
  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // 認証必須エンドポイント
  app.register(async (instance) => {
    instance.addHook('preHandler', bearerAuth);
    registerAccountRoutes(instance);
    registerRunRoutes(instance);
    registerHoldingsRoutes(instance);
    registerAllocationRoutes(instance);
    registerHistoryRoutes(instance);
    registerCategoriesRoutes(instance);
  });

  try {
    await app.listen({ host: env.TAILSCALE_IP, port: env.PORT });
    logger.info({ host: env.TAILSCALE_IP, port: env.PORT }, 'server listening on tailnet');
  } catch (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

void main();
