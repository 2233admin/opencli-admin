# Stop III Python workers (engine + odp-ingest keep running).
. (Join-Path $PSScriptRoot "Import-IiiEnv.ps1")
Stop-IiiPythonWorkers
Write-Host "III Python workers stopped."