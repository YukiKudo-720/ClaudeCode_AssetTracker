# 資産トラッカー (ClaudeCode_AssetTracker) 計画書

## 1. 目的

楽天/UFJ/住信SBI の銀行口座と、楽天証券/SBI証券/Webull/Moomoo の証券口座の残高・保有銘柄を **1 箇所に集約して時系列で見える化** する個人向け資産管理アプリ。

- **PC 内に閉じた認証情報** (各サービスのログイン credentials は PC の OS keychain から外に出さない)
- **PWA は閲覧専用** (Tailscale tailnet 越しに PC 内 API を叩く読み取りクライアント)
- **データソースは MoneyForward 集約 + 直接 API のハイブリッド** (日本の銀行/証券は MF 経由でまとめ、Webull/Moomoo は公式/準公式 API)
- **将来の UI 自由度を確保するためのデータ構造** (口座のグルーピング・タグ・任意メタを保持)

前 PJ `ClaudeCode_WishLog` の Firebase + Dexie + PWA スタックは "PWA 単体・データ全部クラウド" 前提だったため、本 PJ では **PC 側に Node.js バックエンド (Fastify + Prisma + Playwright)** を増設し、PWA は薄い閲覧クライアントに振り切る。

参考: [.claude/docs/plan_another_project.md](.claude/docs/plan_another_project.md)

---

## 2. プロジェクト名・配置

**`ClaudeCode_AssetTracker`** (確定)

- ローカル: `c:\Users\guilt\Projects\ClaudeCode_AssetTracker\`
- GitHub: `git@github.com:YukiKudo-720/ClaudeCode_AssetTracker.git`
- 構成: **モノレポ (pnpm workspaces)**。バックエンドと PWA をルート 1 リポで管理、型定義を `packages/shared` で共有

---

## 3. アーキテクチャ全体像

```
┌───────────────────────────────────────────────────────────────┐
│ PC (Windows 11)                                               │
│                                                               │
│   ┌─────────────┐ daily cron       ┌──────────────────┐       │
│   │ Worker      │ ────────────────▶│ Playwright       │──┐    │
│   │ (node-cron) │  + 手動トリガ    │  ・MoneyForward  │  │    │
│   └─────────────┘                  │  ・Webull        │  │    │
│         ▲                          │  ・Moomoo OpenD  │  │    │
│         │ trigger                  └──────────────────┘  │    │
│         │                                ▼               │    │
│   ┌─────┴───────────────────────────────────────┐        │    │
│   │ Fastify API (apps/server)                   │        │    │
│   │  /api/snapshots /api/holdings /api/run-now  │◀───────┘    │
│   └──────────────┬──────────────────────────────┘  write      │
│                  │ Prisma                                     │
│                  ▼                                            │
│   ┌──────────────────────────┐    ┌──────────────────────┐    │
│   │ SQLite (./data/db.sqlite)│    │ Windows Credential   │    │
│   │  時系列スナップショット  │    │ Manager (via keytar) │    │
│   └──────────────────────────┘    └──────────────────────┘    │
│                  ▲                                            │
└──────────────────┼────────────────────────────────────────────┘
                   │ HTTPS over Tailscale tailnet
                   │
