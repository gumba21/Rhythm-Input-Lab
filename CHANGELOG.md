# Changelog

## 4.7.1-dev

### Shared results and Analysis performance

- makes Analysis consume the same chart matcher, judgment windows, extra-input rules, hazard penalties, and accuracy calculation used by Visualizer
- removes the second range-coverage recalculation loop that previously matched and rendered every attempt twice
- replaces the brute-force 126-pass Analysis offset search with the Visualizer candidate-offset system
- caches recent reconstructed results so sections, lanes, patterns, coaching, and comparisons reuse one match
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

### Coaching and analysis

- adds a dedicated Analysis page for chart-only structure analysis and reconstructed attempt coaching
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
