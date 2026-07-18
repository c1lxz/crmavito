"""Tests for botv services."""
from __future__ import annotations

import json
import asyncio
import tempfile
from pathlib import Path

import pytest
from services.yandex_disk import YandexDiskClient


# ---------------------------------------------------------------------------
# price_parser tests
# ---------------------------------------------------------------------------


class _FakeDiskResponse:
    def __init__(self, status: int, text: str = "") -> None:
        self.status = status
        self._text = text

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def text(self) -> str:
        return self._text


class _FakeDiskSession:
    def __init__(self) -> None:
        self.put_calls = 0
        self.get_calls = 0

    def put(self, *args, **kwargs):
        self.put_calls += 1
        if self.put_calls == 1:
            return _FakeDiskResponse(423, '{"error":"DiskResourceLockedError"}')
        return _FakeDiskResponse(201)

    def get(self, *args, **kwargs):
        self.get_calls += 1
        return _FakeDiskResponse(200)


def test_yandex_disk_mkdir_retries_locked_resource(monkeypatch):
    async def no_sleep(delay):
        return None

    monkeypatch.setattr(asyncio, "sleep", no_sleep)
    client = YandexDiskClient("token")
    session = _FakeDiskSession()

    asyncio.run(client._create_dir(session, "Avito"))

    assert session.put_calls == 1
    assert session.get_calls == 1

from services.price_parser import parse_prices
from services.description import DescriptionRenderer
from services.ai_description import _clean_design_text, normalize_avito_color
from services.color_parser import parse_ordered_colors
from services.product_rules import (
    SIZES,
    choose_size,
    choose_sizes,
    load_locations,
    location_extras,
    product_extra,
)


def test_design_text_cleanup():
    assert _clean_design_text("Дизайн: Выразительный графический принт") == (
        "Выразительный графический принт"
    )


def test_color_normalization_and_manual_input():
    assert normalize_avito_color("Основной цвет одежды: белый.") == "Белый"
    assert normalize_avito_color("почти black") == "Чёрный"
    assert normalize_avito_color("красный") is None
    assert parse_ordered_colors("Белый\nчёрный", 2) == ["Белый", "Чёрный"]
    assert parse_ordered_colors("Белый", 2) is None
    assert parse_ordered_colors("Хаки", 1) is None


def test_price_parser_basic():
    products = ["Футболка Oversize Black", "Футболка White Basic", "Футболка Vintage Grey"]
    text = (
        "Футболка Oversize Black — 3290\n"
        "Футболка White Basic - 2 990 ₽\n"
        "Футболка Vintage Grey: 3490"
    )
    result = parse_prices(text, products)
    assert result.missing == []
    prices = {m.product_name: m.price for m in result.matched}
    assert prices["Футболка Oversize Black"] == 3290
    assert prices["Футболка White Basic"] == 2990
    assert prices["Футболка Vintage Grey"] == 3490


def test_price_parser_ordered():
    products = ["Футболка Oversize Black", "Футболка White Basic", "Футболка Vintage Grey"]
    text = "3290\n2990\n3490"
    result = parse_prices(text, products)
    assert result.missing == []
    assert result.matched[0].product_name == "Футболка Oversize Black"
    assert result.matched[0].price == 3290
    assert result.matched[1].price == 2990
    assert result.matched[2].price == 3490


def test_price_parser_ordered_wrong_count():
    products = ["Товар А", "Товар Б", "Товар В"]
    text = "1000\n2000"
    result = parse_prices(text, products)
    assert len(result.missing) == 3


def test_price_parser_missing():
    products = ["Товар А", "Товар Б", "Товар В"]
    text = "Товар А — 1000\nТовар Б — 2000"
    result = parse_prices(text, products)
    assert "Товар В" in result.missing


def test_description_renderer_keeps_plain_newlines_without_html_breaks(tmp_path):
    template = tmp_path / "description_template.txt"
    template.write_text("Title: {title}\nDesign:\n{design}\nPrice: {price}", encoding="utf-8")

    rendered = DescriptionRenderer(template).render(title="Item", color="", design="Line one", price="1990")

    assert rendered == "Title: Item\nDesign:\nLine one\nPrice: 1990"
    assert "<br" not in rendered


# ---------------------------------------------------------------------------
# color_detector tests
# ---------------------------------------------------------------------------

from services.color_detector import ColorDetector

_SETTINGS_DIR = Path(__file__).resolve().parent.parent / "settings"


def test_color_detector_black():
    cd = ColorDetector(_SETTINGS_DIR / "color_rules.json")
    assert cd.detect("Футболка Oversize Black") == "Чёрный"


