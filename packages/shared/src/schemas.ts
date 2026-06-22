import { z } from 'zod';

export const AccountKindSchema = z.enum(['bank', 'brokerage', 'fx']);

export const InstitutionSchema = z.enum([
  'rakuten_bank',
  'mufg',
  'sbi_sumishin',
  'rakuten_sec',
  'sbi_sec',
  'sbi_sec_fx',
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
  'fx',
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

export const AccountAssetBreakdownSchema = z.object({
  assetClass: z.string(),
  valueJpy: z.number(),
  // 前日 snapshot がそもそも無い場合は null。snapshot はあるがその assetClass が
  // 前日には無かった場合は 0 (= 新規発生)。
  prevValueJpy: z.number().nullable(),
});
export type AccountAssetBreakdown = z.infer<typeof AccountAssetBreakdownSchema>;

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
  latestCapturedDate: z.string().nullable(),
  prevTotalJpy: z.number().nullable(),
  prevCapturedDate: z.string().nullable(),
  breakdown: z.array(AccountAssetBreakdownSchema),
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

// /api/holdings
export const HoldingAggSchema = z.object({
  securityId: z.string(),
  symbol: z.string(),
  name: z.string(),
  exchange: z.string().nullable(),
  currency: z.string(),
  assetClass: z.string(),
  region: z.string().nullable(),
  sector: z.string().nullable(),
  totalQuantity: z.number(),
  totalValueJpy: z.number(),
  totalCostJpy: z.number(),
  unrealizedPnlJpy: z.number().nullable(),
  unrealizedPnlRatio: z.number().nullable(),
  // 直近の前日 snapshot 比較 (前日データが無ければ null)
  prevTotalValueJpy: z.number().nullable(),
  accounts: z.array(
    z.object({
      accountId: z.string(),
      institution: z.string(),
      label: z.string(),
      quantity: z.number(),
      valueJpy: z.number(),
      avgCostNative: z.number().nullable(),
    }),
  ),
});
export type HoldingAgg = z.infer<typeof HoldingAggSchema>;

export const HoldingsResponseSchema = z.object({
  capturedDate: z.string().nullable(),
  prevCapturedDate: z.string().nullable(),
  holdings: z.array(HoldingAggSchema),
});
export type HoldingsResponse = z.infer<typeof HoldingsResponseSchema>;

// /api/allocation
export const AllocationResponseSchema = z.object({
  capturedDate: z.string().nullable(),
  by: z.enum(['currency', 'assetClass', 'region', 'institution']),
  totalJpy: z.number(),
  buckets: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      valueJpy: z.number(),
      ratio: z.number(),
    }),
  ),
});
export type AllocationResponse = z.infer<typeof AllocationResponseSchema>;

// /api/history/total
// totalJpy / cashJpy に加え、assetClass 別の値 (該当無しは 0) を flat に持つ。
// recharts の dataKey にそのまま渡す前提。
export const HistoryTotalPointSchema = z.object({
  date: z.string(),
  totalJpy: z.number(),
  cashJpy: z.number(),
  cash: z.number(),
  fx: z.number(),
  stock: z.number(),
  etf: z.number(),
  mutual_fund: z.number(),
  reit: z.number(),
  bond: z.number(),
  crypto: z.number(),
  commodity: z.number(),
  other: z.number(),
});
export type HistoryTotalPoint = z.infer<typeof HistoryTotalPointSchema>;

export const HistoryTotalResponseSchema = z.object({
  points: z.array(HistoryTotalPointSchema),
});
export type HistoryTotalResponse = z.infer<typeof HistoryTotalResponseSchema>;

// /api/categories
export const CategorySecurityEntrySchema = z.object({
  securityId: z.string(),
  symbol: z.string(),
  name: z.string(),
  assetClass: z.string(),
  weight: z.number(),
  totalValueJpy: z.number(),
  weightedValueJpy: z.number(),
});
export type CategorySecurityEntry = z.infer<typeof CategorySecurityEntrySchema>;

