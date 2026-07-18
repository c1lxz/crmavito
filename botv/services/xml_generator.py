from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree


@dataclass
class AvitoAd:
    ad_id: str
    title: str
    price: int
    description: str
    color: str
    images: list[str] = field(default_factory=list)
    brand: str | None = None
    material: str = "Хлопок"
    extra: dict[str, str] = field(default_factory=dict)


class XmlGenerator:
    def __init__(self, defaults_path: Path, schema_path: Path) -> None:
        self._defaults: dict[str, str] = json.loads(defaults_path.read_text(encoding="utf-8"))
        self._schema: dict = json.loads(schema_path.read_text(encoding="utf-8"))

    def build(self, ads: list[AvitoAd]) -> bytes:
        root_tag: str = self._schema.get("root_tag", "Ads")
        ad_tag: str = self._schema.get("ad_tag", "Ad")
        root_attrs: dict[str, str] = self._schema.get("root_attrs", {})

        root = etree.Element(root_tag, attrib=root_attrs)
        for ad in ads:
            root.append(self._build_ad(ad, ad_tag))

        return etree.tostring(
            root,
            xml_declaration=True,
            encoding="UTF-8",
            pretty_print=True,
        )

    def _build_ad(self, ad: AvitoAd, ad_tag: str) -> etree._Element:
        ad_el = etree.Element(ad_tag)

        merged: dict[str, str] = {**self._defaults}
        merged.update(ad.extra)

        merged["Id"] = ad.ad_id
        merged["Title"] = ad.title
        merged["Description"] = ad.description
        merged["Price"] = str(ad.price)
        merged["Color"] = ad.color

        fields_order: list[str] = self._schema.get("fields_order", list(merged.keys()))
        rendered: set[str] = set()

        for field_name in fields_order:
            if field_name == "Images":
                if ad.images:
                    ad_el.append(_images_element(ad.images))
                    rendered.add(field_name)
                continue

            if field_name == "MaterialsOdezhda":
                material_value = merged.get("Material", ad.material)
                if material_value:
                    mat_el = etree.SubElement(ad_el, "MaterialsOdezhda")
                    opt_el = etree.SubElement(mat_el, "Option")
                    opt_el.text = material_value
                    rendered.add(field_name)
                continue

            if field_name == "Brand":
                if ad.brand:
                    _append_text(ad_el, "Brand", ad.brand)
                    rendered.add(field_name)
                continue

            value = merged.get(field_name)
            if value is None or value == "":
                continue
            _append_text(ad_el, field_name, value)
            rendered.add(field_name)

        return ad_el


def _append_text(parent: etree._Element, tag: str, value: str) -> None:
    el = etree.SubElement(parent, tag)
    el.text = value


def _images_element(urls: list[str]) -> etree._Element:
    images = etree.Element("Images")
    for url in urls:
        img = etree.SubElement(images, "Image")
        img.set("url", url)
    return images


def make_ad_id(prefix: str, index: int, scope: str = "") -> str:
    safe_scope = "".join(ch for ch in scope if ch.isalnum() or ch in "-_")[:16]
    if safe_scope:
        return f"{prefix}{safe_scope}-{index}"
    return f"{prefix}{index}"
