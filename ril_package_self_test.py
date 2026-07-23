from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path

import app
import ril_package_backend as packages
from ril_version import APP_VERSION


def synthetic_bundle() -> dict:
    return {
        "summary": {
            "format": "fnf_legacy_psych",
            "source_format": "fnf_legacy_psych",
            "source_name": "friend-song.json",
            "song_name": "Friend Song",
            "song_id": "friend-song",
            "key_count": 4,
            "base_bpm": 180.0,
            "duration_ms": 4_000.0,
            "player_notes": 4,
            "opponent_notes": 1,
            "event_count": 1,
        },
        "notes": [
            {"time_ms": 500.0, "end_ms": 500.0, "lane": 0, "raw_lane": 0, "sustain_ms": 0.0, "owner": "player", "section_index": 0, "must_hit_section": True, "bpm": 180.0, "note_type": "", "extra_data": []},
            {"time_ms": 750.0, "end_ms": 750.0, "lane": 1, "raw_lane": 1, "sustain_ms": 0.0, "owner": "player", "section_index": 0, "must_hit_section": True, "bpm": 180.0, "note_type": "", "extra_data": []},
            {"time_ms": 1_000.0, "end_ms": 1_350.0, "lane": 2, "raw_lane": 2, "sustain_ms": 350.0, "owner": "player", "section_index": 0, "must_hit_section": True, "bpm": 180.0, "note_type": "", "extra_data": []},
            {"time_ms": 1_500.0, "end_ms": 1_500.0, "lane": 3, "raw_lane": 3, "sustain_ms": 0.0, "owner": "player", "section_index": 0, "must_hit_section": True, "bpm": 180.0, "note_type": "Hurt Note", "extra_data": ["preserved"]},
            {"time_ms": 2_000.0, "end_ms": 2_000.0, "lane": 0, "raw_lane": 4, "sustain_ms": 0.0, "owner": "opponent", "section_index": 0, "must_hit_section": True, "bpm": 180.0, "note_type": "", "extra_data": []},
        ],
        "events": [
            {"time_ms": 2_500.0, "name": "Camera Zoom", "value1": "1.1", "value2": "", "source": "song.events", "group_index": 0, "event_index": 0, "raw": ["Camera Zoom", "1.1", ""]},
        ],
        "sections": [
            {"section_index": 0, "bpm": 180.0, "change_bpm": False, "must_hit_section": True, "length_in_steps": 16},
        ],
        "mappings": {
            "note_types": {
                "": {"category": "normal", "gameplay": True, "should_press": True},
                "Hurt Note": {"category": "hazard", "gameplay": True, "should_press": False},
            },
            "event_types": {
                "Camera Zoom": {"category": "visual", "gameplay": True, "expected_presses": 0},
            },
            "notes": ["self-test mappings"],
        },
        "song_metadata": {"speed": 2.5, "stage": "test-stage"},
    }


def main() -> None:
    bundle = synthetic_bundle()
    compact = packages.bundle_to_compact_chart(bundle)
    assert compact["v"] == packages.RIL_CHART_VERSION
    assert len(compact["n"]) == 5
    assert len(compact["e"]) == 1
    assert compact["dict"]["note_types"] == ["", "Hurt Note"]

    restored = packages.compact_chart_to_bundle(compact)
    assert restored["summary"]["format"] == "ril_neutral"
    assert restored["summary"]["source_format"] == "fnf_legacy_psych"
    assert restored["summary"]["player_notes"] == 4
    assert restored["notes"][2]["sustain_ms"] == 350.0
    assert restored["notes"][3]["note_type"] == "Hurt Note"
    assert restored["notes"][3]["extra_data"] == ["preserved"]
    assert restored["events"][0]["name"] == "Camera Zoom"

    with tempfile.TemporaryDirectory(prefix="ril_package_selftest_") as temp:
        root = Path(temp)
        song_folder = root / "Friend Song"
        audio = song_folder / "audio"
        audio.mkdir(parents=True)
        instrumental = audio / "instrumental.ogg"
        vocals = audio / "vocals.mp3"
        instrumental.write_bytes(b"OggS" + b"instrumental" * 64)
        vocals.write_bytes(b"ID3" + b"vocals" * 64)
        (song_folder / "song.json").write_text(json.dumps({
            "song_name": "Friend Song",
            "song_id": "friend-song",
            "original_charter": "OriginalCharter",
            "media": {
                "instrumental": {"filename": "Inst.ogg", "stored_name": instrumental.name},
                "vocals": {"filename": "Voices.mp3", "stored_name": vocals.name},
            },
        }), encoding="utf-8")

        package_path = root / "Friend Song.ril"
        manifest = packages.create_ril_package(
            song_folder,
            bundle,
            package_path,
            username="gumba21",
            include_instrumental=True,
            include_vocals=True,
            app_version=APP_VERSION,
        )
        assert package_path.is_file()
        assert manifest["exported_by"]["username"] == "gumba21"
        assert manifest["song"]["original_charter"] == "OriginalCharter"
        assert manifest["app"]["version"] == APP_VERSION

        inspected = packages.inspect_ril_package(package_path)
        preview = inspected["preview"]
        assert preview["title"] == "Friend Song"
        assert preview["exported_by"] == "gumba21"
        assert preview["instrumental"] is True
        assert preview["vocals"] is True
        assert preview["compatible"] is True
        assert preview["notes"] == 4

        with zipfile.ZipFile(package_path, "r") as archive:
            assert set(archive.namelist()) == {"manifest.json", "chart.json", "audio/instrumental.ogg", "audio/vocals.mp3"}
            packed_manifest = json.loads(archive.read("manifest.json"))
            assert all(len(row["sha256"]) == 64 for row in packed_manifest["files"])
            assert json.loads(archive.read("chart.json"))["v"] == 1

        unsafe = root / "unsafe.ril"
        with zipfile.ZipFile(unsafe, "w") as archive:
            archive.writestr("manifest.json", "{}")
            archive.writestr("chart.json", "{}")
            archive.writestr("../escape.txt", "nope")
        try:
            packages.inspect_ril_package(unsafe)
        except ValueError as exc:
            assert "unsafe path" in str(exc)
        else:
            raise AssertionError("Unsafe archive path was accepted")

    assert getattr(app._backend.Handler, "_ril_package_installed", False)
    assert "profile" in app._core.DEFAULTS
    assert APP_VERSION == "4.9.1-dev"
    print(f"Rhythm Input Lab {APP_VERSION} RIL package self-test passed.")


if __name__ == "__main__":
    main()