┌──────────────────┴────────────────────────────────────────────┐
│ PWA (どこからでも閲覧、tailnet 内のみ到達可)                  │
│   React 18 + Vite 6 + Tailwind 4 + TanStack Query + Dexie     │
│   ・ダッシュボード / 口座別 / 銘柄別 / 履歴グラフ / フィルタ  │
└───────────────────────────────────────────────────────────────┘
```

ポイント:
- credentials は **Worker プロセスだけが keychain から読む**。API/PWA からは触れない
- PWA は API レスポンスを Dexie にミラーしてオフラインでも直近スナップショットを描画
- Worker は cron 起動 + API の `/api/run-now` 経由でも起動可

---

## 4. 技術スタック

### 4.1 PC 側 (`apps/server`)

| 層 | 採用 | 備考 |
|---|---|---|
| ランタイム | Node.js 22 + TypeScript | LTS、ESM |
| API | **Fastify 5** | 軽量、型サポート、Schema-first |
| ORM/DB | **Prisma 6 + SQLite** | 1 ユーザー用途、ファイル 1 個で完結。時系列クエリ問題なし |
| スクレイピング | **Playwright (chromium)** | MF/Webull/Moomoo web の自動操作 |
| スケジューラ | node-cron + Windows タスクスケジューラ | アプリ常駐 + OS レベル冗長化 |
| 認証情報保管 | **keytar** (Windows Credential Manager) | コードに secret を残さない |
| 為替レート | exchangerate.host (無料 API) | JPY 換算用、日次キャッシュ |
| ロギング | pino + pino-pretty | 構造化ログ |
| バリデーション | zod | shared package で PWA と共通 |
| プロセス管理 | pm2 (or 単純 `node dist/index.js`) | お好みで |
| テスト | vitest | 前 PJ 踏襲 |

### 4.2 PWA 側 (`apps/pwa`)

| 層 | 採用 | 備考 |
|---|---|---|
| フロント | React 18 + Vite 6 + TS + Tailwind 4 | 前 PJ 踏襲 |
| ルーティング | react-router-dom v6 | 同上 |
| PWA | vite-plugin-pwa (autoUpdate) | 同上 |
| データ取得 | **TanStack Query 5** | キャッシュ・再取得・stale 制御 |
| ローカルキャッシュ | Dexie.js + dexie-react-hooks | API 応答をミラー、オフライン閲覧 |
| グラフ | **Recharts** | 残高推移・資産配分 |
| フォーム | react-hook-form + zod | 設定画面用 |
| アイコン | lucide-react | 軽量 |
| 書体 | Noto Sans JP | |

### 4.3 共通 (`packages/shared`)

- zod スキーマ (`Account` / `Holding` / `Snapshot` 等)
- 型定義 (上記から `z.infer`)
- 機関識別子の enum

### 4.4 Tailscale (PWA 配信路)

- PC・スマホ・PWA を配信する任意のホストを同一 tailnet に参加
- Fastify は `0.0.0.0` ではなく **Tailscale IP (100.x.y.z) のみ bind**
- 追加で簡易 Bearer token (`.env` で発行) を `Authorization` ヘッダで検証

---

## 5. データソース戦略

| 機関 | 1 次手段 | フォールバック | 備考 |
|---|---|---|---|
| 楽天銀行 | MoneyForward 集約 | 直接 Web スクレイピング | MF が既に連携している |
| 三菱UFJ銀行 | MoneyForward 集約 | 直接 Web スクレイピング | 同上 |
| 住信SBIネット銀行 | MoneyForward 集約 | 直接 Web スクレイピング | 同上 |
| 楽天証券 | MoneyForward 集約 | 直接 Web スクレイピング | 保有銘柄まで MF で取得可 |
| SBI証券 | MoneyForward 集約 | 直接 Web スクレイピング | 同上 |
| Webull | **Webull 内部 API** (準公式) | スクレイピング | `webull` 系ライブラリの逆移植を JS で実装、もしくは Python サブプロセス |
| Moomoo (富途) | **Futu OpenAPI** | スクレイピング | ローカルで `OpenD` デーモンを起動して接続 |

戦略上のメリット: 日本 5 機関はすべて MF 1 つにログインすればまとめて取れる → Playwright のメンテ対象を MF だけに絞れる。

---

## 6. データモデル

### 設計原則

> "取れる情報は全部保存しておき、料理 (集計・フィルタ・グラフ化) は後から自由に作れる土台を用意する。"

これを実現するため、銘柄 (Security) を口座と独立した **マスタ** として持ち、口座と銘柄の関係を `Holding` で表現する。現金もまた 1 つの Security (`assetClass='cash'`) として扱うことで、通貨別・資産クラス別・銘柄別・口座別の集計を **すべて同じ形のクエリ** で書けるようにする。

### 6.1 enum / 識別子

```ts
// packages/shared/src/enums.ts
export type AccountKind = 'bank' | 'brokerage';

export type Institution =
  | 'rakuten_bank' | 'mufg' | 'sbi_sumishin'
  | 'rakuten_sec'  | 'sbi_sec' | 'webull' | 'moomoo';

export type DataSource =
  | 'moneyforward'    // MF スクレイピング経由
  | 'direct_scrape'   // 各機関を直接スクレイピング
  | 'webull_api'      // Webull 内部 API
  | 'moomoo_api'      // Futu OpenD
  | 'manual';         // 手入力 (現金など)

// v1 は JPY/USD/HKD のみ。EUR/GBP 等は文字列で追加可
export type Currency = 'JPY' | 'USD' | 'HKD' | string;

// 資産クラス (円グラフ・配分ビューの軸)
export type AssetClass =
  | 'cash'        // 現金・預金・MMF
  | 'stock'       // 個別株
  | 'etf'         // ETF (上場投信)
  | 'mutual_fund' // 投資信託 (非上場)
  | 'reit'        // REIT
  | 'bond'        // 債券
  | 'crypto'      // 暗号資産
  | 'commodity'   // 金・原油等
  | 'other';

// 地域 (国別配分ビューの軸)
export type Region =
  | 'jp' | 'us' | 'hk' | 'cn' | 'eu' | 'em' | 'global' | 'other';
