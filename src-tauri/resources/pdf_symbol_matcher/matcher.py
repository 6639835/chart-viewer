from __future__ import annotations

import csv
import json
import math
import re
from pathlib import Path
from typing import Iterable, Sequence

import fitz
import numpy as np

from .coordinates import center_pdf, mupdf_rect_to_pdf, page_coordinate_report
from .debug_render import draw_mupdf_boxes
from .geometry import best_normalized_shape_score, descriptor_for_drawings, points_for_drawings
from .naip import (
    NaipCoordinateIndex,
    build_ground_control_points,
    gcp_geometry_status,
    infer_airport_icao,
    write_gcps,
)
from .template_builder import load_library
from .vectors import dump_drawings_json, extract_drawings, serialize_drawing

IDENTIFIER_RE = re.compile(
    r"""
    ^(
        [A-Z]{5}
        |
        (?!RNP\d{2}$)(?!RNAV\d$)(?!GNSS\d$)(?!VOR\d{2}$)(?!DME\d{2}$)(?=[A-Z0-9]{5}$)(?=.*[A-Z])(?=(?:[A-Z]*\d){1,3}[A-Z]*$)[A-Z0-9]{5}
        |
        RWY?\d{2}[LCR]?
    )$
    """,
    re.VERBOSE,
)
GENERIC_FAMILIES = {"filled_triangle", "open_triangle", "x_fix", "vertical_profile_line"}
ROLE_LABELS = {"IAF", "IF", "FAF", "FAP", "MAPT", "MAHF", "ARP"}
DME_FIX_RE = re.compile(r"^D\d+(?:\.\d+)?$")
NAVAID_RE = re.compile(r"^[A-Z]{2,4}$")


def _rect_tuple(r: fitz.Rect) -> list[float]:
    return [float(r.x0), float(r.y0), float(r.x1), float(r.y1)]


def _clean_token(text: object) -> str:
    return str(text).strip().replace(" ", "").strip(".,;:()[]{}").upper()


def _bbox_for_words(words: Sequence[dict]) -> fitz.Rect:
    r = fitz.Rect(words[0]["bbox_mupdf"])
    for w in words[1:]:
        r.include_rect(fitz.Rect(w["bbox_mupdf"]))
    return r


def _label_center(r: fitz.Rect) -> list[float]:
    return [(float(r.x0) + float(r.x1)) / 2.0, (float(r.y0) + float(r.y1)) / 2.0]


def _is_role_token(token: str) -> bool:
    return token in ROLE_LABELS


def _is_dme_token(token: str) -> bool:
    return bool(DME_FIX_RE.match(token))


def _is_navaid_token(token: str) -> bool:
    return bool(NAVAID_RE.match(token)) and token not in ROLE_LABELS


def _is_named_fix_token(token: str) -> bool:
    if _is_role_token(token) or _is_dme_token(token):
        return False
    return bool(IDENTIFIER_RE.match(token))


def _label_priority(kind: str) -> float:
    return {
        "named_fix": 1.0,
        "dme_fix": 0.96,
    }.get(kind, 0.20)


def load_templates(library_dir: str | Path, template_ids: Iterable[str] | None = None) -> list[dict]:
    lib = load_library(library_dir)
    wanted = set(template_ids or [])
    templates = []
    for t in lib.get("templates", []):
        if not t.get("active_for_matching", True):
            continue
        if wanted and t["template_id"] not in wanted and t.get("output_template_id") not in wanted:
            continue
        tt = dict(t)
        tt["points_np"] = np.asarray(t.get("normalized_points", []), dtype=np.float64)
        # normalized_points are already normalized, but best_normalized_shape_score normalizes again
        # harmlessly. Use source-space samples from raw paths if available? The normalized points are enough.
        templates.append(tt)
    return templates


def extract_label_words(page: fitz.Page) -> list[dict]:
    words = []
    for w in page.get_text("words"):
        x0, y0, x1, y1, text = w[:5]
        clean = _clean_token(text)
        if IDENTIFIER_RE.match(clean):
            words.append({
                "text": clean,
                "bbox_mupdf": [float(x0), float(y0), float(x1), float(y1)],
                "center_mupdf": [(float(x0) + float(x1)) / 2.0, (float(y0) + float(y1)) / 2.0],
            })
    return words


