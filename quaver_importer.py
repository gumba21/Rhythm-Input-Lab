from __future__ import annotations

import bisect
import hashlib
import math
import re
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import yaml
from yaml.events import AliasEvent
from yaml.nodes import MappingNode, ScalarNode, SequenceNode

IMPORTER_VERSION = "1.0"
SUPPORTED_KEY_COUNTS = tuple(range(4, 10))
SUPPORTED_AUDIO_SUFFIXES = {".ogg", ".mp3", ".wav", ".flac", ".m4a", ".aac", ".opus", ".webm"}
MAX_QP_FILES = 20_000
MAX_QP_UNCOMPRESSED = 4_000_000_000
MAX_QUA_BYTES = 64_000_000

_MODE_KEY_COUNTS = {
    "keys1": 1, "keys2": 2, "keys3": 3, "keys4": 4, "keys5": 5,
    "keys6": 6, "keys7": 7, "keys8": 8, "keys9": 9, "keys10": 10,
    1: 4, 2: 7, 3: 1, 4: 2, 5: 3, 6: 5, 7: 6, 8: 8, 9: 9, 10: 10,
}


class QuaverImportError(ValueError):
    pass


class _QuaLoader(yaml.SafeLoader):
    """Data-only loader for .qua YAML, including Quaver's !ScrollGroup tag."""

    def compose_node(self, parent: Any, index: Any) -> Any:
        if self.check_event(AliasEvent):
            raise QuaverImportError("YAML aliases are not supported in .qua files")
        return super().compose_node(parent, index)


def _construct_unknown_tag(loader: _QuaLoader, _tag_suffix: str, node: Any) -> Any:
    if isinstance(node, MappingNode):
        return loader.construct_mapping(node, deep=True)
    if isinstance(node, SequenceNode):
        return loader.construct_sequence(node, deep=True)
    if isinstance(node, ScalarNode):
        return loader.construct_scalar(node)
    raise QuaverImportError("Unsupported YAML node in .qua file")


_QuaLoader.add_multi_constructor("", _construct_unknown_tag)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value or "").strip().casefold() in {"1", "true", "yes", "on"}


def _rows(value: Any) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _field(row: dict[str, Any], name: str, default: Any = None) -> Any:
    if name in row:
        return row[name]
    target = name.casefold()
    for key, value in row.items():
        if str(key).casefold() == target:
            return value
    return default


def _decode_qua_bytes(payload: bytes) -> str:
    if len(payload) > MAX_QUA_BYTES:
        raise QuaverImportError("The .qua chart is larger than the 64 MB safety limit")
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _load_qua_text(text: str) -> dict[str, Any]:
    try:
        document = yaml.load(text, Loader=_QuaLoader)
    except QuaverImportError:
        raise
    except yaml.YAMLError as exc:
        raise QuaverImportError(f"The .qua YAML could not be parsed: {exc}") from exc
    if not isinstance(document, dict):
        raise QuaverImportError("This does not look like a Quaver .qua chart")
    return document


def _mode_key_count(mode: Any, has_scratch: bool) -> tuple[int, str]:
    key: Any = mode
    if isinstance(mode, str):
        stripped = mode.strip()
        key = stripped.casefold()
        if key not in _MODE_KEY_COUNTS and re.fullmatch(r"[-+]?\d+", stripped):
            key = int(stripped)
    else:
        key = _safe_int(mode, -999)
    base = _MODE_KEY_COUNTS.get(key)
    if base is None:
        raise QuaverImportError(f"Unknown Quaver game mode: {mode!r}")
    count = base + (1 if has_scratch else 0)
    if count not in SUPPORTED_KEY_COUNTS:
        raise QuaverImportError(
            f"This Quaver chart resolves to {count} keys; Rhythm Input Lab currently supports 4K through 9K"
        )
    return count, f"Keys{base}{'+1' if has_scratch else ''}"


def _signature_value(value: Any) -> int:
    if isinstance(value, str):
        lookup = {"quadruple": 4, "triple": 3}
        if value.strip().casefold() in lookup:
            return lookup[value.strip().casefold()]
    number = _safe_int(value, 4)
    return number if number > 0 else 4