def test_color_detector_default():
    cd = ColorDetector(_SETTINGS_DIR / "color_rules.json")
    assert cd.detect("Футболка NoColor") == "Чёрный"


# ---------------------------------------------------------------------------
# brand_detector tests
# ---------------------------------------------------------------------------

from services.brand_detector import detect_brand


def test_brand_detect_found():
    brands = ["GOSHA RUBCHINSKIY"]
    result = detect_brand("Футболка Gosha Rubchinskiy Print", brands)
    assert result == "GOSHA RUBCHINSKIY"


def test_brand_detect_not_found():
    brands = ["GOSHA RUBCHINSKIY", "NIKE", "Без бренда"]
    result = detect_brand("Футболка Oversize Unknown Brand", brands)
    assert result is None


def test_brand_detect_longest_match():
    brands = ["Saint", "Saint Michael", "Без бренда"]
    assert detect_brand("Футболка Saint Michael Святой враг", brands) == "Saint Michael"


def test_brand_detect_does_not_emit_without_official_match():
    brands = ["NIKE", "Без бренда"]
    assert detect_brand("Лонгслив Raf Simons Archive", brands) is None


def test_brand_does_not_match_model_word():
    brands = ["Paul", "Frank", "Golden", "Без бренда"]
    title = "Футболка Paul Frank 'Golden Julius Arch' tee"
    assert detect_brand(title, brands) is None


# ---------------------------------------------------------------------------
# xml_generator tests
# ---------------------------------------------------------------------------

from services.xml_generator import AvitoAd, XmlGenerator, make_ad_id
from handlers.drop import (
    _ad_titles_keyboard,
    _format_product_list,
    _missing_ad_title_indices,
    _missing_price_indices,
    _parse_title_and_price,
    _product_prices,
)
from handlers.common import (
    CRM_DESKTOP_BUTTON_TEXT,
    CRM_MOBILE_BUTTON_TEXT,
    CRM_OPEN_BUTTON_TEXT,
    CRM_VERSION_KEYBOARD,
    START_BUTTON_TEXT,
    START_KEYBOARD,
)
from config import Config, DEFAULT_MAX_ARCHIVE_MB


def _make_xml_generator(
    extra_defaults: dict | None = None,
    extra_schema: dict | None = None,
) -> tuple[XmlGenerator, tempfile.TemporaryDirectory]:
    td = tempfile.TemporaryDirectory()
    tmpdir = Path(td.name)

    defaults = {
        "Category": "Одежда, обувь, аксессуары",
        "GoodsType": "Мужская одежда",
        "Condition": "Новое с биркой",
        "AdType": "Товар от производителя",
        "ContactPhone": "+7 900 000 00 00",
        "ContactMethod": "В сообщениях",
        "Address": "Москва",
        "Delivery": "ПВЗ",
        "TryOn": "Есть",
        "DeliverySubsidy": "Нет скидки",
        "Apparel": "Кофты и футболки",
        "GoodsSubType": "Футболка",
        "TargetAudience": "Частные лица",
        "Size": "Без размера",
        "Material": "Хлопок",
    }
    if extra_defaults:
        defaults.update(extra_defaults)

    schema = {
        "root_tag": "Ads",
        "root_attrs": {"formatVersion": "3", "target": "Avito.ru"},
        "ad_tag": "Ad",
        "id_prefix": "SKU-",
        "fields_order": [
            "Id", "ContactPhone", "Address", "Images", "ContactMethod",
            "Title", "Description", "Category", "Delivery", "TryOn",
            "DeliverySubsidy", "Price", "GoodsType", "Condition", "AdType",
            "Brand", "Color", "MaterialsOdezhda", "Apparel", "Size",
            "GoodsSubType", "TargetAudience",
        ],
    }
    if extra_schema:
        schema.update(extra_schema)

    defaults_path = tmpdir / "avito_defaults.json"
    schema_path = tmpdir / "xml_schema.json"
    defaults_path.write_text(json.dumps(defaults, ensure_ascii=False), encoding="utf-8")
    schema_path.write_text(json.dumps(schema, ensure_ascii=False), encoding="utf-8")

    gen = XmlGenerator(defaults_path=defaults_path, schema_path=schema_path)
    return gen, td


def _sample_ad(**kwargs) -> AvitoAd:
    defaults = dict(
        ad_id="SKU-1",
        title="Футболка Test",
        price=1000,
        description="Описание",
        color="Чёрный",
        images=["https://example.com/img.jpg"],
        brand="TEST BRAND",
        material="Хлопок",
    )
    defaults.update(kwargs)
    return AvitoAd(**defaults)


