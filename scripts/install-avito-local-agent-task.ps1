param(
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$ensureScript = Join-Path $repoRoot "scripts\ensure-avito-local-agent.ps1"
$taskName = "CRM Avito Local Agent"
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ensureScript`""

$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

$installedAs = "scheduled task"
try {
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Starts the CRM Avito local browser agent for market analysis." `
    -Force | Out-Null
} catch {
  $installedAs = "current-user Run registry entry"
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  $runCommand = "`"$powershell`" $arguments"
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name $taskName -Value $runCommand -PropertyType String -Force | Out-Null
  Write-Warning "Scheduled task registration failed; installed HKCU Run fallback instead. $($_.Exception.Message)"
}

if (-not $NoStart) {
  & $ensureScript
}

Write-Host "Installed Avito local agent autostart as $installedAs`: $taskName"
