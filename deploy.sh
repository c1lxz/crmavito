#!/usr/bin/env bash
set -e

cd /var/www/crmavito
npm install
npm run build
pm2 restart crm 2>/dev/null || pm2 start npm --name crm -- start

cd /var/www/crmavito/bot
venv/bin/pip install -r requirements.txt -q
pm2 restart bot 2>/dev/null || pm2 start /var/www/crmavito/bot/main.py \
  --name bot \
  --interpreter /var/www/crmavito/bot/venv/bin/python3
pm2 save
