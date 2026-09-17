"use strict";

(() => {
  const ENGINE_VERSION = "1";
  const q = (selector, root = document) => root.querySelector(selector);
  const weights = { Sick: 1, Good: 0.75, Bad: 0.5, Shit: 0.25 };
  const runtime = {
    installed: false,
    practice: null,
    anchorSongMs: 0,
    anchorPerfMs: 0,
    lastSongMs: 0,
    lastTickPerfMs: 0,
    lastPlaying: false,
    lastSpeed: 1,
    songFolder: null,
    sortedNotes: [],
    lateCursor: 0,
    handledPresses: new Set(),
    extraPresses: new Map(),
    laneFx: new Map(),
    focusPaused: false,
    lastStatsRevision: 0,
    lastPressArray: null,
  };

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  function engineApi() {
    return window.rilPracticeEngine || null;
  }

  function practiceVisible() {
    return q("#view-practice")?.classList.contains("active");
  }

  function audioElements() {
    return [q("#instrumentalAudio"), q("#vocalsAudio")].filter(Boolean);
  }

  function hasPlayableAudio(audio) {
    return Boolean(audio && (audio.currentSrc || audio.src) && Number.isFinite(audio.currentTime));
  }

  function primaryAudio() {
    const rows = audioElements().filter(hasPlayableAudio);
    return rows.find(audio => audio.id === "instrumentalAudio") || rows[0] || null;
  }

  function normalizeEventPerfMs(event) {
    const stamp = Number(event?.timeStamp);
    if (!Number.isFinite(stamp)) return performance.now();
    if (stamp > 1_000_000_000_000) return stamp - performance.timeOrigin;
    return stamp;
  }

  function speed() {
    return clamp(runtime.practice?.speed || 1, 0.05, 4);
  }

  function reanchor(songMs = runtime.practice?.currentMs || 0, perfMs = performance.now()) {
    runtime.anchorSongMs = Number(songMs || 0);
    runtime.anchorPerfMs = Number(perfMs || performance.now());
    runtime.lastSongMs = runtime.anchorSongMs;
    runtime.lastTickPerfMs = runtime.anchorPerfMs;
  }

  function extrapolatedClock(perfMs = performance.now()) {
    return runtime.anchorSongMs + (perfMs - runtime.anchorPerfMs) * speed();
  }

  function eventSongTime(event) {
    const practice = runtime.practice;
    if (!practice) return 0;
    const eventPerfMs = normalizeEventPerfMs(event);
    const nowPerfMs = performance.now();
    const audio = primaryAudio();
    let value;
    if (practice.playing && audio && !audio.paused && hasPlayableAudio(audio)) {
      value = audio.currentTime * 1000 + (eventPerfMs - nowPerfMs) * Number(audio.playbackRate || speed());
    } else if (practice.playing) {
      value = extrapolatedClock(eventPerfMs);
    } else {
      value = practice.currentMs;
    }
    return clamp(value, 0, Math.max(practice.durationMs || 0, practice.endMs || 0));
  }

  function sampleClock(now = performance.now()) {
    const practice = runtime.practice;
    if (!practice) return 0;
    const changedSong = runtime.songFolder !== practice.songFolder;
    const changedPlayState = runtime.lastPlaying !== Boolean(practice.playing);
    const changedSpeed = Math.abs(runtime.lastSpeed - speed()) > 0.0001;
    const jumped = Math.abs(Number(practice.currentMs || 0) - Number(runtime.lastSongMs || 0)) > 250;
    if (changedSong) {
      runtime.songFolder = practice.songFolder;
      runtime.sortedNotes = [...(practice.notes || [])].sort((a, b) => Number(a.time_ms) - Number(b.time_ms));
      runtime.lateCursor = 0;
      runtime.handledPresses.clear();
      runtime.extraPresses.clear();
      runtime.laneFx.clear();
      reanchor(practice.currentMs, now);
    }
    if (changedPlayState || changedSpeed || jumped || !runtime.anchorPerfMs) reanchor(practice.currentMs, now);

    if (runtime.lastPressArray !== practice.presses) {
      runtime.lastPressArray = practice.presses;
      runtime.handledPresses.clear();
      runtime.extraPresses.clear();
      runtime.lateCursor = 0;
    } else if ((practice.presses || []).length === 0 && runtime.handledPresses.size) {
      runtime.handledPresses.clear();
      runtime.extraPresses.clear();
      runtime.lateCursor = 0;
    }

    runtime.lastPlaying = Boolean(practice.playing);
    runtime.lastSpeed = speed();
    if (!practice.playing) {
      reanchor(practice.currentMs, now);
      return practice.currentMs;
    }

    const predicted = extrapolatedClock(now);
    const audio = primaryAudio();
    let value = predicted;
    if (audio && !audio.paused && hasPlayableAudio(audio)) {
      const audioMs = audio.currentTime * 1000;
      const drift = audioMs - predicted;
      if (Math.abs(drift) > 90 || !Number.isFinite(predicted)) {
        value = audioMs;
      } else {
        value = predicted + clamp(drift * 0.24, -5, 5);
      }
    }

    const maxPosition = Math.max(practice.durationMs || 0, practice.endMs || 0);
    value = clamp(value, 0, maxPosition);
    if (value + 2 < runtime.lastSongMs && Math.abs(value - practice.currentMs) < 120) value = runtime.lastSongMs;
    reanchor(value, now);
    practice.currentMs = value;
    if (window.state?.viz) window.state.viz.currentMs = value;
    return value;
  }

  function chartWindows() {
    try {
      if (typeof getChartWindows === "function") return getChartWindows();
    } catch (_) {}
    const settings = window.state?.settings?.judgments || {};
    return {
      sick: Number(settings.sick_ms || 45),
      good: Number(settings.good_ms || 90),
      bad: Number(settings.bad_ms || 135),
      shit: Number(settings.shit_ms || 180),
      outer: Number(settings.outer_ms || settings.shit_ms || 180),
    };
  }

  function judgmentForDelta(delta) {
    try {
      if (typeof judgmentFor === "function") return judgmentFor(delta);
    } catch (_) {}
    const windows = chartWindows();
    const absolute = Math.abs(delta);
    if (absolute <= windows.sick) return "Sick";
    if (absolute <= windows.good) return "Good";
    if (absolute <= windows.bad) return "Bad";
    return "Shit";
  }

  function hazard(note) {
    try {
      if (typeof isHazardNote === "function") return isHazardNote(note);
    } catch (_) {}
    return /hurt|mine|hazard/i.test(String(note?.note_type || ""));
  }

  function noteEnd(note) {
    return Number(note?.end_ms ?? Number(note?.time_ms || 0) + Number(note?.sustain_ms || 0));
  }

  function laneForEvent(event) {
    const practice = runtime.practice;
    if (!practice) return null;
    const key = event.code === "Space" || event.key === " "
      ? "space"
      : String(event.key || "").trim().toLowerCase();
    const lane = practice.keyToLane?.get(key);
    return Number.isInteger(lane) ? lane : null;
  }

  function noteStateByPress(pressId) {
    const practice = runtime.practice;
    if (!practice) return null;
    for (const note of practice.notes || []) {
      const state = practice.noteStates.get(note._practiceId);
      if (state?.pressId === pressId) return { note, state };
    }
    return null;
  }

  function candidateFor(lane, atMs, pressId) {
    const practice = runtime.practice;
    if (!practice) return null;
    const outer = chartWindows().outer;
    let best = null;
    for (const note of practice.notes || []) {
      if (Number(note.lane) !== lane) continue;
      const time = Number(note.time_ms);
      if (time < practice.startMs || time >= practice.endMs) continue;
      const state = practice.noteStates.get(note._practiceId);
      if (state && state.pressId !== pressId) continue;
      const delta = atMs - time;
      if (Math.abs(delta) > outer) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { note, delta, state };
    }
    return best;
  }

  function updateLaneFx(lane, patch) {
    const current = runtime.laneFx.get(lane) || {};
    runtime.laneFx.set(lane, { ...current, ...patch });
  }

  function rebuildStats() {
    const practice = runtime.practice;
    if (!practice) return null;
    const result = {
      hits: 0,
      misses: 0,
      extras: runtime.extraPresses.size,
      holdDrops: 0,
      hazardsHit: 0,
      hazardsAvoided: 0,
      combo: 0,
      maxCombo: 0,
      weighted: 0,
      early: 0,
      late: 0,
      deltas: [],
      accuracyTimeline: [],
      judgments: { Sick: 0, Good: 0, Bad: 0, Shit: 0 },
    };
    const timeline = [];
    for (const note of practice.notes || []) {
      const time = Number(note.time_ms);
      if (time < practice.startMs || time >= practice.endMs) continue;
      const state = practice.noteStates.get(note._practiceId);
      if (!state) continue;
      if (state.status === "hit") {
        const judgment = state.judgment || judgmentForDelta(Number(state.delta || 0));
        result.hits += 1;
        result.judgments[judgment] = Number(result.judgments[judgment] || 0) + 1;
        result.weighted += weights[judgment] ?? 0;
        result.deltas.push(Number(state.delta || 0));
        if (Number(state.delta || 0) < 0) result.early += 1;
        else result.late += 1;
        timeline.push({ time: Number(state.hitAt ?? time), kind: "hit", judgment });
      } else if (state.status === "missed") {
        result.misses += 1;
        timeline.push({ time: Number(state.judgedAt ?? time), kind: "miss", judgment: "Miss" });
      } else if (state.status === "hazard-hit") {
        result.hazardsHit += 1;
        result.misses += 1;
        timeline.push({ time: Number(state.hitAt ?? time), kind: "miss", judgment: "Hurt" });
      } else if (state.status === "hazard-safe") {
        result.hazardsAvoided += 1;
      }
      if (state.holdDropped) {
        result.holdDrops += 1;
        timeline.push({ time: Number(state.holdDropAt ?? noteEnd(note)), kind: "break", judgment: "Hold drop" });
      }
    }
    for (const extra of runtime.extraPresses.values()) {
      timeline.push({ time: extra.time_ms, kind: "miss", judgment: "Extra" });
      result.misses += 1;
    }
    timeline.sort((a, b) => a.time - b.time || (a.kind === "hit" ? -1 : 1));
    let combo = 0;
    let cumulativeHits = 0;
    let cumulativeMisses = 0;
    let cumulativeWeighted = 0;
    for (const event of timeline) {
      if (event.kind === "hit") {
        combo += 1;
        cumulativeHits += 1;
        cumulativeWeighted += weights[event.judgment] ?? 0;
      } else {
        combo = 0;
        if (event.kind === "miss") cumulativeMisses += 1;
      }
      result.maxCombo = Math.max(result.maxCombo, combo);
      const total = cumulativeHits + cumulativeMisses;
      if (total) {
        result.accuracyTimeline.push({
          time_ms: clamp(event.time, practice.startMs, practice.endMs),
          accuracy: cumulativeWeighted / total * 100,
          label: event.judgment,
          hits: cumulativeHits,
          misses: cumulativeMisses,
        });
      }
    }
    result.combo = combo;
    if (!practice.stats) practice.stats = result;
    else Object.assign(practice.stats, result);
    runtime.lastStatsRevision += 1;
    renderHud();
    return practice.stats;
  }

  function accuracy(stats = runtime.practice?.stats) {
    if (!stats) return null;
    const total = Number(stats.hits || 0) + Number(stats.misses || 0);
    return total ? Number(stats.weighted || 0) / total * 100 : null;
  }

  function renderHud() {
    const stats = runtime.practice?.stats;
    if (!stats) return;
    const value = accuracy(stats);
    const accuracyNode = q("#practiceLiveAccuracy");
    const comboNode = q("#practiceLiveCombo");
    const missNode = q("#practiceLiveMisses");
    const gradeNode = q("#practiceLiveGrade");
    if (accuracyNode) accuracyNode.textContent = value === null ? "—" : `${value.toFixed(2)}%`;
    if (comboNode) comboNode.textContent = String(stats.combo || 0);
    if (missNode) missNode.textContent = String(stats.misses || 0);
    if (gradeNode) gradeNode.textContent = value === null ? "—" : value >= 98 ? "S" : value >= 93 ? "A" : value >= 85 ? "B" : value >= 75 ? "C" : value >= 60 ? "D" : "F";
  }

  function preciseKeyDown(event) {
    const practice = runtime.practice;
    if (!practiceVisible() || !practice?.playing || event.repeat) return;
    const lane = laneForEvent(event);
    if (!Number.isInteger(lane)) return;
    const atMs = eventSongTime(event);
    updateLaneFx(lane, { pressedAt: performance.now(), releasedAt: 0 });
    let press = null;
    for (let index = (practice.presses || []).length - 1; index >= 0; index -= 1) {
      const row = practice.presses[index];
      if (Number(row.lane) === lane && !runtime.handledPresses.has(row.id)) {
        press = row;
        break;
      }
    }
    if (!press) return;
    runtime.handledPresses.add(press.id);
    press.time_ms = atMs;

    const previous = noteStateByPress(press.id);
    const candidate = candidateFor(lane, atMs, press.id);
    if (previous && (!candidate || candidate.note._practiceId !== previous.note._practiceId)) {
      practice.noteStates.delete(previous.note._practiceId);
      if (practice.heldNotes?.get(lane)?._practiceId === previous.note._practiceId) practice.heldNotes.delete(lane);
    }

    if (!candidate) {
      if (practice.ghostTapping === false) runtime.extraPresses.set(press.id, { time_ms: atMs, lane });
      rebuildStats();
      return;
    }

    runtime.extraPresses.delete(press.id);
    const { note, delta } = candidate;
    if (hazard(note)) {
      practice.noteStates.set(note._practiceId, { status: "hazard-hit", hitAt: atMs, judgedAt: atMs, delta, pressId: press.id });
      updateLaneFx(lane, { confirmAt: performance.now(), judgment: "Hurt" });
      practice.lastJudgment = "Hurt";
      practice.lastDelta = delta;
      practice.judgmentUntil = performance.now() + 600;
    } else {
      const judgment = judgmentForDelta(delta);
      practice.noteStates.set(note._practiceId, { status: "hit", hitAt: atMs, judgedAt: atMs, delta, judgment, pressId: press.id });
      if (Number(note.sustain_ms || 0) > 0) practice.heldNotes.set(lane, note);
      updateLaneFx(lane, { confirmAt: performance.now(), judgment });
      practice.lastJudgment = judgment;
      practice.lastDelta = delta;
      practice.judgmentUntil = performance.now() + 600;
    }
    if (runtime.practice) runtime.practice.currentMs = atMs;
    rebuildStats();
  }

  function preciseKeyUp(event) {
    const practice = runtime.practice;
    if (!practiceVisible() || !practice) return;
    const lane = laneForEvent(event);
    if (!Number.isInteger(lane)) return;
    const atMs = eventSongTime(event);
    updateLaneFx(lane, { releasedAt: performance.now() });
    let press = null;
    for (let index = (practice.presses || []).length - 1; index >= 0; index -= 1) {
      const row = practice.presses[index];
      if (Number(row.lane) === lane && row.held_ms !== null && row.held_ms !== undefined) {
        press = row;
        break;
      }
    }
    if (press) press.held_ms = Math.max(0, atMs - Number(press.time_ms || atMs));

    const held = practice.heldNotes?.get(lane);
    if (held) {
      const state = practice.noteStates.get(held._practiceId) || {};
      const outer = chartWindows().outer;
      const dropped = atMs < noteEnd(held) - outer;
      if (dropped) {
        state.holdDropped = true;
        state.holdDropAt = atMs;
      } else {
        state.holdDropped = false;
        delete state.holdDropAt;
        state.holdComplete = true;
      }
      practice.noteStates.set(held._practiceId, state);
    }
    rebuildStats();
  }

  function processLateNotes(nowMs) {
    const practice = runtime.practice;
    if (!practice?.bundle || !practice.stats) return;
    const notes = runtime.sortedNotes;
    const outer = chartWindows().outer;
    if (!notes.length) return;
    if (runtime.lateCursor > 0 && Number(notes[runtime.lateCursor - 1]?.time_ms || 0) > nowMs) runtime.lateCursor = 0;
    let changed = false;
    while (runtime.lateCursor < notes.length) {
      const note = notes[runtime.lateCursor];
      const time = Number(note.time_ms);
      if (time + outer >= nowMs) break;
      runtime.lateCursor += 1;
      if (time < practice.startMs || time >= practice.endMs || practice.noteStates.has(note._practiceId)) continue;
      practice.noteStates.set(note._practiceId, hazard(note)
        ? { status: "hazard-safe", judgedAt: time + outer }
        : { status: "missed", judgedAt: time + outer });
      changed = true;
    }
    for (const [lane, note] of practice.heldNotes || []) {
      if (nowMs < noteEnd(note)) continue;
      const state = practice.noteStates.get(note._practiceId) || {};
      state.holdComplete = true;
      practice.noteStates.set(note._practiceId, state);
      practice.heldNotes.delete(lane);
      changed = true;
    }
    if (changed) rebuildStats();
  }

  function drawBackpolishedPractice(now = performance.now()) {
    const practice = runtime.practice;
    const canvas = q("#practiceCanvas");
    if (!practiceVisible() || !practice?.bundle || !canvas) return;
    if (typeof drawNote !== "function" || typeof drawHold !== "function" || typeof drawReceptor !== "function") return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(rect.width * dpr));
    const targetHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = rect.width;
    const height = rect.height;
    const current = practice.currentMs;
    const keyCount = practice.keyCount;
    const fieldWidth = Math.min(width - 42, keyCount * 94);
    const startX = (width - fieldWidth) / 2;
    const laneGap = 1;
    const laneWidth = (fieldWidth - laneGap * (keyCount - 1)) / keyCount;
    const receptorY = practice.downscroll ? height - 82 : 82;
    const direction = practice.downscroll ? -1 : 1;
    const pixelsPerMs = 0.43 * practice.scrollScale;
    const aheadDistance = practice.downscroll ? receptorY - 20 : height - receptorY - 20;
    const aheadMs = (aheadDistance + 140) / pixelsPerMs;
    const behindMs = 320 / pixelsPerMs;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(117,230,255,.04)");
    gradient.addColorStop(0.5, "rgba(255,255,255,.008)");
    gradient.addColorStop(1, "rgba(169,140,255,.04)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    if (typeof roundRect === "function") roundRect(ctx, startX, 18, fieldWidth, height - 36, 16);
    else ctx.rect(startX, 18, fieldWidth, height - 36);
    ctx.fillStyle = "rgba(2,4,10,.76)";
    ctx.fill();
    ctx.clip();
    for (let lane = 0; lane < keyCount; lane += 1) {
      const x = startX + lane * (laneWidth + laneGap);
      ctx.fillStyle = lane % 2 ? "rgba(255,255,255,.028)" : "rgba(255,255,255,.014)";
      ctx.fillRect(x, 18, laneWidth, height - 36);
      ctx.strokeStyle = "rgba(255,255,255,.055)";
      ctx.strokeRect(x, 18, laneWidth, height - 36);
    }
    ctx.strokeStyle = "rgba(117,230,255,.82)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, receptorY);
    ctx.lineTo(startX + fieldWidth, receptorY);
    ctx.stroke();

    const visible = (practice.notes || []).filter(note => {
      const time = Number(note.time_ms);
      const end = noteEnd(note);
      const state = practice.noteStates.get(note._practiceId);
      const linger = state?.status === "missed" ? 280 : 100;
      return end >= current - behindMs && time <= current + aheadMs && time >= practice.startMs - 1 && time < practice.endMs && current <= Math.max(end, time) + behindMs + linger;
    });
    const previousViewMode = window.state?.viz?.viewMode;
    if (window.state?.viz) window.state.viz.viewMode = "chart";

    for (const note of visible) {
      if (Number(note.sustain_ms || 0) <= 0) continue;
      const state = practice.noteStates.get(note._practiceId);
      if (state?.holdComplete && current > noteEnd(note) + 80) continue;
      const lane = Number(note.lane);
      const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
      let y1 = receptorY + direction * (Number(note.time_ms) - current) * pixelsPerMs;
      const y2 = receptorY + direction * (noteEnd(note) - current) * pixelsPerMs;
      let alpha = 0.82;
      if (state?.status === "hit" && current >= Number(note.time_ms)) {
        if (!state.holdDropped) y1 = receptorY;
        else {
          y1 = receptorY + direction * (Number(state.holdDropAt || current) - current) * pixelsPerMs;
          alpha = 0.38;
        }
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      drawHold(ctx, lane, cx, laneWidth * 0.48, y1, y2, 1, note);
      ctx.restore();
    }

    for (const note of visible) {
      const lane = Number(note.lane);
      const state = practice.noteStates.get(note._practiceId);
      const hitAge = state?.status === "hit" ? current - Number(state.hitAt || note.time_ms) : -1;
      if (state?.status === "hit" && hitAge > 75) continue;
      if (state?.status === "hazard-safe" && current - Number(state.judgedAt || note.time_ms) > 80) continue;
      const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
      const y = receptorY + direction * (Number(note.time_ms) - current) * pixelsPerMs;
      const size = Math.min(laneWidth * 0.94, 86);
      let status = hazard(note) ? "hazard" : "normal";
      let alpha = 1;
      if (state?.status === "hit") status = "matched";
      if (state?.status === "missed") {
        status = "missed";
        alpha = clamp(1 - (current - Number(state.judgedAt || note.time_ms)) / 280, 0.1, 0.55);
      }
      if (state?.status === "hazard-hit") status = "hazard-hit";
      if (state?.status === "hazard-safe") status = "hazard-safe";
      drawNote(ctx, lane, cx, y, size, status, alpha, note);
    }

    for (let lane = 0; lane < keyCount; lane += 1) {
      const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
      const size = Math.min(laneWidth * 0.94, 86);
      const active = practice.activeLanes.has(lane);
      drawReceptor(ctx, lane, cx, receptorY, size, active, 1);
      const fx = runtime.laneFx.get(lane) || {};
      const confirmAge = now - Number(fx.confirmAt || -10_000);
      const pressAge = now - Number(fx.pressedAt || -10_000);
      if (confirmAge >= 0 && confirmAge < 165) {
        const pulse = 1 - confirmAge / 165;
        ctx.save();
        ctx.globalAlpha = pulse * 0.9;
        ctx.strokeStyle = fx.judgment === "Hurt" ? "#ff6b8a" : "#ffffff";
        ctx.lineWidth = 2 + pulse * 3;
        ctx.beginPath();
        ctx.arc(cx, receptorY, size * (0.46 + pulse * 0.12), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (active && pressAge >= 0 && pressAge < 500) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#75e6ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, receptorY, size * 0.43, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (window.state?.viz?.showSplashes !== false && typeof drawAtlasSplash === "function") {
      for (const note of visible) {
        const state = practice.noteStates.get(note._practiceId);
        if (state?.status !== "hit") continue;
        const age = current - Number(state.hitAt);
        if (age < 0 || age > 265) continue;
        const lane = Number(note.lane);
        const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
        drawAtlasSplash(ctx, lane, cx, receptorY, Math.min(laneWidth * 0.94, 86), age, state.judgment, note, false);
      }
    }
    if (window.state?.viz) window.state.viz.viewMode = previousViewMode;
    ctx.restore();

    ctx.fillStyle = "rgba(117,230,255,.82)";
    ctx.font = "800 11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`${practice.keyCount}K · ${Math.round(speed() * 100)}% · precise clock`, startX + 10, practice.downscroll ? height - 27 : 37);
    ctx.textAlign = "right";
    ctx.fillText(`${practice.completedLoops || 0} loop${practice.completedLoops === 1 ? "" : "s"}`, startX + fieldWidth - 10, practice.downscroll ? height - 27 : 37);

    if (practice.lastJudgment && now <= practice.judgmentUntil) {
      const fade = clamp((practice.judgmentUntil - now) / 600, 0, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = "center";
      ctx.fillStyle = /Miss|Hurt|Hold drop/.test(practice.lastJudgment) ? "#ff6b8a" : "#f5f7ff";
      ctx.font = "900 31px system-ui";
      ctx.fillText(practice.lastJudgment, width / 2, height / 2 - 10);
      if (practice.lastDelta !== null) {
        ctx.font = "800 13px ui-monospace, monospace";
        ctx.fillStyle = practice.lastDelta < 0 ? "#75e6ff" : "#ffd166";
        ctx.fillText(`${practice.lastDelta >= 0 ? "+" : ""}${Math.round(practice.lastDelta)} ms`, width / 2, height / 2 + 17);
      }
      ctx.restore();
    }
  }

  function ensureBadge() {
    const wrap = q(".practice-canvas-wrap");
    if (!wrap || q("#practiceEngineBackpolishBadge")) return;
    const badge = document.createElement("div");
    badge.id = "practiceEngineBackpolishBadge";
    badge.textContent = "Precise input · conductor clock";
    wrap.appendChild(badge);
    const style = document.createElement("style");
    style.id = "practiceEngineBackpolishStyles";
    style.textContent = `
      #practiceEngineBackpolishBadge{position:absolute;right:10px;top:10px;z-index:3;padding:5px 8px;border:1px solid rgba(117,230,255,.25);border-radius:999px;background:rgba(3,6,12,.72);color:rgba(117,230,255,.9);font:800 9px/1 system-ui;letter-spacing:.06em;text-transform:uppercase;pointer-events:none;backdrop-filter:blur(8px)}
    `;
    document.head.appendChild(style);
  }

  function pauseForFocusLoss() {
    const practice = runtime.practice;
    if (!practice?.playing) return;
    const atMs = eventSongTime(null);
    for (const press of practice.openPresses?.values?.() || []) press.held_ms = Math.max(0, atMs - Number(press.time_ms || atMs));
    practice.openPresses?.clear?.();
    practice.activeLanes?.clear?.();
    practice.heldNotes?.clear?.();
    runtime.laneFx.clear();
    runtime.focusPaused = true;
    q("#practicePauseButton")?.click();
    const overlay = q("#practiceOverlay");
    if (overlay) {
      overlay.innerHTML = "Paused<small>Focus was lost. Resume when ready.</small>";
      overlay.classList.remove("hidden");
    }
  }

  function tick(now) {
    const practice = runtime.practice;
    if (practice) {
      const current = sampleClock(now);
      if (practice.playing) processLateNotes(current);
      ensureBadge();
      drawBackpolishedPractice(now);
    }
    requestAnimationFrame(tick);
  }

  function install() {
    if (runtime.installed) return true;
    const api = engineApi();
    if (!api?.practice) return false;
    runtime.installed = true;
    runtime.practice = api.practice;
    reanchor(runtime.practice.currentMs, performance.now());
    window.addEventListener("keydown", preciseKeyDown, true);
    window.addEventListener("keyup", preciseKeyUp, true);
    window.addEventListener("blur", pauseForFocusLoss);
    document.addEventListener("visibilitychange", () => { if (document.hidden) pauseForFocusLoss(); });
    for (const audio of audioElements()) {
      for (const eventName of ["play", "playing", "seeked", "ratechange"]) {
        audio.addEventListener(eventName, () => reanchor(runtime.practice?.currentMs || audio.currentTime * 1000, performance.now()));
      }
    }
    api.backpolish = {
      version: ENGINE_VERSION,
      eventSongTime,
      sampleClock,
      rebuildStats,
      draw: drawBackpolishedPractice,
      diagnostics: runtime,
    };
    requestAnimationFrame(tick);
    ensureBadge();
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  setTimeout(install, 0);
})();
