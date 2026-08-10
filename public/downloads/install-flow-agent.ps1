$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$installerLog = if ($env:FLOW_AGENT_INSTALLER_LOG) {
  $env:FLOW_AGENT_INSTALLER_LOG
} else {
  Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "CRM Avito\Flow Agent Installer\powershell.log"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installerLog) | Out-Null
Start-Transcript -LiteralPath $installerLog -Force | Out-Null

$taskName = "CRM Avito Flow Content Agent"
$productName = "CRM Avito Flow Agent"
$installRoot = if ($env:FLOW_AGENT_INSTALL_DIR) {
  [IO.Path]::GetFullPath($env:FLOW_AGENT_INSTALL_DIR)
} else {
  Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "CRM Avito\Flow Agent"
}
$localAppData = [IO.Path]::GetFullPath([Environment]::GetFolderPath("LocalApplicationData")).TrimEnd("\") + "\"
$isTestInstall = [bool]$env:FLOW_AGENT_INSTALL_DIR
if (-not $isTestInstall -and -not $installRoot.StartsWith($localAppData, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Каталог установки должен находиться внутри LocalAppData."
}
Remove-Item -LiteralPath (Join-Path $installRoot "install-result.json") -Force -ErrorAction SilentlyContinue

function Read-EnvValue([string]$path, [string]$name) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $line = Get-Content -LiteralPath $path -Encoding UTF8 | Where-Object { $_ -match "^$([regex]::Escape($name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^[^=]+=", "").Trim().Trim('"').Trim("'")
}

function Find-LocalEnvValue([string]$name) {
  $candidates = @(
    (Join-Path $PWD ".env.local"),
    "C:\crmavito\.env.local",
    (Join-Path $installRoot ".env.local")
  ) | Select-Object -Unique
  foreach ($candidate in $candidates) {
    $value = Read-EnvValue $candidate $name
    if ($value) { return $value }
  }
  return $null
}

$node = Get-Command node.exe -ErrorAction SilentlyContinue
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  throw "Не найден Node.js 20+. Установите Node.js LTS с nodejs.org и повторите установку."
}
$nodeMajor = [int]((& $node.Source --version).Trim().TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) { throw "Нужен Node.js 20 или новее. Сейчас установлен Node.js $nodeMajor." }

$chromeCandidates = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $chromeCandidates) { throw "Не найден Google Chrome. Установите Chrome и повторите установку." }

$crmUrl = if ($env:FLOW_AGENT_CRM_URL) { $env:FLOW_AGENT_CRM_URL.Trim().TrimEnd("/") } else { "https://crmavito.duckdns.org" }
if ($crmUrl -notmatch '^https?://') { throw "Адрес CRM должен начинаться с https:// или http://." }
$enrollmentCode = if ($env:FLOW_AGENT_ENROLLMENT_CODE) { $env:FLOW_AGENT_ENROLLMENT_CODE.Trim() } else { "" }
$token = if ($enrollmentCode) { "" } elseif ($env:FLOW_LOCAL_AGENT_TOKEN) { $env:FLOW_LOCAL_AGENT_TOKEN.Trim() } else { Find-LocalEnvValue "FLOW_LOCAL_AGENT_TOKEN" }
if (-not $token) {
  if (-not $enrollmentCode) { throw "Получите одноразовый код в Контент-машине и введите его в установщике." }
  try {
    $enrollment = Invoke-RestMethod -Method Post -Uri "$crmUrl/api/ai/content-machine/flow-agent/enroll" -ContentType "application/json" -Body (@{
      code = $enrollmentCode
      agentId = $env:COMPUTERNAME
    } | ConvertTo-Json -Compress)
    $token = [string]$enrollment.token
  } catch {
    throw "Не удалось привязать этот ПК. Проверьте код подключения и получите новый при необходимости. $($_.Exception.Message)"
  }
  if (-not $token) { throw "CRM не вернула ключ локального агента." }
}

