#!/usr/bin/env python3
"""
Georeference a single aviation PDF chart.

CLI:
    python3 georef_script.py --pdf <path.pdf> --csv-dir <dir>

Outputs a JSON array (one element per page) on stdout:
    [{"page": 1, "georeferenced": true, "transform": [a,b,c,d,e,f],
      "page_width": 595.28, "page_height": 841.89,
      "rmse_meters": 45.2, "control_point_count": 7,
      "high_accuracy_transform": {...}, "control_points": [...]}, ...]

The transform maps mupdf coordinates (top-left origin, points)
to Web Mercator meters: mercator_x = a*px + c*py + e
                        mercator_y = b*px + d*py + f

When enough high-quality control points exist, high_accuracy_transform contains
a weighted robust local-polynomial model plus inverse coefficients.  The affine
transform remains present as a compatibility fallback.

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
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import fitz  # PyMuPDF

try:
    from pyproj import Geod
except Exception:  # pragma: no cover - optional in development, bundled in sidecar
    Geod = None  # type: ignore[assignment]

GEOD = Geod(ellps="WGS84") if Geod is not None else None

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

Point = Tuple[float, float]

EARTH_RADIUS_M = 6_378_137.0
MIN_GEOREF_CONTROL_POINTS = 4
MAX_GEOREF_RMSE_METERS = 300.0
MAX_HIGH_ACCURACY_RMSE_METERS = 120.0
MAX_HIGH_ACCURACY_RESIDUAL_METERS = 300.0
WAYPOINT_NAME_RE = re.compile(r"[A-Z]{2}\d{3}|RW\d{2}[LRC]?|[A-Z]{3,5}")
# Regex that matches a combined lat/lon coordinate string (starts N/S, contains E/W)
COORD_RE = re.compile(r"^[NS].*[EW].*")
# Labels that appear on charts but are NOT navigation waypoints and must never be matched.
# TCH = Threshold Crossing Height (a printed altitude value annotation, not a fix name).
IGNORED_FIX_LABELS = {"TCH"}
MAX_VECTOR_OVERLAY_PATHS = 600
MAX_VECTOR_OVERLAY_POINTS = 64


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
    lon: float
    lat: float
    mercator_x: float
    mercator_y: float
    used_for_georef: bool = False
    georef_residual_meters: Optional[float] = None


@dataclass
class GeorefFit:
    transform: Transform6
    rmse_meters: float
    max_error_meters: float
    inliers: List[ControlPoint]
    method: str
    high_accuracy_transform: Optional[Dict[str, Any]] = None


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


@dataclass
class VectorOverlayPath:
    points_mupdf: List[Point]
    line_width: float
    stroke: Optional[Tuple[float, float, float]]


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


def mercator_to_lonlat(x: float, y: float) -> Tuple[float, float]:
    lon = math.degrees(x / EARTH_RADIUS_M)
    lat = math.degrees(2.0 * math.atan(math.exp(y / EARTH_RADIUS_M)) - math.pi / 2.0)
    return lon, lat


def great_circle_distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Geodesic distance in meters; pyproj/Geod when available, spherical fallback otherwise."""
    if GEOD is not None:
        _, _, distance = GEOD.inv(lon1, lat1, lon2, lat2)
        return abs(float(distance))
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_M * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def local_meters_from_lonlat(
    lon: float,
    lat: float,
    origin_lon: float,
    origin_lat: float,
) -> Tuple[float, float]:
    """Local tangent-plane approximation used by the polynomial model and JS viewer."""
    cos_lat = max(math.cos(math.radians(origin_lat)), 1e-6)
    east = math.radians(lon - origin_lon) * EARTH_RADIUS_M * cos_lat
    north = math.radians(lat - origin_lat) * EARTH_RADIUS_M
    return east, north


def lonlat_from_local_meters(
    east: float,
    north: float,
    origin_lon: float,
    origin_lat: float,
) -> Tuple[float, float]:
    cos_lat = max(math.cos(math.radians(origin_lat)), 1e-6)
    lon = origin_lon + math.degrees(east / (EARTH_RADIUS_M * cos_lat))
    lat = origin_lat + math.degrees(north / EARTH_RADIUS_M)
    return lon, lat


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
    return load_radio_points(csv_dir / "VOR.csv")


def load_ndb_points(csv_dir: Path) -> Dict[str, RealPoint]:
    return load_radio_points(csv_dir / "NDB.csv")


def load_radio_points(path: Path) -> Dict[str, RealPoint]:
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


def load_navaid_points(csv_dir: Path) -> Dict[str, RealPoint]:
    points = load_vor_points(csv_dir)
    points.update(load_ndb_points(csv_dir))
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


