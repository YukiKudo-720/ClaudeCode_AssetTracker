import { useState } from 'react';
import { useCategories } from '../api/queries.js';
import { ASSET_CLASS_LABELS, type AssetClass } from '@asset-tracker/shared';

function formatJpy(v: number): string {
  return `¥${v.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
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
      <div className="text-sm text-[var(--color-text-muted)] flex justify-between items-baseline">
        <span>
          {data.categories.length} テーマ / 未分類 {data.untagged.length} 銘柄
        </span>
        <span className="text-base text-[var(--color-text)] tabular-nums font-medium">
          総資産 {formatJpy(data.totalJpy)}
        </span>
      </div>

      <section>
        <h2 className="text-lg font-bold text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] pb-1 mb-3">
          テーマ別配分
        </h2>
        <ul className="space-y-2">
          {data.categories.map((cat) => {
            const isOpen = expanded.has(cat.id);
            return (
              <li
                key={cat.id}
                className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg"
              >
                <button
                  onClick={() => toggle(cat.id)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-[var(--color-bg)]"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--color-text-muted)] text-xs w-4">
                      {isOpen ? '▼' : '▶'}
                    </span>
                    <span className="font-medium">{cat.name}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {cat.securityCount} 銘柄
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="tabular-nums font-medium">{formatJpy(cat.valueJpy)}</span>
                    <span className="tabular-nums text-sm text-[var(--color-text-muted)] w-14 text-right">
                      {(cat.ratio * 100).toFixed(1)}%
                    </span>
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-3 border-t border-[var(--color-border)]">
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
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {data.untagged.length > 0 && (
        <section>
          <h2 className="text-lg font-bold text-[var(--color-text-muted)] border-b-2 border-[var(--color-border)] pb-1 mb-3">
            未分類 ({data.untagged.length} 銘柄 / {formatJpy(data.untaggedJpy)})
          </h2>
          <div className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-lg overflow-x-auto">
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
        </section>
      )}
    </div>
  );
}
