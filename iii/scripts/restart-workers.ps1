# Restart III Python workers with full env (DISCORD_TOKEN, ODP_INGEST_URL, …).
# Usage: .\scripts\restart-workers.ps1 [-ReloadSchedules]

param([switch]$ReloadSchedules)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Import-IiiEnv.ps1")

$ctx = Import-IiiEnv
Write-Host "III workers restart (env: $($ctx.EnvFile))"

Stop-IiiPythonWorkers
Start-Sleep -Seconds 2

foreach ($w in @("odp-ingest-bridge", "collector-discord", "collector-opencli", "schedule-bootstrap")) {
    Write-Host "  starting $w..."
    Start-IiiPythonWorker -WorkerName $w -IiiRoot $ctx.IiiRoot
}

Start-Sleep -Seconds 3

$IiiExe = Join-Path $env:USERPROFILE ".local\iii\iii.exe"
& $IiiExe trigger odp.ingest::health | Out-Host
& $IiiExe trigger discord::status | Out-Host

if ($ReloadSchedules) {
    & $IiiExe trigger odp.schedule::reload | Out-Host
}

Write-Host "Done. Workers run on THIS machine until stop-workers.ps1 or reboot."