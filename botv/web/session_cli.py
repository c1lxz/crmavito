from __future__ import annotations

import argparse
import base64
import re
import json
import os
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import config
from services.archive import ArchiveError, extract_archive, scan_products
from services.brand_detector import detect_brand
from services.color_detector import ColorDetector
from services.description import DescriptionRenderer
from services.product_rules import choose_sizes, load_locations, location_extras, product_extra
from services.xml_generator import AvitoAd, XmlGenerator, make_ad_id
from services.yandex_disk import YandexDiskClient, extract_disk_link, upload_product_photos

SESSIONS_DIR = config.tmp_dir / "web_sessions"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


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
        "description": product.get("description", ""),
        "details": details if isinstance(details, dict) else {},
    }


def _public_state(state: dict) -> dict:
    products = state.get("products", [])
    active = [p for p in products if not p.get("deleted")]
    ready = [p for p in active if (p.get("ad_title") or "").strip() and p.get("price") is not None]
    return {
        "id": state["id"],
        "createdAt": state.get("created_at"),
        "updatedAt": state.get("updated_at") or state.get("created_at"),
        "sourceName": state.get("source_name"),
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



def _product_details(name: str, photos: list[Path]) -> dict:
    color_detector = ColorDetector(config.settings_dir / "color_rules.json")
    locations = load_locations(config.settings_dir / "locations.json")
    sizes = choose_sizes(1)
    color = color_detector.detect(name)
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


def _description_for_preview(name: str, title: str, price: int | None) -> str:
    color_detector = ColorDetector(config.settings_dir / "color_rules.json")
    description = DescriptionRenderer(config.settings_dir / "description_template.txt")
    color = color_detector.detect(f"{name} {title}")
    price_fmt = f"{price:,}".replace(",", " ") if price is not None else ""
    return description.render(title=name, color=color, price=price_fmt, design="")


def _state_from_root(session_id: str, session_dir: Path, root: Path, source_name: str, progress: list[str]) -> dict:
    found = scan_products(root)
    products = []
    for p in found:
        photos = [Path(photo) for photo in p["photos"]]
        products.append({
            "name": p["name"],
            "ad_title": "",
            "price": None,
            "photos": [str(photo) for photo in photos],
            "deleted": False,
            "use_original_title": False,
            "description": _description_for_preview(p["name"], p["name"], None),
            "details": _product_details(p["name"], photos),
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

def create_from_archive(archive_path: Path, source_name: str) -> dict:
    session_id = f"v_{int(time.time())}_{os.getpid()}"
    session_dir = _session_dir(session_id)
    if session_dir.exists():
        shutil.rmtree(session_dir)
    session_dir.mkdir(parents=True)
    local_archive = session_dir / source_name
    shutil.copy2(archive_path, local_archive)
    progress = ["Архив получен", "Распаковываю архив"]
    try:
        root = extract_archive(local_archive, session_dir / "extracted")
    except ArchiveError as exc:
        raise SystemExit(str(exc)) from exc
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
    else:
        root = local_root
    progress.append("Сканирую папки товаров и фотографии")
    return _state_from_root(session_id, session_dir, root, "Яндекс.Диск", progress)

def update_session(session_id: str, payload: dict) -> dict:
    state_path = _session_dir(session_id) / "state.json"
    state = _read_json(state_path)
    products = state["products"]
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
        title = (product.get("ad_title") or product["name"]).strip()
        product["description"] = _description_for_preview(product["name"], title, product.get("price"))
        product["details"] = _product_details(product["name"], [Path(p) for p in product.get("photos", [])])
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


def _public_photo_urls(session_id: str, photos: list[Path]) -> list[str]:
    base = _public_base_url()
    return [
        f"{base}/v-data/botv/work/{session_id}/photo?token={quote(_photo_token(photo), safe='')}"
        for photo in photos
    ]


async def _image_urls(client: YandexDiskClient | None, session_id: str, product_name: str, photos: list[Path]) -> list[str]:
    if os.getenv("BOTV_WEB_LOCAL_IMAGES") == "1":
        return [photo.resolve().as_uri() for photo in photos]
    if os.getenv("BOTV_WEB_PUBLIC_IMAGES", "1").strip().lower() not in {"0", "false", "no", "off"}:
        return _public_photo_urls(session_id, photos)
    if client is None:
        return _public_photo_urls(session_id, photos)
    return await upload_product_photos(
        client=client,
        base_dir=config.yandex_disk_upload_dir,
        product_name=product_name,
        photos=photos,
    )


def generate_xml(session_id: str, phone: str | None = None) -> dict:
    state_path = _session_dir(session_id) / "state.json"
    state = _read_json(state_path)
    products = [p for p in state["products"] if not p.get("deleted")]
    missing = [i for i, p in enumerate(products, 1) if not (p.get("ad_title") or "").strip() or p.get("price") is None]
    if missing:
        raise SystemExit("Не заполнены название или цена: " + ", ".join(f"#{i}" for i in missing))
    settings_dir = config.settings_dir
    description = DescriptionRenderer(settings_dir / "description_template.txt")
    xml_gen = XmlGenerator(defaults_path=settings_dir / "avito_defaults.json", schema_path=settings_dir / "xml_schema.json")
    locations = load_locations(settings_dir / "locations.json")
    color_detector = ColorDetector(settings_dir / "color_rules.json")
    brands = []
    brands_path = settings_dir / "brands_cache.json"
    if brands_path.exists():
        try:
            raw = json.loads(brands_path.read_text(encoding="utf-8"))
            brands = raw if isinstance(raw, list) else raw.get("brands", [])
        except Exception:
            brands = []
    schema = json.loads((settings_dir / "xml_schema.json").read_text(encoding="utf-8"))
    id_prefix = schema.get("id_prefix", "SKU-")
    import asyncio
    use_public_images = os.getenv("BOTV_WEB_PUBLIC_IMAGES", "1").strip().lower() not in {"0", "false", "no", "off"}
    use_local_images = os.getenv("BOTV_WEB_LOCAL_IMAGES") == "1"
    yd = None if (use_local_images or use_public_images) else YandexDiskClient(config.yandex_disk_token)
    if yd is not None:
        asyncio.run(yd.ensure_dir(config.yandex_disk_upload_dir))
    sizes = choose_sizes(len(products))
    ads: list[AvitoAd] = []
    for idx, product in enumerate(products, 1):
        name = product["name"]
        title = (product.get("ad_title") or name).strip()
        price = int(product["price"])
        color = color_detector.detect(f"{name} {title}")
        price_fmt = f"{price:,}".replace(",", " ")
        brand = detect_brand(name, brands)
        base_extra = product_extra(f"{name} {title}", sizes[idx - 1])
        photos = [Path(p) for p in product.get("photos", [])]
        text = description.render(title=name, color=color, price=price_fmt, design="")
        product["description"] = text
        product["details"] = _product_details(name, photos)
        images = asyncio.run(_image_urls(yd, session_id, name, photos))
        for location_index, extra in enumerate(location_extras(locations, base_extra), 1):
            ad_number = (idx - 1) * len(locations) + location_index
            ads.append(AvitoAd(ad_id=make_ad_id(id_prefix, ad_number), title=title, price=price, description=text, color=color, images=images, brand=brand, extra=extra))
    xml_text = xml_gen.build(ads).decode("utf-8")
    if phone:
        xml_text = _replace_phone(xml_text, phone)
    xml_bytes = xml_text.encode("utf-8")
    suffix = "_phone" if phone else ""
    out_path = _session_dir(session_id) / f"avito_{int(time.time())}{suffix}.xml"
    out_path.write_bytes(xml_bytes)
    message = f"XML создан: {len(ads)} объявлений"
    if phone:
        message = f"XML с новым телефоном создан: {len(ads)} объявлений"
    state["progress"] = [*state.get("progress", []), message][-12:]
    state["last_xml"] = str(out_path)
    state["updated_at"] = int(time.time())
    _write_json(state_path, state)
    return {"filename": out_path.name, "xml": xml_text, "ads": len(ads), "products": len(products)}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_create = sub.add_parser("create"); p_create.add_argument("archive"); p_create.add_argument("source_name")
    p_link = sub.add_parser("link"); p_link.add_argument("url")
    p_state = sub.add_parser("state"); p_state.add_argument("session_id")
    p_list = sub.add_parser("list"); p_list.add_argument("--limit", type=int, default=20)
    p_update = sub.add_parser("update"); p_update.add_argument("session_id"); p_update.add_argument("payload")
    p_xml = sub.add_parser("xml"); p_xml.add_argument("session_id"); p_xml.add_argument("--phone", default="")
    p_photo = sub.add_parser("photo"); p_photo.add_argument("token")
    args = parser.parse_args()
    if args.cmd == "create":
        print(json.dumps(create_from_archive(Path(args.archive), args.source_name), ensure_ascii=False))
    elif args.cmd == "link":
        print(json.dumps(create_from_link(args.url), ensure_ascii=False))
    elif args.cmd == "state":
        print(json.dumps(_public_state(_read_json(_session_dir(args.session_id) / "state.json")), ensure_ascii=False))
    elif args.cmd == "list":
        print(json.dumps(list_sessions(args.limit), ensure_ascii=False))
    elif args.cmd == "update":
        print(json.dumps(update_session(args.session_id, json.loads(args.payload)), ensure_ascii=False))
    elif args.cmd == "xml":
        print(json.dumps(generate_xml(args.session_id, args.phone or None), ensure_ascii=False))
    elif args.cmd == "photo":
        path = _photo_path(args.token).resolve()
        if path.suffix.lower() not in IMAGE_EXTENSIONS or not path.exists():
            raise SystemExit("not found")
        print(str(path))


if __name__ == "__main__":
    main()
