"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

  // Psych/FNF multi-key lane order. Each value points at the matching A-I
  // atlas group in NOTE_assets.xml.
  const MULTI_LANE_LAYOUTS = {
    4: ["A", "B", "C", "D"],
    5: ["A", "B", "E", "C", "D"],
    6: ["A", "C", "D", "F", "G", "I"],
    7: ["A", "C", "D", "E", "F", "G", "I"],
    8: ["A", "B", "C", "D", "F", "G", "H", "I"],
    9: ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
  };

  const FALLBACK_KEYS = {
    4: ["d", "f", "j", "k"],
    5: ["d", "f", "space", "j", "k"],
    6: ["s", "d", "f", "j", "k", "l"],
    7: ["s", "d", "f", "space", "j", "k", "l"],
    8: ["a", "s", "d", "f", "j", "k", "l", ";"],
    9: ["a", "s", "d", "f", "space", "j", "k", "l", ";"],
  };

  const LETTER_DIRECTIONS = {
    A: "left", B: "down", C: "up", D: "right", E: "space",
    F: "left", G: "down", H: "up", I: "right",
  };

  const atlas = {
    image: new Image(),
    frames: new Map(),
    loaded: false,
  };

  const originalDrawReceptor = drawReceptor;
  const originalDrawReplayInputNote = drawReplayInputNote;
  const originalDrawNote = drawNote;
  const originalDrawHold = drawHold;
  const originalDrawAtlasSplash = drawAtlasSplash;

  function currentKeyCount() {
    const raw = Number(state.viz.bundle?.summary?.key_count || 4);
    return Math.max(4, Math.min(9, Math.round(raw)));
  }

  function laneLetter(lane) {
    const layout = MULTI_LANE_LAYOUTS[currentKeyCount()] || MULTI_LANE_LAYOUTS[4];
    return layout[Number(lane)] || layout[Number(lane) % layout.length] || "A";
  }

  function laneDirection(lane) {
    return LETTER_DIRECTIONS[laneLetter(lane)] || "left";
  }

  function parseAtlas(text) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("NOTE_assets.xml could not be parsed.");
    atlas.frames.clear();
    xml.querySelectorAll("SubTexture").forEach(node => {
      const number = (name, fallback = 0) => {
        const value = Number(node.getAttribute(name));
        return Number.isFinite(value) ? value : fallback;
      };
      atlas.frames.set(node.getAttribute("name") || "", {
        x: number("x"),
        y: number("y"),
        w: number("width"),
        h: number("height"),
        fx: number("frameX"),
        fy: number("frameY"),
        fw: number("frameWidth", number("width")),
        fh: number("frameHeight", number("height")),
      });
    });
  }

  function frame(name) {
    return atlas.frames.get(name) || null;
  }

  function firstFrame(names) {
    for (const name of names) {
      const found = frame(name);
      if (found?.w && found?.h) return found;
    }
    return null;
  }

  function drawCenteredFrame(ctx, source, cx, cy, targetSize, alpha = 1) {
    if (!source?.w || !atlas.loaded) return false;
    const fullW = Math.max(1, source.fw || source.w);
    const fullH = Math.max(1, source.fh || source.h);
    const scale = targetSize / Math.max(fullW, fullH);
    const dx = cx - fullW * scale / 2 - (source.fx || 0) * scale;
    const dy = cy - fullH * scale / 2 - (source.fy || 0) * scale;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.drawImage(atlas.image, source.x, source.y, source.w, source.h, dx, dy, source.w * scale, source.h * scale);
    ctx.restore();
    return true;
  }

  function drawFallbackArrow(ctx, lane, cx, cy, size, active, alpha, diamond = false) {
    const direction = laneDirection(lane);
    const symbols = { left: "←", down: "↓", up: "↑", right: "→", space: "◆" };
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = active ? (laneColors[Number(lane) % laneColors.length] || "#75e6ff") : "rgba(255,255,255,.09)";
    ctx.strokeStyle = laneColors[Number(lane) % laneColors.length] || "#75e6ff";
    ctx.lineWidth = 2;
    roundRect(ctx, cx - size / 2, cy - size / 2, size, size, diamond ? size * .15 : size * .24);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = `900 ${size * .35}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbols[direction], cx, cy + 1);
    ctx.restore();
  }

  function noteFrameForLane(lane) {
    return frame(`${laneLetter(lane)}0000`);
  }

  function receptorFrameForLane(lane, active) {
    const letter = laneLetter(lane);
    if (active) {
      return firstFrame([
        `${letter} press0002`, `${letter} press0000`,
        `${letter} press0003`, `${letter} confirm0000`,
      ]);
    }
    const direction = laneDirection(lane).toUpperCase();
    return frame(`arrow${direction}0000`);
  }

  function confirmFramesForLane(lane) {
    const letter = laneLetter(lane);
    return [...atlas.frames.entries()]
      .filter(([name]) => name.startsWith(`${letter} confirm`))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => value);
  }

  drawReceptor = function drawMultiKeyReceptor(ctx, lane, cx, cy, size, active, alpha) {
    if (state.viz.theme !== "fnf") return originalDrawReceptor(ctx, lane, cx, cy, size, active, alpha);
    const source = receptorFrameForLane(lane, active);
    if (!drawCenteredFrame(ctx, source, cx, cy, size, alpha)) {
      drawFallbackArrow(ctx, lane, cx, cy, size, active, alpha, laneDirection(lane) === "space");
    }
  };

  drawReplayInputNote = function drawMultiKeyReplayInput(ctx, lane, cx, cy, size, alpha) {
    if (state.viz.theme !== "fnf") return originalDrawReplayInputNote(ctx, lane, cx, cy, size, alpha);
    const source = noteFrameForLane(lane);
    if (!drawCenteredFrame(ctx, source, cx, cy, size, alpha)) {
      drawFallbackArrow(ctx, lane, cx, cy, size, true, alpha, laneDirection(lane) === "space");
    }
  };

  drawNote = function drawMultiKeyNote(ctx, lane, cx, cy, size, status, alpha, note) {
    if (isHazardNote(note) || state.viz.theme !== "fnf") {
      return originalDrawNote(ctx, lane, cx, cy, size, status, alpha, note);
    }
    if (state.viz.viewMode === "inputs") return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (status === "missed") { ctx.shadowColor = "#ff6b8a"; ctx.shadowBlur = 18; }
    else if (status === "matched") { ctx.shadowColor = "#69f0ae"; ctx.shadowBlur = 10; }
    const source = noteFrameForLane(lane);
    if (!drawCenteredFrame(ctx, source, cx, cy, size, 1)) {
      drawFallbackArrow(ctx, lane, cx, cy, size, true, 1, laneDirection(lane) === "space");
    }
    if (note?.note_type && state.viz.xray) {
      ctx.fillStyle = "#fff";
      ctx.font = "700 9px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(note.note_type, cx, cy + size * .66);
    }
    ctx.restore();
  };

  drawHold = function drawMultiKeyHold(ctx, lane, cx, width, yStart, yEnd, alpha, note = null) {
    if (note && isHazardNote(note)) return originalDrawHold(ctx, lane, cx, width, yStart, yEnd, alpha, note);
    if (state.viz.theme !== "fnf" || !atlas.loaded) return originalDrawHold(ctx, lane, cx, width, yStart, yEnd, alpha, note);
    const letter = laneLetter(lane);
    const body = frame(`${letter} hold0000`);
    const tail = frame(`${letter} tail0000`);
    if (!body?.w || !tail?.w) return originalDrawHold(ctx, lane, cx, width, yStart, yEnd, alpha, note);

    const top = Math.min(yStart, yEnd);
    const bottom = Math.max(yStart, yEnd);
    const length = Math.max(5, bottom - top);
    const tailHeight = Math.min(length, width * 1.28);
    const bodyHeight = Math.max(4, length - tailHeight * .62);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(atlas.image, body.x, body.y, body.w, body.h, cx - width / 2, top, width, bodyHeight);
    ctx.drawImage(atlas.image, tail.x, tail.y, tail.w, tail.h, cx - width / 2, bottom - tailHeight, width, tailHeight);
    ctx.restore();
  };

  drawAtlasSplash = function restoreNoteSplashes(ctx, lane, cx, cy, receptorSize, ageMs, judgment, seedObject, useHurt = false) {
    return originalDrawAtlasSplash(ctx, lane, cx, cy, receptorSize, ageMs, judgment, seedObject, useHurt);
  };

  async function loadNewNoteAtlas() {
    try {
      const response = await fetch("/assets/NOTE_assets.xml", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      parseAtlas(await response.text());
      atlas.image.src = `/assets/NOTE_assets.png?v=multi-${Date.now()}`;
      atlas.image.onload = () => {
        atlas.loaded = true;
        if (typeof drawVisualizer === "function") drawVisualizer();
        window.dispatchEvent(new Event("resize"));
      };
      atlas.image.onerror = () => console.warn("Could not load the multi-key NOTE_assets.png atlas.");
    } catch (error) {
      console.warn("Could not load the multi-key note atlas", error);
    }
  }

  function normalizeShortcutKey(value, code = "") {
    if (code === "Space" || value === " ") return "space";
    return String(value || "").trim().toLowerCase();
  }

  function isTypingTarget(target) {
    return Boolean(target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable));
  }

  function currentBoundKeys() {
    const count = currentKeyCount();
    const profile = state.settings?.profiles?.[String(count)];
    const keys = Array.isArray(profile?.keys) && profile.keys.length === count ? profile.keys : (FALLBACK_KEYS[count] || []);
    const result = new Set(keys.map(key => normalizeShortcutKey(key)));
    if (count === 4) ["arrowleft", "arrowdown", "arrowup", "arrowright"].forEach(key => result.add(key));
    return result;
  }

  function formatHotfixTime(ms) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
  }

  function parseHotfixTime(value) {
    const parts = String(value || "").trim().split(":").map(Number);
    if (!parts.length || parts.some(value => !Number.isFinite(value))) return null;
    return Math.max(0, parts.reduce((total, value) => total * 60 + value, 0) * 1000);
  }

  function extendRangeForCrossingHolds() {
    const startInput = q("#practiceStartTime");
    const endInput = q("#practiceEndTime");
    if (!startInput || !endInput || !state.viz.bundle) return false;
    const start = parseHotfixTime(startInput.value);
    const requestedEnd = parseHotfixTime(endInput.value);
    if (start === null || requestedEnd === null) return false;
    let adjustedEnd = requestedEnd;
    for (const note of state.viz.bundle.notes || []) {
      if (note.owner !== "player" || Number(note.sustain_ms || 0) <= 0) continue;
      const noteStart = Number(note.time_ms || 0);
      const noteEnd = Number(note.end_ms ?? noteStart + Number(note.sustain_ms || 0));
      if (noteStart >= start && noteStart < requestedEnd && noteEnd > adjustedEnd) adjustedEnd = noteEnd;
    }
    const duration = Number(state.viz.bundle.summary?.duration_ms || adjustedEnd);
    adjustedEnd = Math.min(duration, adjustedEnd);
    if (adjustedEnd <= requestedEnd + 1) return false;
    endInput.value = formatHotfixTime(adjustedEnd);
    return true;
  }

  function loadMixerSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem("ril-practice-mixer") || "null");
      return saved && typeof saved === "object" ? saved : {};
    } catch (_) {
      return {};
    }
  }

  function saveMixerSettings(values) {
    localStorage.setItem("ril-practice-mixer", JSON.stringify(values));
  }

  function installPracticeHotfixControls() {
    const playbackBlock = q("#practiceLeadIn")?.closest(".inspector-block");
    if (!playbackBlock || q("#practiceHotfixControls")) return;
    const saved = loadMixerSettings();
    const volumes = {
      instrumental: Math.max(0, Math.min(1, Number(saved.instrumental ?? state.viz.audioVolumes?.instrumental ?? 1))),
      vocals: Math.max(0, Math.min(1, Number(saved.vocals ?? state.viz.audioVolumes?.vocals ?? 1))),
    };
    const laneLength = Math.max(420, Math.min(900, Number(saved.laneLength || 620)));

    const controls = document.createElement("div");
    controls.id = "practiceHotfixControls";
    controls.innerHTML = `
      <div class="practice-hotfix-subtitle">Mixer</div>
      <div class="practice-hotfix-mixer">
        <label class="volume-control"><span>Inst</span><input id="practiceInstrumentalVolume" type="range" min="0" max="100" value="${Math.round(volumes.instrumental * 100)}"><b id="practiceInstrumentalVolumeLabel">${Math.round(volumes.instrumental * 100)}%</b></label>
        <button id="practiceClearInstrumental" class="icon-button compact" title="Clear instrumental">×</button>
        <label class="volume-control"><span>Vocals</span><input id="practiceVocalsVolume" type="range" min="0" max="100" value="${Math.round(volumes.vocals * 100)}"><b id="practiceVocalsVolumeLabel">${Math.round(volumes.vocals * 100)}%</b></label>
        <button id="practiceClearVocals" class="icon-button compact" title="Clear vocals">×</button>
      </div>
      <div class="field practice-lane-length-field">
        <label>Lane length <b id="practiceLaneLengthLabel">${laneLength}px</b></label>
        <input id="practiceLaneLength" type="range" min="420" max="900" step="10" value="${laneLength}">
      </div>
    `;
    q(".practice-toggle-row", playbackBlock)?.before(controls);

    const applyVolume = (kind, raw) => {
      const value = Math.max(0, Math.min(1, Number(raw) / 100));
      volumes[kind] = value;
      if (typeof setAudioVolume === "function") setAudioVolume(kind, value * 100);
      else {
        state.viz.audioVolumes[kind] = value;
        const audio = audioElement(kind);
        if (audio) audio.volume = value;
      }
      q(`#practice${kind === "vocals" ? "Vocals" : "Instrumental"}VolumeLabel`).textContent = `${Math.round(value * 100)}%`;
      saveMixerSettings({ ...volumes, laneLength: Number(q("#practiceLaneLength")?.value || laneLength) });
    };

    q("#practiceInstrumentalVolume").addEventListener("input", event => applyVolume("instrumental", event.target.value));
    q("#practiceVocalsVolume").addEventListener("input", event => applyVolume("vocals", event.target.value));
    q("#practiceClearInstrumental").addEventListener("click", () => { clearAudio("instrumental"); updateSharedPracticeAudioStatus(); updateStartButtonLabel(); });
    q("#practiceClearVocals").addEventListener("click", () => { clearAudio("vocals"); updateSharedPracticeAudioStatus(); updateStartButtonLabel(); });

    const applyLaneLength = raw => {
      const value = Math.max(420, Math.min(900, Number(raw || 620)));
      const wrap = q(".practice-canvas-wrap");
      if (wrap) {
        wrap.style.height = `${value}px`;
        wrap.style.maxHeight = "none";
      }
      q("#practiceLaneLengthLabel").textContent = `${value}px`;
      saveMixerSettings({ ...volumes, laneLength: value });
      window.dispatchEvent(new Event("resize"));
    };
    q("#practiceLaneLength").addEventListener("input", event => applyLaneLength(event.target.value));
    applyVolume("instrumental", volumes.instrumental * 100);
    applyVolume("vocals", volumes.vocals * 100);
    applyLaneLength(laneLength);

    const style = document.createElement("style");
    style.id = "practiceHotfixStyles";
    style.textContent = `
      .practice-hotfix-subtitle{margin-top:12px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
      .practice-hotfix-mixer{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;align-items:center;margin-top:7px}
      .practice-hotfix-mixer .volume-control{min-width:0}
      .practice-lane-length-field{margin-top:10px}.practice-lane-length-field label{display:flex;justify-content:space-between;gap:8px}
    `;
    document.head.appendChild(style);
  }

  function updateSharedPracticeAudioStatus() {
    const status = q("#practiceAudioStatus");
    if (!status) return;
    const instrumental = state.viz.audioNames?.instrumental || "none";
    const vocals = state.viz.audioNames?.vocals || "none";
    status.textContent = `Instrumental: ${instrumental} · Vocals: ${vocals}`;
  }

  function updateStartButtonLabel() {
    const button = q("#practiceStartButton");
    if (!button) return;
    const hasAudio = Boolean(state.viz.audioReady?.instrumental || state.viz.audioReady?.vocals);
    button.textContent = hasAudio ? "Start practice" : "Start without audio";
    button.title = hasAudio ? "Start the selected practice range." : "No audio is attached. The chart will still play silently.";
  }

  function installRangeProtection() {
    const endInput = q("#practiceEndTime");
    const startButton = q("#practiceStartButton");
    const retryButton = q("#practiceRetryButton");
    if (!endInput || !startButton || endInput.dataset.holdProtection === "1") return;
    endInput.dataset.holdProtection = "1";

    endInput.addEventListener("change", () => {
      if (extendRangeForCrossingHolds()) {
        queueMicrotask(() => endInput.dispatchEvent(new Event("change", { bubbles: true })));
      }
    }, true);

    const beforeStart = () => {
      if (!extendRangeForCrossingHolds()) return;
      endInput.dispatchEvent(new Event("change", { bubbles: true }));
      toast("Range end was extended so an active hold can finish.");
    };
    startButton.addEventListener("click", beforeStart, true);
    retryButton?.addEventListener("click", beforeStart, true);
  }

  const pressedKeys = new Map();

  function releaseTrackedKeys() {
    for (const { key, code } of pressedKeys.values()) {
      window.dispatchEvent(new KeyboardEvent("keyup", { key, code, bubbles: true }));
    }
    pressedKeys.clear();
  }

  function pauseForFocusLoss() {
    if (!q("#view-practice")?.classList.contains("active")) return;
    releaseTrackedKeys();
    const pause = q("#practicePauseButton");
    if (pause && !pause.disabled && pause.textContent.trim() === "Pause") pause.click();
  }

  function installKeyboardHotfixes() {
    window.addEventListener("keydown", event => {
      if (!q("#view-practice")?.classList.contains("active") || isTypingTarget(event.target)) return;
      const key = normalizeShortcutKey(event.key, event.code);
      if (!event.repeat) pressedKeys.set(event.code || key, { key: event.key, code: event.code });
      const bound = currentBoundKeys();
      if (bound.has(key)) return;

      if (key === "r") {
        event.preventDefault();
        q("#practiceRetryButton")?.click();
      } else if (key === "p" || (key === "space" && !bound.has("space"))) {
        event.preventDefault();
        const pause = q("#practicePauseButton");
        if (pause && !pause.disabled) pause.click();
      } else if (["[", "]", "arrowleft", "arrowright"].includes(key)) {
        const pause = q("#practicePauseButton");
        if (!pause || pause.textContent.trim() !== "Resume") return;
        if ((key === "arrowleft" || key === "arrowright") && bound.has(key)) return;
        event.preventDefault();
        const seek = q("#practiceSeek");
        const duration = Number(state.viz.bundle?.summary?.duration_ms || 0);
        if (!seek || !duration) return;
        const delta = key === "[" || key === "arrowleft" ? -1000 : 1000;
        const current = Number(seek.value || 0) / 1000 * duration;
        seek.value = String(Math.max(0, Math.min(1000, (current + delta) / duration * 1000)));
        seek.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }, true);

    window.addEventListener("keyup", event => pressedKeys.delete(event.code || normalizeShortcutKey(event.key, event.code)), true);
    window.addEventListener("blur", pauseForFocusLoss);
    document.addEventListener("visibilitychange", () => { if (document.hidden) pauseForFocusLoss(); });
  }

  function updateControlsHelp() {
    const help = q("#practiceControlsHelp");
    if (!help) return;
    const original = help.textContent.split(" · P pause")[0];
    help.textContent = `${original} · P pause · R retry · [ / ] seek 1 second while paused`;
  }

  function installObservers() {
    const status = q("#practiceAudioStatus");
    if (status) new MutationObserver(updateStartButtonLabel).observe(status, { childList: true, characterData: true, subtree: true });
    const song = q("#practiceSongSelect");
    song?.addEventListener("change", () => setTimeout(() => {
      installRangeProtection();
      updateControlsHelp();
      updateStartButtonLabel();
    }, 0));
    setInterval(() => {
      updateStartButtonLabel();
      updateControlsHelp();
    }, 750);
  }

  function install() {
    installPracticeHotfixControls();
    installRangeProtection();
    installKeyboardHotfixes();
    installObservers();
    updateStartButtonLabel();
    updateControlsHelp();
    loadNewNoteAtlas();
  }

  install();
})();
