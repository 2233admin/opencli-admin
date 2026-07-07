<#
.SYNOPSIS
    一键拉起/放倒 opencli-admin「技能子系统」(record → distill → execute → correct,
    ADR-0003) 的人用开发面 —— 让没有 AI agent 编排的人在裸机 Windows 上也能跑通:
    headed CDP Chrome + 后端 API(用独立 dev SQLite,不碰生产库) + 可选前端 dock。

.DESCRIPTION
    做的事(按顺序):
      1. 前置检查(fail fast): uv / Ollama:11434 / qwen3:4b 模型 / Chrome-Edge 可执行文件。
      2. 起(或复用已在跑的) headed CDP Chrome,独立 profile,不碰你日常用的 Chrome。
      3. 起(或复用) 后端 API —— 指向独立 dev SQLite 库 + 本次起的 Chrome CDP 端点,
         健康轮询 GET /api/v1/skills 直到 200 或 60s 超时。
      4. -WithFrontend 时额外起前端 dock(默认不起)。
      5. 打印中文 cheatsheet:地址 + opencli-skill CLI 示例 + 录制三步流程。
      6. -Down 时按上次记录的 PID 优雅放倒本脚本自己起的组件(不碰别人的 Chrome/进程)。

    幂等:重复执行 up 会先探活(端口/健康检查),已在跑的组件直接复用并跳过,不会重复起。
    状态记录在 $env:TEMP\opencli-skill-stack.json,供 -Down 使用。

.PARAMETER CdpPort
    Chrome remote-debugging 端口。默认 9222。

.PARAMETER BackendPort
    后端 API 端口(uvicorn --port)。默认 8031。

.PARAMETER FrontendPort
    前端 dock(Vite)端口,仅 -WithFrontend 时使用。默认 8137。

.PARAMETER WithFrontend
    额外起前端 dock(frontend/,npm run dev)。默认不起 —— 技能录制/查看/执行都可以
    只用后端 + opencli-skill CLI 完成,dock 只是可选的可视化界面。

.PARAMETER AllowLocalProvider
    给后端进程设置 PROVIDER_URL_ALLOWLIST=127.0.0.1:11434,localhost:11434(commit
    f02a8b6 落地的 opt-in SSRF 白名单),让技能执行腿在调 provider 时能打本地 Ollama。
    不开这个开关时行为与现状完全一致(execute 腿打 127.0.0.1 会被 SSRF guard 拒绝)。

.PARAMETER RequiredModel
    前置检查要求 `ollama list` 里必须已有的模型。默认 qwen3:4b。脚本不会自动
    `ollama pull` —— 缺了只提示命令,由人手动拉,避免裸机上背着你下几个 GB。

.PARAMETER OllamaUrl
    Ollama 服务地址,仅用于前置检查连通性。默认 http://127.0.0.1:11434。

.PARAMETER Down
    放倒本脚本上次启动的组件(读 $env:TEMP\opencli-skill-stack.json 里记的 PID)。
    只按 PID + 进程名核对后才 taskkill /T /F,核对不上(比如 PID 被复用,或组件本来就
    不是本脚本起的)一律跳过不动,避免误杀别人的 Chrome/进程。幂等:没什么可放倒时
    直接报告并退出 0。

.EXAMPLE
    .\scripts\skill-dev-up.ps1
    只起 Chrome + 后端,不起前端。

.EXAMPLE
    .\scripts\skill-dev-up.ps1 -WithFrontend -AllowLocalProvider
    连前端 dock 一起起,并放开后端调本地 Ollama 的权限。

.EXAMPLE
    .\scripts\skill-dev-up.ps1 -Down
    放倒本脚本起的所有组件。
#>

[CmdletBinding()]
param(
    [int]$CdpPort = 9222,
    [int]$BackendPort = 8031,
    [int]$FrontendPort = 8137,
    [switch]$WithFrontend,
    [switch]$AllowLocalProvider,
    [switch]$Down,
    [string]$RequiredModel = "qwen3:4b",
    [string]$OllamaUrl = "http://127.0.0.1:11434"
)

$ErrorActionPreference = "Stop"

