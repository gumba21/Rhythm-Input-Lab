from __future__ import annotations

import json
import threading
import time
import urllib.parse
from pathlib import Path
from types import ModuleType
from typing import Any

import fnf_importer
import rhythm_input_lab_core as core

_LOCK = threading.RLock()
_MAX_PRESSES = 250_000
_FULL_SONG_TOLERANCE_MS = 500.0


def _number(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _events_from_presses(presses: list[dict], lane_keys: list[str]) -> list[core.Event]:
    events: list[core.Event] = []
    for row in presses:
        lane = int(row.get("lane", -1))
        if lane < 0 or lane >= len(lane_keys):
            continue
        time_ms = max(0.0, _number(row.get("time_ms")))
        held_ms = max(0.0, _number(row.get("held_ms")))
        key = str(row.get("key") or lane_keys[lane]).casefold()
        events.append(core.Event(time_ms, key, "lane", "down", None))
        events.append(core.Event(time_ms + held_ms, key, "lane", "up", held_ms))
    events.sort(key=lambda event: (event.time_ms, 0 if event.event == "down" else 1))
    return events


def _save_practice_attempt(app: Any, payload: dict, app_version: str) -> dict:
    folder_name = str(payload.get("folder") or "")
    song_folder = app.song_folder(folder_name)
    bundle = fnf_importer.load_chart_bundle(song_folder)
    if not bundle:
        raise ValueError("The song does not have an imported chart")

    duration_ms = _number(bundle.get("summary", {}).get("duration_ms"))
    start_ms = _number(payload.get("start_ms"))
    end_ms = _number(payload.get("end_ms"))
    if start_ms > _FULL_SONG_TOLERANCE_MS or end_ms < duration_ms - _FULL_SONG_TOLERANCE_MS:
        raise ValueError("Only completed full-song Practice runs can be saved as song attempts")

    lane_keys = [str(value).casefold() for value in payload.get("lane_keys") or []]
    key_count = int(payload.get("key_count") or len(lane_keys) or bundle.get("summary", {}).get("key_count") or 4)
    if len(lane_keys) != key_count:
        profile = app.settings.get("profiles", {}).get(str(key_count), {})
        lane_keys = [str(value).casefold() for value in profile.get("keys") or []]
    if len(lane_keys) != key_count:
        raise ValueError("Practice key profile does not match the chart key mode")

    presses = payload.get("presses") or []
    if not isinstance(presses, list) or not presses:
        raise ValueError("The Practice run has no recorded inputs")
    if len(presses) > _MAX_PRESSES:
        raise ValueError("The Practice run contains too many inputs")
    events = _events_from_presses(presses, lane_keys)
    if not events:
        raise ValueError("The Practice run has no valid lane inputs")

    song_meta = json.loads((song_folder / "song.json").read_text(encoding="utf-8")) if (song_folder / "song.json").exists() else {}
    song_name = str(song_meta.get("song_name") or payload.get("song_name") or folder_name)
    stats = payload.get("stats") if isinstance(payload.get("stats"), dict) else {}

    with _LOCK:
        attempt_number = core.next_attempt(song_folder)
        attempt_folder = song_folder / f"Attempt {attempt_number:03d} — {time.strftime('%Y-%m-%d_%H-%M-%S')}"
        attempt_folder.mkdir(parents=True, exist_ok=False)
        metadata = {
            "song_name": song_name,
            "song_id": song_meta.get("song_id") or core.song_id(song_name),
            "attempt_number": attempt_number,
            "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "game": "Rhythm Input Lab Practice",
            "difficulty": str(payload.get("difficulty") or ""),
            "key_count": key_count,
            "lane_keys": lane_keys,
            "dodge_enabled": False,
            "dodge_key": None,
            "tags": ["practice", "full song"],
            "pre_play_note": "",
            "post_play_note": "Saved automatically after a completed full-song Practice run.",
            "source": "practice",
            "full_song": True,
            "practice_speed": _number(payload.get("speed"), 1.0),
            "practice_start_ms": start_ms,
            "practice_end_ms": end_ms,
            "practice_completed_at": str(payload.get("completed_at") or ""),
            "practice_summary": stats,
            "recorder_version": app_version,
            "analyzer_version": app_version,
        }
        core.write_csv(events, attempt_folder / "inputs.csv")
        (attempt_folder / "session.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
        analysis = core.analyze(events, metadata, app.settings, chart_bundle=None)
        analysis["practice_summary"] = stats
        (attempt_folder / "analysis.json").write_text(json.dumps(analysis, indent=2, ensure_ascii=False), encoding="utf-8")
        core.render_report(analysis, attempt_folder / "report.html")
        core.history(song_folder)

    return {
        "folder": attempt_folder.name,
        "attempt_number": attempt_number,
        "recorded_at": metadata["recorded_at"],
        "song_folder": folder_name,
        "full_song": True,
    }


def install_practice_attempt_endpoint(backend: ModuleType) -> None:
    handler = backend.Handler
    if getattr(handler, "_ril_practice_attempt_installed", False):
        return
    original_post = handler.do_POST

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path != "/api/practice-attempt/save":
            return original_post(self)
        try:
            payload = self._body_json()
            result = _save_practice_attempt(self.app, payload, str(backend.APP_VERSION))
            self._json({"ok": True, "data": result})
        except Exception as exc:
            self._error(exc, 400)

    handler.do_POST = do_POST
    handler._ril_practice_attempt_installed = True
