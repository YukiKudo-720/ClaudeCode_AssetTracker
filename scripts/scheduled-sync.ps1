# スケジュールタスクから呼ばれる同期スクリプト
#
# 動作:
#   1. corepack pnpm --filter @asset-tracker/server run scrape:all を実行
#   2. ログを logs/scheduled-sync.log に追記
#   3. -SuspendAfter が付いていれば完了後にスリープ復帰
#
# 引数:
#   -SuspendAfter   完了後に PC をスリープに戻す
#   -DryRun         実行せずログだけ書く (動作確認用)

param(
    [switch]$SuspendAfter,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDir 'scheduled-sync.log'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$stamp $Message" | Out-File -FilePath $logFile -Append -Encoding utf8
}

Write-Log "=== scheduled-sync start (SuspendAfter=$SuspendAfter DryRun=$DryRun) ==="

if ($DryRun) {
    Write-Log "DRY RUN: skip scrape"
} else {
    try {
        Set-Location $repoRoot
        # corepack 経由で pnpm を呼ぶ (-g 禁止ルールに準拠)
        $output = & corepack pnpm --filter @asset-tracker/server run scrape:all 2>&1
        $exit = $LASTEXITCODE
        $output | Out-File -FilePath $logFile -Append -Encoding utf8
        Write-Log "scrape:all exit=$exit"
    } catch {
        Write-Log "ERROR: $($_.Exception.Message)"
    }
}

if ($SuspendAfter) {
    Write-Log "suspending PC in 5s..."
    Start-Sleep -Seconds 5
    # 第1引数=0 はスリープ (1=休止状態), 第2=強制, 第3=ウェイクイベント無効化しない
    & rundll32.exe powrprof.dll,SetSuspendState 0,1,0
}

Write-Log "=== scheduled-sync end ==="
