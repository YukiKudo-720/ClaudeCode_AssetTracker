// 注: env var (PLAYWRIGHT_BROWSERS_PATH 等) は entry script で env.ts を import 済みの前提
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Institution } from '@asset-tracker/shared';
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
  avgCost: number;
  marketValue: number;
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
  // eq / mf は無いブローカー / アカウントもあるので waitForSelector を try-only
  await page.waitForSelector('#portfolio_det_eq', { timeout: 3_000 }).catch(() => {});
  await page.waitForSelector('#portfolio_det_mf', { timeout: 3_000 }).catch(() => {});

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
  const cashJpy = cashBreakdown.reduce((s, c) => s + c.amountJpy, 0);

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
          marketValueText: string;
        }> = [];
        for (const tr of trs) {
          const tds = tr.querySelectorAll('td');
          out.push({
            symbol: (tds[0]?.textContent ?? '').trim(),
            name: (tds[1]?.textContent ?? '').trim(),
            quantityText: (tds[2]?.textContent ?? '').trim(),
            avgCostText: (tds[3]?.textContent ?? '').trim(),
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
    `  [scrape] ${label}: cash ${cashBreakdown.length}行, 株 ${stocks.length}件, 投信 ${mutualFunds.length}件 (eqSection=${eqExists}, mfSection=${mfExists})`,
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

function buildStockHolding(row: RawStockRow): HoldingUpdate {
  // 4 桁数字 → 日本株 (TSE)、それ以外 → デフォルト null exchange / region 推定
  const isJpStock = /^\d{4}$/.test(row.symbol);
  const marketPrice = row.quantity > 0 ? row.marketValue / row.quantity : 0;
  return {
    symbol: row.symbol,
    ...(isJpStock ? { exchange: 'TSE' } : {}),
    name: row.name,
    // v1: MF は全て JPY 表示なので JPY 統一。後で US株は USD に差し替え予定
    currency: 'JPY',
    assetClass: 'stock',
    ...(isJpStock ? { region: 'jp' as const } : { region: 'us' as const }),
    quantity: row.quantity,
    marketPriceNative: marketPrice,
    ...(row.avgCost > 0 ? { avgCostNative: row.avgCost } : {}),
  };
}

function buildMutualFundHolding(row: RawMfRow): HoldingUpdate {
  // 投信は銘柄コード無いので name を symbol に流用 (Security の unique キー)
  const marketPrice = row.quantity > 0 ? row.marketValue / row.quantity : 0;
  return {
    symbol: row.name,
    name: row.name,
    currency: 'JPY',
    assetClass: 'mutual_fund',
    region: 'jp',
    quantity: row.quantity,
    marketPriceNative: marketPrice,
    ...(row.avgCost > 0 ? { avgCostNative: row.avgCost } : {}),
  };
}

/** MF サイトをヘッドレスでスクレイピングし、5 対象機関の口座 + 保有銘柄を返す */
export async function scrapeMoneyForward(opts: {
  headless?: boolean;
} = {}): Promise<AccountUpdate[]> {
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
        // 銀行: 残高のみ
        updates.push({
          institution,
          label: row.name,
          capturedAt,
          baseCurrency: 'JPY',
          cashNative: row.balanceJpy,
          holdings: [],
        });
      } else {
        // 証券: 詳細ページから cash + holdings
        const detail = await scrapeBrokerageDetail(page, row.id, institution);
        const holdings = mergeDuplicateHoldings([
          ...detail.stocks.map(buildStockHolding),
          ...detail.mutualFunds.map(buildMutualFundHolding),
        ]);
        updates.push({
          institution,
          label: row.name,
          capturedAt,
          baseCurrency: 'JPY',
          cashNative: detail.cashJpy,
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
