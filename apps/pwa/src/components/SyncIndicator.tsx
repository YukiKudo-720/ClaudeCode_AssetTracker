import { useEffect, useState } from 'react';
import { useScrapeRuns } from '../api/queries.js';
import { CheckCircle2, AlertTriangle, Loader2, WifiOff, CloudOff } from 'lucide-react';

function formatTime(t: number | string | Date): string {
  return new Date(t).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SyncIndicator() {
  const { data, isLoading, isError, isFetching, dataUpdatedAt } = useScrapeRuns();
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const go = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', go);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('offline', off);
    };
  }, []);

  // 初回 (キャッシュなし) のロード中のみスピナー
  if (isLoading && !data) {
    return (
      <span className="flex items-center gap-1 text-xs text-white/70">
        <Loader2 size={14} className="animate-spin" />
        確認中
      </span>
    );
  }

  // データなし + エラー = 完全に取れていない
  if (!data || data.length === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-white/70">
        <WifiOff size={14} />
        未接続
      </span>
    );
  }

  const latest = data[0];
  const lastScrape = latest ? formatTime(latest.startedAt) : '—';
  const cacheTime = dataUpdatedAt ? formatTime(dataUpdatedAt) : '—';

  // API 取得失敗中だがキャッシュは表示できている状態 (PC スリープ等)
  if (isError || !online) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-[var(--color-accent)]"
        title={`キャッシュ表示中 (取得試行: ${cacheTime})`}
      >
        <CloudOff size={14} />
        {lastScrape} <span className="opacity-70">(cache)</span>
      </span>
    );
  }

  if (!latest) {
    return <span className="text-xs text-white/70">未実行</span>;
  }

  if (latest.status === 'error' || latest.status === 'needs_2fa') {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--color-accent)]">
        <AlertTriangle size={14} />
        {lastScrape}
      </span>
    );
  }

  return (
    <span
      className="flex items-center gap-1 text-xs text-white/80"
      title={isFetching ? '更新中…' : `最終取得: ${cacheTime}`}
    >
      <CheckCircle2 size={14} />
      {lastScrape}
    </span>
  );
}
