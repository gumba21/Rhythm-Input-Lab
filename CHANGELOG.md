# Changelog

## 5.0.0-dev

### Quaver neutral adapter

- imports standalone `.qua` charts and multi-difficulty `.qp` mapsets through a dedicated local preview
- accepts supported 4K–9K modes, including supported `+1` scratch layouts
- preserves taps, authored long-note endpoints, mines, BPM/time-signature changes, initial and changing SV data, scroll-speed-factor keyframes, timing groups, bookmarks, hit sounds, keysounds, samples, editor layers, mapper/difficulty metadata, map IDs, and source extensions
- maps Quaver mines to neutral hazard notes rather than normal playable notes
- reports active actions per second as descriptive source data without adopting Quaver scoring or difficulty calculation
- creates neutral RIL documents immediately so Practice, Visualizer, Analysis, attempts, and `.ril` packages work without a Quaver-specific runtime

### Mapsets, media, and fidelity reporting

- discovers `.qp` audio relative to each chart, by exact archive path, or by an unambiguous filename fallback
- saves supported OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, and WEBM audio without transcoding
- hard-links shared mapset audio where supported and falls back to normal copies
- previews every supported map before writing anything and lists malformed or unsupported charts separately
- adds capability reporting for preserved, extension-stored, approximated, and currently unrendered source features
- adds separate-copy and replace-matching-chart behavior while preserving attempt folders
- adds Quaver provenance badges and immediate Practice/Visualizer actions after import

### Safety, dependencies, and documentation

- parses `.qua` YAML as data through PyYAML and rejects YAML aliases
- rejects unsafe archive paths, encrypted entries, symbolic links, excessive file counts, oversized expanded archives, and oversized chart text
- adds synthetic tap, hold, mine, timing, SV, SSF, timing-group, bookmark, sound-effect, audio-discovery, unsupported-mode, and unsafe-path fixtures
- wires the Quaver backend and browser module into the normal launch path and local/CI test commands
- documents behavior and compatibility boundaries in `QUAVER_IMPORT.md`
- credits the uploaded Quaver client and public Quaver.API implementation as format references while keeping the adapter independently implemented

## 4.9.1-dev

### Practice count-in and transport polish

- adds a synchronized `3 · 2 · 1 · GO!` count-in to fresh starts, retries, Enter starts, and automatic loop restarts
- reuses the selected lead-in duration instead of adding a second delay, starts audio at GO, and keeps pause resume immediate
- allows Escape or the Pause button to cancel an active count-in cleanly
- fixes the ready-state Resume path that could begin a run without a proper reset
- adds clear Ready, Count-in, Playing, Paused, Break, and Result states
- adds result-overlay Retry and Review actions
- expands keyboard controls with loop toggling, speed stepping, five-second seeking, range-edge jumps, and previous/next timing sections

### Descriptive Practice data

- adds mean offset, timing spread, median absolute offset, hit rate, chart density, FC state, session totals, and local-history totals
- labels the new area `Descriptive only` and does not prescribe what the player should practice or change
- shows live source, mapper/difficulty, BPM, osu!mania inherited SV, authored breaks, and audio drift data
- improves osu!mania subtitles and timing-section labels
- preserves explicit neutral section start times in compact RIL charts and lazily upgrades older osu!mania neutral documents from saved timing-point metadata

### Sharing and quality-of-life

- adds a Discord `.ril` export target with an exact backend-enforced `8,000,000`-byte limit
- estimates selected chart/audio/source contents before exporting and removes optional selections in a predictable order when needed
- keeps an unrestricted Full package target
- never silently transcodes or lowers audio quality merely to fit the Discord target
- adds regression tests for explicit neutral timing positions and exact Discord-size enforcement

## 4.9.0-dev

### osu!mania adapter

- imports standalone `.osu` charts and multi-difficulty `.osz` beatmap sets through a dedicated local preview
- accepts supported osu!mania 4K–9K difficulties while clearly listing non-mania, malformed, and unsupported-key charts that were skipped
- lets any combination of difficulties be selected before import and stores each difficulty as its own song entry
- preserves taps, holds, authored hold endpoints, lane columns, mapper, difficulty, Unicode/fallback title and artist, preview time, beatmap IDs, and source hashes
- converts uninherited timing points into BPM sections/events and inherited timing points into neutral scroll-velocity events
- preserves timing-point meter, samples, volume, effects, raw beat lengths, hit sounds, object parameters, hit samples, and source row indexes as source extensions
- imports break periods as presentation events

