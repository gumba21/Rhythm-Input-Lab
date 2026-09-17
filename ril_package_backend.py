from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
import uuid
import zipfile
from collections import Counter
from pathlib import Path, PurePosixPath
from types import ModuleType
from typing import Any, BinaryIO

import fnf_importer
import rhythm_input_lab_core as core

RIL_PACKAGE_VERSION = 1
RIL_CHART_VERSION = 1
PACKAGE_TYPE = "playable_song"
_ALLOWED_AUDIO_SUFFIXES = {".ogg", ".mp3", ".wav", ".flac", ".m4a", ".aac", ".opus", ".webm"}
_ALLOWED_PACKAGE_PATHS = {"manifest.json", "chart.json"}
_UPLOAD_ID = re.compile(r"^[A-Za-z0-9_-]{8,96}$")
_DOWNLOAD_TOKEN = re.compile(r"^[a-f0-9]{32}$")
_MAX_CHUNK_BYTES = 2_000_000
_MAX_PACKAGE_BYTES = 1_500_000_000
_MAX_UNCOMPRESSED_BYTES = 2_000_000_000
_MAX_FILES = 32
_MAX_CHART_BYTES = 256_000_000
_STREAM_CHUNK = 512 * 1024
_TEMP_ROOT = Path(tempfile.gettempdir()) / "RhythmInputLab" / "ril-packages"
_LOCK = threading.RLock()
_CLIENT_DISCONNECT_WINERRORS = {10053, 10054}
_OWNER_TO_CODE = {"player": 0, "opponent": 1, "event": 2}
_CODE_TO_OWNER = {value: key for key, value in _OWNER_TO_CODE.items()}


def _compact_number(value: Any, default: float = 0.0) -> int | float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    rounded = round(number, 6)
    return int(rounded) if rounded.is_integer() else rounded


def _json_bytes(payload: Any, *, pretty: bool = False) -> bytes:
    if pretty:
        return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(_STREAM_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _clean_username(value: Any) -> str:
    text = re.sub(r"[\x00-\x1f\x7f]", "", str(value or "")).strip()
    return text[:48]


def _client_disconnected(exc: BaseException) -> bool:
    return isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)) or (
        isinstance(exc, OSError) and getattr(exc, "winerror", None) in _CLIENT_DISCONNECT_WINERRORS
    )


def bundle_to_compact_chart(bundle: dict[str, Any]) -> dict[str, Any]:
    """Convert the runtime bundle into the compact, format-neutral RIL chart document."""
    if not isinstance(bundle, dict) or not isinstance(bundle.get("summary"), dict):
        raise ValueError("A normalized chart bundle is required")
    summary = dict(bundle["summary"])
    key_count = int(summary.get("key_count") or 0)
    if key_count not in range(4, 10):
        raise ValueError("RIL charts currently support 4K through 9K")

    notes = list(bundle.get("notes") or [])
    events = list(bundle.get("events") or [])
    sections = list(bundle.get("sections") or [])
    note_types = sorted({str(row.get("note_type") or "") for row in notes}, key=str.casefold)
    if "" in note_types:
        note_types.remove("")
    note_types.insert(0, "")
    event_names = sorted({str(row.get("name") or "Unknown Event") for row in events}, key=str.casefold)
    event_sources = sorted({str(row.get("source") or "") for row in events}, key=str.casefold)
    note_type_ids = {value: index for index, value in enumerate(note_types)}
    event_name_ids = {value: index for index, value in enumerate(event_names)}
    event_source_ids = {value: index for index, value in enumerate(event_sources)}

    compact_notes: list[list[Any]] = []
    for note in notes:
        row: list[Any] = [
            _compact_number(note.get("time_ms")),
            -1 if note.get("lane") is None else int(note.get("lane")),
            _compact_number(note.get("sustain_ms")),
            _OWNER_TO_CODE.get(str(note.get("owner") or "player"), 0),
            int(note.get("section_index") or 0),
            note_type_ids.get(str(note.get("note_type") or ""), 0),
            int(note.get("raw_lane") if note.get("raw_lane") is not None else note.get("lane") or 0),
            _compact_number(note.get("bpm"), summary.get("base_bpm") or 0),
        ]
        extra = note.get("extra_data")
        if isinstance(extra, list) and extra:
            row.append(extra)
        compact_notes.append(row)

    compact_events: list[list[Any]] = []
    for event in events:
        name = str(event.get("name") or "Unknown Event")
        source = str(event.get("source") or "")
        row = [
            _compact_number(event.get("time_ms")),
            event_name_ids[name],
            event.get("value1", ""),
            event.get("value2", ""),
            event_source_ids.get(source, 0),
        ]
        raw = event.get("raw")
        if raw is not None:
            row.append(raw)
        compact_events.append(row)

    compact_sections = [
        [
            int(row.get("section_index") if row.get("section_index") is not None else index),
            _compact_number(row.get("bpm"), summary.get("base_bpm") or 0),
            1 if row.get("change_bpm") else 0,
            1 if row.get("must_hit_section") else 0,
            int(row.get("length_in_steps") or 16),
        ]
        for index, row in enumerate(sections)
    ]

    summary["ril_chart_version"] = RIL_CHART_VERSION
    summary.setdefault("source_format", summary.get("format") or "unknown")
    return {
        "v": RIL_CHART_VERSION,
        "summary": summary,
        "dict": {
            "note_types": note_types,
            "event_names": event_names,
            "event_sources": event_sources,
        },
        "n": compact_notes,
        "e": compact_events,
        "s": compact_sections,
        "m": bundle.get("mappings") or {"note_types": {}, "event_types": {}},
        "x": bundle.get("song_metadata") or {},
    }