```

### 6.2 Prisma schema

```prisma
// prisma/schema.prisma
datasource db { provider = "sqlite" url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

// 口座 (銀行口座 or 証券口座)
model Account {
  id            String   @id @default(cuid())
  kind          String   // AccountKind: bank | brokerage
  institution   String   // Institution
  source        String   // DataSource
  label         String   // ユーザー命名 例: "メイン口座"
  baseCurrency  String   // 口座の基準通貨 (JPY/USD/HKD)
  credentialRef String?  // keytar のキー名 (例: "mf:default")
  tags          String   @default("[]") // JSON array '["core","jp"]'
  meta          String   @default("{}") // 任意 JSON
  enabled       Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  snapshots     AccountSnapshot[]
  holdings      Holding[]
}

// 口座単位の時系列スナップショット (口座総額)
model AccountSnapshot {
  id               String   @id @default(cuid())
  accountId        String
  capturedAt       DateTime
  totalValueNative Decimal  // 現地通貨 総額 (cash + holdings)
  totalValueJpy    Decimal  // JPY 換算 総額
  cashNative       Decimal  // 現地通貨 現金部分 (証券口座でも cash position を抜き出し)
  cashJpy          Decimal  // JPY 換算 現金部分
  fxRate           Decimal? // 換算に使ったレート
  rawJson          String?  // 取得元の生データ (デバッグ用)
  Account          Account  @relation(fields: [accountId], references: [id])
  holdingSnapshots HoldingSnapshot[]
  @@index([accountId, capturedAt])
}

// 銘柄マスタ (口座を跨いで共有。同じ AAPL を 楽天証券 と Webull で持っても 1 行)
model Security {
  id          String   @id @default(cuid())
  symbol      String   // "7203", "AAPL", "0700.HK", "JPY_CASH" 等
  exchange    String?  // "TSE", "NASDAQ", "HKEX", null (現金は null)
  isin        String?  // 国際証券識別番号 (取得できれば)
  name        String   // 表示名 "トヨタ自動車", "Apple Inc", "日本円(現金)"
  currency    String   // 銘柄通貨 (JPY/USD/HKD)
  assetClass  String   // AssetClass
  region      String?  // Region
  sector      String?  // GICS セクター等 (取れれば)
  industry    String?  // 業種 (取れれば)
  tags        String   @default("[]") // 自由タグ "['watchlist','core']"
  meta        String   @default("{}") // 任意 JSON (時価総額・配当利回り等を将来追加)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  holdings    Holding[]
  prices      PriceSnapshot[]
  @@unique([symbol, exchange])
}

// 口座 × 銘柄 のリンク (この口座でこの銘柄を持っている、という事実)
model Holding {
  id         String   @id @default(cuid())
  accountId  String
  securityId String
  subAccount String?  // NISA成長/つみたて/特定/一般 等 (v1 では null 可)
  meta       String   @default("{}")
  createdAt  DateTime @default(now())
  Account    Account  @relation(fields: [accountId], references: [id])
  Security   Security @relation(fields: [securityId], references: [id])
  snapshots  HoldingSnapshot[]
  @@unique([accountId, securityId, subAccount])
}

// 保有数量・評価額の時系列 (Holding × 時点)
model HoldingSnapshot {
  id                String   @id @default(cuid())
  snapshotId        String   // AccountSnapshot との紐付け
  holdingId         String
  quantity          Decimal
  marketPriceNative Decimal
  marketPriceJpy    Decimal
  marketValueNative Decimal
  marketValueJpy    Decimal
  avgCostNative     Decimal?
  unrealizedPnlNative Decimal?
  unrealizedPnlJpy    Decimal?
  AccountSnapshot   AccountSnapshot @relation(fields: [snapshotId], references: [id])
  Holding           Holding         @relation(fields: [holdingId], references: [id])
  @@index([holdingId])
}

// 銘柄ごとの価格スナップショット (Holding がなくても watchlist 用に取れる)
model PriceSnapshot {
  id          String   @id @default(cuid())
  securityId  String
  capturedAt  DateTime
  priceNative Decimal
  priceJpy    Decimal
  Security    Security @relation(fields: [securityId], references: [id])
  @@index([securityId, capturedAt])
}

// 為替レート時系列
model FxRate {
  id         String   @id @default(cuid())
  base       String   // "USD" 等
  quote      String   // "JPY"
  rate       Decimal
  capturedAt DateTime
  @@index([base, quote, capturedAt])
}

// スクレイピング実行履歴 (UI で可視化)
model ScrapeRun {
  id              String   @id @default(cuid())
  source          String   // DataSource
  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  status          String   // "ok" | "error" | "running" | "needs_2fa"
  errorMsg        String?
  accountsTouched Int      @default(0)
}
```

### 6.3 設計ポイント

- **Security マスタ化**: 同一銘柄 (例: 7203 トヨタ) を 楽天証券 と SBI証券 で両方持っても、Security は 1 行。`SUM(quantity)` で複数証券またぎ集約が 1 クエリ
- **現金も Security**: `JPY_CASH` / `USD_CASH` / `HKD_CASH` を Security として持つ (assetClass='cash')。普通預金・MMF・証券口座内の余力すべて Holding として記録 → 通貨別・資産クラス別が同じクエリで取れる
- **AccountSnapshot は集計値**: `totalValueJpy` `cashJpy` を持ち、Holdings の SUM と一致するよう Worker 側で検算
- **`subAccount`** (NISA枠等) は v1 では null OK だが、unique 制約に含めて将来 NISA成長 / NISAつみたて / 特定 / 一般 を区別できる余地を残す
- **`meta` / `tags` / `rawJson`**: 後から分析パターンを増やせる遊び (例: meta に配当利回り、tags に "watchlist")
- **論理削除なし**: `enabled=false` でフィルタ。Security は基本削除しない (履歴を壊さないため)
- **整数精度**: SQLite + Prisma Decimal で 2 通貨混在の精度問題を回避

### 6.4 ビュー例 (要望が成立することの確認)

要望された 4 種のビューが、すべて単純な GROUP BY で書けることを示す。

**(1) 通貨別保有額・割合**
```sql
SELECT s.currency, SUM(hs.marketValueJpy) AS total_jpy
FROM HoldingSnapshot hs
JOIN Holding h ON h.id = hs.holdingId
JOIN Security s ON s.id = h.securityId
JOIN AccountSnapshot ascpr ON ascpr.id = hs.snapshotId
WHERE ascpr.capturedAt = (SELECT MAX(capturedAt) FROM AccountSnapshot)
GROUP BY s.currency;
```

**(2) 現金 / 日本株 / 米株の配分**
```sql
SELECT
  s.assetClass,
  s.region,
  SUM(hs.marketValueJpy) AS total_jpy
FROM HoldingSnapshot hs
JOIN Holding h ON h.id = hs.holdingId
JOIN Security s ON s.id = h.securityId
-- 直近の AccountSnapshot のみ
WHERE hs.snapshotId IN (
  SELECT id FROM AccountSnapshot WHERE capturedAt = (SELECT MAX(capturedAt) FROM AccountSnapshot)
)
GROUP BY s.assetClass, s.region;
-- → ('cash','jp') / ('stock','jp') / ('stock','us') / ('etf','us') ...
```

**(3) 銘柄別の保有額 (複数証券またぎ集約)**
```sql
SELECT
  s.symbol, s.name,
  SUM(hs.quantity)         AS total_qty,
  SUM(hs.marketValueJpy)   AS total_jpy,
  GROUP_CONCAT(DISTINCT a.institution) AS held_in -- 楽天証券,SBI証券 のように
FROM HoldingSnapshot hs
JOIN Holding h ON h.id = hs.holdingId
JOIN Security s ON s.id = h.securityId
JOIN Account a ON a.id = h.accountId
WHERE hs.snapshotId IN (
  SELECT id FROM AccountSnapshot WHERE capturedAt = (SELECT MAX(capturedAt) FROM AccountSnapshot)
)
GROUP BY s.id
ORDER BY total_jpy DESC;
```

**(4) 資産推移 (時系列)**
```sql
-- 総資産の日次推移
SELECT DATE(capturedAt) AS day, SUM(totalValueJpy) AS total
FROM AccountSnapshot
GROUP BY DATE(capturedAt)
ORDER BY day;

-- 銘柄別の保有数量推移 (例: AAPL)
SELECT DATE(asn.capturedAt) AS day, SUM(hs.quantity) AS qty, SUM(hs.marketValueJpy) AS value
FROM HoldingSnapshot hs
JOIN Holding h ON h.id = hs.holdingId
JOIN Security s ON s.id = h.securityId
JOIN AccountSnapshot asn ON asn.id = hs.snapshotId
WHERE s.symbol = 'AAPL'
GROUP BY DATE(asn.capturedAt)
ORDER BY day;
```

実装上は Prisma の `groupBy` / 生 SQL で書いて API レスポンスとして返す。PWA 側は Recharts に渡すだけ。

### 6.5 PWA への反映フロー (sync flow)

> SQLite は PC ローカルに置く。PWA はネットワーク越しに API を叩いて表示するが、オフラインや回線不調時も最後に見た値が出るようにする。

```
[PC]                              [PWA (スマホ/PC ブラウザ)]
SQLite ──Prisma──▶ Fastify API ◀──HTTPS over Tailscale──── TanStack Query
                                                                  │
                                                                  ▼
                                                              Dexie (IndexedDB)
                                                                  │ liveQuery
                                                                  ▼
                                                              React コンポーネント
```

- **fetch**: TanStack Query が API を 60 秒間隔で polling (`refetchInterval`)、画面復帰時にも自動再取得 (`refetchOnWindowFocus`)
- **キャッシュ**: 取得した JSON を Dexie にミラー (`bulkPut`)。Dexie は IndexedDB に永続化されるので PWA を閉じても残る
- **描画**: React コンポーネントは Dexie の `liveQuery` を購読 → DB が変わったら自動再描画。前 PJ (WishLog) の Firestore → Dexie パターンと同じ構造
- **オフライン**: API 不到達なら TanStack Query は無音で失敗、Dexie の最後の値で描画継続。`SyncIndicator` が「最終同期: X 分前」と正直に表示
- **手動 sync**: `RunNowButton` → `POST /api/run-now` → Worker がスクレイピング → 完了後 `GET /api/...` を再取得 (TanStack Query の `invalidateQueries`)
- **転送量**: 1 レスポンス数 KB〜十数 KB 程度想定 (口座 7 + 銘柄数十 + 時系列 90 日分)。圧縮 (gzip) は Fastify 標準で有効化

---

## 7. ディレクトリ構成

```
ClaudeCode_AssetTracker/
├─ apps/
│  ├─ server/                         # PC 側バックエンド
│  │  ├─ src/
│  │  │  ├─ index.ts                  # Fastify エントリ
│  │  │  ├─ routes/
│  │  │  │   ├─ accounts.ts
│  │  │  │   ├─ snapshots.ts
│  │  │  │   ├─ holdings.ts
│  │  │  │   └─ run.ts                # POST /api/run-now
│  │  │  ├─ worker/
│  │  │  │   ├─ scheduler.ts          # node-cron
│  │  │  │   ├─ runAll.ts             # 全 adapter を順次実行
│  │  │  │   └─ fxUpdate.ts
│  │  │  ├─ adapters/
│  │  │  │   ├─ moneyforward/         # Playwright scenarios
│  │  │  │   ├─ webull/               # API client
│  │  │  │   └─ moomoo/               # Futu OpenD client
│  │  │  ├─ lib/
│  │  │  │   ├─ db.ts                 # Prisma client
│  │  │  │   ├─ credentials.ts        # keytar wrapper
│  │  │  │   ├─ fx.ts                 # 為替取得
│  │  │  │   └─ auth.ts               # Bearer token middleware
│  │  │  └─ types/
│  │  ├─ prisma/                      # 共通 schema は repo root に置く案も
│  │  └─ package.json
│  └─ pwa/                            # 閲覧クライアント
│     ├─ src/
│     │  ├─ main.tsx
│     │  ├─ App.tsx
│     │  ├─ api/                      # TanStack Query フック
│     │  ├─ db/                       # Dexie schema (キャッシュ)
│     │  ├─ pages/
│     │  │   ├─ Dashboard.tsx         # 総資産 + カテゴリ別ドーナツ
│     │  │   ├─ Accounts.tsx          # 口座一覧
│     │  │   ├─ AccountDetail.tsx     # 口座詳細 + 残高グラフ
│     │  │   ├─ Holdings.tsx          # 保有銘柄横断
│     │  │   ├─ History.tsx           # 時系列グラフ
│     │  │   └─ Settings.tsx          # API endpoint / token / グループ設定
│     │  ├─ components/
│     │  │   ├─ AssetChart.tsx
│     │  │   ├─ AccountCard.tsx
│     │  │   ├─ HoldingRow.tsx
│     │  │   ├─ CurrencyToggle.tsx    # JPY ⇄ native
│     │  │   ├─ TagFilter.tsx
│     │  │   └─ RunNowButton.tsx
│     │  └─ index.css
│     └─ package.json
├─ packages/
│  └─ shared/                         # 型・zod schema 共有
│     ├─ src/
│     │  ├─ enums.ts
│     │  ├─ schemas.ts
│     │  └─ index.ts
│     └─ package.json
├─ prisma/                            # ルートに schema 集約
│  └─ schema.prisma
├─ data/                              # SQLite ファイル (.gitignore)
├─ .env / .env.example
├─ pnpm-workspace.yaml
├─ package.json
└─ .claude/
   └─ docs/
      ├─ plan.md
      └─ plan_another_project.md
```

---

## 8. API 設計 (Fastify)

全エンドポイントは `Authorization: Bearer <ASSET_TRACKER_TOKEN>` を要求。

```
GET  /api/health                       生存確認 (token 不要)
GET  /api/accounts                     口座一覧 + 直近残高
GET  /api/accounts/:id                 口座詳細
GET  /api/accounts/:id/snapshots       時系列スナップショット (?from=&to=)
GET  /api/holdings                     保有銘柄横断 (?accountId=&currency=)
GET  /api/holdings/:id/snapshots       銘柄時系列
GET  /api/summary                      総資産・通貨別・タグ別集計
GET  /api/fx?base=USD&quote=JPY        為替レート時系列
POST /api/run-now                      スクレイピング即時実行 (body で source 指定可)
GET  /api/runs                         直近の ScrapeRun 履歴
```

レスポンスは zod スキーマで型付け、`packages/shared` で PWA と共有。

---

## 9. PWA 画面と動線

```
/                       Dashboard: 総資産・通貨別・タグ別ドーナツ + 直近 N 日推移
/accounts               口座一覧 (institution × 残高 × 最終更新)
/accounts/:id           口座詳細 (残高グラフ + 保有銘柄 + 直近スクレイプ結果)
/holdings               全保有銘柄横断 (sort/filter)
/holdings/:symbol       銘柄詳細 (口座またぎ集約 + 価格推移)
/history                総資産推移 (期間切替: 1M/3M/1Y/ALL)
/settings               API endpoint / Bearer token / タグ管理 / 通貨切替既定
```

ヘッダー: `[ダッシュボード] [口座] [銘柄] [履歴]` + `RunNowButton` + 最終同期時刻 + `CurrencyToggle`。

URL に状態を保持 (`/holdings?currency=USD&account=webull&tag=core`)。

---

## 10. セキュリティ設計

| 観点 | 対応 |
|---|---|
| Credentials | Windows Credential Manager (keytar) に保存。コード/DB/PWA から不可視 |
| Worker のみ keytar 参照 | `lib/credentials.ts` を Worker でのみ import、API ルートからは import 禁止 (eslint rule) |
| API 公開範囲 | Fastify を **Tailscale IP のみ bind**。LAN/インターネット側に bind しない |
| API 認証 | Bearer token (`.env` の `ASSET_TRACKER_TOKEN`)。PWA は Settings から入力し localStorage に保存 |
| `.env` | `.gitignore` 済み。token は `openssl rand -hex 32` で生成 |
| Playwright session | `userDataDir` を `data/playwright-profiles/<institution>/` に永続化、2FA 通過後の状態を再利用 |
| 2FA 通知 | MF 等で 2FA を要求された場合、Worker が `ScrapeRun.status="needs_2fa"` を記録。Dashboard に警告バッジ |
| ログ | credentials を絶対に log に出さない pino redact 設定 |

---

## 11. スクレイピング/同期戦略

- **頻度**: 平日 19:00 JST (米国市場クローズ後) に 1 回 + 手動 `/api/run-now`
- **順序**: MoneyForward → Webull → Moomoo → 為替 → 集計 (前段失敗しても後段は実行)
- **冪等性**: `AccountSnapshot.capturedAt` を runId に紐付け、同じ run で 2 度書かない
- **エラー時**: ScrapeRun に記録、Dashboard で可視化。リトライは次回 cron に任せる (即時リトライしない)
- **タイムアウト**: Playwright 全体 5 分、各 navigation 30 秒
- **ヘッドレス**: 本番は headless、デバッグ時は `HEADFUL=1` で可視化

---

## 12. v1 スコープ

含む:
- 7 機関すべての残高取得 (証券は保有銘柄まで)
- 1 日 1 回の自動取得 + 手動トリガ
- 多通貨 (JPY + native 両方保持、UI 切替)
- 為替レート自動取得
- Dashboard / Accounts / Holdings / History / Settings の 5 画面
- 任意タグでのグルーピング
- Tailscale 経由 PWA 配信
- スクレイピング失敗の可視化

v2 以降:
- 取引履歴 (入出金・売買)
- 配当受取の集約
- リバランシング提案
- 資産配分目標との乖離アラート
- インポート/エクスポート (CSV/JSON)
- MoneyForward 以外への直接接続フォールバック実装
- Webull/Moomoo の口座増設対応 (米国株/香港株分離)

---

## 13. 前 PJ Lessons learned の反映

| 前 PJ の教訓 | 本 PJ での対応 |
|---|---|
| Spreadsheet 同期の遅さ・phantom 行 | Prisma + 型付き SQLite で構造的に発生しない |
| GAS no-cors POST の確認不能 | Fastify は HTTP レスポンスで確認可能 |
| 編集時の同期ノイズ | PWA は読み取り専用なので発生しない |
| WebFetch deny で外部資産取得不可 | PWA は API しか叩かない。アイコンはローカル生成 |
| `Write(**)` で外部書込がすり抜け | プランは `.claude/docs/` に集約、settings.json で `Write(./**)` 維持 |
| 同期インジケータの嘘 | `ScrapeRun` テーブルに事実を記録、UI はそれを忠実に表示 |
| Firebase Auth の単一ユーザー前提 | Bearer token + Tailscale で同等のシンプルさ |

---

## 14. 実装ステップ案

1. **scaffold**: pnpm workspaces 初期化、`apps/server` `apps/pwa` `packages/shared` を空雛形で配置
2. **shared 型**: enums + zod schema 定義
3. **Prisma + DB**: schema 投入、`prisma migrate dev` で SQLite 初期化、seed スクリプト
4. **Fastify 骨格**: `/api/health` + Bearer auth ミドルウェア + Tailscale IP bind
5. **keytar 配線**: credentials 登録 CLI (`pnpm dlx tsx scripts/set-credentials.ts mf`)
6. **MoneyForward adapter**: Playwright で MF ME にログイン → 資産一覧ページから残高/保有銘柄抽出 → AccountSnapshot/HoldingSnapshot へ書き込み
7. **為替更新**: exchangerate.host を叩いて `FxRate` 更新
8. **Webull adapter** → **Moomoo adapter** の順で追加
9. **スケジューラ**: node-cron 配線、`scripts/run-once.ts` 手動実行用
10. **API ルート群**: accounts / snapshots / holdings / summary / run / runs
11. **PWA scaffold**: Vite + React + Tailwind + Router、AuthGate 相当 (token 入力)
12. **TanStack Query + Dexie ミラー**: API → Dexie → liveQuery の三段
13. **画面実装**: Dashboard → Accounts → AccountDetail → Holdings → History → Settings
14. **Recharts**: 残高推移 / 配分ドーナツ
15. **PWA 化**: vite-plugin-pwa、アイコン生成 (sharp)
16. **Tailscale**: tailnet 参加・bind 検証・スマホから疎通確認
17. **Windows タスクスケジューラ**: 起動時に server を立ち上げ、日次 cron は server 内 node-cron に任せる構成
18. **テスト**: adapters (Playwright モック) / API / 集計関数
19. **手動 QA**: 実機関ログイン → 1 サイクル走らせて全画面で実値を確認

---

## 15. ユーザー作業 (実装着手前/中)

実装前:
- [ ] GitHub repo 作成: `git@github.com:YukiKudo-720/ClaudeCode_AssetTracker.git` (確定)
- [ ] Tailscale を PC + スマホにインストール、tailnet 参加 (手順は §15.1)

実装途中で各 1 回:
- [ ] MoneyForward ME アカウントで 7 機関すべて連携済み確認
- [ ] Webull API キー取得 (もしくはアプリパスワード)
- [ ] Moomoo OpenD インストール + 富途アカウント API パスワード設定
- [ ] keytar に各 credential 登録 (`scripts/set-credentials.ts` 経由)
- [ ] `ASSET_TRACKER_TOKEN` 発行 → PWA Settings に入力

### 15.1 Tailscale セットアップ手順

目標: PC で動く Fastify API + 静的配信される PWA を、外出先のスマホからも `https://<host>.<tailnet>.ts.net` で開けるようにする。Let's Encrypt 証明書は Tailscale が自動発行。所要 15 分。

#### Step 1: アカウント作成

1. ブラウザで [tailscale.com](https://tailscale.com) を開き、右上 **Use Tailscale Free** → Google アカウントでサインイン (Microsoft/GitHub も可)
2. 個人利用なら **Personal** プランで OK (デバイス 100 台まで無料)
3. ログイン後の admin console (`login.tailscale.com/admin`) を一度開く

#### Step 2: PC にインストール

1. [tailscale.com/download/windows](https://tailscale.com/download/windows) から MSI をダウンロード→インストール
2. インストール完了後、タスクトレイの Tailscale アイコン → **Log in...** → ブラウザが開く → Step 1 と同じアカウントで承認
3. PowerShell で IP とホスト名を確認:
   ```powershell
   tailscale ip -4
   # 例: 100.101.102.103
   tailscale status
   # 例: 100.101.102.103   your-pc-name        you@gmail.com   windows   -
   ```
4. tailnet 名 (例: `tail1234.ts.net`) は admin console の DNS タブで確認

#### Step 3: MagicDNS と HTTPS を有効化

admin console で 1 回だけ設定:

1. **DNS** タブ → **Enable MagicDNS** をオン (デバイスをホスト名で呼べるようになる)
2. **DNS** タブ → **HTTPS Certificates** → **Enable HTTPS** をオン (Let's Encrypt の自動発行を有効化)

#### Step 4: スマホにインストール

1. iOS: App Store / Android: Play Store で "Tailscale" を検索→インストール
2. アプリ起動 → Step 1 と同じアカウントでサインイン
3. VPN 接続許可ダイアログを承認 (常時 ON にしておけば外出先でも自動的に tailnet に入る)
4. 接続できているかブラウザで `http://<pc-tailscale-hostname>` を試す (Step 5 完了後)

#### Step 5: Fastify を Tailscale IP のみで bind

`apps/server/src/index.ts` (実装時) で:

```ts
const TAILSCALE_IP = process.env.TAILSCALE_IP; // .env で指定
await fastify.listen({ host: TAILSCALE_IP, port: 3000 });
```

`.env`:
```
TAILSCALE_IP=100.101.102.103   # Step 2 で確認した値
ASSET_TRACKER_TOKEN=<openssl rand -hex 32 の出力>
```

#### Step 6: Tailscale Serve で HTTPS 化

`tailscale serve` を使うと、localhost で動いてる HTTP サーバを `https://<host>.<tailnet>.ts.net` で公開できる。証明書は Tailscale が自動更新。

```powershell
# API (Fastify) を HTTPS で公開
tailscale serve --bg --https=443 http://localhost:3000

# 状態確認
tailscale serve status
```

これで PWA からは `https://your-pc-name.tail1234.ts.net/api/health` のような URL で叩ける。

#### Step 7: PWA は同一オリジンで配信 (推奨)

CORS とトークン管理を単純化するため、PWA も Fastify が静的配信する構成にする:

```ts
// apps/server/src/index.ts
await fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../../pwa/dist'),
});
```

これで `https://your-pc-name.tail1234.ts.net/` → PWA、`/api/*` → API、と単一オリジンで完結。

#### Step 8: 動作確認

1. スマホで Tailscale を ON にする
2. ブラウザで `https://your-pc-name.tail1234.ts.net/` を開く → PWA が表示される
3. Settings 画面で `ASSET_TRACKER_TOKEN` を入力 → ダッシュボードが表示される
4. PWA を「ホーム画面に追加」して完了

#### Step 9: 自宅外で使うときの注意

- スマホの Tailscale は VPN プロファイル扱いなので、設定で **常時 ON** にしておく
- 4G/5G/外部 Wi-Fi 経由でも tailnet 内の PC に到達できる (Tailscale が relay/NAT 越えを処理)
- PC を起動していない時は当然繋がらない → PC は常時 ON か Wake-on-LAN を併用

#### トラブルシューティング

| 症状 | 対処 |
|---|---|
| スマホから繋がらない | PC で `tailscale status` 確認、スマホ Tailscale アプリで VPN が ON か確認 |
| `https://...` で証明書エラー | Step 3 の HTTPS Certificates が有効か再確認、`tailscale cert <hostname>` を 1 回手動実行 |
| `tailscale serve` がポートを掴めない | 管理者権限で PowerShell を開き直す |
| PC 再起動後に Serve 設定が消える | `tailscale serve --bg` の `--bg` (バックグラウンド永続化) が付いているか確認 |

---

## 16. 確認事項 (実装開始前)

- [x] プロジェクト名 → `ClaudeCode_AssetTracker`
- [x] アーキテクチャ → PC バックエンド + PWA 閲覧、Tailscale 越し
- [x] MF 連携 → Playwright スクレイピング
- [x] データ粒度 → 残高 + 保有銘柄 (証券のみ詳細)
- [x] ストレージ → SQLite + Prisma (PC ローカル)
- [x] 公開手段 → Tailscale tailnet
- [x] 実行頻度 → 1 日 1 回 + 手動トリガ
- [x] 多通貨 → JPY + native 両方保持
- [x] アプリ配色/トーン → **Wealth Navy & Gold** (投資家向け定番、後から変更可)
      - primary `#0B2545` (深紺、信頼感)
      - accent  `#C9A227` (落ち着いたゴールド、富の象徴で派手すぎない)
      - positive `#15803D` (利益表示、緑)
      - negative `#B91C1C` (損失表示、赤)
      - bg `#F8F7F2` (オフホワイト、長時間閲覧でも疲れない)
      - bg-elevated `#FFFFFF` (カード/モーダル)
      - text `#0F1B2D` / text-muted `#5B6B7E`
- [x] GitHub repo → `git@github.com:YukiKudo-720/ClaudeCode_AssetTracker.git`
- [ ] Tailscale セットアップ → §15.1 の手順で実施

---

## 17. 次の作業

### 完了

- [x] §14-1 scaffold: pnpm workspaces 初期化 (corepack pnpm 11.2.2、4 workspaces)
- [x] `.env.example` / `.gitignore` 整備 (DATABASE_URL, ASSET_TRACKER_TOKEN, TAILSCALE_IP, PORT, LOG_LEVEL)
- [x] `tsconfig.base.json` 配置 (strict + noUncheckedIndexedAccess)
- [x] §14-2 `packages/shared`: enums + zod schemas + INSTITUTION/ASSET_CLASS/REGION 日本語ラベル
- [x] §14-3 Prisma schema: §6.2 全モデル (Account/AccountSnapshot/Security/Holding/HoldingSnapshot/PriceSnapshot/FxRate/ScrapeRun)
  - `prisma/schema.prisma` をリポルート、`apps/server/prisma.config.ts` で schema パス指定
  - Prisma 6.x の auto-install バグ (`pnpm add` が PATH 不在で fail) は **no-op shim** で回避: [scripts/install-prisma-shim.mjs](../../scripts/install-prisma-shim.mjs) を postinstall フックで配置
- [x] §14-4 Fastify 骨格 (`apps/server/src/index.ts`): /api/health (認証なし) + Bearer auth middleware で他全 route 保護 + Tailscale IP only bind
- [x] §14-10 API ルート初期実装: `/api/accounts` `/api/accounts/:id/snapshots` `/api/run-now` `/api/runs`
- [x] §14-11 PWA scaffold: Vite 6 + React 18 + Tailwind 4 + TanStack Query 5 + Dexie 4
- [x] §14-13 5 画面骨格: Dashboard / Accounts / Holdings / History / Settings + Layout + SyncIndicator
- [x] 全 3 workspaces typecheck 通過

### 次の TODO (実装フェーズ)

- [ ] §14-5 keytar 配線 + credentials 登録 CLI (`scripts/set-credentials.ts`)
- [ ] §14-6 **MoneyForward adapter** (最大の山。Playwright で MF ME ログイン → 資産一覧から残高/銘柄抽出)
  - 着手前に確認: 2FA 方式 (SMS / 認証アプリ / メール)、初回ログインの手動承認手順
- [ ] §14-7 為替更新 (exchangerate.host)
- [ ] §14-8 Webull adapter
- [ ] §14-9 Moomoo adapter (OpenD 経由)
- [ ] §14-12 TanStack Query → Dexie ミラー実装
- [ ] §14-14 Recharts でグラフ実装
- [ ] §14-15 PWA 化 (icons + manifest 充実)
- [ ] §14-16 Tailscale Step 5-9 (Fastify bind + serve + 静的配信 + 実機確認)
- [ ] §14-17 Windows タスクスケジューラ登録
- [ ] §14-18 テスト
- [ ] §14-19 手動 QA

### ファイル配置メモ

- リポジトリ構成: pnpm workspaces (`apps/server` + `apps/pwa` + `packages/shared`)。Prisma schema はリポルート `prisma/schema.prisma` に集約
- secrets: `.env` は `.gitignore` 済み (`.env.example` を雛形として提供)
- Prisma の auto-install 回避策: `apps/server/node_modules/.bin/pnpm.CMD` の no-op shim は postinstall で自動再配置されるので `pnpm install` を再実行しても消えない
