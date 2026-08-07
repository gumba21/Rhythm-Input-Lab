from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import threading
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from types import ModuleType
from typing import Any, Callable

import ril_export_reliability as reliability
import ril_package_backend as packages
import rhythm_input_lab_core as core

_JOB_ID = packages._DOWNLOAD_TOKEN
_JOBS: dict[str, dict[str, Any]] = {}
_JOBS_LOCK = threading.RLock()
_EXPORT_SLOT = threading.Semaphore(1)
_MAX_RETAINED_JOBS = 40
_JOB_MAX_AGE = 24 * 3600


class ExportCancelled(RuntimeError):
    pass


def _now() -> float:
    return time.time()


def _public_job(job: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in job.items()
        if key not in {"cancel_event", "thread", "app", "payload"}
    }


def _cleanup_jobs() -> None:
    cutoff = _now() - _JOB_MAX_AGE
    with _JOBS_LOCK:
        removable = [
            job_id
            for job_id, job in _JOBS.items()
            if job.get("status") in {"completed", "error", "cancelled"}
            and float(job.get("finished_at_epoch") or job.get("created_at_epoch") or 0) < cutoff
        ]
        for job_id in removable:
            _JOBS.pop(job_id, None)
        if len(_JOBS) <= _MAX_RETAINED_JOBS:
            return
        finished = sorted(
            (
                (job_id, float(job.get("finished_at_epoch") or 0))
                for job_id, job in _JOBS.items()
                if job.get("status") in {"completed", "error", "cancelled"}
            ),
            key=lambda item: item[1],
        )
        for job_id, _ in finished[: max(0, len(_JOBS) - _MAX_RETAINED_JOBS)]:
            _JOBS.pop(job_id, None)


def _update_job(job_id: str, **changes: Any) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        job.update(changes)
        job["updated_at_epoch"] = _now()


def _check_cancel(cancel_event: threading.Event) -> None:
    if cancel_event.is_set():
        raise ExportCancelled("Export cancelled")


def _descriptor(path: str, role: str, *, size: int, digest: str) -> dict[str, Any]:
    mime, _ = mimetypes.guess_type(path)
    return {
        "path": path,
        "role": role,
        "size": int(size),
        "sha256": digest,
        "mime": mime or "application/octet-stream",
    }


def _write_media(
    archive: zipfile.ZipFile,
    arcname: str,
    source: Path,
    role: str,
    *,
    cancel_event: threading.Event,
    progress: Callable[[int, str, str], None],
) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    stamp = time.localtime(source.stat().st_mtime)[:6]
    info = zipfile.ZipInfo(arcname, stamp)
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o600 << 16
    with source.open("rb") as input_file, archive.open(info, "w", force_zip64=True) as output_file:
        while chunk := input_file.read(packages._STREAM_CHUNK):
            _check_cancel(cancel_event)
            output_file.write(chunk)
            digest.update(chunk)
            size += len(chunk)
            progress(len(chunk), f"Adding {role}", source.name)
    return _descriptor(arcname, role, size=size, digest=digest.hexdigest())


