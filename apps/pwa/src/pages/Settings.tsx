import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ScrapeRunSummary } from '@asset-tracker/shared';
import { apiFetch, getEndpoint, setEndpoint, getToken, setToken } from '../api/client.js';
import { useWakePc, useFxRates } from '../api/queries.js';

// PC で走る adapter 数 (mf + webull + moomoo) — wake-pc 完了判定に使う
const EXPECTED_ADAPTERS = 3;
// 10 分応答なしならタイムアウト扱い
const WAKE_PC_TIMEOUT_MS = 10 * 60 * 1000;
// /api/runs polling 間隔 (実行中のみ)
const RUNS_POLL_MS = 10_000;

export function Settings() {
  const [endpoint, setEndpointState] = useState(() => getEndpoint());
  const [token, setTokenState] = useState(() => getToken());
  const [saved, setSaved] = useState(false);
  const [triggeredAt, setTriggeredAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const wakePc = useWakePc();
  const fx = useFxRates();

  // 実行中だけ /api/runs を polling
  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => apiFetch<ScrapeRunSummary[]>('/api/runs'),
    refetchInterval: triggeredAt !== null ? RUNS_POLL_MS : false,
  });

  // triggeredAt 以降に完了 (ok / error) した run 一覧
  const completedAfterTrigger = useMemo(() => {
    if (triggeredAt === null || !runs.data) return [];
    return runs.data.filter(
      (r) =>
        new Date(r.startedAt).getTime() >= triggeredAt &&
        r.finishedAt != null &&
        (r.status === 'ok' || r.status === 'error'),
    );
  }, [triggeredAt, runs.data]);

  const elapsedSec = triggeredAt !== null ? Math.floor((Date.now() - triggeredAt) / 1000) : 0;
  void tick; // re-render trigger; elapsedSec を更新するため
  const isDone = triggeredAt !== null && completedAfterTrigger.length >= EXPECTED_ADAPTERS;
  const isTimedOut =
    triggeredAt !== null && !isDone && Date.now() - triggeredAt >= WAKE_PC_TIMEOUT_MS;
  const isRunning = triggeredAt !== null && !isDone && !isTimedOut;

  // 1秒ごとに re-render して elapsed time を更新
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  function handleSave() {
    setEndpoint(endpoint.trim());
    setToken(token.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  function handleWakePc() {
    setTriggeredAt(Date.now());
    wakePc.mutate(undefined);
  }

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}分${String(s).padStart(2, '0')}秒`;
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
          onClick={handleWakePc}
          disabled={wakePc.isPending || isRunning}
          className="px-4 py-2 bg-[var(--color-accent)] text-[var(--color-primary)] rounded font-medium disabled:opacity-50"
        >
          {isRunning
            ? `実行中… ${formatElapsed(elapsedSec)}`
            : '今すぐスクレイピング (PC を起こす)'}
        </button>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          PC を WoL で起こして MF / Webull / moomoo を全件取得します。完了まで 3〜5 分程度。
        </p>

        {wakePc.isError && (
          <p className="mt-2 text-sm text-[var(--color-negative)]">
            起動失敗: {wakePc.error.message}
          </p>
        )}

        {isRunning && (
          <div className="mt-3 p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded text-sm">
            <p>PC を起こして scrape 中…</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              進捗: {completedAfterTrigger.length}/{EXPECTED_ADAPTERS} 完了 (
              {formatElapsed(elapsedSec)} 経過)
            </p>
          </div>
        )}

        {isDone && (
          <div className="mt-3 p-3 border border-[var(--color-positive)] bg-[var(--color-positive)]/10 rounded text-sm text-[var(--color-positive)]">
            <p className="font-medium">✓ 完了 ({formatElapsed(elapsedSec)})</p>
            <ul className="mt-1 text-xs">
              {completedAfterTrigger.map((r) => (
                <li key={r.id}>
                  {r.source}: {r.status}
                  {r.errorMsg ? ` (${r.errorMsg.slice(0, 60)})` : ''}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setTriggeredAt(null)}
              className="mt-2 text-xs underline"
            >
              閉じる
            </button>
          </div>
        )}

        {isTimedOut && (
          <div className="mt-3 p-3 border border-[var(--color-negative)] bg-[var(--color-negative)]/10 rounded text-sm text-[var(--color-negative)]">
            <p>⚠ タイムアウト (10 分以上応答なし)</p>
            <p className="mt-1 text-xs">
              PC が起動できなかった可能性があります。完了 {completedAfterTrigger.length}/
              {EXPECTED_ADAPTERS}。
            </p>
            <button
              type="button"
              onClick={() => setTriggeredAt(null)}
              className="mt-2 text-xs underline"
            >
              閉じる
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
