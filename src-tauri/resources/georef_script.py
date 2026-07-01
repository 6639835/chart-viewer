#!/usr/bin/env python3
from __future__ import annotations

import argparse
import itertools
import json
import math
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

import fitz
import numpy as np

try:
    from pyproj import Geod
except Exception:
    Geod = None  # type: ignore[assignment]

RESOURCE_DIR = Path(__file__).resolve().parent
if str(RESOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(RESOURCE_DIR))

from pdf_symbol_matcher.matcher import load_templates, match_pdf  # noqa: E402
from pdf_symbol_matcher.naip import (  # noqa: E402
    NaipCoordinateIndex,
    build_ground_control_points,
    infer_airport_icao,
    parse_waypoint_coordinate_pdf,
)

EARTH_RADIUS_M = 6_378_137.0
MAX_FIT_RMSE_METERS = 500.0
MAX_INLIER_RESIDUAL_METERS = 700.0
MIN_CONTROL_POINTS = 3
GEOD = Geod(ellps="WGS84") if Geod is not None else None


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
    used: bool = False
    residual_meters: Optional[float] = None


@dataclass
class FitResult:
    transform: tuple[float, float, float, float, float, float]
    rmse_meters: float
    max_error_meters: float
    inliers: list[ControlPoint]


class ExplicitWaypointCoordinateIndex(NaipCoordinateIndex):
    def __init__(
        self,
        csv_dir: Path,
        waypoint_pdfs: Sequence[Path],
        charts_dir: Optional[Path] = None,
    ) -> None:
        super().__init__(
            naip_root=csv_dir.parent,
            csv_dir=csv_dir,
            charts_dir=charts_dir or csv_dir.parent / "charts",
        )
        self._explicit_waypoint_pdfs = [p for p in waypoint_pdfs if p.is_file()]

    def chart_points_for_airport(self, airport_icao: str):
        points = dict(super().chart_points_for_airport(airport_icao))
        for waypoint_pdf in self._explicit_waypoint_pdfs:
            for coord in parse_waypoint_coordinate_pdf(waypoint_pdf):
                points.setdefault(coord.identifier, coord)
        return points


def lonlat_to_mercator(lon: float, lat: float) -> tuple[float, float]:
    clamped_lat = max(min(lat, 89.5), -89.5)
    x = EARTH_RADIUS_M * math.radians(lon)
    y = EARTH_RADIUS_M * math.log(math.tan(math.pi / 4.0 + math.radians(clamped_lat) / 2.0))
    return x, y


def mercator_to_lonlat(x: float, y: float) -> tuple[float, float]:
    lon = math.degrees(x / EARTH_RADIUS_M)
    lat = math.degrees(2.0 * math.atan(math.exp(y / EARTH_RADIUS_M)) - math.pi / 2.0)
    return lon, lat


def great_circle_distance_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
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


def apply_transform(
    transform: tuple[float, float, float, float, float, float],
    x: float,
    y: float,
) -> tuple[float, float]:
    a, b, c, d, e, f = transform
    return a * x + c * y + e, b * x + d * y + f


def fit_affine(points: Sequence[ControlPoint]) -> tuple[float, float, float, float, float, float]:
    matrix = np.asarray([[p.mupdf_x, p.mupdf_y, 1.0] for p in points], dtype=np.float64)
    target_x = np.asarray([p.mercator_x for p in points], dtype=np.float64)
    target_y = np.asarray([p.mercator_y for p in points], dtype=np.float64)
    coeff_x, *_ = np.linalg.lstsq(matrix, target_x, rcond=None)
    coeff_y, *_ = np.linalg.lstsq(matrix, target_y, rcond=None)
    return (
        float(coeff_x[0]),
        float(coeff_y[0]),
        float(coeff_x[1]),
        float(coeff_y[1]),
        float(coeff_x[2]),
        float(coeff_y[2]),
    )


def residual_meters(
    transform: tuple[float, float, float, float, float, float],
    point: ControlPoint,
) -> float:
    mx, my = apply_transform(transform, point.mupdf_x, point.mupdf_y)
    lon, lat = mercator_to_lonlat(mx, my)
    return great_circle_distance_m(lon, lat, point.lon, point.lat)


def scored_fit(points: Sequence[ControlPoint]) -> Optional[FitResult]:
    if len(points) < MIN_CONTROL_POINTS:
        return None

    transform = fit_affine(points)
    residuals = [residual_meters(transform, p) for p in points]
    if not residuals:
        return None

    rmse = math.sqrt(sum(r * r for r in residuals) / len(residuals))
    for point, residual in zip(points, residuals):
        point.residual_meters = residual
        point.used = True

    return FitResult(
        transform=transform,
        rmse_meters=rmse,
        max_error_meters=max(residuals),
        inliers=list(points),
    )