$RepoRoot       = Split-Path -Parent $PSScriptRoot
$StateFile      = Join-Path $env:TEMP "opencli-skill-stack.json"
$ChromeProfile  = Join-Path $env:TEMP "opencli-skill-chrome"
$BackendLog     = Join-Path $env:TEMP "opencli-skill-backend.out.log"
$BackendErrLog  = Join-Path $env:TEMP "opencli-skill-backend.err.log"
$FrontendLog    = Join-Path $env:TEMP "opencli-skill-frontend.out.log"
$FrontendErrLog = Join-Path $env:TEMP "opencli-skill-frontend.err.log"
$DevDbPath      = (Join-Path $RepoRoot "opencli_admin_dev.db") -replace '\\', '/'
$DatabaseUrl    = "sqlite+aiosqlite:///$DevDbPath"

# ── 输出小工具 ────────────────────────────────────────────────────────────────
function Write-Info { param([string]$Msg) Write-Host "[信息] $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "[ 好 ] $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[提醒] $Msg" -ForegroundColor Yellow }
function Write-Die  { param([string]$Msg) Write-Host "[失败] $Msg" -ForegroundColor Red; exit 1 }

# ── 状态文件读写 ──────────────────────────────────────────────────────────────
function Get-StackState {
    if (Test-Path $StateFile) {
        try { return Get-Content $StateFile -Raw | ConvertFrom-Json } catch { return [pscustomobject]@{} }
    }
    return [pscustomobject]@{}
}
function Save-StackState {
    param($State)
    $State | ConvertTo-Json -Depth 6 | Set-Content -Path $StateFile -Encoding utf8
}

# ── 进程 / 端口 / HTTP 探活 ───────────────────────────────────────────────────
function Test-ProcAlive {
    param([Nullable[int]]$ProcId, [string]$NameLike = "")
    if (-not $ProcId) { return $false }
    $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    if ($NameLike -and ($p.ProcessName -notmatch $NameLike)) { return $false }
    return $true
}

function Test-PortListening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-HttpOk {
    param([string]$Url, [int]$TimeoutSec = 3)
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

# 按记录的 PID + 进程名核对后再杀整棵进程树;核对不上一律跳过,不误杀。
function Stop-Tracked {
    param($Entry, [string]$Label)
    if (-not $Entry -or -not $Entry.pid) {
        Write-Host "  [ - ] ${Label}: 没有记录,跳过"
        return $false
    }
    if ($Entry.managed -eq $false) {
        Write-Warn "${Label} (pid=$($Entry.pid)) 不是本脚本启动/托管的,跳过不动"
        return $false
    }
    $proc = Get-Process -Id $Entry.pid -ErrorAction SilentlyContinue
    if (-not $proc) {
        Write-Host "  [ - ] ${Label} (pid=$($Entry.pid)) 已经不在跑了"
        return $false
    }
    if ($Entry.processNameLike -and ($proc.ProcessName -notmatch $Entry.processNameLike)) {
        Write-Warn "${Label} (pid=$($Entry.pid)) 进程名对不上预期(可能 PID 被复用给了别的进程),为安全起见不动它"
        return $false
    }
    & taskkill /PID $Entry.pid /T /F 2>&1 | Out-Null
    Write-Ok "${Label} 已停止 (pid=$($Entry.pid))"
    return $true
}

# ── 找 Chrome / Edge 可执行文件(注册表优先,常见路径兜底) ──────────────────────
function Find-Chrome {
    $regPaths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe'
    )
    foreach ($regPath in $regPaths) {
        $v = $null
        try { $v = Get-ItemPropertyValue -Path $regPath -Name '(default)' -ErrorAction SilentlyContinue } catch {}
        if ($v -and (Test-Path $v)) { return $v }
    }
    $pathCandidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $pathCandidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

# ════════════════════════════════════════════════════════════════════════════
# -Down:放倒本脚本起的组件
# ════════════════════════════════════════════════════════════════════════════
if ($Down) {
    Write-Host ""
    Write-Host "== 放倒 skill 开发栈 ==" -ForegroundColor Cyan
    $state = Get-StackState
    $stoppedAny = $false
    if (Stop-Tracked -Entry $state.frontend -Label "前端 dock")  { $stoppedAny = $true }
    if (Stop-Tracked -Entry $state.backend  -Label "后端 API")   { $stoppedAny = $true }
    if (Stop-Tracked -Entry $state.chrome   -Label "Chrome CDP") { $stoppedAny = $true }

    if (Test-Path $StateFile) { Remove-Item $StateFile -Force }

    Start-Sleep -Milliseconds 500
    Write-Host ""
    Write-Host "端口检查:"
    foreach ($portInfo in @(
        @{ Name = "Chrome CDP"; Port = $CdpPort },
        @{ Name = "后端 API";   Port = $BackendPort },
        @{ Name = "前端 dock";  Port = $FrontendPort }
    )) {
        if (Test-PortListening $portInfo.Port) {
            Write-Warn "  $($portInfo.Name) :$($portInfo.Port) 仍被占用(可能是本脚本没记录到的进程)"
        } else {
            Write-Ok   "  $($portInfo.Name) :$($portInfo.Port) 已释放"
        }
    }

    Write-Host ""
    if ($stoppedAny) {
        Write-Ok "放倒完成。"
    } else {
        Write-Ok "没有记录在跑的组件 —— 幂等空操作,视为已经放倒。"
    }
    exit 0
}

# ════════════════════════════════════════════════════════════════════════════
# 前置检查
# ════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "== 前置检查 ==" -ForegroundColor Cyan
$prereqOk = $true

$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if ($uvCmd) {
    Write-Ok "uv 已装: $($uvCmd.Source)"
} else {
    Write-Warn "缺 uv —— 装法: winget install --id astral-sh.uv  (或看 https://docs.astral.sh/uv/getting-started/installation/)"
    $prereqOk = $false
}

$ollamaReachable = Test-HttpOk -Url "$OllamaUrl/" -TimeoutSec 2
if ($ollamaReachable) {
    Write-Ok "Ollama 可达: $OllamaUrl"
} else {
    Write-Warn "Ollama 不可达($OllamaUrl) —— 先跑: ollama serve"
    $prereqOk = $false
}

if ($ollamaReachable) {
    $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollamaCmd) {
        Write-Warn "Ollama 服务可达,但本机 PATH 里没有 ollama CLI —— 装: https://ollama.com/download"
        $prereqOk = $false
    } else {
        $modelList = (& ollama list 2>&1 | Out-String)
        if ($modelList -match [regex]::Escape($RequiredModel)) {
            Write-Ok "模型就绪: $RequiredModel"
        } else {
            Write-Warn "缺模型 $RequiredModel —— 先跑: ollama pull $RequiredModel  (脚本不会自动拉,体积较大)"
            $prereqOk = $false
        }
    }
} else {
    Write-Warn "(跳过模型检查 —— 先修好 Ollama 连通性)"
}

$chromeBin = Find-Chrome
if ($chromeBin) {
    Write-Ok "找到浏览器: $chromeBin"
} else {
    Write-Warn "找不到 Chrome/Edge 可执行文件 —— 装 Chrome: https://www.google.com/chrome/  或确认 Edge 安装完整"
    $prereqOk = $false
}

if (-not $prereqOk) {
    Write-Host ""
    Write-Die "前置检查未通过 —— 按上面 [提醒] 逐条修好后重跑。"
}
Write-Host ""

# ════════════════════════════════════════════════════════════════════════════
# 起服务(每个组件:先探活复用,没有才新起)
# ════════════════════════════════════════════════════════════════════════════
$PrevState = Get-StackState

function Start-OrReuse-Chrome {
    $cdpUrl = "http://127.0.0.1:$CdpPort/json/version"
    if (Test-HttpOk -Url $cdpUrl -TimeoutSec 2) {
        $prevPid = $PrevState.chrome.pid
        $managed = Test-ProcAlive -ProcId $prevPid -NameLike 'chrome'
        Write-Ok "Chrome CDP :$CdpPort 已在跑,复用(不重复起)"
        return [pscustomobject]@{ pid = $prevPid; managed = [bool]$managed; port = $CdpPort; processNameLike = 'chrome' }
    }

    if (-not $chromeBin) { Write-Die "找不到 Chrome/Edge,无法启动(前置检查阶段应该已经拦下,不该走到这里)" }

    New-Item -ItemType Directory -Force -Path $ChromeProfile | Out-Null
    # 清掉上次崩溃/强杀留下的锁文件(参考 start.sh 同样的处理)
    Get-ChildItem -Path $ChromeProfile -Filter "Singleton*" -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Write-Info "起 Chrome (headed, CDP :$CdpPort, profile=$ChromeProfile)..."
    $chromeArgs = @(
        "--remote-debugging-port=$CdpPort",
        "--remote-debugging-address=127.0.0.1",
        "--remote-allow-origins=*",
        "--user-data-dir=$ChromeProfile",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank"
    )
    $proc = Start-Process -FilePath $chromeBin -ArgumentList $chromeArgs -PassThru

    $deadline = (Get-Date).AddSeconds(20)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpOk -Url $cdpUrl -TimeoutSec 2) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        Write-Die "Chrome 起了(pid=$($proc.Id))但 CDP :$CdpPort 20s 内没响应 —— 检查 $ChromeProfile 下是否有残留锁文件,或该端口被其它程序占用。"
    }
    Write-Ok "Chrome CDP 就绪 (pid=$($proc.Id))"
    return [pscustomobject]@{ pid = $proc.Id; managed = $true; port = $CdpPort; processNameLike = 'chrome' }
}

