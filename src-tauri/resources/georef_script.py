#!/usr/bin/env python3
"""
Georeference a single aviation PDF chart.

CLI:
    python3 georef_script.py --pdf <path.pdf> --csv-dir <dir>

Outputs a JSON array (one element per page) on stdout:
    [{"page": 1, "georeferenced": true, "transform": [a,b,c,d,e,f],
      "page_width": 595.28, "page_height": 841.89,
      "rmse_meters": 45.2, "control_point_count": 7}, ...]

The transform maps mupdf coordinates (top-left origin, points)
to Web Mercator meters: mercator_x = a*px + c*py + e
                        mercator_y = b*px + d*py + f

Control-point sources (in priority order):
  1. designated_triangle  – small filled triangles matched to DESIGNATED_POINT.csv
  2. waypoint_symbol      – larger waypoint glyphs matched to Waypoint/*.pdf tables
  3. navaid_symbol        – VOR/DME glyphs matched to VOR.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import fitz  # PyMuPDF

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

Point = Tuple[float, float]

EARTH_RADIUS_M = 6_378_137.0
MIN_GEOREF_CONTROL_POINTS = 3
MAX_GEOREF_RMSE_METERS = 1000.0
WAYPOINT_NAME_RE = re.compile(r"[A-Z]{2}\d{3}|RW\d{2}[LRC]?|[A-Z]{3,5}")
# Regex that matches a combined lat/lon coordinate string (starts N/S, contains E/W)
COORD_RE = re.compile(r"^[NS].*[EW].*")


@dataclass
class RealPoint:
    name: str
    lat: float
    lon: float


@dataclass
class ControlPoint:
    waypoint: str
    source: str
    mupdf_x: float
    mupdf_y: float
    mercator_x: float
    mercator_y: float
    used_for_georef: bool = False
    georef_residual_meters: Optional[float] = None


@dataclass
class TerminalSymbol:
    source: str
    center_mupdf: Point


@dataclass
class Triangle:
    drawing_index: int
    vertices_mupdf: Tuple[Point, Point, Point]
    center_mupdf: Point
    bbox_center_mupdf: Point


# ---------------------------------------------------------------------------
# Coordinate helpers
# ---------------------------------------------------------------------------

def dms_to_decimal(value: str) -> float:
    text = value.strip().upper()
    if not text:
        raise ValueError("empty coordinate")
    hemi = text[0]
    digits = re.sub(r"[^0-9.]", "", text[1:])
    if hemi in {"N", "S"}:
        deg_digits = 2
    elif hemi in {"E", "W"}:
        deg_digits = 3
    else:
        raise ValueError(f"unsupported hemisphere: {value!r}")
    degrees = int(digits[:deg_digits])
    minutes = int(digits[deg_digits:deg_digits + 2] or "0")
    seconds = float(digits[deg_digits + 2:] or "0")
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    return -decimal if hemi in {"S", "W"} else decimal


def lonlat_to_mercator(lon: float, lat: float) -> Tuple[float, float]:
    clamped = max(min(lat, 89.5), -89.5)
    x = EARTH_RADIUS_M * math.radians(lon)
    y = EARTH_RADIUS_M * math.log(math.tan(math.pi / 4.0 + math.radians(clamped) / 2.0))
    return x, y


# ---------------------------------------------------------------------------
# Waypoint PDF table parsing  (ported from extract_waypoint_locations.py)
# ---------------------------------------------------------------------------
# Terminal waypoints (like PEK01, HU001, RW01L) are published in separate
# Waypoint/*.pdf coordinate tables, NOT in DESIGNATED_POINT.csv.
# These tables use a multi-column layout: name | coord | name | coord | …

def _parse_coord_component(component: str, deg_digits: int) -> float:
    text = component.strip().upper()
    hemi = text[0]
    body = text[1:]
    numbers = re.findall(r"\d+(?:\.\d+)?", body)
    if not numbers:
        raise ValueError(f"missing coordinate numbers in {component!r}")
    first = numbers[0]
    integer, dot, fraction = first.partition(".")
    if len(integer) >= deg_digits + 4:
        # Compact DMS, e.g. N313859.20 or E1214211.95.
        degrees = int(integer[:deg_digits])
        minutes = float(integer[deg_digits:deg_digits + 2])
        seconds_text = integer[deg_digits + 2:] + (dot + fraction if dot else "")
        seconds = float(seconds_text)
    elif len(integer) > deg_digits:
        # Compact degrees + decimal minutes, e.g. N3138.987.
        degrees = int(integer[:deg_digits])
        minutes = float(integer[deg_digits:] + (dot + fraction if dot else ""))
        seconds = float(numbers[1]) if len(numbers) > 1 else 0.0
    else:
        degrees = int(first)
        minutes = float(numbers[1]) if len(numbers) > 1 else 0.0
        seconds = float(numbers[2]) if len(numbers) > 2 else 0.0
    if not (0 <= minutes < 60) or not (0 <= seconds < 60):
        raise ValueError(f"invalid DMS component in {component!r}")
    decimal = degrees + minutes / 60.0 + seconds / 3600.0
    return -decimal if hemi in {"S", "W"} else decimal


def _parse_latlon(raw: str) -> Tuple[float, float]:
    text = raw.strip().upper()
    lon_match = re.search(r"[EW]", text)
    if not lon_match:
        raise ValueError(f"missing longitude hemisphere in {raw!r}")
    lat_part = text[: lon_match.start()]
    lon_part = text[lon_match.start():]
    return _parse_coord_component(lat_part, 2), _parse_coord_component(lon_part, 3)


def _extract_waypoints_from_pdf(pdf_path: Path, y_tolerance: float = 3.0) -> Dict[str, RealPoint]:
    """Parse a Waypoint coordinate table PDF and return name→RealPoint mapping."""
    points: Dict[str, RealPoint] = {}
    seen: set = set()
    with fitz.open(pdf_path) as doc:
        for page in doc:
            words = page.get_text("words")
            names = [w for w in words if WAYPOINT_NAME_RE.fullmatch(str(w[4]).strip())]
            coords = [w for w in words if COORD_RE.match(str(w[4]).strip())]
            for coord in coords:
                coord_text = str(coord[4]).strip()
                coord_cx = (float(coord[0]) + float(coord[2])) / 2.0
                coord_cy = (float(coord[1]) + float(coord[3])) / 2.0
                candidates = []
                for name in names:
                    name_text = str(name[4]).strip().upper()
                    name_cx = (float(name[0]) + float(name[2])) / 2.0
                    name_cy = (float(name[1]) + float(name[3])) / 2.0
                    if name_cx >= coord_cx:
                        continue
                    if abs(name_cy - coord_cy) > y_tolerance:
                        continue
                    candidates.append((coord_cx - name_cx, name_text))
                if not candidates:
                    continue
                _, name_text = min(candidates)
                if name_text in seen:
                    continue
                try:
                    lat, lon = _parse_latlon(coord_text)
                except ValueError:
                    continue
                points[name_text] = RealPoint(name=name_text, lat=lat, lon=lon)
                seen.add(name_text)
    return points





# ---------------------------------------------------------------------------
# CSV loaders
# ---------------------------------------------------------------------------

def load_designated_points(csv_dir: Path) -> Dict[str, RealPoint]:
    path = csv_dir / "DESIGNATED_POINT.csv"
    points: Dict[str, RealPoint] = {}
    if not path.exists():
        return points
    with path.open(newline="", encoding="gb18030") as fh:
        for row in csv.DictReader(fh):
            lat_raw = (row.get("GEO_LAT_ACCURACY") or "").strip()
            lon_raw = (row.get("GEO_LONG_ACCURACY") or "").strip()
            if not lat_raw or not lon_raw:
                continue
            names = {
                (row.get("CODE_ID") or "").strip().upper(),
                (row.get("TXT_NAME") or "").strip().upper(),
            }
            names.discard("")
            if not names:
                continue
            try:
                lat = dms_to_decimal(lat_raw)
                lon = dms_to_decimal(lon_raw)
            except ValueError:
                continue
            for name in names:
                points[name] = RealPoint(name=name, lat=lat, lon=lon)
    return points


def load_vor_points(csv_dir: Path) -> Dict[str, RealPoint]:
    path = csv_dir / "VOR.csv"
    points: Dict[str, RealPoint] = {}
    if not path.exists():
        return points
    with path.open(newline="", encoding="gb18030") as fh:
        for row in csv.DictReader(fh):
            name = (row.get("CODE_ID") or "").strip().upper()
            lat_raw = (row.get("GEO_LAT_ACCURACY") or "").strip()
            lon_raw = (row.get("GEO_LONG_ACCURACY") or "").strip()
            if not name or not lat_raw or not lon_raw:
                continue
            try:
                lat = dms_to_decimal(lat_raw)
                lon = dms_to_decimal(lon_raw)
            except ValueError:
                continue
            points[name] = RealPoint(name=name, lat=lat, lon=lon)
    return points


# ---------------------------------------------------------------------------
# Affine fitting (reflected similarity: PDF Y-down → Mercator Y-up)
# ---------------------------------------------------------------------------

Transform6 = Tuple[float, float, float, float, float, float]


def reflected_similarity_fit(points: Sequence[ControlPoint]) -> Transform6:
    sx = sum(p.mupdf_x for p in points) / len(points)
    sy = sum(p.mupdf_y for p in points) / len(points)
    tx = sum(p.mercator_x for p in points) / len(points)
    ty = sum(p.mercator_y for p in points) / len(points)

    num_real = num_imag = denom = 0.0
    for p in points:
        dx = p.mupdf_x - sx
        dy = p.mupdf_y - sy
        ex = p.mercator_x - tx
        ey = p.mercator_y - ty
        rdy = -dy  # reflect Y axis (PDF Y-down, Mercator Y-up)
        num_real += ex * dx + ey * rdy
        num_imag += ey * dx - ex * rdy
        denom += dx * dx + dy * dy
    if denom < 1e-12:
        raise ValueError("duplicate PDF control points")
    a = num_real / denom
    b = num_imag / denom
    c = num_imag / denom
    d = -num_real / denom
    e = tx - (a * sx + c * sy)
    f = ty - (b * sx + d * sy)
    return a, b, c, d, e, f


def apply_transform(t: Transform6, x: float, y: float) -> Tuple[float, float]:
    a, b, c, d, e, f = t
    return a * x + c * y + e, b * x + d * y + f


def _residual(t: Transform6, p: ControlPoint) -> float:
    fx, fy = apply_transform(t, p.mupdf_x, p.mupdf_y)
    return math.hypot(fx - p.mercator_x, fy - p.mercator_y)


def _unique_by_waypoint(points: Sequence[ControlPoint]) -> List[ControlPoint]:
    seen: Dict[str, ControlPoint] = {}
    for p in points:
        seen.setdefault(p.waypoint, p)
    return list(seen.values())


def _dedupe_inliers(
    points: Sequence[ControlPoint],
    residuals: Dict[int, float],
) -> List[ControlPoint]:
    best: Dict[str, ControlPoint] = {}
    for p in points:
        cur = best.get(p.waypoint)
        if cur is None or residuals[id(p)] < residuals[id(cur)]:
            best[p.waypoint] = p
    return list(best.values())


def robust_reflected_similarity_fit(
    points: Sequence[ControlPoint],
    inlier_threshold_meters: float = 1500.0,
) -> Tuple[Optional[Transform6], List[ControlPoint]]:
    candidates = list(points)
    if len(candidates) < MIN_GEOREF_CONTROL_POINTS:
        return None, []

    best_transform: Optional[Transform6] = None
    best_inliers: List[ControlPoint] = []
    best_rmse = math.inf

    for i, first in enumerate(candidates):
        for second in candidates[i + 1:]:
            src_dist = math.hypot(first.mupdf_x - second.mupdf_x, first.mupdf_y - second.mupdf_y)
            tgt_dist = math.hypot(first.mercator_x - second.mercator_x, first.mercator_y - second.mercator_y)
            if src_dist < 10.0 or tgt_dist < 1000.0:
                continue
            try:
                transform = reflected_similarity_fit([first, second])
            except ValueError:
                continue
            res = {id(p): _residual(transform, p) for p in candidates}
            raw = [p for p in candidates if res[id(p)] <= inlier_threshold_meters]
            inliers = _dedupe_inliers(raw, res)
            if len(inliers) < MIN_GEOREF_CONTROL_POINTS:
                continue
            try:
                refined = reflected_similarity_fit(inliers)
            except ValueError:
                continue
            for _ in range(3):
                refined_res = {id(p): _residual(refined, p) for p in candidates}
                refined_raw = [p for p in candidates if refined_res[id(p)] <= inlier_threshold_meters]
                refined_inliers = _dedupe_inliers(refined_raw, refined_res)
                if len(refined_inliers) < MIN_GEOREF_CONTROL_POINTS:
                    break
                next_refined = reflected_similarity_fit(refined_inliers)
                if {id(p) for p in refined_inliers} == {id(p) for p in inliers}:
                    refined = next_refined
                    inliers = refined_inliers
                    break
                refined = next_refined
                inliers = refined_inliers

            finals = [_residual(refined, p) for p in inliers]
            rmse = math.sqrt(sum(v * v for v in finals) / len(finals))
            if len(inliers) > len(best_inliers) or (len(inliers) == len(best_inliers) and rmse < best_rmse):
                best_transform = refined
                best_inliers = inliers
                best_rmse = rmse

    if best_transform is None:
        fallback = _unique_by_waypoint(candidates)
        if len(fallback) < MIN_GEOREF_CONTROL_POINTS:
            return None, []
        try:
            best_transform = reflected_similarity_fit(fallback)
            best_inliers = fallback
        except ValueError:
            return None, []

    return best_transform, best_inliers


def fit_page_transform(
    controls: Sequence[ControlPoint],
) -> Tuple[Optional[Transform6], Optional[float]]:
    if len(controls) < MIN_GEOREF_CONTROL_POINTS:
        return None, None
    transform, inliers = robust_reflected_similarity_fit(controls)
    if transform is None:
        return None, None
    inlier_ids = {id(p) for p in inliers}
    squared = 0.0
    for p in controls:
        r = _residual(transform, p)
        p.georef_residual_meters = r
        p.used_for_georef = id(p) in inlier_ids
        if p.used_for_georef:
            squared += r * r
    rmse = math.sqrt(squared / len(inliers)) if inliers else None
    if len(inliers) < MIN_GEOREF_CONTROL_POINTS:
        return None, None
    if rmse is None or rmse > MAX_GEOREF_RMSE_METERS:
        return None, None
    return transform, rmse


# ---------------------------------------------------------------------------
# Triangle extraction (small filled triangles = en-route fixes)
# ---------------------------------------------------------------------------




def _close_pt(a: Point, b: Point, tol: float = 1e-3) -> bool:
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


def _unique_points(pts: Iterable[Point]) -> List[Point]:
    out: List[Point] = []
    for p in pts:
        if not any(_close_pt(p, q) for q in out):
            out.append(p)
    return out


def extract_filled_triangles(page: fitz.Page) -> List[Triangle]:
    """Detect waypoint fix markers: filled triangles (3L), hollow triangles (3-10L stroked),
    filled diamonds (4L), hollow diamonds (4L stroked), and larger filled triangles (>3L).

    Covers all symbol types from 总则_2.3航图符号.pdf section 4:
    - 强制/非强制报告点: solid filled triangle (3L, 3-15pt) — older ZBAA charts
    - 强制/非强制报告点: hollow triangle (3-10L stroked, 8-15pt) — newer/ZUNZ charts
    - 区域导航强制/非强制航路点: filled/hollow diamond (4L closed polygon)
    """
    triangles: List[Triangle] = []
    pw, ph = float(page.rect.width), float(page.rect.height)

    for idx, drawing in enumerate(page.get_drawings()):
        rect = drawing.get("rect")
        if rect is None:
            continue
        w, h = float(rect.width), float(rect.height)
        x0, y0 = float(rect.x0), float(rect.y0)

        # Exclude footer and header bands (text/legend areas)
        if y0 > ph - 50 or y0 < 20:
            continue
        # Exclude left/right margins where text legends often live
        if x0 < 15 or x0 > pw - 15:
            continue

        items = drawing.get("items", [])
        fill = drawing.get("fill")
        color = drawing.get("color")  # stroke color

        is_black_fill = fill is not None and len(fill) >= 3 and max(fill[:3]) <= 0.15
        is_dark_stroke = color is not None and len(color) >= 3 and max(color[:3]) <= 0.15
        is_hollow = fill is None or (len(fill) >= 3 and min(fill[:3]) > 0.8)

        line_items = [it for it in items if it[0] == "l"]
        all_line = all(it[0] == "l" for it in items) if items else False

        cx: Optional[float] = None
        cy: Optional[float] = None
        matched = False

        # ── Case 1: Small filled triangle — 3 closed line segments (ZBAA style) ──
        if is_black_fill and len(items) == 3 and all_line and 3.0 <= w <= 18.0 and 3.0 <= h <= 18.0:
            segs: List[Tuple[Point, Point]] = []
            all_pts: List[Point] = []
            for it in items:
                _, p0, p1 = it
                a = (float(p0.x), float(p0.y))
                b = (float(p1.x), float(p1.y))
                segs.append((a, b))
                all_pts.extend([a, b])
            verts = _unique_points(all_pts)
            if len(verts) == 3 and (
                _close_pt(segs[0][1], segs[1][0])
                and _close_pt(segs[1][1], segs[2][0])
                and _close_pt(segs[2][1], segs[0][0])
            ):
                cx = sum(p[0] for p in verts) / 3.0
                cy = sum(p[1] for p in verts) / 3.0
                matched = True

        # ── Case 2: Hollow triangle — stroked, 3-10 line segments, 3-20pt ──
        # ZUNZ approach charts use 8-line hollow triangles (~11x11pt)
        elif is_hollow and is_dark_stroke and 3 <= len(line_items) <= 12 and all_line:
            if 3.0 <= w <= 20.0 and 3.0 <= h <= 20.0 and abs(w / h - 1.0) <= 0.6:
                all_pts = []
                for it in items:
                    _, p0, p1 = it
                    all_pts.extend([(float(p0.x), float(p0.y)), (float(p1.x), float(p1.y))])
                verts = _unique_points(all_pts)
                # A triangle has 3 vertices regardless of how many line segments draw it
                if 3 <= len(verts) <= 5:
                    cx = sum(p[0] for p in verts) / len(verts)
                    cy = sum(p[1] for p in verts) / len(verts)
                    matched = True

        # ── Case 3: Filled diamond — 4 line segments forming closed rhombus ──
        elif is_black_fill and len(items) == 4 and all_line and 3.0 <= w <= 15.0 and 3.0 <= h <= 15.0:
            all_pts = []
            for it in items:
                _, p0, p1 = it
                all_pts.extend([(float(p0.x), float(p0.y)), (float(p1.x), float(p1.y))])
            verts = _unique_points(all_pts)
            if len(verts) == 4:
                cx = (float(rect.x0) + float(rect.x1)) / 2.0
                cy = (float(rect.y0) + float(rect.y1)) / 2.0
                matched = True

        # ── Case 4: Hollow diamond — stroked, 4 line segments, roughly square bbox ──
        elif is_hollow and is_dark_stroke and len(items) == 4 and all_line:
            if 3.0 <= w <= 15.0 and 3.0 <= h <= 15.0 and abs(w / h - 1.0) <= 0.6:
                all_pts = []
                for it in items:
                    _, p0, p1 = it
                    all_pts.extend([(float(p0.x), float(p0.y)), (float(p1.x), float(p1.y))])
                verts = _unique_points(all_pts)
                if len(verts) == 4:
                    cx = (float(rect.x0) + float(rect.x1)) / 2.0
                    cy = (float(rect.y0) + float(rect.y1)) / 2.0
                    matched = True

        if matched and cx is not None and cy is not None:
            triangles.append(
                Triangle(
                    drawing_index=idx,
                    vertices_mupdf=((cx, cy), (cx, cy), (cx, cy)),  # center used for matching
                    center_mupdf=(cx, cy),
                    bbox_center_mupdf=(
                        (float(rect.x0) + float(rect.x1)) / 2.0,
                        (float(rect.y0) + float(rect.y1)) / 2.0,
                    ),
                )
            )

    return triangles


# ---------------------------------------------------------------------------
# Terminal symbol extraction (larger waypoint/navaid glyphs)
# ---------------------------------------------------------------------------

def _is_black(color: Optional[Tuple[float, ...]], max_component: float = 0.05) -> bool:
    return color is not None and len(color) >= 3 and max(color[:3]) <= max_component


def extract_terminal_symbols(page: fitz.Page) -> List[TerminalSymbol]:
    """Detect the larger filled waypoint and navaid symbols used on terminal charts."""
    symbols: List[TerminalSymbol] = []
    for drawing in page.get_drawings():
        rect = drawing.get("rect")
        if rect is None:
            continue
        w, h = float(rect.width), float(rect.height)
        items = drawing.get("items", [])
        # Ignore drawings in the footer area
        if rect.y0 > page.rect.height - 60:
            continue
        source = None
        if (
            drawing.get("type") == "f"
            and _is_black(drawing.get("fill"))
            and (
                (35 <= len(items) <= 90 and 7.0 <= w <= 11.0 and 7.0 <= h <= 11.0)
                or (45 <= len(items) <= 60 and 12.0 <= w <= 16.0 and 12.0 <= h <= 16.0)
            )
            and abs(w - h) <= 1.5
        ):
            source = "waypoint_symbol"
        elif (
            drawing.get("type") == "f"
            and _is_black(drawing.get("fill"))
            and 20 <= len(items) <= 35
            and 6.0 <= w <= 10.0
            and 5.0 <= h <= 10.0
            and 0.7 <= w / h <= 1.8
            and not (rect.x0 < 40.0 and rect.y0 > page.rect.height * 0.5)
        ):
            source = "navaid_symbol"
        if source is not None:
            symbols.append(
                TerminalSymbol(
                    source=source,
                    center_mupdf=(
                        (float(rect.x0) + float(rect.x1)) / 2.0,
                        (float(rect.y0) + float(rect.y1)) / 2.0,
                    ),
                )
            )
    return symbols


# ---------------------------------------------------------------------------
# Control point extraction per page
# ---------------------------------------------------------------------------

_FIX_WORD_RE = re.compile(r"[A-Z]{2}\d{3}|RW\d{2}[LRC]?|[A-Z]{3,8}")


def extract_all_fix_controls(
    page: fitz.Page,
    designated: Dict[str, RealPoint],
    terminal_locations: Dict[str, RealPoint],
    navaid_locations: Dict[str, RealPoint],
    existing_names: set,
) -> List[ControlPoint]:
    """Match all fix symbols (filled/hollow triangles, filled/hollow diamonds) to
    known waypoint coordinates from any available source.

    Lookup priority: terminal_locations (waypoint PDF) → designated (DESIGNATED_POINT.csv)
    → navaid_locations (VOR.csv, 3-letter IDs only).

    Uses greedy nearest-symbol matching with 80pt max distance.  Profile-section
    duplicate labels (>200pt from any symbol) are naturally excluded by the distance cap.
    """
    symbols = extract_filled_triangles(page)
    if not symbols:
        return []

    # Build combined lookup; designated overrides terminal for same name (more accurate)
    combined: Dict[str, RealPoint] = {**terminal_locations, **designated}

    labels = []
    for word in page.get_text("words"):
        x0, y0, x1, y1, text = word[:5]
        text = str(text).strip().upper()
        if text in existing_names or not _FIX_WORD_RE.fullmatch(text):
            continue
        location = combined.get(text)
        if location is None and re.fullmatch(r"[A-Z]{3}", text):
            location = navaid_locations.get(text)
        if location is None:
            continue
        lx = (float(x0) + float(x1)) / 2.0
        ly = (float(y0) + float(y1)) / 2.0
        labels.append((text, location, lx, ly))

    # All (label, symbol) pairs within 80 pt — greedy pick by ascending distance
    pairs = []
    for li, (text, location, lx, ly) in enumerate(labels):
        for si, sym in enumerate(symbols):
            dist = math.hypot(lx - sym.center_mupdf[0], ly - sym.center_mupdf[1])
            if dist <= 80.0:
                pairs.append((dist, li, si, text, location, sym))
    pairs.sort(key=lambda p: p[0])

    used_labels: set = set()
    used_symbols: set = set()
    controls: List[ControlPoint] = []
    for dist, li, si, text, location, sym in pairs:
        if li in used_labels or si in used_symbols:
            continue
        used_labels.add(li)
        used_symbols.add(si)
        mx, my = lonlat_to_mercator(location.lon, location.lat)
        controls.append(
            ControlPoint(
                waypoint=text,
                source="fix_symbol",
                mupdf_x=sym.center_mupdf[0],
                mupdf_y=sym.center_mupdf[1],
                mercator_x=mx,
                mercator_y=my,
            )
        )
    return controls


def extract_navaid_controls(
    page: fitz.Page,
    navaid_locations: Dict[str, RealPoint],
    existing_names: set,
) -> List[ControlPoint]:
    """Match complex VOR/DME station glyphs (navaid_symbol) to VOR.csv entries."""
    symbols = [s for s in extract_terminal_symbols(page) if s.source == "navaid_symbol"]
    if not symbols:
        return []

    labels = []
    for word in page.get_text("words"):
        x0, y0, x1, y1, text = word[:5]
        text = str(text).strip().upper()
        if text in existing_names or not re.fullmatch(r"[A-Z]{3}", text):
            continue
        location = navaid_locations.get(text)
        if location is None:
            continue
        lx = (float(x0) + float(x1)) / 2.0
        ly = (float(y0) + float(y1)) / 2.0
        labels.append((text, location, lx, ly))

    pairs = []
    for li, (text, location, lx, ly) in enumerate(labels):
        for si, sym in enumerate(symbols):
            dist = math.hypot(lx - sym.center_mupdf[0], ly - sym.center_mupdf[1])
            if dist <= 105.0:
                pairs.append((dist, li, si, text, location, sym))
    pairs.sort(key=lambda p: p[0])

    used_labels: set = set()
    used_symbols: set = set()
    controls: List[ControlPoint] = []
    for dist, li, si, text, location, sym in pairs:
        if li in used_labels or si in used_symbols:
            continue
        used_labels.add(li)
        used_symbols.add(si)
        mx, my = lonlat_to_mercator(location.lon, location.lat)
        controls.append(
            ControlPoint(
                waypoint=text,
                source="navaid_symbol",
                mupdf_x=sym.center_mupdf[0],
                mupdf_y=sym.center_mupdf[1],
                mercator_x=mx,
                mercator_y=my,
            )
        )
    return controls


def extract_waypoint_symbol_controls(
    page: fitz.Page,
    terminal_locations: Dict[str, RealPoint],
    existing_names: set,
) -> List[ControlPoint]:
    """Match larger terminal waypoint glyphs to waypoint PDF coordinate rows."""
    symbols = [s for s in extract_terminal_symbols(page) if s.source == "waypoint_symbol"]
    if not symbols or not terminal_locations:
        return []

    labels = []
    for word in page.get_text("words"):
        x0, y0, x1, y1, text = word[:5]
        text = str(text).strip().upper()
        if text in existing_names or not _FIX_WORD_RE.fullmatch(text):
            continue
        location = terminal_locations.get(text)
        if location is None:
            continue
        lx = (float(x0) + float(x1)) / 2.0
        ly = (float(y0) + float(y1)) / 2.0
        labels.append((text, location, lx, ly))

    pairs = []
    for li, (text, location, lx, ly) in enumerate(labels):
        for si, sym in enumerate(symbols):
            dist = math.hypot(lx - sym.center_mupdf[0], ly - sym.center_mupdf[1])
            if dist <= 105.0:
                pairs.append((dist, li, si, text, location, sym))
    pairs.sort(key=lambda p: p[0])

    used_labels: set = set()
    used_symbols: set = set()
    controls: List[ControlPoint] = []
    for dist, li, si, text, location, sym in pairs:
        if li in used_labels or si in used_symbols:
            continue
        used_labels.add(li)
        used_symbols.add(si)
        mx, my = lonlat_to_mercator(location.lon, location.lat)
        controls.append(
            ControlPoint(
                waypoint=text,
                source="waypoint_symbol",
                mupdf_x=sym.center_mupdf[0],
                mupdf_y=sym.center_mupdf[1],
                mercator_x=mx,
                mercator_y=my,
            )
        )
    return controls


# ---------------------------------------------------------------------------
# Main per-page processing
# ---------------------------------------------------------------------------

def process_pdf(
    pdf_path: Path,
    csv_dir: Path,
    waypoint_pdf: Optional[Path] = None,
    page_number: Optional[int] = None,
) -> List[dict]:
    designated = load_designated_points(csv_dir)
    navaid = load_vor_points(csv_dir)

    # Terminal waypoints come from the airport's 航路点坐标 (waypoint coordinate) PDF.
    # This PDF is part of the chart set and is identified by ChartName in Charts.csv.
    # The Rust backend resolves it and passes the path via --waypoint-pdf.
    terminal_locations: Dict[str, RealPoint] = {}
    if waypoint_pdf is not None and waypoint_pdf.is_file():
        terminal_locations = _extract_waypoints_from_pdf(waypoint_pdf)

    results = []
    with fitz.open(pdf_path) as doc:
        if page_number is not None:
            if page_number < 1 or page_number > len(doc):
                raise ValueError(f"page {page_number} is outside PDF page range 1-{len(doc)}")
            pages = [(page_number, doc.load_page(page_number - 1))]
        else:
            pages = list(enumerate(doc, start=1))

        for page_index, page in pages:
            rect = page.rect
            page_width = float(rect.width)
            page_height = float(rect.height)

            # Phase 1: all fix symbols (triangles, diamonds) matched against all coordinate sources
            controls = extract_all_fix_controls(page, designated, terminal_locations, navaid, set())
            existing = {p.waypoint for p in controls}

            # Phase 2: larger terminal waypoint glyphs from the waypoint table PDF
            extra = extract_waypoint_symbol_controls(page, terminal_locations, existing)
            controls.extend(extra)
            existing.update(p.waypoint for p in extra)

            # Phase 3: VOR/DME station glyphs
            extra = extract_navaid_controls(page, navaid, existing)
            controls.extend(extra)

            transform, rmse = fit_page_transform(controls)

            results.append({
                "page": page_index,
                "georeferenced": transform is not None,
                "transform": list(transform) if transform is not None else None,
                "page_width": page_width,
                "page_height": page_height,
                "rmse_meters": rmse,
                "control_point_count": len(controls),
            })

    return results


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args(argv: Optional[Sequence] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Georeference a single aviation PDF chart and output JSON page data."
    )
    parser.add_argument("--pdf", type=Path, required=True, help="PDF chart to process")
    parser.add_argument(
        "--csv-dir",
        type=Path,
        required=True,
        help="Directory containing DESIGNATED_POINT.csv and VOR.csv",
    )
    parser.add_argument(
        "--waypoint-pdf",
        type=Path,
        default=None,
        help="Path to the airport's 航路点坐标 PDF (terminal waypoint coordinate table)",
    )
    parser.add_argument(
        "--page",
        type=int,
        default=None,
        help="Only process this 1-based PDF page number",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence] = None) -> int:
    args = parse_args(argv)
    if not args.pdf.exists():
        print(f"PDF not found: {args.pdf}", file=sys.stderr)
        return 1
    if not args.csv_dir.exists():
        print(f"CSV directory not found: {args.csv_dir}", file=sys.stderr)
        return 1
    try:
        results = process_pdf(args.pdf, args.csv_dir, args.waypoint_pdf, args.page)
        print(json.dumps(results, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
