"use strict";

(() => {
  const STORAGE_KEY = "ril-practice-polish:v1";
  const SPEEDS = [0.5, 0.75, 0.9, 1, 1.25];
  const runtime = {
    engine: null,
    practice: null,
    installed: false,
    bypassClick: false,
    countdown: null,
    countdownFrame: 0,
    countdownToken: 0,
    loopTimer: 0,
    loopAttempt: null,
    observedAttempt: null,
    observedFolder: null,
    hasStarted: false,
    activeStats: null,
    sessionBySong: new Map(),
    subtitleFolder: null,
  };

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

  function readSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return parsed && typeof parsed === "object" ? { countdown: parsed.countdown !== false } : { countdown: true };
    } catch (_) {
      return { countdown: true };
    }
  }

  const settings = readSettings();

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    catch (_) {}
  }

  function practiceVisible() {
    return q("#view-practice")?.classList.contains("active");
  }

  function typingTarget(target) {
    return Boolean(target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable));
  }

  function normalizeKey(value, code = "") {
    if (code === "Space" || value === " ") return "space";
    return String(value || "").trim().toLowerCase();
  }

  function boundLaneKey(key) {
    return Boolean(runtime.practice?.keyToLane?.has(key));
  }

  function audioNodes() {
    return [q("#instrumentalAudio"), q("#vocalsAudio")].filter(Boolean);
  }

  function readyAudioNodes() {
    return audioNodes().filter(audio => {
      const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
      return Boolean(window.state?.viz?.audioReady?.[kind] && audio.src);
    });
  }

  function pauseAudio() {
    for (const audio of audioNodes()) audio.pause();
  }

  function prepareAudio(startMs) {
    const target = Math.max(0, Number(startMs || 0)) / 1000;
    for (const audio of readyAudioNodes()) {
      audio.pause();
      audio.playbackRate = Number(runtime.practice?.speed || 1);
      try { audio.currentTime = target; } catch (_) {}
    }
  }

  function alignAudioAfterStart() {
    setTimeout(() => {
      const p = runtime.practice;
      if (!p?.playing) return;
      const rows = readyAudioNodes();
      const primary = rows.find(audio => audio.id === "instrumentalAudio") || rows[0];
      if (!primary) return;
      for (const audio of rows) {
        audio.playbackRate = Number(p.speed || 1);
        if (audio !== primary && Math.abs(audio.currentTime - primary.currentTime) > 0.025) {
          try { audio.currentTime = primary.currentTime; } catch (_) {}
        }
        if (audio.paused) audio.play().catch(() => {});
      }
    }, 90);
  }

  function formatTime(ms, digits = 3) {
    if (runtime.engine?.formatPracticeTime) return runtime.engine.formatPracticeTime(Math.max(0, Number(ms || 0)), digits);
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(digits).padStart(digits + 3, "0")}`;
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${rest}s`;
    return `${rest}s`;
  }

  function formatNumber(value, digits = 1) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";
  }

  function accuracy(stats) {
    if (runtime.engine?.accuracy) return runtime.engine.accuracy(stats);
    const hits = Number(stats?.hits || 0);
    const misses = Number(stats?.misses || 0);
    return hits + misses ? Number(stats?.weighted || 0) / (hits + misses) * 100 : null;
  }

  function median(values) {
    const rows = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!rows.length) return null;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  }

  function standardDeviation(values, mean) {
    if (!values.length) return null;
    const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  function showCountdownLabel(label, detail = "") {
    const overlay = q("#practiceCountdownOverlay");
    if (!overlay) return;
    overlay.innerHTML = `<b>${label}</b>${detail ? `<small>${detail}</small>` : ""}`;
    overlay.classList.add("active");
  }

  function hideCountdownLabel(delay = 0) {
    const overlay = q("#practiceCountdownOverlay");
    if (!overlay) return;
    if (delay) {
      setTimeout(() => {
        if (!runtime.countdown) overlay.classList.remove("active");
      }, delay);
    } else {
      overlay.classList.remove("active");
    }
  }

  function updateCountdownTransport(currentMs) {
    const p = runtime.practice;
    if (!p) return;
    const duration = Math.max(1, Number(p.durationMs || 0));
    const clamped = Math.max(0, Math.min(duration, Number(currentMs || 0)));
    const playhead = q("#practicePlayhead");
    const current = q("#practiceCurrentTime");
    const seek = q("#practiceSeek");
    if (playhead) playhead.style.left = `${clamped / duration * 100}%`;
    if (current) current.textContent = currentMs < 0 ? `-${formatTime(-currentMs)}` : formatTime(currentMs);
    if (seek) seek.value = String(clamped / duration * 1000);
  }

  function finishCountdown(button, token) {
    if (!runtime.countdown || runtime.countdown.token !== token) return;
    const p = runtime.practice;
    const leadIn = Number(runtime.countdown.leadInMs || 0);
    runtime.countdown = null;
    cancelAnimationFrame(runtime.countdownFrame);
    runtime.countdownFrame = 0;
    if (!p?.bundle || !practiceVisible()) {
      hideCountdownLabel();
      return;
    }
    p.currentMs = Number(p.startMs || 0);
    if (window.state?.viz) window.state.viz.currentMs = p.currentMs;
    updateCountdownTransport(p.currentMs);
    prepareAudio(p.startMs);
    showCountdownLabel("GO!", `${formatTime(p.startMs)} → ${formatTime(p.endMs)}`);
    runtime.bypassClick = true;
    const previousLeadIn = Number(p.leadInMs || leadIn);
    p.leadInMs = 0;
    button.disabled = false;
    try { button.click(); }
    finally {
      p.leadInMs = previousLeadIn;
      runtime.bypassClick = false;
    }
    runtime.hasStarted = true;
    runtime.activeStats = p.stats;
    alignAudioAfterStart();
    hideCountdownLabel(260);
  }

  function beginCountdown(kind = "start", preferredButton = null) {
    const p = runtime.practice;
    if (!p?.bundle) {
      window.toast?.("Choose a chart first.", "error");
      return;
    }
    cancelCountdown({ silent: true, resetPosition: false });
    clearTimeout(p.restartTimer);
    p.restartTimer = null;
    clearTimeout(runtime.loopTimer);
    runtime.loopTimer = 0;
    p.playing = false;
    pauseAudio();
    p.activeLanes?.clear?.();
    p.heldNotes?.clear?.();
    p.openPresses?.clear?.();
    qa(".practice-key.active").forEach(node => node.classList.remove("active"));
    const button = preferredButton || q(kind === "retry" ? "#practiceRetryButton" : "#practiceStartButton") || q("#practiceStartButton");
    if (!button) return;
    const leadInMs = Math.max(350, Math.min(5000, Number(p.leadInMs || 1500)));
    const token = ++runtime.countdownToken;
    const startedAt = performance.now();
    runtime.countdown = { token, kind, button, leadInMs, startedAt };
    runtime.hasStarted = false;
    prepareAudio(p.startMs);

    const frame = now => {
      if (!runtime.countdown || runtime.countdown.token !== token) return;
      const elapsed = Math.max(0, now - startedAt);
      const remaining = Math.max(0, leadInMs - elapsed);
      p.currentMs = Number(p.startMs || 0) - remaining;
      if (window.state?.viz) window.state.viz.currentMs = p.currentMs;
      updateCountdownTransport(p.currentMs);
      const phase = Math.min(2, Math.floor(elapsed / Math.max(1, leadInMs / 3)));
      const label = String(3 - phase);
      const reason = kind === "loop" ? "Next loop" : kind === "retry" ? "Retry" : "Ready";
      showCountdownLabel(label, `${reason} · ${Math.ceil(remaining)} ms`);
      if (elapsed >= leadInMs) {
        finishCountdown(button, token);
        return;
      }
      runtime.countdownFrame = requestAnimationFrame(frame);
    };
    runtime.countdownFrame = requestAnimationFrame(frame);
    updateStateUi();
  }

  function cancelCountdown({ silent = false, resetPosition = true } = {}) {
    const p = runtime.practice;
    if (!runtime.countdown) return false;
    runtime.countdown = null;
    runtime.countdownToken += 1;
    cancelAnimationFrame(runtime.countdownFrame);
    runtime.countdownFrame = 0;
    pauseAudio();
    if (p && resetPosition) {
      p.currentMs = Number(p.startMs || 0);
      if (window.state?.viz) window.state.viz.currentMs = p.currentMs;
      updateCountdownTransport(p.currentMs);
    }
    hideCountdownLabel();
    if (!silent) window.toast?.("Count-in cancelled.");
    updateStateUi();
    return true;
  }

  function primaryAudio() {
    const rows = readyAudioNodes();
    return rows.find(audio => audio.id === "instrumentalAudio") || rows[0] || null;
  }

  function audioStatusText() {
    const rows = readyAudioNodes();
    if (!rows.length) return "Silent playback";
    if (rows.length === 1) return `${rows[0].id === "vocalsAudio" ? "Vocals" : "Instrumental"} ready`;
    const primary = primaryAudio();
    const other = rows.find(audio => audio !== primary);
    if (!primary || !other) return "Audio ready";
    const drift = (other.currentTime - primary.currentTime) * 1000;
    return `Track drift ${drift >= 0 ? "+" : ""}${Math.round(drift)} ms`;
  }

  function timingAt(ms) {
    const metadata = runtime.practice?.bundle?.song_metadata || {};
    const points = Array.isArray(metadata.timing_points) ? metadata.timing_points : [];
    let bpm = Number(runtime.practice?.bundle?.summary?.base_bpm || 0);
    let sv = 1;
    for (const point of points) {
      if (Number(point.time_ms || 0) > ms) break;
      if (point.uninherited && Number(point.bpm) > 0) bpm = Number(point.bpm);
      if (!point.uninherited && Number(point.sv_multiplier) > 0) sv = Number(point.sv_multiplier);
    }
    return { bpm, sv };
  }

  function activeBreak(ms) {
    const metadata = runtime.practice?.bundle?.song_metadata || {};
    const breaks = Array.isArray(metadata.breaks) ? metadata.breaks : [];
    return breaks.find(row => ms >= Number(row.start_ms || 0) && ms < Number(row.end_ms || 0)) || null;
  }

  function sourceText() {
    const summary = runtime.practice?.bundle?.summary || {};
    const format = String(summary.source_format || summary.format || "chart");
    if (format === "osu_mania") {
      const mapper = summary.charter ? `mapped by ${summary.charter}` : "osu!mania";
      const difficulty = summary.difficulty ? ` · ${summary.difficulty}` : "";
      return `${mapper}${difficulty}`;
    }
    if (format.includes("fnf") || format.includes("psych")) return "FNF source chart";
    if (format.includes("ril")) return "Portable RIL chart";
    return format.replaceAll("_", " ");
  }

  function currentStateLabel() {
    const p = runtime.practice;
    if (!p?.bundle) return ["No chart", "neutral"];
    if (runtime.countdown) return ["Count-in", "countdown"];
    if (p.playing) {
      const pause = activeBreak(Number(p.currentMs || 0));
      return pause ? ["Break", "break"] : ["Playing", "playing"];
    }
    if (p.finished) return ["Result", "result"];
    if (runtime.hasStarted) return ["Paused", "paused"];
    return ["Ready", "ready"];
  }

  function updateStateUi() {
    const p = runtime.practice;
    const stateNode = q("#practiceRunState");
    const sourceNode = q("#practiceSourceStatus");
    const timingNode = q("#practiceTimingStatus");
    const audioNode = q("#practicePolishAudioStatus");
    const [label, className] = currentStateLabel();
    if (stateNode) {
      stateNode.textContent = label;
      stateNode.className = `practice-run-state ${className}`;
    }
    if (sourceNode) sourceNode.textContent = sourceText();
    const timing = timingAt(Number(p?.currentMs || 0));
    const pause = activeBreak(Number(p?.currentMs || 0));
    if (timingNode) {
      timingNode.textContent = pause
        ? `Break · ${((Number(pause.end_ms) - Number(p.currentMs || 0)) / 1000).toFixed(1)}s left`
        : `BPM ${formatNumber(timing.bpm, 2)} · SV ${formatNumber(timing.sv, 2)}×`;
    }
    if (audioNode) audioNode.textContent = audioStatusText();

    const countdownButton = q("#practiceCountdownToggle");
    if (countdownButton) {
      countdownButton.textContent = `Countdown ${settings.countdown ? "on" : "off"}`;
      countdownButton.classList.toggle("primary", settings.countdown);
    }

    const start = q("#practiceStartButton");
    const pauseButton = q("#practicePauseButton");
    const retry = q("#practiceRetryButton");
    if (!p || !start || !pauseButton || !retry) return;
    const hasAudio = readyAudioNodes().length > 0;
    if (runtime.countdown) {
      start.disabled = true;
      retry.disabled = true;
      pauseButton.disabled = false;
      pauseButton.textContent = "Cancel countdown";
      return;
    }
    if (!p.bundle) {
      start.disabled = true;
      retry.disabled = true;
      pauseButton.disabled = true;
      return;
    }
    if (p.playing) {
      start.disabled = true;
      retry.disabled = false;
      pauseButton.disabled = false;
      pauseButton.textContent = "Pause";
      start.textContent = "Playing";
    } else if (p.finished) {
      start.disabled = false;
      retry.disabled = false;
      pauseButton.disabled = true;
      pauseButton.textContent = "Resume";
      start.textContent = "Start new run";
    } else if (runtime.hasStarted) {
      start.disabled = false;
      retry.disabled = false;
      pauseButton.disabled = false;
      pauseButton.textContent = "Resume";
      start.textContent = "Restart range";
    } else {
      start.disabled = false;
      retry.disabled = !p.lastAttempt;
      pauseButton.disabled = true;
      pauseButton.textContent = "Resume";
      start.textContent = hasAudio ? "Start practice" : "Start without audio";
    }
  }

  function currentSongSession() {
    const folder = runtime.practice?.songFolder || "";
    if (!runtime.sessionBySong.has(folder)) {
      runtime.sessionBySong.set(folder, { attempts: 0, accuracyTotal: 0, accuracyCount: 0, bestAccuracy: null, bestCombo: 0, timeMs: 0 });
    }
    return runtime.sessionBySong.get(folder);
  }

  function persistentSongStats() {
    const folder = runtime.practice?.songFolder;
    if (!folder) return { attempts: 0, best: null, average: null, timeMs: 0 };
    try {
      const store = JSON.parse(localStorage.getItem("ril-practice-comfort:v1") || "null");
      const rows = Array.isArray(store?.attempts) ? store.attempts.filter(row => row.songFolder === folder) : [];
      const accuracies = rows.map(row => {
        const direct = Number(row.accuracy);
        if (Number.isFinite(direct)) return direct;
        return accuracy(row.stats);
      }).filter(Number.isFinite);
      const timeMs = rows.reduce((total, row) => {
        const direct = Number(row.practiceTimeMs ?? row.durationMs);
        if (Number.isFinite(direct)) return total + direct;
        const range = Math.max(0, Number(row.endMs || 0) - Number(row.startMs || 0));
        return total + range / Math.max(0.01, Number(row.speed || 1));
      }, 0);
      return {
        attempts: rows.length,
        best: accuracies.length ? Math.max(...accuracies) : null,
        average: accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null,
        timeMs,
      };
    } catch (_) {
      return { attempts: 0, best: null, average: null, timeMs: 0 };
    }
  }

  function attemptMetrics(attempt) {
    const stats = attempt?.stats || {};
    const deltas = Array.isArray(stats.deltas) ? stats.deltas.map(Number).filter(Number.isFinite) : [];
    const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
    const spread = mean === null ? null : standardDeviation(deltas, mean);
    const medianAbs = median(deltas.map(Math.abs));
    const hits = Number(stats.hits || 0);
    const misses = Number(stats.misses || 0);
    const hitRate = hits + misses ? hits / (hits + misses) * 100 : null;
    const rangeMs = Math.max(0, Number(attempt?.endMs || 0) - Number(attempt?.startMs || 0));
    const notes = (runtime.practice?.notes || []).filter(note => {
      const time = Number(note.time_ms || 0);
      return time >= Number(attempt?.startMs || 0) && time < Number(attempt?.endMs || 0);
    }).length;
    const density = rangeMs ? notes / (rangeMs / 1000) : null;
    const fullCombo = misses === 0 && Number(stats.extras || 0) === 0 && Number(stats.holdDrops || 0) === 0 && Number(stats.hazardsHit || 0) === 0;
    return { mean, spread, medianAbs, hitRate, rangeMs, notes, density, fullCombo };
  }

  function metricCell(label, value) {
    return `<div><span>${label}</span><b>${value}</b></div>`;
  }

  function renderRunData() {
    const root = q("#practicePolishRunData");
    if (!root) return;
    const attempt = runtime.practice?.lastAttempt;
    const session = currentSongSession();
    const history = persistentSongStats();
    if (!attempt) {
      root.innerHTML = '<div class="list-sub">Finish a run to populate timing spread, hit rate, density, and session totals.</div>';
      return;
    }
    const metrics = attemptMetrics(attempt);
    const value = accuracy(attempt.stats);
    root.innerHTML = `
      <div class="practice-polish-data-grid">
        ${metricCell("Mean offset", metrics.mean === null ? "—" : `${metrics.mean >= 0 ? "+" : ""}${formatNumber(metrics.mean, 1)} ms`)}
        ${metricCell("Timing spread", metrics.spread === null ? "—" : `${formatNumber(metrics.spread, 1)} ms σ`)}
        ${metricCell("Median |offset|", metrics.medianAbs === null ? "—" : `${formatNumber(metrics.medianAbs, 1)} ms`)}
        ${metricCell("Hit rate", metrics.hitRate === null ? "—" : `${formatNumber(metrics.hitRate, 2)}%`)}
        ${metricCell("Chart density", metrics.density === null ? "—" : `${formatNumber(metrics.density, 2)} NPS`)}
        ${metricCell("Run result", metrics.fullCombo ? "FC" : `${formatNumber(attempt.stats?.misses || 0, 0)} misses`)}
      </div>
      <div class="practice-polish-session-grid">
        <div><span>This session</span><b>${session.attempts} run${session.attempts === 1 ? "" : "s"} · ${session.bestAccuracy === null ? "—" : `${formatNumber(session.bestAccuracy, 2)}% best`} · ${formatDuration(session.timeMs)}</b></div>
        <div><span>Local history</span><b>${history.attempts} run${history.attempts === 1 ? "" : "s"} · ${history.best === null ? "—" : `${formatNumber(history.best, 2)}% best`} · ${formatDuration(history.timeMs)}</b></div>
        <div><span>Current run</span><b>${value === null ? "—" : `${formatNumber(value, 2)}%`} · ${metrics.notes} chart notes · ${formatDuration(metrics.rangeMs / Math.max(0.01, Number(attempt.speed || 1)))}</b></div>
      </div>`;
  }

  function observeAttempt() {
    const p = runtime.practice;
    const attempt = p?.lastAttempt;
    if (!attempt?.completedAt || attempt.completedAt === runtime.observedAttempt) return;
    runtime.observedAttempt = attempt.completedAt;
    runtime.hasStarted = false;
    const session = currentSongSession();
    const value = accuracy(attempt.stats);
    session.attempts += 1;
    if (Number.isFinite(value)) {
      session.accuracyTotal += value;
      session.accuracyCount += 1;
      session.bestAccuracy = session.bestAccuracy === null ? value : Math.max(session.bestAccuracy, value);
    }
    session.bestCombo = Math.max(session.bestCombo, Number(attempt.stats?.maxCombo || 0));
    session.timeMs += Math.max(0, Number(attempt.endMs || 0) - Number(attempt.startMs || 0)) / Math.max(0.01, Number(attempt.speed || 1));
    renderRunData();
    showResultActions(true);
  }

  function showResultActions(show) {
    const bar = q("#practicePolishResultActions");
    if (!bar) return;
    bar.classList.toggle("active", Boolean(show && runtime.practice?.lastAttempt));
  }

  function rebuildNeutralSections() {
    const p = runtime.practice;
    const rows = Array.isArray(p?.bundle?.sections) ? p.bundle.sections : [];
    if (!p?.bundle || !rows.some(row => Number.isFinite(Number(row.time_ms)))) return;
    const sorted = rows
      .map((row, index) => ({ row, index, startMs: Math.max(0, Number(row.time_ms || 0)) }))
      .sort((a, b) => a.startMs - b.startMs || a.index - b.index);
    const sections = sorted.map((item, position) => ({
      index: Number.isFinite(Number(item.row.section_index)) ? Number(item.row.section_index) : item.index,
      startMs: item.startMs,
      endMs: position + 1 < sorted.length ? sorted[position + 1].startMs : Number(p.durationMs || item.startMs),
      noteCount: 0,
      bpm: Number(item.row.bpm || p.bundle.summary?.base_bpm || 0),
    }));
    const byIndex = new Map(sections.map(section => [section.index, section]));
    for (const note of p.notes || []) {
      const section = byIndex.get(Number(note.section_index));
      if (section) section.noteCount += 1;
    }
    p.sections = sections;
    const select = q("#practiceSectionSelect");
    if (select) {
      const previous = select.value;
      select.innerHTML = sections.map(section => `<option value="${section.index}">Timing ${section.index + 1} · ${formatTime(section.startMs, 2)} · ${section.noteCount} notes · ${formatNumber(section.bpm, 2)} BPM</option>`).join("");
      if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
  }

  function updateSongPresentation() {
    const p = runtime.practice;
    if (!p?.bundle || !p.songFolder || runtime.subtitleFolder === p.songFolder) return;
    runtime.subtitleFolder = p.songFolder;
    rebuildNeutralSections();
    const summary = p.bundle.summary || {};
    const subtitle = q("#practiceSubtitle");
    if (subtitle) {
      const details = [
        `${p.keyCount}K`,
        `${formatNumber(summary.base_bpm, 2)} BPM`,
        `${formatNumber((p.notes || []).length, 0)} playable notes`,
      ];
      if (summary.source_format === "osu_mania") {
        if (summary.difficulty) details.push(summary.difficulty);
        if (summary.charter) details.push(`mapped by ${summary.charter}`);
      }
      subtitle.textContent = details.join(" · ");
    }
  }

  function speedStep(delta) {
    const p = runtime.practice;
    if (!p?.bundle) return;
    const current = Number(p.speed || 1);
    let index = SPEEDS.reduce((best, value, candidate) => Math.abs(value - current) < Math.abs(SPEEDS[best] - current) ? candidate : best, 0);
    index = Math.max(0, Math.min(SPEEDS.length - 1, index + delta));
    const button = qa(".practice-speed").find(node => Math.abs(Number(node.dataset.speed) - SPEEDS[index]) < 0.001);
    button?.click();
    window.toast?.(`Practice speed ${Math.round(SPEEDS[index] * 100)}%.`);
  }

  function installUi() {
    if (runtime.installed || !q("#view-practice")) return false;
    const wrap = q(".practice-canvas-wrap");
    const audioStatus = q("#practiceAudioStatus");
    const toggleRow = q(".practice-toggle-row");
    const lastAttemptBlock = q("#practiceJudgmentBreakdown")?.closest(".inspector-block");
    if (!wrap || !audioStatus || !toggleRow || !lastAttemptBlock) return false;

    const countdown = document.createElement("div");
    countdown.id = "practiceCountdownOverlay";
    countdown.className = "practice-countdown-overlay";
    wrap.appendChild(countdown);

    const resultActions = document.createElement("div");
    resultActions.id = "practicePolishResultActions";
    resultActions.className = "practice-polish-result-actions";
    resultActions.innerHTML = '<button class="button small primary" id="practicePolishRetry">Retry <kbd>R</kbd></button><button class="button small" id="practicePolishReview">Review</button>';
    wrap.appendChild(resultActions);

    const status = document.createElement("div");
    status.id = "practicePolishStatus";
    status.className = "practice-polish-status";
    status.innerHTML = '<span id="practiceRunState" class="practice-run-state neutral">No chart</span><span id="practiceSourceStatus">Chart source</span><span id="practiceTimingStatus">BPM — · SV —</span><span id="practicePolishAudioStatus">Silent playback</span>';
    audioStatus.after(status);

    const countdownButton = document.createElement("button");
    countdownButton.id = "practiceCountdownToggle";
    countdownButton.className = "button small primary";
    countdownButton.addEventListener("click", () => {
      settings.countdown = !settings.countdown;
      saveSettings();
      if (!settings.countdown) cancelCountdown({ silent: true });
      updateStateUi();
    });
    toggleRow.appendChild(countdownButton);

    const dataBlock = document.createElement("div");
    dataBlock.className = "inspector-block practice-polish-data";
    dataBlock.innerHTML = '<div class="practice-inspector-heading"><h3>Run data</h3><span class="list-sub">Descriptive only</span></div><div id="practicePolishRunData"></div>';
    lastAttemptBlock.after(dataBlock);

    q("#practicePolishRetry")?.addEventListener("click", () => q("#practiceRetryButton")?.click());
    q("#practicePolishReview")?.addEventListener("click", () => q("#practiceReviewButton")?.click());

    const style = document.createElement("style");
    style.id = "practicePolishStyles";
    style.textContent = `
      .practice-countdown-overlay{position:absolute;inset:0;z-index:8;display:grid;place-items:center;align-content:center;gap:8px;pointer-events:none;opacity:0;transform:scale(.94);transition:opacity .08s ease,transform .12s ease;background:radial-gradient(circle at center,rgba(7,10,18,.18),rgba(7,10,18,.68));text-align:center}.practice-countdown-overlay.active{opacity:1;transform:scale(1)}.practice-countdown-overlay b{font-size:clamp(64px,13vw,150px);line-height:.85;font-weight:1000;letter-spacing:-.07em;text-shadow:0 8px 35px #000}.practice-countdown-overlay small{font-size:12px;font-weight:800;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
      .practice-polish-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--line);font-size:10px;color:var(--muted);background:rgba(255,255,255,.012)}.practice-polish-status>span:not(:first-child){padding-left:8px;border-left:1px solid var(--line)}.practice-run-state{padding:4px 8px;border:1px solid var(--line);border-radius:999px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.practice-run-state.ready{color:#69f0ae;border-color:rgba(105,240,174,.35)}.practice-run-state.playing{color:var(--accent);border-color:rgba(117,230,255,.35)}.practice-run-state.countdown{color:#ffd166;border-color:rgba(255,209,102,.4)}.practice-run-state.paused,.practice-run-state.result{color:#cdb8ff;border-color:rgba(205,184,255,.35)}.practice-run-state.break{color:#ffcf86;border-color:rgba(255,207,134,.4)}
      .practice-polish-result-actions{position:absolute;z-index:9;left:50%;bottom:18px;display:flex;gap:8px;transform:translate(-50%,18px);opacity:0;pointer-events:none;transition:opacity .14s ease,transform .14s ease}.practice-polish-result-actions.active{opacity:1;transform:translate(-50%,0);pointer-events:auto}.practice-polish-result-actions kbd{margin-left:4px;padding:1px 4px;border:1px solid var(--line);border-radius:4px;font:inherit;font-size:9px}
      .practice-toggle-row{grid-template-columns:repeat(3,minmax(0,1fr))}.practice-polish-data-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.practice-polish-data-grid>div{display:flex;flex-direction:column;gap:3px;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.02)}.practice-polish-data-grid span,.practice-polish-session-grid span{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.practice-polish-data-grid b{font-size:12px}.practice-polish-session-grid{display:grid;gap:7px;margin-top:8px}.practice-polish-session-grid>div{display:flex;flex-direction:column;gap:3px;padding:8px 9px;border-left:2px solid rgba(117,230,255,.25);background:rgba(255,255,255,.012)}.practice-polish-session-grid b{font-size:11px}
      @media(max-width:760px){.practice-polish-status>span{border-left:0!important;padding-left:0!important}.practice-toggle-row{grid-template-columns:1fr}.practice-polish-data-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    runtime.installed = true;
    updateStateUi();
    renderRunData();
    return true;
  }

  function updateHelp() {
    const help = q("#practiceControlsHelp");
    const p = runtime.practice;
    if (!help || !p) return;
    const keys = (p.laneKeys || []).map(key => String(key).toUpperCase()).join(" · ");
    help.textContent = `${p.keyCount}K: ${keys} · Enter start · P/Escape pause · R retry · L loop · -/+ speed · [ / ] seek 1s (Shift 5s) · Home/End range edges`;
  }

  function monitorLoopRestart() {
    const p = runtime.practice;
    const completedAt = p?.lastAttempt?.completedAt;
    if (!settings.countdown || !p?.finished || !p.loopEnabled || !p.restartTimer || !completedAt || runtime.loopAttempt === completedAt) return;
    runtime.loopAttempt = completedAt;
    clearTimeout(p.restartTimer);
    p.restartTimer = null;
    clearTimeout(runtime.loopTimer);
    runtime.loopTimer = setTimeout(() => {
      runtime.loopTimer = 0;
      if (p.loopEnabled && p.finished && practiceVisible()) beginCountdown("loop", q("#practiceRetryButton"));
    }, 850);
  }

  function poll() {
    const engine = window.rilPracticeEngine;
    if (engine?.practice) {
      runtime.engine = engine;
      runtime.practice = engine.practice;
      installUi();
      const p = runtime.practice;
      if (runtime.observedFolder !== p.songFolder) {
        runtime.observedFolder = p.songFolder;
        runtime.observedAttempt = null;
        runtime.hasStarted = false;
        runtime.activeStats = p.stats;
        runtime.subtitleFolder = null;
        runtime.loopAttempt = null;
        cancelCountdown({ silent: true });
        showResultActions(false);
        setTimeout(rebuildNeutralSections, 0);
      }
      if (p.playing && !runtime.countdown) {
        runtime.hasStarted = true;
        runtime.activeStats = p.stats;
        showResultActions(false);
      }
      if (p.finished) runtime.hasStarted = false;
      if (!practiceVisible() && runtime.countdown) cancelCountdown({ silent: true });
      observeAttempt();
      monitorLoopRestart();
      updateSongPresentation();
      updateStateUi();
      updateHelp();
      if (p.lastAttempt && p.lastAttempt.completedAt === runtime.observedAttempt) renderRunData();
    }
    setTimeout(poll, 100);
  }

  window.addEventListener("keydown", event => {
    const p = runtime.practice;
    if (!p || !practiceVisible() || typingTarget(event.target)) return;
    const key = normalizeKey(event.key, event.code);
    if (runtime.countdown) {
      if (key === "escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelCountdown();
      } else if (key === "enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (key === "enter" && settings.countdown && p.bundle && !p.playing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      beginCountdown(p.finished || p.lastAttempt ? "retry" : "start", p.finished ? q("#practiceRetryButton") : q("#practiceStartButton"));
      return;
    }
    if (boundLaneKey(key)) return;
    if (key === "l") {
      event.preventDefault();
      event.stopImmediatePropagation();
      q("#practiceLoopToggle")?.click();
    } else if (key === "-" || key === "_") {
      event.preventDefault();
      event.stopImmediatePropagation();
      speedStep(-1);
    } else if (key === "=" || key === "+") {
      event.preventDefault();
      event.stopImmediatePropagation();
      speedStep(1);
    } else if ((key === "[" || key === "]") && event.shiftKey && !p.playing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta = key === "[" ? -5000 : 5000;
      runtime.engine.seekPractice(Number(p.currentMs || 0) + delta);
    } else if (key === "home" && !p.playing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runtime.engine.seekPractice(Number(p.startMs || 0));
    } else if (key === "end" && !p.playing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runtime.engine.seekPractice(Math.max(Number(p.startMs || 0), Number(p.endMs || 0) - 1));
    } else if ((key === "," || key === ".") && !p.playing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      q(key === "," ? "#practicePreviousSection" : "#practiceNextSection")?.click();
    }
  }, true);

  document.addEventListener("click", event => {
    const p = runtime.practice;
    const button = event.target.closest?.("#practiceStartButton,#practiceRetryButton");
    if (button && !runtime.bypassClick && settings.countdown && p?.bundle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      beginCountdown(button.id === "practiceRetryButton" ? "retry" : "start", button);
      return;
    }
    const pause = event.target.closest?.("#practicePauseButton");
    if (!pause || !p?.bundle) return;
    if (runtime.countdown) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelCountdown();
    } else if (!p.playing && !runtime.hasStarted && !p.finished && settings.countdown) {
      event.preventDefault();
      event.stopImmediatePropagation();
      beginCountdown("start", q("#practiceStartButton"));
    }
  }, true);

  document.addEventListener("change", event => {
    if (event.target?.id === "practiceSongSelect") cancelCountdown({ silent: true });
  }, true);

  window.rilPracticePolish = {
    beginCountdown,
    cancelCountdown,
    rebuildNeutralSections,
    settings,
    sessionBySong: runtime.sessionBySong,
  };

  poll();
})();
