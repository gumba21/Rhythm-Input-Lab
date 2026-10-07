from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import uuid
import zipfile
from pathlib import Path
from types import ModuleType
from typing import Any

import discord_export_backend
import ril_package_backend as packages
import rhythm_input_lab_core as core

EXPORT_FOLDER_NAME = "RIL Exports"
_INSTALLED = False


def exports_root(app: Any) -> Path:
    root = app.output_root / EXPORT_FOLDER_NAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def _unique_export_path(root: Path, title: str) -> Path:
    stem = core.safe_name(title, "song")
    candidate = root / f"{stem}.ril"
    suffix = 2
    while candidate.exists():
        candidate = root / f"{stem} ({suffix}).ril"
        suffix += 1
    return candidate


def _stream_member(archive: zipfile.ZipFile, arcname: str, source: Path, role: str) -> dict[str, Any]:
    digest = hashlib.sha256()
    size = 0
    stamp = time.localtime(source.stat().st_mtime)[:6]
    info = zipfile.ZipInfo(arcname, stamp)
    # Audio formats are already compressed or can be very expensive to deflate.
    # Store them directly so exporting performs one source-file read instead of
    # hashing once and compressing/copying a second time.
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o600 << 16
    with source.open("rb") as input_file, archive.open(info, "w", force_zip64=True) as output_file:
        while chunk := input_file.read(packages._STREAM_CHUNK):
            digest.update(chunk)
            size += len(chunk)
            output_file.write(chunk)
    mime, _ = mimetypes.guess_type(arcname)
    return {
        "path": arcname,
        "role": role,
        "size": size,
        "sha256": digest.hexdigest(),
        "mime": mime or "application/octet-stream",
    }


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
    """Create a package atomically while reading each large media file once."""
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

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.partial")
    files = [packages._file_descriptor("chart.json", "chart", payload=chart_bytes)]
    try:
        with zipfile.ZipFile(partial, "w", allowZip64=True) as archive:
            archive.writestr("chart.json", chart_bytes, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
            for arcname, source, role in included:
                files.append(_stream_member(archive, arcname, source, role))

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
        if partial.stat().st_size > packages._MAX_PACKAGE_BYTES:
            raise ValueError("The exported RIL package exceeds the 1.5 GB safety limit")
        os.replace(partial, destination)
        return manifest
    except Exception:
        partial.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise


def export_package(app: Any, payload: dict[str, Any], app_version: str) -> dict[str, Any]:
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
    export_root = exports_root(app)
    package_path = _unique_export_path(export_root, title)
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

    token = uuid.uuid4().hex
    token_dir = packages._TEMP_ROOT / "exports" / token
    token_dir.mkdir(parents=True, exist_ok=True)
    (token_dir / "export.json").write_text(json.dumps({"filename": package_path.name}), encoding="utf-8")
    return {
        "token": token,
        "filename": package_path.name,
        "size_bytes": int(package_path.stat().st_size),
        "saved_path": str(package_path),
        "export_folder": str(export_root),
        "download_url": f"/api/ril/export/file?token={token}&filename={urllib.parse.quote(package_path.name)}",
        "manifest": manifest,
        "_package_path": str(package_path),
    }


def enforce_discord_limit(result: dict[str, Any], requested: bool) -> dict[str, Any]:
    size = int(result.get("size_bytes") or 0)
    result["discord_limit_bytes"] = discord_export_backend.DISCORD_PACKAGE_LIMIT
    result["discord_ready"] = size <= discord_export_backend.DISCORD_PACKAGE_LIMIT
    raw_path = str(result.pop("_package_path", "") or "")
    package_path = Path(raw_path) if raw_path else None
    if requested and not result["discord_ready"]:
        if package_path is not None and package_path.is_file():
            package_path.unlink(missing_ok=True)
        token = str(result.get("token") or "")
        if token:
            shutil.rmtree(packages._TEMP_ROOT / "exports" / token, ignore_errors=True)
        over = size - discord_export_backend.DISCORD_PACKAGE_LIMIT
        raise ValueError(
            f"The finished package is {over / 1_000_000:.2f} MB over the Discord 8 MB target. "
            "Remove vocals, instrumental, or the optional source chart and export again."
        )
    return result


def _open_folder(path: Path) -> None:
    if os.name == "nt":
        os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def install_ril_export_reliability(backend: ModuleType) -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    packages.create_ril_package = create_ril_package
    packages._export_package = export_package
    discord_export_backend.enforce_discord_limit = enforce_discord_limit

    app_class = backend.RhythmApp
    original_list_songs = app_class.list_songs

    def list_songs(self) -> list[dict]:  # type: ignore[no-untyped-def]
        return [row for row in original_list_songs(self) if str(row.get("folder") or "").casefold() != EXPORT_FOLDER_NAME.casefold()]

    app_class.list_songs = list_songs

    handler = backend.Handler
    original_get = handler.do_GET
    original_post = handler.do_POST

    def do_GET(self) -> None:  # type: ignore[no-untyped-def]
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/ril/export/file":
            return original_get(self)
        try:
            query = urllib.parse.parse_qs(parsed.query)
            token = str(query.get("token", [""])[0])
            if not packages._DOWNLOAD_TOKEN.match(token):
                raise ValueError("Invalid RIL download token")
            metadata_path = packages._TEMP_ROOT / "exports" / token / "export.json"
            if not metadata_path.is_file():
                raise FileNotFoundError("RIL export download link expired")
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            filename = Path(str(metadata.get("filename") or "song.ril")).name
            package_path = exports_root(self.app) / filename
            if not package_path.is_file():
                raise FileNotFoundError("Saved RIL export was not found")
            packages._stream_attachment(self, package_path, filename)
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except OSError as exc:
            if not packages._client_disconnected(exc):
                self._error(exc, 400)
        except Exception as exc:
            self._error(exc, 400)

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path != "/api/ril/export/open-folder":
            return original_post(self)
        try:
            root = exports_root(self.app)
            _open_folder(root)
            self._json({"ok": True, "data": {"path": str(root)}})
        except Exception as exc:
            self._error(exc, 400)

    handler.do_GET = do_GET
    handler.do_POST = do_POST
    handler._ril_export_reliability_installed = True
    _INSTALLED = True