def _parse_timing_points(document: dict[str, Any]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for index, raw in enumerate(_rows(_field(document, "TimingPoints", []))):
        bpm = _safe_float(_field(raw, "Bpm"), 0.0)
        if bpm <= 0:
            continue
        points.append({
            "index": index,
            "time_ms": _safe_float(_field(raw, "StartTime"), 0.0),
            "bpm": bpm,
            "signature": _signature_value(_field(raw, "Signature", 4)),
            "hidden": _safe_bool(_field(raw, "Hidden", False)),
            "raw": raw,
        })
    points.sort(key=lambda row: (float(row["time_ms"]), int(row["index"])))
    if not points:
        raise QuaverImportError("The .qua chart has no valid timing points")
    return points


def _active_timing(points: list[dict[str, Any]], time_ms: float) -> tuple[int, dict[str, Any]]:
    times = [float(row["time_ms"]) for row in points]
    index = max(0, bisect.bisect_right(times, time_ms) - 1)
    return index, points[index]


def _hit_object_is_mine(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().casefold() == "mine"
    return _safe_int(value, 0) == 1


def _hit_sound_names(value: Any) -> list[str]:
    bits = _safe_int(value, 0)
    names = [name for bit, name in ((1, "Normal"), (2, "Whistle"), (4, "Finish"), (8, "Clap")) if bits & bit]
    return names or (["Normal"] if bits == 0 else [])


def _parse_scroll_events(rows: Iterable[dict[str, Any]], *, group: str, event_name: str, source: str, start_index: int) -> tuple[list[dict[str, Any]], int]:
    events: list[dict[str, Any]] = []
    event_index = start_index
    for raw in rows:
        events.append({
            "time_ms": _safe_float(_field(raw, "StartTime"), 0.0),
            "name": event_name,
            "value1": _safe_float(_field(raw, "Multiplier"), 1.0),
            "value2": group,
            "source": source,
            "group_index": event_index,
            "event_index": 0,
            "raw": raw,
        })
        event_index += 1
    return events, event_index


def _active_actions_per_second(notes: list[dict[str, Any]]) -> float:
    actions: list[float] = []
    for note in notes:
        if note.get("note_type") == "Quaver Mine":
            continue
        start = float(note["time_ms"])
        actions.append(start)
        if float(note.get("sustain_ms") or 0) > 0:
            actions.append(float(note.get("end_ms") or start))
    if len(actions) < 2:
        return 0.0
    actions.sort()
    active_ms = actions[-1] - actions[0]
    for previous, current in zip(actions, actions[1:]):
        if current - previous >= 1000:
            active_ms -= current - previous
    return len(actions) / (active_ms / 1000) if active_ms > 0 else 0.0


def _display_title(document: dict[str, Any], source_name: str) -> str:
    title = str(_field(document, "Title", "") or Path(source_name).stem).strip()
    artist = str(_field(document, "Artist", "") or "").strip()
    difficulty = str(_field(document, "DifficultyName", "") or "").strip()
    return f"{artist + ' - ' if artist else ''}{title}{f' [{difficulty}]' if difficulty else ''}".strip()


def parse_qua_text(text: str, source_name: str = "chart.qua") -> dict[str, Any]:
    document = _load_qua_text(text)
    has_scratch = _safe_bool(_field(document, "HasScratchKey", False))
    key_count, mode_label = _mode_key_count(_field(document, "Mode"), has_scratch)
    timing_points = _parse_timing_points(document)

    notes: list[dict[str, Any]] = []
    invalid_objects = 0
    lane_counts: Counter[int] = Counter()
    mine_count = 0
    hold_count = 0
    hit_sound_counts: Counter[str] = Counter()
    timing_group_counts: Counter[str] = Counter()

    for source_index, raw in enumerate(_rows(_field(document, "HitObjects", []))):
        start = _safe_float(_field(raw, "StartTime"), -1.0)
        lane_one_based = _safe_int(_field(raw, "Lane"), 0)
        if start < 0 or lane_one_based < 1 or lane_one_based > key_count:
            invalid_objects += 1
            continue
        lane = lane_one_based - 1
        mine = _hit_object_is_mine(_field(raw, "Type", "Normal"))
        authored_end = _safe_float(_field(raw, "EndTime"), 0.0)
        end = start if mine or authored_end <= start else authored_end
        sustain = max(0.0, end - start)
        section_index, timing = _active_timing(timing_points, start)
        timing_group = str(_field(raw, "TimingGroup", "$Default") or "$Default")
        hit_sound = _field(raw, "HitSound", 0)
        hit_names = _hit_sound_names(hit_sound)
        for name in hit_names:
            hit_sound_counts[name] += 1
        timing_group_counts[timing_group] += 1
        if mine:
            mine_count += 1
        elif sustain > 0:
            hold_count += 1
        lane_counts[lane] += 1
        notes.append({
            "time_ms": start,
            "end_ms": end,
            "lane": lane,
            "raw_lane": lane_one_based,
            "sustain_ms": sustain,
            "owner": "player",
            "section_index": section_index,
            "must_hit_section": True,
            "bpm": float(timing["bpm"]),
            "note_type": "Quaver Mine" if mine else "",
            "extra_data": [{
                "source_index": source_index,
                "type": _field(raw, "Type", "Normal"),
                "authored_end_time": authored_end,
                "hit_sound": hit_sound,
                "hit_sound_names": hit_names,
                "key_sounds": _field(raw, "KeySounds", []),
                "editor_layer": _field(raw, "EditorLayer", 0),
                "timing_group": timing_group,
            }],
        })

    notes.sort(key=lambda row: (float(row["time_ms"]), int(row["lane"]), float(row["end_ms"])))
    if not notes:
        raise QuaverImportError("The .qua chart has no valid hit objects")

    events: list[dict[str, Any]] = []
    for index, timing in enumerate(timing_points):
        if index == 0:
            continue
        events.append({
            "time_ms": timing["time_ms"], "name": "Quaver BPM change", "value1": timing["bpm"],
            "value2": timing["signature"], "source": "TimingPoints", "group_index": index, "event_index": 0,
            "raw": timing["raw"],
        })

    event_index = len(events)
    default_sv = _rows(_field(document, "SliderVelocities", []))
    default_ssf = _rows(_field(document, "ScrollSpeedFactors", []))
    rows, event_index = _parse_scroll_events(default_sv, group="$Default", event_name="Quaver SV change", source="SliderVelocities", start_index=event_index)
    events.extend(rows)
    rows, event_index = _parse_scroll_events(default_ssf, group="$Default", event_name="Quaver scroll speed factor", source="ScrollSpeedFactors", start_index=event_index)
    events.extend(rows)

    timing_groups = _field(document, "TimingGroups", {})
    if isinstance(timing_groups, dict):
        for group_name, group_value in timing_groups.items():
            group = group_value if isinstance(group_value, dict) else {}
            rows, event_index = _parse_scroll_events(_rows(_field(group, "ScrollVelocities", [])), group=str(group_name), event_name="Quaver SV change", source="TimingGroups", start_index=event_index)
            events.extend(rows)
            rows, event_index = _parse_scroll_events(_rows(_field(group, "ScrollSpeedFactors", [])), group=str(group_name), event_name="Quaver scroll speed factor", source="TimingGroups", start_index=event_index)
            events.extend(rows)

    for raw in _rows(_field(document, "SoundEffects", [])):
        events.append({
            "time_ms": _safe_float(_field(raw, "StartTime"), 0.0), "name": "Quaver sound effect",
            "value1": _field(raw, "Sample", 0), "value2": _field(raw, "Volume", 100) or 100,
            "source": "SoundEffects", "group_index": event_index, "event_index": 0, "raw": raw,
        })
        event_index += 1
    for raw in _rows(_field(document, "Bookmarks", [])):
        events.append({
            "time_ms": _safe_float(_field(raw, "StartTime"), 0.0), "name": "Quaver bookmark",
            "value1": str(_field(raw, "Note", "") or ""), "value2": str(_field(raw, "ColorRgb", "255,255,0") or "255,255,0"),
            "source": "Bookmarks", "group_index": event_index, "event_index": 0, "raw": raw,
        })
        event_index += 1
    events.sort(key=lambda row: (float(row["time_ms"]), int(row["group_index"])))

    duration_ms = max(max(float(note["end_ms"]), float(note["time_ms"])) for note in notes)
    bpms = [float(row["bpm"]) for row in timing_points]
    sections = [{
        "section_index": index,
        "time_ms": float(row["time_ms"]),
        "bpm": float(row["bpm"]),
        "change_bpm": index > 0,
        "must_hit_section": True,
        "length_in_steps": int(row["signature"]) * 4,
        "signature": int(row["signature"]),
        "hidden": bool(row["hidden"]),
    } for index, row in enumerate(timing_points)]

    song_name = _display_title(document, source_name)
    title = str(_field(document, "Title", "") or Path(source_name).stem)
    artist = str(_field(document, "Artist", "") or "")
    creator = str(_field(document, "Creator", "") or "")
    difficulty = str(_field(document, "DifficultyName", "") or "")
    source_sha = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()

    warnings: list[str] = []
    if invalid_objects:
        warnings.append(f"Skipped {invalid_objects} invalid hit object{'s' if invalid_objects != 1 else ''}.")
    if any(str(group) not in {"$Default", ""} for group in timing_group_counts):
        warnings.append("Per-note timing groups are preserved, but RIL does not reproduce Quaver's separate scroll-group presentation yet.")
    if default_ssf or any(event["name"] == "Quaver scroll speed factor" for event in events):
        warnings.append("Scroll-speed-factor keyframes are preserved as events; current Practice rendering does not interpolate them like Quaver.")
    if _rows(_field(document, "CustomAudioSamples", [])) or _rows(_field(document, "SoundEffects", [])):
        warnings.append("Keysounds and custom samples are preserved as source metadata/events but are not played by Practice.")

    summary = {
        "format": "quaver_qua",
        "source_format": "quaver_qua",
        "source_name": source_name,
        "source_sha256": source_sha,
        "song_name": song_name,
        "song_id": re.sub(r"[^a-z0-9]+", "-", song_name.casefold()).strip("-") or "quaver-song",
        "title": title,
        "artist": artist,
        "charter": creator,
        "difficulty": difficulty,
        "key_count": key_count,
        "mode": mode_label,
        "has_scratch_key": has_scratch,
        "base_bpm": bpms[0],
        "min_bpm": min(bpms),
        "max_bpm": max(bpms),
        "dynamic_bpm": len({round(value, 6) for value in bpms}) > 1,
        "duration_ms": duration_ms,
        "player_notes": len(notes),
        "opponent_notes": 0,
        "sustain_notes": hold_count,
        "mine_notes": mine_count,
        "event_count": len(events),
        "timing_point_count": len(timing_points),
        "slider_velocity_count": sum(1 for row in events if row["name"] == "Quaver SV change"),
        "scroll_speed_factor_count": sum(1 for row in events if row["name"] == "Quaver scroll speed factor"),
        "active_actions_per_second": _active_actions_per_second(notes),
        "audio_filename": str(_field(document, "AudioFile", "") or ""),
        "preview_time": _safe_int(_field(document, "SongPreviewTime", 0), 0),
        "map_id": _safe_int(_field(document, "MapId", -1), -1),
        "map_set_id": _safe_int(_field(document, "MapSetId", -1), -1),
        "qua_version": _safe_int(_field(document, "QuaVersion", 0), 0),
        "warnings": warnings,
    }

    song_metadata = {
        "source_format": "quaver_qua",
        "quaver": {
            "qua_version": summary["qua_version"], "mode": mode_label, "has_scratch_key": has_scratch,
            "map_id": summary["map_id"], "map_set_id": summary["map_set_id"],
            "source": str(_field(document, "Source", "") or ""), "tags": str(_field(document, "Tags", "") or ""),
            "description": str(_field(document, "Description", "") or ""), "genre": str(_field(document, "Genre", "") or ""),
            "audio_file": summary["audio_filename"], "background_file": str(_field(document, "BackgroundFile", "") or ""),
            "banner_file": str(_field(document, "BannerFile", "") or ""), "song_preview_time": summary["preview_time"],
            "legacy_ln_rendering": _safe_bool(_field(document, "LegacyLNRendering", False)),
            "bpm_does_not_affect_scroll_velocity": _safe_bool(_field(document, "BPMDoesNotAffectScrollVelocity", False)),
            "initial_scroll_velocity": _safe_float(_field(document, "InitialScrollVelocity", 0.0), 0.0),
            "editor_layers": _field(document, "EditorLayers", []), "bookmarks": _field(document, "Bookmarks", []),
            "custom_audio_samples": _field(document, "CustomAudioSamples", []), "sound_effects": _field(document, "SoundEffects", []),
            "timing_groups": timing_groups if isinstance(timing_groups, dict) else {},
            "lane_counts": {str(lane + 1): count for lane, count in sorted(lane_counts.items())},
            "hit_sound_counts": dict(hit_sound_counts), "timing_group_counts": dict(timing_group_counts),
        },
        "timing_points": [{key: value for key, value in row.items() if key != "raw"} for row in timing_points],
        "breaks": [],
        "warnings": warnings,
    }

    mappings = {
        "note_types": {
            "": {"category": "normal", "gameplay": True, "should_press": True},
            "Quaver Mine": {"category": "hazard", "gameplay": True, "should_press": False},
        },
        "event_types": {
            "Quaver BPM change": {"category": "timing", "gameplay": False, "expected_presses": 0},
            "Quaver SV change": {"category": "presentation", "gameplay": False, "expected_presses": 0},
            "Quaver scroll speed factor": {"category": "presentation", "gameplay": False, "expected_presses": 0},
            "Quaver sound effect": {"category": "audio", "gameplay": False, "expected_presses": 0},
            "Quaver bookmark": {"category": "metadata", "gameplay": False, "expected_presses": 0},
        },
        "notes": ["Quaver lanes are one-based in .qua and zero-based inside neutral RIL data."],
    }

    return {"summary": summary, "notes": notes, "events": events, "sections": sections, "mappings": mappings, "song_metadata": song_metadata}


def parse_qua_bytes(payload: bytes, source_name: str = "chart.qua") -> dict[str, Any]:
    return parse_qua_text(_decode_qua_bytes(payload), source_name)


def _safe_archive_name(name: str) -> str:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized or normalized.startswith("/") or any(part in {"", ".", ".."} for part in path.parts):
        raise QuaverImportError(f"The .qp archive contains an unsafe path: {name}")
    if path.parts and re.match(r"^[A-Za-z]:", path.parts[0]):
        raise QuaverImportError(f"The .qp archive contains an unsafe path: {name}")
    return str(path)


def validate_qp(path: Path) -> dict[str, zipfile.ZipInfo]:
    if not zipfile.is_zipfile(path):
        raise QuaverImportError("This .qp package is not a supported ZIP-based Quaver mapset")
    names: dict[str, zipfile.ZipInfo] = {}
    expanded = 0
    with zipfile.ZipFile(path, "r") as archive:
        infos = archive.infolist()
        if len(infos) > MAX_QP_FILES:
            raise QuaverImportError("The .qp package contains too many files")
        for info in infos:
            safe = _safe_archive_name(info.filename)
            if info.flag_bits & 0x1:
                raise QuaverImportError("Encrypted .qp entries are not supported")
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise QuaverImportError("Symbolic links are not allowed in .qp packages")
            expanded += int(info.file_size)
            if expanded > MAX_QP_UNCOMPRESSED:
                raise QuaverImportError("The expanded .qp package exceeds the 4 GB safety limit")
            names[safe.casefold()] = info
    return names


def _resolve_archive_file(chart_entry: str, referenced: str, names: dict[str, zipfile.ZipInfo], allowed_suffixes: set[str] | None = None) -> str:
    referenced = str(referenced or "").strip().replace("\\", "/")
    if not referenced:
        return ""
    candidates = []
    relative = str(PurePosixPath(chart_entry).parent / referenced)
    candidates.extend([relative, referenced])
    for candidate in candidates:
        info = names.get(candidate.casefold())
        if info and (allowed_suffixes is None or Path(info.filename).suffix.casefold() in allowed_suffixes):
            return info.filename
    basename = PurePosixPath(referenced).name.casefold()
    matches = [info.filename for info in names.values() if PurePosixPath(info.filename).name.casefold() == basename and (allowed_suffixes is None or Path(info.filename).suffix.casefold() in allowed_suffixes)]
    return matches[0] if len(matches) == 1 else ""


def _preview_row(bundle: dict[str, Any], *, entry_name: str, has_audio: bool, audio_entry: str) -> dict[str, Any]:
    summary = bundle["summary"]
    identifier = hashlib.sha256(f"{entry_name}\0{summary['source_sha256']}".encode("utf-8")).hexdigest()[:20]
    return {
        "id": identifier, "entry_name": entry_name, "song_name": summary["song_name"], "title": summary["title"],
        "artist": summary["artist"], "creator": summary["charter"], "difficulty": summary["difficulty"],
        "key_count": summary["key_count"], "notes": summary["player_notes"], "holds": summary["sustain_notes"],
        "mines": summary["mine_notes"], "duration_ms": summary["duration_ms"], "base_bpm": summary["base_bpm"],
        "min_bpm": summary["min_bpm"], "max_bpm": summary["max_bpm"], "sv_count": summary["slider_velocity_count"],
        "ssf_count": summary["scroll_speed_factor_count"], "active_actions_per_second": summary["active_actions_per_second"],
        "has_audio": has_audio, "audio_entry": audio_entry, "audio_filename": summary["audio_filename"],
        "warnings": summary.get("warnings") or [], "map_id": summary.get("map_id"), "map_set_id": summary.get("map_set_id"),
    }


def inspect_source(path: Path) -> dict[str, Any]:
    path = Path(path)
    suffix = path.suffix.casefold()
    if suffix == ".qua":
        payload = path.read_bytes()
        bundle = parse_qua_bytes(payload, path.name)
        row = _preview_row(bundle, entry_name=path.name, has_audio=False, audio_entry="")
        return {
            "kind": "qua", "filename": path.name, "title": bundle["summary"]["title"], "artist": bundle["summary"]["artist"],
            "difficulties": [row], "unsupported": [], "warnings": ["Standalone .qua files do not contain their referenced audio. Attach audio after import."],
        }
    if suffix != ".qp":
        raise QuaverImportError("Choose a standalone .qua chart or a .qp Quaver mapset")

    names = validate_qp(path)
    difficulties: list[dict[str, Any]] = []
    unsupported: list[dict[str, str]] = []
    with zipfile.ZipFile(path, "r") as archive:
        entries = sorted((info for info in names.values() if Path(info.filename).suffix.casefold() == ".qua"), key=lambda info: info.filename.casefold())
        if not entries:
            raise QuaverImportError("The .qp package does not contain any .qua charts")
        for info in entries:
            try:
                payload = archive.read(info)
                bundle = parse_qua_bytes(payload, PurePosixPath(info.filename).name)
                audio_entry = _resolve_archive_file(info.filename, bundle["summary"].get("audio_filename", ""), names, SUPPORTED_AUDIO_SUFFIXES)
                difficulties.append(_preview_row(bundle, entry_name=info.filename, has_audio=bool(audio_entry), audio_entry=audio_entry))
            except Exception as exc:
                unsupported.append({"entry_name": info.filename, "error": str(exc)})
    if not difficulties:
        raise QuaverImportError("The .qp package contains no supported 4K–9K Quaver charts")
    first = difficulties[0]
    return {
        "kind": "qp", "filename": path.name, "title": first["title"], "artist": first["artist"],
        "difficulties": difficulties, "unsupported": unsupported, "warnings": [],
    }
