from __future__ import annotations

import csv
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence

import fitz


DEFAULT_NAIP_ROOT = Path("/Users/lujuncheng/Downloads/NAIP+")
WAYPOINT_COORDINATE_CHART_NAME = "\u822a\u8def\u70b9\u5750\u6807"
CSV_ENCODINGS = ("utf-8-sig", "gb18030", "gbk")
ROLE_LABELS = {"IAF", "IF", "FAF", "FAP", "MAPT", "MAHF", "ARP"}
POINT_ID_RE = re.compile(
    r"^(?:[A-Z]{5}|(?=[A-Z0-9]{4,6}$)(?=.*[A-Z])(?=.*\d)[A-Z0-9]+|RWY?\d{2}[LCR]?)$"
)
LAT_RE = re.compile(r"([NS])\s*(\d{2})\D*(\d{2})\D*(\d{2}(?:\.\d+)?)", re.IGNORECASE)
LON_RE = re.compile(r"([EW])\s*(\d{3})\D*(\d{2})\D*(\d{2}(?:\.\d+)?)", re.IGNORECASE)


@dataclass(frozen=True)
class Coordinate:
    identifier: str
    latitude: float
    longitude: float
    raw_latitude: str
    raw_longitude: str
    source: str
    source_path: str


@dataclass(frozen=True)
class GroundControlPoint:
    identifier: str
    page: int
    pixel: float
    line: float
    pdf_x: float
    pdf_y: float
    longitude: float
    latitude: float
    coordinate_source: str
    coordinate_source_path: str
    match_confidence: float


def _clean_identifier(text: object) -> str:
    return str(text or "").strip().replace(" ", "").strip(".,;:()[]{}").upper()


def _open_csv(path: Path):
    last_error: UnicodeDecodeError | None = None
    for encoding in CSV_ENCODINGS:
        try:
            f = path.open("r", encoding=encoding, newline="")
            f.read(2048)
            f.seek(0)
            return f
        except UnicodeDecodeError as exc:
            last_error = exc
    if last_error:
        raise last_error
    return path.open("r", encoding="utf-8", newline="")


def _coord_value(hemisphere: str, degrees: str, minutes: str, seconds: str) -> float:
    value = float(degrees) + float(minutes) / 60.0 + float(seconds) / 3600.0
    if hemisphere.upper() in {"S", "W"}:
        value = -value
    return value


def parse_coordinate_pair(text: str) -> tuple[float, float] | None:
    """Parse NAIP DMS coordinates and return ``(latitude, longitude)`` decimals."""
    normalized = (
        str(text or "")
        .replace("\u00a1\u00e3", "\u00b0")
        .replace("\u2032", "'")
        .replace("\u2019", "'")
        .replace("\u2033", '"')
        .replace("\u201d", '"')
    )
    lat = LAT_RE.search(normalized)
    lon = LON_RE.search(normalized)
    if not lat or not lon:
        return None
    latitude = _coord_value(lat.group(1), lat.group(2), lat.group(3), lat.group(4))
    longitude = _coord_value(lon.group(1), lon.group(2), lon.group(3), lon.group(4))
    return latitude, longitude


def infer_airport_icao(pdf_path: str | Path) -> str | None:
    match = re.match(r"^([A-Z]{4})(?:[-_].*)?$", Path(pdf_path).stem.upper())
    if match:
        return match.group(1)
    return None


def identifier_candidates_for_match(match: dict) -> list[str]:
    candidates: list[str] = []
    label = match.get("nearest_label") or {}
    for value in (match.get("point_identifier"), label.get("text"), label.get("context_text")):
        for token in re.split(r"[^A-Za-z0-9]+", str(value or "")):
            ident = _clean_identifier(token)
            if not ident or ident in ROLE_LABELS or not POINT_ID_RE.match(ident):
                continue
            if ident not in candidates:
                candidates.append(ident)
    return candidates


