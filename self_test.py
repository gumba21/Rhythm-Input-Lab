from __future__ import annotations

import json
import tempfile
from pathlib import Path

import app as v4
import fnf_importer
import media_backend
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


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="ril4_selftest_") as temp:
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
        hurt_mapping = loaded["mappings"]["note_types"]["Hurt Note"]
        assert hurt_mapping["category"] == "hazard"
        assert hurt_mapping["should_press"] is False
        assert (root / "Self Test" / "chart" / "song_explorer.html").exists()

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
        assert saved_media["url"].startswith("/api/song-media/file?")
        assert media_backend._requested_range("", 100) == (0, 99, False)
        assert media_backend._requested_range("bytes=10-19", 100) == (10, 19, True)
        assert media_backend._requested_range("bytes=90-", 100) == (90, 99, True)
        assert media_backend._requested_range("bytes=-10", 100) == (90, 99, True)
        media_backend._clear_kind(media_song, "instrumental")
        assert not media_backend._media_meta(media_song)

        compact = ril_package_backend.bundle_to_compact_chart(bundle)
        expanded = ril_package_backend.compact_chart_to_bundle(compact)
        assert compact["v"] == 1
        assert expanded["summary"]["format"] == "ril_neutral"
        assert expanded["summary"]["player_notes"] == 5

        web_root = Path(__file__).parent / "web"
        visualizer_js = (web_root / "visualizer.js").read_text(encoding="utf-8")
        bridge_js = (web_root / "global-bridge.js").read_text(encoding="utf-8")
        shared_results_js = (web_root / "shared-results.js").read_text(encoding="utf-8")
        visualizer_preferences_js = (web_root / "visualizer-preferences.js").read_text(encoding="utf-8")
        polish_js = (web_root / "v45-polish.js").read_text(encoding="utf-8")
        reports_js = (web_root / "reports.js").read_text(encoding="utf-8")
        practice_js = (web_root / "practice.js").read_text(encoding="utf-8")
        practice_hotfix_js = (web_root / "practice-hotfix.js").read_text(encoding="utf-8")
        practice_tools_js = (web_root / "practice-tools.js").read_text(encoding="utf-8")
        practice_comfort_js = (web_root / "practice-comfort.js").read_text(encoding="utf-8")
        practice_library_js = (web_root / "practice-library-menu.js").read_text(encoding="utf-8")
        practice_save_js = (web_root / "practice-save.js").read_text(encoding="utf-8")
        song_media_js = (web_root / "song-media.js").read_text(encoding="utf-8")
        song_picker_js = (web_root / "song-picker.js").read_text(encoding="utf-8")
        analysis_js = (web_root / "analysis.js").read_text(encoding="utf-8")
        analysis_unified_js = (web_root / "analysis-unified.js").read_text(encoding="utf-8")
        ril_packages_js = (web_root / "ril-packages.js").read_text(encoding="utf-8")
        app_js = (web_root / "app.js").read_text(encoding="utf-8")
        media_backend_source = Path(media_backend.__file__).read_text(encoding="utf-8")
        practice_backend_source = Path(practice_attempt_backend.__file__).read_text(encoding="utf-8")
        package_backend_source = Path(ril_package_backend.__file__).read_text(encoding="utf-8")

        assert len(visualizer_js) > 1000
        assert len(bridge_js) > 300
        assert len(shared_results_js) > 5000
        assert len(visualizer_preferences_js) > 5000
        assert len(polish_js) > 1000
        assert len(reports_js) > 1000
        assert len(practice_js) > 10000
        assert len(practice_hotfix_js) > 10000
        assert len(practice_tools_js) > 10000
        assert len(practice_comfort_js) > 20000
        assert len(practice_library_js) > 4000
        assert len(practice_save_js) > 3000
        assert len(song_media_js) > 10000
        assert len(song_picker_js) > 10000
        assert len(analysis_js) > 30000
        assert len(analysis_unified_js) > 15000
        assert len(ril_packages_js) > 20000

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

        splash_png = (web_root / "assets" / "noteSplashes.png").read_bytes()
        assert splash_png.startswith(b"\x89PNG\r\n\x1a\n")
        assert int.from_bytes(splash_png[16:20], "big") == 2048
        assert int.from_bytes(splash_png[20:24], "big") == 2048
        splash_xml = (web_root / "assets" / "noteSplashes.xml").read_text(encoding="utf-8")
        note_xml = (web_root / "assets" / "NOTE_assets.xml").read_text(encoding="utf-8-sig")
        assert splash_xml.count("<SubTexture") == 32
        assert note_xml.count("<SubTexture") >= 40
        for required_frame in ["A0000", "E0000", "I0000", "arrowSPACE0000", "A hold0000", "I tail0000", "I press0002"]:
            assert f'name="{required_frame}"' in note_xml

        assert "importReplayFiles" in visualizer_js
        assert "hurtAtlas" in visualizer_js
        assert "matchHazards" in visualizer_js
        assert "window.state = state" in bridge_js
        assert "window.matchChart = matchChart" in bridge_js
        assert "window.comparisonStats = comparisonStats" in bridge_js
        assert "window.candidateOffsets = candidateOffsets" in bridge_js
        assert "exactStats" in shared_results_js
        assert "window.comparisonStats()" in shared_results_js
        assert "setCoverage" in shared_results_js
        assert "attempt?.session?.full_song === true" in shared_results_js
        assert "ril-visualizer-preferences:v1" in visualizer_preferences_js
        assert "forceFullSongCoverage" in visualizer_preferences_js
        assert "offsets" in visualizer_preferences_js
        assert "stopVisualizerPlayback" in polish_js
        assert "preciseSeekInput" in polish_js
        assert "comboHud" in polish_js
        assert "live drift" in polish_js
        assert "view-reports" in reports_js
        assert "/api/report" in reports_js
        assert "view-practice" in practice_js
        assert "practiceCanvas" in practice_js
        assert "startPractice" in practice_js
        assert "judgeLanePress" in practice_js
        assert "finishPracticeAttempt" in practice_js
        assert "reviewPracticeAttempt" in practice_js
        assert "practiceLoopToggle" in practice_js
        assert "practiceInstrumentalFile" in practice_js
        assert "window.rilPracticeEngine" in practice_js
        assert "accuracyTimeline" in practice_js
        assert "recordAccuracyPoint" in practice_js
        assert "MULTI_LANE_LAYOUTS" in practice_hotfix_js
        assert '4: ["A", "B", "C", "D"]' in practice_hotfix_js
        assert '9: ["A", "B", "C", "D", "E", "F", "G", "H", "I"]' in practice_hotfix_js
        assert "restoreNoteSplashes" in practice_hotfix_js
        assert "practicePrecisionSelector" in practice_tools_js
        assert "practiceAccuracyCanvas" in practice_tools_js

        assert "ril-practice-comfort:v1" in practice_comfort_js
        assert "Global Practice defaults" in practice_comfort_js
        assert "Use current everywhere" in practice_comfort_js
        assert "Saved Practice setups" in practice_comfort_js
        assert "Song goal" in practice_comfort_js
        assert "Collections" in practice_comfort_js
        assert "Attempt history and statistics" in practice_comfort_js
        assert "MAX_ATTEMPTS = 250" in practice_comfort_js
        assert "practiceLibraryModal" in practice_library_js
        assert "Setups & collections" in practice_library_js
        assert "/api/practice-attempt/save" in practice_save_js
        assert "completedValidity" in practice_save_js
        assert "savedFolder" in practice_save_js
        assert "/api/practice-attempt/save" in practice_backend_source
        assert '"full_song": True' in practice_backend_source

        assert "/api/song-media/chunk" in song_media_js
        assert "loadSavedAudio" in song_media_js
        assert "saved-audio-badge" in song_media_js
        assert "Accept-Ranges" in media_backend_source
        assert "Content-Range" in media_backend_source
        assert "app_class.list_songs = list_songs" in media_backend_source
        assert "songPickerModal" in song_picker_js
        assert "Name A–Z" in song_picker_js
        assert "Most attempts" in song_picker_js
        assert "numeric: true" in song_picker_js
        assert "ril-song-picker:v1" in song_picker_js
        assert "No saved audio" in song_picker_js

        assert "view-analysis" in analysis_js
        assert "Analysis hand assignment" in analysis_js
        assert "detectPatterns" in analysis_js
        for pattern_name in ["jack", "trill", "roll", "stair", "stream", "burst", "chordstream", "holdstream", "panning", "flam", "bracket", "ringtrill"]:
            assert pattern_name in analysis_js
        assert "Exact Visualizer result" in analysis_unified_js
        assert "rilSharedResults.compute" in analysis_unified_js
        assert "Calculating one shared result" in analysis_unified_js

        assert "Import a .ril package" in ril_packages_js
        assert "/api/ril/import/chunk" in ril_packages_js
        assert "/api/ril/export" in ril_packages_js
        assert "Recently imported" in ril_packages_js
        assert "Imported from" in ril_packages_js
        assert "bundle_to_compact_chart" in package_backend_source
        assert "compact_chart_to_bundle" in package_backend_source
        assert "SHA-256" not in package_backend_source or "sha256" in package_backend_source
        assert "../" not in package_backend_source or "unsafe path" in package_backend_source

        for script in [
            "/global-bridge.js", "/shared-results.js", "/visualizer-preferences.js",
            "/practice-comfort.js", "/practice-library-menu.js", "/practice-save.js",
            "/song-media.js", "/analysis.js", "/analysis-structure-bridge.js",
            "/analysis-unified.js", "/song-picker.js", "/ril-packages.js",
        ]:
            assert script in app_js
        assert "/analysis-coverage.js" not in app_js
        assert getattr(v4._backend.Handler, "_ril_note_atlas_endpoint_installed", False)
        assert getattr(v4._backend.Handler, "_ril_song_media_installed", False)
        assert getattr(v4._backend.Handler, "_ril_practice_attempt_installed", False)
        assert getattr(v4._backend.Handler, "_ril_package_installed", False)
        assert v4.APP_VERSION == APP_VERSION
        assert APP_VERSION == "4.8.0-dev"

    print(f"Rhythm Input Lab {APP_VERSION} self-test passed.")
    print("Shared results, full-song Practice saves, and portable playable RIL packages are present.")


if __name__ == "__main__":
    main()
