from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import ril_package_backend as packages

_INSTALLED = False


def _finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _section_times_from_metadata(document: dict[str, Any]) -> list[float]:
    metadata = document.get("x") if isinstance(document.get("x"), dict) else {}
    points = metadata.get("timing_points") if isinstance(metadata, dict) else None
    if not isinstance(points, list):
        return []
    return [
        float(point.get("time_ms") or 0)
        for point in points
        if isinstance(point, dict)
        and bool(point.get("uninherited"))
        and float(point.get("beat_length") or 0) > 0
        and _finite(point.get("time_ms"))
    ]


def _document_needs_section_upgrade(document: dict[str, Any]) -> bool:
    rows = document.get("s") if isinstance(document.get("s"), list) else []
    return bool(rows) and any(isinstance(row, list) and len(row) < 6 for row in rows) and bool(_section_times_from_metadata(document))


def install_neutral_chart_polish() -> None:
    """Preserve explicit neutral section start times and upgrade older osu! charts lazily."""
    global _INSTALLED
    if _INSTALLED:
        return
    original_pack = packages.bundle_to_compact_chart
    original_expand = packages.compact_chart_to_bundle
    original_ensure = packages.ensure_ril_chart

    def pack(bundle: dict[str, Any]) -> dict[str, Any]:
        document = original_pack(bundle)
        sections = list(bundle.get("sections") or [])
        rows = document.get("s") if isinstance(document.get("s"), list) else []
        for index, row in enumerate(rows):
            if not isinstance(row, list) or index >= len(sections):
                continue
            start = sections[index].get("time_ms") if isinstance(sections[index], dict) else None
            if _finite(start):
                if len(row) >= 6:
                    row[5] = packages._compact_number(start)
                else:
                    row.append(packages._compact_number(start))
        return document

    def expand(document: dict[str, Any]) -> dict[str, Any]:
        bundle = original_expand(document)
        rows = document.get("s") if isinstance(document.get("s"), list) else []
        sections = list(bundle.get("sections") or [])
        metadata_times = _section_times_from_metadata(document)
        for index, section in enumerate(sections):
            explicit = rows[index][5] if index < len(rows) and isinstance(rows[index], list) and len(rows[index]) >= 6 else None
            if _finite(explicit):
                section["time_ms"] = float(explicit)
            elif index < len(metadata_times):
                section["time_ms"] = metadata_times[index]
        return bundle

    def ensure(song_folder: Path, bundle: dict[str, Any] | None = None) -> dict[str, Any] | None:
        chart_path = song_folder / "chart" / "ril_chart.json"
        if bundle is not None and any(_finite(row.get("time_ms")) for row in bundle.get("sections") or [] if isinstance(row, dict)):
            document = pack(bundle)
            chart_path.parent.mkdir(parents=True, exist_ok=True)
            chart_path.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            return document
        document = original_ensure(song_folder, bundle)
        if not document or not _document_needs_section_upgrade(document):
            return document
        upgraded_bundle = expand(document)
        upgraded = pack(upgraded_bundle)
        chart_path.parent.mkdir(parents=True, exist_ok=True)
        chart_path.write_text(json.dumps(upgraded, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        return upgraded

    packages.bundle_to_compact_chart = pack
    packages.compact_chart_to_bundle = expand
    packages.ensure_ril_chart = ensure
    packages._neutral_chart_polish_installed = True
    _INSTALLED = True
