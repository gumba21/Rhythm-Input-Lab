from __future__ import annotations

import json
import tempfile
from pathlib import Path

import app as v4
import fnf_importer
import media_backend
import osu_import_backend
import osu_importer
import practice_attempt_backend
import rhythm_input_lab_core as core
import ril_package_backend
from asset_backend import load_packaged_note_atlas
from ril_version import APP_VERSION


def synthetic_chart() -> dict:
    return {
        "song": {
            "song": "Self Test",
            "bpm": 120,
            "speed": 1.0,
            "events": [[1000, [["KB_AttackPrepare", "", ""], ["KB_AttackFire", "", ""]]]],
            "notes": [{
                "lengthInSteps": 16,
                "mustHitSection": True,
                "changeBPM": False,
                "bpm": 120,
                "sectionNotes": [
                    [500, 0, 0], [750, 1, 0], [1000, 2, 250], [1250, 3, 0],
                    [1500, 0, 0, "Hurt Note"],
                ],
            }],
        }
    }


def synthetic_osu() -> str:
    return """osu file format v14

[General]
AudioFilename: test.ogg
Mode: 3

[Metadata]
Title:Self Test Mania
Artist:RIL
Creator:gumba21
Version:Hard

[Difficulty]
CircleSize:4
OverallDifficulty:8
HPDrainRate:8

[TimingPoints]
0,500,4,2,1,100,1,0
1000,-50,4,2,1,100,0,0

[HitObjects]
64,192,500,1,0,0:0:0:0:
192,192,750,1,0,0:0:0:0:
320,192,1000,128,0,1250:0:0:0:0:
448,192,1500,1,0,0:0:0:0:
"""


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ril_selftest_") as temp:
        root = Path(temp)
        source = root / "self-test.json"
        source.write_text(json.dumps(synthetic_chart()), encoding="utf-8")
        bundle = fnf_importer.normalize_fnf_chart(synthetic_chart(), source.name)
        assert bundle["summary"]["player_notes"] == 5
        assert bundle["summary"]["event_count"] == 2
        fnf_importer.write_chart_bundle(bundle, root / "Self Test" / "chart", source)
        loaded = fnf_importer.load_chart_bundle(root / "Self Test")
        assert loaded and len(loaded["notes"]) == 5
        hurt_notes = [note for note in loaded["notes"] if str(note.get("note_type", "")).casefold() == "hurt note"]
        assert len(hurt_notes) == 1
        assert loaded["mappings"]["note_types"]["Hurt Note"]["should_press"] is False
        assert (root / "Self Test" / "chart" / "song_explorer.html").exists()

        compact = ril_package_backend.bundle_to_compact_chart(bundle)
        expanded = ril_package_backend.compact_chart_to_bundle(compact)
        assert compact["v"] == 1
        assert expanded["summary"]["format"] == "ril_neutral"
        assert expanded["summary"]["player_notes"] == 5

        mania = osu_importer.parse_osu_text(synthetic_osu(), "self-test.osu")
        assert mania["summary"]["format"] == "osu_mania"
        assert mania["summary"]["key_count"] == 4
        assert mania["summary"]["player_notes"] == 4
        assert mania["summary"]["sustain_notes"] == 1
        assert [note["lane"] for note in mania["notes"]] == [0, 1, 2, 3]
        assert any(event["name"] == "osu! SV change" for event in mania["events"])

        events = [
            core.Event(0, "a", "lane", "down"), core.Event(60, "a", "lane", "up", 60),
            core.Event(250, "s", "lane", "down"), core.Event(310, "s", "lane", "up", 60),
            core.Event(500, "k", "lane", "down"), core.Event(800, "k", "lane", "up", 300),
            core.Event(750, "l", "lane", "down"), core.Event(810, "l", "lane", "up", 60),
            core.Event(500, "space", "dodge", "down"), core.Event(550, "space", "dodge", "up", 50),
        ]
        rows = v4.press_rows(events, ["a", "s", "k", "l"])
        assert len(rows) == 5
        assert sum(row["role"] == "dodge" for row in rows) == 1
        practice_events = practice_attempt_backend._events_from_presses(
            [{"time_ms": 500, "lane": 0, "key": "a", "held_ms": 75}],
            ["a", "s", "k", "l"],
        )
        assert [(event.event, event.time_ms) for event in practice_events] == [("down", 500.0), ("up", 575.0)]

        media_song = root / "Media Song"
        (media_song / "audio").mkdir(parents=True)
        (media_song / "song.json").write_text(json.dumps({"song_name": "Media Song"}), encoding="utf-8")
        fake_audio = media_song / "audio" / "instrumental.ogg"
        fake_audio.write_bytes(b"OggS" + b"\0" * 64)
        saved_media = media_backend._save_meta(media_song, "instrumental", "Inst.ogg", fake_audio.name, fake_audio.stat().st_size)
        assert saved_media["filename"] == "Inst.ogg"
        assert media_backend._requested_range("bytes=10-19", 100) == (10, 19, True)
        media_backend._clear_kind(media_song, "instrumental")
        assert not media_backend._media_meta(media_song)

        web_root = Path(__file__).parent / "web"
        scripts = {
            name: (web_root / name).read_text(encoding="utf-8")
            for name in [
                "app.js", "visualizer.js", "global-bridge.js", "shared-results.js",
                "visualizer-preferences.js", "practice.js", "practice-hotfix.js",
                "practice-tools.js", "practice-comfort.js", "practice-library-menu.js",
                "practice-save.js", "song-media.js", "analysis.js",
                "analysis-structure-bridge.js", "analysis-unified.js", "song-picker.js",
                "ril-packages.js", "osu-import.js",
            ]
        }
        minimums = {
            "visualizer.js": 1000, "shared-results.js": 5000,
            "visualizer-preferences.js": 5000, "practice.js": 10000,
            "practice-hotfix.js": 10000, "practice-tools.js": 10000,
            "practice-comfort.js": 20000, "practice-library-menu.js": 4000,
            "practice-save.js": 3000, "song-media.js": 10000,
            "analysis.js": 30000, "analysis-unified.js": 15000,
            "song-picker.js": 10000, "ril-packages.js": 20000,
            "osu-import.js": 15000,
        }
        for name, minimum in minimums.items():
            assert len(scripts[name]) > minimum, name

        for asset in ["NOTE_assets.xml", "noteSplashes.png", "HURTNOTE_assets.png", "HURTnoteSplashes.png"]:
            assert (web_root / "assets" / asset).exists()
        atlas_parts = sorted((web_root / "assets" / "NOTE_assets64.b64").glob("part*.b64"))
        assert [part.name for part in atlas_parts] == [
            "part00.b64", "part01a.b64", "part01b.b64", "part02.b64",
            "part03a.b64", "part03b.b64", "part04.b64",
        ]
        atlas_png = load_packaged_note_atlas(web_root)
        assert atlas_png.startswith(b"\x89PNG\r\n\x1a\n")
        assert len(atlas_png) > 30_000

        assert "window.matchChart = matchChart" in scripts["global-bridge.js"]
        assert "exactStats" in scripts["shared-results.js"]
        assert "ril-visualizer-preferences:v1" in scripts["visualizer-preferences.js"]
        assert "window.rilPracticeEngine" in scripts["practice.js"]
        assert "practicePrecisionSelector" in scripts["practice-tools.js"]
        assert "ril-practice-comfort:v1" in scripts["practice-comfort.js"]
        assert "/api/practice-attempt/save" in scripts["practice-save.js"]
        assert "/api/song-media/chunk" in scripts["song-media.js"]
        assert "detectPatterns" in scripts["analysis.js"]
        assert "rilSharedResults.compute" in scripts["analysis-unified.js"]
        assert "songPickerModal" in scripts["song-picker.js"]
        assert "/api/ril/export" in scripts["ril-packages.js"]
        assert "/api/osu/import/chunk" in scripts["osu-import.js"]
        assert "Import osu!mania" in scripts["osu-import.js"]
        for script in [
            "/global-bridge.js", "/shared-results.js", "/visualizer-preferences.js",
            "/practice-comfort.js", "/practice-library-menu.js", "/practice-save.js",
            "/song-media.js", "/analysis.js", "/analysis-structure-bridge.js",
            "/analysis-unified.js", "/song-picker.js", "/ril-packages.js", "/osu-import.js",
        ]:
            assert script in scripts["app.js"]

        assert getattr(v4._backend.Handler, "_ril_note_atlas_endpoint_installed", False)
        assert getattr(v4._backend.Handler, "_ril_song_media_installed", False)
        assert getattr(v4._backend.Handler, "_ril_practice_attempt_installed", False)
        assert getattr(v4._backend.Handler, "_ril_package_installed", False)
        assert getattr(v4._backend.Handler, "_ril_osu_import_installed", False)
        assert v4.APP_VERSION == APP_VERSION
        assert APP_VERSION == "4.9.0-dev"

    print(f"Rhythm Input Lab {APP_VERSION} self-test passed.")
    print("Shared results, portable RIL packages, and osu!mania importing are present.")


if __name__ == "__main__":
    main()
