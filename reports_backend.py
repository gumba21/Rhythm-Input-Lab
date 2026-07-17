from __future__ import annotations

import urllib.parse
from pathlib import Path

import backend


def install_report_endpoint() -> None:
    """Serve saved attempt reports through the local app without exposing arbitrary files."""

    if getattr(backend.Handler, "_ril_reports_installed", False):
        return

    original_do_get = backend.Handler.do_GET

    def do_get(self: backend.Handler) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/report":
            original_do_get(self)
            return

        query = urllib.parse.parse_qs(parsed.query)
        try:
            song_name = query.get("folder", [""])[0]
            attempt_name = query.get("attempt", [""])[0]
            song_folder = self.app.song_folder(song_name)
            attempt_folder = backend.safe_relative_child(song_folder, attempt_name)
            if not attempt_folder.exists() or not attempt_folder.is_dir():
                raise FileNotFoundError("Attempt not found")
            report_path = backend.safe_relative_child(attempt_folder, "report.html")
            if not report_path.exists() or not report_path.is_file():
                raise FileNotFoundError("Report not found for this attempt")
            self._send(200, report_path.read_bytes(), "text/html; charset=utf-8")
        except FileNotFoundError as exc:
            self._error(exc, 404)
        except Exception as exc:
            self._error(exc, 400)

    backend.Handler.do_GET = do_get
    backend.Handler._ril_reports_installed = True