export const CategoryAggSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  securityCount: z.number(),
  valueJpy: z.number(),
  ratio: z.number(),
  // 直近の前日値 (今日のテーマ紐付けを昨日の価格に適用したもの)
  prevValueJpy: z.number().nullable(),
  securities: z.array(CategorySecurityEntrySchema),
});
export type CategoryAgg = z.infer<typeof CategoryAggSchema>;

export const UntaggedSecuritySchema = z.object({
  securityId: z.string(),
  symbol: z.string(),
  name: z.string(),
  assetClass: z.string(),
  valueJpy: z.number(),
});
export type UntaggedSecurity = z.infer<typeof UntaggedSecuritySchema>;

export const CategoriesResponseSchema = z.object({
  capturedDate: z.string().nullable(),
  prevCapturedDate: z.string().nullable(),
  totalJpy: z.number(),
  untaggedJpy: z.number(),
  categories: z.array(CategoryAggSchema),
  untagged: z.array(UntaggedSecuritySchema),
});
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;

// /api/todai — 1銘柄=1タグの排他グルーピング (現金含む全資産)。
// タグは2階層: parentId=null が大カテゴリ、parentId 指定が小カテゴリ。
export const TodaiTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number(),
  parentId: z.string().nullable(),
});
export type TodaiTag = z.infer<typeof TodaiTagSchema>;

// 円グラフ外側 (小カテゴリ or 大直接割当 or 未分類)
export const TodaiLeafGroupSchema = z.object({
  tagId: z.string().nullable(), // null = (大直下 or 未分類)
  name: z.string(),
  valueJpy: z.number(),
  ratio: z.number(),
  count: z.number(),
});
export type TodaiLeafGroup = z.infer<typeof TodaiLeafGroupSchema>;

// 円グラフ内側 (大カテゴリ or 未分類) + その配下
export const TodaiBigGroupSchema = z.object({
  tagId: z.string().nullable(), // null = 未分類
  name: z.string(),
  valueJpy: z.number(),
  ratio: z.number(),
  children: z.array(TodaiLeafGroupSchema),
});
export type TodaiBigGroup = z.infer<typeof TodaiBigGroupSchema>;

export const TodaiAccountBreakdownSchema = z.object({
  accountId: z.string(),
  institution: z.string(),
  label: z.string(),
  quantity: z.number(),
  // native 通貨建ての平均取得単価 (持ち越し銘柄等で取得していなければ null)
  avgCostNative: z.number().nullable(),
  // 評価額 (JPY 換算)
  valueJpy: z.number(),
  // 取得額 (JPY 換算)。avgCost が null なら 0
  costJpy: z.number(),
  unrealizedPnlJpy: z.number().nullable(),
  unrealizedPnlRatio: z.number().nullable(),
});
export type TodaiAccountBreakdown = z.infer<typeof TodaiAccountBreakdownSchema>;

export const TodaiAssetSchema = z.object({
  securityId: z.string(),
  symbol: z.string(),
  name: z.string(),
  assetClass: z.string(),
  currency: z.string(),
  valueJpy: z.number(),
  ratio: z.number(),
  tagId: z.string().nullable(),
  // レバレッジ倍率。現物=1, ブル=正, ベア=負
  leverage: z.number(),
  // 取得金額 (JPY 換算 / 全口座合算)
  totalCostJpy: z.number(),
  totalQuantity: z.number(),
  // 含み損益 (口座またぎ集計、avgCost が無ければ null)
  unrealizedPnlJpy: z.number().nullable(),
  unrealizedPnlRatio: z.number().nullable(),
  // 口座別ブレークダウン (折りたたみ表示用)
  accounts: z.array(TodaiAccountBreakdownSchema),
});
export type TodaiAsset = z.infer<typeof TodaiAssetSchema>;

