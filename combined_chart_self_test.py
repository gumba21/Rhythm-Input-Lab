from __future__ import annotations

import copy
import json
import tempfile
from pathlib import Path

import backend
import combined_chart
import combined_chart_backend
import neutral_chart_polish
import ril_package_backend as packages
from ril_version import APP_VERSION


ROOT = Path(__file__).parent
FIXTURE = ROOT / "fixtures" / "combined_chart_alternating.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def playable(bundle: dict) -> list[dict]:
    return [
        note for note in bundle.get("notes", [])
        if note.get("lane") is not None and note.get("owner") in {"player", "opponent"}
    ]


def player_source(bundle: dict) -> list[dict]:
    return [note for note in playable(bundle) if note.get("owner") == "player"]


def decision_at(result: dict, time_ms: float) -> dict:
    return next(
        row for row in result["decisions"]
        if abs(float(row["time_ms"]) - float(time_ms)) < 0.001
    )


def note(time_ms: float, lane: int, owner: str, sustain: float = 0.0) -> dict:
    raw_lane = lane + 4 if owner == "player" else lane
    return {
        "time_ms": time_ms,
        "end_ms": time_ms + sustain,
        "lane": lane,
        "raw_lane": raw_lane,
        "sustain_ms": sustain,
        "owner": owner,
        "section_index": 0,
        "must_hit_section": owner == "player",
        "bpm": 120,
        "note_type": "",
        "extra_data": [],
    }


def bundle(notes: list[dict], *, source_format: str = "fnf_legacy_psych") -> dict:
    return {
        "summary": {
            "format": source_format,
            "source_format": source_format,
            "song_name": "Synthetic",
            "song_id": "synthetic",
            "key_count": 4,
            "base_bpm": 120,
            "duration_ms": max([0.0] + [float(row["end_ms"]) for row in notes]) + 250,
        },
        "notes": notes,
        "events": [
            {
                "time_ms": 900,
                "name": "Keep Me",
                "value1": "a",
                "value2": "b",
                "source": "song.events",
                "raw": ["Keep Me", "a", "b"],
            }
        ],
        "sections": [
            {
                "section_index": 0,
                "time_ms": 0,
                "bpm": 120,
                "change_bpm": False,
                "must_hit_section": True,
                "length_in_steps": 16,
            }
        ],
        "mappings": {
            "note_types": {"": {"category": "normal", "gameplay": True, "should_press": True}},
            "event_types": {"Keep Me": {"category": "visual", "gameplay": True, "expected_presses": 0}},
        },
        "song_metadata": {"fixture": True},
    }


def provenance(note_row: dict) -> dict:
    rows = note_row.get("extra_data") or []
    for row in reversed(rows):
        if isinstance(row, dict) and isinstance(row.get("ril_derived"), dict):
            return row["ril_derived"]
    raise AssertionError("Derived note provenance missing")


class FakeApp:
    def __init__(self, root: Path, source_bundle: dict) -> None:
        self.output_root = root
        self.source_bundle = copy.deepcopy(source_bundle)

    def song_folder(self, name: str) -> Path:
        path = self.output_root / name
        if not path.is_dir():
            raise FileNotFoundError("Song folder not found")
        return path

    def song_bundle(self, folder_name: str) -> dict:
        if folder_name == "Source Song":
            return {"song": {"folder": folder_name}, "bundle": copy.deepcopy(self.source_bundle), "attempts": []}
        folder = self.song_folder(folder_name)
        compact = json.loads((folder / "chart" / "ril_chart.json").read_text(encoding="utf-8"))
        return {"song": backend.build_song_entry(folder), "bundle": packages.compact_chart_to_bundle(compact), "attempts": []}

    def list_songs(self) -> list[dict]:
        return [backend.build_song_entry(path) for path in self.output_root.iterdir() if path.is_dir()]


