from __future__ import annotations

import bisect
import csv
import hashlib
import io
import math
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

IMPORTER_VERSION = "1.0"
SUPPORTED_KEY_COUNTS = tuple(range(4, 10))
SUPPORTED_AUDIO_SUFFIXES = {".ogg", ".mp3", ".wav", ".flac", ".m4a", ".aac", ".opus", ".webm"}
MAX_OSZ_FILES = 20_000
MAX_OSZ_UNCOMPRESSED = 4_000_000_000
MAX_OSU_BYTES = 64_000_000


class OsuImportError(ValueError):
    pass


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        result = float(str(value).strip())
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return default


def _decode_osu_bytes(payload: bytes) -> str:
    if len(payload) > MAX_OSU_BYTES:
        raise OsuImportError("The .osu chart is larger than the 64 MB safety limit")
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    return payload.decode("utf-8", errors="replace")


def _parse_sections(text: str) -> tuple[int, dict[str, list[str]]]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    version = 0
    if lines:
        match = re.match(r"\s*osu file format v(\d+)\s*$", lines[0], re.IGNORECASE)
        if match:
            version = int(match.group(1))
    sections: dict[str, list[str]] = defaultdict(list)
    current = ""
    for raw in lines[1:] if version else lines:
        line = raw.strip().lstrip("\ufeff")
        if not line or line.startswith("//"):
            continue
        if line.startswith("[") and line.endswith("]"):
            current = line[1:-1].strip()
            continue
        if current:
            sections[current].append(line)
    if not sections:
        raise OsuImportError("This does not look like an osu! beatmap file")
    return version, dict(sections)


