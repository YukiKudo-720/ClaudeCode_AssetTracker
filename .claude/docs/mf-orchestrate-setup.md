# MF Orchestrate セットアップ手順

`mf-orchestrate` を Pi cron + PC Task Scheduler 構成で動かすための環境設定メモ。

## アーキテクチャ概要

```
[Pi cron]
  → pi-mf-orchestrate-controller.sh (スケジューリング / 状態管理)
    → (state 判定後のみ) WoL + SSH
      → [PC Task Scheduler]
        → orchestrate-and-suspend.ps1
          → mf-orchestrate.ts (単発操作のみ)
            → POST Pi /api/mf-status

状態管理: /srv/asset-tracker/data/mf-orchestrate-state.json
ロック  : /srv/asset-tracker/data/mf-orchestrate.lock (flock)
```

- **スケジューリング**: Pi 側のみ (cron + controller の中で完結)
- **状態管理**: Pi 側のみ (state.json)
- **PC**: 引き渡された 1 回分の処理を実行するだけ
- **PC Task Scheduler**: Playwright が headless=false でログイン中デスクトップ
  セッションでしか動かないため、SSH 経由直接実行ではなく Task 経由で起動する。
  PC をシャットダウンしない限りセッションは維持される前提。

## 1. Prisma migration (Pi 側、初回のみ)

```bash
cd /srv/asset-tracker && git pull
corepack pnpm install
sudo systemctl stop asset-tracker
PATH="$PWD/apps/server/node_modules/.bin:$PATH" \
  node apps/server/node_modules/prisma/build/index.js \
  generate
corepack pnpm -F @asset-tracker/server exec prisma migrate deploy
sudo systemctl start asset-tracker
```

## 2. PC 側 Windows Task Scheduler

PowerShell 管理者で:

```powershell
$ScriptPath = 'C:\Users\guilt\Projects\ClaudeCode_AssetTracker\scripts\orchestrate-and-suspend.ps1'

$ActionA = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`" -Phase A -SuspendAfter"
Register-ScheduledTask -TaskName 'MfOrchestrateA' -Action $ActionA `
    -User $env:USERNAME -RunLevel Highest -Force

$ActionB = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`" -Phase B-step -SuspendAfter"
Register-ScheduledTask -TaskName 'MfOrchestrateBStep' -Action $ActionB `
    -User $env:USERNAME -RunLevel Highest -Force
```

## 3. Pi cron

```bash
chmod +x /srv/asset-tracker/scripts/pi-mf-orchestrate-controller.sh
crontab -e
```

例:

```
0  7  * * * /srv/asset-tracker/scripts/pi-mf-orchestrate-controller.sh phase-a >>~/asset-tracker-logs/cron.log 2>&1
0  18 * * * /srv/asset-tracker/scripts/pi-mf-orchestrate-controller.sh phase-a >>~/asset-tracker-logs/cron.log 2>&1
*/30 * * * * /srv/asset-tracker/scripts/pi-mf-orchestrate-controller.sh phase-b-check >>~/asset-tracker-logs/cron.log 2>&1
```

挙動:
- `phase-a` → 既存 state を破棄 → WoL → MfOrchestrateA Task 発火 → 完了後 SBI 状態確認 → 未完了なら state.json 作成
- `phase-b-check` (30 分毎) → state.json なし → no-op / 3 時間超え → state 破棄 /
  最終チェックから 30 分未満 → no-op / それ以外 → WoL → MfOrchestrateBStep Task 発火 → 結果見て state 更新 or 破棄

## 4. 動作確認

```bash
# Pi 側で手動発火
/srv/asset-tracker/scripts/pi-mf-orchestrate-controller.sh phase-a

# PC 側ログ
ssh guilt@100.99.142.112 \
  'Get-Content C:\Users\guilt\Projects\ClaudeCode_AssetTracker\logs\mf-orchestrate.log -Tail 100'

# Pi 側コントローラログ
tail -f ~/asset-tracker-logs/mf-orchestrate-controller.log

# state ファイル
cat /srv/asset-tracker/data/mf-orchestrate-state.json 2>/dev/null || echo 'state なし'

# PWA 設定タブ → 「MF 連携口座の状況」を確認
```

## 5. 既存 scrape-and-suspend.ps1 との関係

- `AssetTrackerScrape` (既存 Task): scrape:all + mf:push-webull だけ。MF の一括更新は
  しない。Webull 値の MF push を分離して走らせたい場合に使用。
- `MfOrchestrateA` / `MfOrchestrateBStep` (新 Task): MF の一括更新 + 完了確認 +
  scrape:all を一連で行う。

Pi cron は MfOrchestrate 系をメインに据え、AssetTrackerScrape は補助として併用可能。
