Rhythm Input Lab 4.3.1

- fixes hazard filtering through the shared note-type mapper
- shows authored hazard counts even before loading a replay
- exposes zero-hazard charts clearly in the visualizer subtitle

Rhythm Input Lab 4.3

# Rhythm Input Lab 4.2

## Visualizer

- Added upscroll/downscroll switching with the receptor line and all chart, replay, hold, event, and dodge motion reversed correctly.
- Compacted the note highway so lane receptors and notes sit almost shoulder-to-shoulder.
- Replaced the generated placeholder particles with the supplied 32-frame FNF note-splash atlas.
- Note splashes use the proper purple, blue, green, and red lane animations and deterministic animation variants.
- Added a ghost-tapping toggle. Ghost taps remain visible but are ignored by reconstructed accuracy; disabling ghost tapping penalizes extras.
- Added dodge-input markers to the mechanic rail, timeline, current-time panel, and object inspector.

## Replay importing

- Added local `inputs.csv` replay importing directly into the visualizer.
- Optional `session.json` or `analysis.json` can be selected alongside the CSV to restore lane bindings and metadata.
- Added whole-attempt-folder importing through the browser folder picker.
- CSV-only imports ask for the left-to-right lane mapping when metadata is unavailable.
- Standalone replays create a temporary input-only chart with tap arrows, holds, receptors, splashes, dodge markers, seeking, and playback controls.
- Imported replays can also be overlaid on an already loaded chart. Accuracy reconstruction intentionally remains disabled for imported replays.
- Added clear-replay controls and replay-source status.

# Rhythm Input Lab 4.1

## Fixed

- Visualizer no longer crashes on first load when no attempt comparison exists.
- Median absolute timing safely displays an em dash before comparison data is available.

## Added

- Individually attachable instrumental and vocals stems.
- Synchronized dual-stem playback.
- Independent stem volume controls and clear buttons.
- Local-only stem filenames displayed above the visualizer.
- Replay note splashes based on matched chart notes and reconstructed judgments.
- Note-splash enable/disable toggle.

# Rhythm Input Lab 4.0

## GUI and visualizer update

- New local browser GUI with Dashboard, Record, Import, Songs, Visualizer, and Settings pages.
- The Python backend binds only to `127.0.0.1`; data does not leave the computer.
- Global input recording remains available while the rhythm game has focus.
- Live elapsed time, lane presses, dodge presses, and current one-second NPS.
- Song library with imported-chart and attempt status.
- FNF chart import from the GUI, including an optional separate `events.json`.
- Scrolling 4K–9K chart visualizer.
- FNF atlas theme using the supplied `NOTE_assets.png` and XML atlas.
- Minimal and X-ray visualizer themes.
- Player/opponent chart toggle.
- Tap notes, sustain notes, receptors, input holds, and event rail.
- Chart-only, inputs-only, and comparison views.
- Physical input replay aligned to chart time.
- Automatic alignment plus manual millisecond nudging.
- Reconstructed judgments, hit rate, weighted reconstructed accuracy, early/late counts, misses, and extras.
- Dodge-event matching against imported events.
- Event-density timeline, miss markers, seeking, slow motion, frame-friendly 0.25x playback, and optional local audio attachment.
- Clickable note, input, and event inspection.
- Existing 3.5 console mode remains available as a fallback.

## Deferred

- Cross-format export is intentionally deferred to 5.0.
- Audio files are not copied into song folders yet.
- Reconstructed judgments remain estimates rather than official game results.
