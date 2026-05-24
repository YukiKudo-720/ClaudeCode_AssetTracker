import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// project root の .env を明示的にロード (cwd 依存だと apps/server から起動時に拾えない)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ASSET_TRACKER_TOKEN: z.string().min(16, 'token は 16 文字以上にしてください'),
  TAILSCALE_IP: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('環境変数の検証に失敗:', parsed.error.format());
  throw new Error('Invalid environment configuration. .env を確認してください');
}

export const env = parsed.data;
