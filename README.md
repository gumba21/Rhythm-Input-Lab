# Rhythm Input Lab

Rhythm Input Lab is a local rhythm-game input recorder, FNF chart importer, and chart/input replay visualizer.

The current development version is read from the root `VERSION` file. The supported launchers patch the backend, recorder, reports, and browser label from that same value.

## Windows setup

1. Clone or pull the repository.
2. Run `install.bat` once.
3. Run `run.bat`.
4. Keep the console window open while using the browser GUI.

The server binds only to `127.0.0.1`. Charts, recordings, and locally attached audio are not uploaded by the app.

## Current features

- global 4K–9K physical input recording
- optional separate dodge input
- legacy/Psych-style FNF chart and event importing
- chart-only, replay-only, and chart/replay comparison views
- automatic and manual replay alignment
- configurable Sick, Good, Bad, Shit, and miss windows
- safe-frame-derived outer hit window
- ghost-tapping toggle
- note splashes, downscroll, holds, opponent notes, and event rails
- hurt-note, mine, and death-note hazard mapping
- supplied hurt-note heads, sustains, and hurt splash atlas
- hazard avoided/hit counts, timeline markers, and inspector details
- optional local instrumental and vocals playback

Reconstructed judgments are estimates derived from physical input. A game may use different timing, sustain, health, ghost-tapping, or scripted-mechanic behavior.

## Project files

```text
.
├── app.py                    version-aware GUI launcher
├── backend.py                local browser GUI backend
├── console.py                version-aware console launcher
├── rhythm_input_lab_core.py  recorder and analysis core
├── fnf_importer.py           FNF normalization and comparison
├── self_test.py              package smoke tests
├── VERSION                   single application version source
├── web/                      browser interface and atlases
├── run.bat                   start the GUI
├── run-console.bat           start the console fallback
└── run-tests.bat             run the smoke tests
```

Runtime songs, attempts, and reports are stored in the output folder selected in Settings, not in the repository.

## Development workflow

Development happens on `develop`; stable releases belong on `main`.

Before pushing a change, run `run-tests.bat`. Then stage, commit, and push through Git GUI. See `docs/DEVELOPMENT.md` for the exact workflow.