def compact_chart_to_bundle(document: dict[str, Any]) -> dict[str, Any]:
    """Expand a compact RIL chart into the existing neutral runtime bundle."""
    if not isinstance(document, dict):
        raise ValueError("RIL chart must be a JSON object")
    version = int(document.get("v") or 0)
    if version != RIL_CHART_VERSION:
        raise ValueError(f"Unsupported RIL chart version {version}")
    summary = dict(document.get("summary") or {})
    key_count = int(summary.get("key_count") or 0)
    if key_count not in range(4, 10):
        raise ValueError("RIL chart key mode must be between 4K and 9K")

    dictionaries = document.get("dict") or {}
    note_types = list(dictionaries.get("note_types") or [""])
    event_names = list(dictionaries.get("event_names") or [])
    event_sources = list(dictionaries.get("event_sources") or [""])
    raw_sections = list(document.get("s") or [])
    sections: list[dict[str, Any]] = []
    section_hit: dict[int, bool] = {}
    for index, row in enumerate(raw_sections):
        if not isinstance(row, list) or len(row) < 5:
            raise ValueError(f"Invalid RIL section row {index}")
        section_index = int(row[0])
        section = {
            "section_index": section_index,
            "bpm": float(row[1]),
            "change_bpm": bool(row[2]),
            "must_hit_section": bool(row[3]),
            "length_in_steps": int(row[4]),
        }
        sections.append(section)
        section_hit[section_index] = section["must_hit_section"]

    raw_notes = list(document.get("n") or [])
    if len(raw_notes) > 5_000_000:
        raise ValueError("RIL chart has too many notes")
    notes: list[dict[str, Any]] = []
    for index, row in enumerate(raw_notes):
        if not isinstance(row, list) or len(row) < 8:
            raise ValueError(f"Invalid RIL note row {index}")
        time_ms = float(row[0])
        lane_raw = int(row[1])
        sustain_ms = max(0.0, float(row[2]))
        owner = _CODE_TO_OWNER.get(int(row[3]), "player")
        section_index = int(row[4])
        type_id = int(row[5])
        note_type = str(note_types[type_id]) if 0 <= type_id < len(note_types) else ""
        raw_lane = int(row[6])
        bpm = float(row[7])
        extra = list(row[8]) if len(row) > 8 and isinstance(row[8], list) else []
        notes.append({
            "time_ms": time_ms,
            "end_ms": time_ms + sustain_ms,
            "lane": None if lane_raw < 0 else lane_raw,
            "raw_lane": raw_lane,
            "sustain_ms": sustain_ms,
            "owner": owner,
            "section_index": section_index,
            "must_hit_section": section_hit.get(section_index, owner == "player"),
            "bpm": bpm,
            "note_type": note_type,
            "extra_data": extra,
            "raw": [time_ms, raw_lane, sustain_ms, note_type, *extra],
        })
    notes.sort(key=lambda item: (float(item["time_ms"]), int(item.get("raw_lane") or 0)))

    raw_events = list(document.get("e") or [])
    if len(raw_events) > 1_000_000:
        raise ValueError("RIL chart has too many events")
    events: list[dict[str, Any]] = []
    for index, row in enumerate(raw_events):
        if not isinstance(row, list) or len(row) < 5:
            raise ValueError(f"Invalid RIL event row {index}")
        name_id = int(row[1])
        source_id = int(row[4])
        name = str(event_names[name_id]) if 0 <= name_id < len(event_names) else "Unknown Event"
        source = str(event_sources[source_id]) if 0 <= source_id < len(event_sources) else ""
        raw = row[5] if len(row) > 5 else [name, row[2], row[3]]
        events.append({
            "time_ms": float(row[0]),
            "name": name,
            "value1": row[2],
            "value2": row[3],
            "source": source,
            "group_index": index,
            "event_index": 0,
            "raw": raw,
        })
    events.sort(key=lambda item: (float(item["time_ms"]), str(item["name"])))

    player_notes = [note for note in notes if note["owner"] == "player"]
    opponent_notes = [note for note in notes if note["owner"] == "opponent"]
    note_counts = Counter(str(note.get("note_type") or "(normal)") for note in notes)
    event_counts = Counter(str(event.get("name") or "Unknown Event") for event in events)
    duration = max(
        [float(summary.get("duration_ms") or 0)]
        + [float(note["end_ms"]) for note in notes]
        + [float(event["time_ms"]) for event in events]
    )
    summary.update({
        "format": "ril_neutral",
        "ril_chart_version": version,
        "key_count": key_count,
        "total_notes": len(notes),
        "player_notes": len(player_notes),
        "opponent_notes": len(opponent_notes),
        "event_notes": sum(note["owner"] == "event" for note in notes),
        "sustain_notes": sum(float(note["sustain_ms"]) > 0 for note in notes),
        "event_count": len(events),
        "unique_event_types": len(event_counts),
        "unique_note_types": len(note_counts),
        "duration_ms": duration,
        "note_type_counts": dict(note_counts),
        "event_type_counts": dict(event_counts),
        "section_count": len(sections),
    })
    return {
        "summary": summary,
        "notes": notes,
        "events": events,
        "sections": sections,
        "mappings": document.get("m") or {"note_types": {}, "event_types": {}},
        "song_metadata": document.get("x") or {},
    }