def _key_values(lines: Iterable[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in lines:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        result[key.strip()] = value.strip()
    return result


def _csv_fields(line: str) -> list[str]:
    try:
        return next(csv.reader(io.StringIO(line), skipinitialspace=False))
    except Exception:
        return line.split(",")


def _normalize_zip_name(name: str) -> str:
    if "\\" in name:
        name = name.replace("\\", "/")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise OsuImportError("The .osz archive contains an unsafe path")
    return "/".join(path.parts)


def _zip_is_symlink(info: zipfile.ZipInfo) -> bool:
    return ((info.external_attr >> 16) & 0o170000) == 0o120000


def validate_osz(path: Path) -> dict[str, zipfile.ZipInfo]:
    if not zipfile.is_zipfile(path):
        raise OsuImportError("This file is not a valid .osz/ZIP archive")
    with zipfile.ZipFile(path, "r") as archive:
        infos = archive.infolist()
        if len(infos) > MAX_OSZ_FILES:
            raise OsuImportError("The .osz archive contains too many files")
        if sum(max(0, int(info.file_size)) for info in infos) > MAX_OSZ_UNCOMPRESSED:
            raise OsuImportError("The .osz archive expands beyond the 4 GB safety limit")
        names: dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            normalized = _normalize_zip_name(info.filename)
            if info.flag_bits & 0x1:
                raise OsuImportError("Encrypted .osz entries are not supported")
            if _zip_is_symlink(info):
                raise OsuImportError("Symbolic links are not allowed in .osz archives")
            if info.is_dir():
                continue
            names[normalized.casefold()] = info
        if not any(name.endswith(".osu") for name in names):
            raise OsuImportError("No .osu beatmaps were found in this .osz archive")
        return names


def find_archive_entry(
    names: dict[str, zipfile.ZipInfo], requested: str, relative_to: str = ""
) -> zipfile.ZipInfo | None:
    normalized = requested.replace("\\", "/").removeprefix("./").strip()
    candidates = [normalized]
    if relative_to:
        parent = PurePosixPath(relative_to.replace("\\", "/")).parent
        if str(parent) not in {"", "."}:
            candidates.insert(0, str(parent / normalized))
    for candidate in candidates:
        key = candidate.casefold()
        if key in names:
            return names[key]
    requested_base = PurePosixPath(normalized.casefold()).name
    matches = [info for name, info in names.items() if PurePosixPath(name).name == requested_base]
    return matches[0] if len(matches) == 1 else None


def parse_timing_points(lines: Iterable[str]) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    for index, line in enumerate(lines):
        fields = _csv_fields(line)
        if len(fields) < 2:
            continue
        offset = _safe_float(fields[0])
        beat_length = _safe_float(fields[1])
        if not math.isfinite(offset) or not math.isfinite(beat_length) or beat_length == 0:
            continue
        uninherited = _safe_int(fields[6], 1) == 1 if len(fields) > 6 else beat_length > 0
        point = {
            "index": index,
            "time_ms": offset,
            "beat_length": beat_length,
            "meter": max(1, _safe_int(fields[2], 4)) if len(fields) > 2 else 4,
            "sample_set": _safe_int(fields[3], 0) if len(fields) > 3 else 0,
            "sample_index": _safe_int(fields[4], 0) if len(fields) > 4 else 0,
            "volume": min(100, max(0, _safe_int(fields[5], 100))) if len(fields) > 5 else 100,
            "uninherited": uninherited,
            "effects": _safe_int(fields[7], 0) if len(fields) > 7 else 0,
        }
        if uninherited and beat_length > 0:
            point["bpm"] = 60000.0 / beat_length
            point["sv_multiplier"] = 1.0
        else:
            point["bpm"] = None
            point["sv_multiplier"] = max(0.1, min(10.0, -100.0 / beat_length)) if beat_length < 0 else 1.0
        points.append(point)
    points.sort(key=lambda row: (float(row["time_ms"]), int(row["index"])))
    return points


def _active_bpm(base_points: list[dict[str, Any]], time_ms: float) -> tuple[int, float]:
    if not base_points:
        return 0, 0.0
    times = [float(row["time_ms"]) for row in base_points]
    index = max(0, bisect.bisect_right(times, time_ms) - 1)
    return index, float(base_points[index].get("bpm") or 0.0)


def _parse_breaks(lines: Iterable[str]) -> list[dict[str, Any]]:
    breaks: list[dict[str, Any]] = []
    for line in lines:
        fields = _csv_fields(line)
        if not fields or fields[0].strip() != "2" or len(fields) < 3:
            continue
        start = _safe_float(fields[1])
        end = _safe_float(fields[2])
        if end > start:
            breaks.append({"start_ms": start, "end_ms": end})
    return breaks


def _difficulty_label(metadata: dict[str, str], fallback: str) -> str:
    return metadata.get("Version") or Path(fallback).stem


def _display_title(metadata: dict[str, str], fallback: str) -> str:
    title = metadata.get("TitleUnicode") or metadata.get("Title") or Path(fallback).stem
    artist = metadata.get("ArtistUnicode") or metadata.get("Artist") or ""
    version = _difficulty_label(metadata, fallback)
    prefix = f"{artist} - " if artist else ""
    suffix = f" [{version}]" if version else ""
    return f"{prefix}{title}{suffix}".strip()


def parse_osu_text(text: str, source_name: str = "beatmap.osu") -> dict[str, Any]:
    file_version, sections = _parse_sections(text)
    general = _key_values(sections.get("General", []))
    editor = _key_values(sections.get("Editor", []))
    metadata = _key_values(sections.get("Metadata", []))
    difficulty = _key_values(sections.get("Difficulty", []))

    mode = _safe_int(general.get("Mode"), 0)
    if mode != 3:
        raise OsuImportError(f"{source_name} is osu! mode {mode}, not osu!mania")
    key_count = int(round(_safe_float(difficulty.get("CircleSize"), 0.0)))
    if key_count not in SUPPORTED_KEY_COUNTS:
        raise OsuImportError(f"{source_name} uses {key_count} keys; Rhythm Input Lab currently supports 4K through 9K")

    timing_points = parse_timing_points(sections.get("TimingPoints", []))
    base_points = [row for row in timing_points if row["uninherited"] and float(row["beat_length"]) > 0]
    if not base_points:
        base_points = [{"index": 0, "time_ms": 0.0, "beat_length": 500.0, "meter": 4, "bpm": 120.0, "uninherited": True, "sv_multiplier": 1.0}]
    notes: list[dict[str, Any]] = []
    ignored_objects = Counter()
    invalid_objects = 0

    for raw_index, line in enumerate(sections.get("HitObjects", [])):
        fields = _csv_fields(line)
        if len(fields) < 5:
            invalid_objects += 1
            continue
        x = _safe_float(fields[0], -1)
        time_ms = _safe_float(fields[2], -1)
        type_bits = _safe_int(fields[3], 0)
        if x < 0 or time_ms < 0:
            invalid_objects += 1
            continue
        is_hold = bool(type_bits & 128)
        is_tap = bool(type_bits & 1)
        if not (is_hold or is_tap):
            ignored_objects[str(type_bits)] += 1
            continue
        lane = min(key_count - 1, max(0, int(math.floor(x * key_count / 512.0))))
        end_ms = time_ms
        object_params = fields[5] if len(fields) > 5 else ""
        hit_sample = fields[6] if len(fields) > 6 else ""
        if is_hold:
            end_token = object_params.split(":", 1)[0]
            end_ms = max(time_ms, _safe_float(end_token, time_ms))
        section_index, bpm = _active_bpm(base_points, time_ms)
        sustain_ms = max(0.0, end_ms - time_ms)
        notes.append({
            "time_ms": time_ms,
            "end_ms": end_ms,
            "lane": lane,
            "raw_lane": lane,
            "sustain_ms": sustain_ms,
            "owner": "player",
            "section_index": section_index,
            "must_hit_section": True,
            "bpm": bpm,
            "note_type": "",
            "extra_data": [{
                "osu_type_bits": type_bits,
                "hit_sound": _safe_int(fields[4]),
                "object_params": object_params,
                "hit_sample": hit_sample,
                "source_index": raw_index,
            }],
            "raw": fields,
        })
    notes.sort(key=lambda row: (float(row["time_ms"]), int(row["lane"])))
    if not notes:
        raise OsuImportError(f"{source_name} contains no playable osu!mania hit objects")

    events: list[dict[str, Any]] = []
    event_index = 0
    for point_index, point in enumerate(timing_points):
        if point["uninherited"] and point.get("bpm"):
            if point_index == 0 and float(point["time_ms"]) <= 0:
                continue
            name = "osu! BPM change"
            value1 = round(float(point["bpm"]), 6)
            value2 = int(point["meter"])
        elif not point["uninherited"]:
            name = "osu! SV change"
            value1 = round(float(point["sv_multiplier"]), 6)
            value2 = round(float(point["beat_length"]), 6)
        else:
            continue
        events.append({
            "time_ms": float(point["time_ms"]),
            "name": name,
            "value1": value1,
            "value2": value2,
            "source": "osu.TimingPoints",
            "group_index": event_index,
            "event_index": 0,
            "raw": point,
        })
        event_index += 1

    breaks = _parse_breaks(sections.get("Events", []))
    for break_row in breaks:
        events.append({
            "time_ms": break_row["start_ms"],
            "name": "osu! Break",
            "value1": break_row["end_ms"],
            "value2": break_row["end_ms"] - break_row["start_ms"],
            "source": "osu.Events",
            "group_index": event_index,
            "event_index": 0,
            "raw": break_row,
        })
        event_index += 1
    events.sort(key=lambda row: (float(row["time_ms"]), str(row["name"])))

    sections_out = [
        {
            "section_index": index,
            "time_ms": float(point["time_ms"]),
            "bpm": float(point.get("bpm") or 0.0),
            "change_bpm": index > 0,
            "must_hit_section": True,
            "length_in_steps": max(1, int(point.get("meter") or 4) * 4),
        }
        for index, point in enumerate(base_points)
    ]

    lane_counts = Counter(int(row["lane"]) for row in notes)
    hold_count = sum(float(row["sustain_ms"]) > 0 for row in notes)
    duration_ms = max(float(row["end_ms"]) for row in notes)
    bpms = [float(row["bpm"]) for row in base_points if row.get("bpm")]
    event_counts = Counter(str(row["name"]) for row in events)
    audio_filename = general.get("AudioFilename", "").strip()
    title = metadata.get("TitleUnicode") or metadata.get("Title") or Path(source_name).stem
    artist = metadata.get("ArtistUnicode") or metadata.get("Artist") or ""
    version = _difficulty_label(metadata, source_name)
    creator = metadata.get("Creator", "")
    song_name = _display_title(metadata, source_name)
    source_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()

    warnings: list[str] = []
    if invalid_objects:
        warnings.append(f"Ignored {invalid_objects} malformed hit object row(s).")
    if ignored_objects:
        warnings.append(f"Ignored {sum(ignored_objects.values())} non-mania hit object(s).")
    if not audio_filename:
        warnings.append("AudioFilename is missing; audio must be attached manually.")

    summary = {
        "format": "osu_mania",
        "source_format": "osu_mania",
        "importer_version": IMPORTER_VERSION,
        "source_name": source_name,
        "source_sha256": source_hash,
        "osu_file_version": file_version,
        "song_name": song_name,
        "song_id": re.sub(r"[^a-z0-9]+", "-", song_name.casefold()).strip("-") or "osu-mania-song",
        "title": title,
        "artist": artist,
        "difficulty": version,
        "charter": creator,
        "key_count": key_count,
        "base_bpm": bpms[0] if bpms else 0.0,
        "min_bpm": min(bpms) if bpms else 0.0,
        "max_bpm": max(bpms) if bpms else 0.0,
        "dynamic_bpm": len({round(value, 6) for value in bpms}) > 1,
        "bpm_changes": [
            {"section_index": index, "time_ms": float(point["time_ms"]), "bpm": float(point.get("bpm") or 0.0)}
            for index, point in enumerate(base_points)
            if index > 0
        ],
        "scroll_speed": 1.0,
        "section_count": len(sections_out),
        "total_notes": len(notes),
        "player_notes": len(notes),
        "opponent_notes": 0,
        "event_notes": 0,
        "sustain_notes": hold_count,
        "event_count": len(events),
        "unique_event_types": len(event_counts),
        "unique_note_types": 1,
        "duration_ms": duration_ms,
        "player_lane_counts": {str(key): value for key, value in sorted(lane_counts.items())},
        "raw_lane_counts": {str(key): value for key, value in sorted(lane_counts.items())},
        "note_type_counts": {"(normal)": len(notes)},
        "event_type_counts": dict(event_counts),
        "authored_hazard_notes": 0,
        "dodge_event_markers": 0,
        "audio_filename": audio_filename,
        "preview_time_ms": _safe_int(general.get("PreviewTime"), -1),
        "beatmap_id": _safe_int(metadata.get("BeatmapID"), -1),
        "beatmap_set_id": _safe_int(metadata.get("BeatmapSetID"), -1),
        "warnings": warnings,
    }
    mappings = {
        "event_types": {
            "osu! BPM change": {"category": "timing", "gameplay": True, "expected_presses": 0},
            "osu! SV change": {"category": "scroll_speed", "gameplay": True, "expected_presses": 0},
            "osu! Break": {"category": "presentation", "gameplay": False, "expected_presses": 0},
        },
        "note_types": {"": {"category": "normal", "gameplay": True, "should_press": True}},
        "notes": [
            "Imported from osu!mania into the neutral RIL chart model.",
            "Timing points and source-specific values remain in song_metadata.json and RIL extensions.",
            "Rhythm Input Lab uses its configured judgment windows rather than claiming official osu! scores.",
        ],
    }
    return {
        "summary": summary,
        "notes": notes,
        "events": events,
        "sections": sections_out,
        "mappings": mappings,
        "song_metadata": {
            "source_format": "osu_mania",
            "source_name": source_name,
            "file_version": file_version,
            "general": general,
            "editor": editor,
            "metadata": metadata,
            "difficulty": difficulty,
            "timing_points": timing_points,
            "breaks": breaks,
            "ignored_hit_object_types": dict(ignored_objects),
            "warnings": warnings,
        },
    }


def read_osu_file(path: Path) -> dict[str, Any]:
    return parse_osu_text(_decode_osu_bytes(path.read_bytes()), path.name)


def inspect_osu_file(path: Path) -> dict[str, Any]:
    bundle = read_osu_file(path)
    summary = bundle["summary"]
    return {
        "kind": "osu",
        "filename": path.name,
        "difficulties": [{
            "id": summary["source_sha256"][:20],
            "entry_name": path.name,
            "song_name": summary["song_name"],
            "title": summary["title"],
            "artist": summary["artist"],
            "creator": summary["charter"],
            "version": summary["difficulty"],
            "key_count": summary["key_count"],
            "base_bpm": summary["base_bpm"],
            "min_bpm": summary["min_bpm"],
            "max_bpm": summary["max_bpm"],
            "duration_ms": summary["duration_ms"],
            "notes": summary["player_notes"],
            "holds": summary["sustain_notes"],
            "audio_filename": summary["audio_filename"],
            "has_audio": False,
            "warnings": list(summary.get("warnings") or []) + ["Standalone .osu files do not contain audio; attach it after import."],
        }],
        "unsupported": [],
        "warnings": ["Standalone .osu import preserves the chart but cannot automatically include its audio file."],
    }


def inspect_osz(path: Path) -> dict[str, Any]:
    names = validate_osz(path)
    difficulties: list[dict[str, Any]] = []
    unsupported: list[dict[str, Any]] = []
    with zipfile.ZipFile(path, "r") as archive:
        osu_infos = sorted((info for name, info in names.items() if name.endswith(".osu")), key=lambda info: info.filename.casefold())
        for info in osu_infos:
            try:
                text = _decode_osu_bytes(archive.read(info))
                bundle = parse_osu_text(text, PurePosixPath(info.filename).name)
                summary = bundle["summary"]
                audio_filename = summary.get("audio_filename") or ""
                audio_entry = find_archive_entry(names, str(audio_filename), info.filename) if audio_filename else None
                diff_id = hashlib.sha256((info.filename + "\0" + summary["source_sha256"]).encode("utf-8")).hexdigest()[:20]
                difficulties.append({
                    "id": diff_id,
                    "entry_name": _normalize_zip_name(info.filename),
                    "song_name": summary["song_name"],
                    "title": summary["title"],
                    "artist": summary["artist"],
                    "creator": summary["charter"],
                    "version": summary["difficulty"],
                    "key_count": summary["key_count"],
                    "base_bpm": summary["base_bpm"],
                    "min_bpm": summary["min_bpm"],
                    "max_bpm": summary["max_bpm"],
                    "duration_ms": summary["duration_ms"],
                    "notes": summary["player_notes"],
                    "holds": summary["sustain_notes"],
                    "audio_filename": audio_filename,
                    "audio_entry": _normalize_zip_name(audio_entry.filename) if audio_entry else None,
                    "has_audio": audio_entry is not None and Path(audio_entry.filename).suffix.casefold() in SUPPORTED_AUDIO_SUFFIXES,
                    "warnings": list(summary.get("warnings") or []) + ([] if audio_entry else ["Referenced audio was not found in the .osz archive."]),
                })
            except Exception as exc:
                unsupported.append({"entry_name": _normalize_zip_name(info.filename), "error": str(exc)})
    if not difficulties:
        detail = unsupported[0]["error"] if unsupported else "No supported difficulties were found"
        raise OsuImportError(f"This .osz has no supported 4K–9K osu!mania difficulties: {detail}")
    first = difficulties[0]
    return {
        "kind": "osz",
        "filename": path.name,
        "title": first["title"],
        "artist": first["artist"],
        "difficulties": difficulties,
        "unsupported": unsupported,
        "warnings": [f"Skipped {len(unsupported)} unsupported or invalid .osu file(s)."] if unsupported else [],
    }


def inspect_source(path: Path) -> dict[str, Any]:
    suffix = path.suffix.casefold()
    if suffix == ".osu":
        return inspect_osu_file(path)
    if suffix == ".osz":
        return inspect_osz(path)
    raise OsuImportError("Choose a standalone .osu chart or an .osz beatmap set")
