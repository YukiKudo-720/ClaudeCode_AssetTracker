// Webull JP OpenAPI REST client
// signer.ts で署名し、api.webull.co.jp に GET / POST する。

import { env } from '../../env.js';
import { buildSignedRequest } from './signer.js';

const HOST = 'api.webull.co.jp';

export class WebullCredentialsMissingError extends Error {
  constructor() {
    super('WEBULL_APP_KEY / WEBULL_APP_SECRET が .env に未設定');
    this.name = 'WebullCredentialsMissingError';
  }
}

export class WebullApiError extends Error {
  constructor(public status: number, public uri: string, public body: string) {
    super(`Webull API ${uri} failed ${status}: ${body.slice(0, 300)}`);
    this.name = 'WebullApiError';
  }
}

async function callWebull<T>(
  method: 'GET' | 'POST',
  uri: string,
  queries?: Record<string, string>,
  body?: unknown,
  apiVersion: string = 'v1',
): Promise<T> {
  if (!env.WEBULL_APP_KEY || !env.WEBULL_APP_SECRET) {
    throw new WebullCredentialsMissingError();
  }
  const signed = buildSignedRequest({
    method,
    uri,
    queries,
    body,
    host: HOST,
    appKey: env.WEBULL_APP_KEY,
    appSecret: env.WEBULL_APP_SECRET,
    apiVersion,
  });

  const res = await fetch(signed.url, {
    method,
    headers: signed.headers,
    body: signed.body ?? undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // デバッグ用にレスポンスヘッダもダンプ
    if (process.env.WEBULL_DEBUG === '1') {
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { respHeaders[k] = v; });
      console.error('[webull] req url:', signed.url);
      console.error('[webull] req headers:', JSON.stringify(signed.headers, null, 2));
      console.error('[webull] resp status:', res.status);
      console.error('[webull] resp headers:', JSON.stringify(respHeaders, null, 2));
      console.error('[webull] resp body:', text);
    }
    throw new WebullApiError(res.status, uri, text);
  }
  return JSON.parse(text) as T;
}

// Webull JP API のレスポンスは多くの場合 {data: ..., code: 0, msg: "..."} 形式
// レスポンス shape は実 API 呼び出して確認しながら追加していく

export interface WebullAccountListItem {
  account_id?: string;
  account_type?: string;
  account_status?: string;
  // 他フィールドは probe で確認
  [key: string]: unknown;
}

export interface WebullAccountBalance {
  total_assets?: string | number;
  cash?: string | number;
  market_value?: string | number;
  currency?: string;
  [key: string]: unknown;
}

export interface WebullPosition {
  symbol?: string;
  ticker?: string;
  ticker_name?: string;
  quantity?: string | number;
  market_value?: string | number;
  cost_price?: string | number;
  last_price?: string | number;
  currency?: string;
  [key: string]: unknown;
}

// JP 版は /openapi/account/list ではなく /app/subscriptions/list
// (docs では「Account List」というタイトルだが URL 末尾は app_subscription)
export async function listAccounts(): Promise<unknown> {
  return callWebull('GET', '/app/subscriptions/list');
}

export async function getAccountBalance(
  accountId: string,
  totalAssetCurrency = 'JPY',
): Promise<unknown> {
  return callWebull('GET', '/openapi/account/balance', {
    account_id: accountId,
    total_asset_currency: totalAssetCurrency,
  });
}

export async function getAccountPositions(accountId: string): Promise<unknown> {
  return callWebull('GET', '/openapi/account/positions', {
    account_id: accountId,
  });
}
