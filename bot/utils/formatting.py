from __future__ import annotations

from datetime import date
from typing import Dict

from config import SHEET_COLUMNS


def format_order_card(track: str, carrier: str, size: str, **_) -> str:
    lines = [track]
    if carrier:
        lines.append(carrier)
    lines.append(size.upper())
    return "\n".join(lines)


def format_new_order_summary(data: Dict) -> str:
    today = date.today().strftime("%d.%m.%Y")
    lines = [
        "📋 Новый заказ\n",
        f"Дата: {today}",
        f"Трек: {data.get('track', '—')}",
        f"Количество: {data.get('quantity', '1')}",
        f"Цена продажи: {data.get('sale_price', '') or '—'}",
        f"Закупка: {data.get('purchase_cost', '') or '—'}",
        f"Траты: {data.get('expenses', '') or '—'}",
        f"Прибыль: {data.get('profit', '') or '—'}",
        f"Статус заказа: {data.get('order_status', '—')}",
        f"Точка продаж: {data.get('sale_point', '—')}",
        f"Оплата поставщику: {data.get('payment_status', '—')}",
        f"Контрагент: {data.get('counterparty', '') or '—'}",
    ]
    return "\n".join(lines)


def format_row_card(row_dict: Dict[str, str]) -> str:
    lines = ["📋 Карточка заказа\n"]
    for col in SHEET_COLUMNS:
        val = row_dict.get(col, "") or "—"
        if col == "Дата" and val != "—":
            val = val.split(" ")[0]
        lines.append(f"{col}: {val}")
    return "\n".join(lines)
