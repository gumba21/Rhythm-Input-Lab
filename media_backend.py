from __future__ import annotations

import base64
import json
import mimetypes
import re
import shutil
import threading
import time
import urllib.parse
from pathlib import Path
from types import ModuleType
from typing import Any

_ALLOWED_KINDS = {"instrumental", "vocals"}
_ALLOWED_SUFFIXES = {".ogg", ".mp3", ".wav", ".flac", ".m4a", ".aac", ".opus", ".webm"}
_UPLOAD_ID = re.compile(r"^[a-zA-Z0-9_-]{8,96}$")
_BYTE_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
_LOCK = threading.RLock()
_STREAM_CHUNK = 256 * 1024
_CLIENT_DISCONNECT_WINERRORS = {10053, 10054}


def _client_disconnected(exc: BaseException) -> bool:
    return isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)) or (
        isinstance(exc, OSError) and getattr(exc, "winerror", None) in _CLIENT_DISCONNECT_WINERRORS
    )


def _media_meta(song_folder: Path) -> dict[str, Any]:
    try:
        payload = json.loads((song_folder / "song.json").read_text(encoding="utf-8"))
    except Exception:
        payload = {}
    media = payload.get("media")
    if not isinstance(media, dict):
        media = {}
    cleaned: dict[str, Any] = {}
    for kind in _ALLOWED_KINDS:
        row = media.get(kind)
        if not isinstance(row, dict):
            continue
        stored_name = Path(str(row.get("stored_name") or "")).name
        candidate = song_folder / "audio" / stored_name
        if stored_name and candidate.exists() and candidate.is_file():
            cleaned[kind] = {
                "kind": kind,
                "filename": str(row.get("filename") or stored_name),
                "stored_name": stored_name,
                "size_bytes": int(candidate.stat().st_size),
                "updated_at": row.get("updated_at"),
                "url": f"/api/song-media/file?folder={urllib.parse.quote(song_folder.name, safe='')}&kind={kind}",
            }
    return cleaned


