from __future__ import annotations

import logging
import re
import shutil
import time
import asyncio
from html import escape
from pathlib import Path

from aiogram import Bot, F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import BufferedInputFile, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from config import ARCHIVE_EXTENSIONS, config
from services.archive import ArchiveError, extract_archive, is_archive, scan_products
from services.ai_description import AVITO_COLORS, detect_product_color, generate_design_block
from services.color_parser import parse_ordered_colors
from services.description import DescriptionRenderer
from services.price_parser import parse_prices
from services.brand_detector import detect_brand
from services.product_rules import choose_sizes, load_locations, location_extras, product_extra
from services.xml_generator import AvitoAd, XmlGenerator, make_ad_id
from services.yandex_disk import YandexDiskClient, YandexDiskError, extract_disk_link, upload_product_photos
from utils.states import DropStates

log = logging.getLogger(__name__)
router = Router()
AD_TITLE_BUTTONS_PER_PAGE = 50


# ------------- helpers -------------

def _session_dir(user_id: int) -> Path:
    return config.tmp_dir / f"user_{user_id}_{int(time.time())}"


def _cleanup(path: Path | None) -> None:
    if path and path.exists():
        shutil.rmtree(path, ignore_errors=True)


def _format_product_list(products: list[dict], max_chars: int = 3000) -> str:
    blocks: list[str] = []
    for i, prod in enumerate(products, 1):
        name = prod["name"]
        ad_title = (prod.get("ad_title") or "").strip()
        title_line = (
            f"\n   Объявление: <b>{escape(ad_title)}</b>"
            if ad_title
            else "\n   Объявление: <b>не задано</b> ⚠️"
        )
        block = (
            f"{i}. Описание: {escape(name)} — {len(prod['photos'])} фото"
            f"{title_line}"
        )
        candidate = "\n".join([*blocks, block])
        if len(candidate) > max_chars:
            omitted = len(products) - len(blocks)
            blocks.append(
                f"… ещё <b>{omitted}</b> товаров — используй кнопки ниже."
            )
            break
        blocks.append(block)
    return "\n".join(blocks)


def _ad_titles_keyboard(products: list[dict], page: int = 0) -> InlineKeyboardMarkup | None:
    missing = [
        (i, product)
        for i, product in enumerate(products, 1)
        if not (product.get("ad_title") or "").strip()
    ]
    if not missing:
        return None

    total_pages = (len(missing) - 1) // AD_TITLE_BUTTONS_PER_PAGE + 1
    page = max(0, min(page, total_pages - 1))
    start = page * AD_TITLE_BUTTONS_PER_PAGE
    page_items = missing[start:start + AD_TITLE_BUTTONS_PER_PAGE]

    buttons: list[list[InlineKeyboardButton]] = []
    for i, product in page_items:
        label = product["name"]
        buttons.append([InlineKeyboardButton(
            text=f"✏️ #{i} {label[:32]}…",
            callback_data=f"rename:{i}:{page}",
        )])

    if total_pages > 1:
        nav: list[InlineKeyboardButton] = []
        if page > 0:
            nav.append(InlineKeyboardButton(
                text="←",
                callback_data=f"titles_page:{page - 1}",
            ))
        nav.append(InlineKeyboardButton(
            text=f"{page + 1}/{total_pages}",
            callback_data="titles_page:noop",
        ))
        if page < total_pages - 1:
            nav.append(InlineKeyboardButton(
                text="→",
                callback_data=f"titles_page:{page + 1}",
            ))
        buttons.append(nav)

    return InlineKeyboardMarkup(inline_keyboard=buttons)


def _missing_ad_title_indices(products: list[dict]) -> list[int]:
    return [
        i for i, product in enumerate(products, 1)
        if not (product.get("ad_title") or "").strip()
    ]


# ------------- 1) Приём архива -------------

