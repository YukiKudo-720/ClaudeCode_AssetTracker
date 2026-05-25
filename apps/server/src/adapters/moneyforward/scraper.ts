// 注: env var (PLAYWRIGHT_BROWSERS_PATH 等) は entry script で env.ts を import 済みの前提
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Institution, Region } from '@asset-tracker/shared';
import { NeedsLoginError } from '../types.js';
import { MF_USER_DATA_DIR, MF_URLS } from './profile.js';
import type { AccountUpdate, HoldingUpdate } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', 'data', 'mf-debug');

async function dumpDebug(page: Page, slug: string): Promise<void> {
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    const url = page.url();
    const title = await page.title().catch(() => '<no title>');
    await page.screenshot({ path: path.join(DEBUG_DIR, `${slug}.png`), fullPage: true });
    const html = await page.content();
    writeFileSync(path.join(DEBUG_DIR, `${slug}.html`), html, 'utf8');
    writeFileSync(
      path.join(DEBUG_DIR, `${slug}.txt`),
      `URL: ${url}\nTitle: ${title}\n`,
      'utf8',
    );
    console.error(`[debug] dumped: ${DEBUG_DIR}\\${slug}.{png,html,txt}`);
    console.error(`[debug] URL: ${url}`);
  } catch {
    // dumping shouldn't mask the original error
  }
}

// MF 上の機関名 → 内部 Institution slug。これに無い機関は無視 (IG/松井/カード等)
const INSTITUTION_MAP: Record<string, Institution> = {
  楽天銀行: 'rakuten_bank',
  三菱UFJ銀行: 'mufg',
  住信SBIネット銀行: 'sbi_sumishin',
  楽天証券: 'rakuten_sec',
  SBI証券: 'sbi_sec',
};

const BANK_INSTITUTIONS = new Set<Institution>(['rakuten_bank', 'mufg', 'sbi_sumishin']);

function parseAmount(text: string): number {
  return Number(text.replace(/[円¥,\s ]/g, '')) || 0;
}

// MF の "種類・名称" 欄から通貨を検出
function detectCashCurrency(label: string): string {
  if (/米ドル|\bUSD\b|（USD）|\(USD\)/.test(label)) return 'USD';
  if (/香港ドル|\bHKD\b|（HKD）|\(HKD\)/.test(label)) return 'HKD';
  if (/ユーロ|\bEUR\b|（EUR）|\(EUR\)/.test(label)) return 'EUR';
  if (/人民元|\bCNY\b|\bCNH\b/.test(label)) return 'CNY';
  return 'JPY';
}

function regionFromCurrency(currency: string): Region {
  switch (currency) {
    case 'JPY': return 'jp';
    case 'USD': return 'us';
    case 'HKD': return 'hk';
    case 'CNY':
    case 'CNH': return 'cn';
    case 'EUR': return 'eu';
    default: return 'other';
  }
}

function buildCashHolding(currency: string, nativeAmount: number): HoldingUpdate {
  return {
    symbol: `${currency}_CASH`,
    name: `${currency} 現金`,
    currency,
    assetClass: 'cash',
    region: regionFromCurrency(currency),
    quantity: nativeAmount,
    marketPriceNative: 1,
  };
}

interface AccountRow {
  id: string;
  name: string;
  balanceJpy: number;
}

interface CashRow {
  label: string;
  amountJpy: number;
}

interface RawStockRow {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;     // MF column 3: 平均取得単価 (native: JP は JPY/株、US は USD/株)
  currentPrice: number; // MF column 4: 現在値 (native: JP は JPY/株、US は USD/株)
  marketValue: number; // MF column 5: 評価額 (常に JPY 換算)
}

interface RawMfRow {
  name: string;
  quantity: number;
  avgCost: number;
  marketValue: number;
}

interface BrokerageDetail {
  cashJpy: number;
  cashBreakdown: CashRow[];
  stocks: RawStockRow[];
  mutualFunds: RawMfRow[];
}

async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto(MF_URLS.home, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const url = page.url();
  if (url.includes('sign_in') || url.includes('id.moneyforward.com')) {
    throw new NeedsLoginError('moneyforward', 'セッションが切れています。再ログインしてください');
  }
}

