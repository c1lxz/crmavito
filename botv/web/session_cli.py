from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import re
import json
import os
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlparse

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import config
from services.ai_description import detect_product_color, generate_design_block, normalize_avito_color
from services.archive import ArchiveError, extract_archive, scan_products
from services.brand_detector import detect_brand, load_brands
from services.color_detector import ColorDetector
from services.description import DescriptionRenderer
from services.product_rules import choose_sizes, load_locations, location_extras, product_extra
from services.xml_generator import AvitoAd, XmlGenerator, make_ad_id
from services.yandex_disk import YandexDiskClient, extract_disk_link, upload_product_photos

SESSIONS_DIR = config.tmp_dir / "web_sessions"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}

BINARY_COLORS = {"Белый", "Чёрный"}


def _binary_color(value: str | None) -> str:
    normalized = normalize_avito_color(value or "")
    if normalized in BINARY_COLORS:
        return normalized
    text = (value or "").casefold().replace("ё", "е")
    if "бел" in text or "white" in text or "light" in text:
        return "Белый"
    return "Чёрный"


def _fallback_design_text(title: str) -> str:
    clean = re.sub(r"\s+", " ", title).strip() or "модели"
    return (
        f"Графический дизайн {clean} выполнен в актуальной уличной эстетике и делает модель выразительной. "
        "Акцентный принт добавляет образу характер, сохраняя лаконичный стиль вещи."
    )


def _gigachat_xml_timeout() -> float:
    try:
        return max(1.0, float(os.getenv("BOTV_GIGACHAT_XML_TIMEOUT", "6")))
    except ValueError:
        return 6.0


def _gigachat_xml_product_limit(product_count: int) -> int:
    raw = os.getenv("BOTV_GIGACHAT_XML_MAX_PRODUCTS")
    if raw is not None:
        try:
            return max(0, int(raw))
        except ValueError:
            return 0
    return product_count if product_count <= 5 else 1


async def _detect_product_binary_color(
    product: dict,
    title: str,
    photos: list[Path],
    color_detector: ColorDetector,
    *,
    allow_ai: bool = True,
    timeout: float | None = None,
) -> str:
    cached = str(product.get("color") or "")
    source = str(product.get("color_source") or "")
    if cached and source in {"manual", "ai"}:
        return _binary_color(cached)
    if allow_ai and config.gigachat_credentials:
        for photo in photos[:3]:
            try:
                color = await asyncio.wait_for(
                    detect_product_color(
                        photo,
                        config.gigachat_credentials,
                        scope=config.gigachat_scope,
                        model=config.gigachat_vision_model,
                        verify_ssl=config.gigachat_verify_ssl,
                    ),
                    timeout=timeout or _gigachat_xml_timeout(),
                )
            except asyncio.TimeoutError:
                color = None
            if color:
                product["color_source"] = "ai"
                return _binary_color(color)
    product["color_source"] = source or "detector"
    return _binary_color(cached or color_detector.detect(f"{product.get('name', '')} {title}"))


async def _generate_product_design(
    product: dict,
    title: str,
    *,
    allow_ai: bool = True,
    timeout: float | None = None,
) -> str:
    cached = str(product.get("design") or "").strip()
    if cached:
        return cached
    if allow_ai and config.gigachat_credentials:
        try:
            design = await asyncio.wait_for(
                generate_design_block(
                    title or str(product.get("name") or ""),
                    config.gigachat_credentials,
                    scope=config.gigachat_scope,
                    model=config.gigachat_model,
                    verify_ssl=config.gigachat_verify_ssl,
                ),
                timeout=timeout or _gigachat_xml_timeout(),
            )
        except asyncio.TimeoutError:
            design = None
        if design:
            return design
    return _fallback_design_text(title or str(product.get("name") or ""))



def _session_dir(session_id: str) -> Path:
    safe = "".join(ch for ch in session_id if ch.isalnum() or ch in "-_")
    if not safe:
        raise SystemExit("invalid session id")
    return SESSIONS_DIR / safe


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _photo_token(path: Path) -> str:
    return base64.urlsafe_b64encode(str(path).encode("utf-8")).decode("ascii").rstrip("=")


def _photo_path(token: str) -> Path:
    padded = token + "=" * (-len(token) % 4)
    return Path(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))


