# Rhythm Input Lab roadmap

## Current stable release

### 4.5 — Cleanup and visualizer polish

- clean repository and versioning
- hurt-note and hazard support
- song mechanic categorization and analyzer
- precise seeking, combo HUD, audio synchronization, and Reports page

## Completed development milestones

### 4.6 — Playable Practice

- a dedicated Practice page separate from the replay Visualizer
- playable 4K–9K charts using saved key profiles and exact multi-key artwork
- restored atlas-based note splashes
- synchronized instrumental/vocals playback, speed controls, looping, holds, hazards, and replay review
- precision range selection with draggable edges, playhead, whole-range movement, zoom, and millisecond nudging
- cumulative post-attempt accuracy graph
- global Practice defaults, favorites, recent songs, saved setups, goals, collections, queues, tags, notes, and statistics

### 4.7 — Performance analysis

- dedicated Analysis workspace
- automatic attempt-to-chart alignment
- metrics restricted to the chart range actually covered by the recording or Practice attempt
- section accuracy, misses, timing, holds, and direct Practice handoff
- per-lane performance and user-defined left/right/center hand assignments
- strict pattern detection for jacks, trills, rolls, stairs, streams, bursts, chords, chordstreams, holdstreams, panning, and flams
- conditional 6K brackets and ringtrills
- compact pattern shorthand
- uncertainty-aware likely-cause classifications shown alongside the underlying measurements
- beginning/middle/ending consistency comparison
- attempt-to-attempt progress comparison
- pattern-failure Practice collections
- searchable naturally sorted song browser shared by Visualizer, Practice, and Analysis
- remembered song-browser sorting and filters
- per-song instrumental/vocals storage, automatic loading, and seekable byte-range streaming

### 4.7.1 — Shared-results stabilization

- one cached chart-match and accuracy result shared by Visualizer and Analysis
- identical judgment windows, ghost-input rules, extra penalties, hazard handling, offsets, and headline accuracy
- removal of duplicate Analysis recalculation and brute-force matching loops
- completed continuous full-song Practice runs saved into normal song Attempt history
- partial Practice ranges kept separate from official full-song attempts
- normal Visualizer review for saved Practice attempts
- Practice library moved into a tabbed menu
- persistent Visualizer layout, playback, audio, display, and per-attempt offset settings

### 4.8 — Portable RIL foundation

- one shareable `.ril` package containing a compact neutral chart, mechanic mappings, metadata, and optional instrumental/vocals audio
- local sharing username with `Shared by` / `Imported from` provenance kept separate from original charter credit
- verified package preview before import, including hashes, size, compatibility, source format, chart details, audio contents, and warnings
- duplicate handling through separate-copy, chart/media replacement, or missing-audio merge modes
- immediate Practice and Visualizer access after import
- Recently imported dashboard cards and provenance labels throughout the song library
- dictionary-compressed note/event vocabulary and positional note, event, and section rows
- neutral runtime expansion shared by Visualizer, Practice, and Analysis
- lazy `ril_chart.json` generation for existing FNF imports and automatic neutral documents for new imports
- source extensions, custom note types, custom events, extra note data, and editable mappings preserved without executable package code
- archive path, file type, size, file count, encryption, symlink, and SHA-256 integrity protections
- package/compact-chart round-trip fixtures and format documentation

### 4.9 — osu!mania import

- standalone `.osu` and multi-difficulty `.osz` importing
- selectable supported 4K–9K difficulties with clear skipped-chart reporting
- tap and hold notes with exact lane and hold-end conversion
- uninherited timing points, BPM changes, inherited scroll velocities, meters, breaks, samples, volumes, effects, and source extensions
- Unicode/fallback song metadata, mapper credit, difficulty names, preview time, and beatmap identifiers
- automatic `.osz` audio discovery relative to the chart, by exact path, or by unambiguous filename
- lossless saved-audio import with shared-audio hard links where supported
- neutral RIL documents created immediately for every imported difficulty
- immediate Practice, Visualizer, Analysis, collections, attempts, saved media, and portable `.ril` export
- separate-copy and replace-matching-chart modes that preserve attempt folders
- chunked uploads, stale-temp cleanup, archive safety limits, and dedicated adapter fixtures
- open-source Web osu!mania attribution while retaining an independent Python implementation

### 4.9.1 — Practice and sharing polish

- synchronized `3 · 2 · 1 · GO!` count-ins for fresh starts, retries, Enter starts, and automatic loop restarts
- existing Practice lead-in reused as the count-in duration without adding a second delay
- immediate pause resume, cancellable count-ins, corrected ready-state buttons, and clearer Ready/Playing/Paused/Break/Result state labels
- descriptive run measurements for mean offset, timing spread, median absolute offset, hit rate, note density, FC state, session totals, and local-history totals
- no automated coach or prescribed action; the user interprets the displayed data
- result-screen Retry and Review controls plus expanded keyboard navigation for looping, speed, range edges, sections, and paused seeking
- live osu!mania BPM, inherited SV, mapper/difficulty, and authored break information in Practice
- explicit neutral section start times preserved through `.ril` charts, with lazy upgrades for existing osu!mania imports
- improved audio start alignment, track-drift status, and count-in-safe playback
- Discord `.ril` export target with an exact 8,000,000-byte backend limit
- optional contents removed to fit rather than silently transcoding or reducing audio quality
- unrestricted Full package target retained for non-Discord sharing
- dedicated neutral-timing and Discord-size regression tests

## Next up

### 5.0 — Universal adapter and conversion boundary

- Quaver `.qua` import into the neutral RIL model
- StepMania `.sm` / `.ssc` import into the neutral RIL model
- source-format capability reports showing preserved, approximated, extension-stored, and unsupported mechanics
- shared song/audio discovery where each source format supports it
- adapter contract cleanup so Practice, Visualizer, Analysis, and packages never branch on the source game
- conversion previews and external-format exports only after round-trip fidelity is measurable
- continue adding sortable, inspectable measurements rather than automated coaching instructions

### 5.5 — Chart reconstruction and Chart Doctor

- turn recorded attempts into draft charts
- combine multiple chartless attempts into a higher-confidence reconstruction
- timing and audio validation
- impossible-transition and difficulty-spike detection
- conversion warnings and mechanic validation
- chart repair, completion, and difficulty estimation
- expose evidence, confidence, affected ranges, and raw metrics so the user decides what to change

### 6.0 — Rhythm Lab

- connect Practice, profiles, analysis, reconstruction, conversion, Chart Doctor, and long-term improvement tracking into one complete local-first rhythm-game workspace
- provide timelines, comparisons, filters, and drill-down views without replacing the user's judgment
