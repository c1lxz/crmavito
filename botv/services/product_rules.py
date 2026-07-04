from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Sequence

SIZES = ("46 (S)", "48 (M)", "50 (L)")


def load_locations(path: Path) -> list[dict[str, str]]:
    locations = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(locations, list) or not locations:
        raise ValueError("В settings/locations.json должен быть непустой список адресов")
    for location in locations:
        if not location.get("city") or not location.get("address"):
            raise ValueError("Для каждой точки обязательны city и address")
        if location["address"].strip().casefold() == location["city"].strip().casefold():
            raise ValueError(f"Для города {location['city']} нужен точный адрес")
    return locations


def choose_size(choices: Sequence[str] = SIZES) -> str:
    return random.choice(tuple(choices))


def choose_sizes(count: int, choices: Sequence[str] = SIZES) -> list[str]:
    """Возвращает равномерно перемешанные размеры без длинных серий повторов."""
    if count < 0 or not choices:
        raise ValueError("Количество и набор размеров должны быть корректными")
    result: list[str] = []
    while len(result) < count:
        cycle = list(choices)
        random.shuffle(cycle)
        result.extend(cycle)
    return result[:count]


def product_extra(name: str, size: str) -> dict[str, str]:
    extra = {"Size": size}
    if "лонгслив" in name.casefold():
        extra["GoodsSubType"] = "Свитшот"
    return extra