async function scrapeAccountList(page: Page): Promise<AccountRow[]> {
  await page.goto(MF_URLS.accounts, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('#account-table', { timeout: 10_000 });
  } catch (err) {
    // 失敗時の状態を data/mf-debug/ に保存
    await dumpDebug(page, 'accounts-timeout');
    throw err;
  }

  const rawRows = await page.$$eval('#account-table tr[id]', (trs) =>
    trs.map((tr) => {
      const link = tr.querySelector('td.service a');
      const number = tr.querySelector('td.number');
      const href = link?.getAttribute('href') ?? '';
      const idMatch = href.match(/\/accounts\/show\/(.+)$/);
      return {
        id: idMatch?.[1] ?? '',
        name: link?.textContent?.trim() ?? '',
        balanceText: number?.textContent?.trim() ?? '',
      };
    }),
  );

  return rawRows.map((r) => ({
    id: r.id,
    name: r.name,
    balanceJpy: parseAmount(r.balanceText),
  }));
}

async function scrapeBrokerageDetail(page: Page, accountId: string, label: string): Promise<BrokerageDetail> {
  const detailUrl = `https://moneyforward.com/accounts/show/${accountId}`;
  await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });

  // ページ到達確認 + 主要セクション読み込み待ち (depo は必ずある)
  try {
    await page.waitForSelector('#portfolio_det_depo', { timeout: 10_000 });
  } catch (err) {
    await dumpDebug(page, `detail-${label}-no-depo`);
    throw new Error(`${label}: 詳細ページ読み込み失敗 (URL: ${page.url()})`);
  }
  // eq / mf / fx は無いブローカー / アカウントもあるので waitForSelector を try-only
  await page.waitForSelector('#portfolio_det_eq', { timeout: 3_000 }).catch(() => {});
  await page.waitForSelector('#portfolio_det_mf', { timeout: 3_000 }).catch(() => {});
  await page.waitForSelector('#portfolio_det_fx', { timeout: 3_000 }).catch(() => {});

  // 預金・現金・暗号資産 (depo)
  const cashBreakdownRaw = await page.$$eval(
    '#portfolio_det_depo table.table-depo tbody tr',
    (trs) =>
      trs.map((tr) => {
        const tds = tr.querySelectorAll('td');
        return {
          label: tds[0]?.textContent?.trim() ?? '',
          amountText: tds[1]?.textContent?.trim() ?? '0',
        };
      }),
  );

  const cashBreakdown: CashRow[] = cashBreakdownRaw.map((c) => ({
    label: c.label,
    amountJpy: parseAmount(c.amountText),
  }));
  let cashJpy = cashBreakdown.reduce((s, c) => s + c.amountJpy, 0);

  // 株式（現物）(eq)
  // セクション自体が無い口座もあるので、存在チェックしてから抽出
  // 注: $$eval 内のコールバックは browser 側で実行されるため tsx の __name helper が
  //     使えない → 内部 arrow を避けてベタ書きする
  const eqExists = (await page.$('#portfolio_det_eq table.table-eq tbody')) !== null;
  const stocksRaw = eqExists
    ? await page.$$eval('#portfolio_det_eq table.table-eq tbody tr', (trs) => {
        const out: Array<{
          symbol: string;
          name: string;
          quantityText: string;
          avgCostText: string;
          currentPriceText: string;
          marketValueText: string;
        }> = [];
        for (const tr of trs) {
          const tds = tr.querySelectorAll('td');
          out.push({
            symbol: (tds[0]?.textContent ?? '').trim(),
            name: (tds[1]?.textContent ?? '').trim(),
            quantityText: (tds[2]?.textContent ?? '').trim(),
            avgCostText: (tds[3]?.textContent ?? '').trim(),
            currentPriceText: (tds[4]?.textContent ?? '').trim(),
            marketValueText: (tds[5]?.textContent ?? '').trim(),
          });
        }
        return out;
      })
    : [];

  const stocks: RawStockRow[] = stocksRaw
    .map((s) => ({
      symbol: s.symbol,
      name: s.name,
      quantity: parseAmount(s.quantityText),
      avgCost: parseAmount(s.avgCostText),
      currentPrice: parseAmount(s.currentPriceText),
      marketValue: parseAmount(s.marketValueText),
    }))
    .filter((s) => s.quantity > 0 && s.symbol !== '');

  // 投資信託 (mf)
  const mfExists = (await page.$('#portfolio_det_mf table.table-mf tbody')) !== null;
  const mfRaw = mfExists
    ? await page.$$eval('#portfolio_det_mf table.table-mf tbody tr', (trs) => {
        const out: Array<{
          name: string;
          quantityText: string;
          avgCostText: string;
          marketValueText: string;
        }> = [];
        for (const tr of trs) {
          const tds = tr.querySelectorAll('td');
          out.push({
            name: (tds[0]?.textContent ?? '').trim(),
            quantityText: (tds[1]?.textContent ?? '').trim(),
            avgCostText: (tds[2]?.textContent ?? '').trim(),
            marketValueText: (tds[4]?.textContent ?? '').trim(),
          });
        }
        return out;
      })
    : [];

  const mutualFunds: RawMfRow[] = mfRaw
    .map((m) => ({
      name: m.name,
      quantity: parseAmount(m.quantityText),
      avgCost: parseAmount(m.avgCostText),
      marketValue: parseAmount(m.marketValueText),
    }))
    .filter((m) => m.quantity > 0 && m.name !== '');

  // FX セクション (SBI証券等): 現金マージン + 通貨ペアポジション PnL の合計を
  // JPY 現金として cashBreakdown に追加 (個別ポジション詳細は v1.5 で)
  const fxExists = (await page.$('#portfolio_det_fx')) !== null;
  let fxTotal = 0;
  if (fxExists) {
    const fxCashRows = await page
      .$$eval('#portfolio_det_fx table.table-depo tbody tr', (trs) => {
        const out: Array<{ amountText: string }> = [];
        for (const tr of trs) {
          const tds = tr.querySelectorAll('td');
          out.push({ amountText: (tds[1]?.textContent ?? '0').trim() });
        }
        return out;
      })
      .catch(() => [] as Array<{ amountText: string }>);

    const fxPositionRows = await page
      .$$eval('#portfolio_det_fx table.table-fx tbody tr', (trs) => {
        const out: Array<{ pair: string; pnlText: string }> = [];
        for (const tr of trs) {
          const tds = tr.querySelectorAll('td');
          out.push({
            pair: (tds[0]?.textContent ?? '').trim(),
            pnlText: (tds[4]?.textContent ?? '0').trim(),
          });
        }
        return out;
      })
      .catch(() => [] as Array<{ pair: string; pnlText: string }>);

    for (const r of fxCashRows) fxTotal += parseAmount(r.amountText);
    for (const r of fxPositionRows) fxTotal += parseAmount(r.pnlText);

    if (fxTotal !== 0) {
      // "FX 合計" は detectCashCurrency で JPY 判定される (デフォルト)
      cashBreakdown.push({ label: 'FX 合計', amountJpy: fxTotal });
      cashJpy += fxTotal;
    }
  }

  // 0件 で本来あるべきなら debug dump (空のセクションは正常)
  if (eqExists && stocks.length === 0 && stocksRaw.length === 0) {
    await dumpDebug(page, `detail-${label}-empty-eq`);
    console.error(`[warn] ${label}: eq section exists but no rows extracted`);
  }
  if (mfExists && mutualFunds.length === 0 && mfRaw.length === 0) {
    await dumpDebug(page, `detail-${label}-empty-mf`);
    console.error(`[warn] ${label}: mf section exists but no rows extracted`);
  }

  console.log(
    `  [scrape] ${label}: cash ${cashBreakdown.length}行, 株 ${stocks.length}件, 投信 ${mutualFunds.length}件 (eq=${eqExists} mf=${mfExists} fx=${fxExists}${fxExists ? ` ¥${fxTotal.toLocaleString('ja-JP')}` : ''})`,
  );

  return { cashJpy, cashBreakdown, stocks, mutualFunds };
}

