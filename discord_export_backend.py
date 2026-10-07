from __future__ import annotations

import shutil
import urllib.parse
from types import ModuleType
from typing import Any

import ril_package_backend as packages

DISCORD_PACKAGE_LIMIT = 8_000_000


def enforce_discord_limit(result: dict[str, Any], requested: bool) -> dict[str, Any]:
    size = int(result.get("size_bytes") or 0)
    result["discord_limit_bytes"] = DISCORD_PACKAGE_LIMIT
    result["discord_ready"] = size <= DISCORD_PACKAGE_LIMIT
    if not requested or result["discord_ready"]:
        return result
    token = str(result.get("token") or "")
    if token:
        shutil.rmtree(packages._TEMP_ROOT / "exports" / token, ignore_errors=True)
    over = size - DISCORD_PACKAGE_LIMIT
    raise ValueError(
        f"The finished package is {over / 1_000_000:.2f} MB over the Discord 8 MB target. "
        "Remove vocals, instrumental, or the optional source chart and export again."
    )


def install_discord_export_endpoint(backend: ModuleType) -> None:
    """Add exact Discord-size enforcement to the existing portable RIL exporter."""
    handler = backend.Handler
    if getattr(handler, "_ril_discord_export_installed", False):
        return
    original_post = handler.do_POST

    def do_POST(self) -> None:  # type: ignore[no-untyped-def]
        path = urllib.parse.urlparse(self.path).path
        if path != "/api/ril/export":
            return original_post(self)
        try:
            payload = self._body_json()
            result = packages._export_package(self.app, payload, str(backend.APP_VERSION))
            result = enforce_discord_limit(result, bool(payload.get("discord_limit")))
            self._json({"ok": True, "data": result})
        except Exception as exc:
            self._error(exc, 400)

    handler.do_POST = do_POST
    handler._ril_discord_export_installed = True
