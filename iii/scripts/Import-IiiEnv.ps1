# Shared III environment bootstrap for Windows worker scripts.
# Dot-source: . .\scripts\Import-IiiEnv.ps1

function Import-IiiEnv {
    param(
        [string]$IiiRoot = (Split-Path -Parent $PSScriptRoot),
        [string]$RepoRoot = ""
    )
    if (-not $RepoRoot) {
        $RepoRoot = Split-Path -Parent $IiiRoot
    }

    $nasHost = if ($env:III_NAS_HOST) { $env:III_NAS_HOST } else { "192.168.50.130" }
    $nasMode = $env:III_DEPLOY_MODE -eq "nas-edge"
    if (-not $env:III_URL) {
        $env:III_URL = if ($nasMode) { "ws://${nasHost}:49134" } else { "ws://127.0.0.1:49134" }
    }
    if (-not $env:ODP_INGEST_URL) {
        $env:ODP_INGEST_URL = if ($nasMode) { "http://${nasHost}:8040" } else { "http://127.0.0.1:8040" }
    }
    if (-not $env:DISCORD_CLI_BIN) { $env:DISCORD_CLI_BIN = "discord" }

    $loaded = $null
    foreach ($envFile in @(
        (Join-Path $env:USERPROFILE ".env"),
        (Join-Path $RepoRoot ".env")
    )) {
        if (-not (Test-Path $envFile)) { continue }
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#=]+)=(.*)$') {
                $name = $matches[1].Trim()
                $value = $matches[2].Trim().Trim('"').Trim("'")
                if ($name) { Set-Item -Path "env:$name" -Value $value }
            }
        }
        $loaded = $envFile
        break
    }

    if (-not $env:DISCORD_TOKEN) {
        Write-Warning "DISCORD_TOKEN missing — discord-cli sync will fail until ~/.env or repo .env sets it."
    }

    return [pscustomobject]@{
        IiiRoot = $IiiRoot
        RepoRoot = $RepoRoot
        EnvFile = $loaded
        DiscordTokenSet = [bool]$env:DISCORD_TOKEN
        NasEdge = $nasMode
        EngineHost = Get-IiiEngineHost
    }
}

function Get-IiiEngineHost {
    $nasHost = if ($env:III_NAS_HOST) { $env:III_NAS_HOST } else { "192.168.50.130" }
    $url = $env:III_URL
    if ($url -match '^wss?://([^:/]+)') {
        return $matches[1]
    }
    if ($env:III_DEPLOY_MODE -eq "nas-edge") {
        return $nasHost
    }
    return "127.0.0.1"
}

function Get-IiiExe {
    Join-Path $env:USERPROFILE ".local\iii\iii.exe"
}

function Invoke-IiiEngineTrigger {
    param(
        [Parameter(Mandatory)][string]$FunctionPath,
        [string[]]$ExtraArgs = @(),
        [int]$TimeoutMs = 30000
    )
    $iii = Get-IiiExe
    if (-not (Test-Path $iii)) { throw "iii CLI not found: $iii" }
    $engineHost = Get-IiiEngineHost
    $triggerArgs = @("trigger", "--address", $engineHost, "--timeout-ms", $TimeoutMs, $FunctionPath) + $ExtraArgs
    & $iii @triggerArgs
}

function Get-IiiWorkerEnvironment {
    $block = @{}
    Get-ChildItem Env: | ForEach-Object { $block[$_.Name] = $_.Value }
    return $block
}

function Start-IiiPythonWorker {
    param(
        [Parameter(Mandatory)][string]$WorkerName,
        [string]$IiiRoot = (Split-Path -Parent $PSScriptRoot)
    )
    $script = Join-Path $IiiRoot "workers\$WorkerName\src\main.py"
    if (-not (Test-Path $script)) { throw "Worker script not found: $script" }
    $py = (Get-Command python -ErrorAction Stop).Source
    $env:PYTHONPATH = $IiiRoot
    $envBlock = Get-IiiWorkerEnvironment
    $params = @{
        FilePath = $py
        ArgumentList = @($script)
        WorkingDirectory = $IiiRoot
        WindowStyle = "Hidden"
    }
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        $params["Environment"] = $envBlock
    }
    Start-Process @params
}

function Stop-IiiPythonWorkers {
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match 'opencli-admin\\iii\\workers\\' } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}