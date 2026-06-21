# Restart III Python workers with full env (DISCORD_TOKEN, ODP_INGEST_URL, …).
# Usage:
#   .\scripts\restart-workers.ps1              # local full stack (dev)
#   .\scripts\restart-workers.ps1 -NasEdge     # PC edge only → NAS engine (production)
#   .\scripts\restart-workers.ps1 -ReloadSchedules

param(
    [switch]$ReloadSchedules,
    [switch]$NasEdge
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "Import-IiiEnv.ps1")
$ctx = Import-IiiEnv

if ($NasEdge -or $ctx.NasEdge) {
    if (-not $NasEdge) {
        Write-Host "III_DEPLOY_MODE=nas-edge — edge workers only (collector-discord → $($ctx.EngineHost))"
    }
    & (Join-Path $PSScriptRoot "start-edge-workers.ps1") @PSBoundParameters
    return
}

Write-Host "III workers restart (local stack, env: $($ctx.EnvFile))"

Stop-IiiPythonWorkers
Start-Sleep -Seconds 2

foreach ($w in @("odp-ingest-bridge", "collector-discord", "collector-opencli", "schedule-bootstrap")) {
    Write-Host "  starting $w..."
    Start-IiiPythonWorker -WorkerName $w -IiiRoot $ctx.IiiRoot
}

Start-Sleep -Seconds 3

Invoke-IiiEngineTrigger "odp.ingest::health" | Out-Host
Invoke-IiiEngineTrigger "discord::status" | Out-Host

if ($ReloadSchedules) {
    Invoke-IiiEngineTrigger "odp.schedule::reload" | Out-Host
}

Write-Host "Done. Workers run on THIS machine until stop-workers.ps1 or reboot."