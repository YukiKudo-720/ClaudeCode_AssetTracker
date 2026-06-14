#!/usr/bin/env bash
# Pi から PC を起こして scrape を回す。
# WoL の前に PC が応答するかチェックし、状態に応じてタスクを切替:
#   - PC awake (作業中)         → AssetTrackerScrapeNoSuspend (sleep せずに終了)
#   - PC asleep (S3)            → WoL → AssetTrackerScrape (-SuspendAfter で sleep に戻す)
#
# 両タスクは PC のログオン中ユーザー session で動くため Playwright headful (MF)
# も pnpm Junction も問題なく解決される。
#
# Pi cron からも手動からも同じスクリプトで使う想定。
#
# 使い方:
#   ./pi-wake-and-scrape.sh           # fire-and-forget (cron / 通常運用)
#   ./pi-wake-and-scrape.sh --watch   # 完了までログを tail (手動デバッグ用)
#
# 前提:
#   - PC で Scheduled Task "AssetTrackerScrape" / "AssetTrackerScrapeNoSuspend"
#     両方が登録済 (LogonType Interactive / RunLevel Highest)
#   - PC のユーザーがログオン中 (画面ロックは可。完全ログアウト/再起動直後は NG)

set -euo pipefail

PC_MAC="9C:6B:00:B8:C6:B4"
PC_LAN_BROADCAST="192.168.0.255"
PC_TAILNET_IP="100.99.142.112"
PC_USER="guilt"
TASK_ASLEEP="AssetTrackerScrape"             # -SuspendAfter 込み
TASK_AWAKE="AssetTrackerScrapeNoSuspend"     # suspend なし
PC_LOG_PATH='c:\Users\guilt\Projects\ClaudeCode_AssetTracker\logs\scrape-and-suspend.log'

WATCH=0
for arg in "$@"; do
  case "$arg" in
    --watch) WATCH=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $arg (--help)" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $*"; }

SSH_OPTS=(
  -o ConnectTimeout=10
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
)

# PC が S3 (deep sleep) の時は NIC への給電が止まり TCP/22 にも応答しない。
# WoL 前にチェックして、応答ありなら "PC は既に起きている" と判定。
check_pc_alive() {
  (echo > "/dev/tcp/${PC_TAILNET_IP}/22") 2>/dev/null
}

if check_pc_alive; then
  log "PC is already awake — using ${TASK_AWAKE} (no suspend)"
  TASK_NAME="${TASK_AWAKE}"
else
  log "PC is asleep — WoL → ${TASK_ASLEEP} (will suspend after)"
  wakeonlan -i "$PC_LAN_BROADCAST" "$PC_MAC" > /dev/null

  # PC が SSH 22 を返してくるまで待機 (最大 120 秒)
  log "waiting for PC SSH 22 to open (max 120s)..."
  ok=0
  for i in $(seq 1 60); do
    if check_pc_alive; then
      log "PC reachable (took ${i}x2s)"
      ok=1
      break
    fi
    sleep 2
  done

  if [ "$ok" -eq 0 ]; then
    log "ERROR: PC did not respond on 22 within 120s. WoL might have failed."
    exit 3
  fi

  TASK_NAME="${TASK_ASLEEP}"
fi

# schtasks /Run は fire-and-forget。task 本体は PC のユーザー session で別プロセスとして
# 動くため SSH コマンドは数秒で戻る。
log "schtasks /Run /TN ${TASK_NAME}"
ssh "${SSH_OPTS[@]}" "${PC_USER}@${PC_TAILNET_IP}" \
  "schtasks /Run /TN ${TASK_NAME}"
trigger_exit=$?

if [ "$trigger_exit" -ne 0 ]; then
  log "ERROR: schtasks /Run failed (exit=$trigger_exit)"
  exit $trigger_exit
fi

log "task triggered."

if [ "$WATCH" -eq 1 ]; then
  log "--watch mode: tailing PC log. Ctrl+C to detach (task continues on PC)."
  # PC が suspend した瞬間に SSH が切れるので、その時点で tail 終了
  ssh "${SSH_OPTS[@]}" "${PC_USER}@${PC_TAILNET_IP}" \
    "Get-Content '${PC_LOG_PATH}' -Wait -Tail 0" || true
fi

exit 0
