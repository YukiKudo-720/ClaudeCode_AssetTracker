import { useState } from 'react';
import { useCategories } from '../api/queries.js';
import { ASSET_CLASS_LABELS, type AssetClass, type CategoryAgg } from '@asset-tracker/shared';
import { CategoryPie } from '../components/CategoryPie.js';

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

function DayDiff({ current, prev }: { current: number; prev: number | null }) {
  if (prev == null || prev === 0) {
    return <span className="text-[var(--color-text-muted)] text-xs">—</span>;
  }
  const diff = current - prev;
  const pct = (diff / prev) * 100;
  return (
    <span className={`tabular-nums text-xs ${diffClass(diff)}`}>
      {formatSignedJpy(diff)}
      <span className="opacity-80 ml-1">
        ({diff >= 0 ? '+' : ''}
        {pct.toFixed(2)}%)
      </span>
    </span>
  );
}

export function Categories() {
  const { data, isLoading, isError } = useCategories();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (isLoading) return <p className="text-[var(--color-text-muted)]">読み込み中...</p>;
  if (isError || !data) return <p className="text-[var(--color-negative)]">API エラー</p>;

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-[var(--color-text-muted)] flex justify-between items-baseline flex-wrap gap-2">
        <span>
          {data.categories.length} テーマ / 未分類 {data.untagged.length} 銘柄
          {data.prevCapturedDate && (
            <span className="ml-2 opacity-70">(前日比: vs {data.prevCapturedDate})</span>
          )}
        </span>
        <span className="text-base text-[var(--color-text)] tabular-nums font-medium">
          総資産 {formatJpy(data.totalJpy)}
        </span>
      </div>

      <CategoryPie categories={data.categories} totalJpy={data.totalJpy} />

      <section>
        <h2 className="text-lg font-bold text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] pb-1 mb-3">
          テーマ別配分
        </h2>
        <ul className="space-y-2">
          {data.categories.map((cat) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              isOpen={expanded.has(cat.id)}
              onToggle={() => toggle(cat.id)}
            />
          ))}
        </ul>
      </section>

      {data.untagged.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-[var(--color-text-muted)] border-b-2 border-[var(--color-border)] pb-1 mb-3">
            未分類 ({data.untagged.length} 銘柄 / {formatJpy(data.untaggedJpy)})
          </h2>

          {/* Desktop: table */}
          <div className="hidden md:block bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <tr>
                  <th className="py-2 px-3 w-24">コード</th>
                  <th className="py-2 px-3">銘柄名</th>
                  <th className="py-2 px-3 w-24">クラス</th>
                  <th className="py-2 px-3 text-right w-32">評価額</th>
                </tr>
              </thead>
              <tbody>
                {data.untagged.map((s) => (
                  <tr key={s.securityId} className="border-t border-[var(--color-border)]">
                    <td className="py-2 px-3 font-mono text-xs">{s.symbol}</td>
                    <td className="py-2 px-3">{s.name}</td>
                    <td className="py-2 px-3 text-xs">
                      {ASSET_CLASS_LABELS[s.assetClass as AssetClass] ?? s.assetClass}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatJpy(s.valueJpy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden space-y-2">
            {data.untagged.map((s) => (
              <article
                key={s.securityId}
                className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg p-3"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono text-[var(--color-text-muted)]">
                      {s.symbol} · {ASSET_CLASS_LABELS[s.assetClass as AssetClass] ?? s.assetClass}
                    </div>
                    <div className="font-medium truncate">{s.name}</div>
                  </div>
                  <div className="font-semibold tabular-nums whitespace-nowrap">
                    {formatJpy(s.valueJpy)}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CategoryRow({
  cat,
  isOpen,
  onToggle,
}: {
  cat: CategoryAgg;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg">
      <button
        onClick={onToggle}
        className="w-full px-3 py-3 flex items-center justify-between gap-2 text-left hover:bg-[var(--color-bg)]"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[var(--color-text-muted)] text-xs w-3 flex-shrink-0">
            {isOpen ? '▼' : '▶'}
          </span>
          <span className="font-medium truncate">{cat.name}</span>
          <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0">
            {cat.securityCount} 銘柄
          </span>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="flex items-baseline gap-2 justify-end">
            <span className="tabular-nums font-medium">{formatJpy(cat.valueJpy)}</span>
            <span className="tabular-nums text-xs text-[var(--color-text-muted)] w-12 text-right">
              {(cat.ratio * 100).toFixed(1)}%
            </span>
          </div>
          <div className="text-right">
            <DayDiff current={cat.valueJpy} prev={cat.prevValueJpy} />
          </div>
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-[var(--color-border)]">
          {/* Desktop: table */}
          <div className="hidden md:block px-4 pb-3">
            <table className="w-full text-sm">
              <thead className="text-left text-[var(--color-text-muted)]">
                <tr>
                  <th className="py-2 w-24">コード</th>
                  <th className="py-2">銘柄名</th>
                  <th className="py-2 w-24">クラス</th>
                  <th className="py-2 text-right w-24">weight</th>
                  <th className="py-2 text-right w-32">寄与額</th>
                  <th className="py-2 text-right w-32">銘柄評価額</th>
                </tr>
              </thead>
              <tbody>
                {cat.securities.map((s) => (
                  <tr key={s.securityId} className="border-t border-[var(--color-border)]">
                    <td className="py-1 font-mono text-xs">{s.symbol}</td>
                    <td className="py-1">{s.name}</td>
                    <td className="py-1 text-xs">
                      {ASSET_CLASS_LABELS[s.assetClass as AssetClass] ?? s.assetClass}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {s.weight === 1 ? '—' : s.weight.toFixed(2)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatJpy(s.weightedValueJpy)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-[var(--color-text-muted)]">
                      {formatJpy(s.totalValueJpy)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden p-2 space-y-2">
            {cat.securities.map((s) => (
              <div
                key={s.securityId}
                className="bg-[var(--color-bg)] rounded p-2 border border-[var(--color-border)]"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-mono text-[var(--color-text-muted)]">
                      {s.symbol} · {ASSET_CLASS_LABELS[s.assetClass as AssetClass] ?? s.assetClass}
                      {s.weight !== 1 && (
                        <span className="ml-2">weight {s.weight.toFixed(2)}</span>
                      )}
                    </div>
                    <div className="text-sm truncate">{s.name}</div>
                  </div>
                  <div className="text-right tabular-nums text-sm whitespace-nowrap">
                    <div className="font-medium">{formatJpy(s.weightedValueJpy)}</div>
                    {s.weight !== 1 && (
                      <div className="text-xs text-[var(--color-text-muted)]">
                        (銘柄 {formatJpy(s.totalValueJpy)})
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}