export const TodaiResponseSchema = z.object({
  capturedDate: z.string().nullable(),
  totalJpy: z.number(),
  tags: z.array(TodaiTagSchema),
  bigGroups: z.array(TodaiBigGroupSchema),
  assets: z.array(TodaiAssetSchema),
});
export type TodaiResponse = z.infer<typeof TodaiResponseSchema>;


// このツールが MF 経由で取得対象としている機関の白リスト。
// server / PWA / orchestrate / mf-check-status の全てで参照して整合性を取る。
export const TRACKED_MF_INSTITUTIONS = [
  '楽天銀行',
  '三菱UFJ銀行',
  '住信SBIネット銀行',
  '楽天証券',
  'SBI証券',
] as const;
export type TrackedMfInstitution = (typeof TRACKED_MF_INSTITUTIONS)[number];

// /api/mf-status — MF 連携口座の最新更新状況 (orchestrate が POST、PWA が GET)
export const MfAccountStatusItemSchema = z.object({
  institution: z.string(),
  inProgress: z.boolean(),
  hasError: z.boolean(),
  errorMessage: z.string().nullable(),
  lastUpdated: z.string().nullable(),
  checkedAt: z.string(),
  phase: z.string(),
});
export type MfAccountStatusItem = z.infer<typeof MfAccountStatusItemSchema>;

export const MfStatusResponseSchema = z.object({
  checkedAt: z.string().nullable(),
  accounts: z.array(MfAccountStatusItemSchema),
});
export type MfStatusResponse = z.infer<typeof MfStatusResponseSchema>;

// /api/ranking — 当日 (= 最新 capturedDate) と前日の差分で銘柄ランキング。
// cash は除外。query: sortBy (ratio|amount) / dir (asc|desc) / accountId? / categoryId?
export const RankingItemSchema = z.object({
  securityId: z.string(),
  symbol: z.string(),
  name: z.string(),
  currency: z.string(),
  assetClass: z.string(),
  totalValueJpy: z.number(),
  prevValueJpy: z.number().nullable(),
  diffJpy: z.number(),
  // 評価額ベースの騰落率 (株数変動の影響を含む)。前日値が無い (新規 / カバレッジ外) と null
  diffRatio: z.number().nullable(),
  // 単価ベースの騰落率 (株数の影響を除いた純粋な株価の動き)
  priceDiffRatio: z.number().nullable(),
  accounts: z.array(z.object({ institution: z.string(), label: z.string() })),
  categories: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type RankingItem = z.infer<typeof RankingItemSchema>;

export const RankingResponseSchema = z.object({
  capturedDate: z.string().nullable(),
  prevCapturedDate: z.string().nullable(),
  items: z.array(RankingItemSchema),
});
export type RankingResponse = z.infer<typeof RankingResponseSchema>;

// /api/sync-status — source ごとの同期状況サマリ (バナー / 設定の更新状況用)
export const SyncStatusSourceSchema = z.object({
  source: z.string(),
  latestRun: z
    .object({
      id: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      status: ScrapeStatusSchema,
      errorMsg: z.string().nullable(),
      accountsTouched: z.number(),
    })
    .nullable(),
  latestSuccessAt: z.string().nullable(),
  isStale: z.boolean(),
});
export type SyncStatusSource = z.infer<typeof SyncStatusSourceSchema>;

export const SyncStatusResponseSchema = z.object({
  overall: z.enum(['ok', 'error']),
  staleThresholdHours: z.number(),
  bySource: z.array(SyncStatusSourceSchema),
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;

// /api/fx/rates
export const FxRateInfoSchema = z.object({
  base: z.string(),
  quote: z.string(),
  rate: z.number(),
  capturedAt: z.string(),
  capturedDate: z.string(),
});
export type FxRateInfo = z.infer<typeof FxRateInfoSchema>;

export const FxRatesResponseSchema = z.object({
  rates: z.array(FxRateInfoSchema),
  ttlHours: z.number(),
  provider: z.string(),
});
export type FxRatesResponse = z.infer<typeof FxRatesResponseSchema>;
