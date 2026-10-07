from __future__ import annotations

import copy
import math
import re
from bisect import bisect_right
from collections import Counter
from dataclasses import asdict, dataclass
from typing import Any, Sequence

GENERATOR_VERSION = 1
MERGE_KIND = "combined_chart"


@dataclass(frozen=True)
class MergePreset:
    name: str
    rank: int
    phrase_gap_beats: float
    handoff_window_beats: float
    sparse_player_notes_per_beat: float
    min_accent_gap_beats: float
    min_jack_beats: float
    density_window_beats: float
    density_ratio: float
    density_extra_notes: int
    collision_ms: float


PRESETS: dict[str, MergePreset] = {
    "light": MergePreset(
        "light", 1, 0.80, 0.50, 0.0, 0.36, 0.26, 2.0, 1.08, 0, 38.0
    ),
    "balanced": MergePreset(
        "balanced", 2, 0.80, 1.00, 2.0, 0.28, 0.20, 2.0, 1.32, 1, 36.0
    ),
    "hard": MergePreset(
        "hard", 3, 0.80, 1.50, 4.0, 0.16, 0.14, 2.0, 1.58, 2, 34.0
    ),
}

CATEGORY_PRIORITY = {"player-gap": 0, "handoff": 1, "sparse-accent": 2}
HANDOFF_DETECTION_MAX_BEATS = 1.5
MAX_HANDOFF_PLAYER_NOTES_PER_BEAT = 3.0


@dataclass(frozen=True)
class Phrase:
    start_ms: float
    end_ms: float
    note_count: int


@dataclass(frozen=True)
class Handoff:
    time_ms: float
    direction: str
    player_boundary_ms: float
    opponent_boundary_ms: float


def _finite(value: Any) -> bool:
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _note_start(note: dict[str, Any]) -> float:
    return _number(note.get("time_ms"))


def _note_end(note: dict[str, Any]) -> float:
    start = _note_start(note)
    if _finite(note.get("end_ms")):
        return max(start, float(note["end_ms"]))
    return start + max(0.0, _number(note.get("sustain_ms")))


def _note_lane(note: dict[str, Any]) -> int:
    return int(note.get("lane"))


def _slug(value: Any) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")
    return text or "combined-chart"


def _peak_nps(notes: Sequence[dict[str, Any]], window_ms: float = 1000.0) -> float:
    times = sorted(_note_start(note) for note in notes if note.get("lane") is not None)
    if not times or window_ms <= 0:
        return 0.0
    left = 0
    best = 0
    for right, current in enumerate(times):
        while left <= right and current - times[left] >= window_ms:
            left += 1
        best = max(best, right - left + 1)
    return best / (window_ms / 1000.0)


def _chart_patterns(notes: Sequence[dict[str, Any]]) -> dict[str, Any]:
    lane_counts = Counter(
        _note_lane(note) for note in notes if note.get("lane") is not None
    )
    groups: dict[int, list[dict[str, Any]]] = {}
    for note in notes:
        if note.get("lane") is None:
            continue
        groups.setdefault(int(round(_note_start(note))), []).append(note)
    chord_sizes = [
        len(group)
        for group in groups.values()
        if len({note.get("lane") for note in group}) >= 2
    ]
    by_lane: dict[int, list[float]] = {}
    for note in notes:
        if note.get("lane") is None:
            continue
        by_lane.setdefault(_note_lane(note), []).append(_note_start(note))
    jack_pairs = 0
    for times in by_lane.values():
        times.sort()
        jack_pairs += sum(
            1 for index in range(1, len(times))
            if times[index] - times[index - 1] <= 250.0
        )
    return {
        "lane_counts": {str(key): value for key, value in sorted(lane_counts.items())},
        "chord_groups": len(chord_sizes),
        "largest_chord": max(chord_sizes, default=1),
        "jack_pairs_250ms": jack_pairs,
    }


