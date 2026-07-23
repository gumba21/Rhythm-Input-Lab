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

### 4.7 — Coaching and analysis

- dedicated Analysis workspace
- automatic attempt-to-chart alignment
- metrics restricted to the chart range actually covered by the recording or Practice attempt
- section accuracy, misses, timing, holds, and direct Practice handoff
- per-lane performance and user-defined left/right/center hand assignments
- strict pattern detection for jacks, trills, rolls, stairs, streams, bursts, chords, chordstreams, holdstreams, panning, and flams
- conditional 6K brackets and ringtrills
- compact pattern shorthand
- likely miss-cause estimates with uncertainty-aware wording
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

## Next up

### 4.8.1 — Package stabilization and adapter boundary

- hands-on stress testing with long charts and large instrumental/vocals files
- strengthen interrupted upload, cancelled import, expired download, and low-disk-space behavior
- package history and clearer replacement/merge summaries
- finalize the importer-adapter contract around the neutral RIL runtime model
- reduce remaining FNF-shaped assumptions in shared chart metadata and event handling
- migrate old chart folders lazily without rewriting or deleting original source files
- performance checks for large libraries containing many imported packages

### 4.9 — First external format imports

- osu!mania import into the neutral RIL model
- Quaver import into the neutral RIL model
- StepMania `.sm` / `.ssc` import into the neutral RIL model
- source-format capability reports showing what was preserved, approximated, stored as an extension, or unsupported
- shared song/audio discovery where each source format supports it
- route imported charts through the same Practice, Visualizer, Analysis, collections, packages, and reporting systems
- keep direct export into those external formats for a later conversion-focused update

### 5.0 — Universal rhythm engine

- public stable RIL interchange format
- FNF, osu!mania, Quaver, StepMania, Clone Hero, and RIL conversion pipeline
- export back into supported game/chart formats with a preview before writing
- turn recorded attempts into draft charts
- combine multiple chartless attempts to reconstruct a higher-confidence chart
- preserve holds, hazards, labels, events, lanes, timing, metadata, and source extensions wherever possible
- route every supported format through the same Practice, Analysis, collection, package, and reporting systems

## Later

### 5.5 — Chart Doctor

- timing and audio validation
- impossible-transition and difficulty-spike detection
- conversion warnings and mechanic validation
- chart repair, completion, and difficulty estimation

### 6.0 — Rhythm Lab

- connect Practice, profiles, analysis, reconstruction, conversion, Chart Doctor, and long-term improvement tracking into one complete rhythm-game workspace
