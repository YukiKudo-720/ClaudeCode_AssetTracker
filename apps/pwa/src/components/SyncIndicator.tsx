import { useScrapeRuns } from '../api/queries.js';
import { CheckCircle2, AlertTriangle, Loader2, WifiOff } from 'lucide-react';

export function SyncIndicator() {
  const { data, isLoading, isError } = useScrapeRuns();

  if (isLoading) {
    return (
      <span className="flex items-center gap-1 text-xs text-white/70">
        <Loader2 size={14} className="animate-spin" />
        確認中
      </span>
    );
  }

  if (isError || !data) {
    return (
      <span className="flex items-center gap-1 text-xs text-white/70">
        <WifiOff size={14} />
        未接続
      </span>
    );
  }

  const latest = data[0];
  if (!latest) {
    return <span className="text-xs text-white/70">未実行</span>;
  }

  const time = new Date(latest.startedAt).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (latest.status === 'error' || latest.status === 'needs_2fa') {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--color-accent)]">
        <AlertTriangle size={14} />
        {time}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1 text-xs text-white/80">
      <CheckCircle2 size={14} />
      {time}
    </span>
  );
}
