from __future__ import annotations

import json
import tempfile
from pathlib import Path

import app
import bundle_compat
import discord_export_backend
import fnf_importer
import quaver_importer
import ril_export_reliability
import ril_package_backend as packages
from ril_version import APP_VERSION


def quaver_chart() -> str:
    return """---
QuaVersion: 1
AudioFile: song.ogg
Mode: Keys4
Title: Export Reliability
Artist: RIL Test
Creator: gumba21
DifficultyName: Hard
TimingPoints:
  - StartTime: 0
    Bpm: 120
    Signature: 4
SliderVelocities:
  - StartTime: 500
    Multiplier: 1.5
HitObjects:
  - StartTime: 250
    Lane: 1
    EndTime: 0
  - StartTime: 500
    Lane: 2
    EndTime: 900
  - StartTime: 1000
    Lane: 3
    EndTime: 0
    Type: Mine
  - StartTime: 1250
    Lane: 4
    EndTime: 0
"""


class FakeApp:
    def __init__(self, root: Path, bundle: dict) -> None:
        self._root = root
        self._bundle = bundle
        self.settings = {"profile": {"username": "gumba21"}}

    @property
    def output_root(self) -> Path:
        self._root.mkdir(parents=True, exist_ok=True)
        return self._root

    def song_folder(self, name: str) -> Path:
        folder = self._root / name
        if not folder.is_dir():
            raise FileNotFoundError(name)
        return folder

    def song_bundle(self, name: str) -> dict:
        return {"bundle": self._bundle}


def main() -> None:
    bundle = quaver_importer.parse_qua_text(quaver_chart(), "Export Reliability [Hard].qua")
    bundle_compat.complete_bundle_summary(bundle)
    assert bundle["summary"]["event_type_counts"] == {"Quaver SV change": 1}
    assert bundle["summary"]["note_type_counts"] == {"(normal)": 3, "Quaver Mine": 1}
    assert bundle["summary"]["opponent_notes"] == 0

    with tempfile.TemporaryDirectory(prefix="ril_development_polish_") as temp:
        root = Path(temp)
        song_folder = root / "Export Reliability"
        chart_folder = song_folder / "chart"
        chart_folder.mkdir(parents=True)
        original = root / "source.qua"
        original.write_text(quaver_chart(), encoding="utf-8")
        fnf_importer.write_chart_bundle(bundle, chart_folder, original)
        assert (chart_folder / "song_explorer.html").is_file()
        written_summary = json.loads((chart_folder / "import_summary.json").read_text(encoding="utf-8"))
        assert written_summary["event_type_counts"]["Quaver SV change"] == 1

        audio_dir = song_folder / "audio"
        audio_dir.mkdir()
        instrumental = audio_dir / "instrumental.ogg"
        instrumental.write_bytes(b"OggS" + b"audio" * 4096)
        (song_folder / "song.json").write_text(json.dumps({
            "song_name": "Export Reliability",
            "song_id": "export-reliability",
            "original_charter": "gumba21",
            "media": {
                "instrumental": {
                    "filename": "song.ogg",
                    "stored_name": instrumental.name,
                    "size_bytes": instrumental.stat().st_size,
                },
            },
        }), encoding="utf-8")

        fake = FakeApp(root, bundle)
        result = packages._export_package(fake, {
            "folder": song_folder.name,
            "username": "gumba21",
            "include_instrumental": True,
            "include_vocals": False,
            "include_original": False,
        }, APP_VERSION)
        saved = Path(result["saved_path"])
        assert saved.is_file()
        assert saved.parent.name == ril_export_reliability.EXPORT_FOLDER_NAME
        assert saved.name == "RIL Test - Export Reliability [Hard].ril"
        assert not (packages._TEMP_ROOT / "exports" / result["token"] / "package.ril").exists()
        assert (packages._TEMP_ROOT / "exports" / result["token"] / "export.json").is_file()
        inspected = packages.inspect_ril_package(saved)
        assert inspected["preview"]["instrumental"] is True
        assert inspected["preview"]["notes"] == 4

        accepted = discord_export_backend.enforce_discord_limit(result, False)
        assert accepted["discord_ready"] is True
        assert "_package_path" not in accepted

        oversized = root / "oversized.ril"
        oversized.write_bytes(b"test")
        token = "f" * 32
        token_dir = packages._TEMP_ROOT / "exports" / token
        token_dir.mkdir(parents=True, exist_ok=True)
        try:
            discord_export_backend.enforce_discord_limit({
                "token": token,
                "size_bytes": 8_000_001,
                "_package_path": str(oversized),
            }, True)
        except ValueError as exc:
            assert "Discord 8 MB" in str(exc)
            assert not oversized.exists()
            assert not token_dir.exists()
        else:
            raise AssertionError("Oversized persistent export was accepted")

    web = Path(__file__).parent / "web"
    multi = (web / "quaver-multi-import.js").read_text(encoding="utf-8")
    center = (web / "import-center.js").read_text(encoding="utf-8")
    export_ui = (web / "ril-export-v2.js").read_text(encoding="utf-8")
    app_js = (web / "app.js").read_text(encoding="utf-8")
    assert "input.multiple = true" in multi
    assert "quaverBatchCommit" in multi
    assert "data-import-tab=\"quaver\"" in center
    assert "field.value = name" in center
    assert "/api/ril/export/start" in export_ui
    assert "stopImmediatePropagation" in export_ui
    assert "rilExportV2Modal" in export_ui
    for script in [
        "/quaver-multi-import.js",
        "/import-center.js",
        "/ril-export-v2.js",
        "/ril-export-reliability.js",
        "/ril-export-jobs.js",
    ]:
        assert script in app_js

    assert getattr(app._backend.Handler, "_ril_export_reliability_installed", False)
    assert getattr(app._backend.Handler, "_ril_export_jobs_installed", False)
    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} development polish self-test passed.")


if __name__ == "__main__":
    main()
