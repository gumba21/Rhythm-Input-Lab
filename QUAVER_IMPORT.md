# Quaver import

Rhythm Input Lab 5.0 adds an independently implemented Quaver adapter. It accepts standalone `.qua` charts and `.qp` mapsets, then converts supported charts into the same neutral RIL runtime used by Practice, Visualizer, Analysis, saved attempts, and portable `.ril` packages.

## Import flow

1. Open **Import** and choose **Quaver**.
2. Drop one or more `.qua` / `.qp` files, or choose an entire Quaver song folder.
3. When a folder is selected, RIL scans its OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, and WEBM files for each standalone chart's `AudioFile`.
4. Wait for the local preview to parse every chart and show which audio was matched.
5. Select the supported 4K–9K maps to import.
6. Choose whether matching display names become separate copies or replace their charts.
7. Import and open a result in Practice or Visualizer.

The source and audio stay on the local machine.

## Supported source data

The adapter directly maps:

- 4K through 9K lane modes, including supported `+1` scratch layouts
- tap notes
- long notes with authored end times
- mines as neutral hazard notes
- timing-point start times, BPM changes, and time signatures
- title, artist, creator, difficulty, source, tags, genre, and description
- preview time, map ID, mapset ID, and source hashes

It also preserves Quaver-specific structures as neutral events, metadata, or per-object source extensions:

- hit sounds and per-note key sounds
- editor layers
- custom audio samples and sound-effect triggers
- bookmarks
- initial scroll velocity and slider-velocity changes
- scroll-speed-factor keyframes
- normalized/denormalized SV mode
- default and custom timing/scroll groups
- per-note timing-group assignments
- background and banner filename references

The preview presents a capability report that separates direct neutral mappings, extension-stored data, approximations, and current runtime limits rather than silently flattening the source.

## Mapsets, loose charts, and media

A `.qp` file is treated as a ZIP-compatible Quaver mapset. Every `.qua` entry is inspected before anything is written.

For `.qp` mapsets, the referenced `AudioFile` is resolved:

1. relative to the `.qua` entry inside the archive
2. as an exact archive path
3. by unambiguous filename when only one matching entry exists

For loose `.qua` charts, **Choose Quaver folder** sends the folder's charts and supported audio to the local importer. RIL resolves `AudioFile` relative to the chart first, then by exact selected path, then by an unambiguous filename. The preview identifies the matched file before import. Several loose difficulties may reference the same audio; the importer can reuse that local file rather than asking the browser to select it separately for every chart.

Supported OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, and WEBM audio is copied into the normal saved instrumental slot without transcoding. When several selected charts share one source, RIL uses filesystem hard links where possible and falls back to normal copies.

A standalone `.qua` selected by itself still imports as a chart-only song. Select the containing folder or select the `.qua` together with its audio to import playback automatically.

## Neutral mapping

Quaver lanes are one-based in `.qua` and become zero-based neutral RIL lanes. A normal object becomes a playable note. A mine becomes:

```text
note_type = Quaver Mine
category = hazard
should_press = false
```

Timing and presentation structures become neutral sections and explicit events:

- `Quaver BPM change`
- `Quaver SV change`
- `Quaver scroll speed factor`
- `Quaver sound effect`
- `Quaver bookmark`

Each timing section retains its exact `time_ms`, BPM, signature, and hidden-line flag. Per-note hit sounds, key sounds, editor layers, timing groups, and raw object data remain in source extensions.

## Additional measurement

The import summary includes active actions per second. Actions count normal note heads and long-note releases while excluding mines, the empty intro, and gaps of at least one second. This is a descriptive measurement and is not a Quaver difficulty rating.

## Compatibility boundaries

- RIL currently supports 4K–9K profiles, so resolved modes outside that range are listed as unsupported.
- Per-note timing groups are preserved, but Practice currently displays one visual highway rather than separate group-specific scroll paths.
- Scroll-speed-factor keyframes are preserved, but current Practice does not reproduce every Quaver interpolation exactly.
- Backgrounds, banners, editor presentation, and sample playback are not reproduced by the runtime.
- RIL uses its own configurable judgment windows and does not claim Quaver score or difficulty-calculation parity.
- Importing or exporting a chart does not change its ownership or media-sharing rights.

## Safety limits

The `.qp` reader rejects:

- path traversal and absolute paths
- Windows-style archive paths
- encrypted entries
- symbolic links
- archives without `.qua` charts
- more than 20,000 entries
- more than 4 GB of expanded data
- uploaded sources or companion audio larger than 2 GB
- individual `.qua` charts larger than 64 MB
- YAML aliases

Unknown YAML tags such as Quaver scroll-group tags are loaded as plain data. No source scripts or executable content are run.

## Reference and attribution

The uploaded Quaver client source and the public Quaver.API format implementation were used to understand `.qua` and `.qp` behavior. RIL's parser and adapter are independently written in Python and do not bundle Quaver client code, assets, or runtime dependencies beyond a general YAML parser. See `THIRD_PARTY_NOTICES.md`.
