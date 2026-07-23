from __future__ import annotations

import base64
import json
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from types import ModuleType
from typing import Any

import fnf_importer
import osu_importer
import rhythm_input_lab_core as core
import ril_package_backend

_UPLOAD_ID = re.compile(r"^[A-Za-z0-9_-]{8,96}$")
_MAX_CHUNK_BYTES = 2_000_000
_MAX_UPLOAD_BYTES = 2_000_000_000
_STREAM_CHUNK = 512 * 1024
_TEMP_ROOT = Path(tempfile.gettempdir()) / "RhythmInputLab" / "osu-imports"
_LOCK = threading.RLock()


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _cleanup_temp(max_age_seconds: int = 24 * 3600) -> None:
    _TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - max_age_seconds
    for child in _TEMP_ROOT.iterdir():
        try:
            if child.stat().st_mtime >= cutoff:
                continue
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
        except OSError:
            pass


def _preview_source(path: Path) -> dict[str, Any]:
    preview = osu_importer.inspect_source(path)
    preview["upload_size"] = int(path.stat().st_size)
    preview["supported_count"] = len(preview.get("difficulties") or [])
    preview["unsupported_count"] = len(preview.get("unsupported") or [])
    return preview


def _upload_chunk(payload: dict[str, Any]) -> dict[str, Any]:
    upload_id = str(payload.get("upload_id") or "")
    if not _UPLOAD_ID.match(upload_id):
        raise ValueError("Invalid osu! upload id")
    filename = Path(str(payload.get("filename") or "beatmap.osz")).name
    suffix = Path(filename).suffix.casefold()
    if suffix not in {".osu", ".osz"}:
        raise ValueError("Choose a standalone .osu chart or an .osz beatmap set")
    index = int(payload.get("index"))
    total = int(payload.get("total"))
    if total < 1 or total > 50_000 or index < 0 or index >= total:
        raise ValueError("Invalid osu! upload chunk")
    raw = base64.b64decode(str(payload.get("data") or ""), validate=True)
    if len(raw) > _MAX_CHUNK_BYTES:
        raise ValueError("osu! upload chunk is too large")

    with _LOCK:
        upload_dir = _TEMP_ROOT / upload_id
        upload_dir.mkdir(parents=True, exist_ok=True)
        (upload_dir / "filename.txt").write_text(filename, encoding="utf-8")
        (upload_dir / f"{index:06d}.part").write_bytes(raw)
        received = len(list(upload_dir.glob("*.part")))
        result: dict[str, Any] = {"upload_id": upload_id, "received": received, "total": total, "complete": False}
        if received != total:
            return result
        source_path = upload_dir / f"source{suffix}"
        with source_path.open("wb") as output:
            for part_index in range(total):
                part = upload_dir / f"{part_index:06d}.part"
                if not part.exists():
                    raise ValueError("osu! upload is missing a chunk")
                with part.open("rb") as source:
                    shutil.copyfileobj(source, output, length=_STREAM_CHUNK)
        if source_path.stat().st_size > _MAX_UPLOAD_BYTES:
            raise ValueError("The osu! source exceeds the 2 GB safety limit")
        for part in upload_dir.glob("*.part"):
            part.unlink(missing_ok=True)
        result.update({"complete": True, "preview": _preview_source(source_path)})
        return result


def _existing_by_name(app: Any, song_name: str) -> dict[str, Any] | None:
    target = song_name.casefold()
    return next((row for row in app.list_songs() if str(row.get("song_name") or "").casefold() == target), None)


def _unique_folder(root: Path, song_name: str) -> Path:
    base = core.safe_name(song_name, "Imported osu mania song")
    candidate = root / base
    suffix = 2
    while candidate.exists():
        candidate = root / f"{base} ({suffix})"
        suffix += 1
    return candidate


def _target_folder(app: Any, song_name: str, mode: str) -> tuple[Path, bool]:
    existing = _existing_by_name(app, song_name)
    if mode == "replace" and existing:
        return app.song_folder(existing["folder"]), True
    return _unique_folder(app.output_root, song_name), False


