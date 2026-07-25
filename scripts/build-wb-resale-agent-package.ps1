$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $root ".wbr-agent-package"
$zip = Join-Path $root "public\downloads\wb-resale-agent.zip"
$crmSrc = Join-Path ([Environment]::GetFolderPath("Desktop")) "WB Resale CRM"
$rpaSrc = Join-Path ([Environment]::GetFolderPath("Desktop")) "WB Resale RPA"
$crmDst = Join-Path $stage "WB Resale CRM"
$rpaDst = Join-Path $stage "WB Resale RPA"

function Assert-ChildPath($parent, $child) {
  $parentFull = [System.IO.Path]::GetFullPath($parent).TrimEnd("\") + "\"
  $childFull = [System.IO.Path]::GetFullPath($child)
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe path: $childFull is outside $parentFull"
  }
}

if (-not (Test-Path (Join-Path $crmSrc "server.js"))) {
  throw "WB Resale CRM source was not found: $crmSrc"
}

if (-not (Test-Path (Join-Path $rpaSrc "package.json"))) {
  throw "WB Resale RPA source was not found: $rpaSrc"
}

Assert-ChildPath $root $stage
Assert-ChildPath $root $zip

if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stage | Out-Null

robocopy $crmSrc $crmDst /E /XD node_modules data /XF app.db *.log | Out-Null
if ($LASTEXITCODE -gt 7) {
  throw "robocopy CRM failed: $LASTEXITCODE"
}

robocopy $rpaSrc $rpaDst /E /XD node_modules .browser-profile .browser-profile-yandex .browser-profile-chrome photos remote-photos logs test-results playwright-report /XF items.csv *.log | Out-Null
if ($LASTEXITCODE -gt 7) {
  throw "robocopy RPA failed: $LASTEXITCODE"
}

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Remove-Item -LiteralPath $stage -Recurse -Force

Get-Item $zip | Format-List FullName,Length,LastWriteTime