def _solve_3x3(matrix: Sequence[Sequence[float]], values: Sequence[float]) -> Tuple[float, float, float]:
    """Solve a 3×3 linear system via Gaussian elimination with partial pivoting."""
    augmented = [list(row) + [value] for row, value in zip(matrix, values)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda row: abs(augmented[row][col]))
        augmented[col], augmented[pivot] = augmented[pivot], augmented[col]
        pivot_value = augmented[col][col]
        if abs(pivot_value) < 1e-12:
            raise ValueError("degenerate affine control points")
        for item in range(col, 4):
            augmented[col][item] /= pivot_value
        for row in range(3):
            if row == col:
                continue
            factor = augmented[row][col]
            for item in range(col, 4):
                augmented[row][item] -= factor * augmented[col][item]
    return augmented[0][3], augmented[1][3], augmented[2][3]


def affine_fit(points: Sequence[ControlPoint]) -> Transform6:
    """Least-squares affine fit (6 DOF) allowing independent X/Y scales and shear.

    Needed for charts using Lambert Conformal Conic projection, where the
    horizontal and vertical scales differ by ~20-30% near 40°N.
    """
    ata = [[0.0, 0.0, 0.0] for _ in range(3)]
    rhs_x = [0.0, 0.0, 0.0]
    rhs_y = [0.0, 0.0, 0.0]
    for p in points:
        row = (p.mupdf_x, p.mupdf_y, 1.0)
        for i in range(3):
            rhs_x[i] += row[i] * p.mercator_x
            rhs_y[i] += row[i] * p.mercator_y
            for j in range(3):
                ata[i][j] += row[i] * row[j]

    ax, cx, ex = _solve_3x3(ata, rhs_x)
    by, dy, fy = _solve_3x3(ata, rhs_y)
    return ax, by, cx, dy, ex, fy


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


def robust_affine_fit(
    points: Sequence[ControlPoint],
    inlier_threshold_meters: float = 800.0,
    rmse_cap: float = MAX_GEOREF_RMSE_METERS,
) -> Tuple[Optional[Transform6], List[ControlPoint]]:
    """RANSAC affine fit for charts using Lambert Conformal Conic or other non-isotropic projections.

    Uses triples of control points as minimal samples (affine requires 3 non-collinear points).
    An exact 3-point fit is always a valid seed; iterative re-fitting with least-squares is
    used when 4+ inliers are found.

    Selection criterion: among candidates whose RMSE is within rmse_cap, prefer the one with
    the most inliers, then the largest |det| of the 2×2 linear part (larger det = seed triple
    spans a wider geographic area, naturally preferring plan-view controls over approach-profile
    controls that sit at non-geographic positions), then smallest RMSE.
    """
    candidates = list(points)
    if len(candidates) < MIN_GEOREF_CONTROL_POINTS:
        return None, []

    # Candidates with RMSE within cap — valid georefs.
    # Separately track the globally best candidate (any RMSE) as a fallback.
    valid_transform: Optional[Transform6] = None
    valid_inliers: List[ControlPoint] = []
    valid_det = 0.0
    valid_rmse = math.inf

    # Deduplicate by waypoint name before generating seed triples.
    # The same fix often appears in both the geographic plan view and the approach
    # profile/minima section.  _unique_by_waypoint keeps the first occurrence, which
    # matches reading order (top-to-bottom) and therefore the plan-view instance.
    # The full candidates list (with duplicates) is still used for inlier counting so
    # that profile duplicates are correctly rejected via _dedupe_inliers.
    seed_candidates = _unique_by_waypoint(candidates)

    fallback_transform: Optional[Transform6] = None
    fallback_inliers: List[ControlPoint] = []
    fallback_det = 0.0
    fallback_rmse = math.inf

    for i, first in enumerate(seed_candidates):
        for j, second in enumerate(seed_candidates[i + 1:], start=i + 1):
            for third in seed_candidates[j + 1:]:
                if len({first.waypoint, second.waypoint, third.waypoint}) < 3:
                    continue
                # Reject degenerate (nearly collinear) triples
                area2 = abs(
                    (second.mupdf_x - first.mupdf_x) * (third.mupdf_y - first.mupdf_y)
                    - (second.mupdf_y - first.mupdf_y) * (third.mupdf_x - first.mupdf_x)
                )
                if area2 < 200.0:
                    continue
                try:
                    transform = affine_fit([first, second, third])
                except ValueError:
                    continue

                a, b, c, d = transform[0], transform[1], transform[2], transform[3]
                seed_det = abs(a * d - b * c)

                inliers: List[ControlPoint] = []
                refined = transform
                for _ in range(3):
                    residuals = {id(p): _residual(refined, p) for p in candidates}
                    raw = [p for p in candidates if residuals[id(p)] <= inlier_threshold_meters]
                    refined_inliers = _dedupe_inliers(raw, residuals)
                    if len(refined_inliers) < MIN_GEOREF_CONTROL_POINTS:
                        break
                    if len(refined_inliers) >= 4:
                        try:
                            next_refined = affine_fit(refined_inliers)
                        except ValueError:
                            break
                        if {id(p) for p in refined_inliers} == {id(p) for p in inliers}:
                            refined = next_refined
                            inliers = refined_inliers
                            break
                        refined = next_refined
                    inliers = refined_inliers

                if len(inliers) < MIN_GEOREF_CONTROL_POINTS:
                    continue
                finals = [_residual(refined, p) for p in inliers]
                rmse = math.sqrt(sum(v * v for v in finals) / len(finals))

                def _better(n_in: int, det: float, r: float,
                            bn: int, bd: float, br: float) -> bool:
                    if n_in != bn:
                        return n_in > bn
                    if det != bd:
                        return det > bd
                    return r < br

                if rmse <= rmse_cap and _better(len(inliers), seed_det, rmse,
                                                len(valid_inliers), valid_det, valid_rmse):
                    valid_transform = refined
                    valid_inliers = inliers
                    valid_det = seed_det
                    valid_rmse = rmse
                if _better(len(inliers), seed_det, rmse,
                           len(fallback_inliers), fallback_det, fallback_rmse):
                    fallback_transform = refined
                    fallback_inliers = inliers
                    fallback_det = seed_det
                    fallback_rmse = rmse

    if valid_transform is not None:
        return valid_transform, valid_inliers
    return fallback_transform, fallback_inliers


