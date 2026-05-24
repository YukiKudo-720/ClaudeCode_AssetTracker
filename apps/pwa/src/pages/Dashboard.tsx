import { useAccounts } from '../api/queries.js';
import { INSTITUTION_LABELS, type Institution } from '@asset-tracker/shared';

export function Dashboard() {
  const { data: accounts, isLoading, isError } = useAccounts();

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

  return (
    <div className="space-y-6">
      <section className="bg-[var(--color-bg-elevated)] rounded-lg p-6 border border-[var(--color-border)]">
        <p className="text-sm text-[var(--color-text-muted)]">総資産 (JPY 換算)</p>
        <p className="text-3xl font-bold mt-1 tabular-nums">
          ¥{total.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2">口座別残高</h2>
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li
              key={a.id}
              className="bg-[var(--color-bg-elevated)] rounded-lg p-3 border border-[var(--color-border)] flex justify-between items-center"
            >
              <div>
                <p className="font-medium">{INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{a.label}</p>
              </div>
              <p className="tabular-nums">
                {a.latestTotalJpy != null
                  ? `¥${a.latestTotalJpy.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`
                  : '—'}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
