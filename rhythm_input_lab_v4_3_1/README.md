Rhythm Input Lab 4.3.1

- fixes hazard filtering through the shared note-type mapper
- shows authored hazard counts even before loading a replay
- exposes zero-hazard charts clearly in the visualizer subtitle

Rhythm Input Lab 4.3

# Rhythm Input Lab 4.2

Rhythm Input Lab is a local rhythm-game input recorder, FNF chart importer, and chart/input replay visualizer.

## Install and run on Windows

1. Extract the entire ZIP.
2. Run `install.bat` once.
3. Run `Rhythm Input Lab 4.bat`.
4. Keep the console window open. The GUI opens in your default browser.

The app starts a local-only server on `127.0.0.1`. It does not upload your charts, recordings, or audio.

## Main GUI pages

- **Dashboard:** library totals and recent activity.
- **Record:** arm the global listener, switch to the game, and use the saved start/stop hotkeys.
- **Import:** import a legacy/Psych-style FNF song JSON and optional separate `events.json`.
- **Songs:** browse saved songs and attempts.
- **Visualizer:** replay the chart, physical inputs, or both together.
- **Settings:** 4K–9K bindings, dodge input, recorder controls, output location, and timing windows.

## Visualizer controls

- chart only / inputs only / chart + inputs
- FNF / minimal / X-ray theme
- player and opponent chart toggle
- event rail toggle
- play, pause, restart, seek, 0.25x–2x playback
- adjustable scroll speed
- automatic chart/input alignment
- manual offset entry and ±1/±10 ms nudges
- optional local audio file attachment
- click notes, inputs, or events for details

### Colors in comparison mode

- green input marker: matched input
- orange input marker: extra input
- glowing red chart note: estimated miss
- cyan/yellow X-ray label: early/late timing offset

## Reconstructed accuracy

Rhythm Input Lab aligns physical key presses to authored player notes and estimates:

- note matches and misses
- extra presses
- early/late offset
- judgment distribution
- hit rate
- weighted reconstructed accuracy
- dodge event completion

These values are estimates. The original game can use different windows, ghost-tapping rules, scripted lane transforms, health mechanics, or sustain behavior.

## FNF theme assets

The included `NOTE_assets.png` and `NOTE_assets.xml` provide the optional animated-style FNF visual theme. The visualizer also works in Minimal and X-ray modes, so the normalized chart engine is not tied to one game's art.

## Output layout

```text
Documents\RhythmInputLab\
└── Song Name\
    ├── song.json
    ├── chart\
    │   ├── original.json
    │   ├── normalized_notes.json
    │   ├── normalized_events.json
    │   ├── normalized_sections.json
    │   ├── mappings.json
    │   └── song_explorer.html
    └── Attempt 001 — timestamp\
        ├── inputs.csv
        ├── session.json
        ├── analysis.json
        └── report.html
```

## Console fallback

`Console Mode 3.5.bat` opens the previous menu-driven workflow. It uses the same settings and output folder.

## Troubleshooting

- Run `Run Self Test.bat` to validate the package.
- If global recording fails, run `py -m pip install pynput`.
- If the browser does not open, copy the local URL printed in the console.
- Close the console window or press Ctrl+C to shut down the local GUI backend.


## 4.1 additions

- fixes the first-load `medianAbs` visualizer crash
- separate local instrumental and vocals attachment
- synchronized dual-stem playback
- independent instrumental and vocals volume controls
- clear buttons for each stem
- toggleable note-splash hit effects during replay

The instrumental acts as the playback clock when present. Vocals become the clock when no instrumental is attached.


## 4.2 additions

- standalone and chart-overlay replay importing from `inputs.csv`
- optional `session.json` / `analysis.json` metadata import
- attempt-folder import support
- input-only replay charts with tap notes and holds
- upscroll/downscroll toggle
- ghost-tapping scoring toggle
- compact shoulder-to-shoulder lane layout
- real animated FNF note splashes from the supplied atlas
- dodge inputs displayed on the mechanic rail and timeline

Imported replays are intentionally playback-only: the GUI does not claim reconstructed accuracy for an arbitrary imported CSV. Saved attempts loaded from their matching song folder still support reconstructed judgments.