class TempoMap:
    def __init__(self, bundle: dict[str, Any]) -> None:
        summary = bundle.get("summary") if isinstance(bundle.get("summary"), dict) else {}
        notes = [row for row in bundle.get("notes", []) if isinstance(row, dict)]
        sections = [row for row in bundle.get("sections", []) if isinstance(row, dict)]
        base_bpm = _number(summary.get("base_bpm"), 0.0)
        points: list[tuple[float, float]] = []
        if base_bpm > 0:
            points.append((0.0, base_bpm))

        cursor = 0.0
        current_bpm = base_bpm
        for section in sections:
            bpm = _number(section.get("bpm"), current_bpm)
            if bpm <= 0:
                bpm = current_bpm
            explicit = section.get("time_ms")
            if explicit is not None and _finite(explicit):
                cursor = max(0.0, float(explicit))
            if bpm > 0:
                points.append((cursor, bpm))
                current_bpm = bpm
            steps = max(0, int(_number(section.get("length_in_steps"), 0)))
            if explicit is None and current_bpm > 0 and steps > 0:
                cursor += (steps / 4.0) * (60_000.0 / current_bpm)

        last_note_bpm: float | None = None
        for note in sorted(notes, key=_note_start):
            bpm = _number(note.get("bpm"), 0.0)
            if bpm > 0 and (last_note_bpm is None or abs(bpm - last_note_bpm) > 1e-7):
                points.append((_note_start(note), bpm))
                last_note_bpm = bpm

        points.sort(key=lambda row: (row[0], row[1]))
        collapsed: list[tuple[float, float]] = []
        for time_ms, bpm in points:
            if bpm <= 0:
                continue
            if collapsed and abs(collapsed[-1][0] - time_ms) < 0.001:
                collapsed[-1] = (time_ms, bpm)
            elif not collapsed or abs(collapsed[-1][1] - bpm) > 1e-7:
                collapsed.append((time_ms, bpm))
        self.points = collapsed
        self.times = [row[0] for row in collapsed]

    def valid(self) -> bool:
        return bool(self.points)

    def bpm_at(self, time_ms: float) -> float:
        if not self.points:
            return 0.0
        index = bisect_right(self.times, float(time_ms)) - 1
        if index < 0:
            index = 0
        return self.points[index][1]

    def beat_ms_at(self, time_ms: float) -> float:
        bpm = self.bpm_at(time_ms)
        return 60_000.0 / bpm if bpm > 0 else 0.0


def _source_format(bundle: dict[str, Any]) -> str:
    summary = bundle.get("summary") if isinstance(bundle.get("summary"), dict) else {}
    return str(summary.get("source_format") or summary.get("format") or "").casefold()


