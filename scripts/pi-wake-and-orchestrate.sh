#!/bin/bash
# DEPRECATED: pi-mf-orchestrate-controller.sh への alias。
# 旧 cron 設定 (= pi-wake-and-orchestrate.sh) を残したまま新コントローラに移行
# するためのラッパー。引数互換: phase-a / phase-b-check をそのまま渡す。

DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/pi-mf-orchestrate-controller.sh" "$@"
