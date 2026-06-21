#!/bin/bash
# Pi cron 用 MF orchestrate ラッパー。
#
# 使い方:
#   pi-wake-and-orchestrate.sh phase-a       # フェーズ A 新規起動 (Pi メイン cron)
#   pi-wake-and-orchestrate.sh phase-b-check # フェーズ B チェック (30 分毎 cron)
#
# 動作:
#   PC が起きていなければ WoL → SSH 接続が確立するまで待機
#   起きていれば「PC が元から起きていた」フラグを記録 → suspend しない
#   schtasks /Run で MfOrchestrate{A,BCheck} タスクを発火

set -euo pipefail

PHASE="${1:-}"
if [ -z "$PHASE" ]; then
  echo "usage: $0 phase-a|phase-b-check" >&2
  exit 1
fi

PC_TS_IP='100.99.142.112'
PC_USER='guilt'
PC_MAC='9C-6B-00-B8-C6-B4'
LOG="${HOME}/asset-tracker-logs/orchestrate.log"
mkdir -p "$(dirname "$LOG")"

log() {
  echo "$(date '+%F %T') $1" | tee -a "$LOG"
}

SSH_OPTS=(-o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

# PC が起きているか確認
if nc -z -w 5 "$PC_TS_IP" 22 2>/dev/null; then
  log "PC は起動中 ($PHASE)"
  PC_WAS_AWAKE=1
else
  log "PC を WoL で起こす ($PHASE)"
  wakeonlan -i 192.168.0.255 "$PC_MAC" >/dev/null
  # SSH が通るまで待つ (最大 90 秒)
  for i in $(seq 1 30); do
    sleep 3
    if nc -z -w 3 "$PC_TS_IP" 22 2>/dev/null; then
      log "PC 起動完了 (${i}回目で接続成功)"
      break
    fi
  done
  PC_WAS_AWAKE=0
fi

case "$PHASE" in
  phase-a)
    TASK='MfOrchestrateA'
    ;;
  phase-b-check)
    TASK='MfOrchestrateBCheck'
    ;;
  *)
    echo "unknown phase: $PHASE" >&2
    exit 1
    ;;
esac

log "Task Scheduler の $TASK を発火"
ssh "${SSH_OPTS[@]}" "${PC_USER}@${PC_TS_IP}" "schtasks /Run /TN \"$TASK\""

# PC が元々寝ていた場合は、完了後に sleep に戻す処理が PC 側 Task 内で行われる前提
# (orchestrate スクリプト自体は sleep させない。Task Scheduler 側のラッパーが面倒見る)

log "$PHASE 発火完了"