def _write_bundle_files(song_folder: Path, bundle: dict[str, Any], compact: dict[str, Any]) -> None:
    chart_folder = song_folder / "chart"
    chart_folder.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ril_chart_source_") as temp_dir:
        original = Path(temp_dir) / "original.ril.json"
        original.write_bytes(_json_bytes(compact, pretty=True))
        fnf_importer.write_chart_bundle(bundle, chart_folder, original)
    (chart_folder / "ril_chart.json").write_bytes(_json_bytes(compact))


def ensure_ril_chart(song_folder: Path, bundle: dict[str, Any] | None = None) -> dict[str, Any] | None:
    chart_path = song_folder / "chart" / "ril_chart.json"
    if chart_path.exists():
        try:
            return json.loads(chart_path.read_text(encoding="utf-8"))
        except Exception:
            chart_path.unlink(missing_ok=True)
    bundle = bundle or fnf_importer.load_chart_bundle(song_folder)
    if not bundle:
        return None
    compact = bundle_to_compact_chart(bundle)
    chart_path.parent.mkdir(parents=True, exist_ok=True)
    chart_path.write_bytes(_json_bytes(compact))
    return compact


def _media_rows(song_folder: Path) -> dict[str, dict[str, Any]]:
    try:
        song_meta = json.loads((song_folder / "song.json").read_text(encoding="utf-8"))
    except Exception:
        song_meta = {}
    rows: dict[str, dict[str, Any]] = {}
    media = song_meta.get("media") if isinstance(song_meta.get("media"), dict) else {}
    for kind in ("instrumental", "vocals"):
        row = media.get(kind) if isinstance(media, dict) else None
        stored_name = Path(str((row or {}).get("stored_name") or "")).name
        candidate = song_folder / "audio" / stored_name
        if stored_name and candidate.is_file() and candidate.suffix.casefold() in _ALLOWED_AUDIO_SUFFIXES:
            rows[kind] = {
                "path": candidate,
                "filename": str((row or {}).get("filename") or stored_name),
                "stored_name": stored_name,
            }
            continue
        audio_dir = song_folder / "audio"
        if audio_dir.exists():
            fallback = next((p for p in audio_dir.iterdir() if p.is_file() and p.stem.casefold() == kind and p.suffix.casefold() in _ALLOWED_AUDIO_SUFFIXES), None)
            if fallback:
                rows[kind] = {"path": fallback, "filename": fallback.name, "stored_name": fallback.name}
    return rows


def _file_descriptor(path: str, role: str, payload: bytes | None = None, source: Path | None = None) -> dict[str, Any]:
    if payload is not None:
        size = len(payload)
        digest = _sha256_bytes(payload)
    elif source is not None:
        size = int(source.stat().st_size)
        digest = _sha256_file(source)
    else:
        raise ValueError("Package file descriptor needs bytes or a source path")
    mime, _ = mimetypes.guess_type(path)
    return {"path": path, "role": role, "size": size, "sha256": digest, "mime": mime or "application/octet-stream"}


