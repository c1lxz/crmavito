$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot ".flow-local-agent"
$logPath = Join-Path $logDir "agent.log"
$errorLogPath = Join-Path $logDir "agent-error.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if ($env:COMPUTERNAME -eq "DESKTOP-1QUOHBP") {
  $flowShortcutScript = "C:\Users\c1lxz\Documents\Codex\2026-07-27\new-chat\work\start_google_flow_proxy.ps1"
  $debugListening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue
  if (-not $debugListening -and (Test-Path -LiteralPath $flowShortcutScript)) {
    Start-Process -FilePath "powershell.exe" `
      -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $flowShortcutScript) `
      -WindowStyle Hidden
    Start-Sleep -Seconds 3
  }
}

$running = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*scripts/flow-local-agent.ts*"
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
