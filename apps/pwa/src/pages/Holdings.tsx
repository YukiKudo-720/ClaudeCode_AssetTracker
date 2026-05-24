import { useMemo, useState } from 'react';
import { useHoldings } from '../api/queries.js';
import {
  ASSET_CLASS_LABELS,
  INSTITUTION_LABELS,
  type AssetClass,
  type Institution,
} from '@asset-tracker/shared';

type SortKey = 'value' | 'symbol' | 'name' | 'pnl';
type SortDir = 'asc' | 'desc';

export function Holdings() {
  const { data, isLoading, isError } = useHoldings();
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [classFilter, setClassFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.holdings;
    if (classFilter !== 'all') {
      rows = rows.filter((h) => h.assetClass === classFilter);
    }
    return [...rows].sort((a, b) => {
      let diff = 0;
      if (sortKey === 'value') diff = a.totalValueJpy - b.totalValueJpy;
      else if (sortKey === 'symbol') diff = a.symbol.localeCompare(b.symbol);
      else if (sortKey === 'name') diff = a.name.localeCompare(b.name, 'ja');
      else if (sortKey === 'pnl') diff = (a.unrealizedPnlJpy ?? 0) - (b.unrealizedPnlJpy ?? 0);
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [data, sortKey, sortDir, classFilter]);

  const totalValue = useMemo(() => filtered.reduce((s, h) => s + h.totalValueJpy, 0), [filtered]);

  if (isLoading) return <p className="text-[var(--color-text-muted)]">読み込み中...</p>;
  if (isError || !data) return <p className="text-[var(--color-negative)]">API エラー</p>;
  if (data.holdings.length === 0) return <p className="text-[var(--color-text-muted)]">保有銘柄がまだありません。</p>;

  const classes = Array.from(new Set(data.holdings.map((h) => h.assetClass)));

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setSortDir(k === 'symbol' || k === 'name' ? 'asc' : 'desc');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm">
          <span className="text-[var(--color-text-muted)] mr-2">資産クラス</span>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="border border-[var(--color-border)] rounded px-2 py-1 bg-[var(--color-bg-elevated)]"
          >
            <option value="all">すべて</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {ASSET_CLASS_LABELS[c as AssetClass] ?? c}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto text-sm text-[var(--color-text-muted)]">
          {filtered.length} 件 / 合計 ¥{totalValue.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
            <tr>
              <Th onClick={() => toggleSort('symbol')} active={sortKey === 'symbol'} dir={sortDir}>
                銘柄コード
              </Th>
              <Th onClick={() => toggleSort('name')} active={sortKey === 'name'} dir={sortDir}>
                銘柄名
              </Th>
              <th className="py-2">クラス</th>
              <th className="py-2 text-right">数量</th>
              <Th align="right" onClick={() => toggleSort('value')} active={sortKey === 'value'} dir={sortDir}>
                評価額 (JPY)
              </Th>
              <Th align="right" onClick={() => toggleSort('pnl')} active={sortKey === 'pnl'} dir={sortDir}>
                損益 (JPY)
              </Th>
              <th className="py-2">保有口座</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h) => (
              <tr key={h.securityId} className="border-b border-[var(--color-border)]">
                <td className="py-2 font-mono">{h.symbol}</td>
                <td className="py-2">
                  <div>{h.name}</div>
                  {h.sector && <div className="text-xs text-[var(--color-text-muted)]">{h.sector}</div>}
                </td>
                <td className="py-2 text-xs">
                  {ASSET_CLASS_LABELS[h.assetClass as AssetClass] ?? h.assetClass}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {h.totalQuantity.toLocaleString('ja-JP', { maximumFractionDigits: 4 })}
                </td>
                <td className="py-2 text-right tabular-nums">
                  ¥{h.totalValueJpy.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {h.unrealizedPnlJpy != null ? (
                    <span
                      className={
                        h.unrealizedPnlJpy >= 0
                          ? 'text-[var(--color-positive)]'
                          : 'text-[var(--color-negative)]'
                      }
                    >
                      {h.unrealizedPnlJpy >= 0 ? '+' : ''}
                      ¥{Math.abs(h.unrealizedPnlJpy).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
                      {h.unrealizedPnlRatio != null && (
                        <div className="text-xs">
                          {h.unrealizedPnlJpy >= 0 ? '+' : ''}
                          {(h.unrealizedPnlRatio * 100).toFixed(2)}%
                        </div>
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-2 text-xs">
                  {h.accounts.map((a) => (
                    <div key={a.accountId}>
                      {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
                      <span className="text-[var(--color-text-muted)]"> ×{a.quantity}</span>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ThProps {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  dir?: SortDir;
  align?: 'left' | 'right';
}

function Th({ children, onClick, active, dir, align = 'left' }: ThProps) {
  return (
    <th
      onClick={onClick}
      className={`py-2 cursor-pointer select-none ${align === 'right' ? 'text-right' : ''} ${
        active ? 'text-[var(--color-text)]' : ''
      }`}
    >
      {children}
      {active && <span className="ml-1">{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
}