def _serialize_product(index: int, product: dict) -> dict:
    photos = [Path(p) for p in product.get("photos", [])]
    first_photo = photos[0] if photos else None
    details = product.get("details", {})
    return {
        "id": str(index),
        "index": index,
        "name": product["name"],
        "adTitle": product.get("ad_title") or product["name"],
        "price": product.get("price"),
        "deleted": bool(product.get("deleted")),
        "useOriginalTitle": bool(product.get("use_original_title")),
        "photoCount": len(photos),
        "firstPhoto": _photo_token(first_photo) if first_photo else None,
        "photos": [_photo_token(photo) for photo in photos],
        "color": _binary_color(product.get("color") or (details.get("color") if isinstance(details, dict) else None)),
        "description": _product_description(product),
        "descriptionManual": bool(product.get("description_manual")),
        "details": details if isinstance(details, dict) else {},
    }


def _product_title(product: dict) -> str:
    return str(product.get("ad_title") or product.get("adTitle") or product.get("name") or "").strip()


def _product_price(product: dict) -> int | None:
    value = product.get("price")
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _drop_stock_quantity(value: object) -> int | None:
    if value in (None, ""):
        return None
    try:
        quantity = int(value)
    except (TypeError, ValueError):
        raise SystemExit("Остаток дропа должен быть целым числом")
    if quantity < 0:
        raise SystemExit("Остаток дропа не может быть меньше 0")
    return quantity


