import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MfStatusResponse,
  ScrapeRunSummary,
  SyncStatusSource,
} from '@asset-tracker/shared';
import { TRACKED_MF_INSTITUTIONS } from '@asset-tracker/shared';
import { CheckCircle2, AlertTriangle, Clock, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import {
  apiFetch,
  ApiError,
  getEndpoint,
  setEndpoint,
  getToken,
  setToken,
} from '../api/client.js';
import { useWakePc, useWakePcMf, useFxRates, useSyncStatus, useMfStatus } from '../api/queries.js';

const SOURCE_LABELS: Record<string, string> = {
  moneyforward: 'MoneyForward (MF)',
  webull_api: 'Webull',
  moomoo_api: 'moomoo',
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// MF lastUpdated は ISO 8601 で送られてくる。古いデータ (文字列「今」等) も
// 上書きされるまでは混ざる可能性があるので、パース失敗時は素のまま返す。
function formatMfLastUpdated(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAgo(iso: string | null): string {
  if (!iso) return '実行履歴なし';
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}時間前`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}日前`;
}

// 接続診断 — 「新端末で API が取れない」を切り分けるための小ツール。
//   実 fetch するエンドポイント (Origin + path) を表示 → 入力ミスに気付ける
//   /api/sync-status を 1 回叩いて HTTP status + 原因推定を表示
type DiagResult =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; url: string; ms: number; overall: string }
  | { kind: 'fail'; url: string; ms: number; status: number; message: string; hint: string };

function diagnoseHint(status: number, msg: string, savedEndpoint: string): string {
  if (status === 0 && msg.includes('Token')) {
    return 'Bearer Token が未保存です。下の「API 接続設定」で入力 → 保存ボタンを押してください。';
  }
  if (status === 0) {
    // fetch 自体が失敗 (network error / CORS / DNS)
    if (!savedEndpoint) {
      return 'Endpoint が未設定 + PWA を同一オリジンで配信していない可能性。Pi の URL (例: http://100.85.86.51:3000) を Endpoint に入れて保存してください。';
    }
    return `Endpoint URL (${savedEndpoint}) に到達できません。Tailscale で Pi に ping が通るか、URL に http:// が付いているか、ポート番号 (:3000) が正しいかを確認してください。`;
  }
  if (status === 401) {
    return 'Token が一致しません。Pi の .env の ASSET_TRACKER_TOKEN と PWA に入力した値が一致しているか確認してください (前後の空白に注意)。';
  }
  if (status === 404) {
    return 'Endpoint URL がサーバを指していません (path が違う / 別ホスト)。';
  }
  if (status >= 500) {
    return 'サーバ側エラー。Pi の `journalctl -u asset-tracker -e` を確認してください。';
  }
  return '不明なエラー。';
}

function ConnectivityDiagnostics() {
  const [result, setResult] = useState<DiagResult>({ kind: 'idle' });
  const savedEndpoint = getEndpoint();
  const savedToken = getToken();
  const resolvedBase = savedEndpoint || window.location.origin;
  const resolvedUrl = `${resolvedBase.replace(/\/$/, '')}/api/sync-status`;
  const origin = window.location.origin;

  async function runTest() {
    setResult({ kind: 'running' });
    const start = performance.now();
    try {
      const data = await apiFetch<{ overall: string }>('/api/sync-status');
      const ms = Math.round(performance.now() - start);
      setResult({ kind: 'ok', url: resolvedUrl, ms, overall: data.overall });
    } catch (e) {
      const ms = Math.round(performance.now() - start);
      const status = e instanceof ApiError ? e.status : 0;
      const message =
        e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown';
      const hint = diagnoseHint(status, message, savedEndpoint);
      setResult({ kind: 'fail', url: resolvedUrl, ms, status, message, hint });
    }
  }

  return (
    <div className="p-3 border border-[var(--color-border)] bg-[var(--color-bg-elevated)] rounded space-y-2 text-sm">
      <dl className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="text-[var(--color-text-muted)]">PWA 表示元</dt>
        <dd className="font-mono break-all">{origin}</dd>
        <dt className="text-[var(--color-text-muted)]">保存済 Endpoint</dt>
        <dd className="font-mono break-all">
          {savedEndpoint || (
            <span className="text-[var(--color-text-muted)]">(空 = 同一オリジン)</span>
          )}
        </dd>
        <dt className="text-[var(--color-text-muted)]">保存済 Token</dt>
        <dd className="font-mono">
          {savedToken ? (
            `${savedToken.slice(0, 4)}…${savedToken.slice(-4)} (${savedToken.length} 文字)`
          ) : (
            <span className="text-[var(--color-negative)]">未設定</span>
          )}
        </dd>
        <dt className="text-[var(--color-text-muted)]">実 fetch URL</dt>
        <dd className="font-mono break-all">{resolvedUrl}</dd>
      </dl>

      <button
        onClick={runTest}
        disabled={result.kind === 'running'}
        className="px-3 py-1.5 bg-[var(--color-primary)] text-white rounded text-sm disabled:opacity-50"
      >
        {result.kind === 'running' ? '実行中…' : '接続テスト'}
      </button>

      {result.kind === 'ok' && (
        <div className="p-2 border border-[var(--color-positive)] bg-[var(--color-positive)]/10 rounded text-xs text-[var(--color-positive)]">
          <p className="font-medium">✓ 200 OK ({result.ms}ms)</p>
          <p>overall = {result.overall}</p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            この端末から API への接続は正常です。
          </p>
        </div>
      )}

      {result.kind === 'fail' && (
        <div className="p-2 border border-[var(--color-negative)] bg-[var(--color-negative)]/10 rounded text-xs text-[var(--color-negative)]">
          <p className="font-medium">
            ✗ {result.status === 0 ? 'fetch 失敗' : `HTTP ${result.status}`} ({result.ms}ms)
          </p>
          <p className="font-mono break-all">{result.message.slice(0, 200)}</p>
          <p className="mt-2 text-[var(--color-text)]">
            <span className="font-medium">推測: </span>
            {result.hint}
          </p>
        </div>
      )}
    </div>
  );
}

function SyncStatusCard({
  row,
  thresholdHours,
  mfStatus,
}: {
  row: SyncStatusSource;
  thresholdHours: number;
  mfStatus?: MfStatusResponse | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = SOURCE_LABELS[row.source] ?? row.source;
  const isError =
    row.latestRun?.status === 'error' || row.latestRun?.status === 'needs_2fa';
  const tone = isError
    ? 'border-[var(--color-negative)] bg-[var(--color-negative)]/5'
    : row.isStale
      ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
      : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]';

  return (
    <div className={`p-3 border rounded ${tone}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm">{label}</span>
        {isError ? (
          <span className="flex items-center gap-1 text-xs text-[var(--color-negative)]">
            <AlertTriangle size={14} />
            失敗
          </span>
        ) : row.isStale ? (
          <span className="flex items-center gap-1 text-xs text-[var(--color-accent)]">
            <Clock size={14} />
            {thresholdHours}h 以上更新なし
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-[var(--color-positive)]">
            <CheckCircle2 size={14} />
            OK
          </span>
        )}
      </div>
      <dl className="text-xs text-[var(--color-text-muted)] space-y-0.5">
        <div className="flex justify-between gap-2">
          <dt>最終実行</dt>
          <dd className="tabular-nums">
            {row.latestRun ? formatDateTime(row.latestRun.startedAt) : '—'} (
            {formatAgo(row.latestRun?.startedAt ?? null)})
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>直近の成功</dt>
          <dd className="tabular-nums">
            {row.latestSuccessAt ? formatDateTime(row.latestSuccessAt) : 'なし'}
            {row.latestSuccessAt ? ` (${formatAgo(row.latestSuccessAt)})` : ''}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>ステータス</dt>
          <dd>{row.latestRun?.status ?? '未実行'}</dd>
        </div>
        {row.latestRun?.errorMsg && (
          <div className="pt-1 text-[var(--color-negative)] break-all">
            {row.latestRun.errorMsg.slice(0, 200)}
            {row.latestRun.errorMsg.length > 200 ? '…' : ''}
          </div>
        )}
      </dl>

      {/* MoneyForward カードのみ、折りたたみで各連携口座の詳細を表示。
          DB に古い未絞り込みデータが残っていても、フロント側で whitelist フィルタ */}
      {row.source === 'moneyforward' && mfStatus && (() => {
        const trackedSet = new Set<string>(TRACKED_MF_INSTITUTIONS);
        const tracked = mfStatus.accounts.filter((a) => trackedSet.has(a.institution));
        if (tracked.length === 0) return null;
        return (
        <div className="mt-2 pt-2 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            連携口座詳細 ({tracked.length})
          </button>
          {expanded && (
            <div className="mt-2 space-y-1">
              {tracked.map((a) => {
                const accTone = a.hasError
                  ? 'text-[var(--color-negative)]'
                  : a.inProgress
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-positive)]';
                return (
                  <div
                    key={a.institution}
                    className="flex items-baseline justify-between gap-2 text-xs py-1 border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <span className="font-medium text-[var(--color-text)]">{a.institution}</span>
                    <span className="flex items-baseline gap-2">
                      <span className={accTone}>
                        {a.hasError ? 'エラー' : a.inProgress ? '更新中' : '完了'}
                      </span>
                      <span className="text-[var(--color-text-muted)] tabular-nums">
                        {formatMfLastUpdated(a.lastUpdated)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}

// PC で走る adapter 数 (mf + webull + moomoo) — wake-pc 完了判定に使う
const EXPECTED_ADAPTERS = 3;
// 10 分応答なしならタイムアウト扱い
const WAKE_PC_TIMEOUT_MS = 10 * 60 * 1000;
// /api/runs polling 間隔 (実行中のみ)
const RUNS_POLL_MS = 10_000;

export function Settings() {
  const [endpoint, setEndpointState] = useState(() => getEndpoint());
  const [token, setTokenState] = useState(() => getToken());
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);
  const [triggeredAt, setTriggeredAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const wakePc = useWakePc();
  const wakePcMf = useWakePcMf();
  const queryClient = useQueryClient();
  const fx = useFxRates();
  const syncStatus = useSyncStatus();
  const mfStatus = useMfStatus();

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

  // 完了タイミングで即時に各 status query を invalidate (60s polling を待たない)
  useEffect(() => {
    if (isDone) {
      void queryClient.invalidateQueries({ queryKey: ['mf-status'] });
      void queryClient.invalidateQueries({ queryKey: ['sync-status'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
    }
  }, [isDone, queryClient]);

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

  function handleWakePcMf() {
    setTriggeredAt(Date.now());
    wakePcMf.mutate(undefined);
  }

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}分${String(s).padStart(2, '0')}秒`;
  }

  return (
    <div className="space-y-6">
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
          <div className="relative mt-1">
            <input
              className="block w-full px-3 py-2 pr-12 border border-[var(--color-border)] rounded bg-[var(--color-bg-elevated)] font-mono text-sm"
              type={showToken ? 'text' : 'password'}
              placeholder="ASSET_TRACKER_TOKEN"
              value={token}
              onChange={(e) => setTokenState(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? 'Token を隠す' : 'Token を表示'}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-[var(--color-primary)] text-white rounded hover:bg-[var(--color-primary-soft)]"
        >
          保存
        </button>
        {saved && <span className="ml-3 text-sm text-[var(--color-positive)]">保存しました</span>}

        <div className="mt-4">
          <h3 className="text-sm font-semibold mb-2">接続診断</h3>
          <ConnectivityDiagnostics />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-3">更新状況</h2>
        {syncStatus.isLoading && (
          <p className="text-sm text-[var(--color-text-muted)]">読み込み中…</p>
        )}
        {syncStatus.isError && (
          <p className="text-sm text-[var(--color-negative)]">取得できませんでした</p>
        )}
        {syncStatus.data && (
          <div className="space-y-2">
            {syncStatus.data.bySource.map((row) => (
              <SyncStatusCard
                key={row.source}
                row={row}
                thresholdHours={syncStatus.data.staleThresholdHours}
                mfStatus={row.source === 'moneyforward' ? mfStatus.data : undefined}
              />
            ))}
            <p className="text-xs text-[var(--color-text-muted)]">
              {syncStatus.data.staleThresholdHours} 時間以内に成功実行が無いと「更新なし」扱い。
            </p>
          </div>
        )}
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
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            onClick={handleWakePc}
            disabled={wakePc.isPending || wakePcMf.isPending || isRunning}
            className="px-4 py-2 bg-[var(--color-accent)] text-[var(--color-primary)] rounded font-medium disabled:opacity-50"
          >
            {isRunning && wakePc.variables !== undefined && !wakePcMf.isPending
              ? `実行中… ${formatElapsed(elapsedSec)}`
              : '今すぐスクレイピング'}
          </button>
          <button
            onClick={handleWakePcMf}
            disabled={wakePc.isPending || wakePcMf.isPending || isRunning}
            className="px-4 py-2 bg-[var(--color-primary)] text-white rounded font-medium disabled:opacity-50"
          >
            {isRunning && wakePcMf.variables !== undefined
              ? `MF 更新+取得 実行中… ${formatElapsed(elapsedSec)}`
              : 'MF 一括更新も含めて実行'}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          通常モード: PC を起こして MF / Webull / moomoo を取得 (3〜5 分)。<br />
          MF 更新含む: 先に MF の「一括更新」を発火 → 完了待ち → scrape:all (10 分前後)。SBI 系が
          MF 側で遅延しがちな場合に使用。
        </p>

        {(wakePc.isError || wakePcMf.isError) && (
          <p className="mt-2 text-sm text-[var(--color-negative)]">
            起動失敗: {(wakePc.error ?? wakePcMf.error)?.message}
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
