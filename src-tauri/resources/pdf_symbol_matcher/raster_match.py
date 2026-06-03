from __future__ import annotations

from pathlib import Path
from typing import Iterable

import cv2
import fitz
import numpy as np

from .coordinates import mupdf_rect_to_pdf


def _pix_to_gray(pix: fitz.Pixmap) -> np.ndarray:
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n >= 3:
        return cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2GRAY)
    return arr[:, :, 0]


def render_gray(page: fitz.Page, dpi: int = 300, clip: fitz.Rect | None = None) -> tuple[np.ndarray, float]:
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip, alpha=False, annots=False)
    return _pix_to_gray(pix), zoom


def edge_image(gray: np.ndarray) -> np.ndarray:
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    return cv2.Canny(gray, 50, 150)


def nms_hits(hits: list[dict], overlap: float = 0.35) -> list[dict]:
    if not hits:
        return []
    hits = sorted(hits, key=lambda h: h["score"], reverse=True)
    keep = []
    for h in hits:
        x0, y0, x1, y1 = h["bbox_px"]
        area = max(0, x1 - x0) * max(0, y1 - y0)
        suppress = False
        for k in keep:
            a0, b0, a1, b1 = k["bbox_px"]
            ix0, iy0, ix1, iy1 = max(x0, a0), max(y0, b0), min(x1, a1), min(y1, b1)
            iarea = max(0, ix1 - ix0) * max(0, iy1 - iy0)
            other = max(0, a1 - a0) * max(0, b1 - b0)
            if iarea / max(area + other - iarea, 1) > overlap:
                suppress = True
                break
        if not suppress:
            keep.append(h)
    return keep


def raster_template_search(
    page: fitz.Page,
    template_page: fitz.Page,
    template_bbox_mupdf: Iterable[float],
    dpi: int = 300,
    threshold: float = 0.82,
    scales: Iterable[float] | None = None,
) -> list[dict]:
    if scales is None:
        scales = np.geomspace(0.55, 1.8, 25)
    page_gray, zoom = render_gray(page, dpi=dpi)
    templ_gray, _ = render_gray(template_page, dpi=dpi, clip=fitz.Rect(template_bbox_mupdf))
    page_edges = edge_image(page_gray)
    templ_edges = edge_image(templ_gray)
    hits = []
    for scale in scales:
        resized = cv2.resize(
            templ_edges,
            None,
            fx=float(scale),
            fy=float(scale),
            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC,
        )
        h, w = resized.shape[:2]
        if h < 3 or w < 3 or h >= page_edges.shape[0] or w >= page_edges.shape[1]:
            continue
        result = cv2.matchTemplate(page_edges, resized, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.where(result >= threshold)
        for x, y in zip(xs, ys):
            bbox_px = [int(x), int(y), int(x + w), int(y + h)]
            bbox_mupdf = [x / zoom, y / zoom, (x + w) / zoom, (y + h) / zoom]
            hits.append({
                "bbox_px": bbox_px,
                "bbox_pdf": mupdf_rect_to_pdf(page, bbox_mupdf),
                "score": float(result[y, x]),
                "scale": float(scale),
                "method": "raster_edge_match_template",
            })
    return nms_hits(hits)
