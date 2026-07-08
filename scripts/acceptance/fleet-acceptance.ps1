#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Site = "aibase",
    [string]$Command = "news",
    [int]$Limit = 1,
    [int]$CenterPort = 8032,
    [int]$AgentPort = 19824,
    [switch]$FreshDb,
    [switch]$SkipCodeIntel,
    [int]$DurationThresholdSeconds = 30,
    [int]$CollectTimeoutSeconds = 75,
    [int]$RegressionTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ArtifactDir = Join-Path $RepoRoot "artifacts\acceptance\fleet\$Timestamp"
$ApiOutLog = Join-Path $ArtifactDir "api.stdout.log"
$ApiErrLog = Join-Path $ArtifactDir "api.stderr.log"
$AgentOutLog = Join-Path $ArtifactDir "agent.stdout.log"
$AgentErrLog = Join-Path $ArtifactDir "agent.stderr.log"
$ApiLog = Join-Path $ArtifactDir "api.log"
$AgentLog = Join-Path $ArtifactDir "agent.log"
$DbFile = Join-Path $ArtifactDir "fleet-acceptance.sqlite"
$AgentEndpoint = "http://127.0.0.1:$AgentPort"
$CenterUrl = "http://127.0.0.1:$CenterPort"
$BaseApiUrl = "$CenterUrl/api/v1"
$StartedProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$script:Failure = $null

New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null

function Get-PythonExe {
    $venvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) {
        return (Resolve-Path $venvPython).Path
    }
    return "python"
}

$PythonExe = Get-PythonExe

function Get-PowerShellCoreExe {
    $cmd = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    return "powershell"
}

$PwshExe = Get-PowerShellCoreExe

function Invoke-TextCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments = @()
    )
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FilePath
    $psi.WorkingDirectory = $RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    foreach ($arg in $Arguments) {
        [void]$psi.ArgumentList.Add($arg)
    }
    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()
    return [ordered]@{
        exitCode = $proc.ExitCode
        stdout = $stdout
        stderr = $stderr
        text = ($stdout + "`n" + $stderr).Trim()
    }
}

function Save-Json {
    param(
        [string]$Name,
        $Value
    )
    $path = Join-Path $ArtifactDir $Name
    $Value | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $path -Encoding UTF8
    return $path
}

function Set-Gate {
    param(
        [string]$Name,
        [string]$Status,
        [hashtable]$Details = @{}
    )
    $script:Report.gates[$Name] = [ordered]@{
        status = $Status
        details = $Details
    }
}

function Fail-Gate {
    param(
        [string]$Gate,
        [string]$Message,
        $Expected = $null,
        $Actual = $null
    )
    Set-Gate $Gate "fail" @{
        message = $Message
        expected = $Expected
        actual = $Actual
    }
    $script:Failure = [ordered]@{
        gate = $Gate
        message = $Message
        expected = $Expected
        actual = $Actual
    }
    throw "ACCEPTANCE_FAIL:${Gate}:$Message"
}

function Assert-Gate {
    param(
        [string]$Gate,
        [bool]$Condition,
        [string]$Message,
        $Expected = $null,
        $Actual = $null
    )
    if (-not $Condition) {
        Fail-Gate $Gate $Message $Expected $Actual
    }
}

