import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  ReferenceDot,
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

// 積み上げ順 (下から)。MF 風に「現金/預金」を下、株式系を中央、その他を上に。
// 期間内に 1 点でも > 0 のものだけ実際に Area を描く。
const ASSET_CLASS_AREAS: Array<{ key: keyof HistoryTotalPoint; label: string; color: string }> = [
  { key: 'cash', label: '現金', color: '#3b82f6' },
  { key: 'fx', label: 'FX', color: '#06b6d4' },
  { key: 'stock', label: '株式', color: '#ef4444' },
  { key: 'etf', label: 'ETF', color: '#f97316' },
  { key: 'mutual_fund', label: '投資信託', color: '#f59e0b' },
  { key: 'reit', label: 'REIT', color: '#eab308' },
  { key: 'bond', label: '債券', color: '#92400e' },
  { key: 'crypto', label: '暗号資産', color: '#ec4899' },
  { key: 'commodity', label: 'コモディティ', color: '#a855f7' },
  { key: 'other', label: 'その他', color: '#9ca3af' },
];

function formatJpy(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

// payload は visible な Area の値だけ含まれる (Legend で hide にしたものは除外される)。
// 総額はその合計として算出 → 「隠した区分の影響を受けた表示総額」になる。
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; color?: string; dataKey?: string | number }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce(
    (s, p) => s + (typeof p.value === 'number' ? p.value : 0),
    0,
  );
  return (
    <div className="p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-md text-xs space-y-0.5">
      <p className="font-medium text-[var(--color-text)]">{label}</p>
      <p className="font-medium border-b border-[var(--color-border)] pb-1 mb-1">
        総額: <span className="tabular-nums">{formatJpy(total)}</span>
      </p>
      {payload.map((p) => (
        <p key={p.dataKey as string} style={{ color: p.color }} className="tabular-nums">
          {p.name}: {formatJpy(typeof p.value === 'number' ? p.value : 0)}
        </p>
      ))}
    </div>
  );
}

export function History() {
  const [days, setDays] = useState(90);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
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

  // 期間内に 1 点でも > 0 の assetClass だけ Area を描く
  const visibleAreas = useMemo(() => {
    if (!data || data.points.length === 0) return [];
    return ASSET_CLASS_AREAS.filter((c) =>
      data.points.some((p) => (p[c.key] as number) > 0),
    );
  }, [data]);

  // hidden を考慮した stacked 合計を再計算して peak の y 位置を補正
  // (隠した区分の上には ReferenceDot を打ちたくないため)
  const peakStackY = useMemo(() => {
    if (!summary || !data) return null;
    const p = data.points.find((x) => x.date === summary.peak.date);
    if (!p) return null;
    return visibleAreas.reduce(
      (sum, a) => (hidden.has(a.key as string) ? sum : sum + (p[a.key] as number)),
      0,
    );
  }, [summary, data, visibleAreas, hidden]);

  function toggleHidden(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
        <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)] h-[28rem]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.points} margin={{ top: 30, right: 20, bottom: 10, left: 0 }}>
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
              {/* グラフに被らないよう左上固定。総額はカスタム Tooltip 内で算出 */}
              <Tooltip
                content={<ChartTooltip />}
                position={{ x: 10, y: 0 }}
                cursor={{ stroke: 'var(--color-text-muted)', strokeDasharray: '3 3' }}
              />
              <Legend
                wrapperStyle={{ fontSize: '12px', cursor: 'pointer' }}
                onClick={(e: unknown) => {
                  const dk = (e as { dataKey?: unknown })?.dataKey;
                  if (typeof dk === 'string') toggleHidden(dk);
                }}
                formatter={(value: string, entry: unknown) => {
                  const dk = (entry as { dataKey?: unknown })?.dataKey;
                  const isHidden = typeof dk === 'string' && hidden.has(dk);
                  return (
                    <span
                      style={{
                        textDecoration: isHidden ? 'line-through' : 'none',
                        opacity: isHidden ? 0.5 : 1,
                      }}
                    >
                      {value}
                    </span>
                  );
                }}
              />

              {visibleAreas.map((c) => (
                <Area
                  key={c.key as string}
                  type="monotone"
                  dataKey={c.key as string}
                  name={c.label}
                  stackId="1"
                  stroke={c.color}
                  fill={c.color}
                  fillOpacity={0.7}
                  hide={hidden.has(c.key as string)}
                  isAnimationActive={false}
                />
              ))}

              {/* 期間最大ポイント + 金額ラベル (積み上げの頂点に打つ) */}
              {summary && peakStackY != null && peakStackY > 0 && (
                <ReferenceDot
                  x={summary.peak.date}
                  y={peakStackY}
                  r={5}
                  fill="var(--color-accent)"
                  stroke="var(--color-bg-elevated)"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  label={{
                    value: `最大 ${formatJpy(peakStackY)}`,
                    position: 'top',
                    fill: 'var(--color-accent)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
