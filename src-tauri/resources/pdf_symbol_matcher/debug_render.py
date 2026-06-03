from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

import fitz
from PIL import Image, ImageDraw, ImageFont


def pixmap_to_pil(pix: fitz.Pixmap) -> Image.Image:
    mode = "RGBA" if pix.alpha else "RGB"
    img = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
    if mode == "RGBA":
        return img.convert("RGB")
    return img


def render_page_image(page: fitz.Page, dpi: int = 200) -> tuple[Image.Image, float]:
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, annots=False)
    return pixmap_to_pil(pix), zoom


def _safe_font(size: int = 12):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except Exception:
        return ImageFont.load_default()


def draw_mupdf_boxes(
    page: fitz.Page,
    boxes: Sequence[dict],
    out_path: str | Path,
    dpi: int = 200,
    width: int = 3,
) -> None:
    """Render page and overlay MuPDF-coordinate boxes.

    boxes entries may contain: bbox_mupdf, label, color.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img, zoom = render_page_image(page, dpi=dpi)
    draw = ImageDraw.Draw(img)
    font = _safe_font(max(10, int(8 * dpi / 100)))
    for i, b in enumerate(boxes):
        x0, y0, x1, y1 = [float(v) * zoom for v in b["bbox_mupdf"]]
        label = str(b.get("label", i))
        color = b.get("color", "red")
        draw.rectangle([x0, y0, x1, y1], outline=color, width=width)
        tx = x0
        ty = max(0, y0 - 13)
        tw = max(4, len(label) * 7)
        draw.rectangle([tx, ty, tx + tw, ty + 13], fill="white")
        draw.text((tx + 1, ty), label, fill=color, font=font)
    img.save(out_path)


def crop_mupdf(page: fitz.Page, bbox_mupdf: Iterable[float], out_path: str | Path, dpi: int = 600, pad_pts: float = 3.0) -> None:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = fitz.Rect(bbox_mupdf)
    r.x0 -= pad_pts
    r.y0 -= pad_pts
    r.x1 += pad_pts
    r.y1 += pad_pts
    mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    pix = page.get_pixmap(matrix=mat, clip=r, alpha=False, annots=False)
    pixmap_to_pil(pix).save(out_path)


def normalized_points_preview(points, out_path: str | Path, size: int = 256, pad: int = 20) -> None:
    import numpy as np

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (size, size), "white")
    draw = ImageDraw.Draw(img)
    arr = np.asarray(points, dtype=float)
    if arr.shape[0] == 0:
        img.save(out_path)
        return
    mn = arr.min(axis=0)
    mx = arr.max(axis=0)
    span = max(float(mx[0] - mn[0]), float(mx[1] - mn[1]), 1e-9)
    scale = (size - 2 * pad) / span
    prev = None
    for p in arr:
        x = pad + (p[0] - mn[0]) * scale
        y = pad + (p[1] - mn[1]) * scale
        # normalized space uses y-down because source points are MuPDF coordinates.
        if prev is not None:
            draw.line([prev[0], prev[1], x, y], fill="black", width=1)
        prev = (x, y)
    for p in arr[:: max(1, len(arr) // 80)]:
        x = pad + (p[0] - mn[0]) * scale
        y = pad + (p[1] - mn[1]) * scale
        draw.ellipse([x - 1, y - 1, x + 1, y + 1], fill="black")
    img.save(out_path)
