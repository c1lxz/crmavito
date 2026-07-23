from pathlib import Path
import shutil


CONFIG_PATH = Path("/etc/nginx/sites-enabled/crm")
MARKER = "location = /api/avito/ads-analytics/ai-report"
INSERT_BEFORE = "    location / {\n"
BLOCK = """    location = /api/avito/ads-analytics/ai-report {
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
        proxy_connect_timeout 10s;
        limit_req zone=crm_general burst=60 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }

"""


content = CONFIG_PATH.read_text(encoding="utf-8")
if MARKER not in content:
    if INSERT_BEFORE not in content:
        raise SystemExit(f"Could not find insertion point in {CONFIG_PATH}")
    backup_path = CONFIG_PATH.with_suffix(".pre-ai-timeout")
    if not backup_path.exists():
        shutil.copy2(CONFIG_PATH, backup_path)
    CONFIG_PATH.write_text(content.replace(INSERT_BEFORE, BLOCK + INSERT_BEFORE, 1), encoding="utf-8")

print("AI report proxy timeout is configured.")
