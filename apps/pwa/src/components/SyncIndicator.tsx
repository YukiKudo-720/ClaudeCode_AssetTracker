import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, WifiOff, CloudOff } from 'lucide-react';
import { useSyncStatus } from '../api/queries.js';

// ヘッダー右側のコンパクトバナー。詳細は /settings の「更新状況」セクションを参照。
// - OK: 全 source が staleThresholdHours 以内に成功
// - NG: いずれかが error or stale
// クリックで /settings へ遷移する。
export function SyncIndicator() {
  const { data, isLoading, isError } = useSyncStatus();
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

  if (isLoading && !data) {
    return (
      <span className="flex items-center gap-1 text-xs text-white/70">
        <Loader2 size={14} className="animate-spin" />
        確認中
      </span>
    );
  }

  if (!online) {
    return (
      <span className="flex items-center gap-1 text-xs text-white/70">
        <WifiOff size={14} />
        オフライン
      </span>
    );
  }

  if (isError || !data) {
    return (
      <span className="flex items-center gap-1 text-xs text-[var(--color-accent)]">
        <CloudOff size={14} />
        取得失敗
      </span>
    );
  }

  if (data.overall === 'ok') {
    return (
      <Link
        to="/settings"
        className="flex items-center gap-1 text-xs text-white/85 hover:text-white"
        title="クリックで更新状況の詳細を表示"
      >
        <CheckCircle2 size={14} />
        同期OK
      </Link>
    );
  }

  return (
    <Link
      to="/settings"
      className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline font-medium"
      title="クリックで更新状況の詳細を表示"
    >
      <AlertTriangle size={14} />
      同期失敗あり
    </Link>
  );
}
