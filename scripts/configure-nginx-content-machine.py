import os
from pathlib import Path
import shutil


CONFIG_PATH = Path(os.environ.get("NGINX_CONFIG_PATH", "/etc/nginx/sites-enabled/crm"))
OLD_LIMIT = "    client_max_body_size 5m;"
NEW_LIMIT = "    client_max_body_size 25m; # Content Machine 2K uploads"


content = CONFIG_PATH.read_text(encoding="utf-8")
if NEW_LIMIT not in content:
    if OLD_LIMIT not in content:
        raise SystemExit(f"Could not find the expected body-size directive in {CONFIG_PATH}")
    backup_path = CONFIG_PATH.with_suffix(".pre-content-machine-2k")
    if not backup_path.exists():
        shutil.copy2(CONFIG_PATH, backup_path)
    CONFIG_PATH.write_text(content.replace(OLD_LIMIT, NEW_LIMIT, 1), encoding="utf-8")

print("Nginx accepts Content Machine 2K uploads.")