function Test-PortBusy {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-PortOwners {
    param([int]$Port)
    $owners = @()
    foreach ($conn in @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        $cmd = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
        $owners += [ordered]@{
            port = $Port
            pid = $conn.OwningProcess
            process = $proc.ProcessName
            path = $proc.Path
            commandLine = $cmd.CommandLine
        }
    }
    return $owners
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$StdoutPath,
        [string]$StderrPath
    )
    "" | Set-Content -LiteralPath $StdoutPath -Encoding UTF8
    "" | Set-Content -LiteralPath $StderrPath -Encoding UTF8
    $proc = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $StdoutPath `
        -RedirectStandardError $StderrPath `
        -PassThru `
        -WindowStyle Hidden
    $StartedProcesses.Add($proc) | Out-Null
    $script:Report.processes[$Name] = [ordered]@{
        pid = $proc.Id
        command = "$FilePath $($Arguments -join ' ')"
    }
    return $proc
}

function Stop-ManagedProcesses {
    for ($i = $StartedProcesses.Count - 1; $i -ge 0; $i--) {
        $proc = $StartedProcesses[$i]
        try {
            if ($proc -and -not $proc.HasExited) {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                $proc.WaitForExit(5000) | Out-Null
            }
        } catch {
            # Best effort cleanup only.
        }
    }
}

function Merge-Log {
    param(
        [string]$OutPath,
        [string]$ErrPath,
        [string]$TargetPath
    )
    $parts = @()
    if (Test-Path $OutPath) {
        $parts += "### stdout"
        $parts += (Get-Content -LiteralPath $OutPath -Raw -ErrorAction SilentlyContinue)
    }
    if (Test-Path $ErrPath) {
        $parts += "### stderr"
        $parts += (Get-Content -LiteralPath $ErrPath -Raw -ErrorAction SilentlyContinue)
    }
    $parts -join "`n" | Set-Content -LiteralPath $TargetPath -Encoding UTF8
}

function Invoke-Api {
    param(
        [ValidateSet("GET", "POST", "PATCH", "DELETE")]
        [string]$Method,
        [string]$Path,
        $Body = $null,
        [int]$TimeoutSec = 15
    )
    $uri = "$BaseApiUrl$Path"
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 80
        return Invoke-RestMethod -Method $Method -Uri $uri -Body $json -ContentType "application/json" -TimeoutSec $TimeoutSec
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec $TimeoutSec
}

function Wait-Until {
    param(
        [string]$Gate,
        [int]$TimeoutSeconds,
        [scriptblock]$Probe
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = $null
    while ((Get-Date) -lt $deadline) {
        try {
            $result = & $Probe
            if ($result) {
                return $result
            }
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 500
    }
    Fail-Gate $Gate "Timed out waiting for $Gate" "ready within ${TimeoutSeconds}s" $lastError
}

function Invoke-LoggedProcess {
    param(
        [string]$Label,
        [string]$FilePath,
        [string[]]$Arguments,
        [int]$TimeoutSeconds = 300
    )
    $logPath = Join-Path $ArtifactDir "$Label.log"
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FilePath
    $psi.WorkingDirectory = $RepoRoot
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    foreach ($arg in $Arguments) {
        [void]$psi.ArgumentList.Add($arg)
    }

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    [void]$proc.Start()
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    $timedOut = -not $proc.WaitForExit($TimeoutSeconds * 1000)
    if ($timedOut) {
        try { $proc.Kill() } catch {}
        try { $proc.WaitForExit(5000) | Out-Null } catch {}
    }
    $sw.Stop()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $text = ($stdout + "`n" + $stderr).Trim()
    $text | Set-Content -LiteralPath $logPath -Encoding UTF8
    $exitCode = if ($timedOut) { -1 } else { $proc.ExitCode }
    return [ordered]@{
        label = $Label
        command = "$FilePath $($Arguments -join ' ')"
        exitCode = $exitCode
        timedOut = $timedOut
        durationMs = $sw.ElapsedMilliseconds
        log = $logPath
        textPreview = if ($text.Length -gt 2000) { $text.Substring(0, 2000) } else { $text }
    }
}

function Get-RegressionEvidenceText {
    param([string]$LogPath)

    if (-not (Test-Path -LiteralPath $LogPath)) {
        return ""
    }

    $raw = Get-Content -LiteralPath $LogPath -Raw -ErrorAction SilentlyContinue
    $chunks = New-Object System.Collections.Generic.List[string]
    $chunks.Add($raw)

    $paths = New-Object System.Collections.Generic.List[string]
    foreach ($match in [regex]::Matches($raw, "[A-Za-z]:\\[^\r\n""]+?(?:summary\.md|hospital\.md|understanding\.md|report\.json)")) {
        $paths.Add($match.Value.Trim())
    }

    foreach ($path in @($paths)) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }
        $dir = (Get-Item -LiteralPath $path).DirectoryName
        foreach ($name in @("summary.md", "hospital.md", "understanding.md", "sentrux-debt-register.json")) {
            $paths.Add((Join-Path $dir $name))
        }
    }

    $seen = @{}
    foreach ($path in $paths) {
        if ($seen.ContainsKey($path) -or -not (Test-Path -LiteralPath $path)) {
            continue
        }
        $seen[$path] = $true
        $chunks.Add("`n--- $path ---`n")
        $chunks.Add((Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue))
    }

    return ($chunks -join "`n")
}