def _transform_residual_geodesic(t: Transform6, p: ControlPoint) -> float:
    mx, my = apply_transform(t, p.mupdf_x, p.mupdf_y)
    lon, lat = mercator_to_lonlat(mx, my)
    return great_circle_distance_m(lon, lat, p.lon, p.lat)


def _source_weight(source: str) -> float:
    # Symbol centers are not equally precise.  Terminal waypoint tables are the
    # most reliable; generic fix glyphs have more false-positive risk.
    return {
        "waypoint_symbol": 1.35,
        "fix_symbol": 1.0,
        "navaid_symbol": 0.85,
    }.get(source, 1.0)


def _poly_terms(degree: int) -> List[Tuple[int, int]]:
    terms: List[Tuple[int, int]] = []
    for total in range(degree + 1):
        for x_power in range(total, -1, -1):
            terms.append((x_power, total - x_power))
    return terms


def _eval_poly_terms(terms: Sequence[Tuple[int, int]], x: float, y: float) -> List[float]:
    return [(x ** xp) * (y ** yp) for xp, yp in terms]


def _solve_linear_system(matrix: Sequence[Sequence[float]], values: Sequence[float]) -> List[float]:
    n = len(values)
    augmented = [list(row) + [value] for row, value in zip(matrix, values)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda row: abs(augmented[row][col]))
        augmented[col], augmented[pivot] = augmented[pivot], augmented[col]
        pivot_value = augmented[col][col]
        if abs(pivot_value) < 1e-12:
            raise ValueError("degenerate polynomial control points")
        for item in range(col, n + 1):
            augmented[col][item] /= pivot_value
        for row in range(n):
            if row == col:
                continue
            factor = augmented[row][col]
            if factor == 0:
                continue
            for item in range(col, n + 1):
                augmented[row][item] -= factor * augmented[col][item]
    return [augmented[row][n] for row in range(n)]


def _weighted_poly_fit(
    samples: Sequence[Tuple[float, float]],
    targets: Sequence[Tuple[float, float]],
    weights: Sequence[float],
    terms: Sequence[Tuple[int, int]],
) -> Tuple[List[float], List[float]]:
    n = len(terms)
    if len(samples) < n:
        raise ValueError("not enough controls for polynomial")
    ata = [[0.0 for _ in range(n)] for _ in range(n)]
    rhs_x = [0.0 for _ in range(n)]
    rhs_y = [0.0 for _ in range(n)]
    for (sx, sy), (tx, ty), weight in zip(samples, targets, weights):
        row = _eval_poly_terms(terms, sx, sy)
        w = max(weight, 1e-6)
        for i in range(n):
            rhs_x[i] += w * row[i] * tx
            rhs_y[i] += w * row[i] * ty
            for j in range(n):
                ata[i][j] += w * row[i] * row[j]
    return _solve_linear_system(ata, rhs_x), _solve_linear_system(ata, rhs_y)


def _eval_coefficients(coefficients: Sequence[float], terms: Sequence[Tuple[int, int]], x: float, y: float) -> float:
    return sum(c * ((x ** xp) * (y ** yp)) for c, (xp, yp) in zip(coefficients, terms))


def _dedupe_by_lowest_residual(
    points: Sequence[ControlPoint],
    residuals: Dict[int, float],
) -> List[ControlPoint]:
    best: Dict[str, ControlPoint] = {}
    for p in points:
        cur = best.get(p.waypoint)
        if cur is None or residuals[id(p)] < residuals[id(cur)]:
            best[p.waypoint] = p
    return list(best.values())