@router.message(DropStates.waiting_archive, F.document)
async def on_archive(message: Message, state: FSMContext, bot: Bot) -> None:
    doc = message.document
    if doc is None:
        return

    if not is_archive(doc.file_name or ""):
        await message.answer(
            "❌ Пришли архив с расширением .zip, .rar или .7z.\n"
            f"Полученный файл: <code>{escape(doc.file_name or '')}</code>"
        )
        return

    TG_LIMIT_MB = 20
    TG_LIMIT_BYTES = TG_LIMIT_MB * 1024 * 1024

    file_size_mb = (doc.file_size or 0) / 1024 / 1024

    if doc.file_size and doc.file_size > TG_LIMIT_BYTES:
        await message.answer(
            f"❌ Файл слишком большой ({file_size_mb:.1f} МБ), лимит Telegram — {TG_LIMIT_MB} МБ.\n"
            "Пришли ссылку на Яндекс.Диск или раздели архив на части."
        )
        return

    max_bytes = config.max_archive_mb * 1024 * 1024
    if doc.file_size and doc.file_size > max_bytes:
        await message.answer(
            f"❌ Файл слишком большой ({file_size_mb:.1f} МБ). "
            f"Максимум — {config.max_archive_mb} МБ."
        )
        return

    session_dir = _session_dir(message.from_user.id)
    session_dir.mkdir(parents=True, exist_ok=True)
    archive_local = session_dir / (doc.file_name or "drop.zip")

    status = await message.answer("⬇️ Скачиваю архив…")
    try:
        await bot.download(doc, destination=archive_local)
    except Exception as exc:  # noqa: BLE001
        log.exception("download failed")
        _cleanup(session_dir)
        err_msg = str(exc)
        if "file is too big" in err_msg.lower():
            await status.edit_text(
                f"❌ Файл слишком большой ({file_size_mb:.1f} МБ), лимит — {TG_LIMIT_MB} МБ."
            )
        else:
            await status.edit_text(f"❌ Не удалось скачать файл: {escape(err_msg)}")
        return

    extract_dir = session_dir / "extracted"
    try:
        await status.edit_text("📦 Распаковываю…")
        root = await asyncio.to_thread(extract_archive, archive_local, extract_dir)
    except ArchiveError as exc:
        _cleanup(session_dir)
        await status.edit_text(f"❌ {escape(str(exc))}")
        return

    products = scan_products(root)
    if not products:
        _cleanup(session_dir)
        await status.edit_text(
            "❌ В архиве не нашлось папок с фотографиями. "
            "Проверь структуру: <code>Дроп/Товар/photo.jpg</code>"
        )
        return

    total_photos = sum(len(p["photos"]) for p in products)
    await state.update_data(
        session_dir=str(session_dir),
        root=str(root),
        products=[
            {"name": p["name"], "ad_title": "", "photos": [str(x) for x in p["photos"]]}
            for p in products
        ],
    )
    await state.set_state(DropStates.waiting_prices)

    state_products = [
        {"name": p["name"], "ad_title": "", "photos": [str(x) for x in p["photos"]]}
        for p in products
    ]
    kb = _ad_titles_keyboard(state_products)
    await status.edit_text(
        f"{_format_product_list(state_products)}\n\n"
        f"<b>{len(products)}</b> товаров, <b>{total_photos}</b> фото.\n\n"
        "Сначала задай название объявления для каждого товара кнопками ниже. "
        "После этого пришли цены по порядку, каждая с новой строки.",
        reply_markup=kb,
    )


