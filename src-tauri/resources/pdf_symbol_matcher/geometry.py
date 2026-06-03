from __future__ import annotations

import hashlib
import math
from typing import Iterable, List, Sequence, Tuple

import fitz
import numpy as np
from scipy.spatial import cKDTree

Point = Tuple[float, float]


def _arr_point(p) -> np.ndarray:
    return np.array([float(p[0]), float(p[1])], dtype=np.float64)


def cubic_eval(p0, p1, p2, p3, t: float) -> np.ndarray:
    u = 1.0 - t
    return (u**3) * p0 + 3 * (u**2) * t * p1 + 3 * u * (t**2) * p2 + (t**3) * p3


def flatten_item(item, curve_steps: int = 24) -> list[np.ndarray]:
    op = item[0]
    if op == "l":
        return [_arr_point(item[1]), _arr_point(item[2])]
    if op == "c":
        p0, p1, p2, p3 = (_arr_point(item[1]), _arr_point(item[2]), _arr_point(item[3]), _arr_point(item[4]))
        return [cubic_eval(p0, p1, p2, p3, i / curve_steps) for i in range(curve_steps + 1)]
    if op == "re":
        r = fitz.Rect(item[1])
        return [
            np.array([r.x0, r.y0], dtype=np.float64),
            np.array([r.x1, r.y0], dtype=np.float64),
            np.array([r.x1, r.y1], dtype=np.float64),
            np.array([r.x0, r.y1], dtype=np.float64),
            np.array([r.x0, r.y0], dtype=np.float64),
        ]
    if op == "qu":
        q = item[1]
        if hasattr(q, "ul"):
            pts = [q.ul, q.ur, q.lr, q.ll]
        else:
            pts = list(q)
        arr = [_arr_point(p) for p in pts]
        return arr + ([arr[0]] if arr else [])
    return []


def sample_polyline(poly: Sequence[np.ndarray], spacing: float = 0.25) -> list[np.ndarray]:
    if len(poly) < 2:
        return []
    out: list[np.ndarray] = []
    for a, b in zip(poly[:-1], poly[1:]):
        v = b - a
        length = float(np.linalg.norm(v))
        if length <= 1e-9:
            continue
        n = max(1, int(math.ceil(length / spacing)))
        for j in range(n):
            out.append(a + (j / n) * v)
    out.append(poly[-1])
    return out


def points_for_drawings(drawings: Sequence[dict], spacing: float = 0.25, curve_steps: int = 24) -> np.ndarray:
    pts: list[np.ndarray] = []
    for d in drawings:
        for item in d.get("items", []) or []:
            poly = flatten_item(item, curve_steps=curve_steps)
            pts.extend(sample_polyline(poly, spacing=spacing))
    if not pts:
        return np.zeros((0, 2), dtype=np.float64)
    return np.vstack(pts).astype(np.float64)


def drawing_bbox(drawings: Sequence[dict]) -> fitz.Rect:
    rects = []
    for d in drawings:
        rr = fitz.Rect(d.get("rect", (0, 0, 0, 0)))
        if rr.width <= 0:
            rr.x0 -= 0.25
            rr.x1 += 0.25
        if rr.height <= 0:
            rr.y0 -= 0.25
            rr.y1 += 0.25
        if not rr.is_empty:
            rects.append(rr)
    if not rects:
        return fitz.Rect()
    r = fitz.Rect(rects[0])
    for rr in rects[1:]:
        r |= rr
    return r


def normalize_points(points: np.ndarray, rotation_radians: float = 0.0) -> np.ndarray:
    if points.shape[0] == 0:
        return points.copy()
    mn = points.min(axis=0)
    mx = points.max(axis=0)
    center = (mn + mx) / 2.0
    scale = float(max(mx - mn))
    if scale <= 1e-9:
        scale = 1.0
    p = (points - center) / scale
    if abs(rotation_radians) > 1e-12:
        c = math.cos(rotation_radians)
        s = math.sin(rotation_radians)
        R = np.array([[c, -s], [s, c]], dtype=np.float64)
        p = p @ R.T
    return p


def pca_orientation(points: np.ndarray) -> float:
    if points.shape[0] < 3:
        return 0.0
    centered = points - points.mean(axis=0)
    cov = centered.T @ centered / max(1, len(centered))
    vals, vecs = np.linalg.eigh(cov)
    axis = vecs[:, int(np.argmax(vals))]
    return float(math.atan2(axis[1], axis[0]))


def points_hash(points: np.ndarray, decimals: int = 3) -> str:
    if points.shape[0] == 0:
        return hashlib.sha1(b"").hexdigest()
    arr = np.round(normalize_points(points), decimals=decimals)
    return hashlib.sha1(arr.tobytes()).hexdigest()


