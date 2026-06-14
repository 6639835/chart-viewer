#!/usr/bin/env python3
"""Render georeferenced chart projection candidates for visual debugging.

This developer tool does not use Cesium or the app UI. It imports the bundled
georef runtime, renders a PDF page/crop, projects it into Web Mercator with the
computed transform, and writes PNGs plus a small HTML gallery. The goal is to
debug the georeference/crop decision before changing production map rendering.
"""
from __future__ import annotations

import argparse
import html
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional, Sequence

import fitz
from PIL import Image, ImageDraw, ImageFont

EARTH_RADIUS_M = 6_378_137.0


@dataclass(frozen=True)
class Bounds:
    name: str
    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return max(self.right - self.left, 1.0)

    @property
    def height(self) -> float:
        return max(self.bottom - self.top, 1.0)


def clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


def load_georef(repo_root: Path):
    script_path = repo_root / "src-tauri" / "resources" / "georef_script.py"
    spec = importlib.util.spec_from_file_location("georef_script", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not import {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def waypoint_pdfs_for(pdf: Path) -> list[Path]:
    return sorted(pdf.parent.glob("*-0W-*.pdf"))


def lonlat_to_mercator(lon: float, lat: float) -> tuple[float, float]:
    clamped_lat = clamp(lat, -89.5, 89.5)
    x = EARTH_RADIUS_M * math.radians(lon)
    y = EARTH_RADIUS_M * math.log(
        math.tan(math.pi / 4.0 + math.radians(clamped_lat) / 2.0)
    )
    return x, y


def mercator_to_lonlat(x: float, y: float) -> tuple[float, float]:
    lon = math.degrees(x / EARTH_RADIUS_M)
    lat = math.degrees(2.0 * math.atan(math.exp(y / EARTH_RADIUS_M)) - math.pi / 2.0)
    return lon, lat


def apply_transform(
    transform: Sequence[float],
    x: float,
    y: float,
) -> tuple[float, float]:
    a, b, c, d, e, f = transform
    return a * x + c * y + e, b * x + d * y + f


def fit_similarity_transform(
    points: Sequence[dict],
    *,
    pdf_y_up: bool,
) -> tuple[float, float, float, float]:
    """Fit q = [a -b; b a] p + t from PDF points to Mercator meters."""
    usable = [
        p
        for p in points
        if finite(p.get("mupdfX"))
        and finite(p.get("mupdfY"))
        and finite(p.get("lon"))
        and finite(p.get("lat"))
    ]
    if len(usable) < 2:
        raise RuntimeError("similarity projection needs at least two GCPs")

    pdf_points = [
        (float(p["mupdfX"]), -float(p["mupdfY"]) if pdf_y_up else float(p["mupdfY"]))
        for p in usable
    ]
    world_points = [
        lonlat_to_mercator(float(p["lon"]), float(p["lat"])) for p in usable
    ]
    px_mean = sum(x for x, _ in pdf_points) / len(pdf_points)
    py_mean = sum(y for _, y in pdf_points) / len(pdf_points)
    qx_mean = sum(x for x, _ in world_points) / len(world_points)
    qy_mean = sum(y for _, y in world_points) / len(world_points)

    numerator_a = 0.0
    numerator_b = 0.0
    denominator = 0.0
    for (px, py), (qx, qy) in zip(pdf_points, world_points):
        x = px - px_mean
        y = py - py_mean
        u = qx - qx_mean
        v = qy - qy_mean
        numerator_a += x * u + y * v
        numerator_b += x * v - y * u
        denominator += x * x + y * y

    if denominator <= 1e-9:
        raise RuntimeError("GCPs do not span enough PDF distance")

    a = numerator_a / denominator
    b = numerator_b / denominator
    tx = qx_mean - a * px_mean + b * py_mean
    ty = qy_mean - b * px_mean - a * py_mean
    return a, b, tx, ty


def apply_similarity_transform(
    transform: tuple[float, float, float, float],
    x: float,
    y: float,
    *,
    pdf_y_up: bool,
) -> tuple[float, float]:
    a, b, tx, ty = transform
    y = -y if pdf_y_up else y
    return a * x - b * y + tx, b * x + a * y + ty


def finite(value: object) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(float(value))


def control_points(page_result: dict, *, used_only: bool) -> list[dict]:
    points = page_result.get("control_points") or page_result.get("controlPoints") or []
    out = []
    for point in points:
        if used_only and not point.get("used"):
            continue
        if finite(point.get("mupdfX")) and finite(point.get("mupdfY")):
            out.append(point)
    return out


def candidate_bounds(page_result: dict) -> list[Bounds]:
    width = float(page_result["page_width"])
    height = float(page_result["page_height"])
    used = control_points(page_result, used_only=True)
    controls = used or control_points(page_result, used_only=False)

    candidates = [Bounds("full_page", 0.0, 0.0, width, height)]
    if len(controls) < 2:
        return candidates

    xs = [float(p["mupdfX"]) for p in controls]
    ys = [float(p["mupdfY"]) for p in controls]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 1.0)
    span_y = max(max_y - min_y, 1.0)

    tight_pad_x = clamp(span_x * 0.20, 35.0, 110.0)
    tight_pad_y = clamp(span_y * 0.20, 35.0, 130.0)
    candidates.append(
        Bounds(
            "controls_tight",
            clamp(min_x - tight_pad_x, 0.0, width),
            clamp(min_y - tight_pad_y, 0.0, height),
            clamp(max_x + tight_pad_x, 0.0, width),
            clamp(max_y + tight_pad_y, 0.0, height),
        )
    )

    wide_pad_x = max(width * 0.18, span_x * 0.75)
    wide_pad_y = max(height * 0.08, span_y * 0.28)
    candidates.append(
        Bounds(
            "controls_wide",
            clamp(min_x - wide_pad_x, 0.0, width),
            clamp(min_y - wide_pad_y, 0.0, height),
            clamp(max_x + wide_pad_x, 0.0, width),
            clamp(max_y + wide_pad_y, 0.0, height),
        )
    )

    panel_top = clamp(min_y - max(90.0, span_y * 0.20), 0.0, height)
    panel_bottom = clamp(max_y + max(120.0, span_y * 0.22), 0.0, height)
    candidates.append(
        Bounds(
            "map_panel_guess",
            width * 0.04,
            panel_top,
            width * 0.96,
            panel_bottom,
        )
    )

    return dedupe_bounds(candidates)


def convex_hull(points: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    unique = sorted(set(points))
    if len(unique) <= 1:
        return list(unique)

    def cross(
        origin: tuple[float, float],
        a: tuple[float, float],
        b: tuple[float, float],
    ) -> float:
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (
            b[0] - origin[0]
        )

    lower: list[tuple[float, float]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: list[tuple[float, float]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return lower[:-1] + upper[:-1]


def polygon_area(points: Sequence[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for index, point in enumerate(points):
        nxt = points[(index + 1) % len(points)]
        total += point[0] * nxt[1] - nxt[0] * point[1]
    return abs(total) / 2.0


def control_geometry_diagnostics(page_result: dict) -> dict:
    import numpy as np

    controls = control_points(page_result, used_only=True)
    page_area = max(float(page_result["page_width"]) * float(page_result["page_height"]), 1.0)
    points = [(float(p["mupdfX"]), float(p["mupdfY"])) for p in controls]
    if len(points) < 2:
        return {
            "used_controls": len(points),
            "rank": 0,
            "spread_ratio": 0.0,
            "hull_area_pdf_points": 0.0,
            "hull_area_page_ratio": 0.0,
            "warning": "not enough used controls",
        }

    centered = np.asarray(points, dtype=float) - np.asarray(points, dtype=float).mean(axis=0)
    _, singular_values, _ = np.linalg.svd(centered, full_matrices=False)
    major = float(singular_values[0]) if len(singular_values) else 0.0
    minor = float(singular_values[1]) if len(singular_values) > 1 else 0.0
    spread_ratio = minor / major if major > 0 else 0.0
    hull_area = polygon_area(convex_hull(points))
    warning = None
    if len(points) < 4:
        warning = "fewer than four used controls"
    elif spread_ratio < 0.12 or hull_area / page_area < 0.01:
        warning = "used controls are nearly collinear; affine page overlay is underconstrained"

    return {
        "used_controls": len(points),
        "rank": int(np.linalg.matrix_rank(centered)),
        "spread_ratio": spread_ratio,
        "hull_area_pdf_points": hull_area,
        "hull_area_page_ratio": hull_area / page_area,
        "warning": warning,
    }


def dedupe_bounds(bounds: Iterable[Bounds]) -> list[Bounds]:
    seen: set[tuple[int, int, int, int]] = set()
    out: list[Bounds] = []
    for item in bounds:
        key = (
            round(item.left),
            round(item.top),
            round(item.right),
            round(item.bottom),
        )
        if key in seen or item.width < 4 or item.height < 4:
            continue
        seen.add(key)
        out.append(item)
    return out


def pixmap_to_image(pix: fitz.Pixmap) -> Image.Image:
    mode = "RGBA" if pix.alpha else "RGB"
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples).convert("RGBA")


def solve_affine(src: Sequence[tuple[float, float]], dst: Sequence[tuple[float, float]]):
    # Return PIL coefficients mapping output/destination pixels back to source pixels.
    # x_src = a*x_dst + b*y_dst + c; y_src = d*x_dst + e*y_dst + f
    import numpy as np

    matrix = []
    target = []
    for (sx, sy), (dx, dy) in zip(src, dst):
        matrix.append([dx, dy, 1.0, 0.0, 0.0, 0.0])
        matrix.append([0.0, 0.0, 0.0, dx, dy, 1.0])
        target.append(sx)
        target.append(sy)
    # Least-squares handles the overdetermined case (>3 GCP pairs); np.linalg.solve
    # requires a square matrix and would raise for any patch with more than 3 points.
    coeffs, *_ = np.linalg.lstsq(
        np.asarray(matrix, dtype=float), np.asarray(target, dtype=float), rcond=None
    )
    return tuple(float(v) for v in coeffs)


def paste_warped_triangle(
    canvas: Image.Image,
    source: Image.Image,
    src_tri: Sequence[tuple[float, float]],
    dst_tri: Sequence[tuple[float, float]],
) -> None:
    min_x = max(int(math.floor(min(p[0] for p in dst_tri))) - 2, 0)
    min_y = max(int(math.floor(min(p[1] for p in dst_tri))) - 2, 0)
    max_x = min(int(math.ceil(max(p[0] for p in dst_tri))) + 2, canvas.width)
    max_y = min(int(math.ceil(max(p[1] for p in dst_tri))) + 2, canvas.height)
    if max_x <= min_x or max_y <= min_y:
        return

    local_dst = [(x - min_x, y - min_y) for x, y in dst_tri]
    try:
        coeffs = solve_affine(src_tri, local_dst)
    except Exception:
        return

    size = (max_x - min_x, max_y - min_y)
    patch = source.transform(size, Image.Transform.AFFINE, coeffs, Image.Resampling.BICUBIC)
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(local_dst, fill=255)
    canvas.paste(patch, (min_x, min_y), mask)


def nice_step(span: float, target_lines: int = 7) -> float:
    raw = max(span / target_lines, 1e-9)
    power = 10 ** math.floor(math.log10(raw))
    for factor in (1, 2, 5, 10):
        step = factor * power
        if raw <= step:
            return step
    return raw


def draw_grid(
    draw: ImageDraw.ImageDraw,
    world_to_screen,
    min_mx: float,
    min_my: float,
    max_mx: float,
    max_my: float,
) -> None:
    min_lon, min_lat = mercator_to_lonlat(min_mx, min_my)
    max_lon, max_lat = mercator_to_lonlat(max_mx, max_my)
    lon_step = nice_step(abs(max_lon - min_lon))
    lat_step = nice_step(abs(max_lat - min_lat))

    lon = math.floor(min_lon / lon_step) * lon_step
    while lon <= max_lon + lon_step:
        x0, y0 = world_to_screen(*lonlat_to_mercator(lon, min_lat))
        x1, y1 = world_to_screen(*lonlat_to_mercator(lon, max_lat))
        draw.line((x0, y0, x1, y1), fill=(160, 175, 185, 120), width=1)
        draw.text((x0 + 4, 6), f"{lon:.3f}", fill=(70, 82, 92, 255))
        lon += lon_step

    lat = math.floor(min_lat / lat_step) * lat_step
    while lat <= max_lat + lat_step:
        x0, y0 = world_to_screen(*lonlat_to_mercator(min_lon, lat))
        x1, y1 = world_to_screen(*lonlat_to_mercator(max_lon, lat))
        draw.line((x0, y0, x1, y1), fill=(160, 175, 185, 120), width=1)
        draw.text((6, y0 + 4), f"{lat:.3f}", fill=(70, 82, 92, 255))
        lat += lat_step


def render_projection(
    pdf: Path,
    page_result: dict,
    bounds: Bounds,
    output: Path,
    *,
    projection: str,
    source_scale: float,
    max_canvas: int,
) -> dict:
    if projection == "affine":
        transform = page_result.get("transform")
        if not transform:
            raise RuntimeError("page is not georeferenced")

        def project(x: float, y: float) -> tuple[float, float]:
            return apply_transform(transform, x, y)

    elif projection in ("similarity", "similarity_yup"):
        transform = fit_similarity_transform(
            control_points(page_result, used_only=True)
            or control_points(page_result, used_only=False),
            pdf_y_up=projection == "similarity_yup",
        )

        def project(x: float, y: float) -> tuple[float, float]:
            return apply_similarity_transform(
                transform,
                x,
                y,
                pdf_y_up=projection == "similarity_yup",
            )

    else:
        raise RuntimeError(f"unknown projection mode: {projection}")

    with fitz.open(pdf) as doc:
        page = doc.load_page(int(page_result["page"]) - 1)
        clip = fitz.Rect(bounds.left, bounds.top, bounds.right, bounds.bottom)
        pix = page.get_pixmap(
            matrix=fitz.Matrix(source_scale, source_scale),
            clip=clip,
            alpha=False,
            annots=False,
        )
    source = pixmap_to_image(pix)
    source_output = output.with_name(f"{output.stem}_source.png")
    source.convert("RGB").save(source_output, quality=95)

    columns = 18
    rows = 18
    world_vertices: list[tuple[float, float]] = []
    src_vertices: list[tuple[float, float]] = []
    for row in range(rows):
        fy = row / (rows - 1)
        y = bounds.top + bounds.height * fy
        for col in range(columns):
            fx = col / (columns - 1)
            x = bounds.left + bounds.width * fx
            world_vertices.append(project(x, y))
            src_vertices.append(((x - bounds.left) * source_scale, (y - bounds.top) * source_scale))

    min_mx = min(x for x, _ in world_vertices)
    max_mx = max(x for x, _ in world_vertices)
    min_my = min(y for _, y in world_vertices)
    max_my = max(y for _, y in world_vertices)

    used_controls = control_points(page_result, used_only=True)
    all_controls = control_points(page_result, used_only=False)
    for point in all_controls:
        if finite(point.get("lon")) and finite(point.get("lat")):
            mx, my = lonlat_to_mercator(float(point["lon"]), float(point["lat"]))
            min_mx = min(min_mx, mx)
            max_mx = max(max_mx, mx)
            min_my = min(min_my, my)
            max_my = max(max_my, my)

    pad_x = max((max_mx - min_mx) * 0.08, 100.0)
    pad_y = max((max_my - min_my) * 0.08, 100.0)
    min_mx -= pad_x
    max_mx += pad_x
    min_my -= pad_y
    max_my += pad_y

    aspect = max((max_mx - min_mx) / max(max_my - min_my, 1.0), 0.1)
    if aspect >= 1:
        canvas_w = max_canvas
        canvas_h = max(500, int(max_canvas / aspect))
    else:
        canvas_h = max_canvas
        canvas_w = max(500, int(max_canvas * aspect))

    def world_to_screen(mx: float, my: float) -> tuple[float, float]:
        x = (mx - min_mx) / (max_mx - min_mx) * canvas_w
        y = canvas_h - (my - min_my) / (max_my - min_my) * canvas_h
        return x, y

    canvas = Image.new("RGBA", (canvas_w, canvas_h), (242, 240, 234, 255))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw_grid(draw, world_to_screen, min_mx, min_my, max_mx, max_my)

    for row in range(rows - 1):
        for col in range(columns - 1):
            tl = row * columns + col
            tr = tl + 1
            bl = tl + columns
            br = bl + 1
            for tri in ((tl, tr, br), (tl, br, bl)):
                paste_warped_triangle(
                    canvas,
                    source,
                    [src_vertices[i] for i in tri],
                    [world_to_screen(*world_vertices[i]) for i in tri],
                )

    draw = ImageDraw.Draw(canvas, "RGBA")
    outline = [
        world_to_screen(*project(bounds.left, bounds.top)),
        world_to_screen(*project(bounds.right, bounds.top)),
        world_to_screen(*project(bounds.right, bounds.bottom)),
        world_to_screen(*project(bounds.left, bounds.bottom)),
    ]
    draw.line(outline + [outline[0]], fill=(10, 90, 210, 210), width=3)

    for point in all_controls:
        if not (finite(point.get("lon")) and finite(point.get("lat"))):
            continue
        expected = world_to_screen(*lonlat_to_mercator(float(point["lon"]), float(point["lat"])))
        projected = world_to_screen(
            *project(float(point["mupdfX"]), float(point["mupdfY"]))
        )
        used = bool(point.get("used"))
        color = (0, 150, 80, 255) if used else (210, 60, 50, 255)
        draw.line((expected[0], expected[1], projected[0], projected[1]), fill=color, width=2)
        r = 5 if used else 4
        draw.ellipse(
            (expected[0] - r, expected[1] - r, expected[0] + r, expected[1] + r),
            fill=color,
            outline=(255, 255, 255, 240),
            width=1,
        )
        label = str(point.get("waypoint") or "")
        residual = point.get("residualMeters")
        if finite(residual):
            label = f"{label} {float(residual):.0f}m"
        draw.text((expected[0] + 7, expected[1] - 8), label, fill=(20, 28, 35, 255))

    title = (
        f"{pdf.name} page {page_result['page']} | {projection} | {bounds.name} "
        f"{bounds.left:.0f},{bounds.top:.0f}-{bounds.right:.0f},{bounds.bottom:.0f} | "
        f"rmse {page_result.get('rmse_meters') or page_result.get('rmseMeters')}"
    )
    draw.rectangle((0, canvas_h - 28, canvas_w, canvas_h), fill=(255, 255, 255, 225))
    draw.text((8, canvas_h - 20), title, fill=(15, 23, 42, 255))

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, quality=95)
    return {
        "name": bounds.name,
        "projection": projection,
        "bounds": {
            "left": bounds.left,
            "top": bounds.top,
            "right": bounds.right,
            "bottom": bounds.bottom,
        },
        "image": output.name,
        "source_image": source_output.name,
        "canvas": [canvas_w, canvas_h],
        "source": [source.width, source.height],
        "controls": len(all_controls),
        "used_controls": len(used_controls),
    }


def write_html(output: Path, pdf: Path, records: Sequence[dict]) -> None:
    items = []
    for record in records:
        name = html.escape(f"{record.get('projection', 'unknown')} / {record['name']}")
        image = html.escape(record["image"])
        source_image = html.escape(record["source_image"])
        bounds = html.escape(json.dumps(record["bounds"], separators=(",", ":")))
        items.append(
            f"""
            <section>
              <h2>{name}</h2>
              <p><code>{bounds}</code></p>
              <div class="pair">
                <figure>
                  <figcaption>Projected</figcaption>
                  <img src="{image}" alt="{name}">
                </figure>
                <figure>
                  <figcaption>Rendered PDF crop</figcaption>
                  <img src="{source_image}" alt="{name} source crop">
                </figure>
              </div>
            </section>
            """
        )

    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Georef Projection Debug - {html.escape(pdf.name)}</title>
  <style>
    body {{ margin: 0; font: 14px system-ui, sans-serif; background: #f5f3ef; color: #172033; }}
    header {{ position: sticky; top: 0; z-index: 1; padding: 12px 16px; background: #ffffffee; border-bottom: 1px solid #d8d2c6; }}
    main {{ display: grid; gap: 18px; padding: 18px; }}
    section {{ background: white; border: 1px solid #d8d2c6; border-radius: 8px; padding: 12px; }}
    h1, h2 {{ margin: 0 0 8px; }}
    p {{ margin: 0 0 10px; color: #475569; }}
    .pair {{ display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 34%); gap: 12px; align-items: start; }}
    figure {{ margin: 0; }}
    figcaption {{ margin: 0 0 6px; color: #334155; font-weight: 600; }}
    img {{ width: 100%; height: auto; display: block; border: 1px solid #cbd5e1; background: #eee; }}
    code {{ white-space: pre-wrap; }}
    @media (max-width: 900px) {{ .pair {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(pdf.name)}</h1>
    <p>Green points are accepted controls. Red points are rejected controls. Lines show residual from projected PDF point to known world point.</p>
  </header>
  <main>
    {''.join(items)}
  </main>
</body>
</html>
"""
    output.write_text(page, encoding="utf-8")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Render georef projection debug images.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--csv-dir", type=Path, default=Path("/Users/lujuncheng/Downloads/NAIP+/CSV"))
    parser.add_argument("--waypoint-pdf", type=Path, action="append", default=None)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--out-dir", type=Path, default=Path("tmp/georef-debug"))
    parser.add_argument("--source-scale", type=float, default=2.0)
    parser.add_argument("--max-canvas", type=int, default=1800)
    args = parser.parse_args(argv)

    repo_root = args.repo_root.resolve()
    pdf = args.pdf.resolve()
    out_dir = (repo_root / args.out_dir / f"{pdf.stem}-p{args.page}").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    georef = load_georef(repo_root)
    waypoint_pdfs = args.waypoint_pdf if args.waypoint_pdf is not None else waypoint_pdfs_for(pdf)
    results = georef.process_pdf(pdf, args.csv_dir, waypoint_pdfs, args.page)
    page_result = next((r for r in results if int(r["page"]) == args.page), None)
    if page_result is None:
        raise SystemExit(f"page {args.page} not found in georef result")
    if not page_result.get("georeferenced"):
        raise SystemExit(json.dumps(page_result, ensure_ascii=False, indent=2))

    (out_dir / "georef_result.json").write_text(
        json.dumps(page_result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    records = []
    for projection in ("affine", "similarity", "similarity_yup"):
        for bounds in candidate_bounds(page_result):
            image_path = out_dir / f"{projection}_{bounds.name}.png"
            records.append(
                render_projection(
                    pdf,
                    page_result,
                    bounds,
                    image_path,
                    projection=projection,
                    source_scale=args.source_scale,
                    max_canvas=args.max_canvas,
                )
            )

    summary = {
        "pdf": str(pdf),
        "page": args.page,
        "out_dir": str(out_dir),
        "rmse_meters": page_result.get("rmse_meters"),
        "control_point_count": page_result.get("control_point_count"),
        "inlier_count": page_result.get("inlier_count"),
        "control_geometry": control_geometry_diagnostics(page_result),
        "records": records,
    }
    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_html(out_dir / "index.html", pdf, records)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
