import { useState } from 'react';
import { getEndpoint, setEndpoint, getToken, setToken } from '../api/client.js';
import { useRunNow } from '../api/queries.js';

export function Settings() {
  const [endpoint, setEndpointState] = useState(() => getEndpoint());
  const [token, setTokenState] = useState(() => getToken());
  const [saved, setSaved] = useState(false);
  const runNow = useRunNow();

  function handleSave() {
    setEndpoint(endpoint.trim());
    setToken(token.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="space-y-6 max-w-md">
      <section>
        <h2 className="text-base font-semibold mb-3">API 接続設定</h2>
        <label className="block mb-3">
          <span className="text-sm text-[var(--color-text-muted)]">
            Endpoint{' '}
            <span className="text-xs">(同一オリジン配信なら空でOK)</span>
          </span>
          <input
            className="block w-full mt-1 px-3 py-2 border border-[var(--color-border)] rounded bg-[var(--color-bg-elevated)]"
            placeholder="(空 = 現在のオリジン) or http://127.0.0.1:3000"
            value={endpoint}
            onChange={(e) => setEndpointState(e.target.value)}
          />
        </label>
        <label className="block mb-3">
          <span className="text-sm text-[var(--color-text-muted)]">Bearer Token</span>
          <input
            className="block w-full mt-1 px-3 py-2 border border-[var(--color-border)] rounded bg-[var(--color-bg-elevated)] font-mono text-sm"
            type="password"
            placeholder="ASSET_TRACKER_TOKEN"
            value={token}
            onChange={(e) => setTokenState(e.target.value)}
          />
        </label>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-[var(--color-primary)] text-white rounded hover:bg-[var(--color-primary-soft)]"
        >
          保存
        </button>
        {saved && <span className="ml-3 text-sm text-[var(--color-positive)]">保存しました</span>}
      </section>

      <section>
        <h2 className="text-base font-semibold mb-3">手動同期</h2>
        <button
          onClick={() => runNow.mutate(undefined)}
          disabled={runNow.isPending}
          className="px-4 py-2 bg-[var(--color-accent)] text-[var(--color-primary)] rounded font-medium disabled:opacity-50"
        >
          {runNow.isPending ? '実行中…' : '今すぐスクレイピング'}
        </button>
        {runNow.isError && (
          <p className="mt-2 text-sm text-[var(--color-negative)]">エラー: {runNow.error.message}</p>
        )}
        {runNow.isSuccess && (
          <p className="mt-2 text-sm text-[var(--color-positive)]">キュー投入済 (runId: {runNow.data.runId})</p>
        )}
      </section>
    </div>
  );
}
