# Quaver import

Rhythm Input Lab 5.0 adds an independently implemented Quaver adapter. It accepts standalone `.qua` charts and `.qp` mapsets, then converts supported charts into the same neutral RIL runtime used by Practice, Visualizer, Analysis, saved attempts, and portable `.ril` packages.

## Import flow

1. Open **Import**.
2. Drop a `.qp` mapset or standalone `.qua` chart.
3. Wait for the local preview to parse every chart.
4. Select the supported 4K–9K maps to import.
5. Choose whether matching display names become separate copies or replace their charts.
6. Import and open a result in Practice or Visualizer.

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

## `.qp` mapsets and media

A `.qp` file is treated as a ZIP-compatible Quaver mapset. Every `.qua` entry is inspected before anything is written.

The referenced `AudioFile` is resolved:

1. relative to the `.qua` entry inside the archive
2. as an exact archive path
3. by unambiguous filename when only one matching entry exists

Supported OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, and WEBM audio is copied into the normal saved instrumental slot without transcoding. When several selected charts share one source, RIL uses filesystem hard links where possible and falls back to normal copies.

Standalone `.qua` files do not contain their referenced media. The chart imports normally and audio can be attached afterward.

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
- uploaded sources larger than 2 GB
- individual `.qua` charts larger than 64 MB
- YAML aliases

Unknown YAML tags such as Quaver scroll-group tags are loaded as plain data. No source scripts or executable content are run.

## Reference and attribution

The uploaded Quaver client source and the public Quaver.API format implementation were used to understand `.qua` and `.qp` behavior. RIL's parser and adapter are independently written in Python and do not bundle Quaver client code, assets, or runtime dependencies beyond a general YAML parser. See `THIRD_PARTY_NOTICES.md`.
