// Webull UAT (US テスト環境) 切り分けプローブ。
//
// 用途: 本番 JP API で 401 UNAUTHORIZED が返るときに、自前 signer の
// バグなのか、それとも JP 側の権限/IP 設定の問題かを切り分ける。
//
// 期待結果:
//   - 200 系 or 404 (Route Not Found) → 署名コード OK、JP 側の設定問題
//   - 401 (UNAUTHORIZED)              → signer のロジックバグ
//
// テストアカウントは Webull 公式が developer.webull.com で公開している
// 共有用 (「Orders and positions may change at any time」と注記される性質)。
// 値の信頼性はないが auth/署名の検証用途には十分。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server exec tsx scripts/webull-uat-probe.ts

import { buildSignedRequest } from '../src/adapters/webull/signer.js';

const HOST = 'us-openapi-alb.uat.webullbroker.com';
const APP_KEY = 'a88f2efed4dca02b9bc1a3cecbc35dba';
const APP_SECRET = 'c2895b3526cc7c7588758351ddf425d6';
const ACC = 'J6HA4EBQRQFJD2J6NQH0F7M649';

async function call(uri: string, queries?: Record<string, string>): Promise<void> {
  const signed = buildSignedRequest({
    method: 'GET',
    uri,
    queries,
    host: HOST,
    appKey: APP_KEY,
    appSecret: APP_SECRET,
  });
  const res = await fetch(signed.url, { headers: signed.headers });
  const text = await res.text();
  console.log(uri, 'status=' + res.status);
  console.log('body:', text.slice(0, 600));
  console.log('---');
}

await call('/openapi/account/list');
await call('/openapi/account/balance', { account_id: ACC, total_asset_currency: 'USD' });
await call('/openapi/account/positions', { account_id: ACC });