def _build_local_polynomial_model(
    points: Sequence[ControlPoint],
    degree: int,
) -> Optional[Dict[str, Any]]:
    terms = _poly_terms(degree)
    if len(points) < len(terms):
        return None

    pdf_origin_x = sum(p.mupdf_x for p in points) / len(points)
    pdf_origin_y = sum(p.mupdf_y for p in points) / len(points)
    pdf_scale = max(
        max(math.hypot(p.mupdf_x - pdf_origin_x, p.mupdf_y - pdf_origin_y) for p in points),
        1.0,
    )

    origin_lon = sum(p.lon for p in points) / len(points)
    origin_lat = sum(p.lat for p in points) / len(points)
    local_points = [
        local_meters_from_lonlat(p.lon, p.lat, origin_lon, origin_lat)
        for p in points
    ]
    geo_scale = max(
        max(math.hypot(east, north) for east, north in local_points),
        1.0,
    )

    samples_pdf = [
        ((p.mupdf_x - pdf_origin_x) / pdf_scale, (p.mupdf_y - pdf_origin_y) / pdf_scale)
        for p in points
    ]
    targets_local = [(east / geo_scale, north / geo_scale) for east, north in local_points]
    weights = [_source_weight(p.source) for p in points]

    try:
        forward_x, forward_y = _weighted_poly_fit(samples_pdf, targets_local, weights, terms)
        inverse_x, inverse_y = _weighted_poly_fit(targets_local, samples_pdf, weights, terms)
    except ValueError:
        return None

    return {
        "type": "local_polynomial",
        "degree": degree,
        "terms": [[xp, yp] for xp, yp in terms],
        "pdfOrigin": [pdf_origin_x, pdf_origin_y],
        "pdfScale": pdf_scale,
        "originLon": origin_lon,
        "originLat": origin_lat,
        "geoScale": geo_scale,
        "forward": {"x": forward_x, "y": forward_y},
        "inverse": {"x": inverse_x, "y": inverse_y},
        "projection": {
            "type": "local_tangent_spherical",
            "earthRadiusM": EARTH_RADIUS_M,
        },
    }


def _apply_local_polynomial_model(model: Dict[str, Any], x: float, y: float) -> Tuple[float, float]:
    terms = [(int(a), int(b)) for a, b in model["terms"]]
    nx = (x - float(model["pdfOrigin"][0])) / float(model["pdfScale"])
    ny = (y - float(model["pdfOrigin"][1])) / float(model["pdfScale"])
    ux = _eval_coefficients(model["forward"]["x"], terms, nx, ny)
    uy = _eval_coefficients(model["forward"]["y"], terms, nx, ny)
    east = ux * float(model["geoScale"])
    north = uy * float(model["geoScale"])
    return lonlat_from_local_meters(
        east,
        north,
        float(model["originLon"]),
        float(model["originLat"]),
    )


def _local_polynomial_residual(model: Dict[str, Any], p: ControlPoint) -> float:
    lon, lat = _apply_local_polynomial_model(model, p.mupdf_x, p.mupdf_y)
    return great_circle_distance_m(lon, lat, p.lon, p.lat)


def _fit_high_accuracy_polynomial(
    controls: Sequence[ControlPoint],
    seed_inliers: Sequence[ControlPoint],
) -> Optional[Tuple[Dict[str, Any], List[ControlPoint], float, float]]:
    """Weighted robust local polynomial fit with inverse coefficients for the UI."""
    candidates = list(controls)
    seed = _unique_by_waypoint(seed_inliers)
    if len(seed) < MIN_GEOREF_CONTROL_POINTS:
        return None

    degrees = [1]
    if len(seed) >= 8:
        degrees.append(2)
    if len(seed) >= 14:
        degrees.append(3)

    best: Optional[Tuple[Dict[str, Any], List[ControlPoint], float, float]] = None
    best_score = math.inf

    for degree in degrees:
        terms = _poly_terms(degree)
        if len(seed) < len(terms):
            continue
        inliers = seed
        model: Optional[Dict[str, Any]] = None
        for _ in range(5):
            model = _build_local_polynomial_model(inliers, degree)
            if model is None:
                break
            residuals = {id(p): _local_polynomial_residual(model, p) for p in candidates}
            raw = [p for p in candidates if residuals[id(p)] <= MAX_HIGH_ACCURACY_RESIDUAL_METERS]
            next_inliers = _dedupe_by_lowest_residual(raw, residuals)
            if len(next_inliers) < max(MIN_GEOREF_CONTROL_POINTS, len(terms)):
                break
            if {id(p) for p in next_inliers} == {id(p) for p in inliers}:
                inliers = next_inliers
                break
            inliers = next_inliers

        if model is None or len(inliers) < max(MIN_GEOREF_CONTROL_POINTS, len(terms)):
            continue

        model = _build_local_polynomial_model(inliers, degree)
        if model is None:
            continue
        finals = [_local_polynomial_residual(model, p) for p in inliers]
        rmse = math.sqrt(sum(v * v for v in finals) / len(finals))
        max_error = max(finals)
        if rmse > MAX_HIGH_ACCURACY_RMSE_METERS or max_error > MAX_HIGH_ACCURACY_RESIDUAL_METERS:
            continue

        # Prefer lower error, but apply a small complexity penalty so a higher
        # order polynomial must earn its keep instead of merely overfitting.
        score = rmse * (1.0 + degree * 0.035) - len(inliers) * 0.5
        if best is None or score < best_score:
            best = (model, inliers, rmse, max_error)
            best_score = score

    if best is None:
        return None
    model, inliers, rmse, max_error = best
    model["rmseMeters"] = rmse
    model["maxErrorMeters"] = max_error
    model["inlierCount"] = len(inliers)
    model["controlPointCount"] = len(candidates)
    return model, inliers, rmse, max_error