def main() -> None:
    neutral_chart_polish.install_neutral_chart_polish()
    source = load_fixture()
    untouched = copy.deepcopy(source)

    light = combined_chart.generate_combined_chart(source, {"strength": "light"})
    balanced = combined_chart.generate_combined_chart(source, {"strength": "balanced"})
    hard = combined_chart.generate_combined_chart(source, {"strength": "hard"})

    # Generator purity / original chart safety.
    assert source == untouched
    assert light["chart"] is not source
    assert balanced["chart"]["events"] == source["events"]
    assert balanced["chart"]["sections"] == source["sections"]
    assert balanced["chart"]["mappings"] == source["mappings"]

    # Player/right-side material is authoritative and never retimed or dropped.
    source_players = player_source(source)
    result_players = [
        row for row in balanced["chart"]["notes"]
        if row.get("owner") == "player" and provenance(row)["source_owner"] == "player"
    ]
    assert len(result_players) == len(source_players)
    source_player_rows = sorted(
        (row["time_ms"], row["lane"], row["raw_lane"], row["sustain_ms"], row["note_type"])
        for row in source_players
    )
    result_player_rows = sorted(
        (row["time_ms"], row["lane"], row["raw_lane"], row["sustain_ms"], row["note_type"])
        for row in result_players
    )
    assert result_player_rows == source_player_rows

    # Opponent-only material fills player silence, including authored sustains.
    assert decision_at(balanced, 800)["accepted"] is True
    assert decision_at(balanced, 800)["merge_reason"] == "player-gap"
    assert decision_at(balanced, 3500)["accepted"] is True
    inserted_sustain = next(
        row for row in balanced["chart"]["notes"]
        if row["time_ms"] == 3500 and provenance(row)["source_owner"] == "opponent"
    )
    assert inserted_sustain["sustain_ms"] == 500

    # A real handoff can interleave briefly, but near-simultaneous player timing wins.
    assert decision_at(balanced, 1950)["accepted"] is True
    assert decision_at(balanced, 1950)["merge_reason"] == "handoff"
    assert decision_at(balanced, 1910)["accepted"] is False
    assert decision_at(balanced, 1910)["decision"] == "player-time-collision"

    # Same-lane micro-jacks and player sustain conflicts are rejected.
    assert decision_at(balanced, 1830)["accepted"] is False
    assert decision_at(balanced, 1830)["decision"] == "same-lane-micro-jack"
    assert decision_at(balanced, 2600)["accepted"] is False
    assert decision_at(balanced, 2600)["decision"] == "sustain-conflict"

    # Dense simultaneous vocals are not treated as "just stack both sides".
    dense_rows = [
        decision_at(balanced, value)
        for value in (5060, 5185, 5310, 5435)
    ]
    assert all(not row["accepted"] for row in dense_rows)
    assert all(row["decision"] in {"simultaneous-dense", "player-time-collision", "density-budget"} for row in dense_rows)

    # Sparse accents are strength-gated rather than global percentage sampling.
    sparse = bundle(
        [
            note(0, 0, "player"),
            note(350, 1, "player"),
            note(700, 2, "player"),
            note(1050, 3, "player"),
            note(1400, 0, "player"),
            note(1750, 1, "player"),
            note(2100, 2, "player"),
            note(1225, 2, "opponent"),
        ]
    )
    sparse_light = combined_chart.generate_combined_chart(sparse, {"strength": "light"})
    sparse_balanced = combined_chart.generate_combined_chart(sparse, {"strength": "balanced"})
    assert decision_at(sparse_light, 1225)["accepted"] is False
    assert decision_at(sparse_balanced, 1225)["accepted"] is True
    assert decision_at(sparse_balanced, 1225)["merge_reason"] == "sparse-accent"

    # Density cleanup rejects excess authored merge material without retiming it.
    density = bundle(
        [
            note(1000, 0, "player"),
            note(1300, 1, "player"),
            note(1600, 2, "player"),
            note(1450, 3, "opponent"),
            note(1700, 3, "opponent"),
            note(1900, 0, "opponent"),
        ]
    )
    density_result = combined_chart.generate_combined_chart(density, {"strength": "balanced"})
    assert density_result["stats"]["rejections_by_reason"].get("density-budget", 0) >= 1

    # Presets are monotonically more permissive on the inspection fixture.
    counts = [
        light["stats"]["opponent_notes_inserted"],
        balanced["stats"]["opponent_notes_inserted"],
        hard["stats"]["opponent_notes_inserted"],
    ]
    assert counts == sorted(counts), counts

    # Every playable timestamp in the derivative came from an authored source note.
    source_rows = {
        (float(row["time_ms"]), int(row["lane"]), float(row["sustain_ms"]))
        for row in playable(source)
    }
    for row in playable(balanced["chart"]):
        assert (float(row["time_ms"]), int(row["lane"]), float(row["sustain_ms"])) in source_rows

    # Inserted notes become playable owner=player while carrying source-side provenance.
    inserted = [
        row for row in balanced["chart"]["notes"]
        if row.get("lane") is not None and provenance(row)["source_owner"] == "opponent"
    ]
    assert inserted
    assert all(row["owner"] == "player" for row in inserted)
    assert all(provenance(row)["original_time_ms"] == row["time_ms"] for row in inserted)

    # Neutral compact round-trip keeps the derived provenance and events.
    compact = packages.bundle_to_compact_chart(balanced["chart"])
    expanded = packages.compact_chart_to_bundle(compact)
    assert expanded["events"] == balanced["chart"]["events"]
    roundtrip_inserted = [
        row for row in expanded["notes"]
        if row.get("lane") is not None
        and any(
            isinstance(extra, dict)
            and (extra.get("ril_derived") or {}).get("source_owner") == "opponent"
            for extra in row.get("extra_data") or []
        )
    ]
    assert len(roundtrip_inserted) == balanced["stats"]["opponent_notes_inserted"]

    # Unsupported or ambiguous sources fail instead of guessing.
    no_opponent = bundle([note(0, 0, "player")])
    try:
        combined_chart.generate_combined_chart(no_opponent)
    except ValueError as exc:
        assert "both authored player and opponent" in str(exc)
    else:
        raise AssertionError("Player-only chart was incorrectly accepted")

    wrong_format = bundle([note(0, 0, "player"), note(500, 1, "opponent")], source_format="osu_mania")
    try:
        combined_chart.generate_combined_chart(wrong_format)
    except ValueError as exc:
        assert "requires an FNF chart" in str(exc)
    else:
        raise AssertionError("Non-FNF chart was incorrectly accepted")

    malformed = bundle([note(0, 0, "player"), note(500, 1, "opponent")])
    malformed["summary"]["base_bpm"] = 0
    for row in malformed["notes"]:
        row["bpm"] = 0
    malformed["sections"] = []
    try:
        combined_chart.generate_combined_chart(malformed)
    except ValueError as exc:
        assert "valid BPM" in str(exc)
    else:
        raise AssertionError("Chart without a usable beat timeline was accepted")

    # Save creates a separate neutral chart, preserves source files, and copies/hard-links audio unchanged.
    with tempfile.TemporaryDirectory(prefix="ril_combined_chart_") as temp:
        root = Path(temp)
        source_folder = root / "Source Song"
        (source_folder / "audio").mkdir(parents=True)
        (source_folder / "audio" / "instrumental.ogg").write_bytes(b"OggSfixture-audio")
        (source_folder / "song.json").write_text(
            json.dumps(
                {
                    "song_name": source["summary"]["song_name"],
                    "song_id": source["summary"]["song_id"],
                    "media": {
                        "instrumental": {
                            "filename": "Inst.ogg",
                            "stored_name": "instrumental.ogg",
                            "size_bytes": 16,
                        }
                    },
                }
            ),
            encoding="utf-8",
        )
        sentinel = source_folder / "source-sentinel.txt"
        sentinel.write_text("do-not-touch", encoding="utf-8")
        fake = FakeApp(root, source)
        saved = combined_chart_backend.save_combined_chart(
            fake,
            {"folder": "Source Song", "strength": "balanced"},
            APP_VERSION,
        )
        target = root / saved["song"]["folder"]
        assert target != source_folder
        assert target.is_dir()
        assert sentinel.read_text(encoding="utf-8") == "do-not-touch"
        assert (target / "audio" / "instrumental.ogg").read_bytes() == b"OggSfixture-audio"
        saved_bundle = fake.song_bundle(target.name)["bundle"]
        assert saved_bundle["summary"]["source_format"] == "ril_combined_chart"
        assert saved_bundle["events"] == source["events"]
        meta = json.loads((target / "song.json").read_text(encoding="utf-8"))
        assert meta["derived_chart"]["source_folder"] == "Source Song"
        assert meta["derived_chart"]["strength"] == "balanced"

    assert APP_VERSION == "5.0.0-dev"
    print(f"Rhythm Input Lab {APP_VERSION} Combined Chart self-test passed.")


if __name__ == "__main__":
    main()
