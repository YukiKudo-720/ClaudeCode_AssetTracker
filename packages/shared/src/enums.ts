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

export type SubAccount =
  | 'nisa_growth'      // NISA 成長投資枠
  | 'nisa_tsumitate'   // NISA つみたて投資枠
  | 'tokutei'          // 特定口座 (源泉徴収あり/なしは meta で区別)
  | 'ippan';           // 一般口座

export type TransactionType =
  | 'deposit'        // 入金
  | 'withdraw'       // 出金
  | 'buy'            // 買付
  | 'sell'           // 売却
  | 'transfer_in'    // 振替入庫 (他社から)
  | 'transfer_out'   // 振替出庫 (他社へ)
  | 'fee'            // 手数料
  | 'tax'            // 税金
  | 'interest';      // 利息 (預金/MMF)

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

export const SUB_ACCOUNT_LABELS: Record<SubAccount, string> = {
  nisa_growth: 'NISA成長',
  nisa_tsumitate: 'NISAつみたて',
  tokutei: '特定',
  ippan: '一般',
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  deposit: '入金',
  withdraw: '出金',
  buy: '買付',
  sell: '売却',
  transfer_in: '振替入庫',
  transfer_out: '振替出庫',
  fee: '手数料',
  tax: '税金',
  interest: '利息',
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
