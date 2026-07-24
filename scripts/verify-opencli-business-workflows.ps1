param(
    [switch]$SkipBrowser,
    [switch]$SkipAuthorityProbes,
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$openCli = (Get-Command opencli.cmd -ErrorAction SilentlyContinue).Source
if (-not $openCli) {
    $openCli = (Get-Command opencli -ErrorAction SilentlyContinue).Source
}
if (-not $openCli) {
    throw "OpenCLI is not installed. Install @jackwener/opencli and run opencli doctor."
}

function ConvertFrom-OpenCLIJson {
    param([string]$Raw)

    # OpenCLI/Node can emit a warning containing "[UNDICI-EHPA]" before JSON.
    # Only accept an array/object token that starts a line and looks like JSON.
    $jsonMatch = [regex]::Match(
        $Raw,
        '(?m)^\s*(?:\[(?=\s*(?:\r?$|\{|\[|\]))|\{(?=\s*(?:\r?$|"|\{)))'
    )
    if (-not $jsonMatch.Success) {
        throw "OpenCLI returned no JSON payload"
    }
    return $Raw.Substring($jsonMatch.Index).Trim() | ConvertFrom-Json
}

function Invoke-OpenCLIProbe {
    param(
        [string]$Name,
        [string]$Category,
        [bool]$Required,
        [string[]]$CommandArgs
    )

    $startedAt = Get-Date
    $raw = ""
    $exitCode = -1
    try {
        $raw = (& $openCli @CommandArgs 2>&1 | Out-String).Trim()
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "OpenCLI exited with code $exitCode"
        }
        $payload = ConvertFrom-OpenCLIJson -Raw $raw
        $count = if ($payload -is [array]) { $payload.Count } elseif ($null -eq $payload) { 0 } else { 1 }
        return [pscustomobject]@{
            name = $Name
            category = $Category
            required = $Required
            status = if ($count -gt 0) { "completed" } else { "empty" }
            itemCount = $count
            durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
            exitCode = $exitCode
            command = "opencli " + ($CommandArgs -join " ")
            error = $null
        }
    }
    catch {
        return [pscustomobject]@{
            name = $Name
            category = $Category
            required = $Required
            status = "failed"
            itemCount = 0
            durationMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
            exitCode = $exitCode
            command = "opencli " + ($CommandArgs -join " ")
            error = $_.Exception.Message
        }
    }
}

$probes = @(
    @{ Name = "A股样本实时行情"; Category = "quotes"; Required = $true; Args = @("eastmoney", "quote", "600519,000001,300750", "-f", "json") },
    @{ Name = "上市公司财务摘要"; Category = "fundamentals"; Required = $true; Args = @("eastmoney", "bbsj-summary", "--code", "600519", "--limit", "3", "-f", "json") },
    @{ Name = "沪深京上市公司公告"; Category = "announcements"; Required = $true; Args = @("eastmoney", "announcement", "--market", "SHA,SZA,BJA", "--limit", "10", "-f", "json") },
    @{ Name = "财联社实时电报"; Category = "breaking-news"; Required = $true; Args = @("cls", "telegraph", "--limit", "10", "-f", "json") },
    @{ Name = "新浪财经新闻"; Category = "finance-news"; Required = $true; Args = @("sinafinance", "news", "--limit", "10", "-f", "json") }
)

if (-not $SkipBrowser) {
    $probes += @(
        @{ Name = "沪深 A 股行情全景"; Category = "market-breadth"; Required = $false; Args = @("eastmoney", "gridlist", "--market", "hs-a", "--sort", "turnover", "--limit", "10", "-f", "json") },
        @{ Name = "A股视频发现"; Category = "video-discovery"; Required = $false; Args = @("bilibili", "search", "A股 市场", "--limit", "5", "-f", "json") },
        @{ Name = "A股视频字幕"; Category = "video-transcript"; Required = $false; Args = @("bilibili", "subtitle", "BV1gDKB65EJA", "-f", "json") },
        @{ Name = "国际视频发现"; Category = "video-discovery"; Required = $false; Args = @("youtube", "search", "A股 market China stocks", "--limit", "5", "--upload", "week", "-f", "json") }
    )
}

if (-not $SkipAuthorityProbes) {
    $probes += @(
        @{ Name = "上交所公司目录健康探针"; Category = "authority-health"; Required = $false; Args = @("sse", "company-list", "--limit", "5", "-f", "json") },
        @{ Name = "深交所公司查询健康探针"; Category = "authority-health"; Required = $false; Args = @("szse", "query", "--keyword", "比亚迪", "--limit", "5", "-f", "json") },
        @{ Name = "巨潮公告健康探针"; Category = "authority-health"; Required = $false; Args = @("cninfo", "disclosure", "--symbol", "000001", "--limit", "5", "-f", "json") },
        @{ Name = "北交所公告健康探针"; Category = "authority-health"; Required = $false; Args = @("bse", "announcement", "--limit", "5", "-f", "json") }
    )
}

$results = foreach ($probe in $probes) {
    Invoke-OpenCLIProbe -Name $probe.Name -Category $probe.Category -Required $probe.Required -CommandArgs $probe.Args
}

$requiredFailures = @($results | Where-Object { $_.required -and $_.status -ne "completed" })
$report = [pscustomobject]@{
    schema = "opencli.business-workflow-smoke.v1"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    opencli = (& $openCli --version 2>&1 | Out-String).Trim()
    success = $requiredFailures.Count -eq 0
    summary = [pscustomobject]@{
        total = $results.Count
        completed = @($results | Where-Object status -eq "completed").Count
        empty = @($results | Where-Object status -eq "empty").Count
        failed = @($results | Where-Object status -eq "failed").Count
        requiredFailures = $requiredFailures.Count
    }
    probes = $results
}

$json = $report | ConvertTo-Json -Depth 8
if ($OutputPath) {
    $resolvedOutput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    $parent = Split-Path -Parent $resolvedOutput
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Set-Content -LiteralPath $resolvedOutput -Value $json -Encoding utf8
}
$json

if ($requiredFailures.Count -gt 0) {
    exit 1
}
