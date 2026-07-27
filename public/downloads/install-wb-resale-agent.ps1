$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class InstallerConsole {
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
"@
$agentUrl = if ($env:WBR_AGENT_PACKAGE) {
  $env:WBR_AGENT_PACKAGE
} else {
  "https://crmavito.duckdns.org/downloads/wb-resale-agent.zip"
}
$desktop = [Environment]::GetFolderPath("Desktop")
$tempDir = Join-Path $env:TEMP ("wb-resale-agent-" + [Guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempDir "wb-resale-agent.zip"
$stageDir = Join-Path $tempDir "package"
$crmDir = Join-Path $desktop "WB Resale CRM"
$rpaDir = Join-Path $desktop "WB Resale RPA"
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "WB Resale Agent.lnk"
$headless = $env:WBR_HEADLESS -eq "1"
$installFailed = $false

$form = New-Object Windows.Forms.Form
$form.Text = "WB Resale Agent"
$form.Size = New-Object Drawing.Size(560, 270)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [Drawing.Color]::FromArgb(247, 248, 250)

$title = New-Object Windows.Forms.Label
$title.Text = "Установка WB Resale Agent"
$title.Font = New-Object Drawing.Font("Segoe UI", 16, [Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object Drawing.Point(28, 25)
$form.Controls.Add($title)

$status = New-Object Windows.Forms.Label
$status.Text = "Подготовка..."
$status.Font = New-Object Drawing.Font("Segoe UI", 10)
$status.AutoSize = $false
$status.Size = New-Object Drawing.Size(490, 45)
$status.Location = New-Object Drawing.Point(30, 78)
$form.Controls.Add($status)

$progress = New-Object Windows.Forms.ProgressBar
$progress.Minimum = 0
$progress.Maximum = 100
$progress.Value = 0
$progress.Style = "Continuous"
$progress.Size = New-Object Drawing.Size(490, 18)
$progress.Location = New-Object Drawing.Point(30, 132)
$form.Controls.Add($progress)

$closeButton = New-Object Windows.Forms.Button
$closeButton.Text = "Закрыть"
$closeButton.Enabled = $false
$closeButton.Size = New-Object Drawing.Size(110, 34)
$closeButton.Location = New-Object Drawing.Point(410, 176)
$closeButton.Add_Click({ $form.Close() })
$form.Controls.Add($closeButton)

function Set-Progress([int]$value, [string]$message) {
  $progress.Value = [Math]::Max(0, [Math]::Min(100, $value))
  $status.Text = $message
  $form.Refresh()
  [Windows.Forms.Application]::DoEvents()
}

function Test-Command([string]$name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

if (-not $headless) {
  $form.Show()
}

try {
  New-Item -ItemType Directory -Force -Path $tempDir, $stageDir | Out-Null

  Set-Progress 8 "Проверяю Node.js..."
  if (-not (Test-Command "node")) {
    if (-not (Test-Command "winget")) {
      throw "Не найден Node.js. Установите Node.js LTS с nodejs.org и запустите установщик снова."
    }
    Set-Progress 15 "Устанавливаю Node.js LTS..."
    $nodeInstall = Start-Process -FilePath "winget.exe" -ArgumentList @(
      "install", "OpenJS.NodeJS.LTS", "--silent",
      "--accept-source-agreements", "--accept-package-agreements"
    ) -Wait -PassThru -WindowStyle Hidden
    if ($nodeInstall.ExitCode -ne 0) {
      throw "Не удалось установить Node.js (код $($nodeInstall.ExitCode))."
    }
    Refresh-Path
  }

  Set-Progress 28 "Скачиваю свежую версию агента..."
  if (Test-Path -LiteralPath $agentUrl) {
    Copy-Item -LiteralPath $agentUrl -Destination $zipPath -Force
  } else {
    $downloadError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
        Invoke-WebRequest -Uri $agentUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 90
        $downloadError = $null
        break
      } catch {
        $downloadError = $_.Exception.Message
        if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
      }
    }
    if ($downloadError) {
      throw "Не удалось скачать агент после трёх попыток: $downloadError"
    }
  }

  Set-Progress 42 "Распаковываю файлы..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $stageDir -Force
  $newCrmDir = Join-Path $stageDir "WB Resale CRM"
  $newRpaDir = Join-Path $stageDir "WB Resale RPA"
  if (-not (Test-Path (Join-Path $newCrmDir "server.js"))) {
    throw "В пакете отсутствует WB Resale CRM."
  }
  if (-not (Test-Path (Join-Path $newRpaDir "package.json"))) {
    throw "В пакете отсутствует WB Resale RPA."
  }

  Set-Progress 55 "Обновляю программу без удаления ваших данных и входа WB..."
  New-Item -ItemType Directory -Force -Path $crmDir, $rpaDir | Out-Null
  Copy-Item -Path (Join-Path $newCrmDir "*") -Destination $crmDir -Recurse -Force
  Copy-Item -Path (Join-Path $newRpaDir "*") -Destination $rpaDir -Recurse -Force

  Set-Progress 70 "Устанавливаю компоненты агента..."
  $npm = (Get-Command "npm.cmd" -ErrorAction SilentlyContinue).Source
  if (-not $npm) { $npm = (Get-Command "npm" -ErrorAction Stop).Source }
  $npmExitCode = -1
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $npmProcess = Start-Process -FilePath $npm -ArgumentList @("install", "--omit=dev", "--no-audit", "--no-fund") -WorkingDirectory $rpaDir -Wait -PassThru -WindowStyle Hidden
    $npmExitCode = $npmProcess.ExitCode
    if ($npmExitCode -eq 0) { break }
    if ($attempt -lt 2) { Start-Sleep -Seconds 2 }
  }
  if ($npmExitCode -ne 0) {
    throw "Не удалось установить компоненты агента после двух попыток (код $npmExitCode). Проверьте интернет и повторите запуск."
  }

  Set-Progress 78 "Устанавливаю поддержку Mozilla Firefox..."
  $playwright = Join-Path $rpaDir "node_modules\.bin\playwright.cmd"
  $firefoxProcess = Start-Process -FilePath $playwright -ArgumentList @("install", "firefox") -WorkingDirectory $rpaDir -Wait -PassThru -WindowStyle Hidden
  if ($firefoxProcess.ExitCode -ne 0) {
    throw "Не удалось установить поддержку Mozilla Firefox (код $($firefoxProcess.ExitCode)). Проверьте интернет и повторите запуск."
  }

  Set-Progress 84 "Настраиваю тихий автозапуск..."
  $nodePath = (Get-Command "node.exe" -ErrorAction Stop).Source
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $nodePath
  $shortcut.Arguments = '"server.js"'
  $shortcut.WorkingDirectory = $crmDir
  $shortcut.WindowStyle = 7
  $shortcut.Description = "WB Resale Local Agent"
  $shortcut.Save()

  Get-NetTCPConnection -LocalPort 3017 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }

  Set-Progress 92 "Запускаю агент..."
  Start-Process -FilePath $nodePath -ArgumentList @("server.js") -WorkingDirectory $crmDir -WindowStyle Hidden

  $online = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:3017/api/rpa/status" -Method Get -TimeoutSec 2
      if ($health.version) {
        $online = $true
        break
      }
    } catch {}
  }
  if (-not $online) {
    throw "Файлы установлены, но агент не ответил на проверку. Перезагрузите Windows и повторите проверку на сайте."
  }

  Set-Progress 100 "Готово. Агент установлен, запущен и будет стартовать вместе с Windows."
  $closeButton.Enabled = $true
  $closeButton.Focus()
} catch {
  $errorMessage = $_.Exception.Message
  $progress.Value = 0
  $status.Text = "Установка не завершена: $errorMessage"
  $status.ForeColor = [Drawing.Color]::Firebrick
  $closeButton.Enabled = $true
  $installFailed = $true
  if ($headless) {
    [Console]::Error.WriteLine($errorMessage)
  } else {
    $null = [Windows.Forms.MessageBox]::Show($errorMessage)
  }
} finally {
  if (Test-Path $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (-not $headless) {
  while ($form.Visible) {
    [Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 50
  }
}
if ($installFailed) {
  exit 1
}
