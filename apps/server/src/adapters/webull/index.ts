// Webull JP OpenAPI v2 adapter
//
// 前提:
// - WEBULL_APP_KEY / WEBULL_APP_SECRET (もしくは _SUB) が .env 設定済み
// - portal で IP whitelist 登録 (現在の公開 IP)
// - signer は HMAC-SHA256, x-version: v2
//
// 取得:
//   /openapi/account/list      → 口座一覧
//   /openapi/assets/balance    → 残高 (account_currency_assets で通貨別現金)
//   /openapi/assets/positions  → 保有ポジション (USD建て、base_currency_market_value で JPY 換算)

import type {
  Adapter,
  AccountUpdate,
  AdapterContext,
  HoldingUpdate,
} from '../types.js';
import { NeedsLoginError } from '../types.js';
import {
  listAccounts,
  getAccountBalance,
  getAccountPositions,
  WebullCredentialsMissingError,
  type WebullPosition,
} from './client.js';
import type { AssetClass, Region } from '@asset-tracker/shared';

// 銘柄名から ETF 判定 (moomoo と同じパターン)
const ETF_MARKERS = [
  'etf', ' trust', ' fund', ' ishares', ' vanguard', ' spdr', ' invesco',
  ' proshares', ' ark ', ' direxion', ' wisdomtree', ' schwab',
  ' graniteshares', ' leverage shares', ' roundhill',
];

function detectAssetClass(name: string): AssetClass {
  if (!name) return 'stock';
  const lower = ` ${name.toLowerCase()} `;
  if (ETF_MARKERS.some((m) => lower.includes(m))) return 'etf';
  return 'stock';
}

function regionFromCurrency(currency: string): Region {
  switch (currency) {
    case 'JPY':
      return 'jp';
    case 'USD':
      return 'us';
    case 'HKD':
      return 'hk';
    case 'CNY':
    case 'CNH':
      return 'cn';
    case 'EUR':
      return 'eu';
    default:
      return 'other';
  }
}

// 取引所コード正規化 (XNAS → NASDAQ 等)
function normalizeExchange(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const m: Record<string, string> = { XNAS: 'NASDAQ', XNYS: 'NYSE', NYSE: 'NYSE', NASDAQ: 'NASDAQ' };
  return m[code] ?? code;
}

function toHoldingUpdate(p: WebullPosition): HoldingUpdate {
  const quantity = Number(p.quantity ?? 0);
  // last_price が 0.00 で返ることがあるので market_value / quantity で逆算
  const lastPrice = Number(p.last_price ?? 0);
  const marketValue = Number(p.market_value ?? 0);
  const priceNative = lastPrice > 0
    ? lastPrice
    : quantity > 0
      ? marketValue / quantity
      : 0;
  const currency = (p.currency as string | undefined) ?? 'USD';
  const symbol = (p.symbol as string | undefined) ?? '';
  const name = (p.ticker_name as string | undefined) ?? (p as { symbol_name?: string }).symbol_name ?? symbol;
  const avgCost = Number(p.cost_price ?? 0);
  const exchange = normalizeExchange((p as { exchange_code?: string }).exchange_code);

  const holding: HoldingUpdate = {
    symbol,
    name,
    currency,
    assetClass: detectAssetClass(name),
    region: regionFromCurrency(currency),
    quantity,
    marketPriceNative: priceNative,
  };
  if (exchange) holding.exchange = exchange;
  if (avgCost > 0) holding.avgCostNative = avgCost;
  return holding;
}

interface WebullAccount {
  account_id: string;
  account_number?: string;
  account_type?: string;
  account_label?: string;
  account_class?: string;
}

interface WebullBalance {
  total_asset_currency?: string;
  total_market_value?: string | number;
  total_cash_balance?: string | number;
  account_currency_assets?: Array<{
    currency: string;
    cash_balance?: string | number;
    market_value?: string | number;
  }>;
}

export const webullAdapter: Adapter = {
  source: 'webull_api',
  label: 'Webull (OpenAPI v2)',
  async run(ctx: AdapterContext) {
    ctx.logger.info({ source: 'webull_api' }, 'starting Webull fetch');

    let accounts: WebullAccount[];
    try {
      const raw = await listAccounts();
      accounts = Array.isArray(raw)
        ? (raw as WebullAccount[])
        : ((raw as { data?: WebullAccount[] }).data ??
           (raw as { accounts?: WebullAccount[] }).accounts ??
           []);
    } catch (err) {
      if (err instanceof WebullCredentialsMissingError) {
        ctx.logger.warn('Webull credentials が未設定、skip');
        return { accountUpdates: [] };
      }
      throw new NeedsLoginError('webull', `Webull /account/list 失敗: ${(err as Error).message}`);
    }

    if (accounts.length === 0) {
      throw new NeedsLoginError('webull', 'Webull 口座 0 件 (権限/承認状態を確認)');
    }

    const capturedAt = new Date();
    const updates: AccountUpdate[] = [];

    for (const acc of accounts) {
      let balance: WebullBalance;
      let positions: WebullPosition[];
      try {
        balance = (await getAccountBalance(acc.account_id, 'JPY')) as WebullBalance;
        const posRaw = await getAccountPositions(acc.account_id);
        positions = Array.isArray(posRaw) ? (posRaw as WebullPosition[]) : [];
      } catch (err) {
        ctx.logger.warn({ accountId: acc.account_id, err }, 'Webull 口座詳細取得失敗、skip');
        continue;
      }

      const holdings: HoldingUpdate[] = positions.map(toHoldingUpdate);

      // 通貨別 cash を Holding として追加
      for (const ca of balance.account_currency_assets ?? []) {
        const cash = Number(ca.cash_balance ?? 0);
        if (cash > 0) {
          holdings.push({
            symbol: `${ca.currency}_CASH`,
            name: `${ca.currency} 現金`,
            currency: ca.currency,
            assetClass: 'cash',
            region: regionFromCurrency(ca.currency),
            quantity: cash,
            marketPriceNative: 1,
          });
        }
      }

      // 空口座 (positions・cash 全部 0) は skip
      if (holdings.length === 0) {
        ctx.logger.info({ accountId: acc.account_id, label: acc.account_label }, 'Webull 空口座 skip');
        continue;
      }

      updates.push({
        institution: 'webull' as const,
        label: acc.account_label ?? 'Webull証券',
        capturedAt,
        baseCurrency: balance.total_asset_currency ?? 'JPY',
        cashNative: 0, // cash は holdings 側
        holdings,
      });
    }

    ctx.logger.info(
      { source: 'webull_api', accountCount: updates.length },
      'Webull fetch complete',
    );
    return { accountUpdates: updates };
  },
};
