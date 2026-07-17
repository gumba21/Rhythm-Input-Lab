"use strict";

(() => {
  const qs = selector => document.querySelector(selector);
  const qsa = selector => [...document.querySelectorAll(selector)];

  function stopVisualizerPlayback() {
    state.viz.playing = false;
    state.viz.lastFrame = 0;
    for (const audio of audioElements()) audio.pause();
    updatePlayButton();
  }

  function installNavigationCleanup() {
    const originalGo = go;
    go = view => {
      if (view !== "visualizer") stopVisualizerPlayback();
      return originalGo(view);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopVisualizerPlayback();
    });
  }

  function installAttemptAutoload() {
    const originalLoadVisualizer = loadVisualizer;
    loadVisualizer = async (songFolder, attemptFolder = null) => {
      stopVisualizerPlayback();
      await originalLoadVisualizer(songFolder, attemptFolder);
      if (attemptFolder || !state.viz.bundle || state.viz.songFolder !== songFolder) return;

      const attemptSelect = qs("#visualizerAttemptSelect");
      const latest = [...(attemptSelect?.options || [])].find(option => option.value);
      if (!latest) {
        state.viz.viewMode = "chart";
        if (qs("#viewMode")) qs("#viewMode").value = "chart";
        drawVisualizer();
        return;
      }

      attemptSelect.value = latest.value;
      await loadAttemptForCurrent(latest.value);
      state.viz.viewMode = "compare";
      if (qs("#viewMode")) qs("#viewMode").value = "compare";
      drawVisualizer();
    };

    qs("#viewMode")?.addEventListener("change", async event => {
      if (event.target.value !== "compare" || state.viz.attempt) return;
      const attemptSelect = qs("#visualizerAttemptSelect");
      const latest = [...(attemptSelect?.options || [])].find(option => option.value);
      if (!latest) return;
      attemptSelect.value = latest.value;
      await loadAttemptForCurrent(latest.value);
    });
  }

  function removeXrayControls() {
    const themeSelect = qs("#themeMode");
    themeSelect?.querySelector('option[value="xray"]')?.remove();
    if (themeSelect?.value === "xray") themeSelect.value = "fnf";
    qs("#xrayToggle")?.remove();
    state.viz.xray = false;
    state.viz.theme = themeSelect?.value || "fnf";
  }

  function preciseTime(ms) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
  }

  function parsePreciseTime(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    if (text.includes(":")) {
      const parts = text.split(":").map(part => part.trim());
      if (parts.some(part => part === "" || !Number.isFinite(Number(part)))) return null;
      let seconds = 0;
      for (const part of parts) seconds = seconds * 60 + Number(part);
      return seconds * 1000;
    }
    const seconds = Number(text);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  function installPreciseSeeker() {
    const seekRow = qs(".seek-row");
    if (!seekRow || qs("#preciseSeekInput")) return;

    const row = document.createElement("div");
    row.className = "precise-seek-row";
    row.innerHTML = `
      <label for="preciseSeekInput">Precise time</label>
      <input id="preciseSeekInput" class="mono" value="0:00.000" inputmode="decimal" aria-label="Precise seek time in minutes, seconds, and milliseconds">
      <button class="button small precise-nudge" data-ms="-1000">−1s</button>
      <button class="button small precise-nudge" data-ms="-100">−100ms</button>
      <button class="button small precise-nudge" data-ms="-10">−10ms</button>
      <button class="button small precise-nudge" data-ms="10">+10ms</button>
      <button class="button small precise-nudge" data-ms="100">+100ms</button>
      <button class="button small precise-nudge" data-ms="1000">+1s</button>
    `;
    seekRow.after(row);

    const input = qs("#preciseSeekInput");
    const commit = () => {
      const parsed = parsePreciseTime(input.value);
      if (parsed === null) {
        input.value = preciseTime(state.viz.currentMs);
        toast("Use a time like 1:24.283.", "error");
        return;
      }
      seekTo(parsed);
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
        commit();
      }
    });
    qsa(".precise-nudge").forEach(button => button.addEventListener("click", () => {
      seekTo(state.viz.currentMs + Number(button.dataset.ms || 0));
    }));
  }

  function currentComboSnapshot() {
    const comparison = state.viz.comparison;
    if (!comparison || !state.viz.attempt) return null;

    const timeline = [];
    for (const match of comparison.matches || []) {
      timeline.push({
        time: Number(match.press?.time_ms || 0) - state.viz.offsetMs,
        kind: "hit",
        judgment: judgmentFor(match.delta_ms),
        delta: Number(match.delta_ms || 0),
      });
    }
    for (const note of comparison.coveredNotes || []) {
      if (comparison.missedNoteIds?.has(note._id)) {
        timeline.push({ time: Number(note.time_ms || 0), kind: "miss", judgment: "Miss", delta: null });
      }
    }
    for (const hazard of comparison.hazards?.attempts || []) {
      if (hazard.hit) timeline.push({ time: Number(hazard.press?.time_ms || 0) - state.viz.offsetMs, kind: "hazard", judgment: "Hazard", delta: hazard.delta_ms });
    }
    if (!state.viz.ghostTapping) {
      const presses = lanePresses();
      for (const press of presses) {
        if (comparison.extraPressIds?.has(press.id)) {
          timeline.push({ time: Number(press.time_ms || 0) - state.viz.offsetMs, kind: "extra", judgment: "Extra", delta: null });
        }
      }
    }

    const priority = { hit: 0, miss: 1, hazard: 2, extra: 3 };
    timeline.sort((a, b) => a.time - b.time || (priority[a.kind] ?? 9) - (priority[b.kind] ?? 9));
    let combo = 0;
    let last = null;
    let weighted = 0;
    let judged = 0;
    const weights = { Sick: 1, Good: 0.75, Bad: 0.5, Shit: 0.25 };

    for (const item of timeline) {
      if (item.time > state.viz.currentMs + 0.5) break;
      last = item;
      judged += 1;
      if (item.kind === "hit") {
        combo += 1;
        weighted += weights[item.judgment] ?? 0;
      } else {
        combo = 0;
      }
    }

    return {
      combo,
      last,
      accuracy: judged ? weighted / judged * 100 : null,
    };
  }

  function updateComboHud() {
    const hud = qs("#comboHud");
    if (!hud) return;
    const snapshot = currentComboSnapshot();
    if (!snapshot) {
      hud.innerHTML = '<div class="combo-value">—</div><div class="combo-label">estimated combo</div><div class="combo-judgment">No attempt</div>';
      return;
    }

    const last = snapshot.last;
    const delta = last?.delta === null || last?.delta === undefined
      ? ""
      : `${last.delta >= 0 ? "+" : ""}${Math.round(last.delta)} ms`;
    hud.innerHTML = `
      <div class="combo-value">${snapshot.combo}</div>
      <div class="combo-label">estimated combo</div>
      <div class="combo-judgment">${escapeHtml(last?.judgment || "Waiting")}</div>
      <div class="combo-delta mono">${escapeHtml(delta)}</div>
      <div class="combo-accuracy">${snapshot.accuracy === null ? "—" : `${formatNumber(snapshot.accuracy, 2)}%`} so far</div>
    `;
  }

  function installComboHud() {
    const wrap = qs(".visualizer-canvas-wrap");
    if (!wrap || qs("#comboHud")) return;
    const hud = document.createElement("div");
    hud.id = "comboHud";
    hud.className = "combo-hud";
    wrap.appendChild(hud);
    updateComboHud();
  }

  function readyAudio() {
    return audioElements().filter(audio => {
      const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
      return state.viz.audioReady[kind];
    });
  }

  function setAudioTime(audio, seconds) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : seconds;
    const target = Math.max(0, Math.min(seconds, duration || seconds));
    try { audio.currentTime = target; } catch (_) {}
  }

  function installAudioSync() {
    updateAudioStatus = updateAudioDiagnostics;
    syncAudioTracks = force => {
      const tracks = readyAudio();
      if (!tracks.length) return;
      const primary = primaryAudio() || tracks[0];
      const target = force ? state.viz.currentMs / 1000 : primary.currentTime;

      for (const audio of tracks) {
        audio.playbackRate = state.viz.playbackRate;
        const threshold = force ? 0.001 : 0.012;
        if (force || Math.abs(audio.currentTime - target) > threshold) setAudioTime(audio, target);
      }
    };

    const originalTogglePlayback = togglePlayback;
    togglePlayback = () => {
      const willPlay = !state.viz.playing;
      if (willPlay) syncAudioTracks(true);
      originalTogglePlayback();
      if (willPlay) {
        for (const audio of readyAudio()) {
          if (audio.paused) audio.play().catch(() => {});
        }
      }
    };

    for (const audio of audioElements()) {
      audio.addEventListener("seeking", () => {
        if (!state.viz.playing) return;
        const primary = primaryAudio();
        if (audio === primary) syncAudioTracks(false);
      });
      audio.addEventListener("loadedmetadata", updateAudioDiagnostics);
      audio.addEventListener("durationchange", updateAudioDiagnostics);
      audio.addEventListener("seeked", updateAudioDiagnostics);
    }
  }

  function audioDurationText(audio) {
    return Number.isFinite(audio?.duration) ? preciseTime(audio.duration * 1000) : "—";
  }

  function updateAudioDiagnostics() {
    const target = qs("#audioStatus");
    if (!target) return;
    const inst = qs("#instrumentalAudio");
    const vocals = qs("#vocalsAudio");
    const instReady = Boolean(state.viz.audioReady.instrumental);
    const vocalsReady = Boolean(state.viz.audioReady.vocals);
    const pieces = [
      `Instrumental: ${state.viz.audioNames.instrumental || "none"}${instReady ? ` (${audioDurationText(inst)})` : ""}`,
      `Vocals: ${state.viz.audioNames.vocals || "none"}${vocalsReady ? ` (${audioDurationText(vocals)})` : ""}`,
    ];
    if (instReady && vocalsReady) {
      const drift = Math.round(Math.abs(inst.currentTime - vocals.currentTime) * 1000);
      const lengthDifference = Number.isFinite(inst.duration) && Number.isFinite(vocals.duration)
        ? Math.round(Math.abs(inst.duration - vocals.duration) * 1000)
        : null;
      pieces.push(`live drift ${drift} ms`);
      if (lengthDifference !== null) pieces.push(`length Δ ${lengthDifference} ms`);
    }
    target.textContent = pieces.join(" · ");
  }

  function installResetCleanup() {
    qs("#resetVisualizerButton")?.addEventListener("click", stopVisualizerPlayback, true);
    qs("#restartButton")?.addEventListener("click", () => syncAudioTracks(true));
  }

  function installStyles() {
    if (qs("#v45PolishStyles")) return;
    const style = document.createElement("style");
    style.id = "v45PolishStyles";
    style.textContent = `
      .visualizer-canvas-wrap{position:relative}
      .precise-seek-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 2px 0}
      .precise-seek-row label{font-size:12px;color:var(--muted);font-weight:700}
      .precise-seek-row input{width:112px;text-align:center}
      .combo-hud{position:absolute;right:14px;top:14px;z-index:4;min-width:132px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:rgba(6,8,16,.82);backdrop-filter:blur(8px);text-align:center;pointer-events:none;box-shadow:0 12px 30px rgba(0,0,0,.24)}
      .combo-value{font-size:32px;font-weight:900;line-height:1}
      .combo-label{margin-top:3px;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
      .combo-judgment{margin-top:11px;font-size:18px;font-weight:900;text-transform:uppercase}
      .combo-delta,.combo-accuracy{margin-top:3px;color:var(--muted);font-size:11px}
      @media(max-width:900px){.combo-hud{right:8px;top:8px;min-width:108px;padding:9px}.combo-value{font-size:25px}}
    `;
    document.head.appendChild(style);
  }

  function wrapUiUpdates() {
    const originalUpdateTimeUI = updateTimeUI;
    updateTimeUI = () => {
      originalUpdateTimeUI();
      const input = qs("#preciseSeekInput");
      if (input && document.activeElement !== input) input.value = preciseTime(state.viz.currentMs);
      updateComboHud();
      updateAudioDiagnostics();
    };

    const originalRecomputeComparison = recomputeComparison;
    recomputeComparison = () => {
      originalRecomputeComparison();
      updateComboHud();
    };

    const originalClearCurrentReplay = clearCurrentReplay;
    clearCurrentReplay = () => {
      stopVisualizerPlayback();
      originalClearCurrentReplay();
      updateComboHud();
    };
  }

  installStyles();
  removeXrayControls();
  installPreciseSeeker();
  installComboHud();
  wrapUiUpdates();
  installNavigationCleanup();
  installAttemptAutoload();
  installAudioSync();
  installResetCleanup();
  updateAudioDiagnostics();
})();
