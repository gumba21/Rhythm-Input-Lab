from __future__ import annotations

import argparse
import json
import mimetypes
import os
import socket
import tempfile
import threading
import time
import urllib.parse
import webbrowser
from collections import defaultdict, deque
from dataclasses import asdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

import fnf_importer
import rhythm_input_lab_core as core

APP_NAME = "Rhythm Input Lab"
APP_VERSION = "4.2"
BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR / "web"


def json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def safe_relative_child(root: Path, name: str) -> Path:
    root = root.resolve()
    candidate = (root / name).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Invalid path")
    return candidate


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def now_stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def attempts_for_song(song_folder: Path) -> list[dict]:
    attempts: list[dict] = []
    if not song_folder.exists():
        return attempts
    for child in sorted(song_folder.iterdir(), reverse=True):
        if not child.is_dir() or not child.name.startswith("Attempt "):
            continue
        session = read_json(child / "session.json", {}) or {}
        analysis = read_json(child / "analysis.json", {}) or {}
        attempts.append(
            {
                "folder": child.name,
                "attempt_number": session.get("attempt_number"),
                "recorded_at": session.get("recorded_at", ""),
                "difficulty": session.get("difficulty", ""),
                "game": session.get("game", ""),
                "key_count": session.get("key_count"),
                "note": session.get("post_play_note", ""),
                "lane_presses": analysis.get("recording", {}).get("lane_press_count"),
                "dodge_presses": analysis.get("recording", {}).get("dodge_press_count"),
                "peak_nps": analysis.get("speed", {}).get("peak_1s", {}).get("nps"),
                "active_duration_ms": analysis.get("recording", {}).get("active_duration_ms"),
                "chart_match": analysis.get("chart", {}).get("matching", {}).get("estimated_match_percent"),
            }
        )
    return attempts


def build_song_entry(song_folder: Path) -> dict:
    song_meta = read_json(song_folder / "song.json", {}) or {}
    summary = read_json(song_folder / "chart" / "import_summary.json", None)
    attempts = attempts_for_song(song_folder)
    latest = attempts[0] if attempts else None
    return {
        "folder": song_folder.name,
        "song_name": song_meta.get("song_name") or (summary or {}).get("song_name") or song_folder.name,
        "song_id": song_meta.get("song_id") or (summary or {}).get("song_id") or core.song_id(song_folder.name),
        "has_chart": summary is not None,
        "chart": summary,
        "attempt_count": len(attempts),
        "latest_attempt": latest,
    }


def press_rows(events: list[core.Event], lane_keys: list[str]) -> list[dict]:
    presses = core.pair_presses(events)
    lane_map = {str(key).casefold(): index for index, key in enumerate(lane_keys)}
    rows = []
    for index, press in enumerate(presses):
        lane = lane_map.get(str(press.key).casefold()) if press.role == "lane" else None
        rows.append(
            {
                "id": index,
                "time_ms": float(press.time_ms),
                "key": press.key,
                "role": press.role,
                "lane": lane,
                "held_ms": None if press.held_ms is None else float(press.held_ms),
            }
        )
    return rows


