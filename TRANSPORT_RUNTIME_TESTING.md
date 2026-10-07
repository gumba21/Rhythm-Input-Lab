# Transport and runtime verification — 5.0.0-dev

The automated transport tests prove ownership and stale-operation behavior with deterministic fake media elements. They do **not** prove perceptual browser audio synchronization, decoder behavior, OS audio latency, or real-device frame pacing.

Use this checklist for hands-on validation before 5.0 leaves development.

## Diagnostics

Practice → Diagnostics shows:

- transport lifecycle
- session and operation generation
- loaded stem count
- current drift
- drift-correction count
- stale async-operation drops
- measured Practice render FPS
- active rendered note count

The same raw counters are available in the browser console through:

```js
rilRenderDiagnostics.transport()
rilRenderDiagnostics.practice()
rilRenderDiagnostics.visualizer()
```

Gameplay timing remains conductor/transport-clock based. FPS is observational only.

## Required scenarios

1. Load a song with separate instrumental and vocals. Start normally and confirm the stems remain perceptually locked.
2. Pause and resume repeatedly at arbitrary points. No stem should continue alone or resume from a different position.
3. While paused, seek to several positions and resume. All stems should start from the selected position together.
4. Seek while playing in both Practice and Visualizer. Playback should resume coherently without a stale pre-seek start.
5. Change playback speed several times while playing and paused. Stems should remain locked and the logical playhead should remain continuous.
6. Retry/restart repeatedly, including immediately after a result. No pending prior start should fire after the retry.
7. Loop a short Practice range for several repetitions with count-in enabled and disabled. Each loop should create one coherent start.
8. Finish a song and immediately select another. Live score, combo, grade, result headline, graph, playhead, range state, and transport state must belong to the new song only.
9. Finish a song, open Results, then switch songs. The old Results surface must close/clear while historical attempts remain accessible in history.
10. Switch songs from Ready, Count-in, and Paused. The previous song must stop owning timers/media immediately.
11. Rapidly switch A → B → A. The final A must have a newer session generation; late callbacks from the first A or B must not change media or UI.
12. Leave Practice or Visualizer while audio is active and return. Audio must stop on leave and must not resume without an explicit user action.
13. Test instrumental-only, instrumental + primary vocals, and charts with multiple vocal stems. Mixer behavior and shared vocals level must remain intact.
14. Let a long/dense chart run for several minutes. Watch FPS, active-note count, drift, corrections, and stale-operation count for growth over time.

## Expected transport lifecycle

The shared song transport uses:

```
unloaded
loading
ready
counting-in
playing
paused
seeking
finished
```

A new song always creates a new session generation. Playback-changing operations create a new operation generation. Async media completion from an older operation or session must not restart, reposition, or mutate the replacement session.

## Rendering checks

The 5.0 render audit intentionally keeps timing independent of rendering.

- Practice has one canvas renderer after backpolish installs; the base loop continues core state updates without repainting the canvas.
- Practice and Visualizer use time-window note culling instead of scanning the full chart for every visible frame.
- Visualizer timeline and nearby-event UI update at lower presentation frequencies than the playfield.
- saved-media discovery, multi-vocal discovery, Practice tools, Practice library observation, and workspace composition do not use display-rate RAF polling.
- audio drift diagnostics are sampled rather than rebuilt every frame.

If FPS degrades, capture the three `rilRenderDiagnostics` snapshots before changing timing or increasing update rates.
