import { useAccounts } from '../api/queries.js';
import {
  ACCOUNT_KIND_LABELS,
  ASSET_CLASS_LABELS,
  INSTITUTION_LABELS,
  type AccountAssetBreakdown,
  type AccountKind,
  type AssetClass,
  type Institution,
} from '@asset-tracker/shared';

function formatJpy(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

function formatSignedJpy(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${sign}¥${Math.round(Math.abs(n)).toLocaleString('ja-JP')}`;
}

function formatSignedPct(ratio: number): string {
  const sign = ratio > 0 ? '+' : ratio < 0 ? '−' : '±';
  return `${sign}${(Math.abs(ratio) * 100).toFixed(2)}%`;
}

function toneClass(diff: number): string {
  if (diff > 0) return 'text-[var(--color-positive)]';
  if (diff < 0) return 'text-[var(--color-negative)]';
  return 'text-[var(--color-text-muted)]';
}

function Delta({ now, prev }: { now: number; prev: number | null }) {
  if (prev == null) return <span className="text-[var(--color-text-muted)]">—</span>;
  const diff = now - prev;
  const ratio = prev !== 0 ? diff / prev : 0;
  return (
    <span className={`tabular-nums ${toneClass(diff)}`}>
      {formatSignedJpy(diff)}{' '}
      <span className="text-xs opacity-80">({formatSignedPct(ratio)})</span>
    </span>
  );
}

function BreakdownRow({ row }: { row: AccountAssetBreakdown }) {
  const label = ASSET_CLASS_LABELS[row.assetClass as AssetClass] ?? row.assetClass;
  return (
    <div className="flex justify-between items-baseline gap-3 py-1 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="flex-1 border-b border-dotted border-[var(--color-border)] self-end mb-1.5" />
      <span className="tabular-nums">{formatJpy(row.valueJpy)}</span>
      <span className="text-right min-w-[8rem]">
        <Delta now={row.valueJpy} prev={row.prevValueJpy} />
      </span>
    </div>
  );
}

export function Accounts() {
  const { data, isLoading } = useAccounts();

  if (isLoading) return <p className="text-[var(--color-text-muted)]">読み込み中...</p>;
  if (!data || data.length === 0)
    return <p className="text-[var(--color-text-muted)]">口座がまだ登録されていません。</p>;

  return (
    <div className="space-y-6">
      {/* 既存: 一覧テーブル */}
      <table className="w-full text-sm">
        <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
          <tr>
            <th className="py-2">機関</th>
            <th>種類</th>
            <th>取得元</th>
            <th className="text-right">残高 (JPY)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((a) => (
            <tr key={a.id} className="border-b border-[var(--color-border)]">
              <td className="py-2 font-medium">
                {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
              </td>
              <td>{ACCOUNT_KIND_LABELS[a.kind as AccountKind] ?? a.kind}</td>
              <td className="text-[var(--color-text-muted)]">{a.source}</td>
              <td className="text-right tabular-nums">
                {a.latestTotalJpy != null
                  ? `¥${a.latestTotalJpy.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 追加: 口座ごとの前日比 + カテゴリ別ブレークダウン */}
      <section>
        <h2 className="text-base font-semibold mb-3">前日比 / カテゴリ別内訳</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {data.map((a) => {
            const inst = INSTITUTION_LABELS[a.institution as Institution] ?? a.institution;
            return (
              <div
                key={a.id}
                className="p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded"
              >
                <div className="flex items-baseline justify-between mb-2">
                  <span className="font-medium">
                    {inst}{' '}
                    <span className="text-xs text-[var(--color-text-muted)] font-normal">
                      {a.label}
                    </span>
                  </span>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {ACCOUNT_KIND_LABELS[a.kind as AccountKind] ?? a.kind}
                  </span>
                </div>

                <div className="flex justify-between items-baseline gap-3 pb-2 border-b border-[var(--color-border)]">
                  <span className="text-sm text-[var(--color-text-muted)]">合計</span>
                  <span className="tabular-nums font-medium">
                    {a.latestTotalJpy != null ? formatJpy(a.latestTotalJpy) : '—'}
                  </span>
                  <span className="text-right min-w-[8rem]">
                    {a.latestTotalJpy != null ? (
                      <Delta now={a.latestTotalJpy} prev={a.prevTotalJpy} />
                    ) : (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    )}
                  </span>
                </div>

                {a.breakdown.length > 0 ? (
                  <div className="mt-1">
                    {a.breakdown.map((row) => (
                      <BreakdownRow key={row.assetClass} row={row} />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    保有データなし
                  </p>
                )}

                {a.prevCapturedDate && (
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                    前日比は {a.prevCapturedDate} との差分
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
