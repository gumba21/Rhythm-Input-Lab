from __future__ import annotations

from pathlib import Path

APP_NAME = "Rhythm Input Lab"
BASE_DIR = Path(__file__).resolve().parent
VERSION_FILE = BASE_DIR / "VERSION"


def read_version() -> str:
    try:
        value = VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"Missing version file: {VERSION_FILE}") from exc
    if not value:
        raise RuntimeError(f"Version file is empty: {VERSION_FILE}")
    return value


APP_VERSION = read_version()