def _plain_description(value: object) -> str:
    text = str(value or "")
    text = re.sub(r"&lt;br\s*/?&gt;", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _description_is_manual(product: dict) -> bool:
    return bool(product.get("description_manual") and _plain_description(product.get("description")))


def _product_description(product: dict) -> str:
    description = _plain_description(product.get("description"))
    product["description"] = description
    return description


def _public_state(state: dict) -> dict:
    products = state.get("products", [])
    active = [p for p in products if not p.get("deleted")]
    ready = [p for p in active if _product_title(p) and _product_price(p) is not None]
    return {
        "id": state["id"],
        "createdAt": state.get("created_at"),
        "updatedAt": state.get("updated_at") or state.get("created_at"),
        "sourceName": state.get("source_name"),
        "dropStockQuantity": _drop_stock_quantity(state.get("drop_stock_quantity")),
        "locations": _session_locations(state, include_disabled=True),
        "products": [_serialize_product(i, p) for i, p in enumerate(products, 1)],
        "summary": {
            "total": len(products),
            "active": len(active),
            "deleted": len(products) - len(active),
            "ready": len(ready),
            "photos": sum(len(p.get("photos", [])) for p in active),
        },
        "progress": state.get("progress", []),
    }


def _normalize_locations(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise SystemExit("Адреса XML должны быть списком")
    result: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        city = str(item.get("city") or "").strip()
        address = str(item.get("address") or "").strip()
        if not city or not address:
            raise SystemExit("Для города и полного адреса нельзя оставлять пустые поля")
        if city.casefold() == address.casefold():
            raise SystemExit(f"Для города {city} укажите полный адрес с улицей и домом")
        key = (city.casefold(), address.casefold())
        if key in seen:
            continue
        seen.add(key)
        result.append({
            "city": city,
            "address": address,
            "enabled": bool(item.get("enabled", True)),
            "custom": bool(item.get("custom", False)),
        })
    if not result:
        raise SystemExit("Добавьте хотя бы один адрес XML")
    if not any(item["enabled"] for item in result):
        raise SystemExit("Выберите хотя бы один город для XML")
    return result


def _session_locations(state: dict, *, include_disabled: bool = False) -> list[dict[str, object]]:
    stored = state.get("locations")
    if stored is None:
        stored = [
            {**location, "enabled": True, "custom": False}
            for location in load_locations(config.settings_dir / "locations.json")
        ]
    locations = _normalize_locations(stored)
    return locations if include_disabled else [item for item in locations if item["enabled"]]



def _product_details(name: str, photos: list[Path], color: str | None = None) -> dict:
    color_detector = ColorDetector(config.settings_dir / "color_rules.json")
    locations = load_locations(config.settings_dir / "locations.json")
    sizes = choose_sizes(1)
    color = color or _binary_color(color_detector.detect(name))
    extra = product_extra(name, sizes[0] if sizes else "")
    return {
        "category": "Одежда, обувь, аксессуары",
        "color": color,
        "size": extra.get("Size") or extra.get("Размер") or "",
        "goodsType": extra.get("GoodsType") or "Мужская одежда",
        "condition": extra.get("Condition") or "Новое с биркой",
        "location": locations[0].get("Address", "") if locations else "",
        "photos": len(photos),
    }


def _description_for_preview(name: str, title: str, price: int | None, design: str = "") -> str:
    description = DescriptionRenderer(config.settings_dir / "description_template.txt")
    price_fmt = f"{price:,}".replace(",", " ") if price is not None else ""
    return description.render(title=name, color="", product_name=f"{name} {title}", price=price_fmt, design=design)


def _state_from_root(session_id: str, session_dir: Path, root: Path, source_name: str, progress: list[str]) -> dict:
    found = scan_products(root)
    products = []
    for p in found:
        photos = [Path(photo) for photo in p["photos"]]
        details = _product_details(p["name"], photos)
        color = _binary_color(details.get("color"))
        products.append({
            "name": p["name"],
            "ad_title": "",
            "price": None,
            "photos": [str(photo) for photo in photos],
            "deleted": False,
            "use_original_title": False,
            "color": color,
            "color_source": "detector",
            "description": _description_for_preview(p["name"], p["name"], None),
            "details": {**details, "color": color},
        })
    progress.append(f"Найдено товаров: {len(products)}")
    now = int(time.time())
    state = {"id": session_id, "created_at": now, "updated_at": now, "source_name": source_name, "session_dir": str(session_dir), "root": str(root), "products": products, "progress": progress}
    _write_json(session_dir / "state.json", state)
    return _public_state(state)


def _reorder_photos(product: dict, order_tokens: list[str]) -> None:
    current = [Path(path) for path in product.get("photos", [])]
    by_token = {_photo_token(path): path for path in current}
    seen: set[str] = set()
    ordered: list[Path] = []
    for token in order_tokens:
        if token in by_token and token not in seen:
            ordered.append(by_token[token])
            seen.add(token)
    ordered.extend(path for path in current if _photo_token(path) not in seen)
    product["photos"] = [str(path) for path in ordered]


def _move_photo(product: dict, token: str, direction: str) -> None:
    current = [Path(path) for path in product.get("photos", [])]
    tokens = [_photo_token(path) for path in current]
    if token not in tokens:
        return
    index = tokens.index(token)
    if direction == "first":
        target = 0
    elif direction == "left":
        target = max(0, index - 1)
    elif direction == "right":
        target = min(len(current) - 1, index + 1)
    else:
        return
    item = current.pop(index)
    current.insert(target, item)
    product["photos"] = [str(path) for path in current]

def create_from_archive(archive_path: Path, source_name: str, *, move_archive: bool = False) -> dict:
    session_id = f"v_{int(time.time())}_{os.getpid()}"
    session_dir = _session_dir(session_id)
    if session_dir.exists():
        shutil.rmtree(session_dir)
    session_dir.mkdir(parents=True)
    local_archive = session_dir / source_name
    if move_archive:
        shutil.move(str(archive_path), str(local_archive))
    else:
        shutil.copy2(archive_path, local_archive)
    progress = ["Архив получен", "Распаковываю архив"]
    try:
        root = extract_archive(local_archive, session_dir / "extracted")
    except ArchiveError as exc:
        if move_archive:
            shutil.rmtree(session_dir, ignore_errors=True)
        raise SystemExit(str(exc)) from exc
    local_archive.unlink(missing_ok=True)
    progress.append("Сканирую папки товаров и фотографии")
    return _state_from_root(session_id, session_dir, root, source_name, progress)



def create_from_link(raw_link: str) -> dict:
    link = extract_disk_link(raw_link)
    if not link:
        raise SystemExit("Не удалось распознать ссылку на Яндекс.Диск")
    import asyncio
    session_id = f"v_{int(time.time())}_{os.getpid()}"
    session_dir = _session_dir(session_id)
    if session_dir.exists():
        shutil.rmtree(session_dir)
    session_dir.mkdir(parents=True)
    local_root = session_dir / "disk_download"
    progress = ["Ссылка получена", "Скачиваю с Яндекс.Диска"]
    yd = YandexDiskClient(config.yandex_disk_token)
    asyncio.run(yd.download_public_folder(link, local_root, max_size_bytes=config.max_archive_mb * 1024 * 1024))
    archives = list(local_root.glob("*.zip")) + list(local_root.glob("*.rar")) + list(local_root.glob("*.7z"))
    if archives:
        progress.append("Распаковываю скачанный архив")
        root = extract_archive(archives[0], session_dir / "extracted")
        archives[0].unlink(missing_ok=True)
    else:
        root = local_root
    progress.append("Сканирую папки товаров и фотографии")
    return _state_from_root(session_id, session_dir, root, "Яндекс.Диск", progress)

def update_session(session_id: str, payload: dict) -> dict:
    state_path = _session_dir(session_id) / "state.json"
    state = _read_json(state_path)
    products = state["products"]
    if "dropStockQuantity" in payload:
        state["drop_stock_quantity"] = _drop_stock_quantity(payload.get("dropStockQuantity"))
    if "locations" in payload:
        state["locations"] = _normalize_locations(payload.get("locations"))
    for item in payload.get("products", []):
        index = int(item.get("index") or 0) - 1
        if index < 0 or index >= len(products):
            continue
        product = products[index]
        if "deleted" in item:
            product["deleted"] = bool(item["deleted"])
        if "useOriginalTitle" in item:
            product["use_original_title"] = bool(item["useOriginalTitle"])
            if product["use_original_title"]:
                product["ad_title"] = product["name"]
        if "adTitle" in item and not product.get("use_original_title"):
            product["ad_title"] = str(item["adTitle"] or "").strip()
        if "price" in item:
            value = item["price"]
            product["price"] = int(value) if value not in (None, "") else None
        if "color" in item:
            product["color"] = _binary_color(str(item.get("color") or ""))
            product["color_source"] = "manual"
        if "description" in item:
            description_value = _plain_description(item.get("description"))
            product["description"] = description_value
            product["description_manual"] = bool(description_value)
        title = (product.get("ad_title") or product["name"]).strip()
        color = _binary_color(product.get("color"))
        product["color"] = color
        if not _description_is_manual(product):
            product["description"] = _description_for_preview(product["name"], title, product.get("price"), product.get("design", ""))
        product["details"] = _product_details(product["name"], [Path(p) for p in product.get("photos", [])], color)
        if "photoOrder" in item and isinstance(item["photoOrder"], list):
            _reorder_photos(product, [str(token) for token in item["photoOrder"]])
        if "movePhoto" in item and isinstance(item["movePhoto"], dict):
            move = item["movePhoto"]
            _move_photo(product, str(move.get("token", "")), str(move.get("direction", "")))
    ids = {int(i) for i in payload.get("ids", [])}
    if "bulkOriginalTitle" in payload:
        for index, product in enumerate(products, 1):
            if index in ids:
                product["use_original_title"] = bool(payload["bulkOriginalTitle"])
                if product["use_original_title"]:
                    product["ad_title"] = product["name"]
    if "bulkPrice" in payload:
        price = int(payload["bulkPrice"])
        for index, product in enumerate(products, 1):
            if index in ids:
                product["price"] = price
    if payload.get("deleteSelected"):
        for index, product in enumerate(products, 1):
            if index in ids:
                product["deleted"] = True
    state["progress"] = [*state.get("progress", []), "Изменения сохранены"][-12:]
    state["updated_at"] = int(time.time())
    _write_json(state_path, state)
    return _public_state(state)


def list_sessions(limit: int = 20) -> dict:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    items: list[dict] = []
    for state_path in SESSIONS_DIR.glob("*/state.json"):
        try:
            state = _read_json(state_path)
            public = _public_state(state)
            stat = state_path.stat()
            updated_at = int(public.get("updatedAt") or stat.st_mtime)
            items.append({
                "id": public["id"],
                "createdAt": public.get("createdAt"),
                "updatedAt": updated_at,
                "sourceName": public.get("sourceName"),
                "summary": public.get("summary"),
            })
        except Exception:
            continue
    items.sort(key=lambda item: int(item.get("updatedAt") or 0), reverse=True)
    return {"sessions": items[:limit]}


def _replace_phone(xml: str, phone: str) -> str:
    clean = re.sub(r"[^\d+]", "", phone.strip())
    if not clean:
        raise SystemExit("Введите номер телефона")
    return re.sub(r"<ContactPhone>.*?</ContactPhone>", f"<ContactPhone>{clean}</ContactPhone>", xml)


def _public_base_url() -> str:
    explicit = os.getenv("BOTV_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    parsed = urlparse(config.mini_app_url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return "https://crmavito.duckdns.org"


def _public_photo_base_url() -> str:
    explicit = os.getenv("BOTV_PUBLIC_IMAGE_BASE_URL", "").strip().rstrip("/")
    if explicit:
        return explicit
    return "http://crmavito.duckdns.org"


def _size_guide_url() -> str:
    return os.getenv(
        "BOTV_SIZE_GUIDE_URL",
        "https://crmavito.duckdns.org/assets/ky-strok-size-guide-v2.jpg",
    ).strip()


def _public_photo_ext(photo: Path) -> str:
    ext = photo.suffix.lower().lstrip(".")
    if ext in {"jpg", "jpeg", "png", "webp"}:
        return ext
    return "jpg"


def _stage_public_photo(session_id: str, photo: Path) -> str:
    token = hashlib.sha1(str(photo).encode("utf-8")).hexdigest()[:24]
    ext = _public_photo_ext(photo)
    public_dir = ROOT.parent / "public" / "v-static" / "botv" / session_id
    public_dir.mkdir(parents=True, exist_ok=True)
    target = public_dir / f"{token}.{ext}"
    if not target.exists():
        try:
            os.link(photo, target)
        except OSError:
            shutil.copy2(photo, target)
    return f"/v-static/botv/{session_id}/{target.name}"


def _public_photo_urls(session_id: str, photos: list[Path]) -> list[str]:
    base = _public_photo_base_url()
    return [
        f"{base}{_stage_public_photo(session_id, photo)}"
        for photo in photos
    ]


async def _image_urls(client: YandexDiskClient | None, session_id: str, product_name: str, photos: list[Path]) -> list[str]:
    if os.getenv("BOTV_WEB_LOCAL_IMAGES") == "1":
        images = [photo.resolve().as_uri() for photo in photos]
    elif os.getenv("BOTV_WEB_PUBLIC_IMAGES", "1").strip().lower() not in {"0", "false", "no", "off"}:
        images = _public_photo_urls(session_id, photos)
    elif client is None:
        images = _public_photo_urls(session_id, photos)
    else:
        images = await upload_product_photos(
            client=client,
            base_dir=config.yandex_disk_upload_dir,
            product_name=product_name,
            photos=photos,
        )

    size_guide = _size_guide_url()
    images = [
        image
        for image in images
        if "ky-strok-size-guide" not in image.lower()
    ]
    if size_guide:
        images.append(size_guide)
    return images


def _write_xml_file(session_id: str, xml_text: str, phone: str | None = None) -> Path:
    suffix = "_phone" if phone else ""
    out_path = _session_dir(session_id) / f"avito_{int(time.time())}{suffix}.xml"
    out_path.write_bytes(xml_text.encode("utf-8"))
    return out_path


def _read_last_base_xml(state: dict, id_scope: str = "") -> str | None:
    if id_scope:
        scoped = state.get("last_scoped_xmls")
        if isinstance(scoped, dict):
            value = scoped.get(id_scope)
            if value:
                path = Path(str(value))
                if path.exists():
                    return path.read_text(encoding="utf-8")
        return None
    for key in ("last_base_xml", "last_xml"):
        value = state.get(key)
        if not value:
            continue
        path = Path(str(value))
        if path.name.endswith("_phone.xml"):
            continue
        if path.exists():
            return path.read_text(encoding="utf-8")
    return None


def _extract_xml_ad_ids(xml_text: str) -> list[str]:
    return re.findall(r"<Id>([^<]+)</Id>", xml_text)


def _stable_scoped_ad_number(
    state: dict,
    id_scope: str,
    product_index: int,
    address: str,
    fallback: int,
) -> int:
    if not id_scope:
        return fallback
    all_scopes = state.get("xml_id_numbers")
    if not isinstance(all_scopes, dict):
        all_scopes = {}
        state["xml_id_numbers"] = all_scopes
    scope_map = all_scopes.get(id_scope)
    if not isinstance(scope_map, dict):
        scope_map = {}
        all_scopes[id_scope] = scope_map
    key = hashlib.sha1(f"{product_index}:{address.strip().casefold()}".encode("utf-8")).hexdigest()[:20]
    existing = scope_map.get(key)
    if isinstance(existing, int) and existing > 0:
        return existing
    used = [value for value in scope_map.values() if isinstance(value, int) and value > 0]
    number = max([fallback - 1, *used], default=0) + 1
    scope_map[key] = number
    return number


def generate_xml(session_id: str, phone: str | None = None, id_scope: str = "") -> dict:
    state_path = _session_dir(session_id) / "state.json"
    state = _read_json(state_path)
    active_products = [(index, product) for index, product in enumerate(state["products"], 1) if not product.get("deleted")]
    products = [product for _, product in active_products]
    locations = _session_locations(state)
    if phone:
        base_xml = _read_last_base_xml(state, id_scope)
        if base_xml is None:
            base_result = generate_xml(session_id, None, id_scope)
            state = _read_json(state_path)
            base_xml = base_result["xml"]
        xml_text = _replace_phone(base_xml, phone)
        out_path = _write_xml_file(session_id, xml_text, phone)
        state["progress"] = [*state.get("progress", []), f"XML with replacement phone created: {len(products) * len(locations)} ads"][-12:]
        state["last_phone_xml"] = str(out_path)
        state["updated_at"] = int(time.time())
        _write_json(state_path, state)
        return {"filename": out_path.name, "xml": xml_text, "ads": len(products) * len(locations), "products": len(products), "adIds": _extract_xml_ad_ids(xml_text)}
    missing = [i for i, p in enumerate(state["products"], 1) if not p.get("deleted") and (not _product_title(p) or _product_price(p) is None)]
    if missing:
        raise SystemExit("Не заполнены название или цена: " + ", ".join(f"#{i}" for i in missing))
    settings_dir = config.settings_dir
    description = DescriptionRenderer(settings_dir / "description_template.txt")
    xml_gen = XmlGenerator(defaults_path=settings_dir / "avito_defaults.json", schema_path=settings_dir / "xml_schema.json")
    drop_stock_quantity = _drop_stock_quantity(state.get("drop_stock_quantity"))
    color_detector = ColorDetector(settings_dir / "color_rules.json")
    brands_path = settings_dir / "brands_cache.json"
    import asyncio
    brands = asyncio.run(load_brands(brands_path))
    schema = json.loads((settings_dir / "xml_schema.json").read_text(encoding="utf-8"))
    id_prefix = schema.get("id_prefix", "SKU-")
    use_public_images = os.getenv("BOTV_WEB_PUBLIC_IMAGES", "1").strip().lower() not in {"0", "false", "no", "off"}
    use_local_images = os.getenv("BOTV_WEB_LOCAL_IMAGES") == "1"
    yd = None if (use_local_images or use_public_images) else YandexDiskClient(config.yandex_disk_token)
    if yd is not None:
        asyncio.run(yd.ensure_dir(config.yandex_disk_upload_dir))
    sizes = choose_sizes(len(products))
    ai_products_left = _gigachat_xml_product_limit(len(products))
    ai_timeout = _gigachat_xml_timeout()
    ads: list[AvitoAd] = []
    for idx, product in enumerate(products, 1):
        product_state_index = active_products[idx - 1][0]
        name = product["name"]
        title = _product_title(product)
        price = _product_price(product)
        if price is None:
            raise SystemExit(f"Не заполнена цена: #{idx}")
        price_fmt = f"{price:,}".replace(",", " ")
        brand = detect_brand(name, brands) or "Без бренда"
        base_extra = product_extra(f"{name} {title}", sizes[idx - 1])
        photos = [Path(p) for p in product.get("photos", [])]
        needs_ai = not _description_is_manual(product) and not str(product.get("design") or "").strip()
        allow_ai = needs_ai and ai_products_left > 0
        if allow_ai:
            ai_products_left -= 1
        color = _binary_color(product.get("color") or color_detector.detect(f"{name} {title}"))
        product["color_source"] = product.get("color_source") or "detector"
        if _description_is_manual(product):
            design_text = str(product.get("design") or "").strip()
            text = _product_description(product)
        else:
            design_text = asyncio.run(_generate_product_design(product, title or name, allow_ai=allow_ai, timeout=ai_timeout))
            text = description.render(title=name, color=color, product_name=f"{name} {title}", price=price_fmt, design=design_text)
        product["color"] = color
        product["design"] = design_text
        product["description"] = text
        product["details"] = _product_details(name, photos, color)
        images = asyncio.run(_image_urls(yd, session_id, name, photos))
        for location_index, extra in enumerate(location_extras(locations, base_extra), 1):
            fallback_number = (idx - 1) * len(locations) + location_index
            ad_number = _stable_scoped_ad_number(
                state,
                id_scope,
                product_state_index,
                str(extra.get("Address") or ""),
                fallback_number,
            )
            ads.append(AvitoAd(ad_id=make_ad_id(id_prefix, ad_number, id_scope), title=title, price=price, description=text, color=color, quantity=drop_stock_quantity, images=images, brand=brand, extra=extra))
    xml_text = xml_gen.build(ads).decode("utf-8")
    out_path = _write_xml_file(session_id, xml_text)
    state["progress"] = [*state.get("progress", []), f"XML created: {len(ads)} ads"][-12:]
    if id_scope:
        scoped = state.get("last_scoped_xmls") if isinstance(state.get("last_scoped_xmls"), dict) else {}
        scoped[id_scope] = str(out_path)
        state["last_scoped_xmls"] = scoped
    else:
        state["last_xml"] = str(out_path)
        state["last_base_xml"] = str(out_path)
    state["updated_at"] = int(time.time())
    _write_json(state_path, state)
    return {"filename": out_path.name, "xml": xml_text, "ads": len(ads), "products": len(products), "adIds": [ad.ad_id for ad in ads]}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_create = sub.add_parser("create"); p_create.add_argument("archive"); p_create.add_argument("source_name")
    p_create_move = sub.add_parser("create-move"); p_create_move.add_argument("archive"); p_create_move.add_argument("source_name")
    p_link = sub.add_parser("link"); p_link.add_argument("url")
    p_state = sub.add_parser("state"); p_state.add_argument("session_id")
    p_list = sub.add_parser("list"); p_list.add_argument("--limit", type=int, default=20)
    p_update = sub.add_parser("update"); p_update.add_argument("session_id"); p_update.add_argument("payload")
    p_xml = sub.add_parser("xml"); p_xml.add_argument("session_id"); p_xml.add_argument("--phone", default=""); p_xml.add_argument("--id-scope", default="")
    p_photo = sub.add_parser("photo"); p_photo.add_argument("token")
    args = parser.parse_args()
    if args.cmd == "create":
        print(json.dumps(create_from_archive(Path(args.archive), args.source_name), ensure_ascii=False))
    elif args.cmd == "create-move":
        print(json.dumps(create_from_archive(Path(args.archive), args.source_name, move_archive=True), ensure_ascii=False))
    elif args.cmd == "link":
        print(json.dumps(create_from_link(args.url), ensure_ascii=False))
    elif args.cmd == "state":
        print(json.dumps(_public_state(_read_json(_session_dir(args.session_id) / "state.json")), ensure_ascii=False))
    elif args.cmd == "list":
        print(json.dumps(list_sessions(args.limit), ensure_ascii=False))
    elif args.cmd == "update":
        print(json.dumps(update_session(args.session_id, json.loads(args.payload)), ensure_ascii=False))
    elif args.cmd == "xml":
        print(json.dumps(generate_xml(args.session_id, args.phone or None, args.id_scope or ""), ensure_ascii=False))
    elif args.cmd == "photo":
        path = _photo_path(args.token).resolve()
        if path.suffix.lower() not in IMAGE_EXTENSIONS or not path.exists():
            raise SystemExit("not found")
        print(str(path))


if __name__ == "__main__":
    main()