def fit_page_georef(
    controls: Sequence[ControlPoint],
) -> Optional[GeorefFit]:
    if len(controls) < MIN_GEOREF_CONTROL_POINTS:
        return None
    transform, inliers = robust_reflected_similarity_fit(controls)

    def score(
        candidate_transform: Optional[Transform6],
        candidate_inliers: Sequence[ControlPoint],
    ) -> Optional[Tuple[Transform6, List[ControlPoint], float, float]]:
        if candidate_transform is None or len(candidate_inliers) < MIN_GEOREF_CONTROL_POINTS:
            return None
        residuals = [_transform_residual_geodesic(candidate_transform, p) for p in candidate_inliers]
        squared = sum(v * v for v in residuals)
        return (
            candidate_transform,
            list(candidate_inliers),
            math.sqrt(squared / len(candidate_inliers)),
            max(residuals),
        )

    best = score(transform, inliers)
    best_method = "reflected_similarity"

    def better_page_candidate(
        candidate: Tuple[Transform6, List[ControlPoint], float, float],
        current: Optional[Tuple[Transform6, List[ControlPoint], float, float]],
    ) -> bool:
        if current is None:
            return True
        candidate_ok = candidate[2] <= MAX_GEOREF_RMSE_METERS
        current_ok = current[2] <= MAX_GEOREF_RMSE_METERS
        if candidate_ok != current_ok:
            return candidate_ok
        if candidate_ok:
            if candidate[2] < current[2] * 0.95:
                return True
            return len(candidate[1]) > len(current[1]) and candidate[2] <= current[2] * 1.10
        return candidate[2] < current[2]

    # Also try affine even when similarity is "acceptable".  Terminal charts are
    # often projected rather than purely scaled/rotated, and a correct extra
    # control near a holding pattern can expose the small anisotropy.  Require at
    # least four affine inliers so a sparse 3-point page cannot be accepted just
    # because affine can exactly pass through any three non-collinear points.
    if len(_unique_by_waypoint(controls)) >= 4:
        affine_transform, affine_inliers = robust_affine_fit(controls)
        affine_best = score(affine_transform, affine_inliers)
        if (
            affine_best is not None
            and len(affine_best[1]) >= 4
            and better_page_candidate(affine_best, best)
        ):
            best = affine_best
            best_method = "affine"

    if best is None or best[2] > MAX_GEOREF_RMSE_METERS:
        return None

    transform, inliers, rmse, max_error = best
    method = best_method
    high_accuracy = _fit_high_accuracy_polynomial(controls, inliers)
    high_accuracy_transform: Optional[Dict[str, Any]] = None
    if high_accuracy is not None:
        high_accuracy_transform, inliers, rmse, max_error = high_accuracy
        method = f"local_polynomial_{high_accuracy_transform['degree']}"
    inlier_ids = {id(p) for p in inliers}
    for p in controls:
        if high_accuracy_transform is not None:
            p.georef_residual_meters = _local_polynomial_residual(high_accuracy_transform, p)
        else:
            p.georef_residual_meters = _transform_residual_geodesic(transform, p)
        p.used_for_georef = id(p) in inlier_ids
    return GeorefFit(
        transform=transform,
        rmse_meters=rmse,
        max_error_meters=max_error,
        inliers=list(inliers),
        method=method,
        high_accuracy_transform=high_accuracy_transform,
    )


def fit_page_transform(
    controls: Sequence[ControlPoint],
) -> Tuple[Optional[Transform6], Optional[float]]:
    fit = fit_page_georef(controls)
    if fit is None:
        return None, None
    return fit.transform, fit.rmse_meters


# ---------------------------------------------------------------------------
# Vector overlay extraction
# ---------------------------------------------------------------------------

def _clamp(value: float, min_value: float, max_value: float) -> float:
    return min(max(value, min_value), max_value)


def _cross(o: Point, a: Point, b: Point) -> float:
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def _convex_hull(points: Sequence[Point]) -> List[Point]:
    sorted_points = sorted(set(points))
    if len(sorted_points) <= 1:
        return list(sorted_points)

    lower: List[Point] = []
    for point in sorted_points:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: List[Point] = []
    for point in reversed(sorted_points):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return lower[:-1] + upper[:-1]