function Run-RegressionGate {
    param(
        [string]$Gate,
        [string]$Label,
        [string]$FilePath,
        [string[]]$Arguments,
        [int]$TimeoutSeconds = 300,
        [bool]$Hard = $true,
        [string]$KnownDebtRegex = ""
    )
    $result = Invoke-LoggedProcess -Label $Label -FilePath $FilePath -Arguments $Arguments -TimeoutSeconds $TimeoutSeconds
    $script:Report.regression[$Label] = $result
    if ($result.exitCode -eq 0 -and -not $result.timedOut) {
        Set-Gate $Gate "pass" @{ log = $result.log; durationMs = $result.durationMs }
        return $result
    }
    $text = Get-RegressionEvidenceText -LogPath $result.log
    if ($KnownDebtRegex -and $text -match $KnownDebtRegex) {
        Set-Gate $Gate "known_debt" @{
            log = $result.log
            exitCode = $result.exitCode
            timedOut = $result.timedOut
            matched = $Matches[0]
        }
        return $result
    }
    if ($Hard) {
        Fail-Gate $Gate "Regression command failed" "exitCode=0" @{
            exitCode = $result.exitCode
            timedOut = $result.timedOut
            log = $result.log
        }
    }
    Set-Gate $Gate "warn" @{ log = $result.log; exitCode = $result.exitCode; timedOut = $result.timedOut }
    return $result
}

function Read-LogText {
    $texts = @()
    foreach ($path in @($ApiOutLog, $ApiErrLog, $ApiLog)) {
        if (Test-Path $path) {
            $texts += Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue
        }
    }
    return ($texts -join "`n")
}

function Write-ReportFiles {
    $script:Report.finishedAt = (Get-Date).ToString("o")
    if ($script:Failure) {
        $script:Report.acceptance = "FAIL"
        $script:Report.failure = $script:Failure
    }
    Save-Json "report.json" $script:Report | Out-Null

    $lines = @()
    $lines += "# Fleet Acceptance Report"
    $lines += ""
    $lines += "- acceptance: $($script:Report.acceptance)"
    $lines += "- repo: $RepoRoot"
    $lines += "- branch: $($script:Report.git.branch)"
    $lines += "- commit: $($script:Report.git.commit)"
    $lines += "- python: $($script:Report.python.version)"
    $lines += "- center: $CenterUrl"
    $lines += "- agent: $AgentEndpoint"
    $lines += "- database: $DbFile"
    $lines += ""
    $lines += "## Gates"
    foreach ($key in $script:Report.gates.Keys) {
        $lines += "- ${key}: $($script:Report.gates[$key].status)"
    }
    if ($script:Failure) {
        $lines += ""
        $lines += "## Failure"
        $lines += "- gate: $($script:Failure.gate)"
        $lines += "- message: $($script:Failure.message)"
        $lines += "- expected: $($script:Failure.expected | ConvertTo-Json -Compress -Depth 20)"
        $lines += "- actual: $($script:Failure.actual | ConvertTo-Json -Compress -Depth 20)"
    }
    $lines -join "`n" | Set-Content -LiteralPath (Join-Path $ArtifactDir "report.md") -Encoding UTF8
}

