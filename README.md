# Rhythm Input Lab

Rhythm Input Lab is a local rhythm-game workspace for recording inputs, importing charts, replaying attempts, practicing difficult sections, and analyzing performance.

The current development version is read from the root `VERSION` file. The supported launchers patch the backend, recorder, reports, import adapters, package tools, and browser label from that same value.

## Windows setup

1. Clone or pull the repository.
2. Run `install.bat` once.
3. Run `run.bat`.
4. Keep the console window open while using the browser GUI.

The server binds only to `127.0.0.1`. Charts, recordings, locally attached audio, imported maps, and imported/exported `.ril` packages are not uploaded by the app.

## Current features

- global 4K–9K physical input recording with optional separate dodge input
- legacy/Psych-style FNF chart and event importing
- standalone `.osu` and multi-difficulty `.osz` osu!mania importing
- standalone `.qua` and multi-difficulty `.qp` Quaver importing
- selectable 4K–9K Quaver charts with taps, long notes, mines, BPM/time-signature changes, SV, scroll-speed factors, timing groups, bookmarks, metadata, and automatic `.qp` audio discovery
- selectable 4K–9K osu!mania difficulties with taps, holds, BPM changes, inherited scroll-velocity points, breaks, mapper metadata, beatmap IDs, and automatic `.osz` audio discovery
- per-format capability previews that distinguish preserved, extension-stored, approximated, and currently unrendered data
- one searchable, naturally sorted song browser shared by Visualizer, Practice, and Analysis
- chart-only, replay-only, and chart/replay comparison views
- automatic/manual replay alignment with one cached result shared by Visualizer and Analysis
- configurable Sick, Good, Bad, Shit, miss, safe-frame, ghost-tapping, hold, and hazard behavior
- playable 4K–9K Practice with synchronized count-ins, audio, speed controls, precise ranges, looping, holds, hazards, saved setups, goals, collections, history, and full-song attempt saving
- descriptive performance analysis for sections, lanes, timing, consistency, strict rhythm patterns, likely miss causes, and attempt comparison
- descriptive Practice run data including mean offset, timing spread, median absolute offset, hit rate, chart density, FC state, session totals, and local-history totals
- saved per-song instrumental and vocals playback with byte-range seeking
- portable `.ril` song packages containing the compact neutral chart, mechanic mappings, metadata, sharing username, and optional instrumental/vocals audio
- verified `.ril` import preview, SHA-256 integrity checks, duplicate handling, provenance, and immediate Practice/Visualizer access
- Discord export target with an exact 8,000,000-byte package limit and a separate unrestricted full-package target

Reconstructed judgments are estimates derived from physical input. Rhythm Input Lab presents measurements and classifications for the user to interpret; it does not act as an automated coach or claim that configured judgments reproduce an imported game's official scoring.

## Practice controls

Practice displays a synchronized `3 · 2 · 1 · GO!` count-in on fresh starts, retries, and loop restarts. Resuming a paused run remains immediate.

Common shortcuts:

- `Enter`: start a run
- `P` or `Escape`: pause/resume; Escape also cancels an active count-in
- `R`: retry
- `L`: toggle looping when L is not a bound lane key
- `-` / `+`: step through Practice speed presets
- `[` / `]`: seek one second while paused; hold Shift for five seconds
- `Home` / `End`: jump to the selected range edges
- `,` / `.`: previous/next timing section

## Import Quaver

Open **Import**, then drop either:

- a `.qp` mapset, which can contain multiple `.qua` difficulties and shared audio
- a standalone `.qua` chart, which imports the chart while audio can be attached afterward

The preview lists every supported 4K–9K chart before anything is written and reports mines, holds, SV, scroll-speed factors, active actions per second, media availability, and fidelity boundaries. Mines become neutral hazards; timing groups, keysounds, samples, bookmarks, editor data, and source metadata are retained without creating a Quaver-specific gameplay runtime.

See [`QUAVER_IMPORT.md`](QUAVER_IMPORT.md) for detailed behavior, archive protections, and current compatibility limits.

## Import osu!mania

Open **Import**, then drop either:

- an `.osz` beatmap set, which can contain multiple difficulties and its audio
- a standalone `.osu` chart, which imports the chart while audio can be attached afterward

The preview lists every supported 4K–9K mania difficulty before anything is written. Choose the difficulties to import, then open any result directly in Practice or Visualizer. Each imported chart is normalized into the same RIL runtime model used by FNF, Quaver, and portable `.ril` songs, so Analysis, saved attempts, collections, and `.ril` export work without a separate osu!-specific runtime.

The adapter preserves source timing and metadata as neutral chart data and source extensions. Non-mania charts and unsupported key modes are listed as skipped rather than silently misread. See [`OSU_IMPORT.md`](OSU_IMPORT.md) for the detailed behavior and limitations.

## Portable `.ril` songs

Open a song in the library and choose **Export .ril** to create one compressed file that can be sent to another Rhythm Input Lab user. Attempts and personal statistics are excluded. The recipient can import the package from the Import page, inspect its metadata and audio contents, then play it immediately.

The default Discord target estimates the selected contents and refuses the finished export when it exceeds exactly 8,000,000 bytes. It removes optional selections rather than silently transcoding or lowering audio quality. The Full package target keeps the normal package limits.

The package and compact neutral chart specification is documented in [`RIL_FORMAT.md`](RIL_FORMAT.md).

## Project files

```text
.
├── app.py                         version-aware GUI launcher
├── backend.py                     local browser GUI backend
├── rhythm_input_lab_core.py       recorder and analysis core
├── fnf_importer.py                FNF normalization and compatibility adapter
├── osu_importer.py                osu!mania .osu/.osz parser and neutral adapter
├── osu_import_backend.py          chunked osu!mania preview/import backend
├── osu_importer_self_test.py      osu!mania parser and archive safety tests
├── quaver_importer.py             Quaver .qua/.qp parser and neutral adapter
├── quaver_import_backend.py       chunked Quaver preview/import backend
├── quaver_importer_self_test.py   Quaver parser and archive safety tests
├── ril_package_backend.py         neutral RIL chart and portable package backend
├── discord_export_backend.py      exact Discord package-size enforcement
├── neutral_chart_polish.py        explicit neutral timing-section positions
├── practice_polish_self_test.py   Practice polish and Discord export tests
├── RIL_FORMAT.md                  portable package and compact chart specification
├── OSU_IMPORT.md                  osu!mania import behavior and limitations
├── QUAVER_IMPORT.md               Quaver import behavior and limitations
├── THIRD_PARTY_NOTICES.md         source references, licenses, and attribution
├── self_test.py                   application smoke tests
├── VERSION                        single application version source
├── web/                           browser interface and atlases
├── run.bat                        start the GUI
├── run-console.bat                start the console fallback
└── run-tests.bat                  run the smoke tests
```

Runtime songs, attempts, reports, saved audio, and normalized charts are stored in the output folder selected in Settings, not in the repository.

## Development workflow

Development happens on `develop`; stable releases belong on `main`.

Before pushing a change, run `run-tests.bat`. Then stage, commit, and push through Git GUI. See `docs/DEVELOPMENT.md` for the exact workflow.