def _word_records(page: fitz.Page) -> list[dict]:
    records = []
    for ordinal, w in enumerate(page.get_text("words", sort=False)):
        x0, y0, x1, y1, text = w[:5]
        clean = _clean_token(text)
        if not clean:
            continue
        block_no = int(w[5]) if len(w) > 5 else 0
        line_no = int(w[6]) if len(w) > 6 else ordinal
        word_no = int(w[7]) if len(w) > 7 else ordinal
        records.append({
            "text": clean,
            "raw_text": str(text),
            "bbox_mupdf": [float(x0), float(y0), float(x1), float(y1)],
            "block_no": block_no,
            "line_no": line_no,
            "word_no": word_no,
            "ordinal": ordinal,
        })
    return records


def _make_label_candidate(
    line_words: Sequence[dict],
    token_indexes: Sequence[int],
    text: str,
    kind: str,
    context_text: str | None = None,
) -> dict:
    selected = [line_words[i] for i in token_indexes]
    r = _bbox_for_words(selected)
    return {
        "text": text,
        "context_text": context_text or text,
        "kind": kind,
        "priority": _label_priority(kind),
        "tokens": [w["text"] for w in selected],
        "bbox_mupdf": _rect_tuple(r),
        "center_mupdf": _label_center(r),
        "block_no": selected[0].get("block_no"),
        "line_no": selected[0].get("line_no"),
    }


def _dedupe_label_candidates(labels: Sequence[dict]) -> list[dict]:
    best_by_key: dict[tuple[str, tuple[float, float, float, float]], dict] = {}
    for lab in labels:
        bbox_key = tuple(round(float(x), 2) for x in lab["bbox_mupdf"])
        key = (lab["text"], bbox_key)
        prev = best_by_key.get(key)
        if prev is None or lab.get("priority", 0.0) > prev.get("priority", 0.0):
            best_by_key[key] = lab
    return list(best_by_key.values())


def extract_label_candidates(page: fitz.Page) -> list[dict]:
    """Build semantic label candidates from PDF words, preserving line context."""
    by_line: dict[tuple[int, int], list[dict]] = {}
    for w in _word_records(page):
        by_line.setdefault((w["block_no"], w["line_no"]), []).append(w)

    labels: list[dict] = []
    for line_words in by_line.values():
        line_words = sorted(line_words, key=lambda w: (w["word_no"], w["bbox_mupdf"][0]))
        for i, word in enumerate(line_words):
            token = word["text"]
            if _is_dme_token(token) and i + 1 < len(line_words) and _is_navaid_token(line_words[i + 1]["text"]):
                idxs = [i, i + 1]
                text = f"{token} {line_words[i + 1]['text']}"
                labels.append(_make_label_candidate(line_words, idxs, text, "dme_fix", context_text=text))
                continue

            if _is_named_fix_token(token):
                labels.append(_make_label_candidate(line_words, [i], token, "named_fix", context_text=token))
                continue

    # Backward-compatible fallback for labels that were accepted by the older word matcher.
    for w in extract_label_words(page):
        token = w["text"]
        if _is_role_token(token):
            continue
        labels.append({
            **w,
            "context_text": token,
            "kind": "named_fix",
            "priority": _label_priority("named_fix"),
            "tokens": [token],
        })

    return _dedupe_label_candidates(labels)




def all_text_word_boxes(page: fitz.Page, pad: float = 1.0) -> list[fitz.Rect]:
    boxes = []
    for w in page.get_text("words"):
        r = fitz.Rect(w[:4])
        boxes.append(fitz.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad))
    return boxes


def point_inside_any_box(pt: tuple[float, float], boxes: Sequence[fitz.Rect]) -> bool:
    p = fitz.Point(float(pt[0]), float(pt[1]))
    return any(b.contains(p) for b in boxes)


def _axis_gap(a0: float, a1: float, b0: float, b1: float) -> float:
    if a1 < b0:
        return b0 - a1
    if b1 < a0:
        return a0 - b1
    return 0.0


def _rect_distance(a: fitz.Rect, b: fitz.Rect) -> float:
    return math.hypot(_axis_gap(a.x0, a.x1, b.x0, b.x1), _axis_gap(a.y0, a.y1, b.y0, b.y1))


