#!/bin/bash
# Pi 側 MF orchestrate コントローラ。
#
# 役割:
#   - スケジューリング (リトライ周期 30 分 / 上限 3 時間) と状態管理を担う
#   - PC は「単発操作」だけを担当 (phase=A or phase=B-step)
#
# 使い方:
#   pi-mf-orchestrate-controller.sh main             # メインサイクル発火 (Pi cron で 1 日 N 回)
#   pi-mf-orchestrate-controller.sh sbi-retry-check  # SBI リトライ判定 (Pi cron で 30 分毎)
#
# 状態ファイル: data/mf-orchestrate-state.json
#   { startedAt: ISO, lastCheckedAt: ISO, attempts: number }
#   phase-a 終了後に SBI 系が未完了なら新規作成、phase-b-step 後に完了なら削除。
#
# ロック: data/mf-orchestrate.lock (flock)
#   phase-a と phase-b-check が同時実行されないように直列化。
#
# PC 起動: ws PC が起きていなければ WoL → SSH 通るまで待機 → Task Scheduler 発火。
# PC 停止: PC が元々起きていた場合は MfOrchestrate* タスク側の SuspendAfter で suspend。

set -euo pipefail

PHASE_CMD="${1:-}"
if [ -z "$PHASE_CMD" ]; then
  echo "usage: $0 main|sbi-retry-check" >&2
  exit 1
fi

REPO_ROOT='/srv/asset-tracker'
DATA_DIR="$REPO_ROOT/data"
STATE_FILE="$DATA_DIR/mf-orchestrate-state.json"
LOCK_FILE="$DATA_DIR/mf-orchestrate.lock"
LOG_DIR="${HOME}/asset-tracker-logs"
LOG_FILE="$LOG_DIR/mf-orchestrate-controller.log"

PC_TS_IP='100.99.142.112'
PC_USER='guilt'
PC_MAC='9C-6B-00-B8-C6-B4'

# スケジューリング定数 (秒)
RETRY_INTERVAL_SEC=$((30 * 60))
MAX_DURATION_SEC=$((3 * 60 * 60))

mkdir -p "$DATA_DIR" "$LOG_DIR"

log() {
  echo "$(date '+%F %T') [$PHASE_CMD] $1" | tee -a "$LOG_FILE"
}

# 排他ロック取得 (他の controller が走っていれば即終了)
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "別の controller が実行中。スキップ"
  exit 0
fi

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%S.000Z"
}

epoch_from_iso() {
  date -d "$1" +%s 2>/dev/null || echo 0
}

wake_pc_if_needed() {
  if nc -z -w 5 "$PC_TS_IP" 22 2>/dev/null; then
    log "PC は起動中"
  else
    log "PC を WoL で起こす"
    wakeonlan -i 192.168.0.255 "$PC_MAC" >/dev/null
    for i in $(seq 1 30); do
      sleep 3
      if nc -z -w 3 "$PC_TS_IP" 22 2>/dev/null; then
        log "PC 起動完了 (${i}回目で接続成功)"
        return
      fi
    done
    log "PC 起動失敗 (90秒経過)"
    exit 1
  fi
}

run_pc_task() {
  local task="$1"
  log "PC Task '$task' を schtasks で発火"
  ssh -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ConnectTimeout=10 \
      -o StrictHostKeyChecking=no \
      "${PC_USER}@${PC_TS_IP}" "schtasks /Run /TN \"$task\""
  log "Task '$task' 発火完了。完了は PC ログと /api/mf-status でフォロー"
}

fetch_mf_status_sbi_in_progress() {
  # /api/mf-status を叩いて SBI 系が in_progress か返す (0=in_progress, 1=完了 or 不明)
  local token tail_url
  token=$(grep '^ASSET_TRACKER_TOKEN=' "$REPO_ROOT/.env" | cut -d= -f2- | tr -d '"\r')
  tail_url="http://127.0.0.1:3000/api/mf-status"
  local json
  json=$(curl -s -H "Authorization: Bearer $token" "$tail_url" || echo "")
  if [ -z "$json" ]; then
    log "/api/mf-status 取得失敗"
    return 1
  fi
  # SBI証券 または 住信SBIネット銀行 で inProgress=true なら 0 (= 未完了)
  if echo "$json" | grep -E '"institution":"(SBI証券|住信SBIネット銀行)","inProgress":true' >/dev/null; then
    return 0
  fi
  return 1
}

