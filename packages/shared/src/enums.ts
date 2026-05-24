export type AccountKind = 'bank' | 'brokerage';

export type Institution =
  | 'rakuten_bank'
  | 'mufg'
  | 'sbi_sumishin'
  | 'rakuten_sec'
  | 'sbi_sec'
  | 'webull'
  | 'moomoo';

export type DataSource =
  | 'moneyforward'
  | 'direct_scrape'
  | 'webull_api'
  | 'moomoo_api'
  | 'manual';

export type Currency = 'JPY' | 'USD' | 'HKD' | (string & {});

export type AssetClass =
  | 'cash'
  | 'stock'
  | 'etf'
  | 'mutual_fund'
  | 'reit'
  | 'bond'
  | 'crypto'
  | 'commodity'
  | 'other';

export type Region =
  | 'jp'
  | 'us'
  | 'hk'
  | 'cn'
  | 'eu'
  | 'em'
  | 'global'
  | 'other';

export type ScrapeStatus = 'ok' | 'error' | 'running' | 'needs_2fa';

export const INSTITUTION_LABELS: Record<Institution, string> = {
  rakuten_bank: '楽天銀行',
  mufg: '三菱UFJ銀行',
  sbi_sumishin: '住信SBIネット銀行',
  rakuten_sec: '楽天証券',
  sbi_sec: 'SBI証券',
  webull: 'Webull',
  moomoo: 'Moomoo',
};

export const INSTITUTION_KIND: Record<Institution, AccountKind> = {
  rakuten_bank: 'bank',
  mufg: 'bank',
  sbi_sumishin: 'bank',
  rakuten_sec: 'brokerage',
  sbi_sec: 'brokerage',
  webull: 'brokerage',
  moomoo: 'brokerage',
};

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  cash: '現金',
  stock: '個別株',
  etf: 'ETF',
  mutual_fund: '投資信託',
  reit: 'REIT',
  bond: '債券',
  crypto: '暗号資産',
  commodity: 'コモディティ',
  other: 'その他',
};

export const REGION_LABELS: Record<Region, string> = {
  jp: '日本',
  us: '米国',
  hk: '香港',
  cn: '中国',
  eu: '欧州',
  em: '新興国',
  global: 'グローバル',
  other: 'その他',
};
