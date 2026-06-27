#!/usr/bin/env bash
set -e

cd /var/www/crmavito
npm install
npx prisma db push
# Ограничиваем RAM Node чтобы не уронить VPS OOM-киллером
NODE_OPTIONS="--max-old-space-size=1024" npm run build
pm2 restart crm --update-env 2>/dev/null || pm2 start npm --name crm -- start
pm2 restart avito-sync --update-env 2>/dev/null || pm2 start npm --name avito-sync -- run avito:sync-worker

cd /var/www/crmavito/bot
venv/bin/pip install -r requirements.txt -q
pm2 restart bot --update-env 2>/dev/null || pm2 start /var/www/crmavito/bot/main.py \
  --name bot \
  --interpreter /var/www/crmavito/bot/venv/bin/python3
pm2 save
