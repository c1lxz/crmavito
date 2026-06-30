#!/usr/bin/env bash
set -e

cd /var/www/crmavito
npm install
DATABASE_URL_FROM_ENV="$(node -e "require('dotenv/config'); process.stdout.write(process.env.DATABASE_URL || '')")"
if [ -n "$DATABASE_URL_FROM_ENV" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL_FROM_ENV" -c 'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "carrier" TEXT;'
  psql "$DATABASE_URL_FROM_ENV" -c 'ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "size" TEXT;'
fi
# Ограничиваем RAM Node чтобы не уронить VPS OOM-киллером
NODE_OPTIONS="--max-old-space-size=1024" npm run build
pm2 stop crm 2>/dev/null || true
sleep 4
fuser -k 3000/tcp 2>/dev/null || true
sleep 1
pm2 start crm --update-env 2>/dev/null || pm2 start npm --name crm -- start
AVITO_SYNC_DISABLED_FROM_ENV="$(node -e "require('dotenv/config'); process.stdout.write(process.env.AVITO_SYNC_DISABLED || '')")"
if [ "$AVITO_SYNC_DISABLED_FROM_ENV" = "true" ] || [ "$AVITO_SYNC_DISABLED_FROM_ENV" = "1" ]; then
  pm2 delete avito-sync 2>/dev/null || true
else
  pm2 restart avito-sync --update-env 2>/dev/null || pm2 start npm --name avito-sync -- run avito:sync-worker
fi

cd /var/www/crmavito/bot
venv/bin/pip install -r requirements.txt -q
pm2 restart bot --update-env 2>/dev/null || pm2 start /var/www/crmavito/bot/main.py \
  --name bot \
  --interpreter /var/www/crmavito/bot/venv/bin/python3
pm2 save
