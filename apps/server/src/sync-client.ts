// scrape 結果を別ホスト (Pi) に POST するクライアント。
// runAdapter からは env.SYNC_TARGET があれば呼ばれる。
// 受信側は routes/sync.ts の POST /api/sync。

import type { Logger } from 'pino';
import type { AccountUpdate } from './adapters/types.js';

export interface SyncOptions {
  target: string; // base URL: http://100.85.86.51:3000
  token: string;
  source: string;
  accountUpdates: AccountUpdate[];
  logger?: Logger;
}

export async function postSync(opts: SyncOptions): Promise<void> {
  const url = `${opts.target.replace(/\/$/, '')}/api/sync`;
  const body = JSON.stringify({
    source: opts.source,
    accountUpdates: opts.accountUpdates.map((au) => ({
      ...au,
      capturedAt: au.capturedAt.toISOString(),
    })),
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`sync POST failed ${res.status} ${url}: ${text.slice(0, 200)}`);
  }
}