def _expand_polygon(
    polygon: Sequence[Point],
    page_width: float,
    page_height: float,
    margin: float,
) -> List[Point]:
    center_x = sum(p[0] for p in polygon) / len(polygon)
    center_y = sum(p[1] for p in polygon) / len(polygon)
    expanded: List[Point] = []
    for x, y in polygon:
        dx = x - center_x
        dy = y - center_y
        length = math.hypot(dx, dy) or 1.0
        expanded.append((
            _clamp(x + (dx / length) * margin, 0.0, page_width),
            _clamp(y + (dy / length) * margin, 0.0, page_height),
        ))
    return expanded


def _point_in_polygon(point: Point, polygon: Sequence[Point]) -> bool:
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i, (xi, yi) in enumerate(polygon):
        xj, yj = polygon[j]
        crosses = (yi > y) != (yj > y)
        if crosses:
            x_at_y = ((xj - xi) * (y - yi) / ((yj - yi) or 1e-12)) + xi
            if x < x_at_y:
                inside = not inside
        j = i
    return inside


def _used_control_polygon(
    controls: Sequence[ControlPoint],
    page_width: float,
    page_height: float,
) -> Optional[List[Point]]:
    used = [(p.mupdf_x, p.mupdf_y) for p in controls if p.used_for_georef]
    if len(used) < MIN_GEOREF_CONTROL_POINTS:
        return None

    hull = _convex_hull(used)
    if len(hull) < 3:
        return None

    xs = [p[0] for p in used]
    ys = [p[1] for p in used]
    span_x = max(max(xs) - min(xs), 1.0)
    span_y = max(max(ys) - min(ys), 1.0)
    # Route strokes and arrow shafts are often offset well away from the
    # waypoint label/symbol centers used as controls.  Use a generous plan-view
    # hull so we keep the actual procedure geometry without falling back to the
    # full document plate.
    margin = _clamp(min(span_x, span_y) * 0.40, 55.0, 130.0)
    return _expand_polygon(hull, page_width, page_height, margin)


def _bounds(points: Sequence[Point]) -> Tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def _polygon_area(points: Sequence[Point]) -> float:
    area = 0.0
    for i, (x1, y1) in enumerate(points):
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _cubic_bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: float) -> Point:
    inv = 1.0 - t
    x = (
        inv ** 3 * p0[0]
        + 3.0 * inv ** 2 * t * p1[0]
        + 3.0 * inv * t ** 2 * p2[0]
        + t ** 3 * p3[0]
    )
    y = (
        inv ** 3 * p0[1]
        + 3.0 * inv ** 2 * t * p1[1]
        + 3.0 * inv * t ** 2 * p2[1]
        + t ** 3 * p3[1]
    )
    return x, y


def _append_point(points: List[Point], point: Point) -> None:
    if not points or math.hypot(points[-1][0] - point[0], points[-1][1] - point[1]) > 0.35:
        points.append(point)


def _append_segment_points(points: List[Point], start: Point, end: Point, max_step: float = 18.0) -> None:
    _append_point(points, start)
    distance = math.hypot(end[0] - start[0], end[1] - start[1])
    steps = max(1, math.ceil(distance / max_step))
    for step in range(1, steps + 1):
        fraction = step / steps
        _append_point(points, (
            start[0] + (end[0] - start[0]) * fraction,
            start[1] + (end[1] - start[1]) * fraction,
        ))


def _drawing_to_points(drawing: Dict[str, Any]) -> List[Point]:
    points: List[Point] = []
    current: Optional[Point] = None
    for item in drawing.get("items", []):
        if not item:
            continue
        operator = item[0]
        if operator == "l" and len(item) >= 3:
            p0 = (float(item[1].x), float(item[1].y))
            p1 = (float(item[2].x), float(item[2].y))
            _append_segment_points(points, p0, p1)
            current = p1
        elif operator == "c" and len(item) >= 4:
            # PyMuPDF has used both current-point-implied and explicit-start
            # curve tuples across releases.  Prefer the current point when it is
            # available; otherwise treat the first tuple point as the start.
            if len(item) >= 5:
                p0 = current if current is not None else (float(item[1].x), float(item[1].y))
                control_offset = 1 if current is not None else 2
                p1 = (float(item[control_offset].x), float(item[control_offset].y))
                p2 = (float(item[control_offset + 1].x), float(item[control_offset + 1].y))
                p3 = (float(item[control_offset + 2].x), float(item[control_offset + 2].y))
            else:
                p0 = current if current is not None else (float(item[1].x), float(item[1].y))
                p1 = (float(item[1].x), float(item[1].y))
                p2 = (float(item[2].x), float(item[2].y))
                p3 = (float(item[3].x), float(item[3].y))
            _append_point(points, p0)
            for step in range(1, 17):
                _append_point(points, _cubic_bezier(p0, p1, p2, p3, step / 16.0))
            current = p3
        elif operator == "re" and len(item) >= 2:
            rect = item[1]
            rect_points = [
                (float(rect.x0), float(rect.y0)),
                (float(rect.x1), float(rect.y0)),
                (float(rect.x1), float(rect.y1)),
                (float(rect.x0), float(rect.y1)),
                (float(rect.x0), float(rect.y0)),
            ]
            for index in range(1, len(rect_points)):
                _append_segment_points(points, rect_points[index - 1], rect_points[index])
            current = rect_points[-1]
        elif operator == "m" and len(item) >= 2:
            current = (float(item[1].x), float(item[1].y))
            _append_point(points, current)
        elif operator == "h" and current is not None:
            _append_point(points, points[0] if points else current)
    return points


