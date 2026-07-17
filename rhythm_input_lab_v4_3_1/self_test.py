from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import fnf_importer
import rhythm_input_lab_core as core
import rhythm_input_lab_v4 as v4


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
        assert bundle["summary"]["player_notes"] == 4
        assert bundle["summary"]["event_count"] == 2
        fnf_importer.write_chart_bundle(bundle, root / "Self Test" / "chart", source)
        loaded = fnf_importer.load_chart_bundle(root / "Self Test")
        assert loaded and len(loaded["notes"]) == 4
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
        assert len((Path(__file__).parent / "web" / "app.js").read_text(encoding="utf-8")) > 1000
        assert (Path(__file__).parent / "web" / "assets" / "NOTE_assets.png").exists()
        assert (Path(__file__).parent / "web" / "assets" / "noteSplashes.png").exists()
        splash_xml = (Path(__file__).parent / "web" / "assets" / "noteSplashes.xml").read_text(encoding="utf-8")
        assert splash_xml.count("<SubTexture") == 32
        app_js = (Path(__file__).parent / "web" / "app.js").read_text(encoding="utf-8")
        assert "importReplayFiles" in app_js
        assert "downscrollToggle" in app_js
        assert "ghostTapping" in app_js

    print("Rhythm Input Lab 4.2 self-test passed.")
    print("Importer, replay input pairing, GUI files, both FNF atlases, and 4.2 visualizer controls are present.")


if __name__ == "__main__":
    main()