def validate_source_chart(bundle: dict[str, Any]) -> TempoMap:
    if not isinstance(bundle, dict):
        raise ValueError("Combined Chart needs a normalized chart bundle.")
    summary = bundle.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("Combined Chart needs neutral chart summary data.")

    source_format = _source_format(bundle)
    if "combined" in source_format:
        raise ValueError("This chart is already a Combined Chart derivative.")
    if not any(token in source_format for token in ("fnf", "psych", "codename")):
        raise ValueError("Combined Chart currently requires an FNF chart with preserved player/opponent ownership.")

    key_count = int(_number(summary.get("key_count"), 0))
    if key_count not in range(4, 10):
        raise ValueError("Combined Chart requires a supported 4K–9K chart.")

    player = 0
    opponent = 0
    notes = bundle.get("notes")
    if not isinstance(notes, list):
        raise ValueError("Combined Chart source notes are missing.")
    for index, note in enumerate(notes):
        if not isinstance(note, dict):
            raise ValueError(f"Source note {index} is malformed.")
        owner = str(note.get("owner") or "")
        lane = note.get("lane")
        if lane is None:
            if owner not in {"event", ""}:
                raise ValueError(f"Source note {index} has no playable lane.")
            continue
        if owner not in {"player", "opponent"}:
            raise ValueError(f"Source note {index} has unreliable player/opponent ownership.")
        try:
            lane_number = int(lane)
        except (TypeError, ValueError):
            raise ValueError(f"Source note {index} has an invalid lane.") from None
        if lane_number < 0 or lane_number >= key_count:
            raise ValueError(f"Source note {index} has a lane outside the {key_count}K chart.")
        if not _finite(note.get("time_ms")) or float(note["time_ms"]) < 0:
            raise ValueError(f"Source note {index} has malformed timing.")
        if note.get("sustain_ms") is not None and (
            not _finite(note.get("sustain_ms")) or float(note["sustain_ms"]) < 0
        ):
            raise ValueError(f"Source note {index} has malformed sustain timing.")
        if note.get("end_ms") is not None and (
            not _finite(note.get("end_ms")) or float(note["end_ms"]) < float(note["time_ms"])
        ):
            raise ValueError(f"Source note {index} has malformed sustain end timing.")
        if owner == "player":
            player += 1
        else:
            opponent += 1

    if not player or not opponent:
        raise ValueError("Combined Chart needs both authored player and opponent note streams.")

    for index, event in enumerate(bundle.get("events") or []):
        if not isinstance(event, dict) or not _finite(event.get("time_ms")) or float(event["time_ms"]) < 0:
            raise ValueError(f"Source event {index} has malformed timing.")

    tempo = TempoMap(bundle)
    if not tempo.valid():
        raise ValueError("Combined Chart could not determine a valid BPM/beat timeline from this source.")
    return tempo


def _build_phrases(
    notes: Sequence[dict[str, Any]],
    tempo: TempoMap,
    gap_beats: float,
) -> list[Phrase]:
    ordered = sorted(notes, key=lambda note: (_note_start(note), _note_lane(note)))
    if not ordered:
        return []
    phrases: list[Phrase] = []
    start = _note_start(ordered[0])
    end = _note_end(ordered[0])
    count = 1
    for note in ordered[1:]:
        note_start = _note_start(note)
        note_end = _note_end(note)
        gap_limit = max(1.0, gap_beats * tempo.beat_ms_at(note_start))
        if note_start - end > gap_limit:
            phrases.append(Phrase(start, end, count))
            start, end, count = note_start, note_end, 1
        else:
            end = max(end, note_end)
            count += 1
    phrases.append(Phrase(start, end, count))
    return phrases


def _phrase_at(phrases: Sequence[Phrase], time_ms: float) -> Phrase | None:
    for phrase in phrases:
        if phrase.start_ms <= time_ms <= phrase.end_ms:
            return phrase
        if phrase.start_ms > time_ms:
            break
    return None


def _handoffs(
    player_phrases: Sequence[Phrase],
    opponent_phrases: Sequence[Phrase],
    tempo: TempoMap,
) -> list[Handoff]:
    rows: list[Handoff] = []
    max_beats = HANDOFF_DETECTION_MAX_BEATS
    for player in player_phrases:
        for opponent in opponent_phrases:
            middle = (opponent.start_ms + player.end_ms) / 2.0
            if abs(opponent.start_ms - player.end_ms) <= max_beats * tempo.beat_ms_at(middle):
                rows.append(Handoff(middle, "player-to-opponent", player.end_ms, opponent.start_ms))
            middle = (player.start_ms + opponent.end_ms) / 2.0
            if abs(player.start_ms - opponent.end_ms) <= max_beats * tempo.beat_ms_at(middle):
                rows.append(Handoff(middle, "opponent-to-player", player.start_ms, opponent.end_ms))
    rows.sort(key=lambda row: (row.time_ms, row.direction))
    deduped: list[Handoff] = []
    for row in rows:
        if (
            deduped
            and row.direction == deduped[-1].direction
            and abs(row.time_ms - deduped[-1].time_ms) < 5.0
        ):
            continue
        deduped.append(row)
    return deduped


