from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


@dataclass
class PriceMatch:
    product_name: str
    price: int


@dataclass
class PriceParseResult:
    matched: list[PriceMatch]
    missing: list[str]        # товары без цены
    unmatched_lines: list[str]  # строки, которые не удалось привязать


_PRICE_RE = re.compile(r"(\d[\d\s]{0,10})(?:\s*(?:₽|руб|р\.?)?)?\s*$", re.IGNORECASE)


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().replace("ё", "е").strip(" .,:—-"))


def parse_prices(text: str, products: Iterable[str]) -> PriceParseResult:
    """
    Режим 1 (по порядку): каждая строка — просто число (цена).
    Количество строк должно совпадать с количеством товаров.

    Режим 2 (по названию): строки вида «Название — 3290».
    Автоматически определяется: если все непустые строки — числа, это режим 1.
    """
    prod_list = list(products)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Режим 1: все строки — просто цены
    if lines and all(_extract_price(ln) is not None and _strip_price(ln).strip() == "" for ln in lines):
        return _parse_ordered(lines, prod_list)

    # Режим 2: по названию (старая логика)
    return _parse_by_name(lines, prod_list)


def _parse_ordered(lines: list[str], products: list[str]) -> PriceParseResult:
    matched: list[PriceMatch] = []
    if len(lines) != len(products):
        return PriceParseResult(
            matched=[],
            missing=products,
            unmatched_lines=[f"Ожидал {len(products)} цен, получил {len(lines)}"],
        )
    for name, line in zip(products, lines):
        price = _extract_price(line)
        matched.append(PriceMatch(product_name=name, price=price))
    return PriceParseResult(matched=matched, missing=[], unmatched_lines=[])


def _parse_by_name(lines: list[str], products: list[str]) -> PriceParseResult:
    prod_index: dict[str, str] = {_normalize(name): name for name in products}
    matched: list[PriceMatch] = []
    unmatched: list[str] = []
    seen: set[str] = set()

    for line in lines:
        price = _extract_price(line)
        if price is None:
            unmatched.append(line)
            continue

        name_part = _strip_price(line)
        norm = _normalize(name_part)

        original = prod_index.get(norm)
        if original is None:
            candidates = [orig for key, orig in prod_index.items() if key and key in norm]
            if len(candidates) == 1:
                original = candidates[0]

        if original is None or original in seen:
            unmatched.append(line)
            continue

        matched.append(PriceMatch(product_name=original, price=price))
        seen.add(original)

    missing = [name for name in products if name not in seen]
    return PriceParseResult(matched=matched, missing=missing, unmatched_lines=unmatched)


def _extract_price(line: str) -> int | None:
    m = _PRICE_RE.search(line)
    if not m:
        return None
    digits = re.sub(r"\s+", "", m.group(1))
    if not digits.isdigit():
        return None
    value = int(digits)
    if value < 10 or value > 10_000_000:
        return None
    return value


def _strip_price(line: str) -> str:
    # убираем всё от «—», «-», «:» до конца, если далее только цена
    parts = re.split(r"\s*[—\-:]\s*", line, maxsplit=1)
    if len(parts) == 2 and _extract_price(parts[1]) is not None:
        return parts[0]
    # или убираем цену с конца строки
    return _PRICE_RE.sub("", line).rstrip(" —-:.,")
