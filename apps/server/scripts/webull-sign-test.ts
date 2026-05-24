// Node signer の署名計算を、Python SDK の式をそのまま再実装した参照と比較。
// (ESM では crypto.randomUUID を mock できないので、署名の core ロジックを抽出して直接テスト)
import { createHash, createHmac } from 'node:crypto';

function pythonQuote(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function calcSignature(opts: {
  uri: string;
  queries: Record<string, string>;
  body: unknown;
  host: string;
  appKey: string;
  appSecret: string;
  timestamp: string;
  nonce: string;
}): string {
  const signParams: Record<string, string> = {
    'x-app-key': opts.appKey,
    'x-timestamp': opts.timestamp,
    'x-signature-version': '1.0',
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': opts.nonce,
    host: opts.host,
  };
  for (const [k, v] of Object.entries(opts.queries)) {
    signParams[k] = signParams[k] !== undefined ? `${signParams[k]}&${v}` : v;
  }

  let bodyHash: string | null = null;
  if (opts.body !== null && opts.body !== undefined) {
    const bodyJson = JSON.stringify(opts.body);
    bodyHash = createHash('md5').update(bodyJson).digest('hex').toUpperCase();
  }

  const sortedParts = Object.keys(signParams)
    .sort()
    .map((k) => `${k}=${signParams[k]}`);

  let s = opts.uri;
  if (sortedParts.length > 0) s += '&' + sortedParts.join('&');
  if (bodyHash) s += '&' + bodyHash;
  s = pythonQuote(s);

  return createHmac('sha1', opts.appSecret + '&').update(s).digest('base64');
}

const T = {
  timestamp: '2026-05-24T12:34:56Z',
  nonce: '12345678-1234-5678-1234-567812345678',
  host: 'api.webull.co.jp',
  appKey: 'test_app_key',
  appSecret: 'test_app_secret',
};

const sig1 = calcSignature({ uri: '/openapi/account/list', queries: {}, body: null, ...T });
console.log('TEST1 sig     :', sig1);
console.log('TEST1 expected:', 'DkkihRz/fRgRjf0nFUIACh9rX4g=');
console.log('TEST1 match   :', sig1 === 'DkkihRz/fRgRjf0nFUIACh9rX4g=');

const sig2 = calcSignature({ uri: '/openapi/account/positions', queries: { account_id: 'ABC123' }, body: null, ...T });
console.log('TEST2 sig     :', sig2);
console.log('TEST2 expected:', 'S6k30/3m2SqpF+bOMSlJ9BXyKEw=');
console.log('TEST2 match   :', sig2 === 'S6k30/3m2SqpF+bOMSlJ9BXyKEw=');