def _nearest_handoff(
    time_ms: float,
    rows: Sequence[Handoff],
    tempo: TempoMap,
    window_beats: float,
) -> Handoff | None:
    best = None
    best_distance = math.inf
    for row in rows:
        distance = abs(time_ms - row.time_ms)
        if distance <= window_beats * tempo.beat_ms_at(row.time_ms) and distance < best_distance:
            best = row
            best_distance = distance
    return best


def _count_in_window(
    notes: Sequence[dict[str, Any]],
    start_ms: float,
    end_ms: float,
) -> int:
    return sum(1 for note in notes if start_ms <= _note_start(note) <= end_ms)


def _nearest_onset_distance(notes: Sequence[dict[str, Any]], time_ms: float) -> float:
    if not notes:
        return math.inf
    return min(abs(_note_start(note) - time_ms) for note in notes)


def _classify_candidate(
    note: dict[str, Any],
    *,
    player_notes: Sequence[dict[str, Any]],
    player_phrases: Sequence[Phrase],
    handoffs: Sequence[Handoff],
    tempo: TempoMap,
    preset: MergePreset,
) -> tuple[str | None, str]:
    time_ms = _note_start(note)
    player_phrase = _phrase_at(player_phrases, time_ms)
    if player_phrase is None:
        return "player-gap", "player-gap"

    nearby_handoff = _nearest_handoff(
        time_ms, handoffs, tempo, preset.handoff_window_beats
    )
    if nearby_handoff is not None:
        beat_ms = tempo.beat_ms_at(nearby_handoff.time_ms)
        half = beat_ms / 2.0
        boundary_density = _count_in_window(
            player_notes,
            nearby_handoff.time_ms - half,
            nearby_handoff.time_ms + half,
        )
        if boundary_density <= MAX_HANDOFF_PLAYER_NOTES_PER_BEAT:
            if preset.rank >= 2:
                return "handoff", "handoff"
            return None, "strength-handoff"

    if preset.rank >= 2 and preset.sparse_player_notes_per_beat > 0:
        beat_ms = tempo.beat_ms_at(time_ms)
        half = beat_ms / 2.0
        local_count = _count_in_window(player_notes, time_ms - half, time_ms + half)
        nearest_gap_beats = (
            _nearest_onset_distance(player_notes, time_ms) / beat_ms if beat_ms > 0 else 0.0
        )
        if (
            local_count <= preset.sparse_player_notes_per_beat
            and nearest_gap_beats >= preset.min_accent_gap_beats
        ):
            return "sparse-accent", "sparse-accent"

    return None, "simultaneous-dense"


def _interval_conflict(
    a: dict[str, Any],
    b: dict[str, Any],
    tolerance_ms: float = 0.0,
) -> bool:
    if a.get("lane") is None or b.get("lane") is None or _note_lane(a) != _note_lane(b):
        return False
    a_start, a_end = _note_start(a), _note_end(a)
    b_start, b_end = _note_start(b), _note_end(b)
    if a_end - a_start <= 0.001 and b_end - b_start <= 0.001:
        return False
    return a_start <= b_end + tolerance_ms and b_start <= a_end + tolerance_ms


