# Pi → SSH 経由で叩かれる scrape → mf push → suspend ラッパー
#
# 動作:
#   1. node tsx/dist/cli.mjs apps/server/scripts/scrape-all.ts
#   2. exit 0 なら node tsx/dist/cli.mjs apps/server/scripts/mf-push-webull.ts
#   3. -SuspendAfter があれば最後に PC をスリープ
#
# 実装メモ:
#   pnpm run 経由ではなく tsx 本体の絶対パスで起動するのは、SSH session token が
#   apps/server/node_modules/tsx の Junction を辿れず Cannot find module になるため。
#
# 引数:
#   -NoMfPush       mf:push-webull をスキップ (scrape 単独テスト用)
#   -SuspendAfter   完了後に PC をスリープに戻す
#   -DryRun         実行せずログだけ書く (配線確認用)

param(
    [switch]$NoMfPush,
    [switch]$SuspendAfter,
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'

# SSH 越し実行時の文字化け対策: console を UTF-8 に
chcp 65001 > $null 2>&1
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot 'logs'
$logFile = Join-Path $logDir 'scrape-and-suspend.log'

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    "$stamp $Message" | Out-File -FilePath $logFile -Append -Encoding utf8
}

# pnpm の Junction (`apps/server/node_modules/tsx`) を SSH トークンが辿れないため、
# tsx 本体を pnpm の content-addressable store から直接拾って node 経由で起動する。
# これで SSH 経由でも Junction 解決失敗を回避できる。
function Resolve-TsxCli {
    $pnpmStore = Join-Path $repoRoot 'node_modules\.pnpm'
    $tsxDir = Get-ChildItem -Path $pnpmStore -Directory -Filter 'tsx@*' -ErrorAction Stop |
              Sort-Object Name -Descending |
              Select-Object -First 1
    if (-not $tsxDir) { throw "tsx not found under $pnpmStore" }
    return Join-Path $tsxDir.FullName 'node_modules\tsx\dist\cli.mjs'
}

function Invoke-Stage {
    param([string]$Stage, [string]$ScriptRelPath)
    Write-Log "--- $Stage start ---"
    $tsxCli = Resolve-TsxCli
    $scriptAbs = Join-Path $repoRoot $ScriptRelPath
    Write-Log "tsx=$tsxCli script=$scriptAbs"
    # *>> は stdout+stderr+verbose+warning すべてを append redirect。リアルタイム書込
    & node $tsxCli $scriptAbs *>> $logFile
    $exit = $LASTEXITCODE
    Write-Log "--- $Stage end exit=$exit ---"
    return $exit
}

Write-Log "=== scrape-and-suspend start (NoMfPush=$NoMfPush SuspendAfter=$SuspendAfter DryRun=$DryRun) ==="

$scrapeExit = 0
$pushExit = 0

if ($DryRun) {
    Write-Log "DRY RUN: skip stages"
} else {
    # cwd は apps/server (各 ts スクリプトが ../../data の相対パスで .env 等を読むため)
    Set-Location (Join-Path $repoRoot 'apps\server')

    try {
        $scrapeExit = Invoke-Stage -Stage 'scrape:all' -ScriptRelPath 'apps\server\scripts\scrape-all.ts'
    } catch {
        Write-Log "scrape:all EXCEPTION: $($_.Exception.Message)"
        $scrapeExit = 1
    }

    if ($NoMfPush) {
        Write-Log "mf:push-webull SKIPPED (-NoMfPush)"
    } elseif ($scrapeExit -ne 0) {
        Write-Log "mf:push-webull SKIPPED (scrape failed exit=$scrapeExit)"
    } else {
        try {
            $pushExit = Invoke-Stage -Stage 'mf:push-webull' -ScriptRelPath 'apps\server\scripts\mf-push-webull.ts'
        } catch {
            Write-Log "mf:push-webull EXCEPTION: $($_.Exception.Message)"
            $pushExit = 1
        }
    }
}

Write-Log "=== scrape-and-suspend end (scrape=$scrapeExit push=$pushExit) ==="

if ($SuspendAfter) {
    Write-Log "suspending PC in 10s..."
    Start-Sleep -Seconds 10
    & rundll32.exe powrprof.dll,SetSuspendState 0,1,0
}