### Beatmap-set audio and library integration

- finds `.osz` audio relative to each chart, by exact archive path, or by an unambiguous basename fallback
- copies supported OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, and WEBM audio into the normal per-song instrumental slot without transcoding
- uses hard links when several selected difficulties share the same audio and safely falls back to normal copies
- marks imported songs with osu!mania provenance, mapper credit, source package/chart names, and beatmap identifiers
- routes every imported chart through the neutral RIL model so Practice, Visualizer, Analysis, full-song attempts, collections, saved audio, and `.ril` export work immediately
- offers separate-copy or replace-matching-chart behavior while preserving existing attempt folders
- adds immediate Practice and Visualizer actions after import and osu!mania badges in the song library

### Import safety and testing

- uploads large `.osu`/`.osz` sources in chunks with cancellation, stale-temp cleanup, and a 2 GB upload limit
- rejects unsafe archive paths, encrypted entries, symbolic links, excessive entry counts, oversized expanded archives, and oversized chart text
- adds synthetic tap/hold/lane/timing/SV/break fixtures, multi-difficulty `.osz` coverage, automatic audio discovery, non-mania and unsupported-key rejection, and unsafe-path tests
- credits the MIT-licensed Web osu!mania project as an implementation reference while keeping Rhythm Input Lab's parser independent
- documents supported data, duplicate behavior, audio discovery, safety limits, and current compatibility boundaries in `OSU_IMPORT.md`

## 4.8.0-dev

### Portable playable RIL packages

- exports any charted song as one compressed `.ril` file containing the compact neutral chart, mechanic mappings, metadata, and optional saved instrumental/vocals audio
- preserves supplied OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, and WEBM audio without automatic transcoding or quality loss
- adds a local sharing username used for `Shared by` and `Imported from` provenance while keeping the exporter separate from the original charter
- adds an import preview that verifies the package, shows title, key mode, BPM, duration, note count, source format, audio contents, sharing username, package size, and compatibility warnings before writing anything
- handles duplicate titles by importing a separate copy, replacing the chart and included media while preserving attempts, or filling only missing audio
- adds Export `.ril` to song details and immediate Practice/Visualizer actions after importing
- adds a Recently imported dashboard section with provenance and quick Practice/Visualizer buttons
- keeps artwork, attempts, personal statistics, executable scripts, and online accounts outside package version 1

### Compact neutral chart foundation

- defines RIL chart version 1 with dictionary-compressed note types, event names, and event sources plus positional note, event, and section rows
- separates player/opponent ownership, holds, hazards, sections, BPM data, mappings, metadata, and source extensions from FNF-specific JSON layout
- expands compact RIL documents into the same runtime bundle consumed by Visualizer, Practice, and Analysis
- lazily creates `chart/ril_chart.json` for existing FNF imports and makes new FNF imports immediately portable
- preserves unknown note types, custom events, extra note data, raw event payloads, source format, and editable mechanic mappings
- documents the archive, manifest, compact row layout, conflict behavior, and safety limits in `RIL_FORMAT.md`

### Package safety and validation

- verifies SHA-256 hashes and declared sizes for every packaged chart/audio/source payload
- rejects path traversal, Windows-style archive paths, encrypted entries, symbolic links, unsupported files, unsafe audio types, excessive file counts, oversized charts, and archive expansion beyond configured limits
- uploads imports in chunks, streams finished exports as downloads, and cleans temporary packages after expiration
- adds compact-chart round-trip, packaged-audio, manifest, integrity, archive-layout, and unsafe-path tests

## 4.7.1-dev

### Shared results and Analysis performance

- makes Analysis consume the same chart matcher, judgment windows, extra-input rules, hazard penalties, and accuracy calculation used by Visualizer
- removes the second range-coverage recalculation loop that previously matched and rendered every attempt twice
- replaces the brute-force 126-pass Analysis offset search with the Visualizer candidate-offset system
- caches recent reconstructed results so sections, lanes, patterns, classifications, and comparisons reuse one match
- limits section and lane metrics to the portion of the chart covered by the selected attempt
- displays the exact Visualizer headline accuracy in Analysis instead of an independently calculated approximation
- shares saved per-attempt offsets between Visualizer and Analysis

