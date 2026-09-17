from __future__ import annotations

import base64
import json
import os
import re
import shutil
import threading
import time
import urllib.parse
from pathlib import Path
from types import ModuleType
from typing import Any, Optional

import media_backend
from fnf_codename_import import _codename_chart, _slug, install_fnf_compat

_AUDIO_SUFFIXES = {".ogg", ".mp3", ".wav", ".flac", ".m4a", ".aac", ".opus", ".webm"}
_UPLOAD_ID = re.compile(r"^[a-zA-Z0-9_-]{8,96}$")
_LOCK = threading.RLock()

def _song_payload(song_folder: Path) -> dict[str, Any]:
    try:
        payload = json.loads((song_folder / "song.json").read_text(encoding="utf-8"))
    except Exception:
        payload = {"song_name": song_folder.name}
    return payload if isinstance(payload, dict) else {"song_name": song_folder.name}


def _write_song_payload(song_folder: Path, payload: dict[str, Any]) -> None:
    (song_folder / "song.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _vocal_stems_meta(song_folder: Path) -> list[dict[str, Any]]:
    payload = _song_payload(song_folder)
    media = payload.get("media")
    rows = media.get("vocal_stems") if isinstance(media, dict) else []
    if not isinstance(rows, list):
        return []
    result = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        stored_name = Path(str(row.get("stored_name") or "")).name
        path = song_folder / "audio" / stored_name
        if not stored_name or not path.exists() or not path.is_file():
            continue
        stem_id = _slug(row.get("stem_id") or Path(stored_name).stem, "vocals")
        result.append({
            "stem_id": stem_id,
            "label": str(row.get("label") or row.get("filename") or stem_id),
            "filename": str(row.get("filename") or stored_name),
            "stored_name": stored_name,
            "size_bytes": int(path.stat().st_size),
            "updated_at": row.get("updated_at"),
            "primary": bool(row.get("primary")),
            "url": f"/api/song-media/stem-file?folder={urllib.parse.quote(song_folder.name, safe='')}&stem={urllib.parse.quote(stem_id, safe='')}",
        })
    return result


def _complete_media_meta(song_folder: Path) -> dict[str, Any]:
    base = media_backend._media_meta(song_folder)
    stems = _vocal_stems_meta(song_folder)
    if stems:
        base["vocal_stems"] = stems
    return base


def _save_media_row(song_folder: Path, role: str, stem_id: str, filename: str, stored_name: str, primary: bool) -> None:
    payload = _song_payload(song_folder)
    media = payload.setdefault("media", {})
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    path = song_folder / "audio" / stored_name
    common = {
        "filename": Path(filename).name,
        "stored_name": stored_name,
        "size_bytes": int(path.stat().st_size),
        "updated_at": stamp,
    }
    if role == "instrumental":
        media["instrumental"] = common
    else:
        rows = media.setdefault("vocal_stems", [])
        if not isinstance(rows, list):
            rows = []
            media["vocal_stems"] = rows
        row = {
            **common,
            "stem_id": stem_id,
            "label": Path(filename).stem,
            "primary": bool(primary),
        }
        rows[:] = [item for item in rows if isinstance(item, dict) and _slug(item.get("stem_id"), "vocals") != stem_id]
        if primary:
            for item in rows:
                if isinstance(item, dict):
                    item["primary"] = False
            media["vocals"] = common
        rows.append(row)
    _write_song_payload(song_folder, payload)


def _link_or_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.unlink(missing_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def _finish_media_upload(app: Any, payload: dict[str, Any], temp_root: Path) -> dict[str, Any]:
    folders = [str(value) for value in payload.get("folders", []) if str(value).strip()]
    if not folders or len(folders) > 50:
        raise ValueError("Choose between 1 and 50 imported chart folders for this audio track")
    role = str(payload.get("role") or "").casefold()
    if role not in {"instrumental", "vocal"}:
        raise ValueError("Unknown FNF audio role")
    filename = Path(str(payload.get("filename") or "audio.ogg")).name
    suffix = Path(filename).suffix.casefold()
    if suffix not in _AUDIO_SUFFIXES:
        raise ValueError("Unsupported FNF audio type")
    stem_id = _slug(payload.get("stem_id") or Path(filename).stem, "vocals")
    primary = bool(payload.get("primary"))
    stored_name = f"instrumental{suffix}" if role == "instrumental" else (f"vocals{suffix}" if primary else f"vocal-{stem_id}{suffix}")
    total = int(payload.get("total") or 0)
    assembled = temp_root / f"assembled{suffix}"
    with assembled.open("wb") as output:
        for index in range(total):
            part = temp_root / f"{index:06d}.part"
            if not part.exists():
                raise ValueError("FNF audio upload is missing a chunk")
            output.write(part.read_bytes())
    updated = []
    first_target: Optional[Path] = None
    for folder_name in folders:
        song_folder = app.song_folder(folder_name)
        target = song_folder / "audio" / stored_name
        if first_target is None:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(assembled, target)
            first_target = target
        else:
            _link_or_copy(first_target, target)
        _save_media_row(song_folder, role, stem_id, filename, stored_name, primary)
        updated.append(song_folder.name)
    return {"folders": updated, "role": role, "stem_id": stem_id, "primary": primary, "stored_name": stored_name}


def install_fnf_batch_import(backend: ModuleType) -> None:
    install_fnf_compat()
    handler = backend.Handler
    if getattr(handler, "_ril_fnf_batch_installed", False):
        return
    original_get = handler.do_GET
    original_post = handler.do_POST
    app_class = backend.RhythmApp

    def import_fnf_batch_item(self, payload: dict[str, Any]) -> dict[str, Any]:  # type: ignore[no-untyped-def]
        chart = payload.get("chart") if isinstance(payload.get("chart"), dict) else payload
        filename = str(chart.get("filename") or "chart.json")
        relative_path = str(chart.get("relative_path") or filename)
        difficulty = str(chart.get("difficulty") or Path(filename).stem)
        song_name = str(chart.get("import_name") or chart.get("song_name") or Path(filename).stem)
        content = chart.get("content")
        metadata_content = chart.get("metadata_content")
        if isinstance(content, str) and isinstance(metadata_content, str) and metadata_content.strip():
            try:
                chart_data = json.loads(content)
                metadata = json.loads(metadata_content)
                if _codename_chart(chart_data) and isinstance(metadata, dict):
                    chart_data.setdefault("meta", metadata)
                    for target, candidates in {
                        "songName": ("songName", "displayName", "name"),
                        "bpm": ("bpm", "beatsPerMinute"),
                        "scrollSpeed": ("scrollSpeed", "speed"),
                    }.items():
                        if chart_data.get(target) not in (None, "", 0):
                            continue
                        for candidate in candidates:
                            if metadata.get(candidate) not in (None, ""):
                                chart_data[target] = metadata[candidate]
                                break
                    content = json.dumps(chart_data, ensure_ascii=False, separators=(",", ":"))
            except Exception:
                pass
        result = self.import_chart({
            "filename": filename,
            "content": content,
            "song_name": song_name,
            "key_count": chart.get("key_count"),
            "events_filename": chart.get("events_filename"),
            "events_content": chart.get("events_content"),
        })
        folder_name = str(result.get("song", {}).get("folder") or "")
        if folder_name:
            song_folder = self.song_folder(folder_name)
            song_payload = _song_payload(song_folder)
            imported = song_payload.setdefault("imported_chart", {})
            imported["source_relative_path"] = relative_path
            imported["difficulty"] = difficulty
            imported["batch_group"] = str(chart.get("group_key") or "")
            imported["source_engine"] = str(result.get("summary", {}).get("format") or "fnf")
            _write_song_payload(song_folder, song_payload)
        return result

    def do_GET(self) -> None:  # type: ignore[no-untyped-def]
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in {"/api/song-media/meta", "/api/song-media/stem-file"}:
            return original_get(self)
        try:
            query = urllib.parse.parse_qs(parsed.query)
            song_folder = self.app.song_folder(query.get("folder", [""])[0])
            if parsed.path == "/api/song-media/meta":
                self._json({"ok": True, "data": _complete_media_meta(song_folder)})
                return
            stem_id = _slug(query.get("stem", [""])[0], "vocals")
            row = next((item for item in _vocal_stems_meta(song_folder) if item["stem_id"] == stem_id), None)
            if not row:
                raise FileNotFoundError("Saved vocal stem was not found")
            path = song_folder / "audio" / row["stored_name"]
            media_backend._stream_file(self, path, "audio/ogg" if path.suffix.casefold() == ".ogg" else "application/octet-stream")
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in {"/api/fnf-batch/import", "/api/fnf-batch/media-chunk"}:
            return original_post(self)
        try:
            payload = self._body_json()
            if parsed.path == "/api/fnf-batch/import":
                result = import_fnf_batch_item(self.app, payload)
                self._json({"ok": True, "data": result})
                return
            upload_id = str(payload.get("upload_id") or "")
            if not _UPLOAD_ID.match(upload_id):
                raise ValueError("Invalid FNF audio upload id")
            index = int(payload.get("index"))
            total = int(payload.get("total"))
            if total < 1 or total > 20_000 or index < 0 or index >= total:
                raise ValueError("Invalid FNF audio upload chunk")
            raw = base64.b64decode(str(payload.get("data") or ""), validate=True)
            if len(raw) > 1_500_000:
                raise ValueError("FNF audio chunk is too large")
            with _LOCK:
                temp_root = self.app.output_root / ".ril-fnf-batch-upload" / upload_id
                temp_root.mkdir(parents=True, exist_ok=True)
                (temp_root / f"{index:06d}.part").write_bytes(raw)
                received = len(list(temp_root.glob("*.part")))
                result: dict[str, Any] = {"received": received, "total": total, "complete": False}
                if received == total:
                    result.update(_finish_media_upload(self.app, payload, temp_root))
                    result["complete"] = True
                    shutil.rmtree(temp_root, ignore_errors=True)
                    parent = temp_root.parent
                    if parent.exists() and not any(parent.iterdir()):
                        parent.rmdir()
            self._json({"ok": True, "data": result})
        except Exception as exc:
            self._error(exc, 400)

    app_class.import_fnf_batch_item = import_fnf_batch_item
    handler.do_GET = do_GET
    handler.do_POST = do_POST
    handler._ril_fnf_batch_installed = True
