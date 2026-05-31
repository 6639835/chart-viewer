#!/usr/bin/env python3
"""Audit chart georeferencing across local NAIP chart folders.

This is a developer tool; it imports the app's georef runtime and reports the
control points that were found, which points were accepted by RANSAC, and which
ones are suspicious outliers.  It can also render an annotated PNG for visual
inspection.
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Iterable, Optional, Sequence


def load_georef(repo_root: Path):
    script_path = repo_root / "src-tauri" / "resources" / "georef_script.py"
    spec = importlib.util.spec_from_file_location("georef_script", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not import {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def chart_files(charts_root: Path, airport: Optional[str], limit: Optional[int]) -> list[Path]:
    roots = [charts_root / airport] if airport else sorted(p for p in charts_root.iterdir() if p.is_dir())
    files: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        for pdf in sorted(root.glob("*.pdf")):
            if "-0W-" in pdf.name:
                continue
            files.append(pdf)
            if limit is not None and len(files) >= limit:
                return files
    return files


def waypoint_pdfs_for(pdf: Path) -> list[Path]:
    airport_dir = pdf.parent
    return sorted(airport_dir.glob("*-0W-*.pdf"))


def mercator_to_lonlat(g, x: float, y: float) -> tuple[float, float]:
    lon = x / g.EARTH_RADIUS_M * 180.0 / math.pi
    lat = (2.0 * math.atan(math.exp(y / g.EARTH_RADIUS_M)) - math.pi / 2.0) * 180.0 / math.pi
    return lon, lat


def extract_controls(g, page, designated, terminal_locations, navaid):
    controls = g.extract_waypoint_symbol_controls(page, terminal_locations, navaid, set())
    existing = {p.waypoint for p in controls}
    extra = g.extract_all_fix_controls(page, designated, terminal_locations, navaid, existing)
    controls.extend(extra)
    existing.update(p.waypoint for p in extra)
    controls.extend(g.extract_navaid_controls(page, navaid, existing))
    return controls


def audit_pdf(g, pdf: Path, csv_dir: Path, page_number: Optional[int] = None) -> list[dict]:
    designated = g.load_designated_points(csv_dir)
    navaid = g.load_navaid_points(csv_dir)
    terminal_locations = {}
    for waypoint_pdf in waypoint_pdfs_for(pdf):
        terminal_locations.update(g._extract_waypoints_from_pdf(waypoint_pdf))

    rows: list[dict] = []
    with g.fitz.open(pdf) as doc:
        pages = [(page_number, doc.load_page(page_number - 1))] if page_number else list(enumerate(doc, 1))
        for page_index, page in pages:
            controls = extract_controls(g, page, designated, terminal_locations, navaid)
            transform, rmse = g.fit_page_transform(controls)
            used = [p for p in controls if p.used_for_georef]
            residuals = [
                {
                    "name": p.waypoint,
                    "source": p.source,
                    "x": round(p.mupdf_x, 2),
                    "y": round(p.mupdf_y, 2),
                    "residual_m": round(p.georef_residual_meters, 1)
                    if p.georef_residual_meters is not None
                    else None,
                    "used": p.used_for_georef,
                }
                for p in sorted(
                    controls,
                    key=lambda p: (p.georef_residual_meters is None, -(p.georef_residual_meters or 0)),
                )
            ]
            rows.append(
                {
                    "pdf": str(pdf),
                    "airport": pdf.parent.name,
                    "page": page_index,
                    "georeferenced": transform is not None,
                    "rmse_m": round(rmse, 1) if rmse is not None else None,
                    "controls": len(controls),
                    "used": len(used),
                    "source_counts": dict(Counter(p.source for p in controls)),
                    "used_source_counts": dict(Counter(p.source for p in used)),
                    "worst": residuals[:8],
                }
            )
    return rows


def annotate_pdf(g, pdf: Path, csv_dir: Path, output: Path, page_number: int = 1) -> None:
    designated = g.load_designated_points(csv_dir)
    navaid = g.load_navaid_points(csv_dir)
    terminal_locations = {}
    for waypoint_pdf in waypoint_pdfs_for(pdf):
        terminal_locations.update(g._extract_waypoints_from_pdf(waypoint_pdf))

    with g.fitz.open(pdf) as doc:
        page = doc.load_page(page_number - 1)
        controls = extract_controls(g, page, designated, terminal_locations, navaid)
        _, rmse = g.fit_page_transform(controls)
        for p in controls:
            color = (0, 0.65, 0) if p.used_for_georef else (1, 0, 0)
            page.draw_circle((p.mupdf_x, p.mupdf_y), 5, color=color, width=1.4)
            residual = "" if p.georef_residual_meters is None else f" {p.georef_residual_meters:.0f}"
            page.insert_text((p.mupdf_x + 6, p.mupdf_y - 6), f"{p.waypoint}{residual}", fontsize=7, color=color)
        label = f"RMSE {rmse:.1f}m, controls {len(controls)}" if rmse is not None else f"no fit, controls {len(controls)}"
        page.insert_text((40, 40), label, fontsize=10, color=(0, 0, 1))
        pix = page.get_pixmap(matrix=g.fitz.Matrix(2.0, 2.0), alpha=False)
        output.parent.mkdir(parents=True, exist_ok=True)
        pix.save(output)


def write_csv(path: Path, rows: Iterable[dict]) -> None:
    fieldnames = ["airport", "pdf", "page", "georeferenced", "rmse_m", "controls", "used", "source_counts", "used_source_counts", "worst"]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            flat = dict(row)
            for key in ("source_counts", "used_source_counts", "worst"):
                flat[key] = json.dumps(flat[key], ensure_ascii=False)
            writer.writerow(flat)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Audit NAIP chart georeferencing.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--charts-root", type=Path, default=Path("/Users/lujuncheng/Downloads/NAIP+/charts"))
    parser.add_argument("--csv-dir", type=Path, default=Path("/Users/lujuncheng/Downloads/NAIP+/CSV"))
    parser.add_argument("--airport", help="Only scan one airport directory, e.g. ZBAA")
    parser.add_argument("--pdf", type=Path, help="Only scan one PDF")
    parser.add_argument("--page", type=int, help="Only scan/render this 1-based page")
    parser.add_argument("--limit", type=int, help="Maximum PDFs to scan")
    parser.add_argument("--json", type=Path, help="Write full JSON audit report")
    parser.add_argument("--jsonl", type=Path, help="Write one JSON audit row per line as pages are scanned")
    parser.add_argument("--csv", type=Path, help="Write CSV audit summary")
    parser.add_argument("--progress-every", type=int, default=0, help="Print progress to stderr every N PDFs")
    parser.add_argument("--annotate", type=Path, help="Render an annotated PNG for --pdf")
    args = parser.parse_args(argv)

    repo_root = args.repo_root.resolve()
    g = load_georef(repo_root)

    if args.annotate:
        if args.pdf is None:
            raise SystemExit("--annotate requires --pdf")
        annotate_pdf(g, args.pdf, args.csv_dir, args.annotate, args.page or 1)
        print(args.annotate)
        return 0

    pdfs = [args.pdf] if args.pdf else chart_files(args.charts_root, args.airport, args.limit)
    rows: list[dict] = []
    jsonl_fh = None
    if args.jsonl:
        args.jsonl.parent.mkdir(parents=True, exist_ok=True)
        jsonl_fh = args.jsonl.open("w", encoding="utf-8")
    started = time.monotonic()
    for index, pdf in enumerate(pdfs, 1):
        try:
            pdf_rows = audit_pdf(g, pdf, args.csv_dir, args.page)
        except Exception as exc:  # noqa: BLE001
            pdf_rows = [{"pdf": str(pdf), "airport": pdf.parent.name, "page": args.page or 1, "error": str(exc)}]
        rows.extend(pdf_rows)
        if jsonl_fh is not None:
            for row in pdf_rows:
                jsonl_fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            jsonl_fh.flush()
        if args.progress_every and index % args.progress_every == 0:
            elapsed = time.monotonic() - started
            rate = index / elapsed if elapsed > 0 else 0.0
            print(f"scanned {index}/{len(pdfs)} PDFs ({rate:.1f}/s)", file=sys.stderr, flush=True)
    if jsonl_fh is not None:
        jsonl_fh.close()

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        write_csv(args.csv, rows)

    bad = [r for r in rows if not r.get("georeferenced") or (r.get("rmse_m") or 0) > 250 or (r.get("used") or 0) < 4]
    print(json.dumps({"scanned_pages": len(rows), "suspicious_pages": len(bad), "sample": bad[:20]}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
