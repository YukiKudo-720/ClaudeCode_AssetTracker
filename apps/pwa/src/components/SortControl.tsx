import type { SortKey } from '../lib/sort.js';

const OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'value', label: '金額' },
  { key: 'name', label: '名前' },
  { key: 'symbol', label: 'コード' },
];

export function SortControl({
  value,
  onChange,
  hideSymbol = false,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
  /** 投信などコードを持たないリスト用にコード順を隠す */
  hideSymbol?: boolean;
}) {
  const opts = hideSymbol ? OPTIONS.filter((o) => o.key !== 'symbol') : OPTIONS;
  return (
    <div className="inline-flex items-center gap-1 text-xs">
      <span className="text-[var(--color-text-muted)] mr-1">並び順:</span>
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`px-2 py-1 rounded border transition-colors ${
              active
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)]'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