def _cleanup_reason(
    candidate: dict[str, Any],
    *,
    merged_notes: Sequence[dict[str, Any]],
    player_notes: Sequence[dict[str, Any]],
    opponent_notes: Sequence[dict[str, Any]],
    tempo: TempoMap,
    preset: MergePreset,
) -> str | None:
    time_ms = _note_start(candidate)
    lane = _note_lane(candidate)
    beat_ms = tempo.beat_ms_at(time_ms)

    # Any near-simultaneous player onset wins. This blocks accidental cross-side chords.
    if any(abs(_note_start(note) - time_ms) <= preset.collision_ms for note in player_notes):
        return "player-time-collision"

    for note in merged_notes:
        if note.get("lane") is None or _note_lane(note) != lane:
            continue
        if _interval_conflict(candidate, note, tolerance_ms=1.0):
            return "sustain-conflict"
        distance = abs(_note_start(note) - time_ms)
        if distance <= preset.collision_ms:
            return "same-lane-duplicate"
        min_jack_ms = max(55.0, preset.min_jack_beats * beat_ms)
        if distance < min_jack_ms:
            return "same-lane-micro-jack"

    window_ms = max(100.0, preset.density_window_beats * beat_ms)
    start = time_ms - window_ms / 2.0
    end = time_ms + window_ms / 2.0
    player_count = _count_in_window(player_notes, start, end)
    opponent_count = _count_in_window(opponent_notes, start, end)
    source_baseline = max(1, player_count, opponent_count)
    allowed = max(
        source_baseline,
        math.ceil(source_baseline * preset.density_ratio) + preset.density_extra_notes,
    )
    merged_count = _count_in_window(merged_notes, start, end) + 1
    if merged_count > allowed:
        return "density-budget"

    return None


def _provenance(
    note: dict[str, Any],
    source_owner: str,
    merge_reason: str,
) -> dict[str, Any]:
    return {
        "ril_derived": {
            "generator": MERGE_KIND,
            "generator_version": GENERATOR_VERSION,
            "source_owner": source_owner,
            "merge_reason": merge_reason,
            "original_lane": note.get("lane"),
            "original_raw_lane": note.get("raw_lane"),
            "original_time_ms": _note_start(note),
            "original_sustain_ms": max(0.0, _number(note.get("sustain_ms"))),
            "original_must_hit_section": note.get("must_hit_section"),
            "original_section_index": note.get("section_index"),
        }
    }


def _with_provenance(
    note: dict[str, Any],
    source_owner: str,
    merge_reason: str,
    *,
    playable_owner: str | None = None,
) -> dict[str, Any]:
    copied = copy.deepcopy(note)
    existing = copied.get("extra_data")
    if isinstance(existing, list):
        extras = copy.deepcopy(existing)
    elif existing in (None, {}, ""):
        extras = []
    else:
        extras = [{"source_extra_data": copy.deepcopy(existing)}]
    extras.append(_provenance(note, source_owner, merge_reason))
    copied["extra_data"] = extras
    if playable_owner is not None:
        copied["owner"] = playable_owner
    copied["end_ms"] = _note_end(copied)
    copied["sustain_ms"] = max(0.0, _note_end(copied) - _note_start(copied))
    return copied


def _decision(
    note: dict[str, Any],
    index: int,
    *,
    accepted: bool,
    category: str | None,
    reason: str,
) -> dict[str, Any]:
    return {
        "source_index": index,
        "time_ms": _note_start(note),
        "lane": note.get("lane"),
        "raw_lane": note.get("raw_lane"),
        "sustain_ms": max(0.0, _number(note.get("sustain_ms"))),
        "accepted": bool(accepted),
        "merge_reason": category if accepted else None,
        "category": category,
        "decision": reason,
    }


