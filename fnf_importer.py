from __future__ import annotations

import bisect
import html
import json
import math
import re
import shutil
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

IMPORTER_VERSION = "1.0"
SUPPORTED_KEY_COUNTS = tuple(range(4, 10))

DEFAULT_EVENT_MAPPINGS = {
    "kb_attackprepare": {"category": "dodge_warning", "gameplay": True, "expected_presses": 0},
    "kb_alert": {"category": "dodge_warning", "gameplay": True, "expected_presses": 0},
    "kb_attackfire": {"category": "dodge", "gameplay": True, "expected_presses": 1},
    "kb_pincer": {"category": "lane_transform", "gameplay": True, "expected_presses": 0},
    "screen shake": {"category": "visual", "gameplay": True, "expected_presses": 0},
    "change scroll speed": {"category": "scroll_speed", "gameplay": True, "expected_presses": 0},
    "set gf speed": {"category": "animation", "gameplay": False, "expected_presses": 0},
    "streettv state": {"category": "visual", "gameplay": False, "expected_presses": 0},
    "streetbg state": {"category": "visual", "gameplay": False, "expected_presses": 0},
    "terminationintro": {"category": "presentation", "gameplay": False, "expected_presses": 0},
    "terminationoutro": {"category": "presentation", "gameplay": False, "expected_presses": 0},
    "change character optional": {"category": "character", "gameplay": False, "expected_presses": 0},
    "change character": {"category": "character", "gameplay": False, "expected_presses": 0},
    "gfscared": {"category": "animation", "gameplay": False, "expected_presses": 0},
}

DEFAULT_NOTE_TYPE_MAPPINGS = {
    "": {"category": "normal", "gameplay": True, "should_press": True},
    "normal": {"category": "normal", "gameplay": True, "should_press": True},
    "no animation": {"category": "normal", "gameplay": True, "should_press": True},
    "hurt note": {"category": "hazard", "gameplay": True, "should_press": False},
    "hurt": {"category": "hazard", "gameplay": True, "should_press": False},
    "mine": {"category": "hazard", "gameplay": True, "should_press": False},
    "death note": {"category": "hazard", "gameplay": True, "should_press": False},
}


def _slug(text: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", str(text).casefold()).strip("-")
    return value or "unknown"


def _safe_name(text: str, fallback: str = "Untitled Song") -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(text).strip())
    value = re.sub(r"\s+", " ", value).strip(" .") or fallback
    return value[:120]


def _mean(values: Sequence[float]) -> Optional[float]:
    return statistics.fmean(values) if values else None