/**
 * 同一 (symbol, exchange) の行を合算 (NISA/特定 等で MF が複数行返す場合の対策)。
 * quantity は単純合算、avgCostNative は数量重み付き平均で再計算。
 */
function mergeDuplicateHoldings(rows: HoldingUpdate[]): HoldingUpdate[] {
  const map = new Map<string, HoldingUpdate>();
  for (const r of rows) {
    const key = `${r.symbol}|${r.exchange ?? ''}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...r });
      continue;
    }
    const totalQty = existing.quantity + r.quantity;
    const totalCost =
      (existing.avgCostNative ?? existing.marketPriceNative) * existing.quantity +
      (r.avgCostNative ?? r.marketPriceNative) * r.quantity;
    existing.quantity = totalQty;
    if (totalQty > 0 && totalCost > 0) {
      existing.avgCostNative = totalCost / totalQty;
    }
    // marketPriceNative は同一銘柄なら同じはず → 既存値を維持
  }
  return Array.from(map.values());
}

// 銘柄名から ETF/ETN を判定 (MF eq セクションには株式と ETF が混在するため)
function detectStockAssetClass(name: string): 'stock' | 'etf' {
  if (/\bETF\b|\bETN\b/i.test(name)) return 'etf';
  if (/NEXT\s*FUNDS|NF日経|NF\s*S&P|NF\s*ナスダック|MAXIS|iFreeETF|上場インデックス|上場投信|純金信託|銀信託|プラチナ信託/i.test(name)) return 'etf';
  if (/iShares|アイシェアーズ|アイシェア|バンガード|Vanguard|SPDR|スパイダー|Invesco|インベスコ|Direxion|ディレクション|ProShares|プロシェアーズ|WisdomTree|ウィズダムツリー|Schwab|シュワブ|\bARK\s/i.test(name)) return 'etf';
  if (/(ブル|ベア)\s*\d*倍|レバレッジ|インバース/.test(name)) return 'etf';
  return 'stock';
}

function buildStockHolding(row: RawStockRow): HoldingUpdate {
  // 4 桁数字 → 日本株 (TSE)、それ以外 → 米国株扱い (NASDAQ/NYSE 判別不可なので exchange=null)
  // MF は column 3 (avgCost) と column 4 (currentPrice) を native currency で表示する。
  // (JP 株は JPY/株、US 株は USD/株)。column 5 (marketValue) のみ JPY 換算。
  // → native price/avgCost をそのまま使い、value は fx で再計算させる。
  const isJpStock = /^\d{4}$/.test(row.symbol);
  const assetClass = detectStockAssetClass(row.name);
  const priceNative = row.currentPrice > 0
    ? row.currentPrice
    : row.quantity > 0
      ? row.marketValue / row.quantity
      : 0;
  if (isJpStock) {
    return {
      symbol: row.symbol,
      exchange: 'TSE',
      name: row.name,
      currency: 'JPY',
      assetClass,
      region: 'jp',
      quantity: row.quantity,
      marketPriceNative: priceNative,
      ...(row.avgCost > 0 ? { avgCostNative: row.avgCost } : {}),
    };
  }
  return {
    symbol: row.symbol,
    name: row.name,
    currency: 'USD',
    assetClass,
    region: 'us',
    quantity: row.quantity,
    marketPriceNative: priceNative,
    ...(row.avgCost > 0 ? { avgCostNative: row.avgCost } : {}),
  };
}

// 投信の銘柄名から原資産の region + currency を推定 (通貨配分の集計用)
// e.g., "eMAXIS Slim 米国株式(S&P500)" → us/USD
//       "eMAXIS Slim 全世界株式(オール・カントリー)" → global/USD (米国比重大)
//       "ニッセイ TOPIX インデックス" → jp/JPY
function detectMutualFundCategory(name: string): { region: Region; currency: string } {
  const n = name;
  if (/米国|米株|S&P|S&P|ナスダック|NASDAQ|ダウ|Russell|ラッセル/i.test(n))
    return { region: 'us', currency: 'USD' };
  if (/全世界|オルカン|オール・?カントリー|World|MSCI ACWI/i.test(n))
    return { region: 'global', currency: 'USD' };
  if (/新興国|エマージング|emerging/i.test(n))
    return { region: 'em', currency: 'USD' };
  if (/先進国|MSCI Kokusai|コクサイ/i.test(n))
    return { region: 'global', currency: 'USD' };
  if (/中国|チャイナ|China/i.test(n))
    return { region: 'cn', currency: 'USD' };
  if (/欧州|ユーロ|ヨーロッパ|Europe/i.test(n))
    return { region: 'eu', currency: 'EUR' };
  if (/インド|India|ブラジル|Brazil/i.test(n))
    return { region: 'em', currency: 'USD' };
  if (/香港|HongKong|H株/i.test(n))
    return { region: 'hk', currency: 'HKD' };
  if (/日本|TOPIX|日経|J-REIT|JREIT|JPX/.test(n))
    return { region: 'jp', currency: 'JPY' };
  return { region: 'jp', currency: 'JPY' }; // デフォルト
}

function buildMutualFundHolding(row: RawMfRow, fxMap: Map<string, number>): HoldingUpdate {
  // 投信は銘柄コード無いので name を symbol に流用 (Security の unique キー)
  // MF の表示: 保有数=口数 / 平均取得単価・基準価額=per 10,000 口 表示
  // → marketPrice は value/qty で「per 1口」、avgCost も同じ単位に正規化 (/10000)
  const { region, currency } = detectMutualFundCategory(row.name);
  const fx = currency === 'JPY' ? 1 : fxMap.get(currency) ?? 1;

  const priceJpyPerUnit = row.quantity > 0 ? row.marketValue / row.quantity : 0;
  const avgCostJpyPerUnit = row.avgCost / 10_000;

  // 非JPYファンドは MF の JPY 表示を fx で native に逆算
  const priceNative = currency === 'JPY' ? priceJpyPerUnit : priceJpyPerUnit / fx;
  const avgCostNative =
    avgCostJpyPerUnit > 0
      ? currency === 'JPY'
        ? avgCostJpyPerUnit
        : avgCostJpyPerUnit / fx
      : 0;

  return {
    symbol: row.name,
    name: row.name,
    currency,
    assetClass: 'mutual_fund',
    region,
    quantity: row.quantity,
    marketPriceNative: priceNative,
    ...(avgCostNative > 0 ? { avgCostNative } : {}),
  };
}

/** MF サイトをヘッドレスでスクレイピングし、5 対象機関の口座 + 保有銘柄を返す。
 *  cash は通貨別に独立した Holding (`USD_CASH` 等、assetClass='cash') として emit。
 *  getFxToJpy が無い場合は全て fx=1 で扱う (mf:scrape-dry の試験用)。
 */
export async function scrapeMoneyForward(opts: {
  headless?: boolean;
  getFxToJpy?: (currency: string) => Promise<number>;
} = {}): Promise<AccountUpdate[]> {
  const getFx = opts.getFxToJpy ?? ((_cur: string) => Promise.resolve(1));
  if (!existsSync(MF_USER_DATA_DIR)) {
    throw new NeedsLoginError(
      'moneyforward',
      `${MF_USER_DATA_DIR} が無い。pnpm --filter @asset-tracker/server run mf:login を実行してください`,
    );
  }

  const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
    headless: opts.headless ?? true,
    viewport: { width: 1440, height: 900 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await ensureLoggedIn(page);

    const rows = await scrapeAccountList(page);
    const capturedAt = new Date();
    const updates: AccountUpdate[] = [];

    for (const row of rows) {
      const institution = INSTITUTION_MAP[row.name];
      if (!institution) continue; // 対象 5 機関以外は無視

      if (BANK_INSTITUTIONS.has(institution)) {
        // 銀行: 残高を JPY_CASH ホールディングとして emit (3 機関とも JPY 口座)
        updates.push({
          institution,
          label: row.name,
          capturedAt,
          baseCurrency: 'JPY',
          cashNative: 0, // cash は holdings 側で持つ
          holdings: [buildCashHolding('JPY', row.balanceJpy)],
        });
      } else {
        // 証券: 詳細ページから cash (通貨別) + holdings
        const detail = await scrapeBrokerageDetail(page, row.id, institution);

        // cash を通貨別に集約してから native 量に変換
        const cashByCurrency = new Map<string, number>();
        for (const c of detail.cashBreakdown) {
          const cur = detectCashCurrency(c.label);
          cashByCurrency.set(cur, (cashByCurrency.get(cur) ?? 0) + c.amountJpy);
        }
        const cashHoldings: HoldingUpdate[] = [];
        for (const [cur, jpyValue] of cashByCurrency) {
          const fx = cur === 'JPY' ? 1 : await getFx(cur);
          const native = fx > 0 ? jpyValue / fx : jpyValue;
          cashHoldings.push(buildCashHolding(cur, native));
        }

        // fx を一括取得 (US/EU/HK系投信の native 逆算用、US株は MF が native USD で
        // 出すため不要だが今後の拡張に備えて取得)
        const fxMap = new Map<string, number>();
        for (const cur of ['USD', 'EUR', 'HKD']) {
          fxMap.set(cur, await getFx(cur));
        }

        const holdings = mergeDuplicateHoldings([
          ...cashHoldings,
          ...detail.stocks.map((s) => buildStockHolding(s)),
          ...detail.mutualFunds.map((m) => buildMutualFundHolding(m, fxMap)),
        ]);
        updates.push({
          institution,
          label: row.name,
          capturedAt,
          baseCurrency: 'JPY',
          cashNative: 0, // cash は holdings 側
          holdings,
        });
      }
    }

    return updates;
  } finally {
    await context.close();
  }
}

export async function withMoneyForwardPage<T>(
  fn: (page: Page, context: BrowserContext) => Promise<T>,
  opts: { headless?: boolean } = {},
): Promise<T> {
  const context = await chromium.launchPersistentContext(MF_USER_DATA_DIR, {
    headless: opts.headless ?? true,
    viewport: { width: 1440, height: 900 },
  });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return await fn(page, context);
  } finally {
    await context.close();
  }
}
