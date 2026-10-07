from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Any, Optional

import fnf_importer

_STEM_ID = re.compile(r"[^a-z0-9]+")
_COMPAT_INSTALLED = False

def _slug(value: Any, fallback: str = "unknown") -> str:
    text = _STEM_ID.sub("-", str(value or "").casefold()).strip("-")
    return text or fallback


def _number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number else default


def _codename_chart(data: Any) -> bool:
    return isinstance(data, dict) and (
        data.get("codenameChart") is True or isinstance(data.get("strumLines"), list)
    )


def _codename_key_count(data: dict, override: Optional[int]) -> int:
    if override is not None:
        count = int(override)
    else:
        count = 0
        for field in ("keyCount", "key_count", "keys", "laneCount", "lane_count"):
            raw = data.get(field)
            if isinstance(raw, (int, float)):
                count = int(raw)
                break
        if not count:
            lanes = []
            for line in data.get("strumLines", []) or []:
                if not isinstance(line, dict):
                    continue
                for note in line.get("notes", []) or []:
                    if not isinstance(note, dict):
                        continue
                    raw = note.get("id", note.get("lane"))
                    if isinstance(raw, (int, float)) and int(raw) >= 0:
                        lanes.append(int(raw))
            count = max(lanes, default=3) + 1
    if count not in fnf_importer.SUPPORTED_KEY_COUNTS:
        if 1 <= count <= 4:
            count = 4
        else:
            raise ValueError("Only 4K through 9K Codename charts are supported by Rhythm Input Lab.")
    return count


def _codename_note_type(data: dict, raw: Any) -> str:
    if raw in (None, "", 0, "0", False):
        return ""
    note_types = data.get("noteTypes")
    if isinstance(raw, (int, float)) and isinstance(note_types, list):
        index = int(raw)
        if 0 <= index < len(note_types):
            row = note_types[index]
            if isinstance(row, dict):
                return str(row.get("name") or row.get("id") or index).strip()
            return str(row).strip()
    return str(raw).strip()


def _position_owner(position: Any) -> str:
    value = str(position or "").casefold().replace("_", "-")
    if value in {"boyfriend", "bf", "player", "player1", "must-hit", "musthit"}:
        return "player"
    return "opponent"


def _codename_events(data: dict) -> list[dict]:
    events: list[dict] = []
    for index, raw in enumerate(data.get("events", []) or []):
        if isinstance(raw, dict):
            time_ms = _number(raw.get("time", raw.get("time_ms", raw.get("strumTime"))))
            name = str(raw.get("name") or raw.get("event") or "Unknown Event")
            params = raw.get("params")
            if not isinstance(params, list):
                params = [params] if params is not None else []
            events.append({
                "time_ms": time_ms,
                "name": name,
                "value1": params[0] if params else "",
                "value2": params[1] if len(params) > 1 else "",
                "params": params,
                "source": "root.events",
                "group_index": index,
                "event_index": 0,
                "raw": raw,
            })
        elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
            time_ms = _number(raw[0])
            name = str(raw[1] or "Unknown Event")
            params = list(raw[2:])
            events.append({
                "time_ms": time_ms,
                "name": name,
                "value1": params[0] if params else "",
                "value2": params[1] if len(params) > 1 else "",
                "params": params,
                "source": "root.events",
                "group_index": index,
                "event_index": 0,
                "raw": list(raw),
            })
    events.sort(key=lambda row: (float(row["time_ms"]), str(row["name"])))
    return events


