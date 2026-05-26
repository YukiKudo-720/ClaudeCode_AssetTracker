import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { CategoryAgg } from '@asset-tracker/shared';
import { pickColor } from '../lib/colors.js';

interface Props {
  categories: CategoryAgg[];
  totalJpy: number;
}

// 1% 未満を「その他」にまとめる閾値
const SMALL_THRESHOLD = 0.01;
// このサイズ以上のスライスのみ leader 線付きラベルを描画 (重なり防止)
const LABEL_THRESHOLD = 0.03;

export function CategoryPie({ categories, totalJpy }: Props) {
  const chartData = useMemo(() => {
    if (categories.length === 0) return [];
    const sumValue = categories.reduce((s, c) => s + c.valueJpy, 0);
    if (sumValue <= 0) return [];

    const sorted = [...categories].sort((a, b) => b.valueJpy - a.valueJpy);
    const big: Array<{ name: string; value: number; ratio: number }> = [];
    let otherValue = 0;
    let otherCount = 0;
    for (const c of sorted) {
      const r = c.valueJpy / sumValue;
      if (r < SMALL_THRESHOLD) {
        otherValue += c.valueJpy;
        otherCount += 1;
      } else {
        big.push({ name: c.name, value: c.valueJpy, ratio: r });
      }
    }
    if (otherValue > 0) {
      big.push({
        name: `その他 (${otherCount} テーマ)`,
        value: otherValue,
        ratio: otherValue / sumValue,
      });
    }
    return big;
  }, [categories]);

  if (chartData.length === 0) return null;

  const sumValue = chartData.reduce((s, d) => s + d.value, 0);
  const coverage = totalJpy > 0 ? sumValue / totalJpy : 0;

  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)]">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">テーマ別配分</h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          合計 ¥{sumValue.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}{' '}
          (総資産の {(coverage * 100).toFixed(1)}% / 重複含む)
        </span>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          {/* ラベル overflow を許可しつつ、長文ラベル用に左右マージン確保 */}
          <PieChart margin={{ top: 20, right: 100, bottom: 20, left: 100 }}>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius="65%"
              innerRadius="35%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={1}
              isAnimationActive={false}
              labelLine={false}
              label={renderPieLabel}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={pickColor(i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, _n, p) => {
                const ratio = (p.payload as { ratio: number }).ratio;
                return [
                  `¥${v.toLocaleString('ja-JP', { maximumFractionDigits: 0 })} (${(ratio * 100).toFixed(1)}%)`,
                  '',
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* 列順を 1,3 / 2,4 にするため、左右に分割して 2 つの ul を並べる */}
      <LegendGrid items={chartData} />
    </div>
  );
}

function LegendGrid({
  items,
}: {
  items: Array<{ name: string; value: number; ratio: number }>;
}) {
  const half = Math.ceil(items.length / 2);
  const cols = [items.slice(0, half), items.slice(half)];

  return (
    <div className="mt-2 text-xs grid grid-cols-1 sm:grid-cols-2 gap-x-4">
      {cols.map((col, ci) => (
        <ul key={ci} className="space-y-1">
          {col.map((d) => {
            // 全体配列でのオリジナル index (色 picker と一致させるため)
            const originalIndex = ci === 0 ? items.indexOf(d) : half + col.indexOf(d);
            return (
              <li key={d.name} className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ background: pickColor(originalIndex) }}
                />
                <span className="flex-1 truncate">{d.name}</span>
                <span className="tabular-nums text-[var(--color-text-muted)] w-14 text-right">
                  {(d.ratio * 100).toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

// Recharts 用カスタムラベル: スライスから leader 線を引いて name + % を表示
interface PieLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  outerRadius: number;
  name: string;
  payload: { ratio: number };
}

// 長すぎる name は省略 (legend には full name あり)
const MAX_LABEL_CHARS = 7;
function shortenName(name: string): string {
  if (name.length <= MAX_LABEL_CHARS) return name;
  return name.slice(0, MAX_LABEL_CHARS) + '…';
}

function renderPieLabel(props: unknown): React.ReactNode {
  const { cx, cy, midAngle, outerRadius, name, payload } = props as PieLabelProps;
  const ratio = payload.ratio;
  if (ratio < LABEL_THRESHOLD) return null;

  const RADIAN = Math.PI / 180;
  const sin = Math.sin(-midAngle * RADIAN);
  const cos = Math.cos(-midAngle * RADIAN);
  const sx = cx + (outerRadius + 2) * cos;
  const sy = cy + (outerRadius + 2) * sin;
  const mx = cx + (outerRadius + 16) * cos;
  const my = cy + (outerRadius + 16) * sin;
  const ex = mx + (cos >= 0 ? 1 : -1) * 12;
  const ey = my;
  const textAnchor = cos >= 0 ? 'start' : 'end';
  const textX = ex + (cos >= 0 ? 4 : -4);
  const displayName = shortenName(name);

  return (
    <g>
      <path
        d={`M${sx},${sy}L${mx},${my}L${ex},${ey}`}
        stroke="var(--color-text-muted)"
        fill="none"
        strokeWidth={1}
      />
      <circle cx={ex} cy={ey} r={2} fill="var(--color-text-muted)" stroke="none" />
      <text
        x={textX}
        y={ey}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fontSize={11}
        fill="var(--color-text)"
      >
        <tspan x={textX} dy="-0.45em">
          {displayName}
        </tspan>
        <tspan x={textX} dy="1.2em" className="tabular-nums">
          {(ratio * 100).toFixed(1)}%
        </tspan>
      </text>
    </g>
  );
}
