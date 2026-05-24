import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// Prisma 6 では prisma.config.ts がある場合、組込みの .env ロードが無効になるので
// 明示的にロード (リポルートの .env を読む)
dotenv.config({ path: path.join(repoRoot, '.env') });

export default defineConfig({
  schema: path.join(repoRoot, 'prisma', 'schema.prisma'),
});
