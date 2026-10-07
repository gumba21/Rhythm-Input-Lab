from __future__ import annotations

from collections import Counter
from typing import Any

import fnf_importer

_INSTALLED = False
_ORIGINAL_WRITE = fnf_importer.write_chart_bundle


def complete_bundle_summary(bundle: dict[str, Any]) -> dict[str, Any]:
    """Fill the shared summary fields expected by legacy chart tools.

    Import adapters are allowed to expose richer source-specific summaries, but
    every normalized bundle must still be safe to pass through the original
    chart writer and Song Explorer.
    """
    summary = bundle.setdefault("summary", {})
    notes = [row for row in (bundle.get("notes") or []) if isinstance(row, dict)]
    events = [row for row in (bundle.get("events") or []) if isinstance(row, dict)]
    sections = [row for row in (bundle.get("sections") or []) if isinstance(row, dict)]

    player_notes = [row for row in notes if str(row.get("owner") or "player") == "player"]
    opponent_notes = [row for row in notes if str(row.get("owner") or "player") == "opponent"]
    event_notes = [row for row in notes if str(row.get("owner") or "player") == "event"]
    note_counts = Counter(str(row.get("note_type") or "(normal)") for row in notes)
    event_counts = Counter(str(row.get("name") or "Unknown Event") for row in events)
    event_stacks = Counter(round(float(row.get("time_ms") or 0.0), 6) for row in events)

    duration_candidates = [float(summary.get("duration_ms") or 0.0)]
    duration_candidates.extend(float(row.get("end_ms") or row.get("time_ms") or 0.0) for row in notes)
    duration_candidates.extend(float(row.get("time_ms") or 0.0) for row in events)

    summary.setdefault("format", str(summary.get("source_format") or "ril_neutral"))
    summary.setdefault("source_format", str(summary.get("format") or "unknown"))
    summary.setdefault("importer_version", "adapter")
    summary.setdefault("total_notes", len(notes))
    summary.setdefault("player_notes", len(player_notes))
    summary.setdefault("opponent_notes", len(opponent_notes))
    summary.setdefault("event_notes", len(event_notes))
    summary.setdefault("sustain_notes", sum(float(row.get("sustain_ms") or 0.0) > 0 for row in notes))
    summary.setdefault("event_count", len(events))
    summary.setdefault("unique_event_types", len(event_counts))
    summary.setdefault("unique_note_types", len(note_counts))
    summary.setdefault("event_type_counts", dict(event_counts))
    summary.setdefault("note_type_counts", dict(note_counts))
    summary.setdefault("max_events_same_timestamp", max(event_stacks.values(), default=0))
    summary.setdefault("duration_ms", max(duration_candidates, default=0.0))
    summary.setdefault("section_count", len(sections))
    summary.setdefault("bpm_changes", [row for row in sections if row.get("change_bpm")])
    summary.setdefault("dynamic_bpm", bool(summary.get("bpm_changes")))
    summary.setdefault("dodge_event_markers", 0)
    summary.setdefault("authored_hazard_notes", sum(
        count
        for name, count in note_counts.items()
        if (bundle.get("mappings") or {}).get("note_types", {}).get("" if name == "(normal)" else name, {}).get("should_press") is False
    ))
    return bundle


def install_bundle_compat() -> None:
    global _INSTALLED
    if _INSTALLED:
        return

    def write_chart_bundle(bundle: dict[str, Any], chart_folder: Any, original_path: Any) -> dict[str, Any]:
        return _ORIGINAL_WRITE(complete_bundle_summary(bundle), chart_folder, original_path)

    fnf_importer.write_chart_bundle = write_chart_bundle
    _INSTALLED = True
