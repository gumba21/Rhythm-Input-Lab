# FNF folder and batch importing

Rhythm Input Lab can import complete FNF mod/song folders instead of requiring one chart at a time.

## Supported chart layouts

- Legacy and Psych-style section charts (`song.notes[].sectionNotes`)
- Codename Engine charts (`codenameChart` / `strumLines`)
- Separate `events.json` files when they are stored beside a song's difficulties

## Folder discovery

The folder importer recognizes the two common layouts below and also performs a conservative nearby-folder fallback.

```text
mods/<mod>/songs/<song>/charts/*.json
mods/<mod>/songs/<song>/song/*.{ogg,mp3,wav,...}
```

```text
assets/data/<song>/*.json
assets/songs/<song>/*.{ogg,mp3,wav,...}
```

Select the highest useful folder (a mod, `songs`, `assets`, or an individual song folder). The browser supplies relative paths for every selected file; RIL never receives or stores the user's original absolute path.

## Audio matching

- `Inst`, `Instrumental`, and close variants are preferred as the instrumental.
- Every matching `Voices`, `Vocals`, character, player, opponent, or GF stem is preserved.
- The first detected vocal track remains the backward-compatible primary `Vocals` track.
- Additional vocal stems are stored separately and synchronized during Practice and Visualizer playback.
- When several difficulties share one song, RIL uploads each source audio file once and hard-links it across imported difficulty folders where the filesystem supports hard links. It falls back to copying when needed.

## Codename preservation

Codename strum-line position, vocal suffix, raw note payload, custom note type, event parameters, stage, scroll speed, and BPM-change events are preserved in the normalized bundle. If a nearby `meta.json`, `metadata.json`, or `song.json` is present, missing song name, BPM, and scroll speed fields are filled from it without discarding the original metadata.