def _create_package(
    song_folder: Path,
    bundle: dict[str, Any],
    destination: Path,
    *,
    username: str,
    include_instrumental: bool,
    include_vocals: bool,
    include_original: bool,
    app_version: str,
    cancel_event: threading.Event,
    progress_callback: Callable[[dict[str, Any]], None],
) -> dict[str, Any]:
    _check_cancel(cancel_event)
    compact = packages.bundle_to_compact_chart(bundle)
    chart_bytes = packages._json_bytes(compact)
    summary = bundle["summary"]
    try:
        song_meta = json.loads((song_folder / "song.json").read_text(encoding="utf-8"))
    except Exception:
        song_meta = {}
    ril_meta = song_meta.get("ril") if isinstance(song_meta.get("ril"), dict) else {}
    media = packages._media_rows(song_folder)

    included: list[tuple[str, Path, str]] = []
    if include_instrumental and "instrumental" in media:
        source = media["instrumental"]["path"]
        included.append((f"audio/instrumental{source.suffix.casefold()}", source, "instrumental"))
    if include_vocals and "vocals" in media:
        source = media["vocals"]["path"]
        included.append((f"audio/vocals{source.suffix.casefold()}", source, "vocals"))
    if include_original:
        chart_dir = song_folder / "chart"
        candidates = sorted(chart_dir.glob("original*.json")) if chart_dir.exists() else []
        if candidates:
            source = candidates[0]
            included.append((f"source/{core.safe_name(source.name, 'original.json')}", source, "original_source"))

    total_bytes = max(1, len(chart_bytes) + sum(int(source.stat().st_size) for _, source, _ in included))
    written_bytes = 0

    def progress(delta: int, stage: str, current_file: str = "") -> None:
        nonlocal written_bytes
        written_bytes = min(total_bytes, written_bytes + max(0, int(delta)))
        progress_callback({
            "stage": stage,
            "current_file": current_file,
            "bytes_written": written_bytes,
            "bytes_total": total_bytes,
            "progress": min(99, int(written_bytes / total_bytes * 100)),
        })

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.partial")
    files = [packages._file_descriptor("chart.json", "chart", payload=chart_bytes)]
    try:
        progress_callback({
            "stage": "Preparing chart",
            "current_file": "chart.json",
            "bytes_written": 0,
            "bytes_total": total_bytes,
            "progress": 0,
        })
        with zipfile.ZipFile(partial, "w", allowZip64=True) as archive:
            _check_cancel(cancel_event)
            archive.writestr("chart.json", chart_bytes, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
            progress(len(chart_bytes), "Writing chart", "chart.json")
            for arcname, source, role in included:
                files.append(_write_media(
                    archive,
                    arcname,
                    source,
                    role,
                    cancel_event=cancel_event,
                    progress=progress,
                ))

            _check_cancel(cancel_event)
            progress_callback({
                "stage": "Writing manifest",
                "current_file": "manifest.json",
                "bytes_written": written_bytes,
                "bytes_total": total_bytes,
                "progress": 99,
            })
            manifest = {
                "ril_package": packages.RIL_PACKAGE_VERSION,
                "package_type": packages.PACKAGE_TYPE,
                "package_id": uuid.uuid4().hex,
                "created_at": packages._iso_now(),
                "app": {
                    "name": "Rhythm Input Lab",
                    "version": str(app_version or ril_meta.get("app_version") or ""),
                },
                "exported_by": {"username": packages._clean_username(username)},
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
                    "chart_version": packages.RIL_CHART_VERSION,
                    "contains_audio": any(row[2] in {"instrumental", "vocals"} for row in included),
                    "contains_attempts": False,
                },
            }
            archive.writestr(
                "manifest.json",
                packages._json_bytes(manifest, pretty=True),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=6,
            )
        _check_cancel(cancel_event)
        if partial.stat().st_size > packages._MAX_PACKAGE_BYTES:
            raise ValueError("The exported RIL package exceeds the 1.5 GB safety limit")
        progress_callback({
            "stage": "Finalizing package",
            "current_file": destination.name,
            "bytes_written": total_bytes,
            "bytes_total": total_bytes,
            "progress": 99,
        })
        os.replace(partial, destination)
        return manifest
    except Exception:
        partial.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise


def _export_job(app: Any, payload: dict[str, Any], app_version: str, job_id: str, cancel_event: threading.Event) -> dict[str, Any]:
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

    username = packages._clean_username(payload.get("username") or (app.settings.get("profile") or {}).get("username"))
    title = str(bundle["summary"].get("song_name") or song_folder.name)
    export_root = reliability.exports_root(app)
    package_path = reliability._unique_export_path(export_root, title)

    def report(changes: dict[str, Any]) -> None:
        _update_job(job_id, **changes)

    manifest = _create_package(
        song_folder,
        bundle,
        package_path,
        username=username,
        include_instrumental=payload.get("include_instrumental") is not False,
        include_vocals=payload.get("include_vocals") is not False,
        include_original=bool(payload.get("include_original")),
        app_version=app_version,
        cancel_event=cancel_event,
        progress_callback=report,
    )
    token = uuid.uuid4().hex
    token_dir = packages._TEMP_ROOT / "exports" / token
    token_dir.mkdir(parents=True, exist_ok=True)
    (token_dir / "export.json").write_text(json.dumps({"filename": package_path.name}), encoding="utf-8")
    result = {
        "token": token,
        "filename": package_path.name,
        "size_bytes": int(package_path.stat().st_size),
        "saved_path": str(package_path),
        "export_folder": str(export_root),
        "download_url": f"/api/ril/export/file?token={token}&filename={urllib.parse.quote(package_path.name)}",
        "manifest": manifest,
        "_package_path": str(package_path),
    }
    return reliability.enforce_discord_limit(result, bool(payload.get("discord_limit")))


