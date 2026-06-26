from __future__ import annotations

import asyncio
import logging
from datetime import date
from typing import Dict, List, Tuple

import requests

from config import SHEET_COLUMNS, config

log = logging.getLogger(__name__)


def _call(action: str, **kwargs) -> dict:
    """Синхронный вызов Apps Script веб-приложения."""
    if not config.sheets_web_app_url:
        raise RuntimeError("SHEETS_WEB_APP_URL не задан")
    payload = {
        "key": config.sheets_secret_key,
        "sheet": config.sheet_name,
        "action": action,
        **kwargs,
    }
    resp = requests.post(config.sheets_web_app_url, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Sheets error: {data['error']}")
    return data


async def _async_call(action: str, **kwargs) -> dict:
    """Запускает синхронный вызов в пуле потоков, чтобы не блокировать event loop."""
    return await asyncio.to_thread(_call, action, **kwargs)


async def append_order(
    track: str,
    quantity: str = "1",
    sale_price: str = "",
    purchase_cost: str = "",
    expenses: str = "",
    profit: str = "",
    order_status: str = "Отправлен",
    sale_point: str = "",
    payment_status: str = "",
    counterparty: str = "",
) -> None:
    today = date.today().strftime("%d.%m.%Y")

    try:
        revenue = str(float(sale_price) * int(quantity)) if sale_price and quantity else ""
    except (ValueError, TypeError):
        revenue = ""

    row = [
        today,                              # Дата
        track,                             # Трек-номер
        quantity,                          # Количество
        sale_price,                        # Цена продажи за 1 шт
        revenue,                           # Выручка
        purchase_cost,                     # Закупка
        expenses,                          # Траты
        profit,                            # Прибыль
        order_status,                      # Статус заказа
        sale_point,                        # Точка продаж
        payment_status,                    # Статус оплаты поставщику
        counterparty or config.counterparty,  # Контрагент
    ]
    await _async_call("append", row=row)


async def search_by_track(query: str) -> List[Tuple[int, Dict[str, str]]]:
    data = await _async_call("search", query=query)
    results = []
    for item in data.get("results", []):
        row_dict = _row_to_dict(item["row"])
        results.append((item["row_num"], row_dict))
    return results


async def get_row(row_num: int) -> Dict[str, str]:
    data = await _async_call("get_row", row_num=row_num)
    return _row_to_dict(data["row"])


async def update_field(row_num: int, field_name: str, new_value: str) -> None:
    if field_name not in SHEET_COLUMNS:
        raise ValueError(f"Unknown field: {field_name}")
    col_index = SHEET_COLUMNS.index(field_name) + 1
    await _async_call("update_cell", row_num=row_num, col_num=col_index, value=new_value)


def _row_to_dict(row_data: list) -> Dict[str, str]:
    result = {}
    for i, col_name in enumerate(SHEET_COLUMNS):
        result[col_name] = str(row_data[i]) if i < len(row_data) else ""
    return result
