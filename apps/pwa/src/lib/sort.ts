// 銘柄 / テーマ / 東大ページ共通の並び替えキー & 比較関数。
// value 系: 金額の大きい順 / name, symbol: 50 音・英数昇順 (numeric: '7203' > '700')。

export type SortKey = 'value' | 'name' | 'symbol';

export interface Sortable {
  value: number;
  name: string;
  symbol?: string | null;
}

const collator = new Intl.Collator('ja-JP', { numeric: true, sensitivity: 'base' });

export function compareBy(key: SortKey): (a: Sortable, b: Sortable) => number {
  return (a, b) => {
    if (key === 'value') return b.value - a.value;
    if (key === 'name') return collator.compare(a.name, b.name);
    return collator.compare(a.symbol ?? '', b.symbol ?? '');
  };
}
