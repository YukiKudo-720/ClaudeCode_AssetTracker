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
      <div className="text-sm text-[var(--color-text-muted)] flex justify-between items-baseline">
        <span>
          {data.holdings.length} 件 / 取得日 {data.capturedDate ?? '-'}
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
    // FX: 各 SBI証券（FX）等の Account を 1 行で表示
    return (
      <section>
        <Header title={title} count={items.length} total={total} />
        <FxTable items={items} />
      </section>
    );
  }

  if (assetClass === 'cash') {
    // 通貨ごとにサブグループ (1 item = 1 通貨。JPY換算降順)
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

  if (assetClass === 'mutual_fund') {
    // 投信も region でサブグループ化 (米国/全世界/日本/新興国 等)
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
                <MutualFundTable items={subset} />
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  // stock / etf / reit / bond 等: region で sub-grouping
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
              <SecurityTable items={subset} />
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

// FX セクション (1 行 = 1 通貨ペアポジション)
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
                <span
                  className={
                    h.totalValueJpy >= 0
                      ? 'text-[var(--color-positive)]'
                      : 'text-[var(--color-negative)]'
                  }
                >
                  {h.totalValueJpy >= 0 ? '+' : '-'}¥
                  {Math.abs(h.totalValueJpy).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
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

// 単一通貨の現金テーブル (1 行 = 1 口座)
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

function SecurityTable({ items }: { items: HoldingAgg[] }) {
  const sorted = [...items].sort((a, b) => b.totalValueJpy - a.totalValueJpy);
  return (
    <div className="overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3 w-24">コード</th>
            <th className="py-2 px-3">銘柄名</th>
            <th className="py-2 px-3 text-right w-24">数量</th>
            <th className="py-2 px-3 text-right w-32">評価額 (JPY)</th>
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
                {formatJpy(h.totalValueJpy)}
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                {h.unrealizedPnlJpy != null ? (
                  <span
                    className={
                      h.unrealizedPnlJpy >= 0
                        ? 'text-[var(--color-positive)]'
                        : 'text-[var(--color-negative)]'
                    }
                  >
                    {h.unrealizedPnlJpy >= 0 ? '+' : '-'}¥
                    {Math.abs(h.unrealizedPnlJpy).toLocaleString('ja-JP', {
                      maximumFractionDigits: 0,
                    })}
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
    <div className="overflow-x-auto bg-[var(--color-bg-elevated)] rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2 px-3">銘柄名</th>
            <th className="py-2 px-3 text-right w-28">口数</th>
            <th className="py-2 px-3 text-right w-32">評価額 (JPY)</th>
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
                {formatJpy(h.totalValueJpy)}
              </td>
              <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">
                {h.unrealizedPnlJpy != null ? (
                  <span
                    className={
                      h.unrealizedPnlJpy >= 0
                        ? 'text-[var(--color-positive)]'
                        : 'text-[var(--color-negative)]'
                    }
                  >
                    {h.unrealizedPnlJpy >= 0 ? '+' : '-'}¥
                    {Math.abs(h.unrealizedPnlJpy).toLocaleString('ja-JP', {
                      maximumFractionDigits: 0,
                    })}
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