def _label_affinity(symbol_rect: fitz.Rect, lab: dict, max_dist: float) -> tuple[float, float]:
    label_rect = fitz.Rect(lab["bbox_mupdf"])
    edge_dist = _rect_distance(symbol_rect, label_rect)
    if edge_dist > max_dist:
        return edge_dist, 0.0

    sx, sy = (symbol_rect.x0 + symbol_rect.x1) / 2.0, (symbol_rect.y0 + symbol_rect.y1) / 2.0
    lx, ly = lab["center_mupdf"]
    dist_score = max(0.0, 1.0 - edge_dist / max_dist)
    horizontal_band_score = max(0.0, 1.0 - abs(sy - ly) / 30.0)
    vertical_band_score = max(0.0, 1.0 - abs(sx - lx) / 42.0)
    axis_alignment = max(horizontal_band_score, vertical_band_score)
    side_bonus = 1.0 if abs(sx - lx) >= abs(sy - ly) else 0.82

    # Domain priority lets named identifiers and DME fixes win when multiple
    # identifier-like labels are plausible for the same symbol.
    priority = float(lab.get("priority", 0.2))
    score = (
        0.50 * dist_score
        + 0.30 * priority
        + 0.14 * axis_alignment
        + 0.06 * side_bonus
    )
    return edge_dist, max(0.0, min(1.0, score))


def nearest_label_for_symbol(symbol_rect: fitz.Rect, labels: Sequence[dict], max_dist: float = 70.0) -> tuple[dict | None, float, float]:
    best = None
    best_dist = 1e9
    best_score = 0.0
    for lab in labels:
        dist, score = _label_affinity(symbol_rect, lab, max_dist=max_dist)
        if score > best_score or (math.isclose(score, best_score) and dist < best_dist):
            best = lab
            best_dist = dist
            best_score = score
    if best is None:
        return None, best_dist, 0.0
    if best_score <= 0.0:
        return best, best_dist, 0.0
    best = dict(best)
    best["association_score"] = float(best_score)
    best["association_distance_mupdf"] = float(best_dist)
    return best, best_dist, best_score


def nearest_label(center: tuple[float, float], labels: Sequence[dict], max_dist: float = 58.0) -> tuple[dict | None, float, float]:
    point_rect = fitz.Rect(center[0], center[1], center[0], center[1])
    return nearest_label_for_symbol(point_rect, labels, max_dist=max_dist)


def _label_assignment_key(label: dict) -> tuple[str, tuple[float, float, float, float]]:
    return (
        str(label.get("text", "")),
        tuple(round(float(x), 2) for x in label.get("bbox_mupdf", [])),
    )


def assign_unique_labels(matches: Sequence[dict], labels_by_page: dict[int, Sequence[dict]]) -> list[dict]:
    reassigned = [dict(m) for m in matches]
    by_page: dict[int, list[int]] = {}
    for i, m in enumerate(reassigned):
        by_page.setdefault(int(m["page"]), []).append(i)

    for page_no, indexes in by_page.items():
        labels = labels_by_page.get(page_no, [])
        scored_pairs = []
        for mi in indexes:
            m = reassigned[mi]
            symbol_rect = fitz.Rect(m["bbox_mupdf"])
            for lab in labels:
                dist, score = _label_affinity(symbol_rect, lab, max_dist=70.0)
                if score <= 0.0:
                    continue
                scored_pairs.append((score, -dist, mi, lab, dist))

        assigned_matches: set[int] = set()
        assigned_labels: set[tuple[str, tuple[float, float, float, float]]] = set()
        for score, neg_dist, mi, lab, dist in sorted(scored_pairs, reverse=True):
            key = _label_assignment_key(lab)
            if mi in assigned_matches or key in assigned_labels:
                continue
            assigned_matches.add(mi)
            assigned_labels.add(key)
            label = dict(lab)
            label["association_score"] = float(score)
            label["association_distance_mupdf"] = float(-neg_dist)
            reassigned[mi]["nearest_label"] = label
            reassigned[mi]["nearest_label_distance_mupdf"] = float(dist)
            reassigned[mi]["nearest_label_score"] = float(score)
    return reassigned