def robust_fit(points: Sequence[ControlPoint]) -> Optional[FitResult]:
    if len(points) < MIN_CONTROL_POINTS:
        return None

    best: Optional[FitResult] = None
    point_list = list(points)
    combinations = itertools.combinations(point_list, MIN_CONTROL_POINTS)
    for sample_index, sample in enumerate(combinations):
        if sample_index >= 500:
            break
        try:
            transform = fit_affine(sample)
        except Exception:
            continue

        inliers = [p for p in point_list if residual_meters(transform, p) <= MAX_INLIER_RESIDUAL_METERS]
        if len(inliers) < MIN_CONTROL_POINTS:
            continue

        try:
            candidate = scored_fit([ControlPoint(**vars(p)) for p in inliers])
        except Exception:
            continue
        if candidate is None or candidate.rmse_meters > MAX_FIT_RMSE_METERS:
            continue
        if best is None:
            best = candidate
            continue
        if len(candidate.inliers) > len(best.inliers):
            best = candidate
        elif len(candidate.inliers) == len(best.inliers) and candidate.rmse_meters < best.rmse_meters:
            best = candidate

    if best is None:
        try:
            best = scored_fit([ControlPoint(**vars(p)) for p in point_list])
        except Exception:
            return None
        if best is None or best.rmse_meters > MAX_FIT_RMSE_METERS:
            return None

    used_keys = {(p.waypoint, round(p.mupdf_x, 3), round(p.mupdf_y, 3)) for p in best.inliers}
    for point in point_list:
        point.used = (point.waypoint, round(point.mupdf_x, 3), round(point.mupdf_y, 3)) in used_keys
        point.residual_meters = residual_meters(best.transform, point)

    best.inliers = [p for p in point_list if p.used]
    best.rmse_meters = math.sqrt(
        sum((p.residual_meters or 0.0) ** 2 for p in best.inliers) / len(best.inliers)
    )
    best.max_error_meters = max((p.residual_meters or 0.0) for p in best.inliers)
    return best


def controls_from_matches(matches: Sequence[dict]) -> list[ControlPoint]:
    controls: list[ControlPoint] = []
    seen: set[tuple[str, int, int, int]] = set()

    for match in matches:
        world = match.get("world_coordinate") or {}
        center = match.get("center_mupdf") or []
        identifier = str(match.get("point_identifier") or "").strip().upper()
        if not identifier or len(center) < 2:
            continue

        try:
            lat = float(world["latitude"])
            lon = float(world["longitude"])
            mupdf_x = float(center[0])
            mupdf_y = float(center[1])
        except Exception:
            continue

        key = (identifier, int(match.get("page") or 0), round(mupdf_x), round(mupdf_y))
        if key in seen:
            continue
        seen.add(key)
        mx, my = lonlat_to_mercator(lon, lat)
        controls.append(
            ControlPoint(
                waypoint=identifier,
                source=str(world.get("source") or match.get("template_id") or "symbol_match"),
                mupdf_x=mupdf_x,
                mupdf_y=mupdf_y,
                lon=lon,
                lat=lat,
                mercator_x=mx,
                mercator_y=my,
            )
        )

    return controls


def page_results_from_matches(
    pdf_path: Path,
    matches: Sequence[dict],
    requested_page: Optional[int],
) -> list[dict]:
    results: list[dict] = []
    with fitz.open(pdf_path) as doc:
        page_numbers = [requested_page] if requested_page is not None else list(range(1, len(doc) + 1))
        for page_number in page_numbers:
            if page_number is None or page_number < 1 or page_number > len(doc):
                raise ValueError(f"page {page_number} is outside PDF page range 1-{len(doc)}")

            page = doc.load_page(page_number - 1)
            page_controls = controls_from_matches([m for m in matches if int(m.get("page") or 0) == page_number])
            fit = robust_fit(page_controls)
            transform = fit.transform if fit else None

            results.append(
                {
                    "page": page_number,
                    "georeferenced": transform is not None,
                    "transform": list(transform) if transform else None,
                    "transform_type": "reference_symbol_affine" if transform else None,
                    "high_accuracy_transform": None,
                    "page_width": float(page.rect.width),
                    "page_height": float(page.rect.height),
                    "rmse_meters": fit.rmse_meters if fit else None,
                    "max_error_meters": fit.max_error_meters if fit else None,
                    "inlier_count": len(fit.inliers) if fit else 0,
                    "control_point_count": len(page_controls),
                    "control_points": [
                        {
                            "waypoint": p.waypoint,
                            "source": p.source,
                            "mupdfX": p.mupdf_x,
                            "mupdfY": p.mupdf_y,
                            "lon": p.lon,
                            "lat": p.lat,
                            "used": p.used,
                            "residualMeters": p.residual_meters,
                        }
                        for p in sorted(
                            page_controls,
                            key=lambda p: (
                                not p.used,
                                p.residual_meters is None,
                                p.residual_meters or math.inf,
                            ),
                        )
                    ],
                    "vector_paths": [],
                }
            )

    return results