def _codename_timing(data: dict, events: list[dict]) -> tuple[float, list[dict]]:
    base_bpm = _number(
        data.get("bpm", data.get("beatsPerMinute", (data.get("meta") or {}).get("bpm") if isinstance(data.get("meta"), dict) else 0))
    )
    changes: list[tuple[float, float]] = []
    for event in events:
        name = str(event.get("name") or "").casefold().replace("_", " ")
        if "bpm" not in name:
            continue
        params = event.get("params") or []
        candidate = _number(params[0] if params else event.get("value1"), 0.0)
        if candidate > 0:
            changes.append((float(event.get("time_ms") or 0), candidate))
    changes.sort()
    if base_bpm <= 0 and changes and changes[0][0] <= 1:
        base_bpm = changes[0][1]
    rows: list[dict] = []
    if base_bpm > 0:
        rows.append({
            "section_index": 0,
            "time_ms": 0.0,
            "bpm": base_bpm,
            "change_bpm": False,
            "must_hit_section": None,
            "length_in_steps": 0,
        })
    for index, (time_ms, bpm) in enumerate(changes, start=len(rows)):
        if rows and abs(time_ms - float(rows[-1]["time_ms"])) < 0.001 and abs(bpm - float(rows[-1]["bpm"])) < 0.001:
            continue
        rows.append({
            "section_index": index,
            "time_ms": time_ms,
            "bpm": bpm,
            "change_bpm": True,
            "must_hit_section": None,
            "length_in_steps": 0,
        })
    return base_bpm, rows


def _timing_at(rows: list[dict], time_ms: float, base_bpm: float) -> tuple[int, float]:
    section_index = 0
    bpm = base_bpm
    for row in rows:
        if float(row.get("time_ms") or 0) > time_ms:
            break
        section_index = int(row.get("section_index") or 0)
        bpm = _number(row.get("bpm"), bpm)
    return section_index, bpm


