$ErrorActionPreference = "Stop"

$taskName = "CRM Avito Flow Content Agent"
$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$entryPoint = Join-Path $agentRoot "dist\flow-agent.cjs"

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -like "*$entryPoint*"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name $taskName -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CRMAvitoFlowAgent" -Recurse -Force -ErrorAction SilentlyContinue

$parent = Split-Path -Parent $agentRoot
$cleanup = Join-Path $env:TEMP "crm-avito-flow-agent-cleanup-$PID.ps1"
@"
Start-Sleep -Seconds 2
Remove-Item -LiteralPath '$agentRoot' -Recurse -Force -ErrorAction SilentlyContinue
if ((Test-Path -LiteralPath '$parent') -and -not (Get-ChildItem -LiteralPath '$parent' -Force -ErrorAction SilentlyContinue)) {
  Remove-Item -LiteralPath '$parent' -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath `$MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
"@ | Set-Content -LiteralPath $cleanup -Encoding UTF8
Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $cleanup) -WindowStyle Hidden
