// Webull API 探査: 各 endpoint を順に叩いて JSON 構造を確認。
// 実 API 叩いてレスポンス shape を見ながら adapter 実装するため。
//
// 使い方:
//   corepack pnpm --filter @asset-tracker/server run webull:probe

import '../src/env.js';
import {
  listAccounts,
  getAccountBalance,
  getAccountPositions,
  WebullCredentialsMissingError,
} from '../src/adapters/webull/client.js';

async function main() {
  console.log('=== /openapi/account/list ===');
  try {
    const accounts = await listAccounts();
    console.log(JSON.stringify(accounts, null, 2));

    // v2 は配列直返し。互換のため data/accounts ラップも吸収
    const accountList = Array.isArray(accounts)
      ? accounts
      : (accounts as { data?: unknown[] }).data ?? (accounts as { accounts?: unknown[] }).accounts ?? [];
    const items = (accountList as { account_id?: string; accountId?: string }[]).slice(0, 2);

    for (const acc of items) {
      const id = acc.account_id ?? acc.accountId;
      if (!id) continue;
      console.log(`\n=== /openapi/account/balance (account_id=${id}) ===`);
      try {
        const bal = await getAccountBalance(id, 'JPY');
        console.log(JSON.stringify(bal, null, 2));
      } catch (e) {
        console.error(`balance error: ${(e as Error).message}`);
      }
      console.log(`\n=== /openapi/account/positions (account_id=${id}) ===`);
      try {
        const pos = await getAccountPositions(id);
        console.log(JSON.stringify(pos, null, 2));
      } catch (e) {
        console.error(`positions error: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    if (e instanceof WebullCredentialsMissingError) {
      console.error(e.message);
      process.exit(1);
    }
    console.error(`accounts error: ${(e as Error).message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
