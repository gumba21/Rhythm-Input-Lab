from __future__ import annotations

import json
import tempfile
from pathlib import Path

import fnf_batch_import
import fnf_importer


def main() -> None:
    chart = {
        "codenameChart": True,
        "scrollSpeed": 2.25,
        "stage": "test-stage",
        "events": [
            {"time": 0, "name": "BPM Change", "params": [150]},
            {"time": 1000, "name": "Camera Flash", "params": [True, 1]},
        ],
        "strumLines": [
            {
                "position": "dad",
                "vocalsSuffix": "-dad",
                "notes": [
                    {"id": 0, "time": 250, "sLen": 0, "type": 0},
                    {"id": 3, "time": 500, "sLen": 200, "type": "Hurt Note"},
                ],
            },
            {
                "position": "boyfriend",
                "vocalsSuffix": "-bf",
                "notes": [
                    {"id": 1, "time": 250, "sLen": 0, "type": 0},
                    {"id": 2, "time": 750, "sLen": 125, "type": 0},
                ],
            },
            {
                "position": "girlfriend",
                "vocalsSuffix": "-gf",
                "notes": [{"id": 0, "time": 900, "sLen": 0, "type": 0}],
            },
        ],
    }
    bundle = fnf_batch_import.normalize_codename_chart(chart, "hard.json")
    summary = bundle["summary"]
    assert summary["format"] == "fnf_codename"
    assert summary["key_count"] == 4
    assert summary["base_bpm"] == 150
    assert summary["player_notes"] == 2
    assert summary["opponent_notes"] == 3
    assert summary["event_count"] == 2
    assert summary["sustain_notes"] == 2
    assert bundle["notes"][0]["source_position"] in {"dad", "boyfriend"}
    assert any(note["vocals_suffix"] == "-bf" for note in bundle["notes"])
    assert bundle["events"][0]["params"] == [150]

    legacy_normalize = fnf_importer.normalize_fnf_chart
    fnf_batch_import.install_fnf_compat()
    assert fnf_importer.normalize_fnf_chart(chart, "hard.json")["summary"]["format"] == "fnf_codename"
    assert fnf_importer.normalize_fnf_chart is not legacy_normalize

    with tempfile.TemporaryDirectory(prefix="ril-fnf-stems-") as temp:
        song = Path(temp) / "Test Song"
        audio = song / "audio"
        audio.mkdir(parents=True)
        (audio / "vocals.ogg").write_bytes(b"primary")
        (audio / "vocal-voices-dad.ogg").write_bytes(b"dad")
        fnf_batch_import._save_media_row(song, "vocal", "voices", "Voices.ogg", "vocals.ogg", True)
        fnf_batch_import._save_media_row(song, "vocal", "voices-dad", "Voices-dad.ogg", "vocal-voices-dad.ogg", False)
        rows = fnf_batch_import._vocal_stems_meta(song)
        assert len(rows) == 2
        assert sum(bool(row["primary"]) for row in rows) == 1
        assert {row["stem_id"] for row in rows} == {"voices", "voices-dad"}

    print("FNF batch import self-test passed.")


if __name__ == "__main__":
    main()