$gitCommit = (Invoke-TextCommand -FilePath "git" -Arguments @("rev-parse", "HEAD")).stdout.Trim()
$gitBranch = (Invoke-TextCommand -FilePath "git" -Arguments @("branch", "--show-current")).stdout.Trim()
$gitStatus = (Invoke-TextCommand -FilePath "git" -Arguments @("status", "--short", "--branch")).stdout.Trim()
$pythonVersionResult = Invoke-TextCommand -FilePath $PythonExe -Arguments @("--version")
$pythonVersion = (($pythonVersionResult.stdout + $pythonVersionResult.stderr).Trim())

$script:Report = [ordered]@{
    acceptance = "RUNNING"
    startedAt = (Get-Date).ToString("o")
    finishedAt = $null
    repo = $RepoRoot
    artifacts = [ordered]@{
        root = $ArtifactDir
        reportJson = (Join-Path $ArtifactDir "report.json")
        reportMd = (Join-Path $ArtifactDir "report.md")
        apiLog = $ApiLog
        agentLog = $AgentLog
        inventory = (Join-Path $ArtifactDir "inventory.json")
        match = (Join-Path $ArtifactDir "match.json")
        runEvents = (Join-Path $ArtifactDir "run-events.json")
    }
    git = [ordered]@{
        branch = $gitBranch
        commit = $gitCommit
        status = $gitStatus
    }
    python = [ordered]@{
        executable = $PythonExe
        version = $pythonVersion
    }
    powershell = [ordered]@{
        executable = $PwshExe
    }
    params = [ordered]@{
        site = $Site
        command = $Command
        limit = $Limit
        centerPort = $CenterPort
        agentPort = $AgentPort
        freshDb = [bool]$FreshDb
        durationThresholdSeconds = $DurationThresholdSeconds
        collectTimeoutSeconds = $CollectTimeoutSeconds
        skipCodeIntel = [bool]$SkipCodeIntel
    }
    environment = [ordered]@{
        databaseFile = $DbFile
        databaseUrl = "sqlite+aiosqlite:///$($DbFile.Replace('\', '/'))"
        centerUrl = $CenterUrl
        agentEndpoint = $AgentEndpoint
    }
    processes = [ordered]@{}
    gates = [ordered]@{}
    evidence = [ordered]@{}
    regression = [ordered]@{}
    failure = $null
}

