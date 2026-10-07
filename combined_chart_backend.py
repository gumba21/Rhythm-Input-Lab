from __future__ import annotations

import copy
import json
import os
import shutil
import time
import urllib.parse
from pathlib import Path
from types import ModuleType
from typing import Any

import bundle_compat
import combined_chart
import rhythm_input_lab_core as core
import ril_package_backend as packages


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        value = {}
    return value if isinstance(value, dict) else {}


def _unique_folder(root: Path, title: str) -> Path:
    base = core.safe_name(title, "Combined Chart")
    candidate = root / base
    suffix = 2
    while candidate.exists():
        candidate = root / f"{base} ({suffix})"
        suffix += 1
    return candidate


def _link_or_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def _copy_media(source_folder: Path, target_folder: Path) -> None:
    source_audio = source_folder / "audio"
    if not source_audio.exists():
        return
    target_audio = target_folder / "audio"
    for source in sorted(source_audio.iterdir()):
        if source.is_file():
            _link_or_copy(source, target_audio / source.name)


def _source_bundle(app: Any, folder_name: str) -> tuple[Path, dict[str, Any], dict[str, Any]]:
    source_folder = app.song_folder(folder_name)
    data = app.song_bundle(folder_name)
    bundle = data.get("bundle")
    if not isinstance(bundle, dict):
        raise ValueError("This song does not have a chart.")
    source_meta = _read_json(source_folder / "song.json")
    return source_folder, bundle, source_meta


def _suggested_name(bundle: dict[str, Any]) -> str:
    title = str((bundle.get("summary") or {}).get("song_name") or "Untitled Song")
    return f"{title} — Combined"


def _preview_payload(result: dict[str, Any], suggested_name: str) -> dict[str, Any]:
    decisions = list(result.get("decisions") or [])
    accepted = [row for row in decisions if row.get("accepted")]
    rejected = [row for row in decisions if not row.get("accepted")]
    return {
        "compatible": True,
        "suggested_name": suggested_name,
        "stats": result.get("stats") or {},
        "warnings": result.get("warnings") or [],
        "config": result.get("config") or {},
        "handoffs": result.get("handoffs") or [],
        "decision_summary": {
            "accepted": len(accepted),
            "rejected": len(rejected),
            "insertions_by_reason": (result.get("stats") or {}).get("insertions_by_reason") or {},
            "rejections_by_reason": (result.get("stats") or {}).get("rejections_by_reason") or {},
        },
        # Enough detail for deterministic inspection without echoing the generated chart itself.
        "decisions": decisions[:1000],
        "decisions_truncated": len(decisions) > 1000,
    }


def preview_combined_chart(app: Any, payload: dict[str, Any]) -> dict[str, Any]:
    folder_name = str(payload.get("folder") or "")
    _, bundle, _ = _source_bundle(app, folder_name)
    suggested_name = str(payload.get("song_name") or _suggested_name(bundle)).strip()
    result = combined_chart.generate_combined_chart(
        bundle,
        {
            "strength": str(payload.get("strength") or "balanced"),
            "song_name": suggested_name,
        },
    )
    return _preview_payload(result, suggested_name)


def save_combined_chart(app: Any, payload: dict[str, Any], app_version: str) -> dict[str, Any]:
    folder_name = str(payload.get("folder") or "")
    source_folder, bundle, source_meta = _source_bundle(app, folder_name)
    title = str(payload.get("song_name") or _suggested_name(bundle)).strip()
    if not title:
        title = _suggested_name(bundle)
    strength = str(payload.get("strength") or "balanced").casefold()
    result = combined_chart.generate_combined_chart(
        bundle,
        {"strength": strength, "song_name": title},
    )
    generated = bundle_compat.complete_bundle_summary(result["chart"])
    target_folder = _unique_folder(app.output_root, title)
    target_folder.mkdir(parents=True, exist_ok=False)

    try:
        compact = packages.bundle_to_compact_chart(generated)
        packages._write_bundle_files(target_folder, generated, compact)
        _copy_media(source_folder, target_folder)

        source_summary = bundle.get("summary") or {}
        generated_summary = generated.get("summary") or {}
        generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        source_provenance = source_meta.get("provenance") if isinstance(source_meta.get("provenance"), dict) else {}

        song_meta: dict[str, Any] = {
            "song_name": title,
            "song_id": core.song_id(title),
            "difficulty": str(source_meta.get("difficulty") or ""),
            "original_charter": str(
                source_meta.get("original_charter")
                or source_meta.get("charter")
                or source_summary.get("original_charter")
                or source_summary.get("charter")
                or ""
            ),
            "media": copy.deepcopy(source_meta.get("media") or {}),
            "ril": {
                "chart_version": packages.RIL_CHART_VERSION,
                "package_version": packages.RIL_PACKAGE_VERSION,
                "app_version": app_version,
                "portable": True,
            },
            "imported_chart": {
                "format": "ril_combined_chart",
                "key_count": int(generated_summary.get("key_count") or 4),
                "player_notes": int(generated_summary.get("player_notes") or 0),
                "events": int(generated_summary.get("event_count") or 0),
                "importer_version": app_version,
                "imported_at": generated_at,
            },
            "derived_chart": {
                "type": combined_chart.MERGE_KIND,
                "generator_version": combined_chart.GENERATOR_VERSION,
                "strength": strength,
                "generated_at": generated_at,
                "source_folder": source_folder.name,
                "source_song_name": str(source_summary.get("song_name") or source_folder.name),
                "source_song_id": str(source_summary.get("song_id") or ""),
                "source_format": str(source_summary.get("source_format") or source_summary.get("format") or ""),
                "stats": copy.deepcopy(result.get("stats") or {}),
            },
            "provenance": {
                "derived_from": source_folder.name,
                "derived_at": generated_at,
                "source_format": str(source_summary.get("source_format") or source_summary.get("format") or ""),
                "original_charter": str(
                    source_meta.get("original_charter")
                    or source_meta.get("charter")
                    or source_summary.get("original_charter")
                    or ""
                ),
                "parent_provenance": copy.deepcopy(source_provenance),
            },
        }
        (target_folder / "song.json").write_text(
            json.dumps(song_meta, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        shutil.rmtree(target_folder, ignore_errors=True)
        raise

    song = next(
        (row for row in app.list_songs() if row.get("folder") == target_folder.name),
        None,
    )
    return {
        "song": song or {"folder": target_folder.name, "song_name": title},
        "stats": result.get("stats") or {},
        "warnings": result.get("warnings") or [],
        "strength": strength,
        "source_folder": source_folder.name,
    }


def install_combined_chart_endpoint(backend: ModuleType) -> None:
    handler = backend.Handler
    if getattr(handler, "_ril_combined_chart_installed", False):
        return

    original_post = handler.do_POST

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path not in {"/api/combined-chart/preview", "/api/combined-chart/save"}:
            return original_post(self)
        try:
            payload = self._body_json()
            if path == "/api/combined-chart/preview":
                result = preview_combined_chart(self.app, payload)
            else:
                result = save_combined_chart(self.app, payload, str(backend.APP_VERSION))
            self._json({"ok": True, "data": result})
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    handler.do_POST = do_POST
    handler._ril_combined_chart_installed = True