### Full-song Practice attempts

- automatically saves a naturally completed, continuous full-song Practice run into that song's normal Attempt history
- writes standard `inputs.csv`, `session.json`, `analysis.json`, and `report.html` files so saved Practice runs work everywhere
- scores saved full-song Practice attempts against the complete chart, including missed notes before the first press or after the last press
- keeps partial-range or seek-skipped Practice runs local to Practice history instead of treating them as song personal bests
- opens a saved full-song Practice run through the normal Visualizer attempt loader when Review is pressed
- refreshes the song and attempt library after saving

### Interface and settings cleanup

- moves the large Practice library into a dedicated modal with Overview, Setups & collections, and History tabs
- keeps the favorite control visible while hiding goals, collections, presets, defaults, and history until requested
- persists Visualizer speed, scroll scale, theme, view mode, direction, ghost tapping, splashes, event/opponent toggles, audio volumes, lane height, and per-attempt offset
- keeps Reset view capable of replacing those saved Visualizer preferences with the reset values

## 4.7.0-dev

### Performance analysis

- adds a dedicated Analysis page for chart-only structure analysis and reconstructed attempt measurements
- automatically aligns recorded inputs against the chart before calculating section, lane, and pattern performance
- ranks weak chart sections by reconstructed accuracy, misses, timing bias, hold drops, and note count
- adds per-lane accuracy, miss, timing, and left/right/center hand summaries
- lets the user assign every lane to the left hand, right hand, or a shared center lane in Settings
- compares beginning, middle, and ending performance and labels large ending drops as possible stamina decline rather than proven fatigue
- estimates likely failure causes including strong early/late timing, possible wrong-lane inputs, dense-cluster misses, miss cascades, dropped holds, and pattern-linked failures
- compares two attempts across accuracy, misses, median absolute timing, and hold drops
- sends any weak section directly into the existing precision Practice selector
- keeps reconstructed metrics inside the portion of the chart actually covered by the selected recording or Practice range

### Strict pattern detector

- adds conservative detection for jacks, trills, rolls, stairs, streams, bursts, chordstreams, holdstreams, panning, flams, and chords
- adds conditional 6K bracket and ringtrill detection
- generates compact numeric/chord shorthand for detected patterns
- reports pattern occurrence count, reconstructed accuracy, misses, and representative shorthand
- can open the worst failed instance directly in Practice
- can save every failed instance of a pattern as a named Practice collection
- deliberately leaves uncertain near-patterns unlabeled instead of inventing a confident name

### Song library and saved audio

- adds a searchable song browser shared by Visualizer, Practice, and Analysis
- naturally sorts names so numbered songs stay in human order and adds A–Z, Z–A, recent, attempt-count, and key-mode sorting
- remembers the browser sort, key-mode filter, and favorites-first preference
- adds 4K–9K filtering, favorites-first ordering, folder-name search, metadata, saved-audio labels, and keyboard navigation
- stores selected instrumental and vocals audio inside each song folder through chunked local uploads
- automatically reloads saved audio when that song is opened again in Visualizer or Practice
- streams saved audio with HTTP byte-range support so seeking does not require reading the entire file into memory
- adds saved/uploading indicators and removes the stored copy when an audio track is cleared
- keeps audio local to the Rhythm Input Lab output library and never uploads it to an external service

## 4.6.2-dev

### Comfort update

- saves one global Practice setup and automatically reapplies speed, lead-in, scroll speed, upscroll/downscroll, ghost tapping, looping, audio volumes, and lane length when another song loads
- keeps the existing per-song range memory while preventing every chart from resetting the player's preferred playfield settings
- adds favorite songs and a recently played list with per-song attempt counts
- adds multiple named Practice setups per song, preserving the selected range and playback settings
- adds song goals for target accuracy, maximum misses, and practice speed with live progress summaries
- adds custom collections for warmups, songs to learn, difficult patterns, and multi-range practice queues
- adds local Practice attempt history with automatic PB tagging, custom tags, and notes
- adds per-song statistics for attempt count, best and average accuracy, total Practice time, and best combo
- stores Comfort data locally and caps retained history to keep browser storage manageable

### Playable practice workspace

