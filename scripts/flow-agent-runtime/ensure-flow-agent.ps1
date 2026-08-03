$ErrorActionPreference = "Stop"

$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateRoot = Join-Path $agentRoot "state"
$logRoot = Join-Path $agentRoot "logs"
$logPath = Join-Path $logRoot "agent.log"
$errorLogPath = Join-Path $logRoot "agent-error.log"
$entryPoint = Join-Path $agentRoot "dist\flow-agent.cjs"

New-Item -ItemType Directory -Force -Path $stateRoot, $logRoot | Out-Null

if (-not (Test-Path -LiteralPath $entryPoint)) {
  throw "Flow agent entry point was not found: $entryPoint"
}

$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*$entryPoint*"
}
if ($running) {
  "[$(Get-Date -Format o)] Flow local agent is already running." | Add-Content -Path $logPath
  exit 0
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$environment = @{
  FLOW_AGENT_STATE_DIR = $stateRoot
  FLOW_AGENT_PROFILE_DIR = (Join-Path $stateRoot "chrome-profile")
}
foreach ($item in $environment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($item.Key, $item.Value, "Process")
}

Start-Process -FilePath $node `
  -ArgumentList "`"$entryPoint`"" `
  -WorkingDirectory $agentRoot `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errorLogPath `
  -WindowStyle Hidden
