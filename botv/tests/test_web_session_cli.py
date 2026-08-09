import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path


def _run_cli(*args: str, env: dict[str, str | None] | None = None) -> dict:
    root = Path(__file__).resolve().parents[1]
    python_bin = root / "venv" / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
    if not python_bin.exists():
        python_bin = Path(sys.executable)
    cli_env = {**os.environ, "BOTV_WEB_LOCAL_IMAGES": "1", "GIGACHAT_CREDENTIALS": ""}
    for key, value in (env or {}).items():
        if value is None:
            cli_env.pop(key, None)
        else:
            cli_env[key] = value
    result = subprocess.run(
        [str(python_bin), str(root / "web" / "session_cli.py"), *args],
        cwd=root,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=True,
        env=cli_env,
    )
    return json.loads(result.stdout)


def test_web_session_archive_update_and_xml(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")
        zf.writestr("Drop/Product White/two.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    assert state["summary"]["total"] == 2
    assert state["products"][0]["firstPhoto"]
    assert "Распаковываю архив" in state["progress"]

    updated = _run_cli("update", state["id"], json.dumps({
        "ids": [1],
        "bulkOriginalTitle": True,
        "bulkPrice": 3290,
        "products": [{"index": 2, "deleted": True}],
    }, ensure_ascii=False))
    assert updated["summary"]["active"] == 1
    assert updated["summary"]["deleted"] == 1
    assert updated["products"][0]["adTitle"] == "Product Black"
    assert updated["products"][0]["price"] == 3290

    color_updated = _run_cli("update", state["id"], json.dumps({
        "products": [{"index": 1, "color": "Белый"}],
    }, ensure_ascii=False))
    assert color_updated["products"][0]["color"] == "Белый"
    assert color_updated["products"][0]["details"]["color"] == "Белый"

    stock_updated = _run_cli("update", state["id"], json.dumps({
        "dropStockQuantity": 6,
    }, ensure_ascii=False))
    assert stock_updated["dropStockQuantity"] == 6

    locations_updated = _run_cli("update", state["id"], json.dumps({
        "locations": [
            {
                "city": "Москва",
                "address": "Москва, Болотниковская ул., 12",
                "enabled": False,
            },
            {
                "city": "Казань",
                "address": "Казань, улица Баумана, 1",
                "enabled": True,
                "custom": True,
            },
        ],
    }, ensure_ascii=False))
    assert locations_updated["locations"][0]["enabled"] is False
    assert locations_updated["locations"][1]["custom"] is True

    xml = _run_cli("xml", state["id"])
    assert xml["products"] == 1
    assert xml["ads"] == 1
    assert xml["adIds"] == ["SKU-1"]
    assert xml["xml"].count("<Quantity>6</Quantity>") == 1
    assert "<Address>Казань, улица Баумана, 1</Address>" in xml["xml"]
    assert "Москва, Болотниковская ул., 12" not in xml["xml"]
    assert "Product Black" in xml["xml"]
    assert "Product White" not in xml["xml"]
    assert "<Color>\u0411\u0435\u043b\u044b\u0439</Color>" in xml["xml"]
    assert "\u0414\u0438\u0437\u0430\u0439\u043d:" in xml["xml"]
    assert "\u0413\u0440\u0430\u0444\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0434\u0438\u0437\u0430\u0439\u043d" in xml["xml"]
    assert "&lt;br" not in xml["xml"]
    assert "<br" not in xml["xml"]
    assert "<Delivery>" in xml["xml"]
    assert "<Option>ПВЗ</Option>" in xml["xml"]
    assert "<TryOn>" not in xml["xml"]
    assert "<DeliverySubsidy>" not in xml["xml"]

    repeated_xml = _run_cli("xml", state["id"])
    assert re.findall(r"<Size>([^<]+)</Size>", repeated_xml["xml"]) == re.findall(
        r"<Size>([^<]+)</Size>", xml["xml"]
    )

    phone_xml = _run_cli("xml", state["id"], "--phone", "+7 999 111-22-33")
    assert phone_xml["adIds"] == xml["adIds"]
    assert "+79991112233" in phone_xml["xml"]
    assert "+7 900 000 00 00" not in phone_xml["xml"]
    replaced_phone_xml = re.sub(
        r"<ContactPhone>.*?</ContactPhone>",
        "<ContactPhone>+79991112233</ContactPhone>",
        xml["xml"],
    )
    assert phone_xml["xml"] == replaced_phone_xml


def test_web_session_create_move_consumes_uploaded_archive(tmp_path):
    archive = tmp_path / "large-drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")

    state = _run_cli("create-move", str(archive), "large-drop.zip")

    assert state["summary"]["total"] == 1
    assert not archive.exists()
    session_dir = Path(__file__).resolve().parents[1] / "tmp" / "web_sessions" / state["id"]
    assert not (session_dir / "large-drop.zip").exists()


def test_web_session_photo_reorder(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")
        zf.writestr("Drop/Product Black/two.jpg", b"jpg")
        zf.writestr("Drop/Product Black/three.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    product = state["products"][0]
    assert product["photoCount"] == 3
    third = product["photos"][2]

    updated = _run_cli("update", state["id"], json.dumps({
        "products": [{"index": 1, "movePhoto": {"token": third, "direction": "first"}}],
    }, ensure_ascii=False))

    assert updated["products"][0]["photos"][0] == third
    assert updated["products"][0]["firstPhoto"] == third
    assert updated["products"][0]["description"]
    assert updated["products"][0]["details"]["photos"] == 3


def test_web_session_history_keeps_unfinished_work(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    updated = _run_cli("update", state["id"], json.dumps({
        "products": [{"index": 1, "adTitle": "Saved title", "price": 1990}],
    }, ensure_ascii=False))
    history = _run_cli("list", "--limit", "5")
    saved = next(item for item in history["sessions"] if item["id"] == state["id"])

    assert saved["summary"]["ready"] == 1
    assert saved["summary"]["active"] == 1
    assert saved["updatedAt"] >= saved["createdAt"]

    restored = _run_cli("state", state["id"])
    assert restored["products"][0]["adTitle"] == "Saved title"
    assert restored["products"][0]["price"] == 1990
    assert updated["updatedAt"] >= state["createdAt"]


def test_web_session_xml_uses_product_name_when_ad_title_is_blank(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product One/one.jpg", b"jpg")
        zf.writestr("Drop/Product Two/two.jpg", b"jpg")
        zf.writestr("Drop/Product Three/three.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    by_name = {product["name"]: product["index"] for product in state["products"]}
    updated = _run_cli("update", state["id"], json.dumps({
        "ids": [by_name["Product One"], by_name["Product Three"]],
        "bulkPrice": 1990,
        "products": [{"index": by_name["Product Two"], "deleted": True}],
    }, ensure_ascii=False))

    assert updated["summary"]["active"] == 2
    assert updated["summary"]["ready"] == 2

    xml = _run_cli("xml", state["id"])

    assert xml["products"] == 2
    assert "Product One" in xml["xml"]
    assert "Product Three" in xml["xml"]
    assert "Product Two" not in xml["xml"]


def test_scoped_xml_keeps_city_ids_when_city_selection_changes(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    _run_cli("update", state["id"], json.dumps({
        "products": [{"index": 1, "adTitle": "Stable title", "price": 1990}],
        "locations": [
            {"city": "Москва", "address": "Москва, улица А, 1", "enabled": True},
            {"city": "Казань", "address": "Казань, улица Б, 2", "enabled": True},
        ],
    }, ensure_ascii=False))
    first = _run_cli("xml", state["id"], "--id-scope", "profile-safe")
    first_pairs = dict(re.findall(r"<Id>([^<]+)</Id>[\s\S]*?<Address>([^<]+)</Address>", first["xml"]))

    _run_cli("update", state["id"], json.dumps({
        "locations": [
            {"city": "Казань", "address": "Казань, улица Б, 2", "enabled": True},
            {"city": "Самара", "address": "Самара, улица В, 3", "enabled": True},
        ],
    }, ensure_ascii=False))
    second = _run_cli("xml", state["id"], "--id-scope", "profile-safe")
    second_pairs = dict(re.findall(r"<Id>([^<]+)</Id>[\s\S]*?<Address>([^<]+)</Address>", second["xml"]))

    first_id_by_address = {address: ad_id for ad_id, address in first_pairs.items()}
    second_id_by_address = {address: ad_id for ad_id, address in second_pairs.items()}
    assert second_id_by_address["Казань, улица Б, 2"] == first_id_by_address["Казань, улица Б, 2"]
    assert second_id_by_address["Самара, улица В, 3"] not in set(first_id_by_address.values())


def test_web_session_xml_uses_manual_description(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    manual_description = "Ручное описание объявления\nСостав: хлопок\nЗамеры по запросу"
    updated = _run_cli("update", state["id"], json.dumps({
        "products": [{
            "index": 1,
            "adTitle": "Manual title",
            "price": 1990,
            "description": manual_description,
        }],
    }, ensure_ascii=False))

    assert updated["products"][0]["description"] == manual_description
    assert updated["products"][0]["descriptionManual"] is True

    xml = _run_cli("xml", state["id"])

    assert manual_description in xml["xml"]
    assert "Manual title" in xml["xml"]
    assert "Цена: 1 990" not in xml["xml"]


def test_web_session_cleans_saved_html_breaks_from_descriptions(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    updated = _run_cli("update", state["id"], json.dumps({
        "products": [{
            "index": 1,
            "adTitle": "Clean title",
            "price": 1990,
            "description": "Line one<br>Line two&lt;br&gt;Line three",
        }],
    }, ensure_ascii=False))

    assert updated["products"][0]["description"] == "Line one\nLine two\nLine three"

    restored = _run_cli("state", state["id"])
    assert restored["products"][0]["description"] == "Line one\nLine two\nLine three"

    xml = _run_cli("xml", state["id"])
    assert "Line one\nLine two\nLine three" in xml["xml"]
    assert "<br" not in xml["xml"]
    assert "&lt;br" not in xml["xml"]


def test_web_session_xml_uses_public_photo_urls_by_default(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    _run_cli("update", state["id"], json.dumps({
        "products": [{"index": 1, "adTitle": "Public title", "price": 1990}],
    }, ensure_ascii=False))

    xml = _run_cli(
        "xml",
        state["id"],
        env={
            "BOTV_WEB_LOCAL_IMAGES": None,
            "BOTV_PUBLIC_IMAGE_BASE_URL": "http://images.example.test",
        },
    )

    assert "file://" not in xml["xml"]
    assert f"http://images.example.test/v-static/botv/{state['id']}/" in xml["xml"]
    assert "/v-data/botv/work/" not in xml["xml"]
    assert "/photo?token=" not in xml["xml"]
    assert re.search(r"/v-static/botv/.+/[a-f0-9]{24}\.jpg", xml["xml"])


def test_web_session_xml_limits_slow_gigachat_and_uses_fallback(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Product Black/one.jpg", b"jpg")
        zf.writestr("Drop/Product White/two.jpg", b"jpg")
        zf.writestr("Drop/Product Dark/three.jpg", b"jpg")

    state = _run_cli("create", str(archive), "drop.zip")
    _run_cli("update", state["id"], json.dumps({
        "ids": [1, 2, 3],
        "bulkPrice": 3290,
        "products": [
            {"index": 1, "adTitle": "First title"},
            {"index": 2, "adTitle": "Second title"},
            {"index": 3, "adTitle": "Third title"},
        ],
    }, ensure_ascii=False))

    xml = _run_cli(
        "xml",
        state["id"],
        env={
            "GIGACHAT_CREDENTIALS": "test-token",
            "BOTV_GIGACHAT_XML_MAX_PRODUCTS": "0",
        },
    )

    assert xml["products"] == 3
    assert xml["ads"] == 9
    assert "\u0414\u0438\u0437\u0430\u0439\u043d:" in xml["xml"]
    assert "\u0413\u0440\u0430\u0444\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0434\u0438\u0437\u0430\u0439\u043d" in xml["xml"]
    assert "&lt;br" not in xml["xml"]
    assert "<br" not in xml["xml"]
    assert "<Color>\u0411\u0435\u043b\u044b\u0439</Color>" in xml["xml"]
    assert "<Color>\u0427\u0451\u0440\u043d\u044b\u0439</Color>" in xml["xml"]


def test_web_session_xml_uses_default_brand_when_not_in_avito_cache(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/Raf Simons Archive/one.jpg", b"jpg")

    settings_dir = tmp_path / "settings"
    shutil.copytree(Path(__file__).resolve().parents[1] / "settings", settings_dir)
    cache = settings_dir / "brands_cache.json"
    cache.write_text(json.dumps({"ts": 4102444800, "brands": ["NIKE", "Без бренда"]}, ensure_ascii=False), encoding="utf-8")
    state = _run_cli("create", str(archive), "drop.zip")
    _run_cli("update", state["id"], json.dumps({
        "products": [{"index": 1, "adTitle": "Raf Simons Archive", "price": 1990}],
    }, ensure_ascii=False))

    xml = _run_cli(
        "xml",
        state["id"],
        env={
            "BOTV_WEB_LOCAL_IMAGES": None,
            "BOTV_PUBLIC_IMAGE_BASE_URL": "http://images.example.test",
            "SETTINGS_DIR": str(settings_dir),
            "BOTV_BRANDS_OFFLINE": "1",
        },
    )

    assert "<Brand>Без бренда</Brand>" in xml["xml"]
def test_web_session_phone_xml_keeps_brand_from_stale_cache(tmp_path):
    archive = tmp_path / "drop.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("Drop/NIKE Air/one.jpg", b"jpg")

    settings_dir = tmp_path / "settings"
    shutil.copytree(Path(__file__).resolve().parents[1] / "settings", settings_dir)
    cache = settings_dir / "brands_cache.json"
    cache.write_text(json.dumps({"ts": 1, "brands": ["NIKE"]}, ensure_ascii=False), encoding="utf-8")

    state = _run_cli("create", str(archive), "drop.zip")
    _run_cli("update", state["id"], json.dumps({
        "products": [{"index": 1, "adTitle": "NIKE Air", "price": 1990}],
    }, ensure_ascii=False))

    env = {
        "BOTV_WEB_LOCAL_IMAGES": None,
        "BOTV_PUBLIC_IMAGE_BASE_URL": "http://images.example.test",
        "SETTINGS_DIR": str(settings_dir),
        "BOTV_BRANDS_OFFLINE": "1",
    }
    xml = _run_cli("xml", state["id"], env=env)
    assert "<Brand>NIKE</Brand>" in xml["xml"]

    phone_xml = _run_cli("xml", state["id"], "--phone", "+7 999 111-22-33", env=env)
    assert "<Brand>NIKE</Brand>" in phone_xml["xml"]
    replaced_phone_xml = re.sub(
        r"<ContactPhone>.*?</ContactPhone>",
        "<ContactPhone>+79991112233</ContactPhone>",
        xml["xml"],
    )
    assert phone_xml["xml"] == replaced_phone_xml
