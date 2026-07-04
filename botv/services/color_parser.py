from __future__ import annotations

from services.ai_description import normalize_avito_color


def parse_ordered_colors(text: str, count: int) -> list[str] | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) != count:
        return None
    colors = [normalize_avito_color(line) for line in lines]
    if any(color is None for color in colors):
        return None
    return [color for color in colors if color is not None]
