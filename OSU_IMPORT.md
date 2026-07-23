# osu!mania import

Rhythm Input Lab 4.9 introduces the first external chart adapter. It accepts standalone `.osu` files and `.osz` beatmap sets, then converts supported mania difficulties into the same neutral RIL runtime chart used by Practice, Visualizer, Analysis, saved attempts, and portable `.ril` packages.

## Import flow

1. Open the **Import** page.
2. Drop an `.osz` beatmap set or standalone `.osu` file.
3. Wait for the local preview to parse the source.
4. Select one or more supported difficulties.
5. Choose whether matching song names should become separate copies or replace their charts.
6. Import and open a result in Practice or Visualizer.

No beatmap or audio data is uploaded to an external service.

## Supported chart data

The version 1 adapter imports:

- osu! mode `3` (`osu!mania`)
- 4K through 9K key modes
- tap notes
- hold notes and their authored end times
- uninherited timing points and BPM changes
- inherited timing points as scroll-velocity events
- timing-point meter, sample-set, sample-index, volume, effects, and raw beat length as source metadata
- break periods
- Unicode and fallback title/artist metadata
- mapper name and difficulty/version name
- beatmap and beatmap-set IDs
- preview time and referenced audio filename
- original hit-object type bits, hit sounds, object parameters, hit samples, and source row indexes as extensions

Each difficulty is stored as a separate song named approximately:

```text
Artist - Title [Difficulty]
```

## `.osz` beatmap sets

A beatmap set can contain several `.osu` charts. The preview lists every supported mania difficulty and lets the user select only the ones they want.

The importer resolves the chart's `AudioFilename`:

1. relative to the `.osu` entry's folder inside the archive
2. as an exact archive path
3. by unique basename when the archive contains only one matching file

Supported audio formats are OGG, MP3, WAV, FLAC, M4A, AAC, OPUS, and WEBM. Audio is copied without transcoding into the song's saved instrumental slot. When several selected difficulties share one audio source, Rhythm Input Lab uses filesystem hard links where available and falls back to normal copies.

## Standalone `.osu` files

A standalone `.osu` file does not contain its referenced audio. Rhythm Input Lab imports the complete chart and reports that audio must be attached afterward through Practice or Visualizer. Once attached, the existing per-song media system remembers it normally.

## Neutral RIL mapping

osu!mania notes become neutral player notes:

```text
time_ms
lane
sustain_ms
owner = player
active BPM
source extension data
```

The x-coordinate is mapped with osu!mania's column layout:

```text
lane = floor(x * key_count / 512)
```

Timing information becomes neutral data and explicit events:

- `osu! BPM change`
- `osu! SV change`
- `osu! Break`

The original `.osu` chart is preserved beside the normalized files. A compact `ril_chart.json` is generated immediately, so the imported chart can be exported as a portable `.ril` song without returning to osu!-specific code.

## Duplicate behavior

The preview offers:

- **Import as separate copies** — always creates new song folders
- **Replace matching charts** — replaces the chart for an exact matching display name while preserving existing attempt folders and unrelated saved media

Each difficulty includes its version name in the display name, so different difficulties from the same beatmap set do not normally conflict.

## Compatibility and limitations

- Modes other than osu!mania are skipped.
- Key modes outside 4K–9K are skipped because the current Practice and input-profile systems support 4K–9K.
- Storyboards, backgrounds, videos, skins, samples, and osu!-specific visual presentation are not imported.
- Inherited timing points are preserved as neutral scroll-velocity events; current Practice rendering does not yet reproduce every osu!mania scroll behavior exactly.
- Rhythm Input Lab uses its own configurable judgment windows and does not claim official osu! score parity.
- Beatmap ownership and audio-sharing rights are not changed by importing or exporting a chart.

## Archive safety

The `.osz` reader rejects:

- path traversal
- encrypted entries
- symbolic links
- archives without `.osu` files
- more than 20,000 entries
- more than 4 GB of expanded data
- uploaded sources larger than 2 GB
- individual `.osu` charts larger than 64 MB

Temporary uploads older than 24 hours are removed when the import backend starts.

## Reference and attribution

The adapter is independently implemented in Python. The open-source Web osu!mania project was used as an implementation and format reference; its MIT notice is included in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
