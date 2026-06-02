import { useState } from 'react';
import { getEndpoint, setEndpoint, getToken, setToken } from '../api/client.js';
import { useRunNow, useFxRates } from '../api/queries.js';

export function Settings() {
  const [endpoint, setEndpointState] = useState(() => getEndpoint());
  const [token, setTokenState] = useState(() => getToken());
  const [saved, setSaved] = useState(false);
  const runNow = useRunNow();
  const fx = useFxRates();

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
        <h2 className="text-base font-semibold mb-3">為替レート</h2>
        {fx.isLoading && <p className="text-sm text-[var(--color-text-muted)]">読み込み中…</p>}
        {fx.isError && (
          <p className="text-sm text-[var(--color-negative)]">取得できませんでした</p>
        )}
        {fx.data && (
          <>
            <p className="text-xs text-[var(--color-text-muted)] mb-2">
              {fx.data.provider} · TTL {fx.data.ttlHours}h (6h 以内のキャッシュを再利用)
            </p>
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                <tr>
                  <th className="py-1.5 pr-2">通貨ペア</th>
                  <th className="py-1.5 px-2 text-right">レート</th>
                  <th className="py-1.5 pl-2">取得日時</th>
                </tr>
              </thead>
              <tbody>
                {fx.data.rates.map((r) => (
                  <tr key={`${r.base}/${r.quote}`} className="border-b border-[var(--color-border)]">
                    <td className="py-1 pr-2 font-mono">
                      {r.base}/{r.quote}
                    </td>
                    <td className="py-1 px-2 text-right">{r.rate.toFixed(4)}</td>
                    <td className="py-1 pl-2 text-xs text-[var(--color-text-muted)]">
                      {new Date(r.capturedAt).toLocaleString('ja-JP', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fx.data.rates.length === 0 && (
              <p className="text-xs text-[var(--color-text-muted)]">まだレートが取得されていません</p>
            )}
          </>
        )}
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