def candidate_drawings(drawings: Sequence[dict], page: fitz.Page) -> list[dict]:
    candidates = []
    for d in drawings:
        if d.get("type") in ("clip", "group"):
            continue
        items = d.get("items", []) or []
        if len(items) < 2:
            continue
        r = fitz.Rect(d.get("rect", (0, 0, 0, 0)))
        if r.is_empty:
            continue
        w = float(r.width)
        h = float(r.height)
        # Single-symbol-size range in these charts. Vertical profile line is intentionally excluded
        # from default matching because it is not distinctive enough without semantic context.
        if not (2.2 <= w <= 28 and 2.2 <= h <= 28):
            continue
        if w / max(h, 1e-9) > 3.0 or h / max(w, 1e-9) > 3.0:
            continue
        # Reject footer/copyright margin and page frame noise, but keep map/profile interiors.
        if r.x0 < 24 or r.y0 < 45 or r.x1 > page.rect.width - 12 or r.y1 > page.rect.height - 20:
            continue
        candidates.append({"drawing": d, "bbox_mupdf": _rect_tuple(r)})
    return candidates


def score_candidate_against_template(candidate_points: np.ndarray, candidate_desc: dict, template: dict, label_score: float) -> dict:
    tpts = np.asarray(template.get("normalized_points", []), dtype=np.float64)
    # best_normalized_shape_score normalizes both arrays, so tpts can be normalized or source-space.
    score = best_normalized_shape_score(tpts, candidate_points)
    chamfer = score["chamfer"]
    cov_t = score.get("coverage_template", 0.0)
    cov_c = score.get("coverage_candidate", 0.0)
    shape_conf = max(0.0, min(1.0, 1.0 - chamfer / 0.18))
    cov_score = (cov_t + cov_c) / 2.0

    tb = template.get("descriptor", {})
    aspect_t = tb.get("bbox_aspect") or 1.0
    aspect_c = candidate_desc.get("bbox_aspect") or 1.0
    aspect_score = max(0.0, 1.0 - min(abs(aspect_t - aspect_c) / max(aspect_t, aspect_c, 1e-9), 1.0))

    ti = tb.get("num_items") or 0
    ci = candidate_desc.get("num_items") or 0
    item_score = max(0.0, 1.0 - min(abs(ti - ci) / max(ti, ci, 1), 1.0))

    # Fill/stroke compatibility is a weak feature. It helps separate filled triangles from open outlines.
    family = template.get("symbol_family") or ""
    has_fill_t = bool(tb.get("has_fill"))
    has_stroke_t = bool(tb.get("has_stroke"))
    has_fill_c = bool(candidate_desc.get("has_fill"))
    has_stroke_c = bool(candidate_desc.get("has_stroke"))
    style_score = 0.5
    if has_fill_t == has_fill_c:
        style_score += 0.25
    if has_stroke_t == has_stroke_c:
        style_score += 0.25

    confidence = (
        0.52 * shape_conf
        + 0.22 * cov_score
        + 0.09 * aspect_score
        + 0.07 * item_score
        + 0.06 * style_score
        + 0.04 * label_score
    )

    # Penalize generic symbols unless nearby text context suggests a waypoint/procedure point.
    generic_penalty = 0.0
    if family in GENERIC_FAMILIES and label_score <= 0.0:
        generic_penalty = 0.18
    if family in {"filled_triangle", "open_triangle"} and ci > max(ti * 2.5, 12):
        generic_penalty += 0.12
    confidence = max(0.0, min(1.0, confidence - generic_penalty))

    return {
        **score,
        "shape_confidence": shape_conf,
        "coverage_score": cov_score,
        "aspect_score": aspect_score,
        "item_score": item_score,
        "style_score": style_score,
        "confidence": confidence,
    }


def bbox_iou(a: Sequence[float], b: Sequence[float]) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0, ix1, iy1 = max(ax0, bx0), max(ay0, by0), min(ax1, bx1), min(ay1, by1)
    ia = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    aa = max(0, ax1 - ax0) * max(0, ay1 - ay0)
    ba = max(0, bx1 - bx0) * max(0, by1 - by0)
    return ia / max(aa + ba - ia, 1e-9)


