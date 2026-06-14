from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, List

import fitz

from .coordinates import mupdf_rect_to_pdf, page_coordinate_report
from .debug_render import crop_mupdf, draw_mupdf_boxes, normalized_points_preview
from .geometry import descriptor_for_drawings, drawing_bbox, normalize_points, points_for_drawings
from .vectors import dump_drawings_json, extract_drawings, select_drawings_by_bbox, serialize_drawing

# Hand-reviewed waypoint / airspace-point symbols on page 5 of the CAAC chart-symbol PDF.
# Coordinates are MuPDF/PyMuPDF page coordinates in points, origin top-left.
PAGE5_WAYPOINT_TEMPLATES = [
    {
        "template_id": "mandatory_reporting_triangle_large",
        "output_template_id": "mandatory_reporting_triangle",
        "name_zh": "强制报告点",
        "bbox_mupdf": [152.5, 144.5, 163.5, 154.0],
        "symbol_family": "filled_triangle",
        "active_for_matching": True,
    },
    {
        "template_id": "mandatory_reporting_triangle_small",
        "output_template_id": "mandatory_reporting_triangle",
        "name_zh": "强制报告点",
        "bbox_mupdf": [175.0, 145.5, 184.0, 153.5],
        "symbol_family": "filled_triangle",
        "active_for_matching": True,
    },
    {
        "template_id": "mandatory_reporting_triangle_blue",
        "output_template_id": "mandatory_reporting_triangle",
        "name_zh": "强制报告点",
        "bbox_mupdf": [161.5, 178.5, 172.5, 187.5],
        "symbol_family": "filled_triangle",
        "active_for_matching": True,
    },
    {
        "template_id": "required_reporting_triangle_large",
        "output_template_id": "required_reporting_triangle",
        "name_zh": "要求报告点",
        "bbox_mupdf": [152.5, 227.5, 163.5, 237.0],
        "symbol_family": "open_triangle",
        "active_for_matching": True,
    },
    {
        "template_id": "required_reporting_triangle_small",
        "output_template_id": "required_reporting_triangle",
        "name_zh": "要求报告点",
        "bbox_mupdf": [175.0, 228.5, 184.0, 236.5],
        "symbol_family": "open_triangle",
        "active_for_matching": True,
    },
    {
        "template_id": "required_reporting_triangle_blue",
        "output_template_id": "required_reporting_triangle",
        "name_zh": "要求报告点",
        "bbox_mupdf": [163.0, 261.5, 174.0, 271.0],
        "symbol_family": "open_triangle",
        "active_for_matching": True,
    },
    {
        "template_id": "rnav_mandatory_waypoint_large",
        "output_template_id": "rnav_mandatory_waypoint",
        "name_zh": "区域导航强制航路点",
        "bbox_mupdf": [151.0, 301.5, 164.5, 315.0],
        "symbol_family": "filled_diamond_star",
        "active_for_matching": True,
    },
    {
        "template_id": "rnav_mandatory_waypoint_small",
        "output_template_id": "rnav_mandatory_waypoint",
        "name_zh": "区域导航强制航路点",
        "bbox_mupdf": [174.0, 302.5, 185.0, 314.0],
        "symbol_family": "filled_diamond_star",
        "active_for_matching": True,
    },
    {
        "template_id": "rnav_mandatory_waypoint_blue",
        "output_template_id": "rnav_mandatory_waypoint",
        "name_zh": "区域导航强制航路点",
        "bbox_mupdf": [161.0, 337.5, 174.5, 351.0],
        "symbol_family": "filled_diamond_star",
        "active_for_matching": True,
    },
    {
        "template_id": "rnav_required_waypoint_large",
        "output_template_id": "open_diamond_circle_waypoint",
        "name_zh": "区域导航要求航路点",
        "bbox_mupdf": [151.0, 383.0, 164.5, 397.0],
        "symbol_family": "open_diamond_circle",
        "active_for_matching": True,
    },
    {
        "template_id": "rnav_required_waypoint_small",
        "output_template_id": "open_diamond_circle_waypoint",
        "name_zh": "区域导航要求航路点",
        "bbox_mupdf": [174.0, 384.0, 185.0, 396.0],
        "symbol_family": "open_diamond_circle",
        "active_for_matching": True,
    },
    {
        "template_id": "rnav_required_waypoint_blue",
        "output_template_id": "open_diamond_circle_waypoint",
        "name_zh": "区域导航要求航路点",
        "bbox_mupdf": [161.0, 414.0, 174.5, 428.0],
        "symbol_family": "open_diamond_circle",
        "active_for_matching": True,
    },
    {
        "template_id": "fly_over_point_left",
        "output_template_id": "fly_over_point",
        "name_zh": "飞越点",
        "bbox_mupdf": [128.0, 458.0, 143.0, 473.0],
        "symbol_family": "circled_star",
        "active_for_matching": True,
    },
    {
        "template_id": "fly_over_point_middle",
        "output_template_id": "fly_over_point",
        "name_zh": "飞越点",
        "bbox_mupdf": [155.0, 457.5, 171.5, 474.0],
        "symbol_family": "circled_star",
        "active_for_matching": True,
    },
    {
        "template_id": "fly_over_point_right",
        "output_template_id": "fly_over_point",
        "name_zh": "飞越点",
        "bbox_mupdf": [181.5, 459.0, 195.0, 472.5],
        "symbol_family": "circled_star",
        "active_for_matching": True,
    },
    {
        "template_id": "fly_by_point_left",
        "output_template_id": "fly_by_point",
        "name_zh": "旁切点",
        "bbox_mupdf": [128.0, 499.0, 143.0, 513.0],
        "symbol_family": "open_diamond_circle",
        "active_for_matching": True,
    },
    {
        "template_id": "fly_by_point_middle",
        "output_template_id": "open_diamond_circle_waypoint",
        "name_zh": "旁切点",
        "bbox_mupdf": [155.0, 498.0, 171.5, 514.0],
        "symbol_family": "open_diamond_circle",
        "active_for_matching": True,
    },
    {
        "template_id": "fly_by_point_right",
        "output_template_id": "open_diamond_circle_waypoint",
        "name_zh": "旁切点",
        "bbox_mupdf": [181.5, 499.5, 195.0, 513.0],
        "symbol_family": "open_diamond_circle",
        "active_for_matching": True,
    },
    {
        "template_id": "position_fix_x",
        "output_template_id": "position_fix_x",
        "name_zh": "定位点/平面图",
        "bbox_mupdf": [129.5, 561.0, 135.5, 568.0],
        "symbol_family": "x_fix",
        "active_for_matching": True,
    },
    {
        "template_id": "position_fix_triangle",
        "output_template_id": "position_fix_triangle",
        "name_zh": "定位点/平面图",
        "bbox_mupdf": [144.0, 560.5, 153.5, 568.5],
        "symbol_family": "open_triangle",
        "active_for_matching": True,
    },
    {
        "template_id": "position_profile_vertical_line",
        "output_template_id": "position_profile_vertical_line",
        "name_zh": "定位点/剖面图",
        "bbox_mupdf": [188.8, 541.0, 191.6, 579.0],
        "symbol_family": "vertical_profile_line",
        "active_for_matching": False,
    },
]


