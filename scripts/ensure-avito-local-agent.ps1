$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$port = 3217
$logDir = Join-Path $repoRoot ".avito-local-agent"
$logPath = Join-Path $logDir "agent.log"
$errorLogPath = Join-Path $logDir "agent-error.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  "[$(Get-Date -Format o)] Avito local agent already listens on 127.0.0.1:$port" | Add-Content -Path $logPath
  exit 0
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
"[$(Get-Date -Format o)] Starting Avito local browser agent" | Add-Content -Path $logPath

Start-Process `
  -FilePath $npm `
  -ArgumentList @("run", "avito:local-browser-agent") `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errorLogPath