def _median(values: Sequence[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def _pstdev(values: Sequence[float]) -> Optional[float]:
    return statistics.pstdev(values) if len(values) > 1 else None


def _percentile(values: Sequence[float], p: float) -> Optional[float]:
    if not values:
        return None
    values = sorted(values)
    pos = (len(values) - 1) * p
    lo, hi = math.floor(pos), math.ceil(pos)
    if lo == hi:
        return values[lo]
    return values[lo] * (hi - pos) + values[hi] * (pos - lo)


def _fmt_num(value: Optional[float], digits: int = 1, suffix: str = "") -> str:
    return "—" if value is None else f"{value:.{digits}f}{suffix}"


def _fmt_time(ms: Optional[float]) -> str:
    if ms is None:
        return "—"
    seconds = max(0.0, ms / 1000.0)
    return f"{int(seconds // 60)}:{seconds % 60:05.2f}"


def _unwrap_song(data: Any) -> tuple[dict, dict]:
    if not isinstance(data, dict):
        raise ValueError("The chart JSON root must be an object.")
    song = data.get("song")
    if isinstance(song, dict):
        return data, song
    if isinstance(data.get("notes"), list) or isinstance(data.get("events"), list):
        return {"song": data}, data
    raise ValueError("This does not look like a legacy/Psych-style FNF song JSON.")


def _infer_key_count(song: dict) -> int:
    explicit_fields = ("keyCount", "key_count", "keys", "laneCount", "lane_count")
    for field in explicit_fields:
        raw = song.get(field)
        if isinstance(raw, (int, float)) and int(raw) in SUPPORTED_KEY_COUNTS:
            return int(raw)

    raw_lanes: list[int] = []
    for section in song.get("notes", []) or []:
        if not isinstance(section, dict):
            continue
        for note in section.get("sectionNotes", []) or []:
            try:
                lane = int(note[1])
            except Exception:
                continue
            if lane >= 0:
                raw_lanes.append(lane)

    if not raw_lanes:
        return 4
    maximum = max(raw_lanes)
    if maximum <= 7:
        return 4
    inferred = math.ceil((maximum + 1) / 2)
    return min(9, max(4, inferred))


def _normalize_note_type(raw_type: Any) -> str:
    if raw_type is None:
        return ""
    if isinstance(raw_type, bool):
        return ""
    return str(raw_type).strip()


def _default_note_mapping(note_type: str) -> dict:
    key = note_type.casefold().strip()
    if key in DEFAULT_NOTE_TYPE_MAPPINGS:
        return dict(DEFAULT_NOTE_TYPE_MAPPINGS[key])
    if any(token in key for token in ("hurt", "mine", "death", "poison", "damage")):
        return {"category": "hazard", "gameplay": True, "should_press": False}
    return {"category": "custom", "gameplay": True, "should_press": True}


def _default_event_mapping(name: str) -> dict:
    key = name.casefold().strip()
    if key in DEFAULT_EVENT_MAPPINGS:
        return dict(DEFAULT_EVENT_MAPPINGS[key])
    if "attackfire" in key or "sawblade" in key or "dodge" in key:
        return {"category": "dodge", "gameplay": True, "expected_presses": 1}
    if "alert" in key or "warning" in key or "prepare" in key:
        return {"category": "warning", "gameplay": True, "expected_presses": 0}
    if "shake" in key or "flash" in key or "camera" in key or "zoom" in key:
        return {"category": "visual", "gameplay": True, "expected_presses": 0}
    if "scroll" in key or "speed" in key:
        return {"category": "scroll_speed", "gameplay": True, "expected_presses": 0}
    if "lane" in key or "pincer" in key or "swap" in key:
        return {"category": "lane_transform", "gameplay": True, "expected_presses": 0}
    return {"category": "unmapped", "gameplay": False, "expected_presses": 0}


def _section_bpm_rows(song: dict) -> list[dict]:
    base_bpm = float(song.get("bpm") or 0.0)
    current_bpm = base_bpm
    rows = []
    for index, section in enumerate(song.get("notes", []) or []):
        if not isinstance(section, dict):
            continue
        changed = bool(section.get("changeBPM"))
        candidate = section.get("bpm")
        if changed and isinstance(candidate, (int, float)) and float(candidate) > 0:
            current_bpm = float(candidate)
        rows.append({
            "section_index": index,
            "bpm": current_bpm,
            "change_bpm": changed,
            "must_hit_section": bool(section.get("mustHitSection")),
            "length_in_steps": int(section.get("lengthInSteps") or 16),
        })
    return rows



def _peak_nps_from_times(times: Sequence[float], window_ms: float) -> float:
    if not times:
        return 0.0
    ordered = sorted(float(value) for value in times)
    left = 0
    best = 0
    for right, current in enumerate(ordered):
        while current - ordered[left] >= window_ms:
            left += 1
        best = max(best, right - left + 1)
    return best / (window_ms / 1000.0)


def _authored_chart_patterns(player_notes: Sequence[dict]) -> dict:
    lane_counts = Counter(int(note["lane"]) for note in player_notes if note.get("lane") is not None)
    groups: dict[int, list[dict]] = defaultdict(list)
    for note in player_notes:
        groups[int(round(float(note["time_ms"])))] .append(note)
    chord_sizes = [len(group) for group in groups.values() if len({n.get("lane") for n in group}) >= 2]

    jack_pairs = 0
    by_lane: dict[int, list[float]] = defaultdict(list)
    for note in player_notes:
        if note.get("lane") is not None:
            by_lane[int(note["lane"])].append(float(note["time_ms"]))
    for lane_times in by_lane.values():
        lane_times.sort()
        jack_pairs += sum(1 for i in range(1, len(lane_times)) if lane_times[i] - lane_times[i-1] <= 250.0)

    times = [float(note["time_ms"]) for note in player_notes]
    return {
        "lane_counts": {str(k): v for k, v in sorted(lane_counts.items())},
        "chord_groups": len(chord_sizes),
        "largest_chord": max(chord_sizes, default=1),
        "jack_pairs_250ms": jack_pairs,
        "peak_1s_nps": _peak_nps_from_times(times, 1000.0),
        "peak_2s_nps": _peak_nps_from_times(times, 2000.0),
        "peak_5s_nps": _peak_nps_from_times(times, 5000.0),
    }

def normalize_fnf_chart(data: dict, source_name: str, key_count_override: Optional[int] = None) -> dict:
    root, song = _unwrap_song(data)
    key_count = key_count_override or _infer_key_count(song)
    if key_count not in SUPPORTED_KEY_COUNTS:
        raise ValueError("Only 4K through 9K charts are supported by Rhythm Input Lab.")

    notes: list[dict] = []
    bpm_rows = _section_bpm_rows(song)
    current_bpm = float(song.get("bpm") or 0.0)
    note_type_counts: Counter[str] = Counter()
    raw_lane_counts: Counter[int] = Counter()

    for section_index, section in enumerate(song.get("notes", []) or []):
        if not isinstance(section, dict):
            continue
        if section.get("changeBPM") and isinstance(section.get("bpm"), (int, float)):
            current_bpm = float(section["bpm"])
        must_hit = bool(section.get("mustHitSection"))
        for raw_note in section.get("sectionNotes", []) or []:
            if not isinstance(raw_note, (list, tuple)) or len(raw_note) < 3:
                continue
            try:
                time_ms = float(raw_note[0])
                raw_lane = int(raw_note[1])
                sustain_ms = max(0.0, float(raw_note[2] or 0.0))
            except Exception:
                continue

            note_type = _normalize_note_type(raw_note[3] if len(raw_note) > 3 else "")
            extra = list(raw_note[4:]) if len(raw_note) > 4 else []

            if raw_lane < 0:
                owner = "event"
                lane = None
            else:
                lane = raw_lane % key_count
                opposite_half = raw_lane >= key_count
                must_press = must_hit != opposite_half
                owner = "player" if must_press else "opponent"
                raw_lane_counts[raw_lane] += 1

            note_type_counts[note_type or "(normal)"] += 1
            notes.append({
                "time_ms": time_ms,
                "end_ms": time_ms + sustain_ms,
                "lane": lane,
                "raw_lane": raw_lane,
                "sustain_ms": sustain_ms,
                "owner": owner,
                "section_index": section_index,
                "must_hit_section": must_hit,
                "bpm": current_bpm,
                "note_type": note_type,
                "extra_data": extra,
                "raw": list(raw_note),
            })

    notes.sort(key=lambda item: (item["time_ms"], item["raw_lane"]))

    events: list[dict] = []
    event_sources: list[tuple[str, Any]] = []
    if isinstance(song.get("events"), list):
        event_sources.append(("song.events", song.get("events")))
    if isinstance(root.get("events"), list) and root.get("events") is not song.get("events"):
        event_sources.append(("root.events", root.get("events")))

    for source, groups in event_sources:
        for group_index, group in enumerate(groups or []):
            if not isinstance(group, (list, tuple)) or len(group) < 2:
                continue
            try:
                time_ms = float(group[0])
            except Exception:
                continue
            payloads = group[1]
            if not isinstance(payloads, list):
                payloads = [payloads]
            for event_index, payload in enumerate(payloads):
                if isinstance(payload, dict):
                    name = str(payload.get("name") or payload.get("event") or "Unknown Event")
                    value1 = payload.get("value1", payload.get("v1", ""))
                    value2 = payload.get("value2", payload.get("v2", ""))
                    raw_payload = payload
                elif isinstance(payload, (list, tuple)):
                    name = str(payload[0]) if payload else "Unknown Event"
                    value1 = payload[1] if len(payload) > 1 else ""
                    value2 = payload[2] if len(payload) > 2 else ""
                    raw_payload = list(payload)
                else:
                    name = str(payload)
                    value1 = value2 = ""
                    raw_payload = payload
                events.append({
                    "time_ms": time_ms,
                    "name": name,
                    "value1": value1,
                    "value2": value2,
                    "source": source,
                    "group_index": group_index,
                    "event_index": event_index,
                    "raw": raw_payload,
                })

    events.sort(key=lambda item: (item["time_ms"], item["name"]))
    event_type_counts = Counter(event["name"] for event in events)

    player_notes = [n for n in notes if n["owner"] == "player"]
    opponent_notes = [n for n in notes if n["owner"] == "opponent"]
    event_notes = [n for n in notes if n["owner"] == "event"]
    sustains = [n for n in notes if n["sustain_ms"] > 0]

    duration_candidates = [0.0]
    duration_candidates.extend(n["end_ms"] for n in notes)
    duration_candidates.extend(e["time_ms"] for e in events)
    player_patterns = _authored_chart_patterns(player_notes)
    event_stack_counts = Counter(round(float(event["time_ms"]), 6) for event in events)

    song_name = str(song.get("song") or root.get("songName") or Path(source_name).stem)
    summary = {
        "format": "fnf_legacy_psych",
        "importer_version": IMPORTER_VERSION,
        "source_name": source_name,
        "song_name": song_name,
        "song_id": _slug(song_name),
        "key_count": key_count,
        "base_bpm": float(song.get("bpm") or 0.0),
        "scroll_speed": song.get("speed"),
        "stage": song.get("stage"),
        "player1": song.get("player1"),
        "player2": song.get("player2"),
        "player3": song.get("player3") or song.get("gfVersion"),
        "needs_voices": song.get("needsVoices"),
        "dodge_enabled": song.get("dodgeEnabled"),
        "section_count": len(song.get("notes", []) or []),
        "total_notes": len(notes),
        "player_notes": len(player_notes),
        "opponent_notes": len(opponent_notes),
        "event_notes": len(event_notes),
        "sustain_notes": len(sustains),
        "event_count": len(events),
        "unique_event_types": len(event_type_counts),
        "unique_note_types": len(note_type_counts),
        "duration_ms": max(duration_candidates),
        "player_lane_counts": player_patterns["lane_counts"],
        "player_chord_groups": player_patterns["chord_groups"],
        "largest_player_chord": player_patterns["largest_chord"],
        "player_jack_pairs_250ms": player_patterns["jack_pairs_250ms"],
        "player_peak_1s_nps": player_patterns["peak_1s_nps"],
        "player_peak_2s_nps": player_patterns["peak_2s_nps"],
        "player_peak_5s_nps": player_patterns["peak_5s_nps"],
        "max_events_same_timestamp": max(event_stack_counts.values(), default=0),
        "dynamic_bpm": any(row["change_bpm"] for row in bpm_rows),
        "bpm_changes": [row for row in bpm_rows if row["change_bpm"]],
        "raw_lane_counts": {str(k): v for k, v in sorted(raw_lane_counts.items())},
        "note_type_counts": dict(note_type_counts),
        "event_type_counts": dict(event_type_counts),
    }

    mappings = {
        "event_types": {
            name: _default_event_mapping(name)
            for name in sorted(event_type_counts, key=str.casefold)
        },
        "note_types": {
            ("" if name == "(normal)" else name): _default_note_mapping("" if name == "(normal)" else name)
            for name in sorted(note_type_counts, key=str.casefold)
        },
        "notes": [
            "Mappings are editable JSON and are never silently discarded.",
            "expected_presses is used only for event-aligned input estimates.",
            "should_press=false marks note types such as hurt notes or mines.",
        ],
    }

    summary["dodge_event_markers"] = sum(
        count for name, count in event_type_counts.items()
        if mappings["event_types"].get(name, {}).get("category") == "dodge"
    )
    summary["authored_hazard_notes"] = sum(
        count for name, count in note_type_counts.items()
        if mappings["note_types"].get("" if name == "(normal)" else name, {}).get("should_press") is False
    )

    return {
        "summary": summary,
        "notes": notes,
        "events": events,
        "sections": bpm_rows,
        "mappings": mappings,
        "song_metadata": {
            key: value for key, value in song.items()
            if key not in {"notes", "events"}
        },
    }



def merge_event_bundle(bundle: dict, extra_bundle: dict, source_label: str = "additional events") -> dict:
    combined = list(bundle.get("events", []))
    seen = {
        (
            round(float(event.get("time_ms", 0.0)), 6),
            str(event.get("name", "")),
            json.dumps(event.get("value1", ""), sort_keys=True, default=str),
            json.dumps(event.get("value2", ""), sort_keys=True, default=str),
        )
        for event in combined
    }
    added = 0
    for event in extra_bundle.get("events", []):
        identity = (
            round(float(event.get("time_ms", 0.0)), 6),
            str(event.get("name", "")),
            json.dumps(event.get("value1", ""), sort_keys=True, default=str),
            json.dumps(event.get("value2", ""), sort_keys=True, default=str),
        )
        if identity in seen:
            continue
        copied = dict(event)
        copied["source"] = f"{source_label}:{event.get('source', 'events')}"
        combined.append(copied)
        seen.add(identity)
        added += 1
    combined.sort(key=lambda item: (float(item.get("time_ms", 0.0)), str(item.get("name", ""))))
    bundle["events"] = combined

    counts = Counter(event.get("name", "Unknown Event") for event in combined)
    stack_counts = Counter(round(float(event.get("time_ms", 0.0)), 6) for event in combined)
    summary = bundle["summary"]
    summary["event_count"] = len(combined)
    summary["unique_event_types"] = len(counts)
    summary["event_type_counts"] = dict(counts)
    summary["max_events_same_timestamp"] = max(stack_counts.values(), default=0)
    summary["additional_events_added"] = summary.get("additional_events_added", 0) + added

    mappings = bundle.setdefault("mappings", {}).setdefault("event_types", {})
    for name in counts:
        mappings.setdefault(name, _default_event_mapping(name))
    summary["dodge_event_markers"] = sum(
        count for name, count in counts.items()
        if mappings.get(name, {}).get("category") == "dodge"
    )
    return bundle

def _chart_density_series(notes: Sequence[dict], duration_ms: float, window_ms: float = 1000.0, step_ms: float = 250.0) -> list[dict]:
    player = sorted(float(n["time_ms"]) for n in notes if n.get("owner") == "player" and n.get("lane") is not None)
    if not player:
        return []
    out = []
    left = right = 0
    center = 0.0
    while center <= duration_ms:
        low, high = center - window_ms / 2, center + window_ms / 2
        while left < len(player) and player[left] < low:
            left += 1
        right = max(right, left)
        while right < len(player) and player[right] < high:
            right += 1
        out.append({"time_ms": center, "nps": (right - left) / (window_ms / 1000.0)})
        center += step_ms
    return out


def _svg_line(points: Sequence[dict], width: int = 1000, height: int = 280) -> str:
    if not points:
        return '<p class="muted">No density data.</p>'
    xs = [float(p["time_ms"]) for p in points]
    ys = [float(p["nps"]) for p in points]
    min_x, max_x = min(xs), max(xs)
    max_y = max(max(ys), 1.0)
    left, right, top, bottom = 52, 18, 18, 38
    iw, ih = width - left - right, height - top - bottom

    def xp(x: float) -> float:
        return left if max_x == min_x else left + (x - min_x) / (max_x - min_x) * iw

    def yp(y: float) -> float:
        return top + ih - y / max_y * ih

    parts = []
    for i in range(5):
        value = max_y * i / 4
        y = yp(value)
        parts.append(f'<line x1="{left}" y1="{y:.1f}" x2="{width-right}" y2="{y:.1f}" class="grid"/>')
        parts.append(f'<text x="{left-8}" y="{y+4:.1f}" text-anchor="end" class="axis">{value:.1f}</text>')
    for i in range(5):
        value = min_x + (max_x - min_x) * i / 4
        x = xp(value)
        parts.append(f'<text x="{x:.1f}" y="{height-10}" text-anchor="middle" class="axis">{html.escape(_fmt_time(value))}</text>')
    poly = " ".join(f"{xp(x):.1f},{yp(y):.1f}" for x, y in zip(xs, ys))
    parts.append(f'<polyline points="{poly}" class="line"/>')
    return f'<svg class="chart" viewBox="0 0 {width} {height}">{"".join(parts)}</svg>'


def render_song_explorer(bundle: dict, path: Path) -> None:
    summary = bundle["summary"]
    events = bundle["events"]
    mappings = bundle["mappings"]
    density = _chart_density_series(bundle["notes"], float(summary["duration_ms"]))

    def card(label: str, value: str, note: str = "") -> str:
        extra = f'<div class="note">{html.escape(note)}</div>' if note else ""
        return f'<div class="card"><div class="label">{html.escape(label)}</div><div class="big">{html.escape(value)}</div>{extra}</div>'

    overview = "".join([
        card("Player notes", f'{summary["player_notes"]:,}'),
        card("Opponent notes", f'{summary["opponent_notes"]:,}'),
        card("Sustains", f'{summary["sustain_notes"]:,}'),
        card("Events", f'{summary["event_count"]:,}'),
        card("Key mode", f'{summary["key_count"]}K'),
        card("Duration", _fmt_time(summary["duration_ms"])),
        card("Base BPM", _fmt_num(summary["base_bpm"], 1)),
        card("Scroll speed", str(summary.get("scroll_speed") or "—")),
        card("Authored peak 1s", _fmt_num(summary.get("player_peak_1s_nps"), 1, " NPS")),
        card("Chord groups", f'{summary.get("player_chord_groups", 0):,}', f'max {summary.get("largest_player_chord", 1)} keys'),
        card("Dodge markers", f'{summary.get("dodge_event_markers", 0):,}'),
        card("Max event stack", f'{summary.get("max_events_same_timestamp", 0):,}'),
    ])

    event_rows = []
    for name, count in sorted(summary["event_type_counts"].items(), key=lambda kv: (-kv[1], kv[0].casefold())):
        mapping = mappings["event_types"].get(name, {})
        event_rows.append(
            f'<tr><td>{html.escape(name)}</td><td>{count}</td><td>{html.escape(str(mapping.get("category", "unmapped")))}</td>'
            f'<td>{"yes" if mapping.get("gameplay") else "no"}</td><td>{mapping.get("expected_presses", 0)}</td></tr>'
        )

    note_rows = []
    for name, count in sorted(summary["note_type_counts"].items(), key=lambda kv: (-kv[1], kv[0].casefold())):
        lookup = "" if name == "(normal)" else name
        mapping = mappings["note_types"].get(lookup, {})
        note_rows.append(
            f'<tr><td>{html.escape(name)}</td><td>{count}</td><td>{html.escape(str(mapping.get("category", "custom")))}</td>'
            f'<td>{"yes" if mapping.get("should_press", True) else "no"}</td></tr>'
        )

    event_timeline_rows = []
    for event in events[:500]:
        mapping = mappings["event_types"].get(event["name"], {})
        event_timeline_rows.append(
            f'<tr><td>{_fmt_time(event["time_ms"])}</td><td>{html.escape(event["name"])}</td>'
            f'<td>{html.escape(str(event.get("value1", "")))}</td><td>{html.escape(str(event.get("value2", "")))}</td>'
            f'<td>{html.escape(str(mapping.get("category", "unmapped")))}</td></tr>'
        )

    bpm_rows = []
    for row in summary.get("bpm_changes", [])[:200]:
        bpm_rows.append(f'<tr><td>{row["section_index"]}</td><td>{_fmt_num(row["bpm"], 2)}</td></tr>')

    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(summary["song_name"])} — Song Explorer</title><style>
:root{{color-scheme:light dark;font-family:Inter,system-ui,sans-serif;background:Canvas;color:CanvasText}}*{{box-sizing:border-box}}body{{margin:0;background:Canvas;color:CanvasText;line-height:1.45}}main{{width:min(1180px,calc(100% - 32px));margin:auto;padding:38px 0 70px}}h1{{font-size:clamp(2.2rem,6vw,4.5rem);line-height:1;letter-spacing:-.05em;margin:4px 0 8px}}h2{{margin:0 0 14px}}.eyebrow{{font-size:.82rem;text-transform:uppercase;letter-spacing:.11em;font-weight:750;opacity:.62}}.muted{{opacity:.62}}.section{{margin-top:18px;border:1px solid color-mix(in srgb,CanvasText 17%,transparent);border-radius:18px;padding:20px;background:color-mix(in srgb,CanvasText 3%,Canvas)}}.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}}.card{{min-height:108px;border:1px solid color-mix(in srgb,CanvasText 14%,transparent);border-radius:14px;padding:15px}}.label{{font-size:.8rem;opacity:.62;font-weight:700}}.big{{font-size:1.7rem;font-weight:780;letter-spacing:-.04em;margin-top:7px}}.note{{font-size:.75rem;opacity:.56;margin-top:4px}}.chart{{width:100%;height:auto;display:block}}.grid{{stroke:currentColor;opacity:.1}}.line{{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}}.axis{{fill:currentColor;opacity:.6;font-family:inherit;font-size:12px}}.tablewrap{{overflow:auto;max-height:620px}}table{{width:100%;border-collapse:collapse;font-size:.9rem}}th,td{{padding:10px 12px;border-bottom:1px solid color-mix(in srgb,CanvasText 12%,transparent);white-space:nowrap;text-align:right}}th:first-child,td:first-child{{text-align:left}}th{{font-size:.74rem;text-transform:uppercase;letter-spacing:.055em;opacity:.62;position:sticky;top:0;background:Canvas}}code{{font-family:ui-monospace,Consolas,monospace}}footer{{margin-top:24px;opacity:.55;font-size:.8rem}}</style></head><body><main>
<div class="eyebrow">Rhythm Input Lab 3.5 · FNF Song Explorer</div><h1>{html.escape(summary["song_name"])}</h1><p class="muted">{html.escape(summary["format"])} · {summary["key_count"]}K · {html.escape(str(summary.get("stage") or "unknown stage"))}</p>
<section class="section"><h2>Import overview</h2><div class="cards">{overview}</div></section>
<section class="section"><h2>Authored player-note density</h2>{_svg_line(density)}</section>
<section class="section"><h2>Event types</h2><div class="tablewrap"><table><thead><tr><th>Event</th><th>Count</th><th>Category</th><th>Gameplay</th><th>Expected presses</th></tr></thead><tbody>{''.join(event_rows)}</tbody></table></div></section>
<section class="section"><h2>Note types</h2><div class="tablewrap"><table><thead><tr><th>Type</th><th>Count</th><th>Category</th><th>Should press</th></tr></thead><tbody>{''.join(note_rows)}</tbody></table></div></section>
<section class="section"><h2>Event timeline</h2><p class="muted">Showing the first {min(500, len(events))} of {len(events)} imported events.</p><div class="tablewrap"><table><thead><tr><th>Time</th><th>Name</th><th>Value 1</th><th>Value 2</th><th>Category</th></tr></thead><tbody>{''.join(event_timeline_rows)}</tbody></table></div></section>
<section class="section"><h2>BPM changes</h2>{'<div class="tablewrap"><table><thead><tr><th>Section</th><th>BPM</th></tr></thead><tbody>'+''.join(bpm_rows)+'</tbody></table></div>' if bpm_rows else '<p class="muted">No explicit section BPM changes were found.</p>'}</section>
<footer>Original JSON is preserved beside the normalized files. Unknown note types and events remain visible and editable in <code>mappings.json</code>.</footer>
</main></body></html>'''
    path.write_text(page, encoding="utf-8")


def write_chart_bundle(bundle: dict, chart_folder: Path, original_path: Path) -> dict:
    chart_folder.mkdir(parents=True, exist_ok=True)
    original_name = "original" + (original_path.suffix.lower() or ".json")
    shutil.copy2(original_path, chart_folder / original_name)
    (chart_folder / "normalized_notes.json").write_text(json.dumps(bundle["notes"], indent=2), encoding="utf-8")
    (chart_folder / "normalized_events.json").write_text(json.dumps(bundle["events"], indent=2), encoding="utf-8")
    (chart_folder / "normalized_sections.json").write_text(json.dumps(bundle["sections"], indent=2), encoding="utf-8")
    (chart_folder / "import_summary.json").write_text(json.dumps(bundle["summary"], indent=2), encoding="utf-8")
    (chart_folder / "song_metadata.json").write_text(json.dumps(bundle["song_metadata"], indent=2), encoding="utf-8")

    mappings_path = chart_folder / "mappings.json"
    if mappings_path.exists():
        try:
            current = json.loads(mappings_path.read_text(encoding="utf-8"))
        except Exception:
            current = {}
        event_types = current.setdefault("event_types", {})
        for name, mapping in bundle["mappings"]["event_types"].items():
            event_types.setdefault(name, mapping)
        note_types = current.setdefault("note_types", {})
        for name, mapping in bundle["mappings"]["note_types"].items():
            note_types.setdefault(name, mapping)
        current.setdefault("notes", bundle["mappings"]["notes"])
        mappings = current
    else:
        mappings = bundle["mappings"]
    mappings_path.write_text(json.dumps(mappings, indent=2), encoding="utf-8")
    bundle["mappings"] = mappings

    combined = {
        "summary": bundle["summary"],
        "notes_file": "normalized_notes.json",
        "events_file": "normalized_events.json",
        "sections_file": "normalized_sections.json",
        "mappings_file": "mappings.json",
        "original_file": original_name,
    }
    (chart_folder / "chart_manifest.json").write_text(json.dumps(combined, indent=2), encoding="utf-8")
    render_song_explorer(bundle, chart_folder / "song_explorer.html")
    return bundle["summary"]


def import_fnf_chart(path: Path, song_folder: Path, key_count_override: Optional[int] = None) -> dict:
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    bundle = normalize_fnf_chart(data, path.name, key_count_override=key_count_override)
    write_chart_bundle(bundle, song_folder / "chart", path)
    return bundle


def load_chart_bundle(song_folder: Path) -> Optional[dict]:
    chart_folder = Path(song_folder) / "chart"
    summary_path = chart_folder / "import_summary.json"
    notes_path = chart_folder / "normalized_notes.json"
    events_path = chart_folder / "normalized_events.json"
    sections_path = chart_folder / "normalized_sections.json"
    mappings_path = chart_folder / "mappings.json"
    if not (summary_path.exists() and notes_path.exists() and events_path.exists() and mappings_path.exists()):
        return None
    try:
        return {
            "summary": json.loads(summary_path.read_text(encoding="utf-8")),
            "notes": json.loads(notes_path.read_text(encoding="utf-8")),
            "events": json.loads(events_path.read_text(encoding="utf-8")),
            "sections": json.loads(sections_path.read_text(encoding="utf-8")) if sections_path.exists() else [],
            "mappings": json.loads(mappings_path.read_text(encoding="utf-8")),
        }
    except Exception:
        return None


def _nearest_unused(times: Sequence[float], target: float, used: set[int], window: float) -> Optional[int]:
    index = bisect.bisect_left(times, target)
    best: Optional[int] = None
    best_distance = window + 1
    radius = 0
    while True:
        candidates = []
        left = index - radius - 1
        right = index + radius
        if left >= 0:
            candidates.append(left)
        if right < len(times):
            candidates.append(right)
        if not candidates:
            break
        progressed = False
        for candidate in candidates:
            distance = abs(times[candidate] - target)
            if distance <= window:
                progressed = True
                if candidate not in used and distance < best_distance:
                    best = candidate
                    best_distance = distance
        if not progressed and radius > 2:
            break
        radius += 1
        if radius > 20:
            break
    return best


def _match_notes(
    chart_notes: Sequence[dict],
    lane_presses: Sequence[dict],
    lane_keys: Sequence[str],
    offset_ms: float,
    hit_window_ms: float,
) -> dict:
    press_by_lane: dict[int, list[dict]] = defaultdict(list)
    key_to_lane = {str(key).casefold(): index for index, key in enumerate(lane_keys)}
    for press in lane_presses:
        lane = key_to_lane.get(str(press.get("key", "")).casefold())
        if lane is not None:
            press_by_lane[lane].append(press)
    for lane in press_by_lane:
        press_by_lane[lane].sort(key=lambda item: float(item["time_ms"]))

    note_mapping_cache: dict[str, bool] = {}
    matched = []
    unmatched_notes = []
    used_by_lane: dict[int, set[int]] = defaultdict(set)

    for note in sorted(chart_notes, key=lambda item: float(item["time_ms"])):
        lane = note.get("lane")
        if lane is None or not isinstance(lane, int) or lane >= len(lane_keys):
            continue
        expected = float(note["time_ms"]) + offset_ms
        presses = press_by_lane.get(lane, [])
        times = [float(item["time_ms"]) for item in presses]
        chosen = _nearest_unused(times, expected, used_by_lane[lane], hit_window_ms)
        if chosen is None:
            unmatched_notes.append(note)
            continue
        used_by_lane[lane].add(chosen)
        press = presses[chosen]
        matched.append({
            "note": note,
            "press": press,
            "expected_time_ms": expected,
            "offset_ms": float(press["time_ms"]) - expected,
            "absolute_offset_ms": abs(float(press["time_ms"]) - expected),
        })

    extras = []
    for lane, presses in press_by_lane.items():
        used = used_by_lane[lane]
        extras.extend(press for index, press in enumerate(presses) if index not in used)
    extras.sort(key=lambda item: float(item["time_ms"]))
    return {"matched": matched, "unmatched_notes": unmatched_notes, "extra_presses": extras}



def _match_notes_optimal(
    chart_notes: Sequence[dict],
    lane_presses: Sequence[dict],
    lane_keys: Sequence[str],
    offset_ms: float,
    hit_window_ms: float,
) -> dict:
    key_to_lane = {str(key).casefold(): index for index, key in enumerate(lane_keys)}
    notes_by_lane: dict[int, list[dict]] = defaultdict(list)
    presses_by_lane: dict[int, list[dict]] = defaultdict(list)
    for note in chart_notes:
        lane = note.get("lane")
        if isinstance(lane, int) and 0 <= lane < len(lane_keys):
            notes_by_lane[lane].append(note)
    for press in lane_presses:
        lane = key_to_lane.get(str(press.get("key", "")).casefold())
        if lane is not None:
            presses_by_lane[lane].append(press)

    matched: list[dict] = []
    unmatched_notes: list[dict] = []
    extra_presses: list[dict] = []
    miss_penalty = hit_window_ms * 1.10
    extra_penalty = hit_window_ms * 1.10

    for lane in range(len(lane_keys)):
        notes = sorted(notes_by_lane.get(lane, []), key=lambda item: float(item["time_ms"]))
        presses = sorted(presses_by_lane.get(lane, []), key=lambda item: float(item["time_ms"]))
        n, m = len(notes), len(presses)
        if not notes:
            extra_presses.extend(presses)
            continue
        if not presses:
            unmatched_notes.extend(notes)
            continue

        dp = [[0.0] * (m + 1) for _ in range(n + 1)]
        back = [[0] * (m + 1) for _ in range(n + 1)]  # 1 miss, 2 extra, 3 match
        for i in range(1, n + 1):
            dp[i][0] = i * miss_penalty
            back[i][0] = 1
        for j in range(1, m + 1):
            dp[0][j] = j * extra_penalty
            back[0][j] = 2

        for i in range(1, n + 1):
            expected = float(notes[i - 1]["time_ms"]) + offset_ms
            for j in range(1, m + 1):
                miss_cost = dp[i - 1][j] + miss_penalty
                extra_cost = dp[i][j - 1] + extra_penalty
                best_cost = miss_cost
                best_move = 1
                if extra_cost < best_cost:
                    best_cost, best_move = extra_cost, 2
                distance = abs(float(presses[j - 1]["time_ms"]) - expected)
                if distance <= hit_window_ms:
                    match_cost = dp[i - 1][j - 1] + distance
                    if match_cost <= best_cost:
                        best_cost, best_move = match_cost, 3
                dp[i][j] = best_cost
                back[i][j] = best_move

        i, j = n, m
        lane_matches: list[dict] = []
        lane_misses: list[dict] = []
        lane_extras: list[dict] = []
        while i > 0 or j > 0:
            move = back[i][j]
            if move == 3 and i > 0 and j > 0:
                note = notes[i - 1]
                press = presses[j - 1]
                expected = float(note["time_ms"]) + offset_ms
                delta = float(press["time_ms"]) - expected
                lane_matches.append({
                    "note": note,
                    "press": press,
                    "expected_time_ms": expected,
                    "offset_ms": delta,
                    "absolute_offset_ms": abs(delta),
                })
                i -= 1
                j -= 1
            elif move == 1 and i > 0:
                lane_misses.append(notes[i - 1])
                i -= 1
            elif move == 2 and j > 0:
                lane_extras.append(presses[j - 1])
                j -= 1
            elif i > 0:
                lane_misses.append(notes[i - 1])
                i -= 1
            elif j > 0:
                lane_extras.append(presses[j - 1])
                j -= 1

        matched.extend(reversed(lane_matches))
        unmatched_notes.extend(reversed(lane_misses))
        extra_presses.extend(reversed(lane_extras))

    matched.sort(key=lambda item: float(item["note"]["time_ms"]))
    unmatched_notes.sort(key=lambda item: float(item["time_ms"]))
    extra_presses.sort(key=lambda item: float(item["time_ms"]))
    return {"matched": matched, "unmatched_notes": unmatched_notes, "extra_presses": extra_presses}

def _alignment_score(result: dict) -> tuple[int, float, int]:
    matched = result["matched"]
    if not matched:
        return (0, float("inf"), len(result["extra_presses"]))
    median_abs = statistics.median(item["absolute_offset_ms"] for item in matched)
    return (len(matched), median_abs, len(result["extra_presses"]))


def auto_align(
    chart_notes: Sequence[dict],
    lane_presses: Sequence[dict],
    lane_keys: Sequence[str],
    hit_window_ms: float = 180.0,
    maximum_absolute_offset_ms: float = 30000.0,
) -> dict:
    relevant_notes = [n for n in chart_notes if n.get("owner") == "player" and n.get("lane") is not None]
    if not relevant_notes or not lane_presses:
        return {"offset_ms": 0.0, "confidence": 0.0, "matched": 0, "method": "unavailable"}

    key_to_lane = {str(key).casefold(): index for index, key in enumerate(lane_keys)}
    notes_by_lane: dict[int, list[float]] = defaultdict(list)
    presses_by_lane: dict[int, list[float]] = defaultdict(list)
    for note in relevant_notes[:1000]:
        lane = note.get("lane")
        if isinstance(lane, int) and lane < len(lane_keys):
            notes_by_lane[lane].append(float(note["time_ms"]))
    for press in lane_presses[:1000]:
        lane = key_to_lane.get(str(press.get("key", "")).casefold())
        if lane is not None:
            presses_by_lane[lane].append(float(press["time_ms"]))

    histogram: Counter[int] = Counter()
    for lane in range(len(lane_keys)):
        chart_sample = notes_by_lane.get(lane, [])[:220]
        press_sample = presses_by_lane.get(lane, [])[:220]
        for chart_time in chart_sample:
            for press_time in press_sample:
                difference = press_time - chart_time
                if abs(difference) <= maximum_absolute_offset_ms:
                    histogram[int(round(difference / 10.0) * 10)] += 1

    if not histogram:
        fallback = float(lane_presses[0]["time_ms"]) - float(relevant_notes[0]["time_ms"])
        return {"offset_ms": fallback, "confidence": 0.1, "matched": 0, "method": "first-note fallback"}

    candidates = [float(value) for value, _ in histogram.most_common(25)]
    first_difference = float(lane_presses[0]["time_ms"]) - float(relevant_notes[0]["time_ms"])
    candidates.append(first_difference)

    sample_notes = relevant_notes[: min(1200, len(relevant_notes))]
    sample_presses = lane_presses[: min(1200, len(lane_presses))]
    best_offset = candidates[0]
    best_result = _match_notes(sample_notes, sample_presses, lane_keys, best_offset, hit_window_ms)
    best_score = _alignment_score(best_result)

    for candidate in candidates:
        for adjustment in range(-120, 121, 4):
            offset = candidate + adjustment
            result = _match_notes(sample_notes, sample_presses, lane_keys, offset, hit_window_ms)
            score = _alignment_score(result)
            if score[0] > best_score[0] or (score[0] == best_score[0] and score[1] < best_score[1]):
                best_offset, best_result, best_score = offset, result, score

    denominator = max(1, min(len(sample_notes), len(sample_presses)))
    match_ratio = best_score[0] / denominator
    timing_factor = max(0.0, 1.0 - best_score[1] / max(hit_window_ms, 1.0)) if math.isfinite(best_score[1]) else 0.0
    confidence = max(0.0, min(1.0, match_ratio * 0.72 + timing_factor * 0.28))
    return {
        "offset_ms": best_offset,
        "confidence": confidence,
        "matched": best_score[0],
        "median_absolute_offset_ms": best_score[1] if math.isfinite(best_score[1]) else None,
        "method": "lane-aware histogram + local refinement",
    }


def _event_dodge_analysis(
    chart_events: Sequence[dict],
    mappings: dict,
    dodge_presses: Sequence[dict],
    offset_ms: float,
    event_window_ms: float,
) -> dict:
    dodge_events = []
    for event in chart_events:
        mapping = mappings.get("event_types", {}).get(event.get("name", ""), {})
        if mapping.get("category") == "dodge" and int(mapping.get("expected_presses", 1) or 0) > 0:
            dodge_events.append((event, int(mapping.get("expected_presses", 1))))

    press_times = sorted(float(press["time_ms"]) for press in dodge_presses)
    used: set[int] = set()
    attempts = []
    expected_total = 0
    matched_total = 0
    deltas = []

    for event, expected_presses in dodge_events:
        expected_total += expected_presses
        event_time = float(event["time_ms"]) + offset_ms
        event_matches = []
        for _ in range(expected_presses):
            chosen = _nearest_unused(press_times, event_time, used, event_window_ms)
            if chosen is None:
                break
            used.add(chosen)
            delta = press_times[chosen] - event_time
            deltas.append(delta)
            event_matches.append({"press_time_ms": press_times[chosen], "delta_ms": delta})
            matched_total += 1
        attempts.append({
            "event_time_ms": float(event["time_ms"]),
            "recording_time_ms": event_time,
            "name": event["name"],
            "expected_presses": expected_presses,
            "matched_presses": len(event_matches),
            "matches": event_matches,
            "complete": len(event_matches) >= expected_presses,
        })

    unmatched_dodge_presses = [time for index, time in enumerate(press_times) if index not in used]
    return {
        "event_count": len(dodge_events),
        "expected_presses": expected_total,
        "matched_presses": matched_total,
        "estimated_missed_presses": max(0, expected_total - matched_total),
        "completion_percent": matched_total / expected_total * 100.0 if expected_total else None,
        "median_delta_ms": _median(deltas),
        "median_absolute_delta_ms": _median([abs(value) for value in deltas]),
        "early_count": sum(value < 0 for value in deltas),
        "late_count": sum(value >= 0 for value in deltas),
        "unmatched_dodge_presses": len(unmatched_dodge_presses),
        "attempts": attempts,
        "note": "These are event-aligned input estimates, not game-confirmed dodge judgments.",
    }


def build_chart_comparison(
    bundle: dict,
    lane_presses: Sequence[dict],
    dodge_presses: Sequence[dict],
    lane_keys: Sequence[str],
    chart_settings: Optional[dict] = None,
) -> dict:
    chart_key_count = int(bundle.get("summary", {}).get("key_count") or len(lane_keys))
    if chart_key_count != len(lane_keys):
        return {
            "available": False,
            "error": f"Imported chart is {chart_key_count}K but this recording uses {len(lane_keys)}K.",
            "summary": bundle.get("summary", {}),
        }

    cfg = {
        "hit_window_ms": 166.6667,
        "perfect_window_ms": 45.0,
        "good_window_ms": 90.0,
        "bad_window_ms": 135.0,
        "safe_frames": 10.0,
        "safe_fps": 60.0,
        "event_window_ms": 500.0,
        "manual_offset_ms": None,
    }
    cfg["hit_window_ms"] = float(cfg.get("hit_window_ms") or (float(cfg.get("safe_frames", 10.0)) / max(float(cfg.get("safe_fps", 60.0)), 1.0) * 1000.0))
    if chart_settings:
        cfg.update(chart_settings)

    note_mappings = bundle.get("mappings", {}).get("note_types", {})
    expected_notes = []
    hazard_notes = []
    for note in bundle.get("notes", []):
        if note.get("owner") != "player" or note.get("lane") is None:
            continue
        mapping = note_mappings.get(note.get("note_type", ""), _default_note_mapping(note.get("note_type", "")))
        if mapping.get("should_press", True):
            expected_notes.append(note)
        else:
            hazard_notes.append(note)

    if cfg.get("manual_offset_ms") is None:
        alignment = auto_align(expected_notes, lane_presses, lane_keys, float(cfg["hit_window_ms"]))
        offset_ms = float(alignment["offset_ms"])
    else:
        offset_ms = float(cfg["manual_offset_ms"])
        alignment = {"offset_ms": offset_ms, "confidence": None, "matched": None, "method": "manual"}

    all_recording_times = [float(p["time_ms"]) for p in lane_presses] + [float(p["time_ms"]) for p in dodge_presses]
    recording_start_ms = min(all_recording_times) if all_recording_times else 0.0
    recording_end_ms = max(all_recording_times) if all_recording_times else 0.0
    chart_start_ms = max(0.0, recording_start_ms - offset_ms - float(cfg["hit_window_ms"]))
    chart_end_ms = max(chart_start_ms, recording_end_ms - offset_ms + float(cfg["hit_window_ms"]))
    total_chart_duration_ms = float(bundle.get("summary", {}).get("duration_ms") or chart_end_ms)

    expected_notes = [n for n in expected_notes if chart_start_ms <= float(n["time_ms"]) <= chart_end_ms]
    hazard_notes = [n for n in hazard_notes if chart_start_ms <= float(n["time_ms"]) <= chart_end_ms]
    covered_events = [e for e in bundle.get("events", []) if chart_start_ms <= float(e["time_ms"]) <= chart_end_ms]

    matching = _match_notes_optimal(expected_notes, lane_presses, lane_keys, offset_ms, float(cfg["hit_window_ms"]))
    matched = matching["matched"]
    offsets = [item["offset_ms"] for item in matched]
    absolute_offsets = [abs(value) for value in offsets]

    judgment_counts = Counter()
    for value in absolute_offsets:
        if value <= float(cfg["perfect_window_ms"]):
            judgment_counts["within_perfect_window"] += 1
        elif value <= float(cfg["good_window_ms"]):
            judgment_counts["within_good_window"] += 1
        elif value <= float(cfg["bad_window_ms"]):
            judgment_counts["within_bad_window"] += 1
        else:
            judgment_counts["within_outer_window"] += 1

    per_lane: dict[str, dict] = {}
    for lane_index, key in enumerate(lane_keys):
        lane_notes = [n for n in expected_notes if n.get("lane") == lane_index]
        lane_matches = [item for item in matched if item["note"].get("lane") == lane_index]
        lane_offsets = [item["offset_ms"] for item in lane_matches]
        lane_extras = [p for p in matching["extra_presses"] if str(p.get("key", "")).casefold() == str(key).casefold()]
        per_lane[str(key)] = {
            "lane_index": lane_index,
            "expected_notes": len(lane_notes),
            "matched_notes": len(lane_matches),
            "estimated_misses": len(lane_notes) - len(lane_matches),
            "extra_presses": len(lane_extras),
            "estimated_match_percent": len(lane_matches) / len(lane_notes) * 100.0 if lane_notes else None,
            "median_offset_ms": _median(lane_offsets),
            "median_absolute_offset_ms": _median([abs(value) for value in lane_offsets]),
        }

    note_type_results: dict[str, dict] = {}
    all_types = sorted({note.get("note_type", "") for note in expected_notes}, key=str.casefold)
    for note_type in all_types:
        typed_notes = [n for n in expected_notes if n.get("note_type", "") == note_type]
        typed_matches = [m for m in matched if m["note"].get("note_type", "") == note_type]
        note_type_results[note_type or "(normal)"] = {
            "expected_notes": len(typed_notes),
            "matched_notes": len(typed_matches),
            "estimated_misses": len(typed_notes) - len(typed_matches),
            "estimated_match_percent": len(typed_matches) / len(typed_notes) * 100.0 if typed_notes else None,
        }

    sustain_matches = [m for m in matched if float(m["note"].get("sustain_ms") or 0.0) > 0 and m["press"].get("held_ms") is not None]
    sustain_deltas = [float(m["press"]["held_ms"]) - float(m["note"]["sustain_ms"]) for m in sustain_matches]

    hazard_press_candidates = []
    key_to_lane = {str(key).casefold(): index for index, key in enumerate(lane_keys)}
    for hazard in hazard_notes:
        expected = float(hazard["time_ms"]) + offset_ms
        lane = hazard.get("lane")
        candidates = [p for p in lane_presses if key_to_lane.get(str(p.get("key", "")).casefold()) == lane]
        if candidates:
            nearest = min(candidates, key=lambda p: abs(float(p["time_ms"]) - expected))
            distance = abs(float(nearest["time_ms"]) - expected)
            if distance <= float(cfg["hit_window_ms"]):
                hazard_press_candidates.append({
                    "note_time_ms": float(hazard["time_ms"]),
                    "recording_time_ms": expected,
                    "lane": lane,
                    "note_type": hazard.get("note_type", ""),
                    "press_time_ms": float(nearest["time_ms"]),
                    "delta_ms": float(nearest["time_ms"]) - expected,
                })

    dodge = _event_dodge_analysis(
        covered_events,
        bundle.get("mappings", {}),
        dodge_presses,
        offset_ms,
        float(cfg["event_window_ms"]),
    )

    return {
        "available": True,
        "summary": bundle.get("summary", {}),
        "alignment": alignment,
        "coverage": {
            "recording_start_ms": recording_start_ms,
            "recording_end_ms": recording_end_ms,
            "chart_start_ms": chart_start_ms,
            "chart_end_ms": chart_end_ms,
            "chart_duration_ms": total_chart_duration_ms,
            "chart_coverage_percent": min(100.0, max(0.0, (chart_end_ms - chart_start_ms) / max(total_chart_duration_ms, 1.0) * 100.0)),
            "stopped_before_chart_end": chart_end_ms + float(cfg["hit_window_ms"]) < total_chart_duration_ms,
            "note": "Unplayed chart content after recording stopped is excluded from estimated misses.",
        },
        "offset_ms": offset_ms,
        "matching": {
            "expected_notes": len(expected_notes),
            "matched_notes": len(matched),
            "estimated_misses": len(matching["unmatched_notes"]),
            "extra_presses": len(matching["extra_presses"]),
            "estimated_match_percent": len(matched) / len(expected_notes) * 100.0 if expected_notes else None,
            "median_offset_ms": _median(offsets),
            "mean_offset_ms": _mean(offsets),
            "offset_stdev_ms": _pstdev(offsets),
            "median_absolute_offset_ms": _median(absolute_offsets),
            "p90_absolute_offset_ms": _percentile(absolute_offsets, 0.90),
            "early_count": sum(value < 0 for value in offsets),
            "late_count": sum(value >= 0 for value in offsets),
            "judgment_windows": dict(judgment_counts),
        },
        "per_lane": per_lane,
        "per_note_type": note_type_results,
        "sustains": {
            "matched_sustains_with_hold_data": len(sustain_matches),
            "median_hold_minus_authored_ms": _median(sustain_deltas),
            "mean_hold_minus_authored_ms": _mean(sustain_deltas),
            "note": "FNF sustain behavior varies by engine; this is a physical hold comparison, not a sustain judgment.",
        },
        "hazards": {
            "authored_hazard_notes": len(hazard_notes),
            "press_candidates_near_hazards": len(hazard_press_candidates),
            "candidates": hazard_press_candidates[:250],
            "note": "Nearby presses are candidates only; chart importing cannot prove a hurt note was hit.",
        },
        "events": {
            "total_events": len(covered_events),
            "total_events_in_full_chart": len(bundle.get("events", [])),
            "unique_types": len(bundle.get("summary", {}).get("event_type_counts", {})),
            "dodge": dodge,
        },
        "limitations": [
            "All hit/miss values are estimates derived from physical input and an aligned chart.",
            "The game engine may use different judgment windows, ghost-tapping rules, note transforms, or scripted mechanics.",
            "Visual lane transformations are imported as events but do not yet remap authored note lanes.",
            "Unknown custom note types and events remain preserved in mappings.json.",
        ],
    }


def render_attempt_chart_section(chart: Optional[dict]) -> str:
    if not chart or not chart.get("available"):
        return ""
    summary = chart.get("summary", {})
    matching = chart.get("matching", {})
    alignment = chart.get("alignment", {})
    events = chart.get("events", {})
    dodge = events.get("dodge", {})
    hazards = chart.get("hazards", {})
    sustains = chart.get("sustains", {})
    coverage = chart.get("coverage", {})

    def card(label: str, value: str, note: str = "") -> str:
        extra = f'<div class="note">{html.escape(note)}</div>' if note else ""
        return f'<div class="card"><div class="label">{html.escape(label)}</div><div class="big">{html.escape(value)}</div>{extra}</div>'

    cards = "".join([
        card("Authored player notes", f'{matching.get("expected_notes", 0):,}'),
        card("Estimated matched", f'{matching.get("matched_notes", 0):,}'),
        card("Estimated misses", f'{matching.get("estimated_misses", 0):,}'),
        card("Extra lane presses", f'{matching.get("extra_presses", 0):,}'),
        card("Estimated match", _fmt_num(matching.get("estimated_match_percent"), 2, "%")),
        card("Alignment offset", _fmt_num(chart.get("offset_ms"), 1, " ms"), str(alignment.get("method", ""))),
        card("Median absolute timing", _fmt_num(matching.get("median_absolute_offset_ms"), 1, " ms")),
        card("P90 absolute timing", _fmt_num(matching.get("p90_absolute_offset_ms"), 1, " ms")),
        card("Chart coverage", _fmt_num(coverage.get("chart_coverage_percent"), 1, "%"), "stopped early" if coverage.get("stopped_before_chart_end") else "full chart"),
    ])

    lane_rows = []
    for key, row in chart.get("per_lane", {}).items():
        lane_rows.append(
            f'<tr><td>{row.get("lane_index", 0)+1}</td><td><strong>{html.escape(key.upper())}</strong></td>'
            f'<td>{row.get("expected_notes", 0)}</td><td>{row.get("matched_notes", 0)}</td><td>{row.get("estimated_misses", 0)}</td>'
            f'<td>{row.get("extra_presses", 0)}</td><td>{_fmt_num(row.get("estimated_match_percent"), 2, "%")}</td>'
            f'<td>{_fmt_num(row.get("median_offset_ms"), 1, " ms")}</td></tr>'
        )

    event_cards = "".join([
        card("Imported events", f'{events.get("total_events", 0):,}'),
        card("Dodge event markers", f'{dodge.get("event_count", 0):,}'),
        card("Expected dodge presses", f'{dodge.get("expected_presses", 0):,}'),
        card("Matched dodge presses", f'{dodge.get("matched_presses", 0):,}'),
        card("Estimated missed dodges", f'{dodge.get("estimated_missed_presses", 0):,}'),
        card("Dodge completion", _fmt_num(dodge.get("completion_percent"), 1, "%")),
        card("Hazard notes", f'{hazards.get("authored_hazard_notes", 0):,}'),
        card("Hazard press candidates", f'{hazards.get("press_candidates_near_hazards", 0):,}'),
    ])

    return f'''<section class="section"><h2>Imported FNF chart comparison</h2><p class="muted">{html.escape(str(summary.get("song_name", "Imported chart")))} · {summary.get("key_count", "?")}K · confidence {_fmt_num(alignment.get("confidence") * 100 if isinstance(alignment.get("confidence"), (int, float)) else None, 1, "%")} · <a href="../chart/song_explorer.html">open Song Explorer</a></p><div class="cards" style="margin-top:14px">{cards}</div><p class="callout" style="margin-top:14px">Estimated alignment only. Unplayed content after recording stopped is excluded; these are not game-confirmed judgments.</p></section>
<section class="section"><h2>Estimated per-lane chart matching</h2><div class="tablewrap"><table><thead><tr><th>Lane</th><th>Key</th><th>Expected</th><th>Matched</th><th>Misses</th><th>Extras</th><th>Match</th><th>Median offset</th></tr></thead><tbody>{''.join(lane_rows)}</tbody></table></div></section>
<section class="section"><h2>Imported mechanics and events</h2><div class="cards">{event_cards}</div><p class="muted" style="margin-top:12px">{html.escape(str(dodge.get("note", "")))}</p></section>
<section class="section"><h2>Sustain comparison</h2><div class="cards">{card("Matched sustains", str(sustains.get("matched_sustains_with_hold_data", 0)))}{card("Median hold difference", _fmt_num(sustains.get("median_hold_minus_authored_ms"), 1, " ms"))}</div><p class="muted" style="margin-top:12px">{html.escape(str(sustains.get("note", "")))}</p></section>'''