function Start-OrReuse-Backend {
    param([string]$CdpEndpoint)
    $healthUrl = "http://127.0.0.1:$BackendPort/api/v1/skills"

    if (Test-HttpOk -Url $healthUrl -TimeoutSec 3) {
        $prevPid = $PrevState.backend.pid
        $managed = Test-ProcAlive -ProcId $prevPid -NameLike 'uv|python'
        Write-Ok "后端 :$BackendPort 已在跑且健康,复用(不重复起)"
        return [pscustomobject]@{ pid = $prevPid; managed = [bool]$managed; port = $BackendPort; processNameLike = 'uv|python' }
    }

    if (Test-PortListening $BackendPort) {
        Write-Die "端口 $BackendPort 被占用,但 GET /api/v1/skills 没有正常响应 —— 换个 -BackendPort,或先手动结束占用该端口的进程。"
    }

    $uvExe = (Get-Command uv -ErrorAction Stop).Source

    # 进程级 env(仅这次 Start-Process 的子进程可见,不污染当前会话之外的任何东西):
    #   DATABASE_URL          → 独立 dev SQLite,覆盖 .env 里的 docker 路径
    #   OPENCLI_CDP_ENDPOINT  → 本次起的 Chrome,覆盖 .env 里的 docker 主机名 agent-1:19222
    #   PROVIDER_URL_ALLOWLIST → 仅 -AllowLocalProvider 时设置(f02a8b6)
    $env:DATABASE_URL = $DatabaseUrl
    $env:OPENCLI_CDP_ENDPOINT = $CdpEndpoint
    if ($AllowLocalProvider) {
        $env:PROVIDER_URL_ALLOWLIST = "127.0.0.1:11434,localhost:11434"
    } else {
        Remove-Item Env:\PROVIDER_URL_ALLOWLIST -ErrorAction SilentlyContinue
    }

    Write-Info "起后端 (uv run --directory `"$RepoRoot`" uvicorn backend.main:app --host 127.0.0.1 --port $BackendPort)..."
    Write-Info "  DATABASE_URL=$DatabaseUrl"
    Write-Info "  OPENCLI_CDP_ENDPOINT=$CdpEndpoint"
    if ($AllowLocalProvider) { Write-Info "  PROVIDER_URL_ALLOWLIST=127.0.0.1:11434,localhost:11434" }
    Remove-Item $BackendLog, $BackendErrLog -ErrorAction SilentlyContinue

    $proc = Start-Process -FilePath $uvExe `
        -ArgumentList @("run", "--directory", $RepoRoot, "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", $BackendPort) `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendErrLog `
        -PassThru

    $deadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpOk -Url $healthUrl -TimeoutSec 2) { $healthy = $true; break }
        if (-not (Test-ProcAlive -ProcId $proc.Id)) { break }
        Start-Sleep -Milliseconds 1000
    }

    if (-not $healthy) {
        Write-Warn "后端 60s 内没通过健康检查(GET $healthUrl)。日志尾巴:"
        Write-Host "--- $BackendErrLog ---"
        Get-Content $BackendErrLog -Tail 40 -ErrorAction SilentlyContinue | Write-Host
        Write-Host "--- $BackendLog ---"
        Get-Content $BackendLog -Tail 40 -ErrorAction SilentlyContinue | Write-Host
        Stop-Tracked -Entry ([pscustomobject]@{ pid = $proc.Id; managed = $true; processNameLike = 'uv|python' }) -Label "后端(启动失败清理)" | Out-Null
        Write-Die "后端启动失败,已清理进程,见上面日志尾巴。"
    }

    Write-Ok "后端健康 (pid=$($proc.Id), GET /api/v1/skills → 200)"
    return [pscustomobject]@{ pid = $proc.Id; managed = $true; port = $BackendPort; processNameLike = 'uv|python' }
}

