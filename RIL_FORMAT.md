# Rhythm Input Lab portable package (`.ril`)

Version 1 turns a song into one compressed, playable file that can be shared with another Rhythm Input Lab user. A package is a ZIP-compatible archive with the `.ril` extension. Audio remains as separate archive entries rather than being base64-encoded into JSON.

## Goals

- one file containing the neutral chart, metadata, mappings, and optional saved audio
- compact note/event storage without making the runtime depend on FNF JSON
- safe preview before extraction
- clear provenance such as `Imported from gumba21` without confusing the exporter with the original charter
- lossless preservation of the supplied OGG/MP3/WAV/FLAC/M4A/AAC/OPUS/WEBM files
- no attempts, personal statistics, scripts, executables, or artwork in version 1

## Archive layout

```text
song.ril
├── manifest.json
├── chart.json
├── audio/
│   ├── instrumental.ogg   (optional)
│   └── vocals.ogg         (optional)
└── source/
    └── original.json      (optional)
```

Unknown archive paths, encrypted entries, symbolic links, unsafe `..` paths, and unsupported file types are rejected.

## Manifest

`manifest.json` is readable before import and contains:

- `ril_package`: package schema version
- `package_type`: currently `playable_song`
- `package_id`: random package identifier
- `created_at`: UTC export timestamp
- `exported_by.username`: local sharing identity
- `song`: title, song id, key count, BPM, duration, difficulty, source format, and original charter
- `content`: paths for the chart and optional media
- `files`: size, SHA-256, MIME type, and role for each declared payload
- `capabilities`: playable/audio/attempt flags and chart schema version

The importer verifies every declared payload hash before offering the final Import button.

## Compact neutral chart

`chart.json` is a RIL chart document. Frequently repeated strings are stored once in dictionaries, while notes, events, and sections use positional rows.

```json
{
  "v": 1,
  "summary": {
    "song_name": "Example",
    "key_count": 4,
    "base_bpm": 180,
    "duration_ms": 120000,
    "source_format": "fnf_legacy_psych"
  },
  "dict": {
    "note_types": ["", "Hurt Note"],
    "event_names": ["Camera Zoom"],
    "event_sources": ["song.events"]
  },
  "n": [
    [1050, 0, 0, 0, 0, 0, 0, 180],
    [1350, 2, 400, 0, 0, 0, 2, 180],
    [1800, 3, 0, 0, 0, 1, 3, 180]
  ],
  "e": [
    [2500, 0, "1.1", "", 0]
  ],
  "s": [
    [0, 180, 0, 1, 16]
  ],
  "m": {
    "note_types": {},
    "event_types": {}
  },
  "x": {}
}
```

### Note row

```text
[time_ms, lane, sustain_ms, owner, section, note_type, raw_lane, bpm, optional_extra]
```

Owner codes are `0 = player`, `1 = opponent`, and `2 = event`. A lane of `-1` means the row is not a playable lane note.

### Event row

```text
[time_ms, event_name, value1, value2, source, optional_raw]
```

### Section row

```text
[section_index, bpm, changes_bpm, must_hit_section, length_in_steps]
```

The importer expands these rows into the normal runtime objects consumed by Visualizer, Practice, and Analysis.

## Import behavior

When a title already exists, the user can:

- import a separate copy
- replace the chart and any audio included in the package while preserving attempts
- fill only missing instrumental/vocals audio

The song folder records package provenance in `song.json`, including the sharing username, package id, import timestamp, source format, and original charter.

## Safety limits

Version 1 currently enforces:

- 1.5 GB maximum compressed package size
- 2 GB maximum expanded size
- 32 archive entries
- 256 MB maximum compact chart JSON
- SHA-256 verification for declared payloads
- no executable content or runtime scripts

Custom events and note types are preserved as data and mappings; they are never executed as code.
