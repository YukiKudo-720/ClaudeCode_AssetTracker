import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
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

type SortBy = 'ratio' | 'amount';
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
  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]">
      <td className="py-2 pr-2 tabular-nums text-[var(--color-text-muted)] w-10">{rank}</td>
      <td className="py-2 pr-2">
        <div className="font-medium">{item.symbol}</div>
        <div className="text-xs text-[var(--color-text-muted)] line-clamp-1">{item.name}</div>
      </td>
      <td className="py-2 pr-2 text-right tabular-nums hidden md:table-cell">
        {formatJpy(item.totalValueJpy)}
      </td>
      <td
        className={`py-2 pr-2 text-right tabular-nums ${sortBy === 'amount' ? 'font-semibold' : ''} ${tone(item.diffJpy)}`}
      >
        {item.prevValueJpy != null ? formatSignedJpy(item.diffJpy) : '—'}
      </td>
      <td
        className={`py-2 pr-2 text-right tabular-nums ${sortBy === 'ratio' ? 'font-semibold' : ''} ${tone(item.diffRatio ?? 0)}`}
      >
        {item.diffRatio != null ? formatSignedPct(item.diffRatio) : '—'}
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
      {/* フィルタ + ソート */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1">
          <button
            onClick={() => setSortBy('ratio')}
            className={`px-3 py-1.5 text-sm rounded border ${
              sortBy === 'ratio'
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                : 'bg-[var(--color-bg-elevated)] border-[var(--color-border)]'
            }`}
          >
            %
          </button>
          <button
            onClick={() => setSortBy('amount')}
            className={`px-3 py-1.5 text-sm rounded border ${
              sortBy === 'amount'
                ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                : 'bg-[var(--color-bg-elevated)] border-[var(--color-border)]'
            }`}
          >
            金額
          </button>
        </div>

        <button
          onClick={() => setDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
          className="flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
          title="昇順 / 降順 切替"
        >
          {dir === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
          {dir === 'desc' ? '降順' : '昇順'}
        </button>

        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="px-2 py-1.5 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
        >
          <option value="">全口座</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {INSTITUTION_LABELS[a.institution as Institution] ?? a.institution}
            </option>
          ))}
        </select>

        <select
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value)}
          className="px-2 py-1.5 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
        >
          <option value="">全種別</option>
          {ASSET_CLASS_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {ASSET_CLASS_LABELS[c]}
            </option>
          ))}
        </select>
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
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">銘柄</th>
                <th className="py-2 pr-2 text-right hidden md:table-cell">評価額</th>
                <th className="py-2 pr-2 text-right">騰落 (¥)</th>
                <th className="py-2 pr-2 text-right">騰落 (%)</th>
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
