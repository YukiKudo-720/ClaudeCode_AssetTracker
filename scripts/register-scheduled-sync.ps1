# Asset Tracker のスケジュール同期タスクを Windows タスクスケジューラに登録する。
#
# 動作:
#   - 07:00 と 15:35 (Tokyo close 後) に scheduled-sync.ps1 -SuspendAfter を起動
#   - スリープ中ならスリープ復帰させる (WakeToRun=$true)
#
# 使い方 (管理者 PowerShell で実行):
#   powershell -ExecutionPolicy Bypass -File scripts/register-scheduled-sync.ps1
#
# 解除:
#   Unregister-ScheduledTask -TaskName 'AssetTracker-Sync-Morning' -Confirm:$false
#   Unregister-ScheduledTask -TaskName 'AssetTracker-Sync-TokyoClose' -Confirm:$false
#
# 注意:
#   - 電源オプションで「スリープ解除タイマーの許可」を有効にすること
#     powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
#     powercfg /SETACTIVE SCHEME_CURRENT
#   - ノートPCはバッテリ駆動時は WakeToRun が無効化される設定が多いので
#     AC 接続中のみ動作する想定 (StartWhenAvailable=$true でAC復帰時にキャッチアップ)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $repoRoot 'scripts\scheduled-sync.ps1'

if (-not (Test-Path $scriptPath)) {
    throw "scheduled-sync.ps1 が見つかりません: $scriptPath"
}

# 共通のアクション
$actionParams = @{
    Execute  = 'powershell.exe'
    Argument = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -SuspendAfter"
}
$action = New-ScheduledTaskAction @actionParams

# スリープ復帰させる設定 (splatting で backtick 連結を回避)
$settingsParams = @{
    WakeToRun                  = $true
    StartWhenAvailable         = $true
    AllowStartIfOnBatteries    = $true
    DontStopIfGoingOnBatteries = $true
    ExecutionTimeLimit         = (New-TimeSpan -Minutes 15)
    MultipleInstances          = 'IgnoreNew'
}
$settings = New-ScheduledTaskSettingsSet @settingsParams

# 現在ログインしているユーザーで実行
$principalParams = @{
    UserId    = "$env:USERDOMAIN\$env:USERNAME"
    LogonType = 'Interactive'
    RunLevel  = 'Limited'
}
$principal = New-ScheduledTaskPrincipal @principalParams

function Register-Task {
    param([string]$Name, $Trigger)
    if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
        Write-Host "既存タスクを更新: $Name"
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
    }
    $registerParams = @{
        TaskName    = $Name
        Action      = $action
        Trigger     = $Trigger
        Settings    = $settings
        Principal   = $principal
        Description = "Asset Tracker 自動同期 ($Name)"
    }
    Register-ScheduledTask @registerParams | Out-Null
    Write-Host "登録完了: $Name"
}

# 朝同期 (07:00)
$morningTrigger = New-ScheduledTaskTrigger -Daily -At '07:00'
# Tokyo close 後 (15:35)
$closeTrigger = New-ScheduledTaskTrigger -Daily -At '15:35'

Register-Task -Name 'AssetTracker-Sync-Morning' -Trigger $morningTrigger
Register-Task -Name 'AssetTracker-Sync-TokyoClose' -Trigger $closeTrigger

Write-Host ""
Write-Host "次回実行時刻:"
Get-ScheduledTask -TaskName 'AssetTracker-Sync-*' |
    Get-ScheduledTaskInfo |
    Select-Object TaskName, NextRunTime, LastRunTime, LastTaskResult |
    Format-Table -AutoSize

Write-Host ""
Write-Host "※ 電源オプションで「スリープ解除タイマーの許可」を「有効」に設定してください:"
Write-Host "  powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1"
Write-Host "  powercfg /SETACTIVE SCHEME_CURRENT"
