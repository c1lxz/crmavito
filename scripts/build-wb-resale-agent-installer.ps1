$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$downloadsDir = Join-Path $root "public\downloads"
$buildDir = Join-Path $root ".wbr-installer-build"
$sedPath = Join-Path $buildDir "installer.sed"
$launcherPath = Join-Path $buildDir "run-installer.cmd"
$scriptSource = Join-Path $downloadsDir "install-wb-resale-agent.ps1"
$exeTarget = Join-Path $downloadsDir "install-wb-resale-agent.exe"

if (-not (Test-Path $scriptSource)) {
  throw "Installer script was not found: $scriptSource"
}

if (Test-Path $buildDir) {
  Remove-Item -LiteralPath $buildDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

Copy-Item -LiteralPath $scriptSource -Destination (Join-Path $buildDir "install-wb-resale-agent.ps1") -Force

@'
@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-wb-resale-agent.ps1"
exit /b %ERRORLEVEL%
'@ | Set-Content -LiteralPath $launcherPath -Encoding ASCII

$sourceDir = $buildDir.TrimEnd("\") + "\"

@"
[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=This will install or update the WB Resale local agent.
DisplayLicense=
FinishMessage=WB Resale local agent installer finished.
TargetName=$exeTarget
FriendlyName=WB Resale Agent Installer
AppLaunched=run-installer.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=SourceFiles

[Strings]
FILE0="install-wb-resale-agent.ps1"
FILE1="run-installer.cmd"

[SourceFiles]
SourceFiles0=$sourceDir

[SourceFiles0]
%FILE0%=
%FILE1%=
"@ | Set-Content -LiteralPath $sedPath -Encoding ASCII

& iexpress.exe /N /Q $sedPath

if (-not (Test-Path $exeTarget)) {
  throw "IExpress did not create the installer: $exeTarget"
}

Remove-Item -LiteralPath $buildDir -Recurse -Force
Write-Host "Created $exeTarget"