def _downsample_points(points: Sequence[Point], max_points: int) -> List[Point]:
    if len(points) <= max_points:
        return list(points)
    sampled: List[Point] = []
    for index in range(max_points):
        source_index = round(index * (len(points) - 1) / (max_points - 1))
        sampled.append(points[source_index])
    return sampled


def _is_dark_stroke(stroke: Optional[Sequence[float]]) -> bool:
    if stroke is None:
        return True
    if len(stroke) < 3:
        return True
    return sum(float(c) for c in stroke[:3]) / 3.0 < 0.72


def _is_table_like_rect(points: Sequence[Point], page_width: float, page_height: float) -> bool:
    if len(points) < 4:
        return False
    min_x, min_y, max_x, max_y = _bounds(points)
    width = max_x - min_x
    height = max_y - min_y
    if len(points) <= 5 and width > 35.0 and height > 12.0:
        area = _polygon_area(points)
        return area > 0.8 * width * height
    return False


def extract_vector_overlay_paths(
    page: fitz.Page,
    controls: Sequence[ControlPoint],
) -> List[VectorOverlayPath]:
    """Extract georeferenceable procedure strokes from the PDF plan-view area.

    This deliberately excludes text and filled waypoint symbols.  The UI draws
    labels and fix/navaid symbols from the validated control points instead.
    """
    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    polygon = _used_control_polygon(controls, page_width, page_height)
    if polygon is None:
        return []

    paths: List[VectorOverlayPath] = []
    for drawing in page.get_drawings():
        stroke = drawing.get("color")
        fill = drawing.get("fill")
        line_width = float(drawing.get("width") or 1.0)
        if fill is not None and stroke is None:
            continue
        if not _is_dark_stroke(stroke):
            continue

        points = _drawing_to_points(drawing)
        if len(points) < 2:
            continue
        length = sum(
            math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
            for i in range(1, len(points))
        )
        if length < 30.0:
            continue
        min_x, min_y, max_x, max_y = _bounds(points)
        if length > 80.0 and (
            (max_x - min_x <= 1.0 and (min_x <= 25.0 or max_x >= page_width - 25.0))
            or (max_y - min_y <= 1.0 and (min_y <= 55.0 or max_y >= page_height - 25.0))
        ):
            continue
        if _is_table_like_rect(points, page_width, page_height):
            continue

        containment_samples = list(points)
        for index in range(1, len(points)):
            x0, y0 = points[index - 1]
            x1, y1 = points[index]
            for fraction in (0.25, 0.5, 0.75):
                containment_samples.append((
                    x0 + (x1 - x0) * fraction,
                    y0 + (y1 - y0) * fraction,
                ))

        inside_count = sum(
            1 for point in containment_samples if _point_in_polygon(point, polygon)
        )
        if inside_count == 0:
            continue

        paths.append(VectorOverlayPath(
            points_mupdf=_downsample_points(points, MAX_VECTOR_OVERLAY_POINTS),
            line_width=line_width,
            stroke=tuple(float(c) for c in stroke[:3]) if stroke and len(stroke) >= 3 else None,
        ))
        if len(paths) >= MAX_VECTOR_OVERLAY_PATHS:
            break
    return paths


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
    text_boxes = [
        (float(x0), float(y0), float(x1), float(y1))
        for x0, y0, x1, y1, *_ in page.get_text("words")
    ]

    for idx, drawing in enumerate(page.get_drawings()):
        rect = drawing.get("rect")
        if rect is None:
            continue
        w, h = float(rect.width), float(rect.height)
        x0, y0 = float(rect.x0), float(rect.y0)

        # Exclude footer and header bands (text/legend areas).
        # The NAIP chart title box always occupies the top ~51pt; raising the cutoff
        # from 20 to 55 eliminates rendered-text vector paths in the header that the
        # diamond/triangle detectors would otherwise mistake for geographic waypoints.
        if y0 > ph - 50 or y0 < 55:
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
            # Text glyph outlines and underlines can have the same tiny closed
            # polygon shapes as fix symbols.  If the candidate center lies inside
            # an extracted word box, it is text, not a geographic waypoint marker.
            if any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in text_boxes):
                continue
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

    Lookup priority: terminal_locations (waypoint PDF) → designated (DESIGNATED_POINT.csv).
    VOR/NDB/navaid IDs are intentionally not matched here: terminal charts contain
    small vector text boxes and ATC tags that can look like fix diamonds, and a
    false generic match would block the precise navaid-symbol detector later.

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
        if text in IGNORED_FIX_LABELS or text in existing_names or not _FIX_WORD_RE.fullmatch(text):
            continue
        if re.fullmatch(r"[A-Z]{3}", text) and text in navaid_locations:
            continue
        location = combined.get(text)
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
                lon=location.lon,
                lat=location.lat,
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
    """Match complex radio navaid glyphs (navaid_symbol) to VOR.csv/NDB.csv entries."""
    symbols = [s for s in extract_terminal_symbols(page) if s.source == "navaid_symbol"]
    if not symbols:
        return []

    labels = []
    for word in page.get_text("words"):
        x0, y0, x1, y1, text = word[:5]
        text = str(text).strip().upper()
        if text in IGNORED_FIX_LABELS or text in existing_names or not re.fullmatch(r"[A-Z]{2,3}", text):
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
                lon=location.lon,
                lat=location.lat,
                mercator_x=mx,
                mercator_y=my,
            )
        )
    return controls


