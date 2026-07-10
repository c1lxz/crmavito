from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_MAX_ARCHIVE_MB = 1536


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Required environment variable '{key}' is not set")
    return value


def _int_list(raw: str) -> List[int]:
    return [int(v.strip()) for v in raw.split(",") if v.strip()]


def _bool_env(key: str, default: bool) -> bool:
    raw = os.getenv(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Config:
    bot_token: str = field(default_factory=lambda: _require("BOT_TOKEN"))
    allowed_user_ids: List[int] = field(
        default_factory=lambda: _int_list(_require("ALLOWED_USER_IDS"))
    )

    yandex_disk_token: str = field(
        default_factory=lambda: _require("YANDEX_DISK_TOKEN")
    )
    yandex_disk_upload_dir: str = field(
        default_factory=lambda: os.getenv("YANDEX_DISK_UPLOAD_DIR", "Avito").strip("/")
    )

    settings_dir: Path = field(
        default_factory=lambda: (BASE_DIR / os.getenv("SETTINGS_DIR", "settings")).resolve()
    )
    tmp_dir: Path = field(
        default_factory=lambda: (BASE_DIR / os.getenv("TMP_DIR", "tmp")).resolve()
    )

    max_archive_mb: int = field(
        default_factory=lambda: int(os.getenv("MAX_ARCHIVE_MB", str(DEFAULT_MAX_ARCHIVE_MB)))
    )
    mini_app_url: str = field(
        default_factory=lambda: os.getenv("BOTV_MINI_APP_URL", "https://crmavito.duckdns.org/v")
    )

    gigachat_credentials: str = field(
        default_factory=lambda: os.getenv("GIGACHAT_CREDENTIALS", "")
    )
    gigachat_scope: str = field(
        default_factory=lambda: os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
    )
    gigachat_model: str = field(
        default_factory=lambda: os.getenv("GIGACHAT_MODEL", "GigaChat")
    )
    gigachat_vision_model: str = field(
        default_factory=lambda: os.getenv("GIGACHAT_VISION_MODEL", "GigaChat-Max")
    )
    gigachat_verify_ssl: bool = field(
        default_factory=lambda: _bool_env("GIGACHAT_VERIFY_SSL", False)
    )


config = Config()
config.tmp_dir.mkdir(parents=True, exist_ok=True)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z"}
