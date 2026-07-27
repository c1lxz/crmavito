$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot ".flow-local-agent"
$logPath = Join-Path $logDir "agent.log"
$errorLogPath = Join-Path $logDir "agent-error.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$running = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*scripts/flow-local-agent.ts*" -and $_.ProcessId -ne $PID
}
if ($running) {
  "[$(Get-Date -Format o)] Flow local agent is already running." | Add-Content -Path $logPath
  exit 0
}

Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "content-machine:flow-agent") `
  -WorkingDirectory $repoRoot `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errorLogPath `
  -WindowStyle Hidden