@router.message(DropStates.waiting_archive, F.text)
async def on_disk_link(message: Message, state: FSMContext) -> None:
    """Принимает публичную ссылку на папку Яндекс.Диска вместо архива."""
    link = extract_disk_link(message.text or "")
    if not link:
        await message.answer("Жду архив или ссылку на Яндекс.Диск.")
        return

    session_dir = _session_dir(message.from_user.id)
    local_root = session_dir / "disk_download"

    status = await message.answer("🔗 Скачиваю папку с Яндекс.Диска…")

    yd = YandexDiskClient(config.yandex_disk_token)
    downloaded = 0
    last_progress_at = 0.0

    async def on_progress(done: int, total: int, unit: str = "files") -> None:
        nonlocal downloaded, last_progress_at
        now = time.monotonic()
        if unit == "bytes":
            if now - last_progress_at < 3 and done != total:
                return
            done_mb = done / 1024 / 1024
            total_mb = total / 1024 / 1024 if total else 0
            percent = done * 100 / total if total else 0
            progress_text = (
                f"⬇️ Скачиваю архив: {done_mb:.1f}/{total_mb:.1f} МБ "
                f"({percent:.0f}%)…"
                if total
                else f"⬇️ Скачиваю архив: {done_mb:.1f} МБ…"
            )
        elif done - downloaded >= 5 or done == total:
            progress_text = f"⬇️ Скачиваю с Диска: {done}/{total} фото…"
        else:
            return

        downloaded = done
        last_progress_at = now
        try:
            await status.edit_text(progress_text)
        except Exception:
            pass

    try:
        await yd.download_public_folder(
            link,
            local_root,
            progress_cb=on_progress,
            max_size_bytes=config.max_archive_mb * 1024 * 1024,
        )
    except YandexDiskError as exc:
        _cleanup(session_dir)
        await status.edit_text(f"❌ {escape(str(exc))}")
        return

    # Если скачали архив с Диска — распаковываем его
    downloaded_archives = list(local_root.glob("*.zip")) + list(local_root.glob("*.rar")) + list(local_root.glob("*.7z"))
    if downloaded_archives:
        archive_path = downloaded_archives[0]
        extract_dir = session_dir / "extracted"
        try:
            await status.edit_text("📦 Распаковываю скачанный архив…")
            local_root = await asyncio.to_thread(
                extract_archive,
                archive_path,
                extract_dir,
            )
        except ArchiveError as exc:
            _cleanup(session_dir)
            await status.edit_text(f"❌ {escape(str(exc))}")
            return

    products = scan_products(local_root)
    if not products:
        _cleanup(session_dir)
        await status.edit_text("❌ Не нашлось товаров с фото.")
        return

    total_photos = sum(len(p["photos"]) for p in products)
    await state.update_data(
        session_dir=str(session_dir),
        root=str(local_root),
        products=[
            {"name": p["name"], "ad_title": "", "photos": [str(x) for x in p["photos"]]}
            for p in products
        ],
    )
    await state.set_state(DropStates.waiting_prices)

    state_products = [
        {"name": p["name"], "ad_title": "", "photos": [str(x) for x in p["photos"]]}
        for p in products
    ]
    kb = _ad_titles_keyboard(state_products)
    await status.edit_text(
        f"{_format_product_list(state_products)}\n\n"
        f"<b>{len(products)}</b> товаров, <b>{total_photos}</b> фото.\n\n"
        "Сначала задай название объявления для каждого товара кнопками ниже. "
        "После этого пришли цены по порядку, каждая с новой строки.",
        reply_markup=kb,
    )


@router.message(DropStates.waiting_archive)
async def on_wrong_archive_message(message: Message) -> None:
    await message.answer("Жду архив или ссылку на Яндекс.Диск.")


# ------------- 2) Переименование через inline-кнопки -------------


@router.callback_query(F.data.startswith("titles_page:"))
async def on_ad_titles_page(callback: CallbackQuery, state: FSMContext) -> None:
    raw_page = callback.data.split(":", 1)[1]
    if raw_page == "noop":
        await callback.answer()
        return

    data = await state.get_data()
    products: list[dict] = data.get("products") or []
    try:
        page = int(raw_page)
    except ValueError:
        await callback.answer()
        return

    await callback.message.edit_reply_markup(reply_markup=_ad_titles_keyboard(products, page))
    await callback.answer()


