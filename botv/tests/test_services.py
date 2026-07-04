"""Tests for botv services."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# price_parser tests
# ---------------------------------------------------------------------------

from services.price_parser import parse_prices
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
    assert normalize_avito_color("«тёмно-синий»") == "Тёмно-синий"
    assert normalize_avito_color("Основной цвет одежды: белый.") == "Белый"
    assert parse_ordered_colors("Белый\nхаки", 2) == ["Белый", "Хаки"]
    assert parse_ordered_colors("Белый", 2) is None
    assert parse_ordered_colors("Неизвестный", 1) is None


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


# ---------------------------------------------------------------------------
# color_detector tests
# ---------------------------------------------------------------------------

from services.color_detector import ColorDetector

_SETTINGS_DIR = Path(__file__).resolve().parent.parent / "settings"


def test_color_detector_black():
    cd = ColorDetector(_SETTINGS_DIR / "color_rules.json")
    assert cd.detect("Футболка Oversize Black") == "Чёрный"


def test_color_detector_vintage_grey():
    cd = ColorDetector(_SETTINGS_DIR / "color_rules.json")
    # "vintage grey" is a longer keyword and should match before "grey"
    assert cd.detect("Футболка Vintage Grey") == "Серый винтаж"


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
    assert result == "Без бренда"


def test_brand_detect_longest_match():
    brands = ["Saint", "Saint Michael", "Без бренда"]
    assert detect_brand("Футболка Saint Michael Святой враг", brands) == "Saint Michael"


def test_brand_does_not_match_model_word():
    brands = ["Paul", "Frank", "Golden", "Без бренда"]
    title = "Футболка Paul Frank 'Golden Julius Arch' tee"
    assert detect_brand(title, brands) == "Без бренда"


# ---------------------------------------------------------------------------
# xml_generator tests
# ---------------------------------------------------------------------------

from services.xml_generator import AvitoAd, XmlGenerator
from handlers.drop import _format_product_list, _missing_ad_title_indices
from handlers.common import START_BUTTON_TEXT, START_KEYBOARD


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


def test_xml_has_required_size():
    gen, td = _make_xml_generator()
    with td:
        xml = gen.build([_sample_ad(extra={"Size": "48 (M)"})]).decode("utf-8")
    assert "<Size>48 (M)</Size>" in xml


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
    assert START_KEYBOARD.keyboard[0][0].text == START_BUTTON_TEXT


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


def test_xml_brand_skipped_when_none():
    gen, td = _make_xml_generator()
    with td:
        xml = gen.build([_sample_ad(brand=None)]).decode("utf-8")
    assert "<Brand>" not in xml


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