def create_ril_package(
    song_folder: Path,
    bundle: dict[str, Any],
    destination: Path,
    *,
    username: str = "",
    include_instrumental: bool = True,
    include_vocals: bool = True,
    include_original: bool = False,
    app_version: str = "",
) -> dict[str, Any]:
    compact = bundle_to_compact_chart(bundle)
    chart_bytes = _json_bytes(compact)
    summary = bundle["summary"]
    song_meta_path = song_folder / "song.json"
    try:
        song_meta = json.loads(song_meta_path.read_text(encoding="utf-8"))
    except Exception:
        song_meta = {}
    media = _media_rows(song_folder)
    files = [_file_descriptor("chart.json", "chart", payload=chart_bytes)]
    included: list[tuple[str, Path, str]] = []
    if include_instrumental and "instrumental" in media:
        source = media["instrumental"]["path"]
        arc = f"audio/instrumental{source.suffix.casefold()}"
        included.append((arc, source, "instrumental"))
        files.append(_file_descriptor(arc, "instrumental", source=source))
    if include_vocals and "vocals" in media:
        source = media["vocals"]["path"]
        arc = f"audio/vocals{source.suffix.casefold()}"
        included.append((arc, source, "vocals"))
        files.append(_file_descriptor(arc, "vocals", source=source))

    source_file: Path | None = None
    if include_original:
        chart_dir = song_folder / "chart"
        candidates = sorted(chart_dir.glob("original*.json")) if chart_dir.exists() else []
        source_file = candidates[0] if candidates else None
        if source_file:
            arc = f"source/{core.safe_name(source_file.name, 'original.json')}"
            included.append((arc, source_file, "original_source"))
            files.append(_file_descriptor(arc, "original_source", source=source_file))

    exported_by = _clean_username(username)
    manifest = {
        "ril_package": RIL_PACKAGE_VERSION,
        "package_type": PACKAGE_TYPE,
        "package_id": uuid.uuid4().hex,
        "created_at": _iso_now(),
        "app": {"name": "Rhythm Input Lab", "version": str(app_version or song_meta.get("ril", {}).get("app_version") or "")},
        "exported_by": {"username": exported_by},
        "song": {
            "title": str(summary.get("song_name") or song_meta.get("song_name") or song_folder.name),
            "song_id": str(summary.get("song_id") or song_meta.get("song_id") or core.song_id(song_folder.name)),
            "key_count": int(summary.get("key_count") or 4),
            "base_bpm": summary.get("base_bpm"),
            "duration_ms": summary.get("duration_ms"),
            "difficulty": str(song_meta.get("difficulty") or ""),
            "source_format": str(summary.get("source_format") or summary.get("format") or "unknown"),
            "original_charter": str(song_meta.get("charter") or song_meta.get("original_charter") or ""),
        },
        "content": {
            "chart": "chart.json",
            "instrumental": next((row[0] for row in included if row[2] == "instrumental"), None),
            "vocals": next((row[0] for row in included if row[2] == "vocals"), None),
            "original_source": next((row[0] for row in included if row[2] == "original_source"), None),
        },
        "files": files,
        "capabilities": {
            "playable": True,
            "chart_version": RIL_CHART_VERSION,
            "contains_audio": any(row[2] in {"instrumental", "vocals"} for row in included),
            "contains_attempts": False,
        },
    }
    manifest_bytes = _json_bytes(manifest, pretty=True)

    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", allowZip64=True) as archive:
        archive.writestr("manifest.json", manifest_bytes, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        archive.writestr("chart.json", chart_bytes, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        for arc, source, role in included:
            compression = zipfile.ZIP_DEFLATED if source.suffix.casefold() == ".wav" else zipfile.ZIP_STORED
            archive.write(source, arc, compress_type=compression, compresslevel=6 if compression == zipfile.ZIP_DEFLATED else None)
    if destination.stat().st_size > _MAX_PACKAGE_BYTES:
        destination.unlink(missing_ok=True)
        raise ValueError("The exported RIL package exceeds the 1.5 GB safety limit")
    return manifest


def _safe_archive_name(name: str) -> str:
    if "\\" in name:
        raise ValueError("RIL package contains a Windows-style archive path")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("RIL package contains an unsafe path")
    return str(path)


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return ((info.external_attr >> 16) & 0o170000) == 0o120000


def inspect_ril_package(package_path: Path, *, verify_hashes: bool = True) -> dict[str, Any]:
    if not package_path.is_file() or package_path.stat().st_size > _MAX_PACKAGE_BYTES:
        raise ValueError("RIL package is missing or too large")
    if not zipfile.is_zipfile(package_path):
        raise ValueError("This file is not a valid RIL/ZIP package")
    with zipfile.ZipFile(package_path, "r") as archive:
        infos = archive.infolist()
        if len(infos) > _MAX_FILES:
            raise ValueError("RIL package contains too many files")
        total_uncompressed = sum(max(0, int(info.file_size)) for info in infos)
        if total_uncompressed > _MAX_UNCOMPRESSED_BYTES:
            raise ValueError("RIL package expands beyond the 2 GB safety limit")
        names: dict[str, zipfile.ZipInfo] = {}
        for info in infos:
            name = _safe_archive_name(info.filename)
            if info.flag_bits & 0x1:
                raise ValueError("Encrypted RIL packages are not supported")
            if _is_symlink(info):
                raise ValueError("RIL packages may not contain symbolic links")
            if info.is_dir():
                continue
            allowed = name in _ALLOWED_PACKAGE_PATHS or name.startswith("audio/") or name.startswith("source/")
            if not allowed:
                raise ValueError(f"Unsupported file in RIL package: {name}")
            if name.startswith("audio/") and Path(name).suffix.casefold() not in _ALLOWED_AUDIO_SUFFIXES:
                raise ValueError(f"Unsupported audio type in RIL package: {name}")
            if name.startswith("source/") and Path(name).suffix.casefold() != ".json":
                raise ValueError("Only JSON source files may be embedded")
            names[name] = info
        if "manifest.json" not in names or "chart.json" not in names:
            raise ValueError("RIL package needs manifest.json and chart.json")
        if names["manifest.json"].file_size > 1_000_000:
            raise ValueError("RIL manifest is too large")
        if names["chart.json"].file_size > _MAX_CHART_BYTES:
            raise ValueError("RIL chart is too large")
        manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        if int(manifest.get("ril_package") or 0) != RIL_PACKAGE_VERSION:
            raise ValueError(f"Unsupported RIL package version {manifest.get('ril_package')}")
        if manifest.get("package_type") != PACKAGE_TYPE:
            raise ValueError("This RIL package is not a playable song")
        chart_document = json.loads(archive.read("chart.json").decode("utf-8"))
        bundle = compact_chart_to_bundle(chart_document)

        declared = {str(row.get("path")): row for row in manifest.get("files") or [] if isinstance(row, dict)}
        for required in ("chart.json",):
            if required not in declared:
                raise ValueError(f"Manifest does not declare {required}")
        if verify_hashes:
            for name, row in declared.items():
                if name not in names:
                    raise ValueError(f"Manifest references missing file: {name}")
                info = names[name]
                if int(row.get("size") or -1) != int(info.file_size):
                    raise ValueError(f"Size check failed for {name}")
                digest = hashlib.sha256()
                with archive.open(info, "r") as source:
                    while chunk := source.read(_STREAM_CHUNK):
                        digest.update(chunk)
                if digest.hexdigest() != str(row.get("sha256") or ""):
                    raise ValueError(f"Integrity check failed for {name}")

        song = manifest.get("song") if isinstance(manifest.get("song"), dict) else {}
        content = manifest.get("content") if isinstance(manifest.get("content"), dict) else {}
        mappings = bundle.get("mappings") or {}
        unmapped_events = [name for name, row in (mappings.get("event_types") or {}).items() if str((row or {}).get("category") or "unmapped") == "unmapped"]
        custom_notes = [name for name, row in (mappings.get("note_types") or {}).items() if str((row or {}).get("category") or "custom") == "custom" and name]
        warnings: list[str] = []
        if not content.get("instrumental"):
            warnings.append("No instrumental is included; playback will be silent unless audio is added locally.")
        if unmapped_events:
            warnings.append(f"{len(unmapped_events)} custom event type(s) are preserved but may not affect gameplay.")
        if custom_notes:
            warnings.append(f"{len(custom_notes)} custom note type(s) are preserved using their saved mechanic mappings.")
        return {
            "manifest": manifest,
            "chart": chart_document,
            "bundle": bundle,
            "names": names,
            "preview": {
                "package_id": str(manifest.get("package_id") or ""),
                "title": str(song.get("title") or bundle["summary"].get("song_name") or package_path.stem),
                "song_id": str(song.get("song_id") or bundle["summary"].get("song_id") or ""),
                "key_count": int(song.get("key_count") or bundle["summary"].get("key_count") or 4),
                "base_bpm": song.get("base_bpm", bundle["summary"].get("base_bpm")),
                "duration_ms": song.get("duration_ms", bundle["summary"].get("duration_ms")),
                "difficulty": str(song.get("difficulty") or ""),
                "source_format": str(song.get("source_format") or bundle["summary"].get("source_format") or "unknown"),
                "original_charter": str(song.get("original_charter") or ""),
                "exported_by": _clean_username((manifest.get("exported_by") or {}).get("username")),
                "created_at": str(manifest.get("created_at") or ""),
                "instrumental": bool(content.get("instrumental")),
                "vocals": bool(content.get("vocals")),
                "original_source": bool(content.get("original_source")),
                "notes": int(bundle["summary"].get("player_notes") or 0),
                "events": int(bundle["summary"].get("event_count") or 0),
                "package_size": int(package_path.stat().st_size),
                "uncompressed_size": total_uncompressed,
                "warnings": warnings,
                "compatible": True,
            },
        }


def _unique_song_folder(root: Path, title: str) -> Path:
    base = core.safe_name(title, "Imported RIL Song")
    candidate = root / base
    suffix = 2
    while candidate.exists():
        candidate = root / f"{base} ({suffix})"
        suffix += 1
    return candidate


def _find_existing_song(app: Any, title: str) -> dict[str, Any] | None:
    target = str(title).casefold()
    return next((row for row in app.list_songs() if str(row.get("song_name") or "").casefold() == target), None)


def _copy_member(archive: zipfile.ZipFile, member: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with archive.open(member, "r") as source, destination.open("wb") as output:
        shutil.copyfileobj(source, output, length=_STREAM_CHUNK)


def import_ril_package(app: Any, package_path: Path, *, mode: str = "separate", app_version: str = "") -> dict[str, Any]:
    inspected = inspect_ril_package(package_path, verify_hashes=True)
    manifest = inspected["manifest"]
    preview = inspected["preview"]
    bundle = inspected["bundle"]
    compact = inspected["chart"]
    title = preview["title"]
    existing = _find_existing_song(app, title)
    if mode not in {"separate", "replace", "merge_audio"}:
        raise ValueError("Unknown RIL import mode")
    if mode in {"replace", "merge_audio"} and existing:
        song_folder = app.song_folder(existing["folder"])
    elif mode == "merge_audio" and not existing:
        mode = "separate"
        song_folder = _unique_song_folder(app.output_root, title)
    elif mode == "replace" and not existing:
        song_folder = app.output_root / core.safe_name(title, "Imported RIL Song")
    else:
        song_folder = _unique_song_folder(app.output_root, title)
    song_folder.mkdir(parents=True, exist_ok=True)

    if mode != "merge_audio":
        if (song_folder / "chart").exists():
            shutil.rmtree(song_folder / "chart")
        _write_bundle_files(song_folder, bundle, compact)

    content = manifest.get("content") or {}
    media_meta: dict[str, Any]
    try:
        current_meta = json.loads((song_folder / "song.json").read_text(encoding="utf-8"))
    except Exception:
        current_meta = {}
    media_meta = current_meta.get("media") if isinstance(current_meta.get("media"), dict) else {}

    with zipfile.ZipFile(package_path, "r") as archive:
        for kind in ("instrumental", "vocals"):
            member = content.get(kind)
            if not member:
                continue
            member = _safe_archive_name(str(member))
            suffix = Path(member).suffix.casefold()
            if suffix not in _ALLOWED_AUDIO_SUFFIXES:
                raise ValueError(f"Unsupported {kind} audio type")
            audio_dir = song_folder / "audio"
            already = any(path.is_file() and path.stem.casefold() == kind for path in audio_dir.glob(f"{kind}.*")) if audio_dir.exists() else False
            if mode == "merge_audio" and already:
                continue
            if audio_dir.exists():
                for old in audio_dir.glob(f"{kind}.*"):
                    if old.is_file():
                        old.unlink(missing_ok=True)
            target = audio_dir / f"{kind}{suffix}"
            _copy_member(archive, member, target)
            media_meta[kind] = {
                "filename": Path(member).name,
                "stored_name": target.name,
                "size_bytes": int(target.stat().st_size),
                "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            }

    imported_at = _iso_now()
    exported_by = _clean_username((manifest.get("exported_by") or {}).get("username"))
    source_song = manifest.get("song") or {}
    song_meta = current_meta if isinstance(current_meta, dict) else {}
    song_meta.update({
        "song_name": title,
        "song_id": str(source_song.get("song_id") or core.song_id(title)),
        "difficulty": str(source_song.get("difficulty") or song_meta.get("difficulty") or ""),
        "original_charter": str(source_song.get("original_charter") or song_meta.get("original_charter") or ""),
        "media": media_meta,
        "ril": {
            "chart_version": RIL_CHART_VERSION,
            "package_version": RIL_PACKAGE_VERSION,
            "app_version": app_version,
            "portable": True,
        },
        "provenance": {
            "imported_from": exported_by,
            "imported_at": imported_at,
            "package_id": str(manifest.get("package_id") or ""),
            "package_created_at": str(manifest.get("created_at") or ""),
            "source_format": str(source_song.get("source_format") or "unknown"),
            "original_charter": str(source_song.get("original_charter") or ""),
        },
    })
    if mode != "merge_audio":
        song_meta["imported_chart"] = {
            "format": "ril_package",
            "key_count": int(bundle["summary"].get("key_count") or 4),
            "player_notes": int(bundle["summary"].get("player_notes") or 0),
            "events": int(bundle["summary"].get("event_count") or 0),
            "importer_version": app_version,
            "imported_at": imported_at,
        }
    (song_folder / "song.json").write_text(json.dumps(song_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    result = next((row for row in app.list_songs() if row.get("folder") == song_folder.name), None)
    return {
        "song": result or {"folder": song_folder.name, "song_name": title},
        "mode": mode,
        "imported_from": exported_by,
        "warnings": preview.get("warnings") or [],
        "mappings": bundle.get("mappings") or {},
    }


def _cleanup_temp(max_age_seconds: int = 24 * 3600) -> None:
    _TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - max_age_seconds
    for child in _TEMP_ROOT.iterdir():
        try:
            if child.stat().st_mtime < cutoff:
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)
                else:
                    child.unlink(missing_ok=True)
        except OSError:
            pass


def _stream_attachment(handler: Any, path: Path, filename: str) -> None:
    size = int(path.stat().st_size)
    handler.send_response(200)
    handler.send_header("Content-Type", "application/vnd.rhythm-input-lab.package")
    handler.send_header("Content-Length", str(size))
    handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    try:
        with path.open("rb") as source:
            while chunk := source.read(_STREAM_CHUNK):
                handler.wfile.write(chunk)
    except OSError as exc:
        if not _client_disconnected(exc):
            raise


def _upload_chunk(app: Any, payload: dict[str, Any]) -> dict[str, Any]:
    upload_id = str(payload.get("upload_id") or "")
    if not _UPLOAD_ID.match(upload_id):
        raise ValueError("Invalid RIL upload id")
    filename = Path(str(payload.get("filename") or "song.ril")).name
    if Path(filename).suffix.casefold() != ".ril":
        raise ValueError("Choose a .ril package")
    index = int(payload.get("index"))
    total = int(payload.get("total"))
    if total < 1 or total > 20_000 or index < 0 or index >= total:
        raise ValueError("Invalid RIL upload chunk")
    raw = base64.b64decode(str(payload.get("data") or ""), validate=True)
    if len(raw) > _MAX_CHUNK_BYTES:
        raise ValueError("RIL upload chunk is too large")
    with _LOCK:
        upload_dir = _TEMP_ROOT / "imports" / upload_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        (upload_dir / "filename.txt").write_text(filename, encoding="utf-8")
        (upload_dir / f"{index:06d}.part").write_bytes(raw)
        received = len(list(upload_dir.glob("*.part")))
        result: dict[str, Any] = {"received": received, "total": total, "complete": False, "upload_id": upload_id}
        if received == total:
            package_path = upload_dir / "package.ril"
            with package_path.open("wb") as output:
                for part_index in range(total):
                    part = upload_dir / f"{part_index:06d}.part"
                    if not part.exists():
                        raise ValueError("RIL upload is missing a chunk")
                    with part.open("rb") as source:
                        shutil.copyfileobj(source, output, length=_STREAM_CHUNK)
            if package_path.stat().st_size > _MAX_PACKAGE_BYTES:
                raise ValueError("RIL package exceeds the 1.5 GB safety limit")
            for part in upload_dir.glob("*.part"):
                part.unlink(missing_ok=True)
            inspected = inspect_ril_package(package_path, verify_hashes=True)
            preview = dict(inspected["preview"])
            existing = _find_existing_song(app, preview["title"])
            preview["existing"] = existing
            result.update({"complete": True, "preview": preview})
        return result


def _export_package(app: Any, payload: dict[str, Any], app_version: str) -> dict[str, Any]:
    folder_name = str(payload.get("folder") or "")
    song_folder = app.song_folder(folder_name)
    song_data = app.song_bundle(folder_name)
    bundle = song_data.get("bundle")
    if not bundle:
        raise ValueError("This song has no chart to export")
    supplied_mappings = payload.get("mappings")
    if isinstance(supplied_mappings, dict):
        bundle = json.loads(json.dumps(bundle))
        bundle["mappings"] = supplied_mappings
    username = _clean_username(payload.get("username") or (app.settings.get("profile") or {}).get("username"))
    token = uuid.uuid4().hex
    export_dir = _TEMP_ROOT / "exports" / token
    export_dir.mkdir(parents=True, exist_ok=True)
    title = str(bundle["summary"].get("song_name") or song_folder.name)
    filename = f"{core.safe_name(title, 'song')}.ril"
    package_path = export_dir / "package.ril"
    manifest = create_ril_package(
        song_folder,
        bundle,
        package_path,
        username=username,
        include_instrumental=payload.get("include_instrumental") is not False,
        include_vocals=payload.get("include_vocals") is not False,
        include_original=bool(payload.get("include_original")),
        app_version=app_version,
    )
    return {
        "token": token,
        "filename": filename,
        "size_bytes": int(package_path.stat().st_size),
        "download_url": f"/api/ril/export/file?token={token}&filename={urllib.parse.quote(filename)}",
        "manifest": manifest,
    }


def install_ril_package_endpoint(backend: ModuleType) -> None:
    """Install portable .ril import/export and the neutral runtime chart adapter."""
    handler = backend.Handler
    if getattr(handler, "_ril_package_installed", False):
        return
    core.DEFAULTS.setdefault("profile", {"username": ""})
    _cleanup_temp()
    app_class = backend.RhythmApp
    original_get = handler.do_GET
    original_post = handler.do_POST
    original_list_songs = app_class.list_songs
    original_dashboard = app_class.dashboard
    original_song_bundle = app_class.song_bundle
    original_import_chart = app_class.import_chart

    def list_songs(self) -> list[dict]:  # type: ignore[no-untyped-def]
        rows = original_list_songs(self)
        for row in rows:
            try:
                song_meta = json.loads((self.song_folder(str(row.get("folder") or "")) / "song.json").read_text(encoding="utf-8"))
            except Exception:
                song_meta = {}
            row["provenance"] = song_meta.get("provenance") if isinstance(song_meta.get("provenance"), dict) else None
            row["ril"] = song_meta.get("ril") if isinstance(song_meta.get("ril"), dict) else None
            row["difficulty"] = str(song_meta.get("difficulty") or "")
            row["original_charter"] = str(song_meta.get("original_charter") or song_meta.get("charter") or "")
        return rows

    def dashboard(self) -> dict:  # type: ignore[no-untyped-def]
        data = original_dashboard(self)
        imported = [row for row in self.list_songs() if (row.get("provenance") or {}).get("imported_at")]
        imported.sort(key=lambda row: str((row.get("provenance") or {}).get("imported_at") or ""), reverse=True)
        data["recent_imports"] = imported[:8]
        data["profile"] = {"username": _clean_username((self.settings.get("profile") or {}).get("username"))}
        return data

    def song_bundle(self, folder_name: str) -> dict:  # type: ignore[no-untyped-def]
        folder = self.song_folder(folder_name)
        chart_path = folder / "chart" / "ril_chart.json"
        if chart_path.exists():
            try:
                compact = json.loads(chart_path.read_text(encoding="utf-8"))
                bundle = compact_chart_to_bundle(compact)
                mappings_path = folder / "chart" / "mappings.json"
                if mappings_path.exists():
                    bundle["mappings"] = json.loads(mappings_path.read_text(encoding="utf-8"))
                return {"song": backend.build_song_entry(folder), "bundle": bundle, "attempts": backend.attempts_for_song(folder)}
            except Exception:
                chart_path.unlink(missing_ok=True)
        data = original_song_bundle(self, folder_name)
        if data.get("bundle"):
            ensure_ril_chart(folder, data["bundle"])
            data["bundle"]["summary"].setdefault("ril_chart_version", RIL_CHART_VERSION)
        return data

    def import_chart(self, payload: dict) -> dict:  # type: ignore[no-untyped-def]
        result = original_import_chart(self, payload)
        folder = self.song_folder(str(result["song"]["folder"]))
        bundle = fnf_importer.load_chart_bundle(folder)
        if bundle:
            ensure_ril_chart(folder, bundle)
            try:
                song_meta = json.loads((folder / "song.json").read_text(encoding="utf-8"))
            except Exception:
                song_meta = {}
            song_meta["ril"] = {"chart_version": RIL_CHART_VERSION, "package_version": RIL_PACKAGE_VERSION, "app_version": str(backend.APP_VERSION), "portable": True}
            (folder / "song.json").write_text(json.dumps(song_meta, indent=2, ensure_ascii=False), encoding="utf-8")
        return result

    def do_GET(self) -> None:  # type: ignore[no-untyped-def]
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/ril/export/file":
            return original_get(self)
        try:
            query = urllib.parse.parse_qs(parsed.query)
            token = str(query.get("token", [""])[0])
            if not _DOWNLOAD_TOKEN.match(token):
                raise ValueError("Invalid RIL download token")
            filename = Path(str(query.get("filename", ["song.ril"])[0])).name
            path = _TEMP_ROOT / "exports" / token / "package.ril"
            if not path.is_file():
                raise FileNotFoundError("RIL export expired or was not found")
            _stream_attachment(self, path, filename if filename.casefold().endswith(".ril") else f"{filename}.ril")
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except OSError as exc:
            if not _client_disconnected(exc):
                self._error(exc, 400)
        except Exception as exc:
            self._error(exc, 400)

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path not in {"/api/ril/export", "/api/ril/import/chunk", "/api/ril/import/commit", "/api/ril/import/cancel"}:
            return original_post(self)
        try:
            payload = self._body_json()
            if path == "/api/ril/export":
                result = _export_package(self.app, payload, str(backend.APP_VERSION))
            elif path == "/api/ril/import/chunk":
                result = _upload_chunk(self.app, payload)
            else:
                upload_id = str(payload.get("upload_id") or "")
                if not _UPLOAD_ID.match(upload_id):
                    raise ValueError("Invalid RIL upload id")
                upload_dir = _TEMP_ROOT / "imports" / upload_id
                if path == "/api/ril/import/cancel":
                    shutil.rmtree(upload_dir, ignore_errors=True)
                    result = {"cancelled": True}
                else:
                    package_path = upload_dir / "package.ril"
                    if not package_path.is_file():
                        raise FileNotFoundError("Uploaded RIL package was not found")
                    result = import_ril_package(self.app, package_path, mode=str(payload.get("mode") or "separate"), app_version=str(backend.APP_VERSION))
                    shutil.rmtree(upload_dir, ignore_errors=True)
            self._json({"ok": True, "data": result})
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    app_class.list_songs = list_songs
    app_class.dashboard = dashboard
    app_class.song_bundle = song_bundle
    app_class.import_chart = import_chart
    handler.do_GET = do_GET
    handler.do_POST = do_POST
    handler._ril_package_installed = True
