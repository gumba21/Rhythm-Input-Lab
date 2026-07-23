# Rhythm Input Lab

Rhythm Input Lab is a local rhythm-game workspace for recording inputs, importing charts, replaying attempts, practicing difficult sections, and analyzing performance.

The current development version is read from the root `VERSION` file. The supported launchers patch the backend, recorder, reports, import adapters, package tools, and browser label from that same value.

## Windows setup

1. Clone or pull the repository.
2. Run `install.bat` once.
3. Run `run.bat`.
4. Keep the console window open while using the browser GUI.

The server binds only to `127.0.0.1`. Charts, recordings, locally attached audio, osu! beatmaps, and imported/exported `.ril` packages are not uploaded by the app.

## Current features

- global 4K–9K physical input recording with optional separate dodge input
- legacy/Psych-style FNF chart and event importing
- standalone `.osu` and multi-difficulty `.osz` osu!mania importing
- selectable 4K–9K osu!mania difficulties with taps, holds, BPM changes, inherited scroll-velocity points, breaks, mapper metadata, beatmap IDs, and automatic `.osz` audio discovery
- one searchable, naturally sorted song browser shared by Visualizer, Practice, and Analysis
- chart-only, replay-only, and chart/replay comparison views
- automatic/manual replay alignment with one cached result shared by Visualizer and Analysis
- configurable Sick, Good, Bad, Shit, miss, safe-frame, ghost-tapping, hold, and hazard behavior
- playable 4K–9K Practice with audio, speed controls, precise ranges, looping, holds, hazards, saved setups, goals, collections, history, and full-song attempt saving
- coaching analysis for weak sections, lanes, timing, consistency, strict rhythm patterns, likely miss causes, and attempt comparison
- saved per-song instrumental and vocals playback with byte-range seeking
- portable `.ril` song packages containing the compact neutral chart, mechanic mappings, metadata, sharing username, and optional instrumental/vocals audio
- verified `.ril` import preview, SHA-256 integrity checks, duplicate handling, provenance, and immediate Practice/Visualizer access

Reconstructed judgments are estimates derived from physical input. Rhythm Input Lab does not claim that its configured judgments reproduce an imported game's official score calculation.

## Import osu!mania

Open **Import**, then drop either:

- an `.osz` beatmap set, which can contain multiple difficulties and its audio
- a standalone `.osu` chart, which imports the chart while audio can be attached afterward

The preview lists every supported 4K–9K mania difficulty before anything is written. Choose the difficulties to import, then open any result directly in Practice or Visualizer. Each imported chart is normalized into the same RIL runtime model used by FNF and portable `.ril` songs, so Analysis, saved attempts, collections, and `.ril` export work without a separate osu!-specific runtime.

The adapter preserves source timing and metadata as neutral chart data and source extensions. Non-mania charts and unsupported key modes are listed as skipped rather than silently misread. See [`OSU_IMPORT.md`](OSU_IMPORT.md) for the detailed behavior and limitations.

## Portable `.ril` songs

Open a song in the library and choose **Export .ril** to create one compressed file that can be sent to another Rhythm Input Lab user. Attempts and personal statistics are excluded. The recipient can import the package from the Import page, inspect its metadata and audio contents, then play it immediately.

The package and compact neutral chart specification is documented in [`RIL_FORMAT.md`](RIL_FORMAT.md).

## Project files

```text
.
├── app.py                       version-aware GUI launcher
├── backend.py                   local browser GUI backend
├── rhythm_input_lab_core.py     recorder and analysis core
├── fnf_importer.py              FNF normalization and compatibility adapter
├── osu_importer.py              osu!mania .osu/.osz parser and neutral adapter
├── osu_import_backend.py        chunked osu!mania preview/import backend
├── osu_importer_self_test.py    osu!mania parser and archive safety tests
├── ril_package_backend.py       neutral RIL chart and portable package backend
├── ril_package_self_test.py     RIL round-trip and archive safety tests
├── OSU_IMPORT.md                osu!mania import behavior and limitations
├── RIL_FORMAT.md                portable package and compact chart specification
├── THIRD_PARTY_NOTICES.md       source references, licenses, and attribution
├── self_test.py                 application smoke tests
├── VERSION                      single application version source
├── web/                         browser interface and atlases
├── run.bat                      start the GUI
├── run-console.bat              start the console fallback
└── run-tests.bat                run the smoke tests
```

Runtime songs, attempts, reports, saved audio, and normalized charts are stored in the output folder selected in Settings, not in the repository.

## Development workflow

Development happens on `develop`; stable releases belong on `main`.

Before pushing a change, run `run-tests.bat`. Then stage, commit, and push through Git GUI. See `docs/DEVELOPMENT.md` for the exact workflow.
