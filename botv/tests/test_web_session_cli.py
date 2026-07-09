import json
import os
import subprocess
import zipfile
from pathlib import Path


def _run_cli(*args: str) -> dict:
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [str(root / "venv" / "bin" / "python"), str(root / "web" / "session_cli.py"), *args],
        cwd=root,
        text=True,
        capture_output=True,
        check=True,
        env={**os.environ, "BOTV_WEB_LOCAL_IMAGES": "1"},
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

    xml = _run_cli("xml", state["id"])
    assert xml["products"] == 1
    assert xml["ads"] == 3
    assert "Product Black" in xml["xml"]
    assert "Product White" not in xml["xml"]

    phone_xml = _run_cli("xml", state["id"], "--phone", "+7 999 111-22-33")
    assert "+79991112233" in phone_xml["xml"]
    assert "+7 900 000 00 00" not in phone_xml["xml"]


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
