import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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
      <div className="bg-[var(--color-bg-elevated)] rounded-lg p-6 border border-[var(--color-border)] text-[var(--color-text-muted)] text-sm">
        {title} 読み込み中...
      </div>
    );
  if (isError || !data)
    return (
      <div className="bg-[var(--color-bg-elevated)] rounded-lg p-6 border border-[var(--color-border)] text-[var(--color-negative)] text-sm">
        {title}: API エラー
      </div>
    );
  if (chartData.length === 0) return null;

  return (
    <div className="bg-[var(--color-bg-elevated)] rounded-lg p-4 border border-[var(--color-border)]">
      <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-2">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              innerRadius={45}
              paddingAngle={1}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={pickColor(i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v: number, _n, p) => {
                const ratio = (p.payload as { ratio: number }).ratio;
                return [`¥${v.toLocaleString('ja-JP', { maximumFractionDigits: 0 })} (${(ratio * 100).toFixed(1)}%)`, ''];
              }}
            />
            <Legend
              verticalAlign="bottom"
              align="center"
              iconSize={10}
              wrapperStyle={{ fontSize: '12px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
