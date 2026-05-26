import { useAccounts, useHistoryTotal } from '../api/queries.js';
import { INSTITUTION_LABELS, type Institution } from '@asset-tracker/shared';
import { AllocationPie } from '../components/AllocationPie.js';
import { ArrowUp, ArrowDown } from 'lucide-react';

function formatJpy(n: number): string {
  return `¥${n.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
}

function formatSignedJpy(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}¥${Math.abs(n).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
}

export function Dashboard() {
  const { data: accounts, isLoading, isError } = useAccounts();
  const { data: history } = useHistoryTotal(7);

  if (isLoading) return <p className="text-[var(--color-text-muted)]">読み込み中...</p>;
  if (isError) return <p className="text-[var(--color-negative)]">API に接続できません。Settings を確認してください。</p>;
  if (!accounts || accounts.length === 0) {
    return (
      <div className="text-[var(--color-text-muted)]">
        <p>口座データがまだありません。</p>
        <p className="mt-2 text-sm">PC 側で初回スクレイピングを実行してください。</p>
      </div>
    );
  }

  const total = accounts.reduce((sum, a) => sum + (a.latestTotalJpy ?? 0), 0);

  // 前日比: history.points の最新と「最新より前の最も新しい行」を比較
  let dayDiff: { amount: number; pct: number; prevDate: string } | null = null;
  if (history?.points && history.points.length >= 2) {
    const sorted = [...history.points].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1]!;
    const prev = sorted[sorted.length - 2]!;
    if (prev.totalJpy > 0) {
      dayDiff = {
        amount: latest.totalJpy - prev.totalJpy,
        pct: ((latest.totalJpy - prev.totalJpy) / prev.totalJpy) * 100,
        prevDate: prev.date,
      };
    }
  }

  const diffColor =
    dayDiff == null
      ? ''
      : dayDiff.amount >= 0
        ? 'text-[var(--color-positive)]'
        : 'text-[var(--color-negative)]';

  return (
    <div className="space-y-6">
      <section className="bg-[var(--color-bg-elevated)] rounded-lg p-6 border border-[var(--color-border)]">
        <p className="text-sm text-[var(--color-text-muted)]">総資産 (JPY 換算)</p>
        <p className="text-3xl font-bold mt-1 tabular-nums">{formatJpy(total)}</p>
        {dayDiff != null ? (
          <p className={`mt-2 text-sm tabular-nums flex items-center gap-1 ${diffColor}`}>
            {dayDiff.amount >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            {formatSignedJpy(dayDiff.amount)}
            <span className="opacity-80">
              ({dayDiff.pct >= 0 ? '+' : ''}
              {dayDiff.pct.toFixed(2)}%)
            </span>
            <span className="text-[var(--color-text-muted)] ml-1 text-xs">
              vs {dayDiff.prevDate}
            </span>
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">前日比: 比較データなし</p>
        )}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AllocationPie by="assetClass" title="資産クラス別" />
        <AllocationPie by="currency" title="通貨別" />
        <AllocationPie by="region" title="地域別" />
        <AllocationPie by="institution" title="機関別" />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2">口座別残高</h2>
        <ul className="space-y-2">
          {accounts.map((a) => {
            const instLabel = INSTITUTION_LABELS[a.institution as Institution] ?? a.institution;
            return (
              <li
                key={a.id}
                className="bg-[var(--color-bg-elevated)] rounded-lg p-3 border border-[var(--color-border)] flex justify-between items-center"
              >
                <div>
                  <p className="font-medium">{instLabel}</p>
                  {a.label && a.label !== instLabel && (
                    <p className="text-xs text-[var(--color-text-muted)]">{a.label}</p>
                  )}
                </div>
                <p className="tabular-nums">
                  {a.latestTotalJpy != null ? formatJpy(a.latestTotalJpy) : '—'}
                </p>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
