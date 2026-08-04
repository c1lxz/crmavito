$ErrorActionPreference = "Stop"

$agentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$profileRoot = if ($env:FLOW_AGENT_PROFILE_DIR) {
  [IO.Path]::GetFullPath($env:FLOW_AGENT_PROFILE_DIR.Trim('"'))
} else {
  Join-Path $agentRoot "state\chrome-profile"
}
$debugPort = 9223
$flowUrl = "https://labs.google/fx/ru/tools/flow"
$proxyExtensionId = "pcboajngloecgmaailkmphmpbacmbcfb" # Simple Proxy Switcher

$listening = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $debugPort -State Listen -ErrorAction SilentlyContinue
if ($listening) { exit 0 }

$chrome = @(
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $chrome) { throw "Google Chrome не найден." }

New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
$proxyExtensionPath = if ($env:FLOW_AGENT_PROXY_EXTENSION_PATH) {
  $env:FLOW_AGENT_PROXY_EXTENSION_PATH.Trim('"')
} else {
  $chromeUserData = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
  Get-ChildItem -LiteralPath $chromeUserData -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ChildItem -LiteralPath (Join-Path $_.FullName "Extensions\$proxyExtensionId") -Directory -ErrorAction SilentlyContinue
  } | Sort-Object { try { [version]$_.Name } catch { [version]"0.0" } } -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if ($proxyExtensionPath -and -not (Test-Path -LiteralPath (Join-Path $proxyExtensionPath "manifest.json"))) {
  throw "Папка прокси-расширения некорректна: $proxyExtensionPath"
}

$arguments = @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=$debugPort",
  "--user-data-dir=`"$profileRoot`"",
  "--no-first-run",
  "--no-default-browser-check"
)
if ($proxyExtensionPath) {
  $arguments += "--disable-extensions-except=`"$proxyExtensionPath`""
  $arguments += "--load-extension=`"$proxyExtensionPath`""
}
$arguments += $flowUrl
$arguments = $arguments -join " "
Start-Process -FilePath $chrome -ArgumentList $arguments -WorkingDirectory $agentRoot
