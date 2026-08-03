# Practice engine backpolish

Rhythm Input Lab's Practice engine keeps its neutral 4K–9K chart model, saved attempts, ranges, looping, hazards, and configurable judgments. This pass changes how the playfield obtains time, timestamps input, and presents note feedback.

## Goals

- Make input judgments depend on the input event timestamp rather than the previous animation frame.
- Keep audio authoritative without making note movement visibly inherit coarse audio-position updates.
- Derive every note position from authored note time minus the current conductor time.
- Give receptors separate pressed and confirmed-hit feedback.
- Clip successful sustain heads at the receptor and keep authored tails attached to their exact end time.
- Recover safely from focus loss and large timing jumps.

This is an engine-feel pass. It does not replace the shared-results/statistics project planned for the next Practice phase.

## Conductor clock

The browser audio element remains the long-term authority while audio is playing. The Practice conductor samples that position, extrapolates between samples with `performance.now()`, and applies bounded drift correction. Large seeks or discontinuities re-anchor immediately.

Without audio, the same clock advances from a monotonic performance-time anchor and the selected Practice speed.

Input events convert their own `event.timeStamp` into song time. This lets a press or release retain when it happened even when rendering is delayed by a busy frame.

## Input reconciliation

The existing Practice handler still creates the local press and note state. The backpolish layer immediately reconciles that result against the precise event time:

- press timestamps are corrected
- the nearest eligible lane note is resolved again
- judgments and offsets are corrected
- sustain ownership follows the corrected note
- non-ghost extra inputs are retained explicitly
- the live Practice statistics are rebuilt from note states after a correction

The later full statistics-unification pass will replace this local rebuild with the same shared result document used by Visualizer, Analysis, saved attempts, and reports.

## Rendering

The final canvas pass redraws the playfield after the legacy renderer, using the conductor time. It keeps the existing RIL note atlases and multi-key layouts while adding:

- time-based spawning and removal
- hit-head cleanup
- fading missed notes
- sustain clipping at the receptor after a successful head hit
- dimmed tails after an early release
- pressed receptor feedback
- short confirmed-hit pulses
- existing atlas note splashes driven by the corrected hit time

## Focus and pause behavior

Losing focus or hiding the page pauses Practice, closes open press durations at the current conductor time, releases visual keys, clears active sustain ownership, and leaves no key visually stuck.

## Source reference

The user-supplied Friday Night Funkin' source was studied for its conductor delta, precise input timestamps, receptor animation states, and sustain behavior. Rhythm Input Lab's implementation is independently written in JavaScript for its neutral 4K–9K runtime. See `THIRD_PARTY_NOTICES.md` and `third_party/Funkin_LICENSE.md`.
