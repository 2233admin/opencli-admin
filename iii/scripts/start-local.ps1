# Start III M0+M1+M2 stack on Windows (engine + workers + optional odp-ingest).
# Usage: .\scripts\start-local.ps1 [-ChannelId <id>] [-SkipIngest] [-WorkersOnly]

param(
    [string]$ChannelId = "",
    [switch]$SkipIngest,
    [switch]$WorkersOnly
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Import-IiiEnv.ps1")

$ctx = Import-IiiEnv
$IiiRoot = $ctx.IiiRoot
$RepoRoot = $ctx.RepoRoot
$IiiExe = Join-Path $env:USERPROFILE ".local\iii\iii.exe"

if (-not (Test-Path $IiiExe)) {
    throw "iii.exe not found at $IiiExe — install from https://iii.dev/docs/install"
}

if (-not $WorkersOnly) {
    Write-Host "Starting III engine..."
    Start-Process -FilePath $IiiExe -ArgumentList @("--config", (Join-Path $IiiRoot "config.yaml")) -WorkingDirectory $IiiRoot
    Start-Sleep -Seconds 2
}

if (-not $SkipIngest -and -not $WorkersOnly) {
    $IngestBin = Join-Path $RepoRoot "odp-rs\target\release\odp-ingest.exe"
    if (Test-Path $IngestBin) {
        Write-Host "Starting odp-ingest on :8040 (in-memory if no Redis)..."
        Start-Process -FilePath $IngestBin -WorkingDirectory $RepoRoot
        Start-Sleep -Seconds 1
    } else {
        Write-Warning "odp-ingest.exe not built — run: cd odp-rs && cargo build --release -p odp-ingest"
    }
}

Stop-IiiPythonWorkers
Start-Sleep -Seconds 1

Write-Host "Starting III workers (env from $($ctx.EnvFile))..."
foreach ($w in @("odp-ingest-bridge", "collector-discord", "collector-opencli", "schedule-bootstrap")) {
    Start-IiiPythonWorker -WorkerName $w -IiiRoot $IiiRoot
}

Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Stack runs on THIS PC until you stop it:"
Write-Host "  .\scripts\stop-workers.ps1          # workers only"
Write-Host "  Stop-Process -Name iii,odp-ingest   # engine + ingest"
Write-Host ""
Write-Host "Smoke commands:"
Write-Host "  $IiiExe trigger odp.ingest::health"
Write-Host "  $IiiExe trigger discord::status"
if ($ChannelId) {
    Write-Host "  $IiiExe trigger odp.collect::discord_snapshot channel_id=$ChannelId limit=20"
} else {
    Write-Host "  $IiiExe trigger odp.collect::discord_snapshot channel_id=<ID> channel_name=<NAME> limit=20"
}
Write-Host "  $IiiExe trigger odp.schedule::list"
Write-Host "  $IiiExe trigger odp.schedule::reload"
Write-Host "  $IiiExe console"