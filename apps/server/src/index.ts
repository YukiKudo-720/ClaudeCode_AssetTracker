import Fastify from 'fastify';
import { env } from './env.js';
import { logger } from './logger.js';
import { bearerAuth } from './auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerRunRoutes } from './routes/run.js';

async function main(): Promise<void> {
  const app = Fastify({ loggerInstance: logger });

  // 認証不要 (生存確認のみ)
  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // 認証必須エンドポイント
  app.register(async (instance) => {
    instance.addHook('preHandler', bearerAuth);
    registerAccountRoutes(instance);
    registerRunRoutes(instance);
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