def _worker(app: Any, payload: dict[str, Any], app_version: str, job_id: str) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            return
        cancel_event = job["cancel_event"]
    try:
        _update_job(job_id, status="queued", stage="Waiting for export slot", progress=0)
        with _EXPORT_SLOT:
            _check_cancel(cancel_event)
            _update_job(job_id, status="running", stage="Preparing export", started_at_epoch=_now())
            result = _export_job(app, payload, app_version, job_id, cancel_event)
            _update_job(
                job_id,
                status="completed",
                stage="Export complete",
                progress=100,
                result=result,
                finished_at_epoch=_now(),
            )
    except ExportCancelled:
        _update_job(job_id, status="cancelled", stage="Export cancelled", finished_at_epoch=_now())
    except Exception as exc:
        _update_job(job_id, status="error", stage="Export failed", error=str(exc), finished_at_epoch=_now())


def _start_job(app: Any, payload: dict[str, Any], app_version: str) -> dict[str, Any]:
    _cleanup_jobs()
    folder = str(payload.get("folder") or "")
    if not folder:
        raise ValueError("Choose a song to export")
    app.song_folder(folder)
    with _JOBS_LOCK:
        for job in _JOBS.values():
            if job.get("folder") == folder and job.get("status") in {"queued", "running"}:
                raise ValueError("An export for this song is already running")
        job_id = uuid.uuid4().hex
        cancel_event = threading.Event()
        job = {
            "job_id": job_id,
            "folder": folder,
            "status": "queued",
            "stage": "Queued",
            "progress": 0,
            "bytes_written": 0,
            "bytes_total": 0,
            "current_file": "",
            "error": "",
            "result": None,
            "created_at_epoch": _now(),
            "updated_at_epoch": _now(),
            "cancel_event": cancel_event,
        }
        _JOBS[job_id] = job
        thread = threading.Thread(target=_worker, args=(app, dict(payload), app_version, job_id), daemon=True, name=f"ril-export-{job_id[:8]}")
        job["thread"] = thread
        thread.start()
        return _public_job(job)


def _job(job_id: str) -> dict[str, Any]:
    if not _JOB_ID.match(job_id):
        raise ValueError("Invalid export job id")
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise FileNotFoundError("Export job was not found")
        return _public_job(job)


def _cancel_job(job_id: str) -> dict[str, Any]:
    if not _JOB_ID.match(job_id):
        raise ValueError("Invalid export job id")
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if not job:
            raise FileNotFoundError("Export job was not found")
        if job.get("status") in {"completed", "error", "cancelled"}:
            return _public_job(job)
        job["cancel_event"].set()
        job["stage"] = "Cancelling export"
        job["updated_at_epoch"] = _now()
        return _public_job(job)


def install_ril_export_jobs(backend: ModuleType) -> None:
    handler = backend.Handler
    if getattr(handler, "_ril_export_jobs_installed", False):
        return
    original_get = handler.do_GET
    original_post = handler.do_POST

    def do_GET(self) -> None:  # type: ignore[no-untyped-def]
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/ril/export/status":
            return original_get(self)
        try:
            job_id = str(urllib.parse.parse_qs(parsed.query).get("job", [""])[0])
            self._json({"ok": True, "data": _job(job_id)})
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path not in {"/api/ril/export/start", "/api/ril/export/cancel"}:
            return original_post(self)
        try:
            payload = self._body_json()
            if path == "/api/ril/export/start":
                result = _start_job(self.app, payload, str(backend.APP_VERSION))
            else:
                result = _cancel_job(str(payload.get("job_id") or ""))
            self._json({"ok": True, "data": result})
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    handler.do_GET = do_GET
    handler.do_POST = do_POST
    handler._ril_export_jobs_installed = True
