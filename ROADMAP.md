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

## Next up: fast route to the universal engine

### 4.8 — Universal foundation

- define a versioned neutral RIL chart document
- separate timing, notes, holds, hazards, events, scroll behavior, metadata, and source-specific extensions
- capability flags and explicit unsupported-mechanic warnings
- importer adapter interface instead of format-specific logic leaking into Practice and Analysis
- normalization tests and round-trip fixtures
- move FNF through the same adapter used by future formats
- make Practice, Visualizer, and Analysis consume the neutral model only

### 4.9 — First external formats

- osu!mania import and export
- Quaver import and export
- StepMania `.sm` / `.ssc` import and export
- format comparison reports showing preserved, approximated, and omitted mechanics
- shared song/audio discovery where each format supports it
- converter preview before writing files

### 5.0 — Universal rhythm engine

- public RIL interchange format
- FNF, osu!mania, Quaver, StepMania, Clone Hero, and RIL conversion pipeline
- export back into FNF-compatible charts
- turn recorded attempts into draft charts
- combine multiple chartless attempts to reconstruct a higher-confidence chart
- preserve holds, hazards, labels, events, lanes, timing, metadata, and source extensions wherever possible
- route every supported format through the same Practice, Analysis, collection, and reporting systems

## Later

### 5.5 — Chart Doctor

- timing and audio validation
- impossible-transition and difficulty-spike detection
- conversion warnings and mechanic validation
- chart repair, completion, and difficulty estimation

### 6.0 — Rhythm Lab

- connect Practice, profiles, analysis, reconstruction, conversion, Chart Doctor, and long-term improvement tracking into one complete rhythm-game workspace
