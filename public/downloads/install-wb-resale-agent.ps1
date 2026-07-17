$ErrorActionPreference = "Stop"

$agentUrl = "https://crmavito.duckdns.org/downloads/wb-resale-agent.zip"
$desktop = [Environment]::GetFolderPath("Desktop")
$tempDir = Join-Path $env:TEMP ("wb-resale-agent-" + [Guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $tempDir "wb-resale-agent.zip"
$crmDir = Join-Path $desktop "WB Resale CRM"
$rpaDir = Join-Path $desktop "WB Resale RPA"
$taskName = "WB Resale Local Agent"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Test-Command($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

Write-Host "WB Resale local agent installer" -ForegroundColor Green
Write-Host "This installs the local agent for https://crmavito.duckdns.org/wbr"

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
  if (-not (Test-Command "node")) {
    Write-Step "Node.js is not installed. Trying to install Node.js LTS via winget"
    if (-not (Test-Command "winget")) {
      throw "Node.js is required, and winget was not found. Install Node.js LTS from https://nodejs.org/ and run this installer again."
    }
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Test-Command "node")) {
      throw "Node.js installation finished, but node.exe is not available yet. Restart PowerShell and run this installer again."
    }
  }

  Write-Step "Downloading agent package"
  Invoke-WebRequest -Uri $agentUrl -OutFile $zipPath

  Write-Step "Installing files to Desktop"
  Expand-Archive -LiteralPath $zipPath -DestinationPath $desktop -Force

  if (-not (Test-Path (Join-Path $crmDir "server.js"))) {
    throw "WB Resale CRM was not extracted correctly."
  }
  if (-not (Test-Path (Join-Path $rpaDir "package.json"))) {
    throw "WB Resale RPA was not extracted correctly."
  }

  Write-Step "Installing RPA dependencies"
  Push-Location $rpaDir
  npm install
  npx playwright install chromium
  Pop-Location

  Write-Step "Creating Windows autostart task"
  $agentCommand = "cd /d `"$crmDir`" && node server.js"
  schtasks /Create /TN $taskName /SC ONLOGON /TR "cmd.exe /c $agentCommand" /F | Out-Null

  Write-Step "Starting local agent"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $agentCommand -WindowStyle Minimized

  Start-Sleep -Seconds 3
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:3017/api/rpa/status" -Method Get -TimeoutSec 5
    Write-Host ""
    Write-Host "Done. Local agent is running on http://127.0.0.1:3017" -ForegroundColor Green
    Write-Host "Open https://crmavito.duckdns.org/wbr and press 'Проверить агент'."
  } catch {
    Write-Warning "Files were installed, but the local agent did not answer yet. Run '$crmDir\Запустить CRM.bat' manually once."
  }
} finally {
  if (Test-Path $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Read-Host "Press Enter to close"
