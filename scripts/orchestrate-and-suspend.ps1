# PC 側 Windows Task Scheduler から起動される MF orchestrate ラッパー。
# 既存 scrape-and-suspend.ps1 と同じ Junction 回避 + UTF-8 出力 + suspend 機能を踏襲。
#
# 引数:
#   -Phase A|B-check     どのフェーズかを mf-orchestrate に渡す
#   -SuspendAfter        完了後に PC を sleep に戻す
#
# 想定 Task:
#   MfOrchestrateA       -Phase A -SuspendAfter   (Pi cron が WoL→発火)
#   MfOrchestrateBCheck  -Phase B-check -SuspendAfter
#
# Pi cron が「PC は元々起きていた」と判断したケースでは、suspend させたくないので
# Task 側で SuspendAfter 無しの別 Task を用意するか、Pi から渡された引数で切替する。
# 当面は SuspendAfter ありで運用 (= Pi が起こしたケースのみ Task 発火する想定)。

param(
    [ValidateSet('A', 'B-check')]
    [string]$Phase = 'A',
    [switch]$SuspendAfter
)

$ErrorActionPreference = 'Continue'

chcp 65001 > $null 2>&1
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDir 'orchestrate-and-suspend.log'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$stamp $Message" | Out-File -FilePath $logFile -Append -Encoding utf8
}

# pnpm Junction 回避のため tsx 本体を pnpm store から拾う (scrape-and-suspend と同じ手法)
function Resolve-TsxCli {
    $pnpmStore = Join-Path $repoRoot 'node_modules\.pnpm'
    $tsxDir = Get-ChildItem -Path $pnpmStore -Directory -Filter 'tsx@*' -ErrorAction Stop |
              Sort-Object Name -Descending |
              Select-Object -First 1
    if (-not $tsxDir) { throw "tsx not found under $pnpmStore" }
    return Join-Path $tsxDir.FullName 'node_modules\tsx\dist\cli.mjs'
}

Write-Log "=== orchestrate start (Phase=$Phase SuspendAfter=$SuspendAfter) ==="

Set-Location (Join-Path $repoRoot 'apps\server')

try {
    $tsxCli = Resolve-TsxCli
    $scriptAbs = Join-Path $repoRoot 'apps\server\scripts\mf-orchestrate.ts'
    Write-Log "tsx=$tsxCli script=$scriptAbs"
    & node $tsxCli $scriptAbs "--phase=$Phase" *>> $logFile
    $exit = $LASTEXITCODE
    Write-Log "=== orchestrate end exit=$exit ==="
} catch {
    Write-Log "EXCEPTION: $($_.Exception.Message)"
    $exit = 1
}

if ($SuspendAfter) {
    Write-Log "suspending PC in 10s..."
    Start-Sleep -Seconds 10
    & rundll32.exe powrprof.dll,SetSuspendState 0,1,0
}
