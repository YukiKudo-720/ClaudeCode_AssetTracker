import { z } from 'zod';

export const AccountKindSchema = z.enum(['bank', 'brokerage']);

export const InstitutionSchema = z.enum([
  'rakuten_bank',
  'mufg',
  'sbi_sumishin',
  'rakuten_sec',
  'sbi_sec',
  'webull',
  'moomoo',
]);

export const DataSourceSchema = z.enum([
  'moneyforward',
  'direct_scrape',
  'webull_api',
  'moomoo_api',
  'manual',
]);

export const AssetClassSchema = z.enum([
  'cash',
  'stock',
  'etf',
  'mutual_fund',
  'reit',
  'bond',
  'crypto',
  'commodity',
  'other',
]);

export const RegionSchema = z.enum([
  'jp',
  'us',
  'hk',
  'cn',
  'eu',
  'em',
  'global',
  'other',
]);

export const ScrapeStatusSchema = z.enum(['ok', 'error', 'running', 'needs_2fa']);

// API レスポンス型 (PC server → PWA)

export const AccountSummarySchema = z.object({
  id: z.string(),
  kind: AccountKindSchema,
  institution: InstitutionSchema,
  source: DataSourceSchema,
  label: z.string(),
  baseCurrency: z.string(),
  tags: z.array(z.string()),
  enabled: z.boolean(),
  latestTotalJpy: z.number().nullable(),
  latestCapturedAt: z.string().nullable(),
});
export type AccountSummary = z.infer<typeof AccountSummarySchema>;

export const SecuritySummarySchema = z.object({
  id: z.string(),
  symbol: z.string(),
  exchange: z.string().nullable(),
  name: z.string(),
  currency: z.string(),
  assetClass: AssetClassSchema,
  region: RegionSchema.nullable(),
  sector: z.string().nullable(),
  tags: z.array(z.string()),
});
export type SecuritySummary = z.infer<typeof SecuritySummarySchema>;

export const HoldingSnapshotPointSchema = z.object({
  capturedAt: z.string(),
  quantity: z.number(),
  marketValueJpy: z.number(),
  marketValueNative: z.number(),
});
export type HoldingSnapshotPoint = z.infer<typeof HoldingSnapshotPointSchema>;

export const AggregatedHoldingSchema = z.object({
  security: SecuritySummarySchema,
  totalQuantity: z.number(),
  totalValueJpy: z.number(),
  heldInInstitutions: z.array(InstitutionSchema),
});
export type AggregatedHolding = z.infer<typeof AggregatedHoldingSchema>;

export const AllocationBucketSchema = z.object({
  label: z.string(),
  key: z.string(),
  valueJpy: z.number(),
  ratio: z.number(),
});
export type AllocationBucket = z.infer<typeof AllocationBucketSchema>;

export const TimeSeriesPointSchema = z.object({
  date: z.string(),
  valueJpy: z.number(),
});
export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

export const ScrapeRunSummarySchema = z.object({
  id: z.string(),
  source: DataSourceSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: ScrapeStatusSchema,
  errorMsg: z.string().nullable(),
  accountsTouched: z.number(),
});
export type ScrapeRunSummary = z.infer<typeof ScrapeRunSummarySchema>;
