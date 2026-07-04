from __future__ import annotations

import logging
import shutil
import zipfile
from pathlib import Path
from typing import List

from config import ARCHIVE_EXTENSIONS, IMAGE_EXTENSIONS

log = logging.getLogger(__name__)


class ArchiveError(RuntimeError):
    pass


def extract_archive(archive_path: Path, dest_dir: Path) -> Path:
    """
    Распаковывает архив в dest_dir и возвращает путь к директории с товарами.
    Поддерживает .zip, .rar, .7z.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    suffix = archive_path.suffix.lower()

    if suffix == ".zip":
        _extract_zip(archive_path, dest_dir)
    elif suffix == ".rar":
        _extract_rar(archive_path, dest_dir)
    elif suffix == ".7z":
        _extract_7z(archive_path, dest_dir)
    else:
        raise ArchiveError(f"Unsupported archive format: {suffix}")

    return _find_root(dest_dir)


def _extract_zip(archive_path: Path, dest_dir: Path) -> None:
    try:
        with zipfile.ZipFile(archive_path, "r") as zf:
            for member in zf.infolist():
                _safe_extract_member(zf, member, dest_dir)
    except zipfile.BadZipFile as exc:
        raise ArchiveError(f"Не удалось распаковать ZIP: {exc}") from exc


def _safe_extract_member(zf: zipfile.ZipFile, member: zipfile.ZipInfo, dest_dir: Path) -> None:
    try:
        raw_name = member.filename.encode("cp437").decode("cp866")
    except (UnicodeEncodeError, UnicodeDecodeError):
        raw_name = member.filename

    target = (dest_dir / raw_name).resolve()
    if not str(target).startswith(str(dest_dir.resolve())):
        raise ArchiveError(f"Небезопасный путь в архиве: {member.filename}")

    if member.is_dir():
        target.mkdir(parents=True, exist_ok=True)
        return

    target.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(member) as src, target.open("wb") as dst:
        shutil.copyfileobj(src, dst)


def _extract_rar(archive_path: Path, dest_dir: Path) -> None:
    try:
        import rarfile
    except ImportError as exc:
        raise ArchiveError("Для распаковки .rar нужен пакет 'rarfile' и utility 'unrar'.") from exc

    try:
        with rarfile.RarFile(archive_path) as rf:
            rf.extractall(dest_dir)
    except rarfile.Error as exc:
        raise ArchiveError(f"Не удалось распаковать RAR: {exc}") from exc


def _extract_7z(archive_path: Path, dest_dir: Path) -> None:
    try:
        import py7zr
    except ImportError as exc:
        raise ArchiveError("Для распаковки .7z нужен пакет 'py7zr'.") from exc

    try:
        with py7zr.SevenZipFile(archive_path, mode="r") as sz:
            sz.extractall(path=dest_dir)
    except py7zr.exceptions.Bad7zFile as exc:
        raise ArchiveError(f"Не удалось распаковать 7z: {exc}") from exc


def _find_root(dest_dir: Path) -> Path:
    """
    Если внутри одна папка — возвращаем её (пропускаем «дроп»-контейнер).
    Иначе возвращаем dest_dir.
    """
    entries = [p for p in dest_dir.iterdir() if not p.name.startswith(".")]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest_dir


def scan_products(root: Path) -> List[dict]:
    """
    Возвращает список товаров: [{ 'name': 'Футболка ...', 'photos': [Path, ...] }, ...].
    Товар = поддиректория первого уровня, в которой есть изображения.
    """
    products: List[dict] = []
    for item in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not item.is_dir():
            continue
        if item.name.startswith("."):
            continue

        photos = sorted(
            (p for p in item.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS),
            key=lambda p: p.name.lower(),
        )
        if not photos:
            log.warning("Пропускаем «%s»: нет фотографий", item.name)
            continue

        products.append({"name": item.name.strip(), "photos": photos})

    return products


def is_archive(filename: str) -> bool:
    return Path(filename).suffix.lower() in ARCHIVE_EXTENSIONS
