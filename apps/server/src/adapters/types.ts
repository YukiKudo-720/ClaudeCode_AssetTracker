import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import type {
  AssetClass,
  DataSource,
  Institution,
  Region,
} from '@asset-tracker/shared';

export class NeedsLoginError extends Error {
  constructor(public readonly institution: Institution | DataSource, message?: string) {
    super(message ?? `${institution}: 手動ログインが必要です`);
    this.name = 'NeedsLoginError';
  }
}

export interface HoldingUpdate {
  symbol: string;
  exchange?: string;
  name: string;
  currency: string;
  assetClass: AssetClass;
  region?: Region;
  sector?: string;
  quantity: number;
  marketPriceNative: number;
  avgCostNative?: number;
}

export interface AccountUpdate {
  institution: Institution;
  label: string;            // ユーザー命名 (口座を区別する識別子。MF の表示名を流用)
  capturedAt: Date;
  baseCurrency: string;
  cashNative: number;       // この口座の現金部分 (証券口座でも余力)
  holdings: HoldingUpdate[];
}

export interface AdapterResult {
  accountUpdates: AccountUpdate[];
}

export interface AdapterContext {
  prisma: PrismaClient;
  logger: Logger;
  /** USD/HKD 等 → JPY のレート取得 (同一 run 内ではキャッシュ) */
  getFxToJpy(fromCurrency: string): Promise<number>;
}

export interface Adapter {
  readonly source: DataSource;
  readonly label: string; // ログ表示用 "MoneyForward" 等
  run(ctx: AdapterContext): Promise<AdapterResult>;
}
