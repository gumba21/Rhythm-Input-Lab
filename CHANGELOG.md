# Changelog

## 4.5.0-dev

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

## 4.4.0-dev

### Changed

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
