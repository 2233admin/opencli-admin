param([string]$Vault = 'D:\knowledge')

$ErrorActionPreference = 'Stop'
$obsidian = Join-Path $Vault '.obsidian'
$pluginsDir = Join-Path $obsidian 'plugins'
$enabled = Get-Content -Raw -LiteralPath (Join-Path $obsidian 'community-plugins.json') | ConvertFrom-Json
$headers = @{ 'User-Agent' = 'obsidian-plugin-recovery' }
$registry = Invoke-RestMethod -Headers $headers -Uri 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json'
$repos = @{}
foreach ($plugin in $registry) { $repos[$plugin.id] = $plugin.repo }

$restored = [System.Collections.Generic.List[string]]::new()
$failed = [System.Collections.Generic.List[string]]::new()

foreach ($id in $enabled) {
    $target = Join-Path $pluginsDir $id
    if ((Test-Path (Join-Path $target 'main.js')) -and (Test-Path (Join-Path $target 'manifest.json'))) {
        continue
    }
    if (-not $repos.ContainsKey($id)) {
        $failed.Add("${id}: not in official registry")
        continue
    }

    $temp = Join-Path ([IO.Path]::GetTempPath()) ("obsidian-plugin-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $temp | Out-Null
    try {
        $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$($repos[$id])/releases/latest"
        foreach ($name in @('manifest.json', 'main.js', 'styles.css')) {
            $asset = $release.assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
            if ($asset) {
                Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile (Join-Path $temp $name)
            }
        }
        $manifestPath = Join-Path $temp 'manifest.json'
        $mainPath = Join-Path $temp 'main.js'
        if (-not (Test-Path $manifestPath) -or -not (Test-Path $mainPath)) {
            throw 'release is missing manifest.json or main.js'
        }
        $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
        if ($manifest.id -ne $id) { throw "manifest id '$($manifest.id)' does not match '$id'" }

        New-Item -ItemType Directory -Force -Path $target | Out-Null
        foreach ($name in @('manifest.json', 'main.js', 'styles.css')) {
            $source = Join-Path $temp $name
            if (Test-Path $source) { Copy-Item -Force -LiteralPath $source -Destination (Join-Path $target $name) }
        }
        $restored.Add($id)
    } catch {
        $failed.Add("${id}: $($_.Exception.Message)")
    } finally {
        Remove-Item -Recurse -Force -LiteralPath $temp -ErrorAction SilentlyContinue
    }
}

Write-Output "RESTORED=$($restored.Count)"
$restored | ForEach-Object { Write-Output "  OK $_" }
Write-Output "FAILED=$($failed.Count)"
$failed | ForEach-Object { Write-Output "  FAIL $_" }
if ($failed.Count) { exit 1 }
