import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useAllocation } from '../api/queries.js';
import { pickColor } from '../lib/colors.js';
import {
  ASSET_CLASS_LABELS,
  INSTITUTION_LABELS,
  REGION_LABELS,
  type AssetClass,
  type Institution,
  type Region,
} from '@asset-tracker/shared';

type By = 'currency' | 'assetClass' | 'region' | 'institution';

interface Props {
  by: By;
  title: string;
}

function labelize(by: By, key: string): string {
  if (by === 'assetClass') return ASSET_CLASS_LABELS[key as AssetClass] ?? key;
  if (by === 'region') return REGION_LABELS[key as Region] ?? key;
  if (by === 'institution') return INSTITUTION_LABELS[key as Institution] ?? key;
  return key; // currency はそのまま
}

export function AllocationPie({ by, title }: Props) {
  const { data, isLoading, isError } = useAllocation(by);

  // backend が valueJpy 降順でソート済み。先頭が一番大きい slice。
  const chartData = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => ({
      name: labelize(by, b.key),
      value: b.valueJpy,
      ratio: b.ratio,
    }));
  }, [data, by]);

  if (isLoading)
    return (
      <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)] text-[var(--color-text-muted)] text-sm">
        {title} 読み込み中...
      </div>
    );
  if (isError || !data)
    return (
      <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)] text-[var(--color-negative)] text-sm">
        {title}: API エラー
      </div>
    );
  if (chartData.length === 0) return null;

  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)]">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-muted)]">{title}</h3>
        <span className="text-sm tabular-nums font-medium">
          ¥{data.totalJpy.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
        </span>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={75}
              innerRadius={40}
              startAngle={90}
              endAngle={-270}
              paddingAngle={1}
              isAnimationActive={false}
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

      <ul className="mt-2 text-xs space-y-1">
        {chartData.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: pickColor(i) }}
            />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="tabular-nums">
              ¥{d.value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}
            </span>
            <span className="tabular-nums text-[var(--color-text-muted)] w-14 text-right">
              {(d.ratio * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
