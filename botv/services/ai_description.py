from __future__ import annotations

import asyncio
import logging
import mimetypes
import time
import uuid
from pathlib import Path
from typing import Optional

import aiohttp

log = logging.getLogger(__name__)

_OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
_API_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions"
_FILES_URL = "https://gigachat.devices.sberbank.ru/api/v1/files"
_cached_token: str | None = None
_cached_token_expires_at = 0.0
_token_lock = asyncio.Lock()

_SYSTEM_PROMPT = (
    "Ты копирайтер для маркетплейса Avito. "
    "Напиши ровно 1-2 предложения для блока «Дизайн» карточки товара. "
    "Стиль как в примерах: лаконично, коммерчески, про графику/принт/эстетику вещи. "
    "Можно упоминать бренд, архивность, уличную эстетику, японский дизайн, арт-принт, "
    "но не выдумывай состав ткани, состояние, наличие товара или скидки. "
    "Пиши от третьего лица, без обращений к покупателю. "
    "Не повторяй название товара целиком. "
    "Не пиши заголовок «Дизайн», кавычки или списки. "
    "Ответ должен быть только готовым текстом описания."
)

AVITO_COLORS = ("Белый", "Чёрный")



async def detect_product_color(
    image_path: Path,
    credentials: str,
    scope: str = "GIGACHAT_API_PERS",
    model: str = "GigaChat-Pro",
    verify_ssl: bool = False,
) -> str | None:
    """Определяет основной цвет товара по фотографии через GigaChat Vision."""
    if not credentials or not image_path.is_file():
        return None

    mime_type = mimetypes.guess_type(image_path.name)[0]
    if mime_type not in {"image/jpeg", "image/png", "image/tiff", "image/bmp"}:
        return None

    token = await _get_access_token(credentials, scope, verify_ssl)
    if not token:
        return None

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    connector = aiohttp.TCPConnector(ssl=verify_ssl)
    try:
        async with aiohttp.ClientSession(connector=connector) as session:
            form = aiohttp.FormData()
            form.add_field(
                "file",
                image_path.read_bytes(),
                filename=image_path.name,
                content_type=mime_type,
            )
            form.add_field("purpose", "general")
            async with session.post(
                _FILES_URL,
                headers=headers,
                data=form,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status not in {200, 201}:
                    log.warning("GigaChat image upload failed [%d]", resp.status)
                    return None
                file_id = (await resp.json()).get("id")
                if not file_id:
                    return None

            body = {
                "model": model,
                "temperature": 0.1,
                "messages": [{
                    "role": "user",
                    "content": (
                        "Определи основной цвет именно ткани вещи на фотографии. "
                        "Игнорируй фон, руки, кожу, бирки, надписи, принт, тени и освещение. "
                        "Смотри на преобладающий цвет самой одежды. "
                        "Возможны только два варианта: Белый или Чёрный. Других цветов нет. "
                        "Если ткань светлая, кремовая, серая от света или почти белая, ответь Белый. "
                        "Если ткань тёмная, графитовая или почти чёрная, ответь Чёрный. "
                        "Ответь ровно одним словом: Белый или Чёрный."
                    ),
                    "attachments": [file_id],
                }],
            }
            chat_headers = {**headers, "Content-Type": "application/json"}
            async with session.post(
                _API_URL,
                headers=chat_headers,
                json=body,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    log.warning(
                        "GigaChat color detection failed [%d]: %s",
                        resp.status,
                        error_text[:500],
                    )
                    return None
                raw = (await resp.json())["choices"][0]["message"]["content"]
                color = normalize_avito_color(raw)
            try:
                async with session.post(
                    f"{_FILES_URL}/{file_id}/delete",
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=10),
                ):
                    pass
            except Exception:
                log.debug("Could not delete temporary GigaChat image %s", file_id)
            return color
    except Exception as exc:
        log.warning("GigaChat color detection error: %s", exc)
        return None


def normalize_avito_color(value: str) -> str | None:
    normalized = value.strip().strip(".\"«»").casefold().replace("ё", "е")
    if any(marker in normalized for marker in ("бел", "white", "light")):
        return "Белый"
    if any(marker in normalized for marker in ("чер", "чёр", "black", "dark", "темн", "тёмн")):
        return "Чёрный"
    return None



async def generate_design_block(
    title: str,
    credentials: str,
    scope: str = "GIGACHAT_API_PERS",
    model: str = "GigaChat",
    verify_ssl: bool = False,
) -> Optional[str]:
    if not credentials:
        return None

    token = await _get_access_token(credentials, scope, verify_ssl)
    if not token:
        return None

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = {
        "model": model,
        "max_tokens": 180,
        "temperature": 0.4,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": f"Товар: {title}"},
        ],
    }

    try:
        connector = aiohttp.TCPConnector(ssl=verify_ssl)
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.post(_API_URL, headers=headers, json=body, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    log.warning("GigaChat generation failed [%d]: %s", resp.status, text[:200])
                    return None
                data = await resp.json()
                result = data["choices"][0]["message"]["content"].strip()
                return _clean_design_text(result)
    except Exception as exc:
        log.warning("GigaChat generation error: %s", exc)
        return None


async def _get_access_token(
    credentials: str,
    scope: str,
    verify_ssl: bool,
) -> str | None:
    global _cached_token, _cached_token_expires_at

    now = time.time()
    if _cached_token and now < _cached_token_expires_at - 60:
        return _cached_token

    async with _token_lock:
        now = time.time()
        if _cached_token and now < _cached_token_expires_at - 60:
            return _cached_token

        headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "RqUID": str(uuid.uuid4()),
        }
        try:
            connector = aiohttp.TCPConnector(ssl=verify_ssl)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.post(
                    _OAUTH_URL,
                    headers=headers,
                    data={"scope": scope},
                    timeout=aiohttp.ClientTimeout(total=20),
                ) as resp:
                    if resp.status != 200:
                        text = await resp.text()
                        log.warning("GigaChat OAuth failed [%d]: %s", resp.status, text[:200])
                        return None
                    data = await resp.json()
        except Exception as exc:
            log.warning("GigaChat OAuth error: %s", exc)
            return None

        _cached_token = data.get("access_token")
        expires_at = float(data.get("expires_at") or 0)
        if expires_at > 10_000_000_000:
            expires_at /= 1000
        _cached_token_expires_at = expires_at or now + 29 * 60
        return _cached_token


def _clean_design_text(text: str) -> str:
    text = text.strip().strip('"«»')
    for prefix in ("Дизайн:", "Описание:"):
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix):].strip()
    return text.rstrip()
