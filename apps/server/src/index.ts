import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { logger } from './logger.js';
import { bearerAuth } from './auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerRunRoutes } from './routes/run.js';
import { registerHoldingsRoutes } from './routes/holdings.js';
import { registerAllocationRoutes } from './routes/allocation.js';
import { registerHistoryRoutes } from './routes/history.js';
import { registerCategoriesRoutes } from './routes/categories.js';
import { registerTodaiRoutes } from './routes/todai.js';
import { registerFxRoutes } from './routes/fx.js';
import { registerSyncRoutes } from './routes/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PWA_DIST_PATH = path.resolve(__dirname, '..', '..', 'pwa', 'dist');

async function main(): Promise<void> {
  const app = Fastify({ loggerInstance: logger });

  // CORS: PWA (別オリジン) からの fetch を許可
  // v1 は reflect-origin (リクエストの Origin をそのまま返す)、
  // production は Tailscale 経由の同一オリジン配信予定なのでこれで十分
  await app.register(cors, {
    origin: true,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
    registerTodaiRoutes(instance);
    registerFxRoutes(instance);
    registerSyncRoutes(instance);
  });

  // PWA を Fastify から静的配信 (本番モード)。
  // dist が無い場合 (PWA ビルド前 / dev で vite dev 使用中) は配信スキップ。
  // SPA ルーティング (react-router) は 404 を index.html にフォールバックして解決。
  if (existsSync(PWA_DIST_PATH)) {
    // decorateReply は明示 true (default)。404 fallback で reply.sendFile を使うため必須
    await app.register(fastifyStatic, {
      root: PWA_DIST_PATH,
      prefix: '/',
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
    logger.info({ path: PWA_DIST_PATH }, 'PWA static serving enabled');
  } else {
    logger.warn({ path: PWA_DIST_PATH }, 'PWA dist not found - static serving disabled');
  }

  try {
    await app.listen({ host: env.TAILSCALE_IP, port: env.PORT });
    logger.info({ host: env.TAILSCALE_IP, port: env.PORT }, 'server listening on tailnet');
  } catch (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

void main();