function Start-OrReuse-Frontend {
    if (Test-PortListening $FrontendPort) {
        Write-Ok "前端 :$FrontendPort 端口已被占用,当作已在跑,复用(不重复起)"
        $prevPid = $PrevState.frontend.pid
        $managed = Test-ProcAlive -ProcId $prevPid -NameLike 'cmd|node'
        return [pscustomobject]@{ pid = $prevPid; managed = [bool]$managed; port = $FrontendPort; processNameLike = 'cmd|node' }
    }

    $frontendDir = Join-Path $RepoRoot "frontend"
    Write-Info "起前端 dock (npm --prefix frontend run dev -- --port $FrontendPort --strictPort)..."
    Remove-Item $FrontendLog, $FrontendErrLog -ErrorAction SilentlyContinue

    $proc = Start-Process -FilePath $env:ComSpec `
        -ArgumentList @("/c", "npm", "--prefix", $frontendDir, "run", "dev", "--", "--port", $FrontendPort, "--strictPort") `
        -WorkingDirectory $RepoRoot `
        -RedirectStandardOutput $FrontendLog -RedirectStandardError $FrontendErrLog `
        -PassThru

    Start-Sleep -Seconds 2
    if (-not (Test-ProcAlive -ProcId $proc.Id)) {
        Write-Warn "前端进程很快退出了,看日志: $FrontendLog / $FrontendErrLog"
    } else {
        Write-Ok "前端已在后台启动 (pid=$($proc.Id)) —— Vite 首次编译还要再等几秒"
    }
    return [pscustomobject]@{ pid = $proc.Id; managed = $true; port = $FrontendPort; processNameLike = 'cmd|node' }
}