class NaipCoordinateIndex:
    def __init__(
        self,
        naip_root: str | Path = DEFAULT_NAIP_ROOT,
        csv_dir: str | Path | None = None,
        charts_dir: str | Path | None = None,
    ) -> None:
        self.naip_root = Path(naip_root)
        self.csv_dir = Path(csv_dir) if csv_dir else self.naip_root / "CSV"
        self.charts_dir = Path(charts_dir) if charts_dir else self.naip_root / "charts"
        self._designated_points: dict[str, Coordinate] | None = None
        self._chart_points_by_airport: dict[str, dict[str, Coordinate]] = {}

    def find(self, identifier: str, airport_icao: str | None = None) -> Coordinate | None:
        ident = _clean_identifier(identifier)
        if not ident:
            return None

        designated = self.designated_points()
        if ident in designated:
            return designated[ident]

        if airport_icao:
            chart_points = self.chart_points_for_airport(airport_icao)
            if ident in chart_points:
                return chart_points[ident]
        return None

    def designated_points(self) -> dict[str, Coordinate]:
        if self._designated_points is not None:
            return self._designated_points

        path = self.csv_dir / "DESIGNATED_POINT.csv"
        points: dict[str, Coordinate] = {}
        if not path.exists():
            self._designated_points = points
            return points

        with _open_csv(path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                ident = _clean_identifier(row.get("CODE_ID") or row.get("TXT_NAME"))
                lat_raw = str(row.get("GEO_LAT_ACCURACY") or "").strip()
                lon_raw = str(row.get("GEO_LONG_ACCURACY") or "").strip()
                parsed = parse_coordinate_pair(f"{lat_raw} {lon_raw}")
                if ident and parsed and ident not in points:
                    points[ident] = Coordinate(
                        identifier=ident,
                        latitude=parsed[0],
                        longitude=parsed[1],
                        raw_latitude=lat_raw,
                        raw_longitude=lon_raw,
                        source="DESIGNATED_POINT.csv",
                        source_path=str(path),
                    )

        self._designated_points = points
        return points

    def chart_points_for_airport(self, airport_icao: str) -> dict[str, Coordinate]:
        airport = _clean_identifier(airport_icao)
        if airport in self._chart_points_by_airport:
            return self._chart_points_by_airport[airport]

        points: dict[str, Coordinate] = {}
        for chart_pdf in self.coordinate_chart_pdfs(airport):
            for coord in parse_waypoint_coordinate_pdf(chart_pdf):
                points.setdefault(coord.identifier, coord)
        self._chart_points_by_airport[airport] = points
        return points

    def coordinate_chart_pdfs(self, airport_icao: str) -> list[Path]:
        charts_csv = self.csv_dir / "Charts.csv"
        airport = _clean_identifier(airport_icao)
        if not charts_csv.exists() or not airport:
            return []

        pdfs: list[Path] = []
        with _open_csv(charts_csv) as f:
            reader = csv.DictReader(f)
            for row in reader:
                if _clean_identifier(row.get("AirportIcao")) != airport:
                    continue
                chart_name = str(row.get("ChartName") or "")
                chart_type = str(row.get("ChartTypeEx_CH") or "")
                if WAYPOINT_COORDINATE_CHART_NAME not in chart_name and WAYPOINT_COORDINATE_CHART_NAME not in chart_type:
                    continue
                for candidate in self._chart_path_candidates(airport, row):
                    if candidate.exists() and candidate not in pdfs:
                        pdfs.append(candidate)
                        break
        return pdfs

    def _chart_path_candidates(self, airport: str, row: dict) -> list[Path]:
        page = str(row.get("PAGE_NUMBER") or "").strip()
        file_path = str(row.get("FilePath") or "").strip()
        candidates: list[Path] = []
        if page:
            candidates.append(self.charts_dir / airport / f"{airport}-{page}.pdf")
        if file_path:
            stem = Path(file_path).name
            candidates.extend(
                [
                    self.charts_dir / airport / f"{stem}.pdf",
                    self.charts_dir / f"{file_path}.pdf",
                    self.naip_root / f"{file_path}.pdf",
                ]
            )
        return candidates


def parse_waypoint_coordinate_pdf(pdf_path: str | Path, row_tolerance: float = 4.0) -> list[Coordinate]:
    pdf_path = Path(pdf_path)
    doc = fitz.open(pdf_path)
    coordinates: list[Coordinate] = []
    seen: set[str] = set()

    for page in doc:
        words = page.get_text("words", sort=False)
        ids = []
        coord_words = []
        for w in words:
            x0, y0, x1, y1, text = w[:5]
            token = _clean_identifier(text)
            parsed = parse_coordinate_pair(str(text))
            if parsed:
                coord_words.append(
                    {
                        "x0": float(x0),
                        "x1": float(x1),
                        "cy": (float(y0) + float(y1)) / 2.0,
                        "text": str(text),
                        "parsed": parsed,
                    }
                )
            elif token not in ROLE_LABELS and POINT_ID_RE.match(token):
                ids.append(
                    {
                        "identifier": token,
                        "x0": float(x0),
                        "x1": float(x1),
                        "cy": (float(y0) + float(y1)) / 2.0,
                    }
                )

        for ident in ids:
            same_row = [
                c
                for c in coord_words
                if abs(c["cy"] - ident["cy"]) <= row_tolerance and c["x0"] >= ident["x1"]
            ]
            if not same_row:
                continue
            coord_word = min(same_row, key=lambda c: c["x0"] - ident["x1"])
            identifier = ident["identifier"]
            if identifier in seen:
                continue
            lat, lon = coord_word["parsed"]
            coordinates.append(
                Coordinate(
                    identifier=identifier,
                    latitude=lat,
                    longitude=lon,
                    raw_latitude=coord_word["text"],
                    raw_longitude=coord_word["text"],
                    source="waypoint_coordinate_chart",
                    source_path=str(pdf_path),
                )
            )
            seen.add(identifier)

    return coordinates


def build_ground_control_points(
    matches: Sequence[dict],
    coordinate_index: NaipCoordinateIndex,
    airport_icao: str | None,
    page_reports: Sequence[dict],
) -> tuple[list[GroundControlPoint], list[dict]]:
    page_heights = {
        int(r["page"]): float((r.get("mediabox_pdf") or r.get("cropbox_pdf") or [0, 0, 0, 0])[3])
        for r in page_reports
        if r.get("page")
    }
    gcps: list[GroundControlPoint] = []
    misses: list[dict] = []

    for match in matches:
        coord = None
        used_identifier = None
        candidates = identifier_candidates_for_match(match)
        for ident in candidates:
            coord = coordinate_index.find(ident, airport_icao=airport_icao)
            if coord:
                used_identifier = ident
                break
        if not coord or not used_identifier:
            misses.append(
                {
                    "match_page": match.get("page"),
                    "match_center_pdf": match.get("center_pdf"),
                    "candidate_identifiers": candidates,
                    "reason": "coordinate_not_found",
                }
            )
            continue

        page = int(match["page"])
        x, y = (float(match["center_pdf"][0]), float(match["center_pdf"][1]))
        page_height = page_heights.get(page, 0.0)
        gcps.append(
            GroundControlPoint(
                identifier=used_identifier,
                page=page,
                pixel=x,
                line=max(0.0, page_height - y),
                pdf_x=x,
                pdf_y=y,
                longitude=coord.longitude,
                latitude=coord.latitude,
                coordinate_source=coord.source,
                coordinate_source_path=coord.source_path,
                match_confidence=float(match.get("confidence") or 0.0),
            )
        )
        match["point_identifier"] = used_identifier
        match["world_coordinate"] = {
            "latitude": coord.latitude,
            "longitude": coord.longitude,
            "source": coord.source,
            "source_path": coord.source_path,
        }

    return gcps, misses


def gcp_geometry_status(gcps: Sequence[GroundControlPoint]) -> dict:
    if len(gcps) < 3:
        return {"usable": False, "reason": "fewer_than_3_gcps"}

    xs = [g.pixel for g in gcps]
    ys = [g.line for g in gcps]
    lon = [g.longitude for g in gcps]
    lat = [g.latitude for g in gcps]
    image_span = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    world_span = math.hypot(max(lon) - min(lon), max(lat) - min(lat))
    if image_span < 20.0:
        return {"usable": False, "reason": "gcp_image_span_too_small", "image_span": image_span}
    if world_span <= 0.000001:
        return {"usable": False, "reason": "gcp_world_span_too_small", "world_span": world_span}

    max_area = 0.0
    pts = [(g.pixel, g.line) for g in gcps]
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            for k in range(j + 1, len(pts)):
                area = abs(
                    (pts[j][0] - pts[i][0]) * (pts[k][1] - pts[i][1])
                    - (pts[k][0] - pts[i][0]) * (pts[j][1] - pts[i][1])
                ) / 2.0
                max_area = max(max_area, area)
    if max_area < 100.0:
        return {"usable": False, "reason": "gcps_nearly_collinear", "max_triangle_area": max_area}

    return {
        "usable": True,
        "reason": "ok",
        "image_span": image_span,
        "world_span_degrees": world_span,
        "max_triangle_area": max_area,
    }


def write_gcps(out_dir: str | Path, gcps: Sequence[GroundControlPoint]) -> None:
    out_dir = Path(out_dir)
    with (out_dir / "gcps.json").open("w", encoding="utf-8") as f:
        json.dump([asdict(g) for g in gcps], f, ensure_ascii=False, indent=2)
    with (out_dir / "gcps.csv").open("w", newline="", encoding="utf-8") as f:
        fieldnames = list(asdict(gcps[0]).keys()) if gcps else [field.name for field in GroundControlPoint.__dataclass_fields__.values()]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for gcp in gcps:
            writer.writerow(asdict(gcp))
