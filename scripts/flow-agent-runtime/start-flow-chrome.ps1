$ErrorActionPreference = "Stop"

$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileRoot = Join-Path $agentRoot "state\chrome-profile"
$debugPort = 9223
$flowUrl = "https://labs.google/fx/tools/flow"

$listening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $debugPort -State Listen -ErrorAction SilentlyContinue
if ($listening) { exit 0 }

$chrome = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome не найден." }

New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
$arguments = @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$debugPort",
  "--user-data-dir=`"$profileRoot`"",
  "--no-first-run",
  "--no-default-browser-check",
  $flowUrl
) -join " "
Start-Process -FilePath $chrome -ArgumentList $arguments -WorkingDirectory $agentRoot
