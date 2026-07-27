$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$ensureScript = Join-Path $repoRoot "scripts\ensure-flow-local-agent.ps1"
$taskName = "CRM Avito Flow Content Agent"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ensureScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Generates CRM content-machine images in Google Flow." -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Installed and started: $taskName"