def chamfer_distance(a: np.ndarray, b: np.ndarray, clip: float = 0.20) -> tuple[float, float, float]:
    """Symmetric clipped Chamfer in normalized coordinates.

    Returns template_to_candidate, candidate_to_template, average.
    """
    if a.shape[0] == 0 or b.shape[0] == 0:
        return 999.0, 999.0, 999.0
    ta = cKDTree(a)
    tb = cKDTree(b)
    da = tb.query(a, k=1)[0]
    db = ta.query(b, k=1)[0]
    d1 = float(np.mean(np.minimum(da, clip)))
    d2 = float(np.mean(np.minimum(db, clip)))
    return d1, d2, (d1 + d2) / 2.0


def coverage(a: np.ndarray, b: np.ndarray, eps: float = 0.045) -> tuple[float, float]:
    if a.shape[0] == 0 or b.shape[0] == 0:
        return 0.0, 0.0
    ta = cKDTree(a)
    tb = cKDTree(b)
    da = tb.query(a, k=1)[0]
    db = ta.query(b, k=1)[0]
    return float(np.mean(da <= eps)), float(np.mean(db <= eps))


def _shape_metrics(
    t_tree: "cKDTree",
    tn: np.ndarray,
    c_tree: "cKDTree",
    cn: np.ndarray,
    clip: float = 0.20,
    eps: float = 0.045,
) -> tuple[float, float, float, float, float]:
    """Chamfer and coverage from a single nearest-neighbour pass.

    ``chamfer_distance`` and ``coverage`` independently build both KD-trees and
    query the same ``da``/``db`` distances; computing them together avoids that
    duplicated tree construction and querying. Returns
    ``(chamfer_t2c, chamfer_c2t, chamfer_avg, coverage_template, coverage_candidate)``.
    """
    da = c_tree.query(tn, k=1)[0]
    db = t_tree.query(cn, k=1)[0]
    d1 = float(np.mean(np.minimum(da, clip)))
    d2 = float(np.mean(np.minimum(db, clip)))
    cov_t = float(np.mean(da <= eps))
    cov_c = float(np.mean(db <= eps))
    return d1, d2, (d1 + d2) / 2.0, cov_t, cov_c


def best_normalized_shape_score(template_points: np.ndarray, candidate_points: np.ndarray, rotations: Iterable[float] | None = None) -> dict:
    if rotations is None:
        rotations = (0, math.pi / 2, math.pi, 3 * math.pi / 2)
    best = {"chamfer": 999.0, "rotation_degrees": 0.0, "coverage_template": 0.0, "coverage_candidate": 0.0}
    tn = normalize_points(template_points)
    if tn.shape[0] == 0:
        return best
    # The template tree is identical across every candidate rotation, so build it once.
    t_tree = cKDTree(tn)
    for rot in rotations:
        cn = normalize_points(candidate_points, rotation_radians=rot)
        if cn.shape[0] == 0:
            continue
        c_tree = cKDTree(cn)
        d1, d2, d, cov_t, cov_c = _shape_metrics(t_tree, tn, c_tree, cn)
        if d < best["chamfer"]:
            best = {
                "chamfer": float(d),
                "chamfer_template_to_candidate": float(d1),
                "chamfer_candidate_to_template": float(d2),
                "rotation_degrees": float(math.degrees(rot)),
                "coverage_template": float(cov_t),
                "coverage_candidate": float(cov_c),
            }
    return best


def descriptor_for_drawings(drawings: Sequence[dict], points: np.ndarray) -> dict:
    bbox = drawing_bbox(drawings)
    item_counts = []
    num_lines = num_cubics = num_rects = num_quads = 0
    has_fill = False
    has_stroke = False
    fills = []
    strokes = []
    widths = []
    for d in drawings:
        items = d.get("items", []) or []
        item_counts.append(len(items))
        if d.get("fill") is not None:
            has_fill = True
            fills.append(tuple(float(x) for x in d.get("fill")))
        if d.get("color") is not None:
            has_stroke = True
            strokes.append(tuple(float(x) for x in d.get("color")))
        if d.get("width") is not None:
            widths.append(float(d.get("width")))
        for it in items:
            if it[0] == "l":
                num_lines += 1
            elif it[0] == "c":
                num_cubics += 1
            elif it[0] == "re":
                num_rects += 1
            elif it[0] == "qu":
                num_quads += 1
    return {
        "bbox_mupdf": [bbox.x0, bbox.y0, bbox.x1, bbox.y1],
        "bbox_width": float(bbox.width),
        "bbox_height": float(bbox.height),
        "bbox_aspect": float(bbox.width / bbox.height) if bbox.height else None,
        "num_paths": len(drawings),
        "path_item_counts": item_counts,
        "num_items": int(sum(item_counts)),
        "num_line_items": int(num_lines),
        "num_cubic_items": int(num_cubics),
        "num_rect_items": int(num_rects),
        "num_quad_items": int(num_quads),
        "has_fill": has_fill,
        "has_stroke": has_stroke,
        "fill_colors": fills,
        "stroke_colors": strokes,
        "stroke_widths": widths,
        "point_count": int(points.shape[0]),
        "visual_hash": points_hash(points),
    }
