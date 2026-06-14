import { useMemo, useState } from 'react';
import { useHoldings } from '../api/queries.js';
import type { HoldingAgg } from '@asset-tracker/shared';
import {
  ASSET_CLASS_LABELS,
  INSTITUTION_LABELS,
  REGION_LABELS,
  type AssetClass,
  type Institution,
  type Region,
} from '@asset-tracker/shared';
import { SortControl } from '../components/SortControl.js';
import { compareBy, type SortKey } from '../lib/sort.js';

function sortHoldings(items: HoldingAgg[], sortKey: SortKey): HoldingAgg[] {
  const cmp = compareBy(sortKey);
  return [...items].sort((a, b) =>
    cmp(
      { value: a.totalValueJpy, name: a.name, symbol: a.symbol },
      { value: b.totalValueJpy, name: b.name, symbol: b.symbol },
    ),
  );
}

const ASSET_CLASS_ORDER: AssetClass[] = [
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
];

const REGION_ORDER: Region[] = ['jp', 'us', 'hk', 'cn', 'eu', 'em', 'global', 'other'];

const CURRENCY_SIGN: Record<string, string> = {
  JPY: '¥',
  USD: '$',
  HKD: 'HK$',
  EUR: '€',
  CNY: 'CN¥',
  CNH: 'CN¥',
};

const CURRENCY_LABELS: Record<string, string> = {
  JPY: '日本円',
  USD: '米ドル',
  HKD: '香港ドル',
  EUR: 'ユーロ',
  CNY: '人民元',
  CNH: '人民元',
};

