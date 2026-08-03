$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $repoRoot ".flow-agent-package-build"
$distRoot = Join-Path $buildRoot "dist"
$downloadsRoot = Join-Path $repoRoot "public\downloads"
$zipPath = Join-Path $downloadsRoot "flow-agent.zip"
$runtimeRoot = Join-Path $repoRoot "scripts\flow-agent-runtime"

if (Test-Path -LiteralPath $buildRoot) {
  Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $distRoot, $downloadsRoot | Out-Null

Push-Location $repoRoot
try {
  & npx.cmd --no-install esbuild scripts/flow-local-agent.ts `
    --bundle `
    --platform=node `
    --format=cjs `
    --target=node20 `
    --outfile="$distRoot\flow-agent.cjs" `
    --external:playwright `
    --external:sharp
  if ($LASTEXITCODE -ne 0) { throw "esbuild failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$package = @{
  name = "crm-avito-flow-agent"
  version = "1.0.0"
  private = $true
  description = "Local Google Flow worker for CRM Avito Content Machine"
  main = "dist/flow-agent.cjs"
  scripts = @{ start = "node dist/flow-agent.cjs" }
  engines = @{ node = ">=20" }
  dependencies = [ordered]@{
    playwright = "1.61.1"
    sharp = "0.33.5"
  }
}
$package | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $buildRoot "package.json") -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $runtimeRoot "ensure-flow-agent.ps1") -Destination $buildRoot
Copy-Item -LiteralPath (Join-Path $runtimeRoot "uninstall-flow-agent.ps1") -Destination $buildRoot

Push-Location $buildRoot
try {
  & npm.cmd install --package-lock-only --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm package-lock generation failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $buildRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item -LiteralPath $buildRoot -Recurse -Force
Get-Item -LiteralPath $zipPath | Select-Object FullName, Length, LastWriteTime

