import { useAccounts } from '../api/queries.js';
import { INSTITUTION_LABELS, type Institution } from '@asset-tracker/shared';

export function Accounts() {
  const { data, isLoading } = useAccounts();

  if (isLoading) return <p className="text-[var(--color-text-muted)]">読み込み中...</p>;
  if (!data || data.length === 0) return <p className="text-[var(--color-text-muted)]">口座がまだ登録されていません。</p>;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
        <tr>
          <th className="py-2">機関</th>
          <th>ラベル</th>
          <th>種類</th>
          <th>取得元</th>
          <th className="text-right">残高 (JPY)</th>
        </tr>
      </thead>
      <tbody>
        {data.map((a) => (
          <tr key={a.id} className="border-b border-[var(--color-border)]">
            <td className="py-2 font-medium">{INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}</td>
            <td>{a.label}</td>
            <td>{a.kind === 'bank' ? '銀行' : '証券'}</td>
            <td className="text-[var(--color-text-muted)]">{a.source}</td>
            <td className="text-right tabular-nums">
              {a.latestTotalJpy != null ? `¥${a.latestTotalJpy.toLocaleString('ja-JP')}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
