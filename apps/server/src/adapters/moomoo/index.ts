// moomoo (Futu OpenAPI) adapter
//
// Node ⇄ Python 連携: scripts/moomoo_fetch.py を spawn して JSON 出力を取り込む。
// futu-api 公式 SDK が Python のみのため。
//
// 前提:
// - OpenD が 127.0.0.1:11111 で起動済み
// - moomoo Japan アカウントでログイン済み
// - .venv に futu-api インストール済み (requirements.txt)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import type { Adapter, AccountUpdate, HoldingUpdate, AdapterContext } from '../types.js';
import { NeedsLoginError } from '../types.js';
import type { AssetClass, Region } from '@asset-tracker/shared';

function regionFromCurrency(currency: string): Region {
  switch (currency) {
    case 'JPY': return 'jp';
    case 'USD': return 'us';
    case 'HKD': return 'hk';
    case 'CNY':
    case 'CNH': return 'cn';
    case 'EUR': return 'eu';
    default: return 'other';
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function venvPython(): string {
  const isWin = os.platform() === 'win32';
  return path.join(REPO_ROOT, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
}

interface PyPosition {
  symbol: string;
  exchange: string | null;
  name: string;
  currency: string;
  assetClass: string;
  region: string;
  quantity: number;
  marketPriceNative: number;
  avgCostNative: number | null;
}

interface PyAccount {
  accId: number;
  label: string;
  accType: string;
  baseCurrency: string;
  /** 通貨コード → native 現金額。例: { USD: 1232.18, JPY: 50023.0 } */
  cashByCurrency: Record<string, number>;
  positions: PyPosition[];
  _diagnostics?: {
    funds_error?: string | null;
    pos_error?: string | null;
  };
}

interface PyOutput {
  accounts: PyAccount[];
  errors: string[];
}

function runPython(): Promise<PyOutput> {
  return new Promise((resolve, reject) => {
    const py = venvPython();
    const script = path.join(REPO_ROOT, 'apps', 'server', 'scripts', 'moomoo_fetch.py');
    const child = spawn(py, [script], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows で日本語文字列の文字化けを防ぐ
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`moomoo_fetch.py exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      // futu lib が stdout に log を吐く可能性 → 最初の '{' から最後の '}' を抽出
      const start = stdout.indexOf('{');
      const end = stdout.lastIndexOf('}');
      if (start < 0 || end < 0) {
        reject(new Error(`no JSON in moomoo_fetch.py output. stderr: ${stderr.slice(-300)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.slice(start, end + 1)) as PyOutput;
        resolve(parsed);
      } catch (e) {
        reject(new Error(`JSON parse failed: ${(e as Error).message}`));
      }
    });
  });
}

function toHoldingUpdate(p: PyPosition): HoldingUpdate {
  return {
    symbol: p.symbol,
    ...(p.exchange ? { exchange: p.exchange } : {}),
    name: p.name,
    currency: p.currency,
    assetClass: p.assetClass as AssetClass,
    region: p.region as Region,
    quantity: p.quantity,
    marketPriceNative: p.marketPriceNative,
    ...(p.avgCostNative != null ? { avgCostNative: p.avgCostNative } : {}),
  };
}

export const moomooAdapter: Adapter = {
  source: 'moomoo_api',
  label: 'Moomoo (Futu OpenD)',
  async run(ctx: AdapterContext) {
    ctx.logger.info({ source: 'moomoo_api' }, 'starting Moomoo OpenD fetch');
    const py = await runPython();

    if (py.errors.length > 0) {
      ctx.logger.warn({ errors: py.errors }, 'moomoo_fetch reported errors');
      // 致命的でない (errors あっても accounts 取れてれば続行)
      if (py.accounts.length === 0) {
        // OpenD 未起動 or 未ログイン
        throw new NeedsLoginError(
          'moomoo',
          `Moomoo データ取得失敗: ${py.errors.join('; ')}`,
        );
      }
    }

    const capturedAt = new Date();
    const updates: AccountUpdate[] = py.accounts.map((acc) => {
      const holdings: HoldingUpdate[] = acc.positions.map(toHoldingUpdate);
      // 通貨別 cash を個別の Holding として追加
      for (const [currency, amount] of Object.entries(acc.cashByCurrency)) {
        if (amount > 0) {
          holdings.push({
            symbol: `${currency}_CASH`,
            name: `${currency} 現金`,
            currency,
            assetClass: 'cash',
            region: regionFromCurrency(currency),
            quantity: amount,
            marketPriceNative: 1,
          });
        }
      }
      return {
        institution: 'moomoo' as const,
        label: acc.label,
        capturedAt,
        baseCurrency: acc.baseCurrency,
        cashNative: 0, // cash は holdings に統一
        holdings,
      };
    });

    ctx.logger.info(
      { source: 'moomoo_api', accountCount: updates.length },
      'Moomoo fetch complete',
    );
    return { accountUpdates: updates };
  },
};
