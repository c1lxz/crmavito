from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Optional

import aiofiles
import aiohttp

log = logging.getLogger(__name__)

API_BASE = "https://cloud-api.yandex.net/v1/disk"
_DISK_LINK_RE = re.compile(r"https?://disk\.yandex\.[a-z]+/[dg]/\S+", re.IGNORECASE)


def extract_disk_link(text: str) -> str | None:
    """Вытаскивает первую ссылку на публичную папку Яндекс.Диска из текста."""
    m = _DISK_LINK_RE.search(text)
    return m.group(0).rstrip(".,)") if m else None


class YandexDiskError(RuntimeError):
    pass


class YandexDiskClient:
    def __init__(self, token: str) -> None:
        self._token = token
        self._headers = {"Authorization": f"OAuth {token}"}

    async def ensure_dir(self, remote_path: str) -> None:
        """Создаёт папку и всех родителей на Яндекс.Диске (идемпотентно)."""
        parts = [p for p in remote_path.strip("/").split("/") if p]
        current = ""
        async with aiohttp.ClientSession(headers=self._headers) as session:
            for part in parts:
                current = f"{current}/{part}" if current else part
                await self._create_dir(session, current)

    async def _create_dir(self, session: aiohttp.ClientSession, path: str) -> None:
        params = {"path": path}
        async with session.put(f"{API_BASE}/resources", params=params) as resp:
            if resp.status in (200, 201):
                return
            if resp.status == 409:  # уже существует
                return
            text = await resp.text()
            raise YandexDiskError(f"mkdir '{path}' failed [{resp.status}]: {text}")

    async def upload_file(self, local: Path, remote_path: str, overwrite: bool = True) -> None:
        """Заливает локальный файл в remote_path (полный путь на Диске)."""
        async with aiohttp.ClientSession(headers=self._headers) as session:
            upload_url = await self._get_upload_href(session, remote_path, overwrite)
            await self._put_file(session, upload_url, local)

    async def _get_upload_href(
        self,
        session: aiohttp.ClientSession,
        remote_path: str,
        overwrite: bool,
    ) -> str:
        params = {"path": remote_path, "overwrite": str(overwrite).lower()}
        async with session.get(f"{API_BASE}/resources/upload", params=params) as resp:
            data = await resp.json()
            if resp.status != 200:
                raise YandexDiskError(f"get upload href failed [{resp.status}]: {data}")
            return data["href"]

    async def _put_file(self, session: aiohttp.ClientSession, url: str, local: Path) -> None:
        async with aiofiles.open(local, "rb") as f:
            data = await f.read()
        async with session.put(url, data=data) as resp:
            if resp.status not in (200, 201, 202):
                text = await resp.text()
                raise YandexDiskError(f"upload '{local.name}' failed [{resp.status}]: {text}")

    async def publish(self, remote_path: str) -> None:
        """Делает файл/папку публичной."""
        params = {"path": remote_path}
        async with aiohttp.ClientSession(headers=self._headers) as session:
            async with session.put(f"{API_BASE}/resources/publish", params=params) as resp:
                if resp.status not in (200, 201):
                    text = await resp.text()
                    raise YandexDiskError(f"publish '{remote_path}' failed [{resp.status}]: {text}")

    async def get_public_url(self, remote_path: str) -> str:
        """
        Возвращает прямой URL для скачивания опубликованного файла.
        Для Avito XML нужен именно прямой .jpg/.png URL, а не страница-обёртка.
        """
        params = {"path": remote_path, "fields": "public_url,file"}
        async with aiohttp.ClientSession(headers=self._headers) as session:
            async with session.get(f"{API_BASE}/resources", params=params) as resp:
                data = await resp.json()
                if resp.status != 200:
                    raise YandexDiskError(f"meta '{remote_path}' failed [{resp.status}]: {data}")
                public_url: Optional[str] = data.get("public_url")
                if not public_url:
                    raise YandexDiskError(f"public_url отсутствует для '{remote_path}'")

                # Пытаемся получить прямую ссылку для скачивания
                async with session.get(
                    f"{API_BASE}/public/resources/download",
                    params={"public_key": public_url},
                ) as dl_resp:
                    if dl_resp.status == 200:
                        dl_data = await dl_resp.json()
                        href = dl_data.get("href")
                        if href:
                            return href
                return public_url


    async def list_public_folder(
        self,
        public_key: str,
        path: str = "/",
        limit: int = 100,
    ) -> list[dict]:
        """Возвращает список элементов публичной папки (рекурсивно)."""
        items: list[dict] = []
        offset = 0
        async with aiohttp.ClientSession(headers=self._headers) as session:
            while True:
                params = {
                    "public_key": public_key,
                    "path": path,
                    "limit": limit,
                    "offset": offset,
                    "fields": "_embedded.items.name,_embedded.items.type,_embedded.items.path,"
                              "_embedded.items.mime_type,_embedded.total",
                }
                async with session.get(f"{API_BASE}/public/resources", params=params) as resp:
                    if resp.status == 404:
                        raise YandexDiskError("Папка не найдена. Проверь ссылку и доступ.")
                    data = await resp.json()
                    if resp.status != 200:
                        raise YandexDiskError(f"list public failed [{resp.status}]: {data}")

                embedded = data.get("_embedded", {})
                batch = embedded.get("items", [])
                items.extend(batch)
                total = embedded.get("total", 0)
                offset += len(batch)
                if offset >= total or not batch:
                    break
        return items

    async def download_public_file(
        self,
        public_key: str,
        remote_path: str,
        local_dest: Path,
    ) -> None:
        """Скачивает файл из публичной папки в local_dest."""
        async with aiohttp.ClientSession(headers=self._headers) as session:
            params = {"public_key": public_key, "path": remote_path}
            async with session.get(f"{API_BASE}/public/resources/download", params=params) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise YandexDiskError(f"get download url failed [{resp.status}]: {text}")
                data = await resp.json()
                href = data.get("href")
                if not href:
                    raise YandexDiskError("Не удалось получить ссылку для скачивания")

            async with session.get(href) as dl:
                if dl.status != 200:
                    raise YandexDiskError(f"download failed [{dl.status}]")
                local_dest.parent.mkdir(parents=True, exist_ok=True)
                async with aiofiles.open(local_dest, "wb") as f:
                    async for chunk in dl.content.iter_chunked(1024 * 256):
                        await f.write(chunk)

    async def _get_root_meta(self, public_key: str) -> dict:
        """Возвращает метаданные корневого публичного ресурса (тип, имя, mime)."""
        async with aiohttp.ClientSession(headers=self._headers) as session:
            params = {"public_key": public_key, "fields": "type,name,mime_type,size"}
            async with session.get(f"{API_BASE}/public/resources", params=params) as resp:
                if resp.status == 404:
                    raise YandexDiskError(
                        "Ресурс не найден. Убедись, что ссылка открыта для всех."
                    )
                data = await resp.json()
                if resp.status != 200:
                    raise YandexDiskError(f"meta failed [{resp.status}]: {data}")
                return data

    async def download_public_folder(
        self,
        public_key: str,
        local_root: Path,
        progress_cb=None,
        max_size_bytes: int | None = None,
    ) -> Path:
        """
        Скачивает публичный ресурс (папку или архив) в local_root.
        Если ресурс — архив (.zip/.rar/.7z), скачивает файл и распаковывает на месте.
        Если ресурс — папка, рекурсивно скачивает все изображения.
        progress_cb(downloaded, total, unit) — опциональный колбэк прогресса,
        где unit равен "bytes" для архива и "files" для папки.
        Возвращает local_root.
        """
        from config import ARCHIVE_EXTENSIONS, IMAGE_EXTENSIONS

        meta = await self._get_root_meta(public_key)
        root_type = meta.get("type", "")
        root_name = meta.get("name", "resource")

        if root_type == "file":
            suffix = Path(root_name).suffix.lower()
            if suffix not in ARCHIVE_EXTENSIONS:
                raise YandexDiskError(
                    f"Ссылка ведёт на файл «{root_name}», а не на папку или архив. "
                    "Поделись папкой с товарами или архивом (.zip/.rar/.7z)."
                )
            size = int(meta.get("size") or 0)
            if max_size_bytes and size > max_size_bytes:
                size_mb = size / 1024 / 1024
                limit_mb = max_size_bytes / 1024 / 1024
                raise YandexDiskError(
                    f"Архив слишком большой ({size_mb:.1f} МБ). "
                    f"Максимум — {limit_mb:.0f} МБ."
                )
            # Скачиваем архив
            local_archive = local_root / root_name
            local_root.mkdir(parents=True, exist_ok=True)
            await self._download_public_root(
                public_key,
                local_archive,
                total_size=size,
                progress_cb=progress_cb,
            )
            return local_root

        # Это папка — собираем все изображения рекурсивно
        all_files: list[dict] = []
        queue: list[str] = []

        # Первый уровень — сами элементы корневой папки
        root_items = await self.list_public_folder(public_key, path="/")
        for item in root_items:
            if item["type"] == "dir":
                queue.append(item["path"])
            else:
                if Path(item["name"]).suffix.lower() in IMAGE_EXTENSIONS:
                    all_files.append(item)

        # Рекурсия по подпапкам
        while queue:
            folder_path = queue.pop()
            items = await self.list_public_folder(public_key, path=folder_path)
            for item in items:
                if item["type"] == "dir":
                    queue.append(item["path"])
                else:
                    if Path(item["name"]).suffix.lower() in IMAGE_EXTENSIONS:
                        all_files.append(item)

        if not all_files:
            raise YandexDiskError(
                "В папке не найдено изображений (.jpg/.jpeg/.png/.webp).\n"
                "Убедись, что папка содержит подпапки с товарами и в них есть фото."
            )

        total = len(all_files)
        for idx, file_info in enumerate(all_files, 1):
            remote_path = file_info["path"]
            rel = Path(remote_path.lstrip("/"))
            local_dest = local_root / rel
            await self.download_public_file(public_key, remote_path, local_dest)
            log.info("downloaded [%d/%d] %s", idx, total, remote_path)
            if progress_cb:
                await progress_cb(idx, total, "files")
            await asyncio.sleep(0)

        return local_root

    async def _download_public_root(
        self,
        public_key: str,
        local_dest: Path,
        *,
        total_size: int = 0,
        progress_cb=None,
    ) -> None:
        """Скачивает корневой публичный файл (без указания path)."""
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=120)
        try:
            async with aiohttp.ClientSession(
                headers=self._headers,
                timeout=timeout,
            ) as session:
                params = {"public_key": public_key}
                async with session.get(
                    f"{API_BASE}/public/resources/download",
                    params=params,
                ) as resp:
                    if resp.status != 200:
                        text = await resp.text()
                        raise YandexDiskError(
                            f"get download url failed [{resp.status}]: {text}"
                        )
                    data = await resp.json()
                    href = data.get("href")
                    if not href:
                        raise YandexDiskError("Не удалось получить ссылку для скачивания")

                async with session.get(href) as dl:
                    if dl.status != 200:
                        raise YandexDiskError(f"download failed [{dl.status}]")
                    actual_total = total_size or int(dl.headers.get("Content-Length") or 0)
                    downloaded = 0
                    local_dest.parent.mkdir(parents=True, exist_ok=True)
                    async with aiofiles.open(local_dest, "wb") as f:
                        async for chunk in dl.content.iter_chunked(1024 * 1024):
                            await f.write(chunk)
                            downloaded += len(chunk)
                            if progress_cb:
                                await progress_cb(downloaded, actual_total, "bytes")
                    if actual_total and downloaded != actual_total:
                        raise YandexDiskError(
                            f"Архив скачан не полностью: "
                            f"{downloaded / 1024 / 1024:.1f} из "
                            f"{actual_total / 1024 / 1024:.1f} МБ."
                        )
        except YandexDiskError:
            local_dest.unlink(missing_ok=True)
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            local_dest.unlink(missing_ok=True)
            raise YandexDiskError(
                "Скачивание с Яндекс.Диска прервалось из-за сетевой ошибки. "
                "Попробуй отправить ссылку ещё раз."
            ) from exc


async def upload_product_photos(
    client: YandexDiskClient,
    base_dir: str,
    product_name: str,
    photos: list[Path],
) -> list[str]:
    """
    Заливает все фотографии одного товара, публикует папку и возвращает список прямых URL.
    Порядок URL совпадает с порядком photos.
    """
    safe_dir = _sanitize_segment(product_name)
    remote_dir = f"{base_dir}/{safe_dir}"

    await client.ensure_dir(remote_dir)

    urls: list[str] = []
    for idx, local in enumerate(photos, 1):
        remote_name = f"{idx:02d}{local.suffix.lower()}"
        remote_path = f"{remote_dir}/{remote_name}"
        await client.upload_file(local, remote_path, overwrite=True)
        await client.publish(remote_path)
        url = await client.get_public_url(remote_path)
        urls.append(url)
        log.info("uploaded %s -> %s", local.name, url)
        await asyncio.sleep(0)  # даём event loop подышать

    return urls


def _sanitize_segment(name: str) -> str:
    """Убирает символы, которые ломают путь на Диске."""
    bad = '\\/:*?"<>|\r\n\t'
    cleaned = "".join(c if c not in bad else "_" for c in name).strip()
    return cleaned or "product"
