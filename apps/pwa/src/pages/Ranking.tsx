import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Wallet, Layers } from 'lucide-react';
import { useAccounts, useRanking } from '../api/queries.js';
import {
  ASSET_CLASS_LABELS,
  INSTITUTION_LABELS,
  type AssetClass,
  type Institution,
  type RankingItem,
} from '@asset-tracker/shared';

// cash は backend で除外、fx は通常別軸なのでフィルタ候補からも外す。
const ASSET_CLASS_OPTIONS: AssetClass[] = [
  'stock',
  'etf',
  'mutual_fund',
  'reit',
  'bond',
  'crypto',
  'commodity',
  'other',
];

type SortBy = 'ratio' | 'price_ratio' | 'amount' | 'value';
type Dir = 'asc' | 'desc';

function formatJpy(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}

function formatSignedJpy(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${sign}¥${Math.round(Math.abs(n)).toLocaleString('ja-JP')}`;
}

function formatSignedPct(ratio: number): string {
  const sign = ratio > 0 ? '+' : ratio < 0 ? '−' : '±';
  return `${sign}${(Math.abs(ratio) * 100).toFixed(2)}%`;
}

function tone(n: number): string {
  if (n > 0) return 'text-[var(--color-positive)]';
  if (n < 0) return 'text-[var(--color-negative)]';
  return 'text-[var(--color-text-muted)]';
}

function Row({ item, rank, sortBy }: { item: RankingItem; rank: number; sortBy: SortBy }) {
  // スマホでは % は単一列に集約。sortBy が price_ratio なら単価%、それ以外は評価% を表示。
  const mobileRatio = sortBy === 'price_ratio' ? item.priceDiffRatio : item.diffRatio;
  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]">
      <td className="py-2 pr-1 tabular-nums text-[var(--color-text-muted)] text-xs">{rank}</td>
      <td className="py-2 pr-2">
        <div className="font-medium">{item.symbol}</div>
        <div className="text-xs text-[var(--color-text-muted)] line-clamp-1">{item.name}</div>
      </td>
      <td
        className={`py-2 pr-2 text-right tabular-nums whitespace-nowrap hidden md:table-cell ${sortBy === 'value' ? 'font-semibold' : ''}`}
      >
        {formatJpy(item.totalValueJpy)}
      </td>
      <td
        className={`py-2 pr-2 text-right tabular-nums whitespace-nowrap ${sortBy === 'amount' ? 'font-semibold' : ''} ${tone(item.diffJpy)}`}
      >
        {item.prevValueJpy != null ? formatSignedJpy(item.diffJpy) : '—'}
      </td>

      {/* スマホ: 単一の % 列 (sortBy で評価%/単価% 切替) */}
      <td
        className={`py-2 pr-2 text-right tabular-nums whitespace-nowrap md:hidden ${tone(mobileRatio ?? 0)}`}
      >
        {mobileRatio != null ? formatSignedPct(mobileRatio) : '—'}
      </td>

      {/* PC: 評価% と 単価% の 2 列 */}
      <td
        className={`hidden md:table-cell py-2 pr-2 text-right tabular-nums whitespace-nowrap ${sortBy === 'ratio' ? 'font-semibold' : ''} ${tone(item.diffRatio ?? 0)}`}
      >
        {item.diffRatio != null ? formatSignedPct(item.diffRatio) : '—'}
      </td>
      <td
        className={`hidden md:table-cell py-2 pr-2 text-right tabular-nums whitespace-nowrap ${sortBy === 'price_ratio' ? 'font-semibold' : ''} ${tone(item.priceDiffRatio ?? 0)}`}
        title="単価ベース騰落率 (株数変動の影響を除く)"
      >
        {item.priceDiffRatio != null ? formatSignedPct(item.priceDiffRatio) : '—'}
      </td>
      <td className="py-2 pr-2 text-xs text-[var(--color-text-muted)] hidden lg:table-cell">
        {item.accounts
          .map((a) => INSTITUTION_LABELS[a.institution as Institution] ?? a.institution)
          .join(', ')}
      </td>
    </tr>
  );
}

export function Ranking() {
  const [sortBy, setSortBy] = useState<SortBy>('ratio');
  const [dir, setDir] = useState<Dir>('desc');
  const [accountId, setAccountId] = useState<string>('');
  const [assetClass, setAssetClass] = useState<string>('');

  const accounts = useAccounts();
  const ranking = useRanking({
    sortBy,
    dir,
    accountId: accountId || undefined,
    assetClass: assetClass || undefined,
  });

  return (
    <div className="space-y-4">
      {/* 並び替え + フィルタを 1 枚のパネルにまとめる */}
      <div className="p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded-lg space-y-3">
        {/* セクション 1: 並び替え (スマホはラベル独立行、md+ は横並び) */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide md:min-w-[5rem]">
            <ArrowUpDown size={12} />
            並び替え
          </span>
          <div className="flex items-center gap-2">
            {/* セグメントコントロール (連結ボタン)。スマホでは flex-1 で残幅を埋める */}
            <div className="inline-flex flex-1 md:flex-initial rounded-md border border-[var(--color-border)] overflow-hidden">
              {([
                { key: 'ratio', label: '評価%' },
                { key: 'price_ratio', label: '単価%' },
                { key: 'amount', label: '騰落額' },
                { key: 'value', label: '評価額' },
              ] as const).map(({ key, label }, i) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`flex-1 md:flex-initial px-1.5 md:px-3 py-1.5 text-xs md:text-sm whitespace-nowrap transition ${
                    i > 0 ? 'border-l border-[var(--color-border)]' : ''
                  } ${
                    sortBy === key
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-bg)] hover:bg-[var(--color-bg-elevated)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-bg-elevated)] transition flex-shrink-0"
              title="昇順 / 降順 切替"
            >
              {dir === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
              {dir === 'desc' ? '降順' : '昇順'}
            </button>
          </div>
        </div>

        {/* セクション 2: フィルタ */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center pt-3 border-t border-[var(--color-border)]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide md:min-w-[5rem]">
              <Filter size={12} />
              フィルタ
            </span>
            {/* リセットはラベル横に置いて、フィルタ行の改行が増えないように */}
            {(accountId || assetClass) && (
              <button
                onClick={() => {
                  setAccountId('');
                  setAssetClass('');
                }}
                className="md:hidden px-2 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
              >
                リセット
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-1">
            {/* 口座 select (スマホでは半幅) */}
            <label className="flex flex-1 md:flex-initial items-center gap-1.5 pl-2 pr-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus-within:border-[var(--color-primary)] transition min-w-0">
              <Wallet size={14} className="text-[var(--color-text-muted)] flex-shrink-0" />
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="flex-1 md:flex-initial py-1.5 pr-2 text-sm bg-transparent border-0 focus:outline-none cursor-pointer min-w-0"
              >
                <option value="">全口座</option>
                {accounts.data?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
                  </option>
                ))}
              </select>
            </label>

            {/* 種別 select */}
            <label className="flex flex-1 md:flex-initial items-center gap-1.5 pl-2 pr-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] focus-within:border-[var(--color-primary)] transition min-w-0">
              <Layers size={14} className="text-[var(--color-text-muted)] flex-shrink-0" />
              <select
                value={assetClass}
                onChange={(e) => setAssetClass(e.target.value)}
                className="flex-1 md:flex-initial py-1.5 pr-2 text-sm bg-transparent border-0 focus:outline-none cursor-pointer min-w-0"
              >
                <option value="">全種別</option>
                {ASSET_CLASS_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CLASS_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>

            {/* md+ ではリセットを行末に */}
            {(accountId || assetClass) && (
              <button
                onClick={() => {
                  setAccountId('');
                  setAssetClass('');
                }}
                className="hidden md:inline-block px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline flex-shrink-0"
              >
                リセット
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 件数 + capturedDate */}
      {ranking.data && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {ranking.data.capturedDate ?? '—'}
          {ranking.data.prevCapturedDate ? ` (前日比: ${ranking.data.prevCapturedDate})` : ''} ·{' '}
          {ranking.data.items.length} 銘柄
        </p>
      )}

      {ranking.isLoading && <p className="text-[var(--color-text-muted)]">読み込み中...</p>}
      {ranking.isError && <p className="text-[var(--color-negative)]">API エラー</p>}

      {ranking.data && ranking.data.items.length === 0 && (
        <p className="text-[var(--color-text-muted)]">該当する銘柄がありません。</p>
      )}

      {ranking.data && ranking.data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
              <tr>
                <th className="py-2 pr-1">#</th>
                <th className="py-2 pr-2">銘柄</th>
                <th className="py-2 pr-2 text-right whitespace-nowrap hidden md:table-cell">評価額</th>
                <th className="py-2 pr-2 text-right whitespace-nowrap">騰落 (¥)</th>
                {/* スマホ: % 単一列 (sortBy に追従) */}
                <th className="py-2 pr-2 text-right md:hidden">
                  {sortBy === 'price_ratio' ? '単価%' : '評価%'}
                </th>
                {/* PC: 評価%・単価% 並列 */}
                <th className="hidden md:table-cell py-2 pr-2 text-right">評価%</th>
                <th className="hidden md:table-cell py-2 pr-2 text-right">単価%</th>
                <th className="py-2 pr-2 hidden lg:table-cell">口座</th>
              </tr>
            </thead>
            <tbody>
              {ranking.data.items.map((item, i) => (
                <Row key={item.securityId} item={item} rank={i + 1} sortBy={sortBy} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
