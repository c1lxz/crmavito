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

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

Write-Host "WB Resale local agent installer" -ForegroundColor Green
Write-Host "Site: https://crmavito.duckdns.org/wbr"

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
  if (-not (Test-Command "node")) {
    Write-Step "Node.js is not installed. Installing Node.js LTS via winget"
    if (-not (Test-Command "winget")) {
      throw "Node.js is required, but winget was not found. Install Node.js LTS from https://nodejs.org/ and run this installer again."
    }

    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Refresh-Path

    if (-not (Test-Command "node")) {
      throw "Node.js was installed, but node.exe is not available yet. Restart Windows or open the installer again."
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

  Write-Step "Installing RPA dependencies (Yandex Browser and Chrome are supported)"
  Push-Location $rpaDir
  npm install
  Pop-Location

  Write-Step "Creating Windows autostart task"
  $agentCommand = "cd /d `"$crmDir`" && node server.js"
  schtasks /Create /TN $taskName /SC ONLOGON /TR "cmd.exe /c $agentCommand" /F | Out-Null

  Write-Step "Starting local agent"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $agentCommand -WindowStyle Minimized

  Start-Sleep -Seconds 3
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:3017/api/rpa/status" -Method Get -TimeoutSec 5 | Out-Null
    Write-Host ""
    Write-Host "Done. Local agent is running on http://127.0.0.1:3017" -ForegroundColor Green
    Write-Host "Open https://crmavito.duckdns.org/wbr and click Check agent."
  } catch {
    Write-Warning "Files were installed, but the local agent did not answer yet."
    Write-Warning "Open Desktop\WB Resale CRM and run the CRM .bat file once, then click Check agent on the site."
  }
} finally {
  if (Test-Path $tempDir) {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Read-Host "Press Enter to close"