@router.callback_query(F.data.startswith("rename:"))
async def on_rename_button(callback: CallbackQuery, state: FSMContext) -> None:
    parts = callback.data.split(":")
    idx = int(parts[1])
    page = int(parts[2]) if len(parts) > 2 else 0
    data = await state.get_data()
    products: list[dict] = data.get("products") or []

    if idx < 1 or idx > len(products):
        await callback.answer("Товар не найден.")
        return

    await state.update_data(
        rename_idx=idx,
        rename_keyboard_chat_id=callback.message.chat.id,
        rename_keyboard_message_id=callback.message.message_id,
        rename_keyboard_page=page,
    )
    await state.set_state(DropStates.waiting_rename)
    await callback.message.answer(
        f"Введи название объявления для #{idx}.\n"
        f"Название в описании останется прежним: "
        f"<b>{escape(products[idx - 1]['name'])}</b>"
    )
    await callback.answer()


@router.message(DropStates.waiting_rename, F.text)
async def on_rename_text(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    idx = data.get("rename_idx", 0)
    products: list[dict] = list(data.get("products") or [])

    if idx < 1 or idx > len(products):
        await state.set_state(DropStates.waiting_prices)
        return

    new_title = message.text.strip()
    if not new_title:
        await message.answer("Название объявления не может быть пустым.")
        return
    if len(new_title) > 50:
        await message.answer(
            f"Название слишком длинное: {len(new_title)} символов. Максимум — 50."
        )
        return

    products[idx - 1] = {**products[idx - 1], "ad_title": new_title}
    await state.update_data(products=products, rename_idx=None)
    await state.set_state(DropStates.waiting_prices)

    total_photos = sum(len(p["photos"]) for p in products)
    page = int(data.get("rename_keyboard_page") or 0)
    kb = _ad_titles_keyboard(products, page)
    try:
        await message.bot.edit_message_reply_markup(
            chat_id=data.get("rename_keyboard_chat_id"),
            message_id=data.get("rename_keyboard_message_id"),
            reply_markup=kb,
        )
    except Exception:
        pass

    missing_count = sum(not (p.get("ad_title") or "").strip() for p in products)
    next_step = (
        f"Осталось задать названий: <b>{missing_count}</b>."
        if missing_count
        else "Все названия заданы. Теперь пришли цены по порядку, каждая с новой строки."
    )
    await message.answer(
        f"✅ Объявление #{idx} → «{escape(new_title)}»\n\n"
        f"{_format_product_list(products)}\n\n"
        f"<b>{len(products)}</b> товаров, <b>{total_photos}</b> фото.\n\n"
        f"{next_step}",
        reply_markup=kb,
    )


# ------------- 3) Приём цен -------------


@router.message(DropStates.waiting_prices, F.text)
async def on_prices(message: Message, state: FSMContext, bot: Bot, brands: list[str] | None = None) -> None:
    data = await state.get_data()
    products = data.get("products") or []
    if not products:
        await state.set_state(DropStates.waiting_archive)
        await message.answer("Сессия сброшена, пришли архив заново.")
        return

    missing_titles = _missing_ad_title_indices(products)
    if missing_titles:
        numbers = ", ".join(f"#{i}" for i in missing_titles)
        await message.answer(
            f"⚠️ Сначала задай названия всех объявлений. Не заполнены: {numbers}.",
            reply_markup=_ad_titles_keyboard(products),
        )
        return

    names = [p["name"] for p in products]
    result = parse_prices(message.text or "", names)

    if result.missing:
        missing_txt = "\n".join(f"• {escape(n)}" for n in result.missing)
        unmatched_txt = ""
        if result.unmatched_lines:
            unmatched_txt = "\n\nНе распознал строки:\n" + "\n".join(
                f"• <code>{escape(x)}</code>" for x in result.unmatched_lines
            )
        await message.answer(
            "⚠️ Не хватает цен для товаров:\n"
            f"{missing_txt}"
            f"{unmatched_txt}\n\n"
            "Пришли полный список ещё раз."
        )
        return

    prices_map = {m.product_name: m.price for m in result.matched}
    await state.update_data(prices=prices_map)

    colors, missing_indices = await _detect_colors(message, products)
    await state.update_data(colors=colors, color_missing_indices=missing_indices)
    if missing_indices:
        await state.set_state(DropStates.waiting_colors)
        names = "\n".join(
            f"{position}. {escape(products[index - 1]['name'])}"
            for position, index in enumerate(missing_indices, 1)
        )
        await message.answer(
            "Не удалось автоматически определить цвет для этих товаров:\n"
            f"{names}\n\n"
            "Пришли цвета по порядку, каждый с новой строки.\n"
            f"Допустимые значения: {', '.join(AVITO_COLORS)}"
        )
        return

    await state.set_state(DropStates.processing)
    await _process_and_send_xml(message, state, bot, brands)


@router.message(DropStates.waiting_prices)
async def on_prices_wrong_type(message: Message) -> None:
    await message.answer("Жду сообщение с ценами текстом.")


async def _detect_colors(message: Message, products: list[dict]) -> tuple[dict[str, str], list[int]]:
    if not config.gigachat_credentials:
        return {}, list(range(1, len(products) + 1))

    status = await message.answer("🎨 Определяю цвета товаров по фотографиям…")
    colors: dict[str, str] = {}
    missing: list[int] = []
    for index, product in enumerate(products, 1):
        photos = [Path(path) for path in product.get("photos") or []]
        color = None
        for photo in photos:
            color = await detect_product_color(
                photo,
                config.gigachat_credentials,
                scope=config.gigachat_scope,
                model=config.gigachat_vision_model,
                verify_ssl=config.gigachat_verify_ssl,
            )
            if color:
                break
        if color:
            colors[product["name"]] = color
        else:
            missing.append(index)
    try:
        await status.delete()
    except Exception:
        pass
    return colors, missing


@router.message(DropStates.waiting_colors, F.text)
async def on_colors(message: Message, state: FSMContext, bot: Bot, brands: list[str] | None = None) -> None:
    data = await state.get_data()
    products: list[dict] = data.get("products") or []
    missing_indices: list[int] = data.get("color_missing_indices") or []
    parsed = parse_ordered_colors(message.text or "", len(missing_indices))
    if parsed is None:
        await message.answer(
            f"Нужно прислать ровно {len(missing_indices)} цветов, каждый с новой строки.\n"
            f"Допустимые значения: {', '.join(AVITO_COLORS)}"
        )
        return

    colors: dict[str, str] = dict(data.get("colors") or {})
    for index, color in zip(missing_indices, parsed):
        colors[products[index - 1]["name"]] = color
    await state.update_data(colors=colors, color_missing_indices=[])
    await state.set_state(DropStates.processing)
    await _process_and_send_xml(message, state, bot, brands)


@router.message(DropStates.waiting_colors)
async def on_colors_wrong_type(message: Message) -> None:
    await message.answer("Жду список цветов текстом.")


# ------------- 3) Обработка и отправка XML -------------

async def _process_and_send_xml(message: Message, state: FSMContext, bot: Bot, brands: list[str] | None = None) -> None:
    data = await state.get_data()
    products: list[dict] = data.get("products") or []
    prices: dict[str, int] = data.get("prices") or {}
    colors: dict[str, str] = data.get("colors") or {}
    session_dir = Path(data.get("session_dir") or "")

    settings_dir = config.settings_dir
    description = DescriptionRenderer(settings_dir / "description_template.txt")
    xml_gen = XmlGenerator(
        defaults_path=settings_dir / "avito_defaults.json",
        schema_path=settings_dir / "xml_schema.json",
    )
    import json
    id_prefix = "SKU-"
    try:
        schema = json.loads((settings_dir / "xml_schema.json").read_text(encoding="utf-8"))
        id_prefix = schema.get("id_prefix", id_prefix)
    except Exception:
        pass
    try:
        locations = load_locations(settings_dir / "locations.json")
    except (OSError, ValueError, TypeError) as exc:
        await state.set_state(DropStates.waiting_archive)
        await message.answer(f"❌ Ошибка настройки адресов: {escape(str(exc))}")
        return

    status = await message.answer("☁️ Загружаю фото на Яндекс.Диск…")
    yd = YandexDiskClient(config.yandex_disk_token)

    ads: list[AvitoAd] = []
    errors: list[str] = []

    try:
        await yd.ensure_dir(config.yandex_disk_upload_dir)
    except YandexDiskError as exc:
        _cleanup(session_dir)
        await state.clear()
        await state.set_state(DropStates.waiting_archive)
        await status.edit_text(f"❌ Не удалось создать папку на Диске: {escape(str(exc))}")
        return

    total = len(products)
    product_sizes = choose_sizes(total)
    for idx, prod in enumerate(products, 1):
        name = prod["name"]
        ad_title = prod["ad_title"].strip()
        photos = [Path(p) for p in prod["photos"]]

        try:
            await status.edit_text(
                f"☁️ [{idx}/{total}] Загружаю «{escape(name)}» — {len(photos)} фото…"
            )
        except Exception:
            pass

        try:
            urls = await upload_product_photos(
                client=yd,
                base_dir=config.yandex_disk_upload_dir,
                product_name=name,
                photos=photos,
            )
        except YandexDiskError as exc:
            log.exception("upload failed for %s", name)
            errors.append(f"«{name}»: {exc}")
            continue

        color = colors[name]
        price_val = prices[name]
        price_fmt = f"{price_val:,}".replace(",", " ")
        size = product_sizes[idx - 1]

        design_text = ""
        if config.gigachat_credentials:
            design_text = await generate_design_block(
                name,
                config.gigachat_credentials,
                scope=config.gigachat_scope,
                model=config.gigachat_model,
                verify_ssl=config.gigachat_verify_ssl,
            ) or ""

        text = description.render(title=name, color=color, price=price_fmt, design=design_text)
        brand = detect_brand(name, brands or [])
        base_extra = product_extra(f"{name} {ad_title}", size)
        variants = location_extras(locations, base_extra)
        for location_index, extra in enumerate(variants, 1):
            ad_number = (idx - 1) * len(locations) + location_index
            ad = AvitoAd(
                ad_id=make_ad_id(id_prefix, ad_number),
                title=ad_title,
                price=prices[name],
                description=text,
                color=color,
                images=urls,
                brand=brand,
                extra=extra,
            )
            ads.append(ad)

    if not ads:
        _cleanup(session_dir)
        await state.clear()
        await state.set_state(DropStates.waiting_archive)
        err_txt = "\n".join(f"• {escape(e)}" for e in errors)
        await status.edit_text(f"❌ Не удалось обработать ни одного товара.\n{err_txt}")
        return

    xml_bytes = xml_gen.build(ads)
    filename = f"avito_{int(time.time())}.xml"

    await message.answer_document(
        BufferedInputFile(xml_bytes, filename=filename),
        caption=(
            f"✅ Готово!\n"
            f"Товаров: <b>{len(products) - len(errors)}</b>\n"
            f"Объявлений: <b>{len(ads)}</b> ({len(locations)} города на товар)\n"
            f"Фото: <b>{sum(len(p['photos']) for p in products)}</b>\n"
            + (f"\n⚠️ Ошибки:\n" + "\n".join(f"• {escape(e)}" for e in errors) if errors else "")
        ),
    )

    _cleanup(session_dir)
    await state.clear()
    await state.set_state(DropStates.waiting_archive)
    try:
        await status.delete()
    except Exception:
        pass


# ------------- 4) Пока идёт обработка -------------

@router.message(DropStates.processing)
async def on_processing(message: Message) -> None:
    await message.answer("⏳ Всё ещё обрабатываю предыдущий архив, подожди…")
