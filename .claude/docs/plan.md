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

// 口座内の税区分 (NISA枠等)
export type SubAccount =
  | 'nisa_growth'     // NISA 成長投資枠
  | 'nisa_tsumitate'  // NISA つみたて投資枠
  | 'tokutei'         // 特定口座
  | 'ippan';          // 一般口座

// 取引種別 (Transaction.type)
export type TransactionType =
  | 'deposit' | 'withdraw'
  | 'buy' | 'sell'
  | 'transfer_in' | 'transfer_out'
  | 'fee' | 'tax' | 'interest';
```

### 6.2 Prisma schema

実体は [prisma/schema.prisma](../../prisma/schema.prisma) を正とする。要点だけ抜粋:

**Account** — 口座マスタ。`(institution, label)` で一意。

**Security** — 銘柄マスタ。`(symbol, exchange)` で一意。口座を跨いで共有。

**Holding** — 口座 × 銘柄のリンク。`(accountId, securityId, subAccount)` で一意。`subAccount` で NISA枠 / 特定 / 一般 を区別。

**AccountSnapshot** — 口座単位の時系列。`(accountId, capturedDate)` で一意 → **同日 upsert、日跨ぎ新行**。`totalValueJpy` / `cashJpy` を持つ。

**HoldingSnapshot** — 保有数量・評価額の時系列。`(holdingId, capturedDate)` で一意 → 銘柄別推移を AccountSnapshot を JOIN せず取得可。

**PriceSnapshot** — 銘柄価格の時系列 (watchlist 用、Holding が無くても保存可)。`(securityId, capturedDate)` で一意。

**FxRate** — 為替レート時系列。`(base, quote, capturedDate)` で一意。

**Transaction** (v1.5〜) — 入出金・売買・手数料等のイベント。`(accountId, externalId)` で重複防止。`type` で種別、`subAccount` で税区分。

**Dividend** (v1.5〜) — 配当受取専用 (Transaction とは別)。`exDate` / `recordDate` / `paidAt` / `dividendPerShare` 等の配当固有フィールド。NISA枠なら源泉ゼロ等の分析もしやすい。

**Category** + **SecurityCategory** — 投資テーマのマスタ + 多対多リンク。GICS とは別系統:
- GICS = `Security.sector` / `Security.industry` (固定タクソノミー、1 銘柄 1 値)
- テーマ = Category (半導体・量子・AI 等、1 銘柄複数値、weight 付き)
- `SecurityCategory.weight` で ETF 構成比 (QQQ: IT 0.5, 通信 0.2…) や個別株のサブ配分 (NVDA: 半導体 0.5, AI 0.5) を表現
- 初期 seed 31 テーマ ([scripts/prisma-seed.ts](../../scripts/prisma-seed.ts) で `pnpm db:seed`)、ユーザー任意追加可
- 階層 (`parentId`) で「半導体製造装置 ⊂ 半導体」のようなネスト対応

**ScrapeRun** — スクレイピング実行履歴。`status: 'ok' | 'error' | 'running' | 'needs_2fa'`。

### 6.3 設計ポイント

- **Security マスタ化**: 同一銘柄 (例: 7203 トヨタ) を 楽天証券 と SBI証券 で両方持っても、Security は 1 行。`SUM(quantity)` で複数証券またぎ集約が 1 クエリ
- **現金も Security**: `JPY_CASH` / `USD_CASH` / `HKD_CASH` を Security として持つ (assetClass='cash')。普通預金・MMF・証券口座内の余力すべて Holding として記録 → 通貨別・資産クラス別が同じクエリで取れる
- **`capturedDate` で同日 upsert**: AccountSnapshot / HoldingSnapshot / PriceSnapshot / FxRate に `capturedDate: String` (JST "YYYY-MM-DD") + `(主キー, capturedDate)` 複合 unique を持たせる。同日中に再 scrape しても 1 行に上書きされ、日跨ぎ時のみ新行 → **日次精度の履歴を最小コストで保持**
- **HoldingSnapshot は AccountSnapshot を JOIN せず直接時系列引ける**: `(holdingId, capturedDate)` 複合 unique で 1 銘柄 × 1 日 = 1 行が保証されるため、index 一発で銘柄推移グラフが描ける
- **AccountSnapshot は集計値**: `totalValueJpy` `cashJpy` を持ち、Holdings の SUM と一致するよう Worker 側で検算
- **`subAccount`** (NISA枠等): Holding / Transaction / Dividend で統一的に使う。v1 は null で開始、v1.5 で MF 取引履歴から識別
- **GICS vs テーマの分離**: `Security.sector/.industry` は固定タクソノミー (1 銘柄 1 値、自動取得想定)、Category は多値かつユーザー編集可。円グラフを GICS 別 / テーマ別で切り替え可能
- **Transaction / Dividend は schema 同梱、scraping は v1.5**: テーブルは今のマイグレーションで作る (後付け migrate を避ける)。データは MF 取引履歴ページから埋める
- **イベントの重複防止**: Transaction / Dividend は `externalId` (MF / 証券会社の取引 ID) + `(accountId, externalId)` unique で同じ取引を 2 度書き込まない
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

### 完了 (基盤)

- [x] §14-1 scaffold: pnpm workspaces 初期化 (corepack pnpm 11.2.2、4 workspaces)
- [x] `.env.example` / `.gitignore` 整備 (DATABASE_URL, ASSET_TRACKER_TOKEN, TAILSCALE_IP, PORT, LOG_LEVEL)
- [x] `tsconfig.base.json` 配置 (strict + noUncheckedIndexedAccess)
- [x] §14-2 `packages/shared`: enums + zod schemas + INSTITUTION/ASSET_CLASS/REGION 日本語ラベル
- [x] §14-3 Prisma schema: §6.2 全モデル (Account/AccountSnapshot/Security/Holding/HoldingSnapshot/PriceSnapshot/FxRate/ScrapeRun)
  - `prisma/schema.prisma` をリポルート、`apps/server/prisma.config.ts` で schema パス指定
  - Prisma 6.x の auto-install バグ (`pnpm add` が PATH 不在で fail) は **no-op shim** で回避: [scripts/install-prisma-shim.mjs](../../scripts/install-prisma-shim.mjs) を postinstall フックで配置
- [x] §14-4 Fastify 骨格 (`apps/server/src/index.ts`): /api/health (認証なし) + Bearer auth middleware で他全 route 保護 + Tailscale IP only bind
- [x] §14-5 keytar 配線 + credentials 登録 CLI

### 完了 (アダプタ実装)

- [x] §14-6 **MoneyForward adapter** ([apps/server/src/adapters/moneyforward/](../../apps/server/src/adapters/moneyforward/))
  - Playwright Persistent Context で MF ME ログインセッションを永続化
  - headful 必須 (headless は MF に 403 検出される) → `HEADLESS=1` のみ headless opt-in
  - 抽出: 銀行残高、株式 (個別株/ETF 自動判別)、投資信託 (region 自動判別)、FX
  - SBI証券 FX セクションは `sbi_sec_fx` 別 institution として独立計上
- [x] §14-7 為替更新: **frankfurter.app** (ECB ベース無料) を使用 (exchangerate.host は API key 必須化されたため変更)
- [x] §14-8 Webull adapter — HMAC-SHA1 署名実装済み、ただし 401 UNAUTHORIZED 継続中
  - サポート問い合わせ済 (clientservices@webull.co.jp、ソースコード添付)
  - 添付物: `data/webull-support/` (signer.js.txt + repro_python.py + README.md)
  - **状態: サポート返答待ち。動作未確認**
- [x] §14-9 **Moomoo adapter** (Futu OpenAPI) ([apps/server/src/adapters/moomoo/](../../apps/server/src/adapters/moomoo/))
  - Node ⇄ Python サブプロセス連携 (futu-api 公式 SDK は Python のみ)
  - OpenD (127.0.0.1:11111) を起動しておく必要あり
  - 通貨別現金分類済 (`accinfo_query` の `us_cash` / `jp_cash` / `hk_cash` 等を個別 Holding 化)
  - Windows cp932 文字化け対策: `PYTHONIOENCODING=utf-8` + `sys.stdout.reconfigure`

### 完了 (UI / 配信)

- [x] §14-10 API ルート群: `/api/accounts` `/api/accounts/:id/snapshots` `/api/run-now` `/api/runs` `/api/holdings` `/api/allocation` `/api/history/total` `/api/categories`
- [x] §14-11 PWA scaffold: Vite 6 + React 18 + Tailwind 4 + TanStack Query 5 + Dexie 4
- [x] §14-13 全画面実装: Dashboard / Accounts / Holdings / Categories / History / Settings
- [x] §14-14 Recharts でグラフ実装 (配分円グラフ・残高推移)
- [x] §14-15 PWA 化 (vite-plugin-pwa、manifest 設定)
- [x] §14-16 **Tailscale 配信** 完了
  - Fastify から PWA dist を `@fastify/static` で同一オリジン静的配信
  - `TAILSCALE_IP=127.0.0.1` で bind、`tailscale serve` が HTTPS プロキシ
  - PWA `apiFetch` は Endpoint 未設定 = 同一オリジン (relative URL) フォールバック
- [x] **テーマタグ機能** (半導体/AI/量子/宇宙/レアアース 等の many-to-many タグ + 自動タグ付け)
  - 「量子コンピュータ」→「量子関連」にリネーム済み (slug は quantum_computer のまま)
- [x] **PWA オフライン対応** ([commit 5d5facd])
  - `@tanstack/react-query-persist-client` + `idb-keyval` で React Query キャッシュを IndexedDB に 24h 永続化
  - Workbox `runtimeCaching` で `/api/*` を NetworkFirst (5s timeout → SW キャッシュ)
  - `SyncIndicator` にオフライン/キャッシュ表示モード追加 (CloudOff アイコン + `(cache)` バッジ)
- [x] **前日比表示** (Dashboard 総資産 / Holdings 銘柄別 / Categories テーマ別)
  - `/api/holdings`・`/api/categories` に `prevTotalValueJpy`・`prevCapturedDate` 追加
  - 「今日の紐付け × 前日価格」で算出 (市場変動のみ反映、タグ変更の影響を除外)
- [x] **Holdings モバイル対応 + 取得単価** (FX も個別株と同形式)
  - デスクトップ=テーブル / モバイル=カードレイアウト (`hidden md:block` / `md:hidden`)
  - 全体の加重平均取得単価 + 口座別取得単価 (投信は ×10,000 = 基準価額/万口 換算)
- [x] **「東大」ページ** ([apps/pwa/src/pages/Todai.tsx](../../apps/pwa/src/pages/Todai.tsx)) — 1銘柄=1タグの排他グルーピング
  - 既存 `Category(kind='todai')` + `parentId` で **2階層タグ** (大カテゴリ/小カテゴリ)、`SecurityCategory(weight=1)` で 1 銘柄 1 リンク強制 (スキーマ流用、3階層は拒否)
  - `/api/todai`: 集計(内側=大/外側=小) + タグ CRUD + 割当 + レバレッジ更新。大カテゴリ削除は子・割当を cascade
  - 現金含む全資産対象。**二重ドーナツ** (内側=大/外側=小・総資産比)。ラベルは d3 式の左右カラム衝突回避で配置 (横方向 leader)
  - 資産一覧は大カテゴリ別グループ表示 (未分類は最下部)、`<select>` でインライン割当 (PWA から操作可)
  - 画像の分類体系を適用済み (高確度28銘柄。残り36銘柄は未分類で手動割当待ち)
- [x] **レバレッジ** ([commit 待ち] migration `add_security_leverage`)
  - `Security.leverage` (現物=1 / ブル=正 / ベア=負)。名前から自動判定で投入 (SOXL=3, SBI日本株4.3ブル=4.3, MVLL/ARMG/NUGT/1570=2)
  - 東大の資産一覧に現物/Xブル/Xベア表示 + 数値入力で手動修正
  - **レバレッジ補正版ドーナツ**: 各銘柄を |倍率|×評価額 で集計 (タグ別配分と同構造・同順・同色)。**比較表**で非レバ→レバ込の%差を表示し増加を赤▲で強調

### 完了 (運用)

- [x] §14-17 **スケジュール同期** (Windows タスクスケジューラ)
  - [apps/server/scripts/scrape-all.ts](../../apps/server/scripts/scrape-all.ts) — `runAllAdapters()` を呼ぶ standalone CLI
  - [scripts/scheduled-sync.ps1](../../scripts/scheduled-sync.ps1) — 同期 + ログ追記 + (`-SuspendAfter` で) スリープ復帰
  - [scripts/register-scheduled-sync.ps1](../../scripts/register-scheduled-sync.ps1) — `Register-ScheduledTask` で `WakeToRun=$true` 登録
  - 実行時刻: **07:00 (朝)** と **15:35 (Tokyo close 後)** の 1 日 2 回
  - 完了後に PC をスリープに戻す (`rundll32 powrprof.dll,SetSuspendState`)
  - ログ: `logs/scheduled-sync.log`
  - **注意**: `.ps1` は UTF-8 BOM 付き必須 (PowerShell 5.1 が ANSI 解釈してパースエラーになるため)

### 申し送り事項 (未解決 / 後回し)

- [ ] **Webull adapter 401 問題** — サポート返答待ち。コード側は HMAC-SHA1 署名・パス・パラメータ全て Python SDK と一致確認済み。アカウント設定 (App key/secret/IP whitelist/permissions) 問題の可能性
- [ ] **IG証券**: API なし + MF も OTP 必須で自動取得不可。手動入力 UI が必要だが、優先度低 → **後回し**
- [ ] **PWA がスケジュール同期の結果を即時反映しない問題** (案 A で運用継続)
  - スケジュール: scrape:all は DB 更新するが、PC が即スリープに戻るためサーバが起動していない
  - PWA がデータを「見る」には、ユーザーが PC を起こして手動で `pnpm dev` 等でサーバを起動する必要がある
  - 案 B (スケジュール内でサーバ一時起動) / 案 C (サーバを Windows サービス化) は **将来必要なら検討**
- [ ] **未 push commit** が多数。push タイミングはユーザー判断
- [ ] **未使用ファイル**: [apps/pwa/src/db/dexie.ts](../../apps/pwa/src/db/dexie.ts) は React Query 永続化に置き換え済みで未使用 (削除禁止ルールのため残置)
- [ ] **個別銘柄の時系列グラフ** (UI 未実装、データは取得済み)
  - `HoldingSnapshot` テーブルが per-Account × Security × Date で `quantity` / `marketPriceNative` / `valueJpy` を保持
  - 必要なのは: `/api/history/holding?symbol=...` エンドポイント + [Holdings.tsx](../../apps/pwa/src/pages/Holdings.tsx) の銘柄行クリック → 個別グラフ画面
  - 描画候補: (a) 評価額推移 (b) 数量推移 (c) 単価推移
- [ ] **履歴データの遡及不可**: 5/24 以前のデータは開発中の DB 作り直しで消滅。5/25 以降は capturedDate ベースの日次 upsert で正常に積み上がる
- [ ] **東大タグ: 未分類36銘柄** の手動割当待ち (画像の見えていない行 = 個別株中心)。タグ階層は作成済みなのでドロップダウンで選ぶだけ
- [ ] **レバレッジ手動確認**: 自動判定は名前ベースのため、レバ銘柄は東大ページで倍率を確認・修正推奨
- [ ] **アーキテクチャ移行: Raspberry Pi を常時稼働サーバに**
  - 動機: 現状は PC スリープ中スマホから取得不可。スケジュール (07:00/15:35) 後の最新データを遠隔地で見るには PC 常時起動が必要
  - 提案: tailnet 上の `raspberrypi` (現在 offline) を起こして Fastify + SQLite を稼働
  - 役割分担: **PC = scraper 専用** (認証情報を持つ)、**Pi = サーバ役** (PWA リクエスト全捌き)
  - 流れ: PC scrape → 結果を Pi の `POST /api/sync` に送信 → PC はスリープへ。スマホはいつでも Pi へ tailnet 経由でアクセス
  - 別案: Cloudflare R2 + Worker (クラウド静的配信) も検討余地あり (Pi メンテ嫌な場合)

### UI ルール (CLAUDE.md に記載)

- 円グラフは PC・スマホ問わず必ず各要素の % を表示する (%なしの円グラフは禁止)
- 増減の強調色: **増加=赤 / 減少=緑** (東大の比較表 DeltaCell)

### ファイル配置メモ

- リポジトリ構成: pnpm workspaces (`apps/server` + `apps/pwa` + `packages/shared`)。Prisma schema はリポルート `prisma/schema.prisma` に集約
- secrets: `.env` は `.gitignore` 済み (`.env.example` を雛形として提供)
- Prisma の auto-install 回避策: `apps/server/node_modules/.bin/pnpm.CMD` の no-op shim は postinstall で自動再配置されるので `pnpm install` を再実行しても消えない
- PowerShell スクリプト (`scripts/*.ps1`) は **UTF-8 BOM** 必須。`.gitattributes` に `*.ps1 working-tree-encoding=UTF-8-BOM` 設定推奨 (未対応)
- スケジュールタスク登録は管理者 PowerShell で `powershell -ExecutionPolicy Bypass -File scripts/register-scheduled-sync.ps1`
- 電源オプションで「スリープ解除タイマーの許可」を有効化必須: `powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1`
