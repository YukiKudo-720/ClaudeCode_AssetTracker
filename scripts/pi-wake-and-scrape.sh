#!/usr/bin/env bash
# Pi から PC を WoL で起こし、Windows Scheduled Task を SSH 経由でトリガーする。
# Task 本体 (AssetTrackerScrape) は PC 側のログオン中ユーザー session で動くため
# Playwright headful (MF) も pnpm の Junction も問題なく解決できる。
#
# Pi cron からも手動からも同じスクリプトで使う想定。
#
# 使い方:
#   ./pi-wake-and-scrape.sh           # fire-and-forget (cron / 通常運用)
#   ./pi-wake-and-scrape.sh --watch   # 完了までログを tail (手動デバッグ用)
#
# 前提:
#   - PC で Scheduled Task "AssetTrackerScrape" 登録済 (LogonType Interactive)
#   - PC のユーザーがログオン中 (画面ロックは可。完全ログアウト/再起動直後は NG)
#   - PC 側 scrape-and-suspend.ps1 は -SuspendAfter 込で task に登録されているので
#     Pi 側から個別 args 指定は不要

set -euo pipefail

PC_MAC="9C:6B:00:B8:C6:B4"
PC_LAN_BROADCAST="192.168.0.255"
PC_TAILNET_IP="100.99.142.112"
PC_USER="guilt"
PC_TASK_NAME="AssetTrackerScrape"
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

log "WoL → $PC_MAC via $PC_LAN_BROADCAST"
wakeonlan -i "$PC_LAN_BROADCAST" "$PC_MAC" > /dev/null

# PC が SSH 22 を返してくるまで待機 (最大 120 秒)。スリープ復帰時に SSH service が
# 立ち上がるまでのラグを吸収。
log "waiting for PC SSH 22 to open (max 120s)..."
ok=0
for i in $(seq 1 60); do
  if (echo > "/dev/tcp/${PC_TAILNET_IP}/22") 2>/dev/null; then
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

# ServerAliveInterval/Count を入れて PC suspend 時に SSH が固まらないようにする
# (TCP FIN/RST が間に合わないことがあるため keepalive で 30 秒以内に検出)
SSH_OPTS=(
  -o ConnectTimeout=10
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
)

# schtasks /Run は fire-and-forget。task 本体は PC のユーザー session で別プロセスとして
# 動くため SSH コマンドは数秒で戻る。失敗判定は LastTaskResult を別途確認するか、
# Pi 側 DB が更新されるかで判断。
log "schtasks /Run /TN ${PC_TASK_NAME}"
ssh "${SSH_OPTS[@]}" "${PC_USER}@${PC_TAILNET_IP}" \
  "schtasks /Run /TN ${PC_TASK_NAME}"
trigger_exit=$?

if [ "$trigger_exit" -ne 0 ]; then
  log "ERROR: schtasks /Run failed (exit=$trigger_exit)"
  exit $trigger_exit
fi

log "task triggered. PC will scrape → sync to Pi → suspend autonomously."

if [ "$WATCH" -eq 1 ]; then
  log "--watch mode: tailing PC log. Ctrl+C to detach (task continues on PC)."
  # PC が suspend した瞬間に SSH が切れるので、その時点で tail 終了
  ssh "${SSH_OPTS[@]}" "${PC_USER}@${PC_TAILNET_IP}" \
    "Get-Content '${PC_LOG_PATH}' -Wait -Tail 0" || true
fi

exit 0
