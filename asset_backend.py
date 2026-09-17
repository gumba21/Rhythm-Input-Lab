from __future__ import annotations

import base64
import urllib.parse
from pathlib import Path
from types import ModuleType


def load_packaged_note_atlas(web_dir: Path) -> bytes:
    """Load and validate the chunked NOTE_assets PNG bundled with the app."""
    atlas_dir = Path(web_dir) / "assets" / "NOTE_assets64.b64"
    parts = sorted(atlas_dir.glob("part*.b64"))
    if not parts:
        raise FileNotFoundError("Packaged NOTE_assets atlas chunks were not found")

    encoded = "".join(
        "".join(part.read_text(encoding="ascii").split())
        for part in parts
    )
    body = base64.b64decode(encoded, validate=True)
    if not body.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Packaged NOTE_assets atlas is not a PNG")
    return body


def install_note_atlas_endpoint(backend: ModuleType) -> None:
    """Serve the packaged multi-key atlas as /assets/NOTE_assets.png."""
    handler = backend.Handler
    if getattr(handler, "_ril_note_atlas_endpoint_installed", False):
        return

    original = handler._serve_static
    atlas_body = load_packaged_note_atlas(Path(backend.WEB_DIR))

    def serve_static(self, url_path: str) -> None:
        relative = urllib.parse.unquote(url_path.lstrip("/"))
        if relative == "assets/NOTE_assets.png":
            self._send(200, atlas_body, "image/png")
            return
        original(self, url_path)

    handler._serve_static = serve_static
    handler._ril_note_atlas_endpoint_installed = True
