from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import sys
import time
from pathlib import Path

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
from services.yandex_disk import YandexDiskClient, upload_product_photos

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
    }


def _public_state(state: dict) -> dict:
    products = state.get("products", [])
    active = [p for p in products if not p.get("deleted")]
    ready = [p for p in active if (p.get("ad_title") or "").strip() and p.get("price") is not None]
    return {
        "id": state["id"],
        "createdAt": state.get("created_at"),
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
    found = scan_products(root)
    products = [{"name": p["name"], "ad_title": "", "price": None, "photos": [str(photo) for photo in p["photos"]], "deleted": False, "use_original_title": False} for p in found]
    progress.append(f"Найдено товаров: {len(products)}")
    state = {"id": session_id, "created_at": int(time.time()), "source_name": source_name, "session_dir": str(session_dir), "root": str(root), "products": products, "progress": progress}
    _write_json(session_dir / "state.json", state)
    return _public_state(state)


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
    _write_json(state_path, state)
    return _public_state(state)


async def _image_urls(client: YandexDiskClient | None, product_name: str, photos: list[Path]) -> list[str]:
    if client is None:
        return [photo.resolve().as_uri() for photo in photos]
    return await upload_product_photos(
        client=client,
        base_dir=config.yandex_disk_upload_dir,
        product_name=product_name,
        photos=photos,
    )


def generate_xml(session_id: str) -> dict:
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
    yd = None if os.getenv("BOTV_WEB_LOCAL_IMAGES") == "1" else YandexDiskClient(config.yandex_disk_token)
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
        text = description.render(title=name, color=color, price=price_fmt, design="")
        brand = detect_brand(name, brands)
        base_extra = product_extra(f"{name} {title}", sizes[idx - 1])
        photos = [Path(p) for p in product.get("photos", [])]
        images = asyncio.run(_image_urls(yd, name, photos))
        for location_index, extra in enumerate(location_extras(locations, base_extra), 1):
            ad_number = (idx - 1) * len(locations) + location_index
            ads.append(AvitoAd(ad_id=make_ad_id(id_prefix, ad_number), title=title, price=price, description=text, color=color, images=images, brand=brand, extra=extra))
    xml_bytes = xml_gen.build(ads)
    out_path = _session_dir(session_id) / f"avito_{int(time.time())}.xml"
    out_path.write_bytes(xml_bytes)
    state["progress"] = [*state.get("progress", []), f"XML создан: {len(ads)} объявлений"][-12:]
    state["last_xml"] = str(out_path)
    _write_json(state_path, state)
    return {"filename": out_path.name, "xml": xml_bytes.decode("utf-8"), "ads": len(ads), "products": len(products)}


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_create = sub.add_parser("create"); p_create.add_argument("archive"); p_create.add_argument("source_name")
    p_state = sub.add_parser("state"); p_state.add_argument("session_id")
    p_update = sub.add_parser("update"); p_update.add_argument("session_id"); p_update.add_argument("payload")
    p_xml = sub.add_parser("xml"); p_xml.add_argument("session_id")
    p_photo = sub.add_parser("photo"); p_photo.add_argument("token")
    args = parser.parse_args()
    if args.cmd == "create":
        print(json.dumps(create_from_archive(Path(args.archive), args.source_name), ensure_ascii=False))
    elif args.cmd == "state":
        print(json.dumps(_public_state(_read_json(_session_dir(args.session_id) / "state.json")), ensure_ascii=False))
    elif args.cmd == "update":
        print(json.dumps(update_session(args.session_id, json.loads(args.payload)), ensure_ascii=False))
    elif args.cmd == "xml":
        print(json.dumps(generate_xml(args.session_id), ensure_ascii=False))
    elif args.cmd == "photo":
        path = _photo_path(args.token).resolve()
        if path.suffix.lower() not in IMAGE_EXTENSIONS or not path.exists():
            raise SystemExit("not found")
        print(str(path))


if __name__ == "__main__":
    main()
