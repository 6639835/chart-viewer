from __future__ import annotations

from typing import Iterable, List, Tuple
import fitz

BBox = Tuple[float, float, float, float]


def rect_tuple(r: fitz.Rect | Iterable[float]) -> BBox:
    rr = fitz.Rect(r)
    return (float(rr.x0), float(rr.y0), float(rr.x1), float(rr.y1))


def expand_rect(r: fitz.Rect, pad: float) -> fitz.Rect:
    rr = fitz.Rect(r)
    rr.x0 -= pad
    rr.y0 -= pad
    rr.x1 += pad
    rr.y1 += pad
    return rr


def mupdf_rect_to_pdf(page: fitz.Page, r: fitz.Rect | Iterable[float]) -> List[float]:
    """Convert a MuPDF/PyMuPDF rect (origin top-left) to PDF user-space coordinates.

    Output is normalized [x0, y0, x1, y1] with origin bottom-left in points.
    """
    pdf_r = fitz.Rect(r) * ~page.transformation_matrix
    x0, y0, x1, y1 = pdf_r.x0, pdf_r.y0, pdf_r.x1, pdf_r.y1
    return [float(min(x0, x1)), float(min(y0, y1)), float(max(x0, x1)), float(max(y0, y1))]


def pdf_rect_to_mupdf(page: fitz.Page, bbox_pdf: Iterable[float]) -> fitz.Rect:
    """Convert PDF user-space bbox to MuPDF/PyMuPDF page coordinates."""
    return fitz.Rect(bbox_pdf) * page.transformation_matrix


def center_pdf(page: fitz.Page, r_mupdf: fitz.Rect | Iterable[float]) -> List[float]:
    r = fitz.Rect(r_mupdf)
    p = fitz.Point((r.x0 + r.x1) / 2.0, (r.y0 + r.y1) / 2.0) * ~page.transformation_matrix
    return [float(p.x), float(p.y)]


def page_coordinate_report(page: fitz.Page) -> dict:
    return {
        "page_rect_mupdf": list(rect_tuple(page.rect)),
        "mediabox_pdf": list(rect_tuple(page.mediabox)),
        "cropbox_pdf": list(rect_tuple(page.cropbox)),
        "rotation_degrees": int(page.rotation),
        "output_coordinate_system": {
            "space": "PDF user space",
            "origin": "bottom-left",
            "units": "points",
            "page_rotation_applied": False,
            "cropbox_applied_by_pymupdf_page_rect": True,
        },
    }


def render_page(page: fitz.Page, dpi: int = 200, alpha: bool = False) -> tuple[fitz.Pixmap, float]:
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=alpha, annots=False)
    return pix, zoom
