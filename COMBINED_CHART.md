# Combined Chart — FNF derived-chart generator

Combined Chart is a deterministic Rhythm Input Lab 5.0-dev chart tool for FNF imports. It turns an authored player/right-side stream and authored opponent/left-side stream into one harder playable neutral RIL chart without blindly stacking both sides.

## Core rule

The original player/right-side chart is the backbone.

- every playable player note is retained at its authored timestamp, lane, sustain length, note type, section, and source timing
- opponent notes are optional additions
- opponent material primarily fills player silence
- brief authored vocal handoffs may interweave when the local pattern stays safe
- Balanced and Hard may add limited opponent accents inside sparse player phrases
- simultaneous dense singing normally keeps the player side and rejects the opponent side

Combined Chart v1 never invents a new note timestamp and never shifts a source note to resolve a collision. If an authored opponent note is unsafe, it is rejected.

## Beat-relative analysis

The generator operates on the neutral RIL bundle after import rather than on Psych/Codename JSON directly.

A tempo map is reconstructed from the normalized base BPM, timing sections, and preserved note BPM information. Phrase and safety thresholds are therefore expressed primarily in beats rather than only fixed milliseconds.

The current first-pass phrase model uses:

- roughly 0.8 beat of inactivity to separate phrases
- up to 1.5 beats around phrase boundaries for handoff detection
- sustain endpoints as phrase activity
- section / `must_hit_section` information as preserved source metadata, not the ownership rule

Player/opponent ownership comes from the normalized note `owner` field.

## Merge strengths

### Light

Light is deliberately conservative.

- inserts opponent notes during clear player silence
- does not add sparse accents
- permits only very narrow, density-safe handoff overlap
- keeps the strictest jack and density limits

### Balanced

Balanced is the intended default.

- fills player silence
- permits safe, brief handoff interweaving
- permits limited opponent accents where the player phrase is locally sparse
- keeps player notes authoritative during conflicts
- applies collision, sustain, micro-jack, and density protection

### Hard

Hard is more permissive without becoming a raw union.

- keeps all Balanced behavior
- permits more sparse authored opponent accents
- uses looser local density and jack thresholds
- still rejects direct player collisions, incompatible sustains, obviously broken same-lane spacing, and excessive local merge density

The presets adjust eligibility and safety thresholds. They are not random percentages or note quotas.

## Selection and cleanup

Opponent candidates are considered in deterministic priority order:

1. player-gap
2. handoff
3. sparse-accent

A second cleanup pass then rejects unsafe candidates. Current rejection reasons include:

- `player-time-collision`
- `same-lane-duplicate`
- `same-lane-micro-jack`
- `sustain-conflict`
- `density-budget`
- `simultaneous-dense`
- strength-gated handoff/accent cases

A player note at nearly the same time always wins by default.

The local density budget compares the prospective merged window against the denser of the original player and opponent source windows, preventing the generated chart from becoming an automatic two-stream stack.

## Sustains

Player sustains retain priority.

An opponent note is rejected when it conflicts with an already-retained same-lane sustain. Opponent notes on other lanes still have to pass the normal spacing and density rules.

An authored opponent sustain can be inserted normally when the player side is inactive.

## Output and provenance

Saving creates a new library song, normally named:

`Song Name — Combined`

The source chart is never overwritten.

The saved chart is a regular neutral RIL chart and can be used by Practice, Visualizer, Analysis, attempts, and `.ril` export.

Events, timing sections, mappings, and song metadata are copied once from the source chart. Events are not duplicated.

Saved audio files are hard-linked into the derived song folder where the filesystem supports it and copied otherwise. Audio bytes are not altered.

Every retained playable note stores neutral derived provenance in `extra_data`, including:

- generator and version
- original source owner
- merge reason
- original lane
- original raw lane
- original timestamp
- original sustain length
- original section
- original `must_hit_section`

Original player notes use `player-backbone`. Inserted opponent notes use `player-gap`, `handoff`, or `sparse-accent`.

Inserted opponent notes become playable `owner = player` notes in the derivative while their original opponent ownership remains recorded in provenance.

## Preview

Song Details → Chart / mechanics → **Generate Combined Chart** opens the preview workflow for compatible FNF songs.

The preview reports:

- original player notes
- original opponent notes
- retained player notes
- inserted opponent notes
- rejected opponent notes
- handoffs detected
- original player peak 1-second NPS
- combined peak 1-second NPS
- resulting playable note count
- sustain count
- collision rejections
- accepted notes by reason
- rejected notes by reason
- warnings

Previewing does not write a chart. Save regenerates the result on the backend from the source bundle and selected preset, then creates a separate derived song.

## Compatibility / failure rules

Generation is refused rather than guessed when:

- the source is not an FNF/Psych/Codename-derived chart
- reliable player/opponent ownership is missing
- either authored side has no playable notes
- lanes are missing or outside the declared key mode
- timestamps or sustain endpoints are malformed
- no usable BPM/beat timeline can be determined
- the source is already a Combined Chart derivative

Combined Chart currently supports the same 4K–9K neutral key modes used by RIL.

## Determinism and v1 scope

For the same neutral source chart and merge strength, the result is deterministic.

v1 deliberately does **not**:

- synthesize new rhythms
- invent note timestamps
- retime notes to make them fit
- merge audio
- rewrite the source chart
- duplicate events
- use randomness or an AI model to choose notes

The first version is an authored-note selector and validator: “play both characters as one difficult chart,” not “turn on every note in the JSON.”