function formatNative(amount: number, currency: string): string {
  const sign = CURRENCY_SIGN[currency] ?? `${currency} `;
  const decimals = currency === 'JPY' ? 0 : 2;
  return `${sign}${amount.toLocaleString('ja-JP', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

function formatJpy(v: number): string {
  return `¥${v.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
}

function formatSignedJpy(v: number): string {
  const sign = v >= 0 ? '+' : '−';
  return `${sign}¥${Math.abs(v).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
}

function diffClass(v: number): string {
  return v >= 0 ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]';
}

// 全口座を跨いだ加重平均取得単価 (native)。avgCost を持つ口座が無ければ null。
function overallAvgCostNative(h: HoldingAgg): number | null {
  let qty = 0;
  let cost = 0;
  let has = false;
  for (const a of h.accounts) {
    if (a.avgCostNative != null && a.quantity > 0) {
      cost += a.avgCostNative * a.quantity;
      qty += a.quantity;
      has = true;
    }
  }
  return has && qty > 0 ? cost / qty : null;
}

// 取得単価表示。投信は per-1口 格納のため ×10,000 (基準価額/万口) に換算。
function formatCost(costNative: number, currency: string, isMutualFund: boolean): string {
  if (isMutualFund) {
    return `${formatNative(costNative * 10000, currency)}/万口`;
  }
  return formatNative(costNative, currency);
}

/** 前日比表示: amount + pct + ラベル省略 */
function DayDiff({ current, prev }: { current: number; prev: number | null }) {
  if (prev == null || prev === 0) {
    return <span className="text-[var(--color-text-muted)] text-xs">—</span>;
  }
  const diff = current - prev;
  const pct = (diff / prev) * 100;
  return (
    <span className={`tabular-nums ${diffClass(diff)}`}>
      {formatSignedJpy(diff)}
      <span className="opacity-80 ml-1">
        ({diff >= 0 ? '+' : ''}
        {pct.toFixed(2)}%)
      </span>
    </span>
  );
}

export function Holdings() {
  const { data, isLoading, isError } = useHoldings();
  const [sortKey, setSortKey] = useState<SortKey>('value');

  const grouped = useMemo(() => {
    if (!data) return new Map<string, HoldingAgg[]>();
    const m = new Map<string, HoldingAgg[]>();
    for (const h of data.holdings) {
      const arr = m.get(h.assetClass) ?? [];
      arr.push(h);
      m.set(h.assetClass, arr);
    }
    return m;
  }, [data]);

  if (isLoading) return <p className="text-[var(--color-text-muted)]">読み込み中...</p>;
  if (isError || !data) return <p className="text-[var(--color-negative)]">API エラー</p>;
  if (data.holdings.length === 0)
    return <p className="text-[var(--color-text-muted)]">保有銘柄がまだありません。</p>;

  const grandTotal = data.holdings.reduce((s, h) => s + h.totalValueJpy, 0);

  return (
    <div className="space-y-8">
      <div className="text-sm text-[var(--color-text-muted)] flex justify-between items-baseline flex-wrap gap-2">
        <span>
          {data.holdings.length} 件 / 取得日 {data.capturedDate ?? '-'}
          {data.prevCapturedDate && (
            <span className="ml-2 opacity-70">(前日比: vs {data.prevCapturedDate})</span>
          )}
        </span>
        <span className="text-base text-[var(--color-text)] tabular-nums font-medium">
          総額 {formatJpy(grandTotal)}
        </span>
      </div>

      <div className="flex justify-end">
        <SortControl value={sortKey} onChange={setSortKey} />
      </div>

      {ASSET_CLASS_ORDER.map((ac) => {
        const items = grouped.get(ac);
        if (!items || items.length === 0) return null;
        return <AssetClassSection key={ac} assetClass={ac} items={items} sortKey={sortKey} />;
      })}
    </div>
  );
}

function AssetClassSection({
  assetClass,
  items,
  sortKey,
}: {
  assetClass: AssetClass;
  items: HoldingAgg[];
  sortKey: SortKey;
}) {
  const total = items.reduce((s, h) => s + h.totalValueJpy, 0);
  const title = ASSET_CLASS_LABELS[assetClass] ?? assetClass;

  if (assetClass === 'fx') {
    return (
      <section>
        <Header title={title} count={items.length} total={total} />
        <FxTable items={items} sortKey={sortKey} />
      </section>
    );
  }

  if (assetClass === 'cash') {
    // 通貨ブロック自体の並び順は常に金額順 (現金は名前/コードに意味が薄いため)
    const sorted = [...items].sort((a, b) => b.totalValueJpy - a.totalValueJpy);
    return (
      <section>
        <Header title={title} count={items.length} total={total} />
        <div className="space-y-4">
          {sorted.map((item) => {
            const label = CURRENCY_LABELS[item.currency] ?? item.currency;
            return (
              <div key={item.currency}>
                <SubHeader
                  label={label}
                  count={item.accounts.length}
                  total={item.totalValueJpy}
                />
                <CurrencyCashTable item={item} />
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  // 投信 / 株 / ETF 等: region でサブグループ化
  const byRegion = new Map<Region | 'unknown', HoldingAgg[]>();
  for (const h of items) {
    const r = (h.region as Region | null) ?? 'unknown';
    const arr = byRegion.get(r) ?? [];
    arr.push(h);
    byRegion.set(r, arr);
  }
  const regions: Array<Region | 'unknown'> = [
    ...REGION_ORDER.filter((r) => byRegion.has(r)),
    ...(byRegion.has('unknown') ? (['unknown'] as const) : []),
  ];

  const isMutualFund = assetClass === 'mutual_fund';

  return (
    <section>
      <Header title={title} count={items.length} total={total} />
      <div className="space-y-4">
        {regions.map((r) => {
          const subset = byRegion.get(r)!;
          const subTotal = subset.reduce((s, h) => s + h.totalValueJpy, 0);
          const label = r === 'unknown' ? '未分類' : REGION_LABELS[r as Region] ?? r;
          return (
            <div key={r}>
              <SubHeader label={label} count={subset.length} total={subTotal} />
              {isMutualFund ? (
                <MutualFundTable items={subset} sortKey={sortKey} />
              ) : (
                <SecurityTable items={subset} sortKey={sortKey} />
              )}
              <SecurityCardList items={subset} mutualFund={isMutualFund} sortKey={sortKey} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Header({ title, count, total }: { title: string; count: number; total: number }) {
  return (
    <div className="flex items-baseline justify-between mb-3 border-b-2 border-[var(--color-primary)] pb-1">
      <h2 className="text-lg font-bold text-[var(--color-primary)]">
        {title}{' '}
        <span className="text-sm font-normal text-[var(--color-text-muted)] ml-2">{count} 件</span>
      </h2>
      <span className="text-base tabular-nums font-medium">{formatJpy(total)}</span>
    </div>
  );
}

function SubHeader({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="flex items-baseline justify-between mb-2 px-1 text-sm">
      <span className="font-semibold text-[var(--color-text)]">
        {label}{' '}
        <span className="text-[var(--color-text-muted)] ml-2 font-normal">{count} 件</span>
      </span>
      <span className="tabular-nums text-[var(--color-text-muted)]">{formatJpy(total)}</span>
    </div>
  );
}

// ---------- FX (個別株と同じ表現: Desktop table + Mobile cards) ----------
// FX は marketValueJpy = 含み損益 そのもの (avgCost なし)。
// 個別株の「評価額/前日比」セルと同じ見せ方を含み損益に適用する。
function FxTable({ items, sortKey }: { items: HoldingAgg[]; sortKey: SortKey }) {
  const sorted = sortHoldings(items, sortKey);
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <tr>
              <th className="py-2 px-3 w-32">通貨ペア</th>
              <th className="py-2 px-3">ポジション</th>
              <th className="py-2 px-3 text-right w-44">含み損益 / 前日比</th>
              <th className="py-2 px-3 w-44">保有口座</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => (
              <tr key={h.securityId} className="border-t border-[var(--color-border)] align-top">
                <td className="py-2 px-3 font-mono whitespace-nowrap">{h.symbol}</td>
                <td className="py-2 px-3">{h.name}</td>
                <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                  <div className={diffClass(h.totalValueJpy)}>
                    {formatSignedJpy(h.totalValueJpy)}
                  </div>
                  <div className="text-xs">
                    <DayDiff current={h.totalValueJpy} prev={h.prevTotalValueJpy} />
                  </div>
                </td>
                <td className="py-2 px-3 text-xs">
                  {h.accounts.map((a) => (
                    <div key={a.accountId}>
                      {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {sorted.map((h) => (
          <article
            key={h.securityId}
            className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-3"
          >
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono text-[var(--color-text-muted)]">{h.symbol}</div>
                <div className="font-medium truncate">{h.name}</div>
              </div>
              <div className="text-right tabular-nums whitespace-nowrap">
                <div className={`font-semibold ${diffClass(h.totalValueJpy)}`}>
                  {formatSignedJpy(h.totalValueJpy)}
                </div>
                <div className="text-xs">
                  <DayDiff current={h.totalValueJpy} prev={h.prevTotalValueJpy} />
                </div>
              </div>
            </div>
            {h.accounts.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)] flex flex-wrap gap-x-3 gap-y-1">
                {h.accounts.map((a) => (
                  <span key={a.accountId}>
                    {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

// ---------- Cash (per-currency) ----------
function CurrencyCashTable({ item }: { item: HoldingAgg }) {
  const accounts = [...item.accounts].sort((a, b) => b.valueJpy - a.valueJpy);
  return (
    <div className="overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3">口座</th>
            <th className="py-2 px-3 text-right w-44">残高 (JPY 換算)</th>
            <th className="py-2 px-3 text-right w-40">金額</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => {
            const instLabel = INSTITUTION_LABELS[a.institution as Institution] ?? a.institution;
            return (
              <tr key={a.accountId} className="border-t border-[var(--color-border)]">
                <td className="py-2 px-3">
                  <div>{instLabel}</div>
                  {a.label && a.label !== instLabel && (
                    <div className="text-xs text-[var(--color-text-muted)]">{a.label}</div>
                  )}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{formatJpy(a.valueJpy)}</td>
                <td className="py-2 px-3 text-right tabular-nums">
                  {formatNative(a.quantity, item.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Securities (stock/etf/reit/...) — Desktop table ----------
function SecurityTable({ items, sortKey }: { items: HoldingAgg[]; sortKey: SortKey }) {
  const sorted = sortHoldings(items, sortKey);
  return (
    <div className="hidden md:block overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3 w-24">コード</th>
            <th className="py-2 px-3">銘柄名</th>
            <th className="py-2 px-3 text-right w-32 whitespace-nowrap">数量 / 取得単価</th>
            <th className="py-2 px-3 text-right w-44 whitespace-nowrap">評価額 / 前日比</th>
            <th className="py-2 px-3 text-right w-36">損益 (JPY)</th>
            <th className="py-2 px-3 w-56">保有口座</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => {
            const avgCost = overallAvgCostNative(h);
            return (
            <tr key={h.securityId} className="border-t border-[var(--color-border)] align-top">
              <td className="py-2 px-3 font-mono whitespace-nowrap">{h.symbol}</td>
              <td className="py-2 px-3">
                <div>{h.name}</div>
                {h.sector && (
                  <div className="text-xs text-[var(--color-text-muted)]">{h.sector}</div>
                )}
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                <div>{h.totalQuantity.toLocaleString('ja-JP', { maximumFractionDigits: 4 })}</div>
                {avgCost != null && (
                  <div className="text-xs text-[var(--color-text-muted)]">
                    取得 {formatCost(avgCost, h.currency, false)}
                  </div>
                )}
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                <div>{formatJpy(h.totalValueJpy)}</div>
                <div className="text-xs">
                  <DayDiff current={h.totalValueJpy} prev={h.prevTotalValueJpy} />
                </div>
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                {h.unrealizedPnlJpy != null ? (
                  <span className={diffClass(h.unrealizedPnlJpy)}>
                    {formatSignedJpy(h.unrealizedPnlJpy)}
                    {h.unrealizedPnlRatio != null && (
                      <div className="text-xs">
                        {h.unrealizedPnlJpy >= 0 ? '+' : ''}
                        {(h.unrealizedPnlRatio * 100).toFixed(2)}%
                      </div>
                    )}
                  </span>
                ) : (
                  <span className="text-[var(--color-text-muted)]">—</span>
                )}
              </td>
              <td className="py-2 px-3 text-xs">
                <AccountBreakdown h={h} mutualFund={false} />
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 保有口座セル: 1口座なら機関名のみ (数量/取得単価は全体と重複するので省略)、
// 複数口座のときだけ口座別の数量・取得単価を内訳表示。
function AccountBreakdown({ h, mutualFund }: { h: HoldingAgg; mutualFund: boolean }) {
  const digits = mutualFund ? 0 : 4;
  if (h.accounts.length === 1) {
    const a = h.accounts[0]!;
    return <span>{INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}</span>;
  }
  return (
    <div className="space-y-1">
      {h.accounts.map((a) => (
        <div key={a.accountId} className="flex flex-col">
          <span className="truncate">
            {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
          </span>
          <span className="tabular-nums text-[var(--color-text-muted)]">
            {a.quantity.toLocaleString('ja-JP', { maximumFractionDigits: digits })}
            {mutualFund ? '口' : '株'}
            {a.avgCostNative != null && (
              <span className="ml-1">取得 {formatCost(a.avgCostNative, h.currency, mutualFund)}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function MutualFundTable({ items, sortKey }: { items: HoldingAgg[]; sortKey: SortKey }) {
  const sorted = sortHoldings(items, sortKey);
  return (
    <div className="hidden md:block overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3">銘柄名</th>
            <th className="py-2 px-3 text-right w-40 whitespace-nowrap">口数 / 取得単価</th>
            <th className="py-2 px-3 text-right w-44 whitespace-nowrap">評価額 / 前日比</th>
            <th className="py-2 px-3 text-right w-36">損益 (JPY)</th>
            <th className="py-2 px-3 w-56">保有口座</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => {
            const avgCost = overallAvgCostNative(h);
            return (
            <tr key={h.securityId} className="border-t border-[var(--color-border)] align-top">
              <td className="py-2 px-3">{h.name}</td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                <div>{h.totalQuantity.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}</div>
                {avgCost != null && (
                  <div className="text-xs text-[var(--color-text-muted)]">
                    取得 {formatCost(avgCost, h.currency, true)}
                  </div>
                )}
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                <div>{formatJpy(h.totalValueJpy)}</div>
                <div className="text-xs">
                  <DayDiff current={h.totalValueJpy} prev={h.prevTotalValueJpy} />
                </div>
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                {h.unrealizedPnlJpy != null ? (
                  <span className={diffClass(h.unrealizedPnlJpy)}>
                    {formatSignedJpy(h.unrealizedPnlJpy)}
                    {h.unrealizedPnlRatio != null && (
                      <div className="text-xs">
                        {h.unrealizedPnlJpy >= 0 ? '+' : ''}
                        {(h.unrealizedPnlRatio * 100).toFixed(2)}%
                      </div>
                    )}
                  </span>
                ) : (
                  <span className="text-[var(--color-text-muted)]">—</span>
                )}
              </td>
              <td className="py-2 px-3 text-xs">
                <AccountBreakdown h={h} mutualFund={true} />
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Mobile card layout (stocks + mutual funds) ----------
function SecurityCardList({
  items,
  mutualFund,
  sortKey,
}: {
  items: HoldingAgg[];
  mutualFund: boolean;
  sortKey: SortKey;
}) {
  const sorted = sortHoldings(items, sortKey);
  const qtyDigits = mutualFund ? 0 : 4;
  return (
    <div className="md:hidden space-y-2">
      {sorted.map((h) => {
        const avgCost = overallAvgCostNative(h);
        return (
        <article
          key={h.securityId}
          className="bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)] p-3"
        >
          {/* row1: symbol + name (left), 評価額 (right) */}
          <div className="flex justify-between items-start gap-2">
            <div className="min-w-0 flex-1">
              {!mutualFund && h.symbol && (
                <div className="text-xs font-mono text-[var(--color-text-muted)]">
                  {h.symbol}
                  {h.sector && <span className="ml-2">· {h.sector}</span>}
                </div>
              )}
              <div className="font-medium truncate">{h.name}</div>
            </div>
            <div className="text-right tabular-nums whitespace-nowrap">
              <div className="font-semibold">{formatJpy(h.totalValueJpy)}</div>
              <div className="text-xs">
                <DayDiff current={h.totalValueJpy} prev={h.prevTotalValueJpy} />
              </div>
            </div>
          </div>

          {/* row2: 数量 + 取得単価 (left), 損益 (right) */}
          <div className="flex justify-between items-baseline mt-2 text-xs gap-2">
            <span className="text-[var(--color-text-muted)] tabular-nums">
              {mutualFund ? '口数' : '数量'} ×
              {h.totalQuantity.toLocaleString('ja-JP', { maximumFractionDigits: qtyDigits })}
              {avgCost != null && (
                <span className="ml-2">取得 {formatCost(avgCost, h.currency, mutualFund)}</span>
              )}
            </span>
            <span className="tabular-nums whitespace-nowrap">
              {h.unrealizedPnlJpy != null ? (
                <span className={diffClass(h.unrealizedPnlJpy)}>
                  損益 {formatSignedJpy(h.unrealizedPnlJpy)}
                  {h.unrealizedPnlRatio != null && (
                    <span className="opacity-80 ml-1">
                      ({h.unrealizedPnlJpy >= 0 ? '+' : ''}
                      {(h.unrealizedPnlRatio * 100).toFixed(2)}%)
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[var(--color-text-muted)]">—</span>
              )}
            </span>
          </div>

          {/* row3: 口座一覧。1口座なら機関名のみ、複数なら口座別の内訳 */}
          {h.accounts.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)] flex flex-wrap gap-x-3 gap-y-1">
              {h.accounts.length === 1 ? (
                <span>
                  {INSTITUTION_LABELS[h.accounts[0]!.institution as Institution] ??
                    h.accounts[0]!.institution}
                </span>
              ) : (
                h.accounts.map((a) => (
                  <span key={a.accountId} className="tabular-nums">
                    {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution} ×
                    {a.quantity.toLocaleString('ja-JP', { maximumFractionDigits: qtyDigits })}
                    {a.avgCostNative != null && (
                      <span className="ml-1">取得{formatCost(a.avgCostNative, h.currency, mutualFund)}</span>
                    )}
                  </span>
                ))
              )}
            </div>
          )}
        </article>
        );
      })}
    </div>
  );
}
