"""
Детектор брендов по справочнику Avito.
Загружает XML с брендами один раз, кэширует на диске (24ч).
Ищет бренд в названии товара (case-insensitive).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path

log = logging.getLogger(__name__)

_BRANDS_URL = "https://avito.ru/web/1/catalogs/content/feed/brendy_fashion.xml"
_CACHE_TTL_SEC = 24 * 3600


async def load_brands(cache_path: Path) -> list[str]:
    """
    Скачивает XML с брендами, парсит, кэширует в cache_path (JSON).
    При ошибке сети пробует загрузить из кэша.
    Если кэш устарел (>24ч) или отсутствует и сеть недоступна — возвращает [].
    """
    if os.getenv("BOTV_BRANDS_OFFLINE") == "1":
        return _load_from_cache(cache_path)

    # Пробуем скачать свежий список
    try:
        import aiohttp
        from lxml import etree as _etree

        async with aiohttp.ClientSession() as session:
            async with session.get(_BRANDS_URL, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                resp.raise_for_status()
                raw = await resp.read()

        root = _etree.fromstring(raw)
        brands = [
            value.strip()
            for el in root.iter()
            if (value := el.get("name")) and value.strip()
        ]

        brands = sorted(set(brands))

        if not brands:
            log.warning("brand_detector: network returned 0 brands, keeping cache")
            return _load_from_cache(cache_path)

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(
            json.dumps({"ts": time.time(), "brands": brands}, ensure_ascii=False),
            encoding="utf-8",
        )
        log.info("brand_detector: loaded %d brands from network", len(brands))
        return brands

    except Exception as exc:
        log.warning("brand_detector: network error: %s", exc)

    # Пробуем кэш
    return _load_from_cache(cache_path)


def _load_from_cache(cache_path: Path) -> list[str]:
    if not cache_path.exists():
        log.warning("brand_detector: cache not found, returning empty list")
        return []
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        ts = data.get("ts", 0)
        if time.time() - ts > _CACHE_TTL_SEC:
            log.warning("brand_detector: cache is stale (>24h), returning empty list")
            return []
        brands = data.get("brands", [])
        log.info("brand_detector: loaded %d brands from cache", len(brands))
        return brands
    except Exception as exc:
        log.warning("brand_detector: cache read error: %s", exc)
        return []


def detect_brand(product_name: str, brands: list[str]) -> str | None:
    """
    Ищет любой бренд из списка в названии товара (case-insensitive).
    Длинные бренды проверяются первыми.
    Возвращает официальное написание из списка или None.
    """
    normalized = re.sub(
        r"^\s*(?:футболка|майка|худи|свитшот|лонгслив|толстовка)\s+",
        "",
        product_name,
        flags=re.IGNORECASE,
    ).strip()
    by_lower = {brand.casefold(): brand for brand in brands}

    # В названиях дропа модель часто заключена в кавычки:
    # "Футболка Raf Simons 'Model'". Всё до кавычки — заявленный бренд.
    quoted_prefix = re.split(r"['\"«]", normalized, maxsplit=1)[0].strip()
    if quoted_prefix != normalized:
        exact = by_lower.get(quoted_prefix.casefold())
        return exact

    lower = normalized.casefold()
    for brand in sorted(brands, key=len, reverse=True):
        candidate = brand.casefold()
        if lower == candidate or lower.startswith(candidate + " "):
            return brand
    return None
