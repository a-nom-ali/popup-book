$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$studioNode = (Get-Command node.exe -ErrorAction Stop).Source
$studioVite = Join-Path $PSScriptRoot 'node_modules/vite/bin/vite.js'
if (-not (Test-Path -LiteralPath $studioVite)) {
  Write-Host 'Installing Fold Studio dependencies...'
  $studioNpm = Join-Path (Split-Path -Parent $studioNode) 'node_modules/npm/bin/npm-cli.js'
  if (-not (Test-Path -LiteralPath $studioNpm)) { throw 'npm was not found beside Node.js. Run npm ci in this folder, then start again.' }
  & $studioNode $studioNpm ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Write-Host 'Fold Studio: http://127.0.0.1:5173/'
Write-Host 'Keep this terminal running. Press Ctrl+C to stop.'
& $studioNode $studioVite --host 127.0.0.1 --port 5173 --strictPort