def extract_waypoint_symbol_controls(
    page: fitz.Page,
    terminal_locations: Dict[str, RealPoint],
    navaid_locations: Dict[str, RealPoint],
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
        if text in IGNORED_FIX_LABELS or text in existing_names or not _FIX_WORD_RE.fullmatch(text):
            continue
        if re.fullmatch(r"[A-Z]{2,3}", text) and text in navaid_locations:
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
                lon=location.lon,
                lat=location.lat,
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
    waypoint_pdfs: Optional[Sequence[Path]] = None,
    page_number: Optional[int] = None,
) -> List[dict]:
    designated = load_designated_points(csv_dir)
    navaid = load_navaid_points(csv_dir)

    # Terminal waypoints come from the airport's 航路点坐标 (waypoint coordinate) PDFs.
    # Large airports split the table across multiple pages; each is passed via --waypoint-pdf.
    terminal_locations: Dict[str, RealPoint] = {}
    for waypoint_pdf in (waypoint_pdfs or []):
        if waypoint_pdf.is_file():
            terminal_locations.update(_extract_waypoints_from_pdf(waypoint_pdf))

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

            # Phase 1: larger terminal waypoint glyphs from the waypoint table PDF.
            # Run this before the generic triangle/diamond detector: text glyphs can
            # look like small filled polygons, and a false generic match would block
            # the correct terminal symbol for the same waypoint name.
            controls = extract_waypoint_symbol_controls(page, terminal_locations, navaid, set())
            existing = {p.waypoint for p in controls}

            # Phase 2: all remaining fix symbols (triangles, diamonds) matched
            # against all coordinate sources.
            extra = extract_all_fix_controls(page, designated, terminal_locations, navaid, existing)
            controls.extend(extra)
            existing.update(p.waypoint for p in extra)

            # Phase 3: VOR/DME station glyphs
            extra = extract_navaid_controls(page, navaid, existing)
            controls.extend(extra)

            fit = fit_page_georef(controls)
            transform = fit.transform if fit is not None else None
            rmse = fit.rmse_meters if fit is not None else None
            vector_paths = extract_vector_overlay_paths(page, controls) if fit is not None else []

            results.append({
                "page": page_index,
                "georeferenced": transform is not None,
                "transform": list(transform) if transform is not None else None,
                "transform_type": fit.method if fit is not None else None,
                "high_accuracy_transform": fit.high_accuracy_transform if fit is not None else None,
                "page_width": page_width,
                "page_height": page_height,
                "rmse_meters": rmse,
                "max_error_meters": fit.max_error_meters if fit is not None else None,
                "inlier_count": len(fit.inliers) if fit is not None else 0,
                "control_point_count": len(controls),
                "control_points": [
                    {
                        "waypoint": p.waypoint,
                        "source": p.source,
                        "mupdfX": p.mupdf_x,
                        "mupdfY": p.mupdf_y,
                        "lon": p.lon,
                        "lat": p.lat,
                        "used": p.used_for_georef,
                        "residualMeters": p.georef_residual_meters,
                    }
                    for p in sorted(
                        controls,
                        key=lambda p: (
                            not p.used_for_georef,
                            p.georef_residual_meters is None,
                            p.georef_residual_meters or math.inf,
                        ),
                    )
                ],
                "vector_paths": [
                    {
                        "points": [[x, y] for x, y in path.points_mupdf],
                        "lineWidth": path.line_width,
                        "stroke": list(path.stroke) if path.stroke is not None else None,
                    }
                    for path in vector_paths
                ],
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
        action="append",
        default=[],
        help="Path to an airport 航路点坐标 PDF (may be repeated for multi-page tables)",
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
        results = process_pdf(args.pdf, args.csv_dir, args.waypoint_pdf or None, args.page)
        print(json.dumps(results, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
