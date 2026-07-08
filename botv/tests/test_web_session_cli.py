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