Write-Host "== 起服务 ==" -ForegroundColor Cyan
$chromeInfo  = Start-OrReuse-Chrome
$cdpEndpoint = "http://127.0.0.1:$CdpPort"
$backendInfo = Start-OrReuse-Backend -CdpEndpoint $cdpEndpoint

if ($WithFrontend) {
    $frontendInfo = Start-OrReuse-Frontend
} else {
    # 这次没让起前端,但如果上次起了(还在跑),继续把记录带下去,别让 -Down 找不到它。
    $frontendInfo = $PrevState.frontend
}

Save-StackState ([pscustomobject]@{
    chrome    = $chromeInfo
    backend   = $backendInfo
    frontend  = $frontendInfo
    updatedAt = (Get-Date).ToString("o")
})

# ════════════════════════════════════════════════════════════════════════════
# Cheatsheet
# ════════════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "== 都起来了 ==" -ForegroundColor Cyan
Write-Host "  后端 API 文档  →  http://127.0.0.1:$BackendPort/docs"
Write-Host "  Chrome CDP     →  http://127.0.0.1:$CdpPort  (headed 窗口,人在这里做 demo)"
if ($frontendInfo -and $frontendInfo.pid) {
    Write-Host "  Dock 界面      →  http://127.0.0.1:$FrontendPort"
}
Write-Host ""
Write-Host "opencli-skill CLI 示例:"
Write-Host "  uv run --directory `"$RepoRoot`" opencli-skill list"
Write-Host "  uv run --directory `"$RepoRoot`" opencli-skill record --domain example.com --capability open-list"
Write-Host "  uv run --directory `"$RepoRoot`" opencli-skill show <skill_id>"
Write-Host ""
Write-Host "录制流程三步(record 子命令内置的向导):"
Write-Host "  1) 跑上面的 record 命令 → 在弹出的 Chrome 窗口里手工演示一遍要学的操作"
Write-Host "  2) 演示完,回到终端按 Enter"
Write-Host "  3) 依次回答两个确认: 标记成功? [Y/n] → y ;  蒸馏成 skill? [Y/n] → y"
Write-Host ""
Write-Host "执行腿示例(要让 provider 打本地 Ollama,本次需带 -AllowLocalProvider 起):"
Write-Host "  对某个 channel_type=skill 的数据源触发一次采集/连通性测试:"
Write-Host "  POST http://127.0.0.1:$BackendPort/api/v1/sources/{source_id}/test"
if (-not $AllowLocalProvider) {
    Write-Host "  (当前这次没带 -AllowLocalProvider —— provider 打 127.0.0.1 会被 SSRF guard 拒绝)"
}
Write-Host ""
Write-Host "放倒:  .\scripts\skill-dev-up.ps1 -Down"
Write-Host ""
