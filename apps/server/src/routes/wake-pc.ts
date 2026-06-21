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
const ORCHESTRATE_PATH = path.join(REPO_ROOT, 'scripts', 'pi-mf-orchestrate-controller.sh');

function spawnDetached(app: FastifyInstance, scriptPath: string, args: string[] = []): void {
  app.log.info({ script: scriptPath, args }, 'spawning bg script');
  const child = spawn('bash', [scriptPath, ...args], {
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', (err) => {
    app.log.error({ err, script: scriptPath }, 'spawn error');
  });
  child.unref();
}

export function registerWakePcRoutes(app: FastifyInstance): void {
  // 既存: PC を起こして scrape:all + mf:push-webull + mf:check-status を走らせる
  app.post('/api/wake-pc', async (_req, reply) => {
    if (process.platform !== 'linux' || !existsSync(SCRIPT_PATH)) {
      return reply.code(501).send({
        error: 'wake_pc_unavailable',
        message: 'pi-wake-and-scrape.sh は Linux (Pi) + リポジトリ内 scripts/ 配置時のみ実行可',
      });
    }
    spawnDetached(app, SCRIPT_PATH);
    return reply.code(202).send({ status: 'started', startedAt: new Date().toISOString() });
  });

  // 新規: MF の一括更新フローを含めて実行 (controller の main コマンドを発火)。
  // bulk-update → 1min wait → poll → scrape:all → SBI 状態確認まで一連で走る。
  app.post('/api/wake-pc-mf', async (_req, reply) => {
    if (process.platform !== 'linux' || !existsSync(ORCHESTRATE_PATH)) {
      return reply.code(501).send({
        error: 'wake_pc_mf_unavailable',
        message: 'pi-mf-orchestrate-controller.sh は Linux (Pi) でのみ実行可',
      });
    }
    spawnDetached(app, ORCHESTRATE_PATH, ['main']);
    return reply.code(202).send({ status: 'started', startedAt: new Date().toISOString() });
  });
}
