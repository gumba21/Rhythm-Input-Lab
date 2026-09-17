from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path

import app
import quaver_importer
from ril_version import APP_VERSION


def chart(difficulty: str = "Hard", mode: str = "Keys4", *, audio: str = "song.ogg") -> str:
    return f"""---
QuaVersion: 1
AudioFile: {audio}
SongPreviewTime: 1200
BackgroundFile: background.jpg
BannerFile: banner.png
MapId: 123
MapSetId: 456
Mode: {mode}
Title: Quaver Gold Mine
Artist: RIL Test
Source: Self Test Album
Tags: rhythm input lab
Creator: gumba21
DifficultyName: {difficulty}
Description: Synthetic Quaver adapter fixture
Genre: Electronic
BPMDoesNotAffectScrollVelocity: true
InitialScrollVelocity: 1.25
TimingPoints:
  - StartTime: 0
    Bpm: 120
    Signature: 4
  - StartTime: 1000
    Bpm: 180
    Signature: 3
    Hidden: true
SliderVelocities:
  - StartTime: 500
    Multiplier: 2
ScrollSpeedFactors:
  - StartTime: 750
    Multiplier: 0.5
TimingGroups:
  Alt: !ScrollGroup
    InitialScrollVelocity: 0.75
    ScrollVelocities:
      - StartTime: 600
        Multiplier: 1.5
    ScrollSpeedFactors:
      - StartTime: 900
        Multiplier: 1.2
Bookmarks:
  - StartTime: 1000
    Note: Test bookmark
    ColorRgb: 255,255,0
CustomAudioSamples:
  - Path: hit.wav
SoundEffects:
  - StartTime: 1250
    Sample: 1
    Volume: 80
HitObjects:
  - StartTime: 250
    Lane: 1
    EndTime: 0
    HitSound: 3
  - StartTime: 500
    Lane: 2
    EndTime: 900
    TimingGroup: Alt
    KeySounds:
      - Sample: 1
        Volume: 75
  - StartTime: 1000
    Lane: 3
    EndTime: 0
    Type: Mine
  - StartTime: 1500
    Lane: 4
    EndTime: 0
"""


def main() -> None:
    bundle = quaver_importer.parse_qua_text(chart(), "Gold Mine [Hard].qua")
    summary = bundle["summary"]
    assert summary["format"] == "quaver_qua"
    assert summary["source_format"] == "quaver_qua"
    assert summary["song_name"] == "RIL Test - Quaver Gold Mine [Hard]"
    assert summary["key_count"] == 4
    assert summary["player_notes"] == 4
    assert summary["sustain_notes"] == 1
    assert summary["mine_notes"] == 1
    assert summary["base_bpm"] == 120
    assert summary["max_bpm"] == 180
    assert summary["active_actions_per_second"] > 0
    assert [note["lane"] for note in bundle["notes"]] == [0, 1, 2, 3]
    assert bundle["notes"][1]["sustain_ms"] == 400
    assert bundle["notes"][2]["note_type"] == "Quaver Mine"
    assert bundle["mappings"]["note_types"]["Quaver Mine"]["should_press"] is False
    assert bundle["sections"][1]["time_ms"] == 1000
    assert bundle["sections"][1]["signature"] == 3
    assert bundle["sections"][1]["hidden"] is True

    event_names = {event["name"] for event in bundle["events"]}
    assert event_names == {
        "Quaver BPM change",
        "Quaver SV change",
        "Quaver scroll speed factor",
        "Quaver sound effect",
        "Quaver bookmark",
    }
    quaver_meta = bundle["song_metadata"]["quaver"]
    assert quaver_meta["bpm_does_not_affect_scroll_velocity"] is True
    assert quaver_meta["initial_scroll_velocity"] == 1.25
    assert "Alt" in quaver_meta["timing_groups"]
    assert quaver_meta["timing_group_counts"]["Alt"] == 1

    try:
        quaver_importer.parse_qua_text("Mode: Keys4\nvalue: &same 1\ncopy: *same\n", "alias.qua")
    except quaver_importer.QuaverImportError as exc:
        assert "aliases" in str(exc).casefold()
    else:
        raise AssertionError("YAML aliases were accepted")

    try:
        quaver_importer.parse_qua_text(chart(mode="Keys10"), "10k.qua")
    except quaver_importer.QuaverImportError as exc:
        assert "4K through 9K" in str(exc)
    else:
        raise AssertionError("Unsupported Quaver key mode was accepted")

    with tempfile.TemporaryDirectory(prefix="ril_quaver_selftest_") as temp:
        root = Path(temp)
        standalone = root / "Gold Mine.qua"
        standalone.write_text(chart(), encoding="utf-8")
        standalone_preview = quaver_importer.inspect_source(standalone)
        assert standalone_preview["kind"] == "qua"
        assert standalone_preview["difficulties"][0]["has_audio"] is False

        package = root / "Gold Mine.qp"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("maps/Gold Mine [Hard].qua", chart("Hard"))
            archive.writestr("maps/Gold Mine [Insane].qua", chart("Insane"))
            archive.writestr("maps/song.ogg", b"OggS" + b"audio" * 100)
        preview = quaver_importer.inspect_source(package)
        assert preview["kind"] == "qp"
        assert len(preview["difficulties"]) == 2
        assert all(row["has_audio"] for row in preview["difficulties"])
        assert all(row["audio_entry"] == "maps/song.ogg" for row in preview["difficulties"])
        assert {row["difficulty"] for row in preview["difficulties"]} == {"Hard", "Insane"}
        assert all(len(row["id"]) == 20 for row in preview["difficulties"])

        unsafe = root / "unsafe.qp"
        with zipfile.ZipFile(unsafe, "w") as archive:
            archive.writestr("../escape.qua", chart())
        try:
            quaver_importer.inspect_source(unsafe)
        except quaver_importer.QuaverImportError as exc:
            assert "unsafe path" in str(exc)
        else:
            raise AssertionError("Unsafe .qp path was accepted")

    assert getattr(app._backend.Handler, "_ril_quaver_import_installed", False)
    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} Quaver importer self-test passed.")


if __name__ == "__main__":
    main()
