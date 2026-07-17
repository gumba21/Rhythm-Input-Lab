from __future__ import annotations

import json
import tempfile
from pathlib import Path

import app as v4
import fnf_importer
import rhythm_input_lab_core as core
from ril_version import APP_VERSION


def synthetic_chart() -> dict:
    return {
        "song": {
            "song": "Self Test",
            "bpm": 120,
            "speed": 1.0,
            "events": [
                [1000, [["KB_AttackPrepare", "", ""], ["KB_AttackFire", "", ""]]],
            ],
            "notes": [
                {
                    "lengthInSteps": 16,
                    "mustHitSection": True,
                    "changeBPM": False,
                    "bpm": 120,
                    "sectionNotes": [
                        [500, 0, 0],
                        [750, 1, 0],
                        [1000, 2, 250],
                        [1250, 3, 0],
                        [1500, 0, 0, "Hurt Note"],
                    ],
                }
            ],
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

        web_root = Path(__file__).parent / "web"
        visualizer_js = (web_root / "visualizer.js").read_text(encoding="utf-8")
        polish_js = (web_root / "v45-polish.js").read_text(encoding="utf-8")
        app_js = (web_root / "app.js").read_text(encoding="utf-8")
        assert len(visualizer_js) > 1000
        assert len(polish_js) > 1000
        for asset in [
            "NOTE_assets.png",
            "noteSplashes.png",
            "HURTNOTE_assets.png",
            "HURTnoteSplashes.png",
        ]:
            assert (web_root / "assets" / asset).exists()
        splash_xml = (web_root / "assets" / "noteSplashes.xml").read_text(encoding="utf-8")
        assert splash_xml.count("<SubTexture") == 32
        assert "importReplayFiles" in visualizer_js
        assert "downscrollToggle" in visualizer_js
        assert "ghostTapping" in visualizer_js
        assert "hurtAtlas" in visualizer_js
        assert "matchHazards" in visualizer_js
        assert "stopVisualizerPlayback" in polish_js
        assert "preciseSeekInput" in polish_js
        assert "comboHud" in polish_js
        assert "live drift" in polish_js
        assert "/v45-polish.js" in app_js
        assert v4.APP_VERSION == APP_VERSION

    print(f"Rhythm Input Lab {APP_VERSION} self-test passed.")
    print("Importer, versioning, hurt hazards, visualizer controls, precise seeking, combo HUD, and audio polish are present.")


if __name__ == "__main__":
    main()
