import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useHistoryTotal } from '../api/queries.js';

const PERIODS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'ALL', days: 3650 },
];

export function History() {
  const [days, setDays] = useState(90);
  const { data, isLoading, isError } = useHistoryTotal(days);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--color-text-muted)]">期間</span>
        {PERIODS.map((p) => (
          <button
            key={p.label}
            onClick={() => setDays(p.days)}
            className={`px-3 py-1 text-sm rounded border ${
              days === p.days
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                : 'bg-[var(--color-bg-elevated)] border-[var(--color-border)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-[var(--color-text-muted)]">読み込み中...</p>}
      {isError && <p className="text-[var(--color-negative)]">API エラー</p>}
      {data && data.points.length === 0 && (
        <p className="text-[var(--color-text-muted)]">この期間のデータがまだありません。</p>
      )}

      {data && data.points.length > 0 && (
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)] h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.points} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                stroke="var(--color-text-muted)"
                tick={{ fontSize: 11 }}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis
                stroke="var(--color-text-muted)"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) =>
                  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${(v / 1000).toFixed(0)}k`
                }
              />
              <Tooltip
                formatter={(v: number) => `¥${v.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`}
                contentStyle={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line
                type="monotone"
                dataKey="totalJpy"
                name="総資産"
                stroke="var(--color-primary)"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cashJpy"
                name="現金"
                stroke="var(--color-accent)"
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 4"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