def process_pdf(
    pdf_path: Path,
    csv_dir: Path,
    waypoint_pdfs: Sequence[Path],
    page_number: Optional[int],
    *,
    templates: Optional[list[dict]] = None,
    designated_cache: Optional[dict[str, dict]] = None,
) -> list[dict]:
    airport = (infer_airport_icao(pdf_path) or "").upper() or None
    library_dir = RESOURCE_DIR / "symbol_library"
    if not library_dir.is_dir():
        raise FileNotFoundError(f"symbol library not found: {library_dir}")

    with tempfile.TemporaryDirectory(prefix="chart_georef_") as tmp:
        result = match_pdf(
            pdf_path=pdf_path,
            library_dir=library_dir,
            out_dir=Path(tmp),
            threshold=0.80,
            debug=False,
            naip_root=None,
            airport_icao=airport,
            page_number=page_number,
            templates=templates,
        )

        coordinate_index = ExplicitWaypointCoordinateIndex(csv_dir=csv_dir, waypoint_pdfs=waypoint_pdfs)
        # The DESIGNATED_POINT.csv parse is identical for every job sharing a
        # csv_dir, so reuse it across a batch instead of re-reading per chart.
        if designated_cache is not None:
            cache_key = str(csv_dir)
            cached = designated_cache.get(cache_key)
            if cached is None:
                designated_cache[cache_key] = coordinate_index.designated_points()
            else:
                coordinate_index._designated_points = cached
        matches = result.get("matches") or []
        build_ground_control_points(
            matches,
            coordinate_index,
            airport,
            result.get("page_reports") or [],
        )
        return page_results_from_matches(pdf_path, matches, page_number)


def process_batch(batch_path: Path) -> list[dict]:
    """Process many PDFs in one interpreter, amortizing process startup,
    symbol-template loading, and the DESIGNATED_POINT.csv parse across jobs."""
    data = json.loads(Path(batch_path).read_text(encoding="utf-8"))
    csv_dir = Path(data["csv_dir"])
    jobs = data.get("jobs") or []

    library_dir = RESOURCE_DIR / "symbol_library"
    if not library_dir.is_dir():
        raise FileNotFoundError(f"symbol library not found: {library_dir}")
    templates = load_templates(library_dir)
    designated_cache: dict[str, dict] = {}

    results: list[dict] = []
    for job in jobs:
        job_id = job.get("id")
        try:
            pdf_path = Path(job["pdf"])
            waypoint_pdfs = [Path(p) for p in (job.get("waypoint_pdfs") or [])]
            page_number = job.get("page")
            pages = process_pdf(
                pdf_path,
                csv_dir,
                waypoint_pdfs,
                page_number,
                templates=templates,
                designated_cache=designated_cache,
            )
            results.append({"id": job_id, "ok": True, "pages": pages})
        except Exception as exc:  # noqa: BLE001 - report per-job, keep batch alive
            results.append({"id": job_id, "ok": False, "error": str(exc)})
    return results


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Georeference aviation chart PDFs using the bundled symbol matcher.")
    parser.add_argument("--pdf", type=Path, default=None)
    parser.add_argument("--csv-dir", type=Path, default=None)
    parser.add_argument("--waypoint-pdf", type=Path, action="append", default=[])
    parser.add_argument("--page", type=int, default=None)
    parser.add_argument(
        "--batch",
        type=Path,
        default=None,
        help="JSON manifest of many jobs to process in one interpreter.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    if args.batch is not None:
        results = process_batch(args.batch)
        print(json.dumps({"results": results}, ensure_ascii=False, separators=(",", ":")))
        return 0

    if args.pdf is None or args.csv_dir is None:
        raise SystemExit("error: --pdf and --csv-dir are required unless --batch is given")
    results = process_pdf(args.pdf, args.csv_dir, args.waypoint_pdf, args.page)
    print(json.dumps(results, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
