# Sync opencli-admin III stack to NAS and run docker compose --profile nas.
# Usage: .\iii\scripts\deploy-nas.ps1
param(
    [string]$NasHost = "Curry@192.168.50.130",
    [int]$SshPort = 52251,
    [string]$NasPath = "/volume1/docker/opencli-admin",
    [string]$KeyFile = "$env:USERPROFILE\.ssh\nas_key",
    [switch]$SyncOnly,
    [switch]$DeployOnly
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$sshBase = @("-i", $KeyFile, "-o", "StrictHostKeyChecking=no")

function Invoke-NasSsh([string]$Command) {
    & ssh @sshBase -p $SshPort $NasHost $Command
    if ($LASTEXITCODE -ne 0) { throw "SSH failed: $Command" }
}

if (-not $DeployOnly) {
    Write-Host "==> Stream sync to NAS ($NasPath) via git-bash tar|ssh"
    $bash = "C:\Program Files\Git\bin\bash.exe"
    if (-not (Test-Path $bash)) { throw "Git Bash required for binary-safe tar stream: $bash" }
    $tarCmd = @(
        "cd '$($Root -replace '\\','/')'",
        "tar -czf - --exclude=odp-rs/target --exclude=node_modules --exclude=.git",
        "docker-compose.yml .env.nas.example iii odp-rs contracts backend/config.py backend/main.py",
        "| ssh -i ~/.ssh/nas_key -p $SshPort -o StrictHostKeyChecking=no $NasHost",
        "'cd $NasPath && tar xzf - && chmod +x iii/scripts/deploy-nas.sh'"
    ) -join ' '
    & $bash -lc $tarCmd
    if ($LASTEXITCODE -ne 0) { throw "tar|ssh stream sync failed" }
    Write-Host "==> Sync complete"
}

if ($SyncOnly) { exit 0 }

Write-Host "==> Ensure .env has III orchestrator settings"
$envScript = @'
cd /volume1/docker/opencli-admin
if ! grep -q '^COLLECTION_ORCHESTRATOR=' .env 2>/dev/null; then
  cat >> .env <<'EOF'

# III control plane (added by deploy-nas.ps1)
COLLECTION_ORCHESTRATOR=iii
ODP_INGEST_URL=http://odp-ingest:8040
III_URL=ws://iii-engine:49134
ODP_INGEST_PORT=8040
III_WS_PORT=49134
OPENCLI_MODE=bridge
AGENT_MODE=bridge
POSTGRES_DB=opencli_admin
POSTGRES_USER=opencli
POSTGRES_PASSWORD=opencli_secret
DATABASE_URL=postgresql+asyncpg://opencli:opencli_secret@postgres:5432/opencli_admin
EOF
fi
'@
Invoke-NasSsh $envScript

Write-Host "==> Deploy NAS stack (sudo docker compose --profile nas)"
Invoke-NasSsh "cd $NasPath && sudo /usr/local/bin/docker compose --profile nas build odp-ingest odp-store iii-odp-ingest-bridge iii-schedule-bootstrap iii-collector-opencli 2>&1"
Invoke-NasSsh "cd $NasPath && sudo /usr/local/bin/docker compose --profile nas up -d 2>&1"
Invoke-NasSsh "cd $NasPath && sudo /usr/local/bin/docker compose --profile nas ps 2>&1"

Write-Host ""
Write-Host "NAS III deploy finished."
Write-Host "  API health: http://192.168.50.130:8031/health (expect collection_orchestrator=iii)"
Write-Host "  ODP ingest: http://192.168.50.130:8040/health"
Write-Host "  III WS:     ws://192.168.50.130:49134"