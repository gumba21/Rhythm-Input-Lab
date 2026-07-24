from __future__ import annotations

import base64
import json
import os
import shutil
import urllib.parse
from pathlib import Path
from types import ModuleType
from typing import Any

import quaver_import_backend as backend_adapter
import quaver_importer

_ORIGINAL_COMMIT = backend_adapter._commit_import


def _upload_audio_chunk(payload: dict[str, Any]) -> dict[str, Any]:
    upload_id = str(payload.get("upload_id") or "")
    if not backend_adapter._UPLOAD_ID.match(upload_id):
        raise ValueError("Invalid Quaver upload id")
    filename = Path(str(payload.get("filename") or "audio.ogg")).name
    suffix = Path(filename).suffix.casefold()
    if suffix not in quaver_importer.SUPPORTED_AUDIO_SUFFIXES:
        raise ValueError("Choose OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, or WEBM audio")
    index = int(payload.get("index"))
    total = int(payload.get("total"))
    if total < 1 or total > 50_000 or index < 0 or index >= total:
        raise ValueError("Invalid companion-audio upload chunk")
    raw = base64.b64decode(str(payload.get("data") or ""), validate=True)
    if len(raw) > backend_adapter._MAX_CHUNK_BYTES:
        raise ValueError("Companion-audio upload chunk is too large")

    with backend_adapter._LOCK:
        upload_dir = backend_adapter._TEMP_ROOT / upload_id
        if not upload_dir.is_dir():
            raise FileNotFoundError("Upload the standalone .qua chart before its audio")
        parts_dir = upload_dir / "audio-parts"
        parts_dir.mkdir(exist_ok=True)
        (parts_dir / f"{index:06d}.part").write_bytes(raw)
        parts = list(parts_dir.glob("*.part"))
        if sum(part.stat().st_size for part in parts) > backend_adapter._MAX_UPLOAD_BYTES:
            shutil.rmtree(parts_dir, ignore_errors=True)
            raise ValueError("The Quaver companion audio exceeds the 2 GB safety limit")
        result: dict[str, Any] = {
            "upload_id": upload_id,
            "received": len(parts),
            "total": total,
            "complete": False,
            "filename": filename,
        }
        if len(parts) != total:
            return result
        for old in upload_dir.glob("companion-audio.*"):
            old.unlink(missing_ok=True)
        target = upload_dir / f"companion-audio{suffix}"
        with target.open("wb") as output:
            for part_index in range(total):
                part = parts_dir / f"{part_index:06d}.part"
                if not part.exists():
                    raise ValueError("Companion-audio upload is missing a chunk")
                with part.open("rb") as source:
                    shutil.copyfileobj(source, output, length=backend_adapter._STREAM_CHUNK)
        shutil.rmtree(parts_dir, ignore_errors=True)
        metadata = {
            "filename": filename,
            "relative_path": str(payload.get("relative_path") or filename).replace("\\", "/"),
            "size_bytes": int(target.stat().st_size),
        }
        (upload_dir / "companion-audio.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        result.update({"complete": True, **metadata})
        return result


def _link_audio(payload: dict[str, Any]) -> dict[str, Any]:
    source_id = str(payload.get("source_upload_id") or "")
    target_id = str(payload.get("target_upload_id") or "")
    if not backend_adapter._UPLOAD_ID.match(source_id) or not backend_adapter._UPLOAD_ID.match(target_id):
        raise ValueError("Invalid Quaver audio-link id")
    if source_id == target_id:
        raise ValueError("Quaver audio link source and target must differ")
    with backend_adapter._LOCK:
        source_dir = backend_adapter._TEMP_ROOT / source_id
        target_dir = backend_adapter._TEMP_ROOT / target_id
        if not source_dir.is_dir() or not target_dir.is_dir():
            raise FileNotFoundError("Quaver audio link source or target was not found")
        source_audio = next((path for path in source_dir.glob("companion-audio.*") if path.is_file() and path.suffix.casefold() in quaver_importer.SUPPORTED_AUDIO_SUFFIXES), None)
        if not source_audio:
            raise FileNotFoundError("The shared Quaver audio has not finished uploading")
        for old in target_dir.glob("companion-audio.*"):
            old.unlink(missing_ok=True)
        target_audio = target_dir / source_audio.name
        try:
            os.link(source_audio, target_audio)
        except OSError:
            shutil.copy2(source_audio, target_audio)
        try:
            metadata = json.loads((source_dir / "companion-audio.json").read_text(encoding="utf-8"))
        except Exception:
            metadata = {
                "filename": source_audio.name,
                "relative_path": source_audio.name,
                "size_bytes": int(source_audio.stat().st_size),
            }
        (target_dir / "companion-audio.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        return {"linked": True, **metadata}


def _commit_import(app: Any, upload_id: str, payload: dict[str, Any], app_version: str) -> dict[str, Any]:
    upload_dir = backend_adapter._TEMP_ROOT / upload_id
    source_paths = list(upload_dir.glob("source.qua")) + list(upload_dir.glob("source.qp"))
    if len(source_paths) != 1 or source_paths[0].suffix.casefold() != ".qua":
        return _ORIGINAL_COMMIT(app, upload_id, payload, app_version)

    source_path = source_paths[0]
    preview = backend_adapter._preview_source(source_path)
    selected = backend_adapter._selected_ids(payload, preview)
    mode = str(payload.get("mode") or "separate")
    if mode not in {"separate", "replace"}:
        raise ValueError("Unknown Quaver import behavior")
    package_name = Path((upload_dir / "filename.txt").read_text(encoding="utf-8")).name
    source_bytes = source_path.read_bytes()
    bundle = quaver_importer.parse_qua_bytes(source_bytes, package_name)
    diff = preview["difficulties"][0]
    imported: list[dict[str, Any]] = []
    audio_source = next((path for path in upload_dir.glob("companion-audio.*") if path.is_file() and path.suffix.casefold() in quaver_importer.SUPPORTED_AUDIO_SUFFIXES), None)
    try:
        audio_meta = json.loads((upload_dir / "companion-audio.json").read_text(encoding="utf-8"))
    except Exception:
        audio_meta = {}
    if str(diff["id"]) in selected:
        imported.append(backend_adapter._write_song(
            app,
            bundle,
            source_bytes,
            package_name,
            mode=mode,
            package_name=package_name,
            audio_source=audio_source,
            audio_original_name=str(audio_meta.get("filename") or bundle["summary"].get("audio_filename") or ""),
            linked_audio={},
            app_version=app_version,
        ))
    if not imported:
        raise ValueError("No Quaver difficulties were imported")
    shutil.rmtree(upload_dir, ignore_errors=True)
    return {
        "imported": imported,
        "count": len(imported),
        "source_kind": preview.get("kind"),
        "unsupported": preview.get("unsupported") or [],
        "warnings": [] if audio_source else preview.get("warnings") or [],
        "capabilities": preview.get("capabilities") or {},
        "companion_audio": bool(audio_source),
    }


def install_quaver_loose_audio(backend: ModuleType) -> None:
    handler = backend.Handler
    if getattr(handler, "_ril_quaver_loose_audio_installed", False):
        return
    backend_adapter._commit_import = _commit_import
    original_post = handler.do_POST

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path not in {"/api/quaver/import/audio/chunk", "/api/quaver/import/audio/link"}:
            return original_post(self)
        try:
            payload = self._body_json()
            result = _upload_audio_chunk(payload) if path.endswith("/chunk") else _link_audio(payload)
            self._json({"ok": True, "data": result})
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    handler.do_POST = do_POST
    handler._ril_quaver_loose_audio_installed = True
