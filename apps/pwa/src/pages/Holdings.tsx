import { useMemo } from 'react';
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

      {ASSET_CLASS_ORDER.map((ac) => {
        const items = grouped.get(ac);
        if (!items || items.length === 0) return null;
        return <AssetClassSection key={ac} assetClass={ac} items={items} />;
      })}
    </div>
  );
}

function AssetClassSection({
  assetClass,
  items,
}: {
  assetClass: AssetClass;
  items: HoldingAgg[];
}) {
  const total = items.reduce((s, h) => s + h.totalValueJpy, 0);
  const title = ASSET_CLASS_LABELS[assetClass] ?? assetClass;

  if (assetClass === 'fx') {
    return (
      <section>
        <Header title={title} count={items.length} total={total} />
        <FxTable items={items} />
      </section>
    );
  }

  if (assetClass === 'cash') {
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
              {isMutualFund ? <MutualFundTable items={subset} /> : <SecurityTable items={subset} />}
              <SecurityCardList items={subset} mutualFund={isMutualFund} />
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

// ---------- FX ----------
function FxTable({ items }: { items: HoldingAgg[] }) {
  const sorted = [...items].sort((a, b) => b.totalValueJpy - a.totalValueJpy);
  return (
    <div className="overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3 w-32">通貨ペア</th>
            <th className="py-2 px-3">ポジション</th>
            <th className="py-2 px-3 text-right w-36">含み損益 (JPY)</th>
            <th className="py-2 px-3 w-44">口座</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.securityId} className="border-t border-[var(--color-border)]">
              <td className="py-2 px-3 font-mono">{h.symbol}</td>
              <td className="py-2 px-3">{h.name}</td>
              <td className="py-2 px-3 text-right tabular-nums">
                <span className={diffClass(h.totalValueJpy)}>
                  {formatSignedJpy(h.totalValueJpy)}
                </span>
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
function SecurityTable({ items }: { items: HoldingAgg[] }) {
  const sorted = [...items].sort((a, b) => b.totalValueJpy - a.totalValueJpy);
  return (
    <div className="hidden md:block overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3 w-24">コード</th>
            <th className="py-2 px-3">銘柄名</th>
            <th className="py-2 px-3 text-right w-24">数量</th>
            <th className="py-2 px-3 text-right w-44">評価額 / 前日比</th>
            <th className="py-2 px-3 text-right w-36">損益 (JPY)</th>
            <th className="py-2 px-3 w-56">保有口座</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.securityId} className="border-t border-[var(--color-border)] align-top">
              <td className="py-2 px-3 font-mono whitespace-nowrap">{h.symbol}</td>
              <td className="py-2 px-3">
                <div>{h.name}</div>
                {h.sector && (
                  <div className="text-xs text-[var(--color-text-muted)]">{h.sector}</div>
                )}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">
                {h.totalQuantity.toLocaleString('ja-JP', { maximumFractionDigits: 4 })}
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
              <td className="py-2 px-3 text-xs space-y-0.5">
                {h.accounts.map((a) => (
                  <div key={a.accountId} className="flex items-center gap-2">
                    <span className="min-w-28 truncate">
                      {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
                    </span>
                    <span className="tabular-nums text-[var(--color-text-muted)]">
                      ×{a.quantity.toLocaleString('ja-JP', { maximumFractionDigits: 4 })}
                    </span>
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MutualFundTable({ items }: { items: HoldingAgg[] }) {
  const sorted = [...items].sort((a, b) => b.totalValueJpy - a.totalValueJpy);
  return (
    <div className="hidden md:block overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3">銘柄名</th>
            <th className="py-2 px-3 text-right w-28">口数</th>
            <th className="py-2 px-3 text-right w-44">評価額 / 前日比</th>
            <th className="py-2 px-3 text-right w-36">損益 (JPY)</th>
            <th className="py-2 px-3 w-56">保有口座</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => (
            <tr key={h.securityId} className="border-t border-[var(--color-border)] align-top">
              <td className="py-2 px-3">{h.name}</td>
              <td className="py-2 px-3 text-right tabular-nums">
                {h.totalQuantity.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
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
              <td className="py-2 px-3 text-xs space-y-0.5">
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
  );
}

// ---------- Mobile card layout (stocks + mutual funds) ----------
function SecurityCardList({ items, mutualFund }: { items: HoldingAgg[]; mutualFund: boolean }) {
  const sorted = [...items].sort((a, b) => b.totalValueJpy - a.totalValueJpy);
  return (
    <div className="md:hidden space-y-2">
      {sorted.map((h) => (
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

          {/* row2: 数量 (left), 損益 (right) */}
          <div className="flex justify-between items-baseline mt-2 text-xs">
            <span className="text-[var(--color-text-muted)] tabular-nums">
              {mutualFund ? '口数' : '数量'} ×
              {h.totalQuantity.toLocaleString('ja-JP', { maximumFractionDigits: mutualFund ? 0 : 4 })}
            </span>
            <span className="tabular-nums">
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

          {/* row3: 口座一覧 */}
          {h.accounts.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)] flex flex-wrap gap-x-3 gap-y-1">
              {h.accounts.map((a) => (
                <span key={a.accountId} className="tabular-nums">
                  {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution} ×
                  {a.quantity.toLocaleString('ja-JP', { maximumFractionDigits: mutualFund ? 0 : 4 })}
                </span>
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
