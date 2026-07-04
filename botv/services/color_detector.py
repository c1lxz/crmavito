from __future__ import annotations

import json
from pathlib import Path


class ColorDetector:
    def __init__(self, rules_path: Path) -> None:
        raw = json.loads(rules_path.read_text(encoding="utf-8"))
        self._default: str = raw.get("default", "Чёрный")
        self._keywords: dict[str, str] = {
            k.lower(): v for k, v in raw.get("keywords", {}).items()
        }
        # Сортируем по длине, чтобы «vintage grey» матчился раньше «grey»
        self._sorted_keys = sorted(self._keywords.keys(), key=len, reverse=True)

    def detect(self, title: str) -> str:
        lower = title.lower()
        for key in self._sorted_keys:
            if key in lower:
                return self._keywords[key]
        return self._default