def generate_combined_chart(
    chart: dict[str, Any],
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Generate one harder playable chart by selecting authored notes from both FNF sides."""
    options = dict(options or {})
    strength = str(options.get("strength") or "balanced").casefold()
    if strength not in PRESETS:
        raise ValueError("Merge strength must be Light, Balanced, or Hard.")
    preset = PRESETS[strength]

    source = copy.deepcopy(chart)
    tempo = validate_source_chart(source)
    summary = source["summary"]

    playable = [note for note in source.get("notes") or [] if note.get("lane") is not None]
    player_notes = sorted(
        (note for note in playable if note.get("owner") == "player"),
        key=lambda note: (_note_start(note), _note_lane(note)),
    )
    opponent_notes = sorted(
        (note for note in playable if note.get("owner") == "opponent"),
        key=lambda note: (_note_start(note), _note_lane(note)),
    )
    event_notes = [
        note
        for note in source.get("notes") or []
        if note.get("owner") == "event" or note.get("lane") is None
    ]

    player_phrases = _build_phrases(player_notes, tempo, preset.phrase_gap_beats)
    opponent_phrases = _build_phrases(opponent_notes, tempo, preset.phrase_gap_beats)
    handoffs = _handoffs(player_phrases, opponent_phrases, tempo)

    decisions: list[dict[str, Any]] = []
    eligible: list[tuple[int, int, dict[str, Any], str]] = []
    for index, note in enumerate(opponent_notes):
        category, reason = _classify_candidate(
            note,
            player_notes=player_notes,
            player_phrases=player_phrases,
            handoffs=handoffs,
            tempo=tempo,
            preset=preset,
        )
        if category is None:
            decisions.append(
                _decision(note, index, accepted=False, category=None, reason=reason)
            )
            continue
        eligible.append((CATEGORY_PRIORITY[category], index, note, category))

    # Cleanup is intentionally a second pass. Stronger musical reasons are considered first;
    # unsafe notes are rejected rather than shifted to synthetic timestamps.
    eligible.sort(
        key=lambda row: (
            row[0],
            _note_start(row[2]),
            _note_lane(row[2]),
            row[1],
        )
    )
    merged_for_validation: list[dict[str, Any]] = [copy.deepcopy(note) for note in player_notes]
    accepted: list[tuple[int, dict[str, Any], str]] = []
    decision_by_index = {row["source_index"]: row for row in decisions}

    for _, index, note, category in eligible:
        rejection = _cleanup_reason(
            note,
            merged_notes=merged_for_validation,
            player_notes=player_notes,
            opponent_notes=opponent_notes,
            tempo=tempo,
            preset=preset,
        )
        if rejection:
            decision_by_index[index] = _decision(
                note, index, accepted=False, category=category, reason=rejection
            )
            continue
        accepted_note = copy.deepcopy(note)
        merged_for_validation.append(accepted_note)
        accepted.append((index, accepted_note, category))
        decision_by_index[index] = _decision(
            note, index, accepted=True, category=category, reason=category
        )

    decisions = [decision_by_index[index] for index in range(len(opponent_notes))]

    output_notes = [
        _with_provenance(note, "player", "player-backbone", playable_owner="player")
        for note in player_notes
    ]
    for _, note, category in accepted:
        output_notes.append(
            _with_provenance(note, "opponent", category, playable_owner="player")
        )
    output_notes.extend(
        _with_provenance(note, "event", "preserved-event-note")
        for note in event_notes
    )
    output_notes.sort(
        key=lambda note: (
            _note_start(note),
            -1 if note.get("lane") is None else _note_lane(note),
            str(note.get("owner") or ""),
        )
    )

    inserted = len(accepted)
    rejection_counts = Counter(
        row["decision"] for row in decisions if not row["accepted"]
    )
    insertion_counts = Counter(
        row["merge_reason"] for row in decisions if row["accepted"]
    )
    collision_rejections = sum(
        count
        for reason, count in rejection_counts.items()
        if reason
        in {
            "player-time-collision",
            "same-lane-duplicate",
            "same-lane-micro-jack",
            "sustain-conflict",
        }
    )

    source_title = str(summary.get("song_name") or "Untitled Song")
    derived_title = (
        str(options.get("song_name") or f"{source_title} — Combined").strip()
        or f"{source_title} — Combined"
    )

    combined_player = [note for note in output_notes if note.get("owner") == "player"]
    patterns = _chart_patterns(combined_player)
    note_type_counts = Counter(
        str(note.get("note_type") or "(normal)") for note in output_notes
    )
    raw_lane_counts = Counter(
        int(note.get("raw_lane"))
        for note in output_notes
        if note.get("raw_lane") is not None
    )
    output_summary = copy.deepcopy(summary)
    output_summary.update(
        {
            "format": "ril_neutral",
            "source_format": "ril_combined_chart",
            "song_name": derived_title,
            "song_id": _slug(derived_title),
            "derived_chart_type": MERGE_KIND,
            "derived_from_song_name": source_title,
            "derived_from_song_id": str(summary.get("song_id") or ""),
            "derived_from_source_format": str(
                summary.get("source_format") or summary.get("format") or ""
            ),
            "merge_strength": strength,
            "generator_version": GENERATOR_VERSION,
            "total_notes": len(output_notes),
            "player_notes": len(player_notes) + inserted,
            "opponent_notes": 0,
            "event_notes": len(event_notes),
            "sustain_notes": sum(
                _note_end(note) - _note_start(note) > 0.001 for note in output_notes
            ),
            "event_count": len(source.get("events") or []),
            "duration_ms": max(
                [0.0, _number(summary.get("duration_ms"))]
                + [_note_end(note) for note in output_notes]
                + [
                    _number(event.get("time_ms"))
                    for event in source.get("events") or []
                    if isinstance(event, dict)
                ]
            ),
            "player_peak_1s_nps": _peak_nps(combined_player, 1000.0),
            "player_peak_2s_nps": _peak_nps(combined_player, 2000.0),
            "player_peak_5s_nps": _peak_nps(combined_player, 5000.0),
            "player_lane_counts": patterns["lane_counts"],
            "player_chord_groups": patterns["chord_groups"],
            "largest_player_chord": patterns["largest_chord"],
            "player_jack_pairs_250ms": patterns["jack_pairs_250ms"],
            "raw_lane_counts": {
                str(key): value for key, value in sorted(raw_lane_counts.items())
            },
            "note_type_counts": dict(note_type_counts),
            "unique_note_types": len(note_type_counts),
        }
    )

    metadata = copy.deepcopy(source.get("song_metadata") or {})
    metadata["ril_derived"] = {
        "type": MERGE_KIND,
        "version": GENERATOR_VERSION,
        "strength": strength,
        "source_song_name": source_title,
        "source_song_id": str(summary.get("song_id") or ""),
        "source_format": str(
            summary.get("source_format") or summary.get("format") or ""
        ),
        "policy": "player-backbone-authored-notes-only",
    }

    stats = {
        "strength": strength,
        "original_player_notes": len(player_notes),
        "original_opponent_notes": len(opponent_notes),
        "player_notes_retained": len(player_notes),
        "opponent_notes_inserted": inserted,
        "opponent_notes_rejected": len(opponent_notes) - inserted,
        "handoffs_detected": len(handoffs),
        "original_player_peak_nps": _peak_nps(player_notes, 1000.0),
        "combined_peak_nps": _peak_nps(combined_player, 1000.0),
        "resulting_total_note_count": len(combined_player),
        "sustain_count": sum(
            _note_end(note) - _note_start(note) > 0.001 for note in combined_player
        ),
        "collision_rejections": collision_rejections,
        "insertions_by_reason": dict(sorted(insertion_counts.items())),
        "rejections_by_reason": dict(sorted(rejection_counts.items())),
    }

    warnings: list[str] = []
    if inserted == 0:
        warnings.append(
            "No opponent notes passed the selected merge-strength and safety rules."
        )
    if stats["combined_peak_nps"] > max(
        0.01, stats["original_player_peak_nps"]
    ) * 1.75:
        warnings.append(
            "The combined chart has a substantially higher 1-second peak than the original player chart; inspect the preview before saving."
        )

    output = {
        "summary": output_summary,
        "notes": output_notes,
        "events": copy.deepcopy(source.get("events") or []),
        "sections": copy.deepcopy(source.get("sections") or []),
        "mappings": copy.deepcopy(
            source.get("mappings")
            or {"note_types": {}, "event_types": {}}
        ),
        "song_metadata": metadata,
    }
    return {
        "chart": output,
        "stats": stats,
        "decisions": decisions,
        "warnings": warnings,
        "handoffs": [asdict(row) for row in handoffs],
        "config": asdict(preset),
    }