main_handler() {
  log "既存 state を破棄"
  rm -f "$STATE_FILE"

  wake_pc_if_needed
  run_pc_task 'MfOrchestrateMain'

  log "Task Main 完了想定。SBI 系状態を確認"
  # フェーズ A は内部で MF を更新→scrape:all→POST mf-status まで行う。最終 POST が
  # 反映されるまで少し待つ (= PC 内処理がここで終わっていない可能性もあるため、
  # 十分な完了マージンを取りたければ phase-b-check 側で再確認すれば良い)
  sleep 5

  if fetch_mf_status_sbi_in_progress; then
    log "SBI 系が未完了。state を作成"
    cat > "$STATE_FILE" <<EOF
{
  "startedAt": "$(iso_now)",
  "lastCheckedAt": "$(iso_now)",
  "attempts": 0
}
EOF
  else
    log "SBI 系も完了。state 作成は不要"
  fi
}

sbi_retry_check_handler() {
  if [ ! -f "$STATE_FILE" ]; then
    log "state 無し。SBI リトライ不要 (= 前回 main で SBI 含め完了)"
    exit 0
  fi

  local started_at last_checked_at attempts
  started_at=$(grep -oE '"startedAt"[[:space:]]*:[[:space:]]*"[^"]+"' "$STATE_FILE" | grep -oE '"[^"]+"$' | tr -d '"')
  last_checked_at=$(grep -oE '"lastCheckedAt"[[:space:]]*:[[:space:]]*"[^"]+"' "$STATE_FILE" | grep -oE '"[^"]+"$' | tr -d '"')
  attempts=$(grep -oE '"attempts"[[:space:]]*:[[:space:]]*[0-9]+' "$STATE_FILE" | grep -oE '[0-9]+$')
  attempts=${attempts:-0}

  local now_sec started_sec elapsed last_sec since_last
  now_sec=$(date -u +%s)
  started_sec=$(epoch_from_iso "$started_at")
  last_sec=$(epoch_from_iso "$last_checked_at")
  elapsed=$((now_sec - started_sec))
  since_last=$((now_sec - last_sec))

  log "elapsed=${elapsed}s since_last=${since_last}s attempts=$attempts"

  if [ "$elapsed" -gt "$MAX_DURATION_SEC" ]; then
    log "開始から ${elapsed}s 経過 (${MAX_DURATION_SEC}s 上限超え)。諦めて state 破棄"
    rm -f "$STATE_FILE"
    exit 0
  fi

  if [ "$since_last" -lt "$RETRY_INTERVAL_SEC" ]; then
    log "前回チェックから ${since_last}s しか経っていない (リトライ間隔 ${RETRY_INTERVAL_SEC}s 未満)。スキップ"
    exit 0
  fi

  wake_pc_if_needed
  run_pc_task 'MfOrchestrateSbiRetry'

  sleep 5
  if fetch_mf_status_sbi_in_progress; then
    log "SBI 系まだ未完了。state を更新 (attempts++ / lastCheckedAt 更新)"
    local new_attempts=$((attempts + 1))
    cat > "$STATE_FILE" <<EOF
{
  "startedAt": "$started_at",
  "lastCheckedAt": "$(iso_now)",
  "attempts": $new_attempts
}
EOF
  else
    log "SBI 系完了。state 破棄"
    rm -f "$STATE_FILE"
  fi
}

case "$PHASE_CMD" in
  main)
    main_handler
    ;;
  sbi-retry-check)
    sbi_retry_check_handler
    ;;
  *)
    echo "unknown phase: $PHASE_CMD (main | sbi-retry-check)" >&2
    exit 1
    ;;
esac
