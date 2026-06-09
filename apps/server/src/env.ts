import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// project root の .env を明示的にロード (cwd 依存だと apps/server から起動時に拾えない)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

// Playwright のブラウザ cache をプロジェクトローカルに固定。
// playwright モジュールがロードされる前に env var を立てる必要があるので、
// ここ (env.ts) で行う — env.ts は必ず entry point の最上流で import される前提。
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(repoRoot, 'data', 'playwright-cache');

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ASSET_TRACKER_TOKEN: z.string().min(16, 'token は 16 文字以上にしてください'),
  TAILSCALE_IP: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Webull JP OpenAPI (optional; 両方セットされてれば adapter 有効化)
  WEBULL_APP_KEY: z.string().optional(),
  WEBULL_APP_SECRET: z.string().optional(),
  // サブ枠 (401 切り分け用の追加 App key/secret。WEBULL_USE_SUB=1 で client.ts が
  // 一時的にこちらに切替)
  WEBULL_APP_KEY_SUB: z.string().optional(),
  WEBULL_APP_SECRET_SUB: z.string().optional(),
  WEBULL_USE_SUB: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('環境変数の検証に失敗:', parsed.error.format());
  throw new Error('Invalid environment configuration. .env を確認してください');
}

export const env = parsed.data;
