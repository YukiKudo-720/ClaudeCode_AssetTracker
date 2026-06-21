# MF Orchestrate セットアップ手順

`mf-orchestrate.ts` を Pi cron + PC Task Scheduler 構成で動かすための環境設定メモ。

## アーキテクチャ概要

```
[Pi cron] --(WoL + SSH)--> [PC Task Scheduler] --> [mf-orchestrate.ts] --> [Pi /api/mf-status]
```

- フェーズ A (メインサイクル): Pi cron 1 日 N 回 → `MfOrchestrateA` Task
- フェーズ B チェック (SBI リトライ判定): Pi cron 30 分毎 → `MfOrchestrateBCheck` Task

## 1. Prisma migration (Pi 側)

```bash
cd /srv/asset-tracker
sudo systemctl stop asset-tracker
corepack pnpm -F @asset-tracker/server prisma migrate dev --name mf_account_status
sudo systemctl start asset-tracker
```

## 2. PC 側 Windows Task Scheduler

PowerShell 管理者で以下を実行 (`MfOrchestrateA` と `MfOrchestrateBCheck` の 2 タスク登録):

```powershell
$ScriptPath = 'C:\Users\guilt\Projects\ClaudeCode_AssetTracker\scripts\orchestrate-and-suspend.ps1'

# フェーズ A タスク (Pi メイン cron 発火用)
$ActionA = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`" -Phase A -SuspendAfter"
Register-ScheduledTask -TaskName 'MfOrchestrateA' -Action $ActionA `
    -User $env:USERNAME -RunLevel Highest -Force

# フェーズ B チェック タスク (Pi 30 分毎 cron 発火用)
$ActionB = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-ExecutionPolicy Bypass -File `"$ScriptPath`" -Phase B-check -SuspendAfter"
Register-ScheduledTask -TaskName 'MfOrchestrateBCheck' -Action $ActionB `
    -User $env:USERNAME -RunLevel Highest -Force
```

`LogonType Interactive` (= ログイン中のセッションで実行) で動かすので、PC 起動時に
auto-login かログイン状態である必要あり (既存 AssetTrackerScrape と同様の制約)。

## 3. Pi 側 cron

`scripts/pi-wake-and-orchestrate.sh` を実行可能にして crontab に登録:

```bash
chmod +x /srv/asset-tracker/scripts/pi-wake-and-orchestrate.sh
crontab -e
```

例 (フェーズ A: 朝 7時 + 夕 18時、フェーズ B: 30 分毎):

```
0  7  * * * /srv/asset-tracker/scripts/pi-wake-and-orchestrate.sh phase-a >>~/asset-tracker-logs/cron.log 2>&1
0  18 * * * /srv/asset-tracker/scripts/pi-wake-and-orchestrate.sh phase-a >>~/asset-tracker-logs/cron.log 2>&1
*/30 * * * * /srv/asset-tracker/scripts/pi-wake-and-orchestrate.sh phase-b-check >>~/asset-tracker-logs/cron.log 2>&1
```

注意:
- フェーズ A の起動間隔とフェーズ B の上限 (3 時間) との関係を考慮する。例えば 7:00
  起動の場合、SBI 完了しなければ 10:00 までに諦め。次のフェーズ A (18:00) で新規開始
  となる。
- フェーズ B が走っていない時間帯にもフェーズ B チェックは 30 分毎に発火するが、
  state.json が無いので no-op で PC を sleep に戻して終わる (起動コストはあり)。
  気になるなら crontab を「state.json があるときだけ発火」に絞る別ラッパーを噛ます。

## 4. 動作確認

```bash
# Pi 側で手動発火
/srv/asset-tracker/scripts/pi-wake-and-orchestrate.sh phase-a

# PC 側のログを確認
ssh guilt@100.99.142.112 \
  'Get-Content C:\Users\guilt\Projects\ClaudeCode_AssetTracker\logs\orchestrate-and-suspend.log -Tail 100'

# PWA 設定タブ → 「MF 連携口座の状況」を確認 (Pi の /api/mf-status を polling)
```

## 5. 既存 scrape-and-suspend.ps1 との関係

- `AssetTrackerScrape` (既存 Task): WoL → bulk-update を介さず直接 scrape:all + mf:push-webull
- `MfOrchestrateA` (新): WoL → bulk-update → check 待ち → scrape:all + 必要なら SBI リトライへ

両方残しつつ、Pi cron 側で「メイン経路は MfOrchestrateA に切替、Webull push が必要なら
別 Task で実行」を推奨。