$qaEnvironment = @()
foreach ($name in @("GEMINI_API_KEY", "GEMINI_QA_MODEL", "GEMINI_QA_FALLBACK_MODEL", "GEMINI_DESIGN_MODEL", "GEMINI_DESIGN_FALLBACK_MODEL", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL")) {
  $processValue = [Environment]::GetEnvironmentVariable($name, "Process")
  $value = if ($processValue) { $processValue.Trim() } else { Find-LocalEnvValue $name }
  if ($value) { $qaEnvironment += "$name=$value" }
}

$packagePath = $env:FLOW_AGENT_PACKAGE_PATH
$tempRoot = Join-Path $env:TEMP ("crm-avito-flow-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempRoot, $installRoot | Out-Null
try {
  if (-not $packagePath -or -not (Test-Path -LiteralPath $packagePath)) {
    $packagePath = Join-Path $tempRoot "flow-agent.zip"
    Invoke-WebRequest -Uri "$crmUrl/downloads/flow-agent.zip" -OutFile $packagePath -UseBasicParsing
  }

  $stageRoot = Join-Path $tempRoot "package"
  Expand-Archive -LiteralPath $packagePath -DestinationPath $stageRoot -Force
  if (-not (Test-Path -LiteralPath (Join-Path $stageRoot "dist\flow-agent.cjs"))) {
    throw "Пакет Flow-агента повреждён: отсутствует dist\flow-agent.cjs."
  }

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like "*$installRoot*flow-agent.cjs*"
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $profileRoot = Join-Path $installRoot "state\chrome-profile"
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "chrome.exe" -and $_.CommandLine -like "*$profileRoot*"
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  Copy-Item -Path (Join-Path $stageRoot "*") -Destination $installRoot -Recurse -Force
  $agentEnvironment = @(
    "FLOW_AGENT_CRM_URL=$crmUrl",
    "FLOW_LOCAL_AGENT_TOKEN=$token",
    "FLOW_AGENT_CONCURRENCY=1",
    "FLOW_AGENT_CDP_URL=http://127.0.0.1:9223",
    "FLOW_AGENT_CDP_BOOTSTRAP_SCRIPT=`"$(Join-Path $installRoot 'start-flow-chrome.ps1')`"",
    "FLOW_AGENT_PROFILE_DIR=`"$(Join-Path $installRoot 'state\chrome-profile')`""
  ) + $qaEnvironment
  $agentEnvironment | Set-Content -LiteralPath (Join-Path $installRoot ".env.local") -Encoding UTF8

  Push-Location $installRoot
  try {
    & $npm.Source install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install завершился с кодом $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  $ensureScript = Join-Path $installRoot "ensure-flow-agent.ps1"
  $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ensureScript`""
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $installRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
  $installedAs = "scheduled-task"
  try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Generates CRM content-machine images in Google Flow." -Force | Out-Null
    Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name $taskName -ErrorAction SilentlyContinue
  } catch {
    $installedAs = "current-user-run"
    $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    New-Item -Path $runKey -Force | Out-Null
    New-ItemProperty -Path $runKey -Name $taskName -Value "`"$powershell`" $arguments" -PropertyType String -Force | Out-Null
  }

  $uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CRMAvitoFlowAgent"
  New-Item -Path $uninstallKey -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name DisplayName -Value $productName -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name DisplayVersion -Value "1.0.0" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name Publisher -Value "CRM Avito" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name InstallLocation -Value $installRoot -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $uninstallKey -Name UninstallString -Value "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $installRoot 'uninstall-flow-agent.ps1')`"" -PropertyType String -Force | Out-Null

  & $ensureScript
  & (Join-Path $installRoot "start-flow-chrome.ps1")
  Start-Sleep -Seconds 2
  $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq "node.exe" -and $_.CommandLine -like "*$installRoot*flow-agent.cjs*"
  }
  if (-not $running) {
    $errorLog = Join-Path $installRoot "logs\agent-error.log"
    $details = if (Test-Path -LiteralPath $errorLog) { Get-Content -LiteralPath $errorLog -Raw -ErrorAction SilentlyContinue } else { "" }
    throw "Агент установлен, но не запустился. $details"
  }

  [ordered]@{
    installedAt = (Get-Date).ToString("o")
    installRoot = $installRoot
    crmUrl = $crmUrl
    taskName = $taskName
    autostart = $installedAs
    processId = $running.ProcessId | Select-Object -First 1
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installRoot "install-result.json") -Encoding UTF8
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Output "FLOW_AGENT_INSTALL_OK"
Stop-Transcript | Out-Null
