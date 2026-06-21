# PC edge workers for NAS-hosted III (Discord collector only).
# NAS runs engine + schedule-bootstrap + odp-ingest-bridge + collector-opencli.
# Usage: .\scripts\start-edge-workers.ps1

param([switch]$ReloadSchedules)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Import-IiiEnv.ps1")

$NasHost = if ($env:III_NAS_HOST) { $env:III_NAS_HOST } else { "192.168.50.130" }
$env:III_URL = "ws://${NasHost}:49134"
$env:ODP_INGEST_URL = "http://${NasHost}:8040"

$ctx = Import-IiiEnv
Write-Host "III edge workers → NAS $NasHost (env: $($ctx.EnvFile))"

Stop-IiiPythonWorkers
Start-Sleep -Seconds 2

Write-Host "  starting collector-discord (edge)..."
Start-IiiPythonWorker -WorkerName "collector-discord" -IiiRoot $ctx.IiiRoot

Start-Sleep -Seconds 3

Invoke-IiiEngineTrigger "discord::status" | Out-Host
Invoke-IiiEngineTrigger "odp.collect::discord_snapshot" -ExtraArgs @("channel_id=195654289811570688", "limit=3") -TimeoutMs 60000 | Out-Host

if ($ReloadSchedules) {
    Invoke-IiiEngineTrigger "odp.schedule::reload" | Out-Host
}

Write-Host "Done. Only collector-discord runs on this PC; cron lives on NAS."