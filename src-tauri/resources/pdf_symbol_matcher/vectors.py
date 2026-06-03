from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence
import json

import fitz


def extract_drawings(page: fitz.Page, extended: bool = True) -> list[dict]:
    drawings = page.get_cdrawings(extended=extended)
    out: list[dict] = []
    for path_id, d in enumerate(drawings):
        dd = dict(d)
        dd["path_id"] = path_id
        out.append(dd)
    return out


def drawing_style(d: dict) -> dict:
    return {
        "type": d.get("type"),
        "color": list(d.get("color")) if d.get("color") is not None else None,
        "fill": list(d.get("fill")) if d.get("fill") is not None else None,
        "width": d.get("width"),
        "dashes": d.get("dashes"),
        "lineCap": d.get("lineCap"),
        "lineJoin": d.get("lineJoin"),
        "fill_opacity": d.get("fill_opacity"),
        "stroke_opacity": d.get("stroke_opacity"),
        "seqno": d.get("seqno"),
        "level": d.get("level"),
        "layer": d.get("layer"),
    }


def serializable_item(item) -> list:
    op = item[0]
    if op == "l":
        return ["l", [float(item[1][0]), float(item[1][1])], [float(item[2][0]), float(item[2][1])]]
    if op == "c":
        return [
            "c",
            [float(item[1][0]), float(item[1][1])],
            [float(item[2][0]), float(item[2][1])],
            [float(item[3][0]), float(item[3][1])],
            [float(item[4][0]), float(item[4][1])],
        ]
    if op == "re":
        r = fitz.Rect(item[1])
        return ["re", [float(r.x0), float(r.y0), float(r.x1), float(r.y1)]]
    if op == "qu":
        q = item[1]
        if hasattr(q, "ul"):
            pts = [q.ul, q.ur, q.lr, q.ll]
        else:
            pts = list(q)
        return ["qu"] + [[float(p[0]), float(p[1])] for p in pts]
    return [str(op)]


def serialize_drawing(d: dict) -> dict:
    r = fitz.Rect(d.get("rect", (0, 0, 0, 0)))
    return {
        "path_id": int(d.get("path_id", -1)),
        "bbox_mupdf": [float(r.x0), float(r.y0), float(r.x1), float(r.y1)],
        "style": drawing_style(d),
        "items": [serializable_item(it) for it in (d.get("items", []) or [])],
        "item_count": len(d.get("items", []) or []),
    }


def select_drawings_by_bbox(drawings: Sequence[dict], bbox_mupdf: Iterable[float], mode: str = "intersects") -> list[dict]:
    B = fitz.Rect(bbox_mupdf)
    selected: list[dict] = []
    for d in drawings:
        if d.get("type") in ("clip", "group"):
            continue
        r = fitz.Rect(d.get("rect", (0, 0, 0, 0)))
        # PyMuPDF may report zero-width/height stroke-only paths. Treat them as
        # selectable by expanding a hair; otherwise Rect.intersects sees them as empty.
        rr = fitz.Rect(r)
        if rr.width <= 0:
            rr.x0 -= 0.25
            rr.x1 += 0.25
        if rr.height <= 0:
            rr.y0 -= 0.25
            rr.y1 += 0.25
        if mode == "inside":
            keep = rr.x0 >= B.x0 and rr.y0 >= B.y0 and rr.x1 <= B.x1 and rr.y1 <= B.y1
        else:
            keep = rr.intersects(B)
        if keep:
            selected.append(d)
    return selected


def dump_drawings_json(drawings: Sequence[dict], out_path: str | Path) -> None:
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump([serialize_drawing(d) for d in drawings], f, ensure_ascii=False, indent=2)
