from __future__ import annotations

import json
import random
import re
from pathlib import Path
from typing import Sequence

SIZES = ("46 (S)", "48 (M)", "50 (L)")


def product_kind(name: str) -> str:
    value = name.casefold().replace("ё", "е")
    if "худи" in value or "hoodie" in value:
        return "hoodie"
    if "лонгслив" in value or "long sleeve" in value or "longsleeve" in value:
        return "longsleeve"
    if "поло" in value or re.search(r"\bpolo\b", value):
        return "polo"
    if "свитшот" in value or "sweatshirt" in value:
        return "sweatshirt"
    if "футбол" in value or "t-shirt" in value or "tshirt" in value or re.search(r"\btee\b", value):
        return "tshirt"
    return "other"


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
    kind = product_kind(name)
    if kind == "longsleeve":
        extra["GoodsSubType"] = "Свитшот"
    elif kind in {"hoodie", "sweatshirt"}:
        extra["GoodsSubType"] = "Толстовка"
    elif kind == "polo":
        extra["GoodsSubType"] = "Поло"
    return extra


def location_extras(
    locations: Sequence[dict[str, str]],
    base_extra: dict[str, str],
) -> list[dict[str, str]]:
    """Создаёт отдельный набор XML-полей для каждого точного адреса."""
    return [
        {**base_extra, "Address": location["address"]}
        for location in locations
    ]
