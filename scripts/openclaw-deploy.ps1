$ErrorActionPreference = "Stop"

$remote = "crmavito-server-win"
$branch = (git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -notmatch '^[A-Za-z0-9._/-]+$') {
    throw "Cannot resolve a safe git branch for deployment."
}

$bundleName = "crmavito-deploy-$([guid]::NewGuid().ToString('N')).bundle"
$localBundle = Join-Path ([System.IO.Path]::GetTempPath()) $bundleName
$remoteBundle = "/tmp/$bundleName"
$remoteCommand = "set -e; cd /var/www/crmavito; trap 'rm -f $remoteBundle' EXIT; git fetch $remoteBundle $branch; git merge --ff-only FETCH_HEAD; bash deploy.sh"

Write-Host "Deploying crmavito via $remote..."
try {
    git bundle create $localBundle $branch
    if ($LASTEXITCODE -ne 0) { throw "Failed to create deployment bundle." }

    scp $localBundle "${remote}:${remoteBundle}"
    if ($LASTEXITCODE -ne 0) { throw "Failed to upload deployment bundle." }

    ssh $remote $remoteCommand
    if ($LASTEXITCODE -ne 0) { throw "Remote deployment failed." }

    Write-Host "Deploy finished."
} finally {
    Remove-Item -LiteralPath $localBundle -Force -ErrorAction SilentlyContinue
}
