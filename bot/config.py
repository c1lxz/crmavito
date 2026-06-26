from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List

from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"Required environment variable '{key}' is not set")
    return value


@dataclass
class Config:
    bot_token: str = field(default_factory=lambda: _require("BOT_TOKEN"))
    group_chat_id: int = field(
        default_factory=lambda: int(_require("GROUP_CHAT_ID"))
    )
    allowed_user_ids: List[int] = field(
        default_factory=lambda: [
            int(uid.strip())
            for uid in _require("ALLOWED_USER_IDS").split(",")
            if uid.strip()
        ]
    )
    # Google Sheets через Apps Script (новый способ — без Cloud)
    sheets_web_app_url: str = field(
        default_factory=lambda: os.getenv("SHEETS_WEB_APP_URL", "")
    )
    sheets_secret_key: str = field(
        default_factory=lambda: os.getenv("SHEETS_SECRET_KEY", "")
    )
    sheet_name: str = field(
        default_factory=lambda: os.getenv("GOOGLE_SHEET_NAME", "Заказы")
    )
    sale_points: List[str] = field(
        default_factory=lambda: [
            p.strip()
            for p in os.getenv("SALE_POINTS", os.getenv("SALE_POINT", "Авито")).split(",")
            if p.strip()
        ]
    )
    counterparty: str = field(
        default_factory=lambda: os.getenv("COUNTERPARTY", "")
    )

    # Таймаут ожидания второго фото (секунды)
    photo_wait_timeout: int = 300


config = Config()

# Колонки Google Таблицы в нужном порядке
SHEET_COLUMNS = [
    "Дата",
    "Трек-номер",
    "Количество",
    "Цена продажи за 1 шт",
    "Выручка",
    "Закупка",
    "Траты",
    "Прибыль",
    "Статус заказа",
    "Точка продаж",
    "Статус оплаты поставщику",
    "Контрагент",
]

# Поля, доступные для редактирования (все колонки)
EDITABLE_FIELDS = SHEET_COLUMNS