- separates Practice from the replay-focused Visualizer
- adds a dedicated playable 4K–9K note highway using each saved key profile
- supports local instrumental and vocals files with synchronized speed changes
- adds entire-song, chart-section, and custom time ranges
- lets a run begin from any point with an adjustable visual lead-in
- adds automatic range looping, pause, retry, seeking, and section navigation
- adds 50%, 75%, 90%, 100%, and 125% practice-speed presets
- adds downscroll, scroll-speed, and ghost-tapping controls
- judges live inputs with the configured Sick, Good, Bad, Shit, and outer windows
- tracks combo, accuracy, misses, early/late timing, median offset, hold drops, and hazard hits/avoids
- records each practice run in memory and can open the last attempt directly in the Visualizer
- remembers each song's range, loop, speed, lead-in, scroll, and input preferences locally

### Practice hotfix pass

- replaces the old four-lane note atlas with the supplied multi-key artwork
- applies explicit 4K through 9K lane sprite orders, including center diamonds and the F–I second lane bank for 6K–9K
- restores true atlas-based note splash animation and installs the newly supplied 2048×2048 splash sheet
- adds a zoomable precision range selector with draggable start, end, playhead, and whole-range controls
- adds 10 ms through 1 second edge nudges plus a visible-window range shortcut
- records cumulative accuracy at every hit, miss, extra input, and hazard hit
- draws an interactive post-attempt accuracy graph with miss markers and hover details
- adds separate instrumental and vocals volume sliders with clear buttons
- adds an adjustable Practice lane-length control and remembers its value
- pauses Practice and releases tracked inputs when focus or page visibility is lost
- adds `P` pause, `R` retry, and paused `[` / `]` one-second seeking shortcuts
- extends a custom range endpoint when a hold begins inside the range and ends after it
- labels silent starts as `Start without audio`
- strengthens CI coverage for the playable engine, precision tools, splash atlas, packaged multi-key atlas, and Comfort library

## 4.5.0

### Visualizer polish

- stops playback and both audio tracks when leaving the visualizer or hiding the app
- automatically loads the newest saved attempt when opening a song in Chart + inputs mode
- automatically loads an available attempt when switching back to Chart + inputs
- removes the unclear X-ray theme and toggle
- adds an editable millisecond-precise seeker with ±10 ms, ±100 ms, and ±1 second nudges
- adds an estimated live combo HUD with the latest reconstructed judgment, timing offset, and running accuracy
- tightens instrumental/vocals synchronization during playback and after seeking
- reports audio duration, live drift, and track-length difference in the visualizer
- makes Reset view and replay clearing stop active playback cleanly

### Reports

- adds a dedicated Reports page inside the app
- lists saved attempt reports by song, attempt, and date
- lets reports be searched and opened without leaving the app
- safely serves each existing `report.html` from its own attempt folder

### Cleanup and song tools

- flattened the repository so source files live at the root instead of inside a version-named folder
- replaced scattered hardcoded versions with the root `VERSION` file and `ril_version.py`
- renamed versioned launchers to `run.bat`, `run-console.bat`, and `run-tests.bat`
- added `.gitignore`, `requirements.txt`, development documentation, and automated syntax/smoke tests
- cleaned the README and separated current documentation from version history
- added per-song custom note and event categorization
- restored the one-page song analyzer
- added adjustable visualizer lane length, Reset view, and Attempt only mode

### Hurt-note support

- validates hurt-note mapping during the self-test
- verifies the hurt-note and hurt-splash textures are packaged
- preserves hurt notes as hazards instead of normal playable notes
- reports authored, avoided, and hit hazards in the visualizer
- uses the supplied hurt note and splash atlases for rendering

## 4.3.1

- fixed hazard filtering through the shared note-type mapper
- displayed authored hazard counts before a replay is loaded
- made zero-hazard charts explicit in the visualizer subtitle

## 4.3.0

- added hurt-note textures, hurt splashes, hazard matching, and safe-frame settings

## 4.2.0

- added standalone replay importing, downscroll, ghost tapping, compact lanes, note splashes, and dodge markers

## 4.1.0

- added synchronized instrumental/vocals playback and fixed first-load visualizer statistics

## 4.0.0

- introduced the local browser GUI, song library, FNF chart importer, visualizer, chart/replay matching, and settings pages
