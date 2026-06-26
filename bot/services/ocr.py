from __future__ import annotations

import io
import logging
import os
import re
from typing import Tuple

import pytesseract
from PIL import Image, ImageEnhance, ImageOps
from pyzbar.pyzbar import decode as pyzbar_decode

log = logging.getLogger(__name__)

_tesseract_cmd = os.getenv("TESSERACT_CMD")
if _tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = _tesseract_cmd

KNOWN_CARRIERS = [
    "СДЭК", "CDEK",
    "Почта России", "Почта",
    "EMS",
    "Boxberry", "Боксберри",
    "DPD",
    "Авито", "Авито Доставка",
    "Яндекс", "Яндекс Доставка",
    "OZON", "Озон",
    "WB", "Wildberries",
    "ПЭК",
    "Деловые линии",
    "КСЭ",
    "5Post",
    "Пикпоинт", "PickPoint",
    "Cainiao",
    "Lamoda",
]


# ── Декодирование штрихкода (точный трек-номер) ───────────────────────────────

def decode_barcode(image_bytes: bytes) -> str:
    """
    Декодирует штрихкод через pyzbar, пробуя несколько вариантов обработки.
    Telegram сжимает фото, поэтому одна попытка часто не срабатывает.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        gray = img.convert("L")
        w, h = gray.size

        attempts = []

        # 1. Оригинал как есть
        attempts.append(img)

        # 2. Grayscale
        attempts.append(gray)

        # 3. Масштаб 2× (помогает при сжатых Telegram-фото)
        scale = max(2.0, 2000 / max(w, h))
        attempts.append(gray.resize((int(w * scale), int(h * scale)), Image.LANCZOS))

        # 4. Высокий контраст
        attempts.append(ImageEnhance.Contrast(gray).enhance(3.0))

        # 5. Инверсия (для тёмного фона)
        attempts.append(ImageOps.invert(gray))

        # 6. Инверсия + масштаб
        attempts.append(
            ImageOps.invert(gray).resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        )

        for attempt in attempts:
            results = pyzbar_decode(attempt)
            if results:
                value = results[0].data.decode("utf-8").strip()
                log.info("Barcode decoded: %r", value)
                return value

    except Exception as e:
        log.warning("Barcode decode failed: %s", e)

    log.info("Barcode not decoded, will use OCR fallback")
    return ""


# ── OCR (только для получения названия ТК) ───────────────────────────────────

def _is_dark(img: Image.Image) -> bool:
    gray = img.convert("L")
    pixels = list(gray.getdata())
    return (sum(pixels) / len(pixels)) < 128


def _preprocess(img: Image.Image) -> Image.Image:
    gray = img.convert("L")
    if _is_dark(gray):
        gray = ImageOps.invert(gray)
    gray = ImageEnhance.Contrast(gray).enhance(1.5)
    w, h = gray.size
    if max(w, h) < 1500:
        scale = 1500 / max(w, h)
        gray = gray.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    elif max(w, h) > 4000:
        scale = 4000 / max(w, h)
        gray = gray.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return gray


def run_ocr(image_bytes: bytes) -> str:
    img = Image.open(io.BytesIO(image_bytes))
    img = _preprocess(img)
    results = []
    for psm in (6, 11, 3):
        try:
            text = pytesseract.image_to_string(
                img, lang="rus+eng", config=f"--psm {psm} --oem 3"
            )
            results.append(text.strip())
        except Exception as e:
            log.warning("OCR psm=%s error: %s", psm, e)
    if not results:
        return ""
    best = max(results, key=lambda t: len(t))
    log.info("OCR output:\n%s", best)
    return best


def _ocr_digits_only(img: Image.Image) -> str:
    """OCR только цифр — для чисто числовых трек-номеров, исключает путаницу 3/5/8."""
    cfg = "--psm 6 --oem 3 -c tessedit_char_whitelist=0123456789 "
    try:
        return pytesseract.image_to_string(img, lang="eng", config=cfg).strip()
    except Exception:
        return ""


def extract_carrier(ocr_text: str) -> str:
    """Ищет название ТК в OCR-тексте."""
    upper = ocr_text.upper()

    # Точное совпадение по известному списку
    for known in KNOWN_CARRIERS:
        if known.upper() in upper:
            return known

    # Fallback: первая короткая строка с буквами после трек-подобной строки
    lines = ocr_text.splitlines()
    track_idx = -1
    for i, line in enumerate(lines):
        cleaned = re.sub(r"[^A-Za-z0-9]", "", line)
        if len(cleaned) >= 8:
            digit_ratio = sum(c.isdigit() for c in cleaned) / len(cleaned)
            if digit_ratio >= 0.5:
                track_idx = i
                break

    if track_idx >= 0:
        for line in lines[track_idx + 1: track_idx + 4]:
            candidate = line.strip()
            if not candidate:
                continue
            letters = re.sub(r"[^A-Za-zА-Яа-яЁё]", "", candidate)
            if len(letters) >= 2:
                return candidate

    return ""


# ── Главная функция для хендлера ──────────────────────────────────────────────

def process_barcode_image(image_bytes: bytes) -> Tuple[str, str]:
    """
    Возвращает (track, carrier).
    Трек — из штрихкода (точно), ТК — из OCR-текста рядом.
    """
    # Шаг 1: декодируем штрихкод → точный трек
    track = decode_barcode(image_bytes)

    # Шаг 2: OCR для получения ТК
    ocr_text = run_ocr(image_bytes)
    carrier = extract_carrier(ocr_text)

    # Шаг 3: если штрихкод не декодировался — берём трек из OCR-текста
    if not track:
        log.info("Barcode not found, falling back to OCR for track")
        track = _extract_track_from_ocr(ocr_text, image_bytes)

    log.info("Result — track: %r  carrier: %r", track, carrier)
    return track, carrier


def _extract_track_from_ocr(ocr_text: str, image_bytes: bytes | None = None) -> str:
    # Сначала пробуем цифровой OCR (точнее для числовых трек-номеров)
    if image_bytes:
        try:
            img = Image.open(io.BytesIO(image_bytes))
            img = _preprocess(img)
            digits_text = _ocr_digits_only(img)
            # Берём самую длинную строку из цифр
            candidates = re.findall(r"\d{8,}", digits_text.replace(" ", "").replace("\n", ""))
            if candidates:
                track = max(candidates, key=len)
                log.info("Digits-only OCR track: %r", track)
                return track
        except Exception:
            pass

    # Fallback: общий OCR-текст
    for line in ocr_text.splitlines():
        cleaned = re.sub(r"[^A-Za-z0-9]", "", line)
        if len(cleaned) < 8 or len(cleaned) > 35:
            continue
        digit_ratio = sum(c.isdigit() for c in cleaned) / len(cleaned)
        if digit_ratio >= 0.5:
            return cleaned.upper()
    candidates = re.findall(r"[A-Za-z0-9]{8,}", ocr_text)
    return max(candidates, key=len).upper() if candidates else ""


def is_track_valid(track: str) -> bool:
    return bool(track) and len(track) >= 8