def _save_meta(song_folder: Path, kind: str, filename: str, stored_name: str, size_bytes: int) -> dict[str, Any]:
    song_path = song_folder / "song.json"
    try:
        payload = json.loads(song_path.read_text(encoding="utf-8"))
    except Exception:
        payload = {"song_name": song_folder.name}
    media = payload.setdefault("media", {})
    media[kind] = {
        "filename": Path(filename).name,
        "stored_name": Path(stored_name).name,
        "size_bytes": int(size_bytes),
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    song_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return _media_meta(song_folder)[kind]


def _clear_kind(song_folder: Path, kind: str) -> None:
    audio_dir = song_folder / "audio"
    if audio_dir.exists():
        for child in audio_dir.iterdir():
            if child.is_file() and child.stem.casefold() == kind:
                child.unlink(missing_ok=True)
    song_path = song_folder / "song.json"
    try:
        payload = json.loads(song_path.read_text(encoding="utf-8"))
    except Exception:
        payload = {"song_name": song_folder.name}
    media = payload.get("media")
    if isinstance(media, dict):
        media.pop(kind, None)
    song_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def _requested_range(header: str, size: int) -> tuple[int, int, bool]:
    if not header:
        return 0, max(0, size - 1), False
    value = header.split(",", 1)[0].strip()
    match = _BYTE_RANGE.match(value)
    if not match or size <= 0:
        raise ValueError("Invalid byte range")
    start_text, end_text = match.groups()
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    elif end_text:
        suffix = int(end_text)
        if suffix <= 0:
            raise ValueError("Invalid byte range")
        start = max(0, size - suffix)
        end = size - 1
    else:
        raise ValueError("Invalid byte range")
    if start >= size or start < 0 or end < start:
        raise ValueError("Unsatisfiable byte range")
    return start, min(end, size - 1), True


def _stream_file(handler: Any, file_path: Path, content_type: str) -> None:
    size = int(file_path.stat().st_size)
    try:
        start, end, partial = _requested_range(str(handler.headers.get("Range") or ""), size)
    except ValueError:
        handler.send_response(416)
        handler.send_header("Content-Range", f"bytes */{size}")
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Length", "0")
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()
        return

    length = max(0, end - start + 1)
    handler.send_response(206 if partial else 200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Accept-Ranges", "bytes")
    handler.send_header("Content-Length", str(length))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Disposition", f'inline; filename="{file_path.name}"')
    if partial:
        handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    handler.end_headers()

    try:
        with file_path.open("rb") as source:
            source.seek(start)
            remaining = length
            while remaining > 0:
                chunk = source.read(min(_STREAM_CHUNK, remaining))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                remaining -= len(chunk)
    except OSError as exc:
        if _client_disconnected(exc):
            return
        raise


def install_song_media_endpoint(backend: ModuleType) -> None:
    """Add chunked per-song audio storage without changing the legacy backend module."""
    handler = backend.Handler
    if getattr(handler, "_ril_song_media_installed", False):
        return

    original_get = handler.do_GET
    original_post = handler.do_POST
    app_class = backend.RhythmApp
    original_list_songs = app_class.list_songs

    def list_songs(self) -> list[dict]:  # type: ignore[no-untyped-def]
        rows = original_list_songs(self)
        for row in rows:
            try:
                row["media"] = _media_meta(self.song_folder(str(row.get("folder") or "")))
            except Exception:
                row["media"] = {}
        return rows

    def do_GET(self) -> None:  # type: ignore[no-untyped-def]
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path not in {"/api/song-media/meta", "/api/song-media/file"}:
            return original_get(self)
        try:
            query = urllib.parse.parse_qs(parsed.query)
            folder_name = query.get("folder", [""])[0]
            song_folder = self.app.song_folder(folder_name)
            if path == "/api/song-media/meta":
                self._json({"ok": True, "data": _media_meta(song_folder)})
                return
            kind = query.get("kind", [""])[0].casefold()
            if kind not in _ALLOWED_KINDS:
                raise ValueError("Unknown audio kind")
            row = _media_meta(song_folder).get(kind)
            if not row:
                raise FileNotFoundError("Saved audio was not found")
            file_path = song_folder / "audio" / row["stored_name"]
            mime, _ = mimetypes.guess_type(file_path.name)
            _stream_file(self, file_path, mime or "application/octet-stream")
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except OSError as exc:
            if _client_disconnected(exc):
                return
            self._error(exc, 400)
        except Exception as exc:
            self._error(exc, 400)

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path not in {"/api/song-media/chunk", "/api/song-media/clear"}:
            return original_post(self)
        try:
            payload = self._body_json()
            folder_name = str(payload.get("folder") or "")
            kind = str(payload.get("kind") or "").casefold()
            if kind not in _ALLOWED_KINDS:
                raise ValueError("Unknown audio kind")
            song_folder = self.app.song_folder(folder_name)

            if path == "/api/song-media/clear":
                with _LOCK:
                    _clear_kind(song_folder, kind)
                self._json({"ok": True, "data": _media_meta(song_folder)})
                return

            upload_id = str(payload.get("upload_id") or "")
            if not _UPLOAD_ID.match(upload_id):
                raise ValueError("Invalid upload id")
            index = int(payload.get("index"))
            total = int(payload.get("total"))
            if total < 1 or total > 20_000 or index < 0 or index >= total:
                raise ValueError("Invalid upload chunk")
            filename = Path(str(payload.get("filename") or "audio.bin")).name
            suffix = Path(filename).suffix.casefold()
            if suffix not in _ALLOWED_SUFFIXES:
                raise ValueError("Use OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, or WEBM audio")
            encoded = str(payload.get("data") or "")
            raw = base64.b64decode(encoded, validate=True)
            if len(raw) > 2_000_000:
                raise ValueError("Audio chunk is too large")

            with _LOCK:
                temp_root = song_folder / ".ril-media-upload" / f"{upload_id}-{kind}"
                temp_root.mkdir(parents=True, exist_ok=True)
                (temp_root / f"{index:06d}.part").write_bytes(raw)
                received = len(list(temp_root.glob("*.part")))
                result: dict[str, Any] = {"received": received, "total": total, "complete": False}
                if received == total:
                    audio_dir = song_folder / "audio"
                    audio_dir.mkdir(parents=True, exist_ok=True)
                    _clear_kind(song_folder, kind)
                    target = audio_dir / f"{kind}{suffix}"
                    with target.open("wb") as output:
                        for part_index in range(total):
                            part = temp_root / f"{part_index:06d}.part"
                            if not part.exists():
                                raise ValueError("Audio upload is missing a chunk")
                            output.write(part.read_bytes())
                    row = _save_meta(song_folder, kind, filename, target.name, target.stat().st_size)
                    shutil.rmtree(temp_root, ignore_errors=True)
                    upload_parent = temp_root.parent
                    if upload_parent.exists() and not any(upload_parent.iterdir()):
                        upload_parent.rmdir()
                    result = {"received": total, "total": total, "complete": True, "media": row}
            self._json({"ok": True, "data": result})
        except Exception as exc:
            self._error(exc, 400)

    app_class.list_songs = list_songs
    handler.do_GET = do_GET
    handler.do_POST = do_POST
    handler._ril_song_media_installed = True
