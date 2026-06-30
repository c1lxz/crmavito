$ErrorActionPreference = "Stop"

$remote = "crmavito-server-win"
$remoteCommand = "cd /var/www/crmavito && git pull --ff-only && bash deploy.sh"

Write-Host "Deploying crmavito via $remote..."
ssh $remote $remoteCommand
Write-Host "Deploy finished."