def build_template_library(
    source_pdf: str | Path,
    page_number: int,
    out_dir: str | Path,
    template_defs: Iterable[dict] | None = None,
    dpi: int = 300,
) -> dict:
    source_pdf = Path(source_pdf)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "templates").mkdir(exist_ok=True)
    (out_dir / "previews").mkdir(exist_ok=True)
    (out_dir / "normalized").mkdir(exist_ok=True)
    (out_dir / "debug").mkdir(exist_ok=True)

    doc = fitz.open(source_pdf)
    try:
        page_index = page_number - 1
        page = doc[page_index]
        drawings = extract_drawings(page, extended=True)
        dump_drawings_json(drawings, out_dir / "debug" / f"source_page_{page_number:03d}_raw_vectors.json")

        defs = list(template_defs or PAGE5_WAYPOINT_TEMPLATES)
        all_boxes = []
        templates = []

        for spec in defs:
            bbox_mupdf = list(map(float, spec["bbox_mupdf"]))
            selected = select_drawings_by_bbox(drawings, bbox_mupdf, mode="intersects")
            # Keep the source selection tight: a zero-width path can require an expanded bbox, but
            # these hand-reviewed boxes already isolate the symbols.
            pts = points_for_drawings(selected, spacing=0.20, curve_steps=32)
            norm_pts = normalize_points(pts)
            desc = descriptor_for_drawings(selected, pts)
            source_bbox = drawing_bbox(selected) if selected else fitz.Rect(bbox_mupdf)
            source_bbox_pdf = mupdf_rect_to_pdf(page, source_bbox)
            preview = f"previews/{spec['template_id']}.png"
            norm_preview = f"normalized/{spec['template_id']}_normalized.png"
            crop_mupdf(page, bbox_mupdf, out_dir / preview, dpi=dpi, pad_pts=3.0)
            normalized_points_preview(norm_pts, out_dir / norm_preview)

            record = {
                "template_id": spec["template_id"],
                "output_template_id": spec.get("output_template_id", spec["template_id"]),
                "name_zh": spec.get("name_zh"),
                "symbol_family": spec.get("symbol_family"),
                "source_pdf": str(source_pdf.name),
                "source_page": page_number,
                "source_bbox_mupdf": [float(x) for x in source_bbox],
                "selection_bbox_mupdf": bbox_mupdf,
                "source_bbox_pdf": source_bbox_pdf,
                "normalized_points": norm_pts.tolist(),
                "descriptor": desc,
                "visual_hash": desc.get("visual_hash"),
                "raw_paths": [serialize_drawing(d) for d in selected],
                "raw_path_ids": [int(d.get("path_id", -1)) for d in selected],
                "preview_image": preview,
                "normalized_preview_image": norm_preview,
                "approved": bool(spec.get("active_for_matching", True)),
                "active_for_matching": bool(spec.get("active_for_matching", True)),
            }
            templates.append(record)
            with open(out_dir / "templates" / f"{spec['template_id']}.json", "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False, indent=2)
            all_boxes.append({"bbox_mupdf": bbox_mupdf, "label": spec["template_id"], "color": "red"})

        draw_mupdf_boxes(page, all_boxes, out_dir / "debug" / f"source_page_{page_number:03d}_waypoint_symbols.png", dpi=200)

        library = {
            "schema_version": "0.2",
            "source_pdf": str(source_pdf.name),
            "source_page": page_number,
            "coordinate_system_internal": {
                "space": "MuPDF/PyMuPDF page coordinates",
                "origin": "top-left",
                "units": "points",
            },
            "coordinate_system_output": {
                "space": "PDF user space",
                "origin": "bottom-left",
                "units": "points",
                "page_rotation_applied": False,
            },
            "page_report": page_coordinate_report(page),
            "templates": templates,
            "notes": [
                "Templates are hand-reviewed vector crops from page 5, section 4 空域点.",
                "The rnav_required and fly_by symbols are visually near-identical open diamond/circle symbols in this source; target matches may be canonicalized as open_diamond_circle_waypoint.",
                "Raw vector paths are preserved in each template JSON; normalized_points are used for geometric matching.",
            ],
        }
        with open(out_dir / "library.json", "w", encoding="utf-8") as f:
            json.dump(library, f, ensure_ascii=False, indent=2)
    finally:
        doc.close()
    return library


def load_library(path: str | Path) -> dict:
    path = Path(path)
    if path.is_dir():
        path = path / "library.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)
