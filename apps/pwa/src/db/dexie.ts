import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { AccountSummary, ScrapeRunSummary } from '@asset-tracker/shared';

// API レスポンスのキャッシュ用 (オフライン時に最後に見た値を表示するため)

class AssetTrackerDB extends Dexie {
  accounts!: Table<AccountSummary, string>;
  runs!: Table<ScrapeRunSummary, string>;

  constructor() {
    super('asset-tracker');
    this.version(1).stores({
      accounts: 'id, institution, kind',
      runs: 'id, startedAt, source',
    });
  }
}

export const db = new AssetTrackerDB();