def test_xml_has_materials_odezhda():
    gen, td = _make_xml_generator()
    with td:
        xml = gen.build([_sample_ad()]).decode("utf-8")
    assert "<MaterialsOdezhda>" in xml
    assert "<Option>Хлопок</Option>" in xml


def test_make_ad_id_adds_profile_scope_when_present():
    assert make_ad_id("SKU-", 7) == "SKU-7"
    assert make_ad_id("SKU-", 7, "profile_abc-123") == "SKU-profile_abc-123-7"
    assert make_ad_id("SKU-", 7, "profile abc!") == "SKU-profileabc-7"


def test_xml_has_required_size():
    gen, td = _make_xml_generator()
    with td:
        xml = gen.build([_sample_ad(extra={"Size": "48 (M)"})]).decode("utf-8")
    assert "<Size>48 (M)</Size>" in xml


def test_xml_has_quantity_when_drop_stock_is_set():
    gen, td = _make_xml_generator(extra_schema={
        "fields_order": [
            "Id", "Title", "Description", "Price", "Quantity", "Brand",
        ],
    })
    with td:
        xml = gen.build([_sample_ad(quantity=4)]).decode("utf-8")
    assert "<Price>1000</Price>" in xml
    assert "<Quantity>4</Quantity>" in xml
    assert xml.index("<Price>") < xml.index("<Quantity>") < xml.index("<Brand>")


def test_longsleeve_uses_sweatshirt_subcategory():
    assert product_extra("Лонгслив Saint Michael", "46 (S)") == {
        "Size": "46 (S)",
        "GoodsSubType": "Свитшот",
    }
    assert product_extra("Футболка Saint Michael", "50 (L)") == {"Size": "50 (L)"}
    assert {choose_size() for _ in range(100)} <= set(SIZES)
    generated = choose_sizes(7)
    assert set(generated[:3]) == set(SIZES)
    assert set(generated[3:6]) == set(SIZES)


def test_locations_are_exact_and_generate_one_ad_per_city():
    locations = load_locations(_SETTINGS_DIR / "locations.json")
    assert [location["city"] for location in locations] == [
        "Санкт-Петербург",
        "Москва",
        "Нижний Новгород",
    ]
    assert [location["address"] for location in locations] == [
        "Санкт-Петербург, Невский проспект, 30",
        "Москва, Болотниковская ул., 12",
        "Нижний Новгород, Советская пл., 5",
    ]
    assert all(location["address"] != location["city"] for location in locations)

    gen, td = _make_xml_generator()
    with td:
        variants = location_extras(
            locations,
            {"Size": "48 (M)", "GoodsSubType": "Свитшот"},
        )
        ads = [
            _sample_ad(
                ad_id=f"SKU-{index}",
                title="Лонгслив Test",
                price=3490,
                description="Цена: 3 490₽",
                images=["https://disk.yandex.ru/i/one", "https://disk.yandex.ru/i/two"],
                extra=extra,
            )
            for index, extra in enumerate(variants, 1)
        ]
        xml = gen.build(ads).decode("utf-8")
    assert xml.count("<Ad>") == 3
    assert xml.count("<Price>3490</Price>") == 3
    assert xml.count("Цена: 3 490₽") == 3
    assert xml.count("<Size>48 (M)</Size>") == 3
    assert xml.count("<GoodsSubType>Свитшот</GoodsSubType>") == 3
    assert xml.count("https://disk.yandex.ru/i/one") == 3
    assert len({ad.ad_id for ad in ads}) == 3
    for location in locations:
        assert xml.count(f"<Address>{location['address']}</Address>") == 1
        assert f"<Address>{location['address']}</Address>" in xml


def test_all_ad_titles_are_required():
    products = [
        {"name": "Название для описания 1", "ad_title": "Заголовок объявления 1"},
        {"name": "Название для описания 2", "ad_title": ""},
    ]
    assert _missing_ad_title_indices(products) == [2]


def _keyboard_callbacks(keyboard):
    return [
        button.callback_data
        for row in keyboard.inline_keyboard
        for button in row
    ]


def test_ad_title_keyboard_paginates_more_than_100_products():
    products = [
        {"name": f"Товар {i}", "ad_title": "", "photos": ["photo.jpg"]}
        for i in range(1, 143)
    ]

    first_page = _ad_titles_keyboard(products)
    third_page = _ad_titles_keyboard(products, 2)

    assert first_page is not None
    first_callbacks = _keyboard_callbacks(first_page)
    assert len(first_callbacks) == 52
    assert "rename:1:0" in first_callbacks
    assert "rename:50:0" in first_callbacks
    assert "rename:51:0" not in first_callbacks
    assert "titles_page:1" in first_callbacks

    assert third_page is not None
    third_callbacks = _keyboard_callbacks(third_page)
    assert "rename:101:2" in third_callbacks
    assert "rename:142:2" in third_callbacks
    assert "titles_page:1" in third_callbacks


