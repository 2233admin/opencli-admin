param(
    [Parameter(Mandatory = $true)]
    [string]$CentralApiUrl,
    [string]$ApiAuthToken = "",
    [string]$OhMyOpenCliRoot = "$env:LOCALAPPDATA\opencli-admin\OhMyOpenCLI"
)

$ErrorActionPreference = "Stop"
$OpenCliVersion = "1.8.5"
$OhMyOpenCliCommit = "8a087abe1805a9cff77b64ba80da12379afa184e"
$CapabilitySourceCommit = "35b146e675a51f013f293d12d303cfedfac58495"
$requestHeaders = @{}
if ($ApiAuthToken) {
    $requestHeaders = @{ Authorization = "Bearer $ApiAuthToken" }
}

foreach ($command in @("node", "npm", "git")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is required"
    }
}

npm install -g "@jackwener/opencli@$OpenCliVersion"
$patchPath = Join-Path $env:TEMP "opencli-admin-patch-opencli.js"
Invoke-WebRequest `
    -UseBasicParsing `
    -Uri "$($CentralApiUrl.TrimEnd('/'))/api/v1/nodes/install/patch-opencli.js" `
    -Headers $requestHeaders `
    -OutFile $patchPath
node $patchPath

if (Test-Path $OhMyOpenCliRoot) {
    throw "Target already exists; choose a new OhMyOpenCliRoot or archive it explicitly: $OhMyOpenCliRoot"
}
git clone https://github.com/2233admin/OhMyOpenCLI.git $OhMyOpenCliRoot
git -C $OhMyOpenCliRoot checkout --detach $OhMyOpenCliCommit
git -C $OhMyOpenCliRoot merge-base --is-ancestor $CapabilitySourceCommit HEAD
if ($LASTEXITCODE -ne 0) {
    throw "official-site capability source commit is absent from the pinned checkout"
}
Push-Location $OhMyOpenCliRoot
try {
    npm ci
    npm run bootstrap
} finally {
    Pop-Location
}

[Environment]::SetEnvironmentVariable(
    "OHMYOPENCLI_ROOT", $OhMyOpenCliRoot, "User"
)
Write-Output "Managed OpenCLI runtime installed. Start the Agent with an explicit OPENCLI_BROWSER_PROFILE_KIND."