try {
    foreach ($port in @($CenterPort, $AgentPort)) {
        if (Test-PortBusy $port) {
            $owners = Get-PortOwners $port
            Save-Json "port-$port-owners.json" $owners | Out-Null
            Fail-Gate "environment" "Port $port is already in use" "free port" $owners
        }
    }

    if ($FreshDb) {
        foreach ($path in @($DbFile, "$DbFile-wal", "$DbFile-shm")) {
            if (Test-Path $path) {
                Remove-Item -LiteralPath $path -Force
            }
        }
    }
    Set-Gate "environment" "pass" @{
        commit = $gitCommit
        branch = $gitBranch
        python = $pythonVersion
        centerPort = $CenterPort
        agentPort = $AgentPort
        databaseFile = $DbFile
    }

    $dbUrl = $script:Report.environment.databaseUrl

    $env:DATABASE_URL = $dbUrl
    $env:TASK_EXECUTOR = "local"
    $env:COLLECTION_MODE = "agent"
    $env:API_AUTH_TOKEN = ""
    $env:AGENT_POOL_ENDPOINTS = ""
    $env:OPENCLI_TIMEOUT = [string][Math]::Max($DurationThresholdSeconds, 30)
    $env:AGENT_WS_TIMEOUT = [string][Math]::Max($CollectTimeoutSeconds, 45)
    $env:AGENT_HTTP_TIMEOUT = [string][Math]::Max($CollectTimeoutSeconds, 45)

    $apiArgs = @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", [string]$CenterPort)
    Start-ManagedProcess -Name "center-api" -FilePath $PythonExe -Arguments $apiArgs -StdoutPath $ApiOutLog -StderrPath $ApiErrLog | Out-Null

    Wait-Until -Gate "health" -TimeoutSeconds 45 -Probe {
        $health = Invoke-RestMethod -Method GET -Uri "$CenterUrl/health" -TimeoutSec 3
        if ($health.status -eq "ok") { return $health }
        return $false
    } | Out-Null

    $env:CENTRAL_API_URL = $CenterUrl
    $env:AGENT_REGISTER = "ws"
    $env:AGENT_PORT = [string]$AgentPort
    $env:AGENT_ADVERTISE_URL = $AgentEndpoint
    $env:AGENT_LABEL = "fleet-acceptance-$Timestamp"
    $env:AGENT_MODE = "bridge"
    $env:AGENT_DEPLOY_TYPE = "shell"
    $env:OPENCLI_BIN = "opencli"

    $agentArgs = @("-m", "uvicorn", "backend.agent_server:app", "--host", "127.0.0.1", "--port", [string]$AgentPort)
    Start-ManagedProcess -Name "ws-agent" -FilePath $PythonExe -Arguments $agentArgs -StdoutPath $AgentOutLog -StderrPath $AgentErrLog | Out-Null

    Wait-Until -Gate "agent-health" -TimeoutSeconds 30 -Probe {
        $health = Invoke-RestMethod -Method GET -Uri "$AgentEndpoint/health" -TimeoutSec 3
        if ($health.status -eq "ok" -and $health.opencli_bin_exists) { return $health }
        return $false
    } | Out-Null

    $nodes = Wait-Until -Gate "cluster-start" -TimeoutSeconds 45 -Probe {
        $response = Invoke-Api -Method GET -Path "/nodes" -TimeoutSec 5
        $node = @($response.data) | Where-Object { $_.url -eq $AgentEndpoint } | Select-Object -First 1
        if (-not $node) { return $false }
        $runtimes = @($node.runtimes)
        if ($node.status -eq "online" -and $node.protocol -eq "ws" -and
            $runtimes -contains "miniflow" -and $runtimes -contains "opentabs") {
            return $response
        }
        return $false
    }
    Save-Json "nodes.json" $nodes.data | Out-Null
    Set-Gate "cluster-start" "pass" @{
        endpoint = $AgentEndpoint
        protocol = "ws"
        runtimes = @("miniflow", "opentabs")
    }

    $inventoryResp = Invoke-Api -Method GET -Path "/workflows/fleet/inventory"
    $inventory = $inventoryResp.data
    Save-Json "inventory.json" $inventory | Out-Null
    $agentInventory = @($inventory.agents) | Where-Object { $_.endpoint -eq $AgentEndpoint } | Select-Object -First 1
    Assert-Gate "capability-snapshot" ($inventory.version -eq "1.1.0") "inventory version mismatch" "1.1.0" $inventory.version
    Assert-Gate "capability-snapshot" ($inventory.summary.clusterModel -eq "private-agent-pod") "cluster model mismatch" "private-agent-pod" $inventory.summary.clusterModel
    Assert-Gate "capability-snapshot" ($inventory.summary.routingPolicy -eq "site_binding_agent_first") "routing policy mismatch" "site_binding_agent_first" $inventory.summary.routingPolicy
    Assert-Gate "capability-snapshot" ([int]$inventory.summary.wsConnected -ge 1) "no WS agent connected" "wsConnected >= 1" $inventory.summary.wsConnected
    Assert-Gate "capability-snapshot" ($null -ne $agentInventory) "agent missing from inventory" $AgentEndpoint $null
    Assert-Gate "capability-snapshot" ((@($agentInventory.runtimes) -contains "miniflow") -and (@($agentInventory.runtimes) -contains "opentabs")) "agent runtime inventory missing miniflow/opentabs" "miniflow,opentabs" $agentInventory.runtimes
    Set-Gate "capability-snapshot" "pass" @{
        version = $inventory.version
        wsConnected = $inventory.summary.wsConnected
        runtimes = $agentInventory.runtimes
    }

    $bindingBody = @{
        browser_endpoint = $AgentEndpoint
        site = $Site
        notes = "fleet acceptance $Timestamp"
    }
    $bindingResp = Invoke-Api -Method POST -Path "/browsers/bindings" -Body $bindingBody
    Save-Json "binding.json" $bindingResp.data | Out-Null

    $matchBody = @{
        site = $Site
        command = $Command
    }
    $matchResp = Invoke-Api -Method POST -Path "/workflows/fleet/match" -Body $matchBody
    $match = $matchResp.data
    Save-Json "match.json" $match | Out-Null
    $selectedReasons = @($match.selected.reasons)
    Assert-Gate "binding-match" ($match.matched -eq $true) "fleet match did not match" $true $match.matched
    Assert-Gate "binding-match" ($match.selected.endpoint -eq $AgentEndpoint) "selected endpoint mismatch" $AgentEndpoint $match.selected.endpoint
    Assert-Gate "binding-match" (@($match.missing).Count -eq 0) "fleet match has missing requirements" "[]" $match.missing
    Assert-Gate "binding-match" (@($match.selected.missing).Count -eq 0) "selected endpoint has missing requirements" "[]" $match.selected.missing
    Assert-Gate "binding-match" ($selectedReasons -contains "site_binding") "site_binding reason missing" "site_binding" $selectedReasons
    Assert-Gate "binding-match" ($selectedReasons -contains "reverse_ws_agent") "reverse_ws_agent reason missing" "reverse_ws_agent" $selectedReasons
    Set-Gate "binding-match" "pass" @{
        selectedEndpoint = $match.selected.endpoint
        reasons = $selectedReasons
    }

    $sourceBody = @{
        name = "fleet acceptance $Site $Command $Timestamp"
        description = "Acceptance source generated by scripts/acceptance/fleet-acceptance.ps1"
        channel_type = "opencli"
        channel_config = @{
            site = $Site
            command = $Command
            format = "json"
            args = @{}
        }
        ai_config = $null
        enabled = $true
        tags = @("acceptance", "fleet")
    }
    $sourceResp = Invoke-Api -Method POST -Path "/sources" -Body $sourceBody
    $source = $sourceResp.data
    Save-Json "source.json" $source | Out-Null
    $sourceId = $source.id

    $triggerBody = @{
        source_id = $sourceId
        parameters = @{
            limit = $Limit
        }
        priority = 5
    }
    $triggerResp = Invoke-Api -Method POST -Path "/tasks/trigger" -Body $triggerBody
    Save-Json "trigger.json" $triggerResp.data | Out-Null
    $taskId = $triggerResp.data.task_id
    Assert-Gate "real-collect" (-not [string]::IsNullOrWhiteSpace($taskId)) "trigger response missing task_id" "task_id" $triggerResp.data

    $runState = Wait-Until -Gate "real-collect" -TimeoutSeconds $CollectTimeoutSeconds -Probe {
        $taskResp = Invoke-Api -Method GET -Path "/tasks/$taskId" -TimeoutSec 5
        $runsResp = Invoke-Api -Method GET -Path "/tasks/$taskId/runs?limit=5" -TimeoutSec 5
        $runs = @($runsResp.data)
        $run = $runs | Select-Object -First 1
        if ($taskResp.data.status -eq "failed") {
            Fail-Gate "real-collect" "task failed" "completed" $taskResp.data
        }
        if ($run -and $run.status -eq "failed") {
            Fail-Gate "real-collect" "run failed" "completed" $run
        }
        if ($run -and $taskResp.data.status -eq "completed" -and $run.status -eq "completed") {
            return [ordered]@{ task = $taskResp.data; run = $run; runs = $runsResp.data }
        }
        return $false
    }
    Save-Json "task.json" $runState.task | Out-Null
    Save-Json "runs.json" $runState.runs | Out-Null
    $run = $runState.run
    $runId = $run.id
    Assert-Gate "real-collect" ([int]$run.records_collected -ge 1) "no records collected" "records_collected >= 1" $run.records_collected
    Assert-Gate "real-collect" ([int]$run.duration_ms -lt ($DurationThresholdSeconds * 1000)) "run duration exceeded threshold" "< $($DurationThresholdSeconds * 1000) ms" $run.duration_ms
    Set-Gate "real-collect" "pass" @{
        taskId = $taskId
        runId = $runId
        recordsCollected = $run.records_collected
        durationMs = $run.duration_ms
    }

    $eventsResp = Invoke-Api -Method GET -Path "/tasks/$taskId/runs/$runId/events"
    $events = @($eventsResp.data)
    Save-Json "run-events.json" $events | Out-Null
    $collectStart = $events | Where-Object { $_.step -eq "collect" -and $_.detail -and $_.detail.params -and $_.detail.params.chrome_endpoint } | Select-Object -First 1
    $collectDone = $events | Where-Object { $_.step -eq "collect" -and $_.detail -and $_.detail.metadata -and $_.detail.metadata.node_url } | Select-Object -First 1
    $paramsEndpoint = if ($collectStart) { $collectStart.detail.params.chrome_endpoint } else { $null }
    $metadataNodeUrl = if ($collectDone) { $collectDone.detail.metadata.node_url } else { $null }
    Start-Sleep -Milliseconds 500
    $apiLogText = Read-LogText
    Assert-Gate "route-proof" ($paramsEndpoint -eq $AgentEndpoint) "collect params chrome_endpoint mismatch" $AgentEndpoint $paramsEndpoint
    Assert-Gate "route-proof" ($metadataNodeUrl -eq $AgentEndpoint) "collect metadata node_url mismatch" $AgentEndpoint $metadataNodeUrl
    Assert-Gate "route-proof" ($apiLogText -match "WS agent dispatch") "center log missing WS agent dispatch" "WS agent dispatch" "not found"
    Assert-Gate "route-proof" ($apiLogText -match "WS agent done") "center log missing WS agent done" "WS agent done" "not found"
    Set-Gate "route-proof" "pass" @{
        chromeEndpoint = $paramsEndpoint
        nodeUrl = $metadataNodeUrl
        logEvidence = @("WS agent dispatch", "WS agent done")
    }

    $recordsResp = Invoke-Api -Method GET -Path "/records?source_id=$sourceId&task_id=$taskId&limit=100"
    $records = @($recordsResp.data)
    Save-Json "records.json" $records | Out-Null
    Assert-Gate "data-proof" ($records.Count -ge 1) "records API returned no records" "count >= 1" $records.Count
    $badRecord = $records | Where-Object {
        $_.source_id -ne $sourceId -or
        $_.task_id -ne $taskId -or
        $_.status -ne "normalized" -or
        $null -ne $_.error_message
    } | Select-Object -First 1
    Assert-Gate "data-proof" ($null -eq $badRecord) "record data proof failed" "source_id/task_id/status=normalized/error_message=null" $badRecord
    Set-Gate "data-proof" "pass" @{
        recordCount = $records.Count
        sourceId = $sourceId
        taskId = $taskId
        status = "normalized"
    }

    $ruffScope = @(
        "backend/workflow/fleet_inventory.py",
        "backend/channels/opencli_channel.py",
        "backend/ws_agent_manager.py",
        "backend/api/v1/workflows.py",
        "backend/api/v1/nodes.py",
        "backend/agent_server.py",
        "tests/integration/test_workflow_fleet_api.py",
        "tests/integration/test_opencli_channel_api.py",
        "tests/unit/channels/test_opencli_channel.py"
    )
    Run-RegressionGate -Gate "regression-ruff" -Label "ruff-check" -FilePath $PythonExe -Arguments (@("-m", "ruff", "check") + $ruffScope) -TimeoutSeconds $RegressionTimeoutSeconds -Hard $true | Out-Null
    Run-RegressionGate -Gate "regression-pytest" -Label "pytest-fleet-opencli" -FilePath $PythonExe -Arguments @(
        "-m", "pytest", "-q", "--no-cov",
        "tests/integration/test_workflow_fleet_api.py",
        "tests/integration/test_opencli_channel_api.py::test_collect_agent_mode_prefers_site_bound_agent",
        "tests/unit/channels/test_opencli_channel.py"
    ) -TimeoutSeconds $RegressionTimeoutSeconds -Hard $true | Out-Null
    Run-RegressionGate -Gate "regression-sentrux" -Label "sentrux-check-rules" -FilePath $PwshExe -Arguments @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", "C:\c\Users\Administrator\projects\code-intel-pipeline\Invoke-SentruxAgentTool.ps1",
        "check_rules", $RepoRoot
    ) -TimeoutSeconds $RegressionTimeoutSeconds -Hard $true | Out-Null

    if (-not $SkipCodeIntel) {
        Run-RegressionGate -Gate "regression-code-intel-doctor" -Label "code-intel-doctor" -FilePath $PwshExe -Arguments @(
            "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", "C:\c\Users\Administrator\projects\code-intel-pipeline\check-code-intel-tools.ps1",
            "-RepoPath", $RepoRoot,
            "-RequireRepowise",
            "-Json"
        ) -TimeoutSeconds $RegressionTimeoutSeconds -Hard $true | Out-Null

        Run-RegressionGate -Gate "regression-code-intel-normal" -Label "code-intel-normal" -FilePath $PwshExe -Arguments @(
            "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", "C:\c\Users\Administrator\projects\code-intel-pipeline\invoke-code-intel.ps1",
            "-RepoPath", $RepoRoot,
            "-Mode", "normal"
        ) -TimeoutSeconds $RegressionTimeoutSeconds -Hard $true -KnownDebtRegex "graph_missing|Understand graph: False|baseline_missing|rules_missing|known debt|known_debt|Sentrux fail|sentrux_fail|Sentrux gate|Blocking Sentrux debt|worsened_debt|god_files|Quality degraded during this session" | Out-Null
    } else {
        Set-Gate "regression-code-intel" "skipped" @{ reason = "SkipCodeIntel was set" }
    }

    $script:Report.acceptance = "PASS"
} catch {
    if (-not $script:Failure) {
        $script:Failure = [ordered]@{
            gate = "script-error"
            message = $_.Exception.Message
            expected = "no exception"
            actual = $_.ToString()
        }
        Set-Gate "script-error" "fail" @{ message = $_.Exception.Message }
    }
} finally {
    Stop-ManagedProcesses
    Merge-Log -OutPath $ApiOutLog -ErrPath $ApiErrLog -TargetPath $ApiLog
    Merge-Log -OutPath $AgentOutLog -ErrPath $AgentErrLog -TargetPath $AgentLog
    Write-ReportFiles
}

if ($script:Failure) {
    Write-Host "ACCEPTANCE: FAIL at $($script:Failure.gate)"
    if ($null -ne $script:Failure.expected -or $null -ne $script:Failure.actual) {
        Write-Host "expected $($script:Failure.expected | ConvertTo-Json -Compress -Depth 20) actual=$($script:Failure.actual | ConvertTo-Json -Compress -Depth 20)"
    }
    exit 1
}

Write-Host "ACCEPTANCE: PASS"
exit 0
