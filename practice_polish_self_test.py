from __future__ import annotations

import copy
import tempfile
from pathlib import Path

import app
import discord_export_backend
import neutral_chart_polish
import ril_package_backend as packages
from ril_version import APP_VERSION


def bundle() -> dict:
    return {
        "summary": {
            "format": "osu_mania",
            "source_format": "osu_mania",
            "song_name": "Timed Sections",
            "song_id": "timed-sections",
            "key_count": 4,
            "base_bpm": 120,
            "duration_ms": 5000,
        },
        "notes": [
            {"time_ms": 500, "end_ms": 500, "lane": 0, "raw_lane": 0, "sustain_ms": 0, "owner": "player", "section_index": 0, "must_hit_section": True, "bpm": 120, "note_type": "", "extra_data": []},
            {"time_ms": 2700, "end_ms": 2900, "lane": 1, "raw_lane": 1, "sustain_ms": 200, "owner": "player", "section_index": 1, "must_hit_section": True, "bpm": 180, "note_type": "", "extra_data": []},
        ],
        "events": [],
        "sections": [
            {"section_index": 0, "time_ms": 0, "bpm": 120, "change_bpm": False, "must_hit_section": True, "length_in_steps": 16},
            {"section_index": 1, "time_ms": 2500, "bpm": 180, "change_bpm": True, "must_hit_section": True, "length_in_steps": 16},
        ],
        "mappings": {"note_types": {"": {"category": "normal", "gameplay": True, "should_press": True}}, "event_types": {}},
        "song_metadata": {
            "source_format": "osu_mania",
            "timing_points": [
                {"time_ms": 0, "beat_length": 500, "uninherited": True, "bpm": 120},
                {"time_ms": 2500, "beat_length": 333.333, "uninherited": True, "bpm": 180},
            ],
        },
    }


def main() -> None:
    neutral_chart_polish.install_neutral_chart_polish()
    compact = packages.bundle_to_compact_chart(bundle())
    assert compact["s"][0][5] == 0
    assert compact["s"][1][5] == 2500
    expanded = packages.compact_chart_to_bundle(compact)
    assert expanded["sections"][0]["time_ms"] == 0
    assert expanded["sections"][1]["time_ms"] == 2500

    legacy_doc = copy.deepcopy(compact)
    for row in legacy_doc["s"]:
        del row[5:]
    upgraded = packages.compact_chart_to_bundle(legacy_doc)
    assert upgraded["sections"][1]["time_ms"] == 2500

    with tempfile.TemporaryDirectory(prefix="ril_polish_selftest_"):
        token = "a" * 32
        export_dir = packages._TEMP_ROOT / "exports" / token
        export_dir.mkdir(parents=True, exist_ok=True)
        (export_dir / "package.ril").write_bytes(b"test")
        small = discord_export_backend.enforce_discord_limit({"token": token, "size_bytes": 7_999_999}, True)
        assert small["discord_ready"] is True
        assert small["discord_limit_bytes"] == 8_000_000
        try:
            discord_export_backend.enforce_discord_limit({"token": token, "size_bytes": 8_000_001}, True)
        except ValueError as exc:
            assert "Discord 8 MB" in str(exc)
            assert not export_dir.exists()
        else:
            raise AssertionError("Oversized Discord package was accepted")

    web = Path(__file__).parent / "web"
    polish_js = (web / "practice-polish.js").read_text(encoding="utf-8")
    hotfix_js = (web / "practice-state-hotfix.js").read_text(encoding="utf-8")
    app_js = (web / "app.js").read_text(encoding="utf-8")
    assert "runtime.bypassClick = true" in polish_js
    assert "if (!event.isTrusted) return;" in hotfix_js
    assert app_js.index("/practice-polish.js") < app_js.index("/practice-state-hotfix.js") < app_js.index("/practice.js")

    assert getattr(app._backend.Handler, "_ril_discord_export_installed", False)
    assert getattr(packages, "_neutral_chart_polish_installed", False)
    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} Practice polish self-test passed.")


if __name__ == "__main__":
    main()
