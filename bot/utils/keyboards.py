from __future__ import annotations

from typing import List, Tuple

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    WebAppInfo,
)

from config import EDITABLE_FIELDS, config

BTN_NEW_ORDER = "➕ Новый заказ"
BTN_SEARCH = "🔍 Поиск по трек-номеру"
BTN_MINI_APP = "Открыть CRM mini app"

ORDER_STATUSES = ["Отправлен", "Получен", "На возврате", "Отменён"]
PAYMENT_STATUSES = ["Оплачено", "Не оплачено"]


def main_menu() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text=BTN_MINI_APP, web_app=WebAppInfo(url=config.mini_app_url))],
            [KeyboardButton(text=BTN_NEW_ORDER)],
            [KeyboardButton(text=BTN_SEARCH)],
        ],
        resize_keyboard=True,
        persistent=True,
    )


def quantity_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="1", callback_data="qty:1"),
            InlineKeyboardButton(text="2", callback_data="qty:2"),
            InlineKeyboardButton(text="3", callback_data="qty:3"),
        ],
        [InlineKeyboardButton(text="✏️ Другое (введите число)", callback_data="qty:other")],
    ])


def skip_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="Пропустить", callback_data="skip")],
    ])


def order_status_kb() -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(text=s, callback_data=f"status:{s}")] for s in ORDER_STATUSES]
    rows.append([InlineKeyboardButton(text="✏️ Свой вариант", callback_data="status:other")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def sale_point_kb(points: List[str]) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(text=p, callback_data=f"salepoint:{p}")] for p in points]
    rows.append([InlineKeyboardButton(text="✏️ Свой вариант", callback_data="salepoint:other")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def payment_status_kb() -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(text=s, callback_data=f"payment:{s}")] for s in PAYMENT_STATUSES]
    rows.append([InlineKeyboardButton(text="✏️ Свой вариант", callback_data="payment:other")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def new_order_confirm_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Подтвердить", callback_data="neworder:confirm"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="neworder:cancel"),
        ]
    ])


# ── Поиск ──────────────────────────────────────────────────────────────────────

def search_results_kb(results: List[Tuple[int, dict]]) -> InlineKeyboardMarkup:
    buttons = []
    for row_num, row_dict in results:
        track = row_dict.get("Трек-номер", "?")
        label = track[:30]
        buttons.append([InlineKeyboardButton(text=label, callback_data=f"selectrow:{row_num}")])
    buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data="search:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def order_action_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✏️ Изменить", callback_data="rowaction:edit"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="rowaction:cancel"),
        ]
    ])


def editable_fields_kb() -> InlineKeyboardMarkup:
    buttons = [
        [InlineKeyboardButton(text=field, callback_data=f"field:{field}")]
        for field in EDITABLE_FIELDS
    ]
    buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data="field:cancel")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)
