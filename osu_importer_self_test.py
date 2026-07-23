from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

import app
import osu_importer
from ril_version import APP_VERSION


def chart(version: str = "Insane", keys: int = 4, mode: int = 3) -> str:
    return f"""osu file format v14

[General]
AudioFilename: song.ogg
AudioLeadIn: 0
PreviewTime: 1000
Mode: {mode}

[Metadata]
Title:Gold Mine
TitleUnicode:Gold Mine
Artist:Test Artist
ArtistUnicode:Test Artist
Creator:gumba21
Version:{version}
BeatmapID:123
BeatmapSetID:456

[Difficulty]
HPDrainRate:8
CircleSize:{keys}
OverallDifficulty:8
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[Events]
2,2000,2500

[TimingPoints]
0,500,4,2,1,100,1,0
1000,-50,4,2,1,100,0,0
2000,400,4,2,1,100,1,0

[HitObjects]
64,192,500,1,0,0:0:0:0:
192,192,1000,1,0,0:0:0:0:
320,192,1500,128,0,2000:0:0:0:0:
448,192,2500,1,0,0:0:0:0:
"""


def main() -> None:
    bundle = osu_importer.parse_osu_text(chart(), "Gold Mine [Insane].osu")
    summary = bundle["summary"]
    assert summary["format"] == "osu_mania"
    assert summary["source_format"] == "osu_mania"
    assert summary["song_name"] == "Test Artist - Gold Mine [Insane]"
    assert summary["key_count"] == 4
    assert summary["player_notes"] == 4
    assert summary["sustain_notes"] == 1
    assert summary["base_bpm"] == 120.0
    assert summary["max_bpm"] == 150.0
    assert summary["dynamic_bpm"] is True
    assert [note["lane"] for note in bundle["notes"]] == [0, 1, 2, 3]
    assert bundle["notes"][2]["sustain_ms"] == 500.0
    assert bundle["notes"][2]["end_ms"] == 2000.0
    assert bundle["events"][0]["name"] == "osu! SV change"
    assert {event["name"] for event in bundle["events"]} == {"osu! BPM change", "osu! SV change", "osu! Break"}
    assert bundle["mappings"]["note_types"][""]["should_press"] is True
    assert len(bundle["song_metadata"]["timing_points"]) == 3

    try:
        osu_importer.parse_osu_text(chart(mode=0), "standard.osu")
    except osu_importer.OsuImportError as exc:
        assert "not osu!mania" in str(exc)
    else:
        raise AssertionError("Non-mania chart was accepted")

    try:
        osu_importer.parse_osu_text(chart(keys=10), "10k.osu")
    except osu_importer.OsuImportError as exc:
        assert "4K through 9K" in str(exc)
    else:
        raise AssertionError("Unsupported key mode was accepted")

    with tempfile.TemporaryDirectory(prefix="ril_osu_selftest_") as temp:
        root = Path(temp)
        standalone = root / "Gold Mine.osu"
        standalone.write_text(chart(), encoding="utf-8")
        standalone_preview = osu_importer.inspect_source(standalone)
        assert standalone_preview["kind"] == "osu"
        assert standalone_preview["difficulties"][0]["has_audio"] is False

        package = root / "Gold Mine.osz"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("maps/Gold Mine [Hard].osu", chart("Hard"))
            archive.writestr("maps/Gold Mine [Insane].osu", chart("Insane"))
            archive.writestr("maps/not-mania.osu", chart("Standard", mode=0))
            archive.writestr("maps/song.ogg", b"OggS" + b"audio" * 100)
            archive.writestr("other/song.ogg", b"OggS" + b"wrong" * 100)
        preview = osu_importer.inspect_source(package)
        assert preview["kind"] == "osz"
        assert len(preview["difficulties"]) == 2
        assert len(preview["unsupported"]) == 1
        assert all(row["has_audio"] for row in preview["difficulties"])
        assert all(row["audio_entry"] == "maps/song.ogg" for row in preview["difficulties"])
        assert {row["version"] for row in preview["difficulties"]} == {"Hard", "Insane"}
        assert all(len(row["id"]) == 20 for row in preview["difficulties"])

        unsafe = root / "unsafe.osz"
        with zipfile.ZipFile(unsafe, "w") as archive:
            archive.writestr("../escape.osu", chart())
        try:
            osu_importer.inspect_source(unsafe)
        except osu_importer.OsuImportError as exc:
            assert "unsafe path" in str(exc)
        else:
            raise AssertionError("Unsafe .osz path was accepted")

    assert getattr(app._backend.Handler, "_ril_osu_import_installed", False)
    assert APP_VERSION == "4.9.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} osu!mania importer self-test passed.")


if __name__ == "__main__":
    main()
