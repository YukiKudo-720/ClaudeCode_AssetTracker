// Webull OpenAPI HMAC-SHA1 signer
// 公式 Python SDK (webull-python-sdk-core) の default_signature_composer.py を移植。
//
// 署名手順:
//   1. sign_headers (x-app-key, x-timestamp, x-signature-version, x-signature-algorithm,
//      x-signature-nonce, host) を生成
//   2. sign_params = lowercase(sign_headers) + queries
//      (同名キーがあれば "v1&v2" で連結)
//   3. sort_params をキーアルファベット順にソート → "k1=v1&k2=v2" 連結
//   4. URI + "&" + sorted_params (+ "&" + MD5_hex_upper(body) if body)
//   5. Python quote(safe='') で URL エンコード
//   6. HMAC-SHA1(secret + "&", string_to_sign) → base64
//   7. x-signature ヘッダに設定

import { createHash, createHmac, randomUUID } from 'node:crypto';

export interface SignParams {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  uri: string; // path only, e.g., '/openapi/account/list'
  queries?: Record<string, string>;
  body?: unknown;
  host: string; // 'api.webull.co.jp'
  appKey: string;
  appSecret: string;
  apiVersion?: string; // e.g., 'v1' — x-version ヘッダ (署名対象外、SDK は追加)
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

// Python の quote(s, safe='') 等価
// JS encodeURIComponent は !*'() を encode しないので追加 escape
function pythonQuote(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

export function buildSignedRequest(p: SignParams): SignedRequest {
  // タイムスタンプ: UTC, "YYYY-MM-DDTHH:MM:SSZ" (秒精度、ミリ秒なし)
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  // nonce: Python サンプル uuid.uuid4().hex に合わせて「ハイフン無し」32文字
  // randomUUID() は標準形 (ハイフン付き) を返すので除去する
  const nonce = randomUUID().replace(/-/g, '');

  // 実際のリクエストに乗るヘッダ (host は fetch が自動付与)
  const headers: Record<string, string> = {
    'x-app-key': p.appKey,
    'x-timestamp': now,
    'x-signature-version': '1.0',
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
  };

  // 署名対象 params: ヘッダ (lowercase) + host + queries
  const signParams: Record<string, string> = {
    'x-app-key': p.appKey,
    'x-timestamp': now,
    'x-signature-version': '1.0',
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
    host: p.host,
  };
  if (p.queries) {
    for (const [k, v] of Object.entries(p.queries)) {
      const existing = signParams[k];
      signParams[k] = existing !== undefined ? `${existing}&${v}` : v;
    }
  }

  // body 文字列: compact JSON → MD5 hex (uppercase)
  let bodyJson: string | null = null;
  let bodyHash: string | null = null;
  if (p.body !== null && p.body !== undefined) {
    bodyJson = JSON.stringify(p.body);
    bodyHash = createHash('md5').update(bodyJson).digest('hex').toUpperCase();
  }

  // string-to-sign: URI + & + sorted("k=v" join "&") + (& + bodyHash)?
  const sortedParts = Object.keys(signParams)
    .sort()
    .map((k) => `${k}=${signParams[k]}`);

  let stringToSign = p.uri;
  if (sortedParts.length > 0) {
    stringToSign += '&' + sortedParts.join('&');
  }
  if (bodyHash) {
    stringToSign += '&' + bodyHash;
  }
  stringToSign = pythonQuote(stringToSign);

  // 署名: HMAC-SHA1(secret + "&", string_to_sign) → base64
  const signature = createHmac('sha1', p.appSecret + '&')
    .update(stringToSign)
    .digest('base64');

  headers['x-signature'] = signature;
  // Python サンプルは GET でも Content-Type を常時付ける
  headers['Content-Type'] = 'application/json';
  if (p.apiVersion) {
    headers['x-version'] = p.apiVersion;
  }
  // SDK が常に付ける
  headers['Accept-Encoding'] = 'gzip';
  headers['User-Agent'] = 'asset-tracker-node/0.0.0';

  // URL 構築
  let url = `https://${p.host}${p.uri}`;
  if (p.queries && Object.keys(p.queries).length > 0) {
    const qs = Object.entries(p.queries)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    url += '?' + qs;
  }

  return { url, headers, body: bodyJson };
}
