import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { HistoryTotalPoint } from '@asset-tracker/shared';
import { useHistoryTotal } from '../api/queries.js';

const PERIODS = [
  { label: '1M', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'ALL', days: 3650 },
];

// 描画する assetClass。期間内に 1 点でも > 0 の class だけ実際に表示する。
// 色は Tailwind の標準パレット相当 (dark/light どちらでも読める中間色)。
const ASSET_CLASS_LINES: Array<{ key: keyof HistoryTotalPoint; label: string; color: string }> = [
  { key: 'stock', label: '株式', color: '#3b82f6' },
  { key: 'etf', label: 'ETF', color: '#10b981' },
  { key: 'mutual_fund', label: '投資信託', color: '#a855f7' },
  { key: 'reit', label: 'REIT', color: '#f59e0b' },
  { key: 'bond', label: '債券', color: '#92400e' },
  { key: 'cash', label: '現金', color: '#6b7280' },
  { key: 'fx', label: 'FX', color: '#06b6d4' },
  { key: 'crypto', label: '暗号資産', color: '#ec4899' },
  { key: 'commodity', label: 'コモディティ', color: '#eab308' },
  { key: 'other', label: 'その他', color: '#9ca3af' },
];

function formatJpy(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

export function History() {
  const [days, setDays] = useState(90);
  const { data, isLoading, isError } = useHistoryTotal(days);

  // 期間内 totalJpy の peak と直近値
  const summary = useMemo(() => {
    if (!data || data.points.length === 0) return null;
    const peak = data.points.reduce((best, p) => (p.totalJpy > best.totalJpy ? p : best), data.points[0]!);
    const latest = data.points[data.points.length - 1]!;
    const first = data.points[0]!;
    const diff = latest.totalJpy - first.totalJpy;
    const diffRatio = first.totalJpy > 0 ? diff / first.totalJpy : 0;
    return { peak, latest, first, diff, diffRatio };
  }, [data]);

  // 期間内に 1 点でも > 0 の assetClass だけ Line を描く
  const visibleLines = useMemo(() => {
    if (!data || data.points.length === 0) return [];
    return ASSET_CLASS_LINES.filter((c) =>
      data.points.some((p) => (p[c.key] as number) > 0),
    );
  }, [data]);

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

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded">
            <p className="text-xs text-[var(--color-text-muted)]">期間最大</p>
            <p className="text-lg font-semibold tabular-nums">{formatJpy(summary.peak.totalJpy)}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{summary.peak.date}</p>
          </div>
          <div className="p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded">
            <p className="text-xs text-[var(--color-text-muted)]">期間最終</p>
            <p className="text-lg font-semibold tabular-nums">{formatJpy(summary.latest.totalJpy)}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{summary.latest.date}</p>
          </div>
          <div className="p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded">
            <p className="text-xs text-[var(--color-text-muted)]">期間始点</p>
            <p className="text-lg font-semibold tabular-nums">{formatJpy(summary.first.totalJpy)}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{summary.first.date}</p>
          </div>
          <div className="p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded">
            <p className="text-xs text-[var(--color-text-muted)]">期間損益</p>
            <p
              className={`text-lg font-semibold tabular-nums ${
                summary.diff > 0
                  ? 'text-[var(--color-positive)]'
                  : summary.diff < 0
                    ? 'text-[var(--color-negative)]'
                    : ''
              }`}
            >
              {summary.diff >= 0 ? '+' : '−'}
              {formatJpy(Math.abs(summary.diff))}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {(summary.diffRatio * 100).toFixed(2)}%
            </p>
          </div>
        </div>
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

              {/* 期間最大ラインを強調 */}
              {summary && (
                <ReferenceLine
                  y={summary.peak.totalJpy}
                  stroke="var(--color-accent)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: `最大 ${formatJpy(summary.peak.totalJpy)}`,
                    fill: 'var(--color-accent)',
                    fontSize: 11,
                    position: 'insideTopRight',
                  }}
                />
              )}

              <Line
                type="monotone"
                dataKey="totalJpy"
                name="総資産"
                stroke="var(--color-primary)"
                strokeWidth={2}
                dot={false}
              />

              {visibleLines.map((c) => (
                <Line
                  key={c.key as string}
                  type="monotone"
                  dataKey={c.key as string}
                  name={c.label}
                  stroke={c.color}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
