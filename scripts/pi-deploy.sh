#!/usr/bin/env bash
# Pi 側に最新コードを反映するラッパー。
# git pull → PWA build → asset-tracker サービス再起動 → status 確認。
#
# 使い方:
#   ./pi-deploy.sh                # フル (git + PWA build + restart)
#   ./pi-deploy.sh --no-build     # PWA を build しない (server-only 変更時)
#   ./pi-deploy.sh --no-restart   # 再起動しない (確認だけ)
#   ./pi-deploy.sh --no-pull      # pull せず手元状態で build & restart
#
# 複合可: ./pi-deploy.sh --no-pull --no-build

set -euo pipefail

REPO_DIR="/srv/asset-tracker"
SERVICE_NAME="asset-tracker"

NO_PULL=0
NO_BUILD=0
NO_RESTART=0
for arg in "$@"; do
  case "$arg" in
    --no-pull)    NO_PULL=1 ;;
    --no-build)   NO_BUILD=1 ;;
    --no-restart) NO_RESTART=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown arg: $arg (--help)" >&2; exit 2 ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $*"; }

cd "$REPO_DIR"

if [ "$NO_PULL" -eq 0 ]; then
  log "git pull"
  git pull
else
  log "git pull skipped (--no-pull)"
fi

if [ "$NO_BUILD" -eq 0 ]; then
  log "PWA build"
  corepack pnpm --filter @asset-tracker/pwa build
else
  log "PWA build skipped (--no-build)"
fi

if [ "$NO_RESTART" -eq 0 ]; then
  log "restart ${SERVICE_NAME}"
  sudo systemctl restart "${SERVICE_NAME}"
  sleep 2
  log "status:"
  sudo systemctl status "${SERVICE_NAME}" --no-pager | head -10
else
  log "restart skipped (--no-restart)"
fi

log "done"
