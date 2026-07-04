from __future__ import annotations

from pathlib import Path


class DescriptionRenderer:
    def __init__(self, template_path: Path) -> None:
        self._template = template_path.read_text(encoding="utf-8")

    def render(self, *, title: str, color: str, **extra: str) -> str:
        data = {"title": title, "color": color, **extra}
        try:
            text = self._template.format(**data)
        except KeyError as exc:
            text = self._template.replace("{" + str(exc.args[0]) + "}", "")
        return text.replace("\n", "<br>")
