import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useSyncStatus } from '../api/queries.js';

// /api/sync-status が CONSECUTIVE_FAIL_THRESHOLD 回連続失敗 or
// navigator.onLine = false なら全画面オーバーレイを表示。
// Tailscale 切断や Pi 停止で各画面が「読み込み中」のまま固まる症状を、
// 明示的に「接続できません」と伝えるためのフォールバック。
const CONSECUTIVE_FAIL_THRESHOLD = 3;

export function ConnectionErrorOverlay() {
  const syncStatus = useSyncStatus();
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [failCount, setFailCount] = useState(0);

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

  // syncStatus.isError と failCount の連動。成功で 0 リセット。
  useEffect(() => {
    if (syncStatus.isError) {
      setFailCount((c) => c + 1);
    } else if (syncStatus.data) {
      setFailCount(0);
    }
  }, [syncStatus.isError, syncStatus.data, syncStatus.dataUpdatedAt]);

  const visible = !online || failCount >= CONSECUTIVE_FAIL_THRESHOLD;
  if (!visible) return null;

  const reason = !online
    ? 'インターネット接続が切れています'
    : 'API サーバに到達できません';

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-bg)]/95 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="max-w-md w-full p-6 border-2 border-[var(--color-negative)] bg-[var(--color-bg-elevated)] rounded-lg shadow-xl">
        <div className="flex flex-col items-center text-center space-y-3">
          <WifiOff size={48} className="text-[var(--color-negative)]" />
          <h2 className="text-xl font-semibold">接続できません</h2>
          <p className="text-sm text-[var(--color-text-muted)]">{reason}</p>

          <div className="w-full text-left text-xs text-[var(--color-text-muted)] bg-[var(--color-bg)] p-3 rounded border border-[var(--color-border)]">
            <p className="font-medium mb-1 text-[var(--color-text)]">確認項目:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Tailscale が接続済み</li>
              <li>Pi サーバが起動中</li>
              <li>Endpoint URL が正しい (設定タブ)</li>
              <li>Bearer Token が有効</li>
            </ul>
          </div>

          <p className="text-xs text-[var(--color-text-muted)]">
            連続失敗: {failCount} 回
            {syncStatus.error instanceof Error ? ` / ${syncStatus.error.message.slice(0, 80)}` : ''}
          </p>

          <div className="flex gap-2 w-full pt-2">
            <button
              onClick={() => syncStatus.refetch()}
              disabled={syncStatus.isFetching}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-[var(--color-primary)] text-white rounded font-medium disabled:opacity-50"
            >
              <RefreshCw size={16} className={syncStatus.isFetching ? 'animate-spin' : ''} />
              再試行
            </button>
            <Link
              to="/settings"
              className="flex-1 px-4 py-2 border border-[var(--color-border)] rounded text-center font-medium hover:bg-[var(--color-bg)]"
            >
              設定を開く
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