def test_ad_title_keyboard_hides_completed_titles():
    products = [
        {"name": "Товар 1", "ad_title": "Готовое объявление", "photos": ["photo.jpg"]},
        {"name": "Товар 2", "ad_title": "", "photos": ["photo.jpg"]},
    ]

    keyboard = _ad_titles_keyboard(products)

    assert keyboard is not None
    callbacks = _keyboard_callbacks(keyboard)
    assert "rename:1:0" not in callbacks
    assert "rename:2:0" in callbacks


def test_ad_title_keyboard_is_removed_when_all_titles_completed():
    products = [
        {"name": "Товар 1", "ad_title": "Готовое объявление", "photos": ["photo.jpg"]},
    ]

    assert _ad_titles_keyboard(products) is None


def test_parse_title_and_price_from_two_lines():
    assert _parse_title_and_price("Футболка Oversize Black\n3 290 ₽") == (
        "Футболка Oversize Black",
        3290,
    )


def test_parse_title_and_price_requires_two_lines():
    assert _parse_title_and_price("Футболка Oversize Black") is None


def test_product_prices_include_button_prices():
    products = [
        {"name": "Товар 1", "ad_title": "Объявление 1", "price": 3290},
        {"name": "Товар 2", "ad_title": "Объявление 2", "price": None},
    ]

    assert _missing_price_indices(products) == [2]
    assert _product_prices(products, {"Товар 2": 4490}) == {
        "Товар 1": 3290,
        "Товар 2": 4490,
    }


def test_default_archive_limit_is_1536_mb(monkeypatch):
    monkeypatch.delenv("MAX_ARCHIVE_MB", raising=False)
    assert DEFAULT_MAX_ARCHIVE_MB == 1536
    assert Config().max_archive_mb == 1536


def test_large_product_list_fits_telegram_message():
    products = [
        {
            "name": f"Очень длинное исходное название товара номер {i} " * 2,
            "ad_title": "",
            "photos": ["photo.jpg"] * 3,
        }
        for i in range(1, 71)
    ]
    rendered = _format_product_list(products)
    assert len(rendered) <= 3100
    assert "ещё" in rendered


def test_start_keyboard_is_persistent():
    assert START_KEYBOARD.is_persistent is True
    assert START_KEYBOARD.one_time_keyboard is False
    assert START_KEYBOARD.keyboard[1][0].text == START_BUTTON_TEXT


def test_start_keyboard_has_crm_open_button():
    button = START_KEYBOARD.keyboard[0][0]
    assert button.text == CRM_OPEN_BUTTON_TEXT
    assert button.web_app is None


def test_crm_version_keyboard_has_mobile_webapp_and_pc_url():
    mobile = CRM_VERSION_KEYBOARD.inline_keyboard[0][0]
    desktop = CRM_VERSION_KEYBOARD.inline_keyboard[1][0]

    assert mobile.text == CRM_MOBILE_BUTTON_TEXT
    assert mobile.web_app is not None
    assert mobile.web_app.url.endswith("/m/dashboard")
    assert mobile.url is None

    assert desktop.text == CRM_DESKTOP_BUTTON_TEXT
    assert desktop.url.endswith("/pc/dashboard")
    assert desktop.web_app is None

def test_xml_title_is_independent_from_description_name():
    gen, td = _make_xml_generator()
    with td:
        xml = gen.build([
            _sample_ad(
                title="Заголовок объявления",
                description="Исходное название товара\nОписание",
            )
        ]).decode("utf-8")
    assert "<Title>Заголовок объявления</Title>" in xml
    assert "<Description>Исходное название товара" in xml


def test_xml_uses_default_brand_when_detection_misses():
    gen, td = _make_xml_generator()
    with td:
        xml = gen.build([_sample_ad(brand="Без бренда")]).decode("utf-8")
    assert "<Brand>Без бренда</Brand>" in xml


def test_xml_field_order():
    gen, td = _make_xml_generator()
    with td:
        xml = gen.build([_sample_ad()]).decode("utf-8")

    pos_id = xml.index("<Id>")
    pos_title = xml.index("<Title>")
    pos_price = xml.index("<Price>")
    pos_brand = xml.index("<Brand>")

    assert pos_id < pos_title, "Id must come before Title"
    assert pos_title < pos_price, "Title must come before Price"
    assert pos_price < pos_brand, "Price must come before Brand"