def dedupe_matches(matches: list[dict]) -> list[dict]:
    matches = sorted(matches, key=lambda m: m["confidence"], reverse=True)
    keep = []
    for m in matches:
        cx, cy = m["center_mupdf"]
        dup = False
        for k in keep:
            kx, ky = k["center_mupdf"]
            same_symbol = (math.hypot(cx - kx, cy - ky) < 3.0) or bbox_iou(m["bbox_mupdf"], k["bbox_mupdf"]) > 0.55
            if same_symbol:
                # Prefer the stronger visual canonicalization. Same visual symbol should appear once.
                dup = True
                break
        if not dup:
            keep.append(m)
    return sorted(keep, key=lambda m: (m["page"], m["bbox_mupdf"][1], m["bbox_mupdf"][0]))


def match_pdf(
    pdf_path: str | Path,
    library_dir: str | Path,
    out_dir: str | Path,
    template_ids: Iterable[str] | None = None,
    threshold: float = 0.80,
    debug: bool = True,
    naip_root: str | Path | None = None,
    airport_icao: str | None = None,
    page_number: int | None = None,
    templates: list[dict] | None = None,
) -> dict:
    pdf_path = Path(pdf_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    debug_dir = out_dir / "debug"
    debug_dir.mkdir(exist_ok=True)

    if templates is None:
        templates = load_templates(library_dir, template_ids=template_ids)
    doc = fitz.open(pdf_path)
    all_matches: list[dict] = []
    all_rejected: list[dict] = []
    page_reports = []
    labels_by_page: dict[int, list[dict]] = {}

    # When a specific page is requested, only that page is matched. The caller
    # discards other pages anyway, so matching them is wasted work for
    # multi-page PDFs.
    if page_number is not None:
        page_indexes = [page_number - 1] if 1 <= page_number <= len(doc) else []
    else:
        page_indexes = list(range(len(doc)))

    for page_index in page_indexes:
        page = doc[page_index]
        page_no = page_index + 1
        page_reports.append({"page": page_no, **page_coordinate_report(page)})
        drawings = extract_drawings(page, extended=True)
        if debug:
            dump_drawings_json(drawings, debug_dir / f"{pdf_path.stem}_page_{page_no:03d}_vectors.json")

        labels = extract_label_candidates(page)
        labels_by_page[page_no] = labels
        word_boxes = all_text_word_boxes(page, pad=1.0)
        candidates = candidate_drawings(drawings, page)
        candidate_box_records = []

        for ci, c in enumerate(candidates):
            d = c["drawing"]
            r = fitz.Rect(c["bbox_mupdf"])
            pts = points_for_drawings([d], spacing=0.20, curve_steps=32)
            if pts.shape[0] < 5:
                continue
            desc = descriptor_for_drawings([d], pts)
            center = ((r.x0 + r.x1) / 2.0, (r.y0 + r.y1) / 2.0)
            if point_inside_any_box(center, word_boxes):
                all_rejected.append({
                    "page": page_no,
                    "candidate_index": ci,
                    "bbox_mupdf": _rect_tuple(r),
                    "center_mupdf": [float(center[0]), float(center[1])],
                    "candidate_path_id": int(d.get("path_id", -1)),
                    "candidate_item_count": len(d.get("items", []) or []),
                    "reject_reasons": ["candidate_center_inside_text_word_bbox"],
                })
                continue
            nearest, nearest_dist, label_score = nearest_label_for_symbol(r, labels)
            # For aviation waypoint matching, a symbol should be close to a waypoint/procedure
            # label. This prevents thousands of text glyphs, terrain symbols, and chart grid
            # elements from being sent through the heavier vector scorer.
            if label_score <= 0.0:
                all_rejected.append({
                    "page": page_no,
                    "candidate_index": ci,
                    "bbox_mupdf": _rect_tuple(r),
                    "center_mupdf": [float(center[0]), float(center[1])],
                    "candidate_path_id": int(d.get("path_id", -1)),
                    "candidate_item_count": len(d.get("items", []) or []),
                    "reject_reasons": ["not_near_waypoint_label"],
                    "nearest_label": nearest,
                    "nearest_label_distance_mupdf": float(nearest_dist),
                    "nearest_label_score": float(label_score),
                })
                continue
            best_t = None
            best_score = None
            for t in templates:
                s = score_candidate_against_template(pts, desc, t, label_score)
                if best_score is None or s["confidence"] > best_score["confidence"]:
                    best_score = s
                    best_t = t
            if not best_t or not best_score:
                continue
            family = best_t.get("symbol_family")
            output_id = best_t.get("output_template_id") or best_t.get("template_id")
            raw_reasons = []
            tb_for_scale = best_t.get("descriptor", {})
            tbw_for_scale = float(tb_for_scale.get("bbox_width") or max(r.width, r.height, 1.0))
            cand_scale_for_reject = max(float(r.width), float(r.height)) / max(tbw_for_scale, 1e-9)
            if cand_scale_for_reject < 0.35:
                raw_reasons.append("scale_too_small_for_source_template")
            if cand_scale_for_reject > 2.75:
                raw_reasons.append("scale_too_large_for_source_template")
            if best_score["confidence"] < threshold:
                raw_reasons.append("below_threshold")
            if best_score["chamfer"] > 0.085 and best_score["confidence"] < threshold + 0.06:
                raw_reasons.append("shape_chamfer_too_high")
            if family in GENERIC_FAMILIES and label_score <= 0.0:
                raw_reasons.append("generic_symbol_without_waypoint_label_context")
            # The open diamond/circle waypoint is very distinctive in these PDFs; nearby labels are still
            # preferred but not required when the vector shape is excellent.
            if output_id == "open_diamond_circle_waypoint" and best_score["chamfer"] < 0.035:
                raw_reasons = [x for x in raw_reasons if x != "generic_symbol_without_waypoint_label_context"]
            rec_common = {
                "page": page_no,
                "candidate_index": ci,
                "bbox_mupdf": _rect_tuple(r),
                "center_mupdf": [float(center[0]), float(center[1])],
                "candidate_path_id": int(d.get("path_id", -1)),
                "candidate_item_count": len(d.get("items", []) or []),
                "template_id": output_id,
                "source_template_id": best_t.get("template_id"),
                "source_symbol_family": family,
                "confidence": float(best_score["confidence"]),
                "score": {k: float(v) if isinstance(v, (float, int)) else v for k, v in best_score.items()},
                "nearest_label": nearest,
                "nearest_label_distance_mupdf": float(nearest_dist),
                "nearest_label_score": float(label_score),
            }
            candidate_box_records.append({"bbox_mupdf": c["bbox_mupdf"], "label": f"{ci}:{rec_common['confidence']:.2f}", "color": "orange"})
            if raw_reasons:
                all_rejected.append({**rec_common, "reject_reasons": raw_reasons})
                continue
            bbox_pdf = mupdf_rect_to_pdf(page, r)
            centerpdf = center_pdf(page, r)
            width = bbox_pdf[2] - bbox_pdf[0]
            height = bbox_pdf[3] - bbox_pdf[1]
            template_bbox = best_t.get("descriptor", {})
            tbw = float(template_bbox.get("bbox_width") or max(width, height, 1.0))
            scale = max(float(r.width), float(r.height)) / max(tbw, 1e-9)
            rotation_out = float(best_score.get("rotation_degrees", 0.0))
            # Diamond/circle and circled-star symbols have rotational symmetry, so the
            # normalized Chamfer search may choose any equivalent quadrant. Report the
            # canonical page orientation as 0 degrees and retain the raw scorer value in debug.
            if family in {"open_diamond_circle", "filled_diamond_star", "circled_star"}:
                rotation_out = 0.0
            match = {
                **rec_common,
                "bbox_pdf": [round(float(x), 4) for x in bbox_pdf],
                "center_pdf": [round(float(x), 4) for x in centerpdf],
                "width": round(float(width), 4),
                "height": round(float(height), 4),
                "rotation_degrees": round(rotation_out, 4),
                "scale": round(float(scale), 4),
                "method": "vector_normalized_chamfer_with_label_affinity",
            }
            all_matches.append(match)

        if debug:
            with open(debug_dir / f"{pdf_path.stem}_page_{page_no:03d}_raw_candidates.json", "w", encoding="utf-8") as f:
                json.dump(candidates, f, ensure_ascii=False, indent=2, default=str)
            # Draw only likely candidate boxes to avoid unreadable overlay. Final overlay is drawn after dedupe.
            draw_mupdf_boxes(page, candidate_box_records[:300], debug_dir / f"{pdf_path.stem}_page_{page_no:03d}_candidate_boxes.png", dpi=180, width=2)

    matches = assign_unique_labels(dedupe_matches(all_matches), labels_by_page)
    # Round confidence after dedupe.
    for m in matches:
        m["confidence"] = round(float(m["confidence"]), 4)
        m["score"]["confidence"] = round(float(m["score"]["confidence"]), 4)

    result = {
        "target_pdf": pdf_path.name,
        "coordinate_system": {
            "space": "PDF user space",
            "origin": "bottom-left",
            "units": "points",
            "page_rotation_applied": False,
        },
        "page_reports": page_reports,
        "matches": matches,
        "rejected_count": len(all_rejected),
        "templates_loaded": [t.get("template_id") for t in templates],
    }
    if naip_root:
        airport = (airport_icao or infer_airport_icao(pdf_path) or "").upper() or None
        coordinate_index = NaipCoordinateIndex(naip_root=naip_root)
        gcps, coordinate_misses = build_ground_control_points(matches, coordinate_index, airport, page_reports)
        write_gcps(out_dir, gcps)
        georef = {
            "airport_icao": airport,
            "naip_root": str(naip_root),
            "gcp_count": len(gcps),
            "geometry": gcp_geometry_status(gcps),
            "coordinate_misses": coordinate_misses,
        }
        result["georeferencing"] = georef

    with open(out_dir / "results.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    with open(out_dir / "results.jsonl", "w", encoding="utf-8") as f:
        for m in matches:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")
    with open(out_dir / "rejected_candidates.json", "w", encoding="utf-8") as f:
        json.dump(all_rejected, f, ensure_ascii=False, indent=2)
    with open(out_dir / "summary.csv", "w", newline="", encoding="utf-8") as f:
        cols = [
            "page",
            "template_id",
            "source_template_id",
            "bbox_pdf",
            "center_pdf",
            "width",
            "height",
            "rotation_degrees",
            "scale",
            "confidence",
            "method",
            "candidate_path_id",
            "nearest_label_text",
            "nearest_label_context",
            "nearest_label_kind",
            "nearest_label_score",
            "point_identifier",
            "latitude",
            "longitude",
            "coordinate_source",
        ]
        writer = csv.DictWriter(f, fieldnames=cols)
        writer.writeheader()
        for m in matches:
            lab = m.get("nearest_label") or {}
            row = {k: m.get(k) for k in cols}
            row["bbox_pdf"] = json.dumps(m.get("bbox_pdf"))
            row["center_pdf"] = json.dumps(m.get("center_pdf"))
            row["nearest_label_text"] = lab.get("text")
            row["nearest_label_context"] = lab.get("context_text")
            row["nearest_label_kind"] = lab.get("kind")
            row["nearest_label_score"] = m.get("nearest_label_score")
            world = m.get("world_coordinate") or {}
            row["point_identifier"] = m.get("point_identifier")
            row["latitude"] = world.get("latitude")
            row["longitude"] = world.get("longitude")
            row["coordinate_source"] = world.get("source")
            writer.writerow(row)

    if debug:
        # Final overlay per page.
        by_page = {}
        for m in matches:
            by_page.setdefault(m["page"], []).append(m)
        for page_no, ms in by_page.items():
            page = doc[page_no - 1]
            boxes = []
            for m in ms:
                label = f"{m['template_id']} {m['confidence']:.2f}"
                lab = m.get("nearest_label") or {}
                if lab.get("text"):
                    label += f" {lab['text']}"
                    if lab.get("context_text") and lab.get("context_text") != lab.get("text"):
                        label += f" [{lab['context_text']}]"
                boxes.append({"bbox_mupdf": m["bbox_mupdf"], "label": label, "color": "red"})
            draw_mupdf_boxes(page, boxes, debug_dir / f"{pdf_path.stem}_page_{page_no:03d}_matches.png", dpi=240, width=4)
    return result