def _write_song(
    app: Any,
    bundle: dict[str, Any],
    source_bytes: bytes,
    source_name: str,
    *,
    mode: str,
    package_name: str,
    audio_source: Path | None,
    audio_original_name: str,
    linked_audio: dict[str, Path],
    app_version: str,
) -> dict[str, Any]:
    summary = bundle["summary"]
    song_name = str(summary.get("song_name") or Path(source_name).stem)
    song_folder, replaced = _target_folder(app, song_name, mode)
    song_folder.mkdir(parents=True, exist_ok=True)
    chart_folder = song_folder / "chart"
    if chart_folder.exists():
        shutil.rmtree(chart_folder)

    with tempfile.TemporaryDirectory(prefix="ril_osu_chart_") as temp_dir:
        original = Path(temp_dir) / core.safe_name(source_name, "original.osu")
        original.write_bytes(source_bytes)
        fnf_importer.write_chart_bundle(bundle, chart_folder, original)
    ril_package_backend.ensure_ril_chart(song_folder, bundle)

    try:
        song_meta = json.loads((song_folder / "song.json").read_text(encoding="utf-8"))
    except Exception:
        song_meta = {}
    media = song_meta.get("media") if isinstance(song_meta.get("media"), dict) else {}
    audio_saved = False
    if audio_source and audio_source.is_file() and audio_source.suffix.casefold() in osu_importer.SUPPORTED_AUDIO_SUFFIXES:
        audio_dir = song_folder / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        for old in audio_dir.glob("instrumental.*"):
            if old.is_file():
                old.unlink(missing_ok=True)
        target = audio_dir / f"instrumental{audio_source.suffix.casefold()}"
        key = str(audio_source.resolve())
        existing_link = linked_audio.get(key)
        try:
            if existing_link and existing_link.is_file():
                os.link(existing_link, target)
            else:
                shutil.copy2(audio_source, target)
                linked_audio[key] = target
        except OSError:
            shutil.copy2(audio_source, target)
            linked_audio.setdefault(key, target)
        media["instrumental"] = {
            "filename": audio_original_name or audio_source.name,
            "stored_name": target.name,
            "size_bytes": int(target.stat().st_size),
            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        audio_saved = True

    imported_at = _now_iso()
    song_meta.update({
        "song_name": song_name,
        "song_id": str(summary.get("song_id") or core.song_id(song_name)),
        "artist": str(summary.get("artist") or ""),
        "title": str(summary.get("title") or ""),
        "difficulty": str(summary.get("difficulty") or ""),
        "original_charter": str(summary.get("charter") or ""),
        "media": media,
        "imported_chart": {
            "format": "osu_mania",
            "key_count": int(summary.get("key_count") or 4),
            "player_notes": int(summary.get("player_notes") or 0),
            "events": int(summary.get("event_count") or 0),
            "importer_version": osu_importer.IMPORTER_VERSION,
            "imported_at": imported_at,
        },
        "ril": {
            "chart_version": ril_package_backend.RIL_CHART_VERSION,
            "package_version": ril_package_backend.RIL_PACKAGE_VERSION,
            "app_version": app_version,
            "portable": True,
        },
        "provenance": {
            "imported_from": "osu!mania",
            "imported_at": imported_at,
            "source_format": "osu_mania",
            "source_package": package_name,
            "source_chart": source_name,
            "original_charter": str(summary.get("charter") or ""),
            "beatmap_id": summary.get("beatmap_id"),
            "beatmap_set_id": summary.get("beatmap_set_id"),
        },
        "osu": {
            "file_version": summary.get("osu_file_version"),
            "beatmap_id": summary.get("beatmap_id"),
            "beatmap_set_id": summary.get("beatmap_set_id"),
            "audio_filename": summary.get("audio_filename"),
            "source_sha256": summary.get("source_sha256"),
        },
    })
    (song_folder / "song.json").write_text(json.dumps(song_meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "song": next((row for row in app.list_songs() if row.get("folder") == song_folder.name), None)
        or {"folder": song_folder.name, "song_name": song_name},
        "summary": summary,
        "replaced": replaced,
        "audio_saved": audio_saved,
    }


def _selected_ids(payload: dict[str, Any], preview: dict[str, Any]) -> set[str]:
    available = {str(row.get("id")) for row in preview.get("difficulties") or []}
    raw = payload.get("difficulty_ids")
    if not isinstance(raw, list) or not raw:
        return available
    selected = {str(value) for value in raw if str(value) in available}
    if not selected:
        raise ValueError("Select at least one supported osu!mania difficulty")
    return selected


def _commit_import(app: Any, upload_id: str, payload: dict[str, Any], app_version: str) -> dict[str, Any]:
    if not _UPLOAD_ID.match(upload_id):
        raise ValueError("Invalid osu! upload id")
    upload_dir = _TEMP_ROOT / upload_id
    source_paths = list(upload_dir.glob("source.osu")) + list(upload_dir.glob("source.osz"))
    if len(source_paths) != 1:
        raise FileNotFoundError("Uploaded osu! source was not found")
    source_path = source_paths[0]
    preview = _preview_source(source_path)
    selected = _selected_ids(payload, preview)
    mode = str(payload.get("mode") or "separate")
    if mode not in {"separate", "replace"}:
        raise ValueError("Unknown osu! import behavior")
    linked_audio: dict[str, Path] = {}
    imported: list[dict[str, Any]] = []
    package_name = Path((upload_dir / "filename.txt").read_text(encoding="utf-8")).name

    if source_path.suffix.casefold() == ".osu":
        source_bytes = source_path.read_bytes()
        bundle = osu_importer.parse_osu_text(osu_importer._decode_osu_bytes(source_bytes), package_name)
        diff = preview["difficulties"][0]
        if str(diff["id"]) in selected:
            imported.append(_write_song(
                app, bundle, source_bytes, package_name,
                mode=mode,
                package_name=package_name,
                audio_source=None,
                audio_original_name=str(bundle["summary"].get("audio_filename") or ""),
                linked_audio=linked_audio,
                app_version=app_version,
            ))
    else:
        names = osu_importer.validate_osz(source_path)
        diff_by_entry = {str(row["entry_name"]): row for row in preview.get("difficulties") or []}
        extracted_audio: dict[str, Path] = {}
        with zipfile.ZipFile(source_path, "r") as archive:
            for entry_name, diff in diff_by_entry.items():
                if str(diff.get("id")) not in selected:
                    continue
                info = names.get(entry_name.casefold())
                if not info:
                    raise ValueError(f"Selected chart disappeared from archive: {entry_name}")
                source_bytes = archive.read(info)
                bundle = osu_importer.parse_osu_text(osu_importer._decode_osu_bytes(source_bytes), Path(entry_name).name)
                audio_path: Path | None = None
                audio_entry_name = str(diff.get("audio_entry") or "")
                if audio_entry_name:
                    audio_path = extracted_audio.get(audio_entry_name.casefold())
                    if not audio_path:
                        audio_info = names.get(audio_entry_name.casefold())
                        if audio_info and Path(audio_info.filename).suffix.casefold() in osu_importer.SUPPORTED_AUDIO_SUFFIXES:
                            audio_cache = upload_dir / "audio-cache"
                            audio_cache.mkdir(exist_ok=True)
                            audio_path = audio_cache / f"{uuid.uuid4().hex}{Path(audio_info.filename).suffix.casefold()}"
                            with archive.open(audio_info, "r") as source, audio_path.open("wb") as output:
                                shutil.copyfileobj(source, output, length=_STREAM_CHUNK)
                            extracted_audio[audio_entry_name.casefold()] = audio_path
                imported.append(_write_song(
                    app, bundle, source_bytes, Path(entry_name).name,
                    mode=mode,
                    package_name=package_name,
                    audio_source=audio_path,
                    audio_original_name=str(bundle["summary"].get("audio_filename") or ""),
                    linked_audio=linked_audio,
                    app_version=app_version,
                ))
    if not imported:
        raise ValueError("No osu!mania difficulties were imported")
    shutil.rmtree(upload_dir, ignore_errors=True)
    return {
        "imported": imported,
        "count": len(imported),
        "source_kind": preview.get("kind"),
        "unsupported": preview.get("unsupported") or [],
        "warnings": preview.get("warnings") or [],
    }


def install_osu_import_endpoint(backend: ModuleType) -> None:
    """Install chunked standalone .osu and multi-difficulty .osz importing."""
    handler = backend.Handler
    if getattr(handler, "_ril_osu_import_installed", False):
        return
    _cleanup_temp()
    original_post = handler.do_POST

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path not in {"/api/osu/import/chunk", "/api/osu/import/commit", "/api/osu/import/cancel"}:
            return original_post(self)
        try:
            payload = self._body_json()
            if path == "/api/osu/import/chunk":
                result = _upload_chunk(payload)
            else:
                upload_id = str(payload.get("upload_id") or "")
                if not _UPLOAD_ID.match(upload_id):
                    raise ValueError("Invalid osu! upload id")
                upload_dir = _TEMP_ROOT / upload_id
                if path == "/api/osu/import/cancel":
                    shutil.rmtree(upload_dir, ignore_errors=True)
                    result = {"cancelled": True}
                else:
                    result = _commit_import(self.app, upload_id, payload, str(backend.APP_VERSION))
            self._json({"ok": True, "data": result})
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    handler.do_POST = do_POST
    handler._ril_osu_import_installed = True
