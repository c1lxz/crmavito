$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$ensureScript = Join-Path $repoRoot "scripts\ensure-flow-local-agent.ps1"
$taskName = "CRM Avito Flow Content Agent"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ensureScript`""
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
$installedAs = "scheduled task"
try {
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Generates CRM content-machine images in Google Flow." -Force | Out-Null
} catch {
  $installedAs = "current-user Run registry entry"
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name $taskName -Value "`"$powershell`" $arguments" -PropertyType String -Force | Out-Null
  Write-Warning "Scheduled task registration failed; installed HKCU Run fallback instead."
}
& $ensureScript
Write-Host "Installed and started as $installedAs`: $taskName"
