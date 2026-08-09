from __future__ import annotations

from pathlib import Path

from services.product_rules import product_kind


class DescriptionRenderer:
    def __init__(self, template_path: Path) -> None:
        self._template = template_path.read_text(encoding="utf-8")
        self._templates = {
            kind: candidate.read_text(encoding="utf-8")
            for kind in ("hoodie", "longsleeve", "polo", "sweatshirt", "other")
            if (candidate := template_path.with_name(f"description_template_{kind}.txt")).exists()
        }

    def render(self, *, title: str, color: str, product_name: str = "", **extra: str) -> str:
        data = {"title": title, "color": color, **extra}
        template = self._templates.get(product_kind(product_name or title), self._template)
        try:
            text = template.format(**data)
        except KeyError as exc:
            text = template.replace("{" + str(exc.args[0]) + "}", "")
        return text.strip()
