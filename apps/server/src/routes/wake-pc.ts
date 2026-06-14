import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

// Pi 専用: pi-wake-and-scrape.sh を spawn して PC を WoL → SSH → schtasks で起こす。
// fire-and-forget。完了は /api/runs を polling して startedAt > startedAt(202) の
// ok run が 3 件 (mf + webull + moomoo) 並んだかで判定する。
//
// PC や Windows 上で動く dev server 等で叩かれた場合は 501 を返す。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'pi-wake-and-scrape.sh');

export function registerWakePcRoutes(app: FastifyInstance): void {
  app.post('/api/wake-pc', async (_req, reply) => {
    if (process.platform !== 'linux' || !existsSync(SCRIPT_PATH)) {
      return reply.code(501).send({
        error: 'wake_pc_unavailable',
        message: 'pi-wake-and-scrape.sh は Linux (Pi) + リポジトリ内 scripts/ 配置時のみ実行可',
      });
    }
    app.log.info({ script: SCRIPT_PATH }, 'spawning pi-wake-and-scrape.sh');
    // detached + stdio:ignore + unref で Pi server プロセスが exit しても script は走り続ける
    const child = spawn('bash', [SCRIPT_PATH], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => {
      app.log.error({ err }, 'pi-wake-and-scrape.sh spawn error');
    });
    child.unref();
    return reply.code(202).send({
      status: 'started',
      startedAt: new Date().toISOString(),
    });
  });
}