class RecorderState:
    def __init__(self, app: "RhythmApp") -> None:
        self.app = app
        self.lock = threading.RLock()
        self.listener: Any = None
        self.status = "idle"
        self.message = "Ready"
        self.metadata: dict[str, Any] = {}
        self.events: list[core.Event] = []
        self.pressed: set[tuple[str, str]] = set()
        self.down_times: dict[tuple[str, str], int] = {}
        self.start_ns = 0
        self.started_at_wall = 0.0
        self.lane_count = 0
        self.dodge_count = 0
        self.recent_lane_times: deque[float] = deque()
        self.saved_attempt: Optional[Path] = None
        self.error: Optional[str] = None

    def _profile(self) -> tuple[int, list[str], bool, Optional[str], str, str]:
        settings = self.app.settings
        key_count = int(self.metadata.get("key_count") or 4)
        if key_count not in core.SUPPORTED:
            raise ValueError("Only 4K through 9K are supported")
        profile = settings["profiles"][str(key_count)]
        if not profile.get("enabled", True):
            raise ValueError(f"{key_count}K is disabled")
        lane_keys = list(profile["keys"])
        dodge_enabled = bool(self.metadata.get("dodge_enabled", settings["dodge"]["enabled"]))
        dodge_key = core.norm_key(self.metadata.get("dodge_key") or settings["dodge"]["key"]) if dodge_enabled else None
        start_key = core.norm_key(settings["controls"]["start_key"])
        stop_key = core.norm_key(settings["controls"]["stop_key"])
        if dodge_key and dodge_key in lane_keys:
            raise ValueError("Dodge key conflicts with a lane key")
        if start_key in lane_keys or stop_key in lane_keys:
            raise ValueError("Recorder hotkey conflicts with a lane key")
        if dodge_key in {start_key, stop_key}:
            raise ValueError("Dodge key conflicts with a recorder hotkey")
        return key_count, lane_keys, dodge_enabled, dodge_key, start_key, stop_key

    def arm(self, metadata: dict[str, Any]) -> dict:
        try:
            from pynput import keyboard
        except ImportError as exc:
            raise RuntimeError("pynput is not installed. Run install.bat first.") from exc

        with self.lock:
            self.stop_listener()
            self.metadata = dict(metadata)
            key_count, lane_keys, dodge_enabled, dodge_key, start_key, stop_key = self._profile()
            self.metadata["key_count"] = key_count
            self.metadata["lane_keys"] = lane_keys
            self.metadata["dodge_enabled"] = dodge_enabled
            self.metadata["dodge_key"] = dodge_key
            self.events = []
            self.pressed.clear()
            self.down_times.clear()
            self.lane_count = 0
            self.dodge_count = 0
            self.recent_lane_times.clear()
            self.saved_attempt = None
            self.error = None
            self.status = "armed"
            self.message = f"Armed — press {start_key.upper()} to start"

        lane_set = set(lane_keys)

        def role_for(name: str) -> Optional[str]:
            if name in lane_set:
                return "lane"
            if dodge_enabled and name == dodge_key:
                return "dodge"
            return None

        def on_press(key: Any):
            name = core.key_name(key)
            with self.lock:
                if name == start_key and self.status == "armed":
                    self._begin_locked()
                    return None
                if name == stop_key and self.status == "recording":
                    self._finish_locked()
                    threading.Thread(target=self._save_finished, daemon=True).start()
                    return False
                if self.status != "recording":
                    return None
                role = role_for(name)
                if role is None:
                    return None
                identity = (name, role)
                if identity in self.pressed:
                    return None
                now_ns = time.perf_counter_ns()
                self.pressed.add(identity)
                self.down_times[identity] = now_ns
                elapsed_ms = (now_ns - self.start_ns) / 1_000_000
                self.events.append(core.Event(elapsed_ms, name, role, "down", None))
                if role == "lane":
                    self.lane_count += 1
                    now_s = time.perf_counter()
                    self.recent_lane_times.append(now_s)
                    while self.recent_lane_times and now_s - self.recent_lane_times[0] > 1.0:
                        self.recent_lane_times.popleft()
                else:
                    self.dodge_count += 1
            return None

        def on_release(key: Any):
            name = core.key_name(key)
            with self.lock:
                if self.status != "recording":
                    return None
                role = role_for(name)
                if role is None:
                    return None
                identity = (name, role)
                if identity not in self.pressed:
                    return None
                now_ns = time.perf_counter_ns()
                down_ns = self.down_times.pop(identity, now_ns)
                self.pressed.discard(identity)
                self.events.append(
                    core.Event(
                        (now_ns - self.start_ns) / 1_000_000,
                        name,
                        role,
                        "up",
                        (now_ns - down_ns) / 1_000_000,
                    )
                )
            return None

        self.listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        self.listener.start()
        return self.snapshot()

    def start_now(self) -> dict:
        with self.lock:
            if self.status != "armed":
                raise ValueError("Recorder is not armed")
            self._begin_locked()
            return self.snapshot()

    def _begin_locked(self) -> None:
        self.events = []
        self.pressed.clear()
        self.down_times.clear()
        self.lane_count = 0
        self.dodge_count = 0
        self.recent_lane_times.clear()
        self.start_ns = time.perf_counter_ns()
        self.started_at_wall = time.perf_counter()
        self.status = "recording"
        self.message = "Recording"

    def stop_now(self) -> dict:
        with self.lock:
            if self.status != "recording":
                raise ValueError("Recorder is not recording")
            self._finish_locked()
            if self.listener is not None:
                try:
                    self.listener.stop()
                except Exception:
                    pass
            threading.Thread(target=self._save_finished, daemon=True).start()
            return self.snapshot()

    def cancel(self) -> dict:
        with self.lock:
            self.stop_listener()
            self.status = "idle"
            self.message = "Cancelled"
            self.events = []
            return self.snapshot()

    def _finish_locked(self) -> None:
        now_ns = time.perf_counter_ns()
        for identity in list(self.pressed):
            down_ns = self.down_times.get(identity, now_ns)
            key_name, role = identity
            self.events.append(
                core.Event(
                    (now_ns - self.start_ns) / 1_000_000,
                    key_name,
                    role,
                    "up",
                    (now_ns - down_ns) / 1_000_000,
                )
            )
        self.pressed.clear()
        self.down_times.clear()
        self.status = "saving"
        self.message = "Saving attempt"

    def _save_finished(self) -> None:
        try:
            with self.lock:
                events = sorted(list(self.events), key=lambda e: e.time_ms)
                metadata = dict(self.metadata)
            if not events:
                raise ValueError("No inputs were recorded")
            name = str(metadata.get("song_name") or "Untitled Song")
            output_root = Path(self.app.settings["output_root"]).expanduser()
            song_folder = core.resolve_song_folder(output_root, name)
            attempt_number = core.next_attempt(song_folder)
            attempt_folder = song_folder / f"Attempt {attempt_number:03d} — {time.strftime('%Y-%m-%d_%H-%M-%S')}"
            attempt_folder.mkdir(parents=True, exist_ok=False)
            metadata.update(
                {
                    "song_name": name,
                    "song_id": core.song_id(name),
                    "attempt_number": attempt_number,
                    "recorded_at": now_stamp(),
                    "game": str(metadata.get("game") or ""),
                    "difficulty": str(metadata.get("difficulty") or ""),
                    "tags": metadata.get("tags") or [],
                    "pre_play_note": str(metadata.get("pre_play_note") or ""),
                    "post_play_note": str(metadata.get("post_play_note") or ""),
                    "recorder_version": APP_VERSION,
                    "analyzer_version": APP_VERSION,
                }
            )
            core.write_csv(events, attempt_folder / "inputs.csv")
            (attempt_folder / "session.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
            # Save immediately without the older expensive chart matcher. The GUI performs
            # interactive chart matching and lets the user tune the offset in real time.
            analysis = core.analyze(events, metadata, self.app.settings, chart_bundle=None)
            (attempt_folder / "analysis.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")
            core.render_report(analysis, attempt_folder / "report.html")
            core.history(song_folder)
            with self.lock:
                self.saved_attempt = attempt_folder
                self.status = "saved"
                self.message = f"Saved Attempt {attempt_number:03d}"
        except Exception as exc:
            with self.lock:
                self.error = str(exc)
                self.status = "error"
                self.message = str(exc)

    def stop_listener(self) -> None:
        if self.listener is not None:
            try:
                self.listener.stop()
            except Exception:
                pass
            self.listener = None

    def snapshot(self) -> dict:
        with self.lock:
            elapsed = time.perf_counter() - self.started_at_wall if self.status == "recording" else 0.0
            now_s = time.perf_counter()
            while self.recent_lane_times and now_s - self.recent_lane_times[0] > 1.0:
                self.recent_lane_times.popleft()
            return {
                "status": self.status,
                "message": self.message,
                "elapsed_ms": elapsed * 1000.0,
                "lane_presses": self.lane_count,
                "dodge_presses": self.dodge_count,
                "current_nps": len(self.recent_lane_times),
                "saved_attempt": str(self.saved_attempt) if self.saved_attempt else None,
                "saved_song": self.saved_attempt.parent.name if self.saved_attempt else None,
                "saved_attempt_folder": self.saved_attempt.name if self.saved_attempt else None,
                "error": self.error,
                "metadata": self.metadata,
            }


class RhythmApp:
    def __init__(self) -> None:
        self.settings = core.load_settings()
        self.recorder = RecorderState(self)
        self.server: Optional[ThreadingHTTPServer] = None

    @property
    def output_root(self) -> Path:
        root = Path(self.settings["output_root"]).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        return root

    def list_songs(self) -> list[dict]:
        entries = []
        for child in self.output_root.iterdir():
            if child.is_dir():
                entries.append(build_song_entry(child))
        entries.sort(
            key=lambda item: (
                (item.get("latest_attempt") or {}).get("recorded_at", ""),
                item.get("song_name", "").casefold(),
            ),
            reverse=True,
        )
        return entries

    def dashboard(self) -> dict:
        songs = self.list_songs()
        attempts = sum(song["attempt_count"] for song in songs)
        charts = sum(1 for song in songs if song["has_chart"])
        presses = 0
        recent_attempts = []
        for song in songs:
            folder = self.output_root / song["folder"]
            for attempt in attempts_for_song(folder):
                presses += int(attempt.get("lane_presses") or 0) + int(attempt.get("dodge_presses") or 0)
                recent_attempts.append({**attempt, "song_folder": song["folder"], "song_name": song["song_name"]})
        recent_attempts.sort(key=lambda item: item.get("recorded_at", ""), reverse=True)
        return {
            "songs": len(songs),
            "attempts": attempts,
            "charts": charts,
            "total_presses": presses,
            "recent_songs": songs[:6],
            "recent_attempts": recent_attempts[:8],
        }

    def song_folder(self, name: str) -> Path:
        folder = safe_relative_child(self.output_root, name)
        if not folder.exists() or not folder.is_dir():
            raise FileNotFoundError("Song folder not found")
        return folder

    def song_bundle(self, folder_name: str) -> dict:
        folder = self.song_folder(folder_name)
        bundle = fnf_importer.load_chart_bundle(folder)
        return {
            "song": build_song_entry(folder),
            "bundle": bundle,
            "attempts": attempts_for_song(folder),
        }

    def attempt_bundle(self, folder_name: str, attempt_name: str) -> dict:
        song_folder = self.song_folder(folder_name)
        attempt_folder = safe_relative_child(song_folder, attempt_name)
        if not attempt_folder.exists() or not attempt_folder.is_dir():
            raise FileNotFoundError("Attempt not found")
        session = read_json(attempt_folder / "session.json", {}) or {}
        analysis = read_json(attempt_folder / "analysis.json", {}) or {}
        events = core.load_events(attempt_folder / "inputs.csv")
        lane_keys = list(session.get("lane_keys") or [])
        return {
            "folder": attempt_folder.name,
            "session": session,
            "analysis": analysis,
            "presses": press_rows(events, lane_keys),
        }

    def import_chart(self, payload: dict) -> dict:
        filename = str(payload.get("filename") or "song.json")
        content = payload.get("content")
        if not isinstance(content, str):
            raise ValueError("Chart content is missing")
        data = json.loads(content)
        override = payload.get("key_count")
        key_count = int(override) if override not in (None, "") else None
        bundle = fnf_importer.normalize_fnf_chart(data, filename, key_count_override=key_count)
        folder_name = str(payload.get("song_name") or bundle["summary"]["song_name"])
        bundle["summary"]["song_name"] = folder_name
        bundle["summary"]["song_id"] = core.song_id(folder_name)

        extra_content = payload.get("events_content")
        if isinstance(extra_content, str) and extra_content.strip():
            extra_name = str(payload.get("events_filename") or "events.json")
            extra_data = json.loads(extra_content)
            extra_bundle = fnf_importer.normalize_fnf_chart(
                extra_data,
                extra_name,
                key_count_override=bundle["summary"]["key_count"],
            )
            bundle = fnf_importer.merge_event_bundle(bundle, extra_bundle, extra_name)

        song_folder = core.resolve_song_folder(self.output_root, folder_name)
        with tempfile.TemporaryDirectory(prefix="ril_chart_") as temp_dir:
            original = Path(temp_dir) / core.safe_name(filename, "original.json")
            original.write_text(content, encoding="utf-8")
            fnf_importer.write_chart_bundle(bundle, song_folder / "chart", original)
        if isinstance(extra_content, str) and extra_content.strip():
            (song_folder / "chart" / "original_events.json").write_text(extra_content, encoding="utf-8")

        song_meta = read_json(song_folder / "song.json", {}) or {
            "song_name": folder_name,
            "song_id": core.song_id(folder_name),
        }
        song_meta["song_name"] = folder_name
        song_meta["song_id"] = core.song_id(folder_name)
        song_meta["imported_chart"] = {
            "format": bundle["summary"]["format"],
            "key_count": bundle["summary"]["key_count"],
            "player_notes": bundle["summary"]["player_notes"],
            "events": bundle["summary"]["event_count"],
            "importer_version": bundle["summary"]["importer_version"],
            "imported_at": now_stamp(),
        }
        (song_folder / "song.json").write_text(json.dumps(song_meta, indent=2), encoding="utf-8")
        return {"song": build_song_entry(song_folder), "summary": bundle["summary"]}

    def update_settings(self, payload: dict) -> dict:
        settings = core.merge(payload, core.DEFAULTS)
        settings = core.validate(settings)
        self.settings = settings
        core.save_settings(settings)
        return settings

    def update_attempt_note(self, folder_name: str, attempt_name: str, note: str) -> dict:
        song_folder = self.song_folder(folder_name)
        attempt_folder = safe_relative_child(song_folder, attempt_name)
        session_path = attempt_folder / "session.json"
        session = read_json(session_path, {}) or {}
        session["post_play_note"] = str(note)
        session_path.write_text(json.dumps(session, indent=2), encoding="utf-8")
        analysis_path = attempt_folder / "analysis.json"
        analysis = read_json(analysis_path, {}) or {}
        if analysis:
            analysis.setdefault("metadata", {})["post_play_note"] = str(note)
            analysis_path.write_text(json.dumps(analysis, indent=2), encoding="utf-8")
            try:
                core.render_report(analysis, attempt_folder / "report.html")
            except Exception:
                pass
        core.history(song_folder)
        return session


class Handler(BaseHTTPRequestHandler):
    app: RhythmApp

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _send(self, status: int, body: bytes, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: Any, status: int = 200) -> None:
        self._send(status, json_bytes(payload))

    def _error(self, exc: Exception, status: int = 400) -> None:
        self._json({"ok": False, "error": str(exc)}, status)

    def _body_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > 20_000_000:
            raise ValueError("Request is too large")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Expected a JSON object")
        return data

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        path = parsed.path
        try:
            if path == "/api/health":
                self._json({"ok": True, "app": APP_NAME, "version": APP_VERSION})
            elif path == "/api/dashboard":
                self._json({"ok": True, "data": self.app.dashboard()})
            elif path == "/api/settings":
                self._json({"ok": True, "data": self.app.settings})
            elif path == "/api/songs":
                self._json({"ok": True, "data": self.app.list_songs()})
            elif path == "/api/song":
                folder = query.get("folder", [""])[0]
                self._json({"ok": True, "data": self.app.song_bundle(folder)})
            elif path == "/api/attempt":
                folder = query.get("folder", [""])[0]
                attempt = query.get("attempt", [""])[0]
                self._json({"ok": True, "data": self.app.attempt_bundle(folder, attempt)})
            elif path == "/api/record/status":
                self._json({"ok": True, "data": self.app.recorder.snapshot()})
            elif path == "/api/shutdown":
                self._json({"ok": True})
                threading.Thread(target=self.app.server.shutdown, daemon=True).start()  # type: ignore[union-attr]
            else:
                self._serve_static(path)
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            payload = self._body_json()
            if path == "/api/settings":
                self._json({"ok": True, "data": self.app.update_settings(payload)})
            elif path == "/api/import-chart":
                self._json({"ok": True, "data": self.app.import_chart(payload)})
            elif path == "/api/record/arm":
                self._json({"ok": True, "data": self.app.recorder.arm(payload)})
            elif path == "/api/record/start":
                self._json({"ok": True, "data": self.app.recorder.start_now()})
            elif path == "/api/record/stop":
                self._json({"ok": True, "data": self.app.recorder.stop_now()})
            elif path == "/api/record/cancel":
                self._json({"ok": True, "data": self.app.recorder.cancel()})
            elif path == "/api/attempt/note":
                result = self.app.update_attempt_note(
                    str(payload.get("folder") or ""),
                    str(payload.get("attempt") or ""),
                    str(payload.get("note") or ""),
                )
                self._json({"ok": True, "data": result})
            elif path == "/api/open-output":
                root = self.app.output_root
                if os.name == "nt":
                    os.startfile(root)  # type: ignore[attr-defined]
                self._json({"ok": True, "path": str(root)})
            else:
                self._error(ValueError("Unknown endpoint"), 404)
        except Exception as exc:
            self._error(exc, 400)

    def _serve_static(self, url_path: str) -> None:
        relative = "index.html" if url_path in {"", "/"} else urllib.parse.unquote(url_path.lstrip("/"))
        file_path = safe_relative_child(WEB_DIR, relative)
        if not file_path.exists() or not file_path.is_file():
            file_path = WEB_DIR / "index.html"
        mime, _ = mimetypes.guess_type(file_path.name)
        self._send(200, file_path.read_bytes(), mime or "application/octet-stream")


def free_port(preferred: int = 8765) -> int:
    for port in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def run_server(no_browser: bool = False, port: Optional[int] = None) -> None:
    app = RhythmApp()
    chosen = port or free_port()
    handler = type("RhythmHandler", (Handler,), {"app": app})
    server = ThreadingHTTPServer(("127.0.0.1", chosen), handler)
    app.server = server
    url = f"http://127.0.0.1:{chosen}/"
    print(f"{APP_NAME} {APP_VERSION}")
    print(f"GUI: {url}")
    print("Keep this window open while using the app. Press Ctrl+C to quit.")
    if not no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.recorder.stop_listener()
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} {APP_VERSION}")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    run_server(no_browser=args.no_browser, port=args.port)


if __name__ == "__main__":
    main()