def normalize_codename_chart(data: dict, source_name: str, key_count_override: Optional[int] = None) -> dict:
    if not _codename_chart(data):
        raise ValueError("This does not look like a Codename Engine chart.")
    key_count = _codename_key_count(data, key_count_override)
    events = _codename_events(data)
    base_bpm, sections = _codename_timing(data, events)
    notes: list[dict] = []
    note_type_counts: Counter[str] = Counter()
    raw_lane_counts: Counter[int] = Counter()
    position_counts: Counter[str] = Counter()

    for line_index, line in enumerate(data.get("strumLines", []) or []):
        if not isinstance(line, dict):
            continue
        position = str(line.get("position") or f"strumline-{line_index}")
        owner = _position_owner(position)
        vocals_suffix = str(line.get("vocalsSuffix") or "")
        position_counts[position] += len(line.get("notes", []) or [])
        for note_index, raw_note in enumerate(line.get("notes", []) or []):
            if not isinstance(raw_note, dict):
                continue
            time_ms = _number(raw_note.get("time", raw_note.get("time_ms", raw_note.get("strumTime"))))
            raw_lane = int(_number(raw_note.get("id", raw_note.get("lane")), -1))
            if raw_lane < 0:
                continue
            sustain_ms = max(0.0, _number(raw_note.get("sLen", raw_note.get("sustainLength", raw_note.get("sustain_ms")))))
            lane = raw_lane % key_count
            note_type = _codename_note_type(data, raw_note.get("type"))
            section_index, bpm = _timing_at(sections, time_ms, base_bpm)
            note_type_counts[note_type or "(normal)"] += 1
            raw_lane_counts[raw_lane] += 1
            notes.append({
                "time_ms": time_ms,
                "end_ms": time_ms + sustain_ms,
                "lane": lane,
                "raw_lane": raw_lane,
                "sustain_ms": sustain_ms,
                "owner": owner,
                "section_index": section_index,
                "must_hit_section": owner == "player",
                "bpm": bpm,
                "note_type": note_type,
                "source_position": position,
                "vocals_suffix": vocals_suffix,
                "strumline_index": line_index,
                "note_index": note_index,
                "extra_data": {key: value for key, value in raw_note.items() if key not in {"time", "time_ms", "strumTime", "id", "lane", "sLen", "sustainLength", "sustain_ms", "type"}},
                "raw": raw_note,
            })

    notes.sort(key=lambda row: (float(row["time_ms"]), int(row["raw_lane"]), int(row["strumline_index"])))
    event_type_counts = Counter(str(row["name"]) for row in events)
    player_notes = [row for row in notes if row["owner"] == "player"]
    opponent_notes = [row for row in notes if row["owner"] == "opponent"]
    sustains = [row for row in notes if float(row["sustain_ms"]) > 0]
    duration_ms = max(
        [0.0]
        + [float(row["end_ms"]) for row in notes]
        + [float(row["time_ms"]) for row in events]
    )
    patterns = fnf_importer._authored_chart_patterns(player_notes)
    stack_counts = Counter(round(float(row["time_ms"]), 6) for row in events)
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    song_name = str(data.get("songName") or meta.get("name") or "").strip()
    if not song_name:
        raw_song = data.get("song")
        song_name = str(raw_song).strip() if isinstance(raw_song, str) else Path(source_name).stem

    summary = {
        "format": "fnf_codename",
        "source_format": "fnf_codename",
        "importer_version": "1.1",
        "source_name": source_name,
        "song_name": song_name,
        "song_id": _slug(song_name),
        "key_count": key_count,
        "base_bpm": base_bpm,
        "scroll_speed": data.get("scrollSpeed", data.get("speed")),
        "stage": data.get("stage"),
        "player1": data.get("player1"),
        "player2": data.get("player2"),
        "player3": data.get("player3"),
        "needs_voices": True,
        "dodge_enabled": None,
        "section_count": len(sections),
        "total_notes": len(notes),
        "player_notes": len(player_notes),
        "opponent_notes": len(opponent_notes),
        "event_notes": 0,
        "sustain_notes": len(sustains),
        "event_count": len(events),
        "unique_event_types": len(event_type_counts),
        "unique_note_types": len(note_type_counts),
        "duration_ms": duration_ms,
        "player_lane_counts": patterns["lane_counts"],
        "player_chord_groups": patterns["chord_groups"],
        "largest_player_chord": patterns["largest_chord"],
        "player_jack_pairs_250ms": patterns["jack_pairs_250ms"],
        "player_peak_1s_nps": patterns["peak_1s_nps"],
        "player_peak_2s_nps": patterns["peak_2s_nps"],
        "player_peak_5s_nps": patterns["peak_5s_nps"],
        "max_events_same_timestamp": max(stack_counts.values(), default=0),
        "dynamic_bpm": len(sections) > (1 if base_bpm > 0 else 0),
        "bpm_changes": [row for row in sections if row["change_bpm"]],
        "raw_lane_counts": {str(key): value for key, value in sorted(raw_lane_counts.items())},
        "note_type_counts": dict(note_type_counts),
        "event_type_counts": dict(event_type_counts),
        "strumline_positions": dict(position_counts),
    }
    mappings = {
        "event_types": {
            name: fnf_importer._default_event_mapping(name)
            for name in sorted(event_type_counts, key=str.casefold)
        },
        "note_types": {
            ("" if name == "(normal)" else name): fnf_importer._default_note_mapping("" if name == "(normal)" else name)
            for name in sorted(note_type_counts, key=str.casefold)
        },
        "notes": [
            "Codename strum-line positions and vocal suffixes are preserved on every normalized note.",
            "Mappings are editable JSON and are never silently discarded.",
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
        "sections": sections,
        "mappings": mappings,
        "song_metadata": {
            key: value for key, value in data.items()
            if key not in {"strumLines", "events"}
        },
    }


def install_fnf_compat() -> None:
    global _COMPAT_INSTALLED
    if _COMPAT_INSTALLED:
        return

    original_normalize = fnf_importer.normalize_fnf_chart

    def normalize(data: dict, source_name: str, key_count_override: Optional[int] = None) -> dict:
        if _codename_chart(data):
            return normalize_codename_chart(data, source_name, key_count_override)
        return original_normalize(data, source_name, key_count_override)

    fnf_importer.normalize_fnf_chart = normalize
    _COMPAT_INSTALLED = True
