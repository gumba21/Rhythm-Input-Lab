"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const weights = { Sick: 1, Good: 0.75, Bad: 0.5, Shit: 0.25 };
  const fallbackKeys = {
    4: ["d", "f", "j", "k"],
    5: ["d", "f", "space", "j", "k"],
    6: ["s", "d", "f", "j", "k", "l"],
    7: ["s", "d", "f", "space", "j", "k", "l"],
    8: ["a", "s", "d", "f", "j", "k", "l", ";"],
    9: ["a", "s", "d", "f", "space", "j", "k", "l", ";"],
  };

  const practice = {
    songFolder: null,
    songName: "",
    bundle: null,
    notes: [],
    sections: [],
    keyCount: 4,
    laneKeys: fallbackKeys[4],
    keyToLane: new Map(),
    currentMs: 0,
    durationMs: 0,
    startMs: 0,
    endMs: 0,
    leadInMs: 1500,
    speed: 1,
    scrollScale: 1,
    downscroll: false,
    ghostTapping: true,
    loopEnabled: false,
    completedLoops: 0,
    playing: false,
    lastFrame: 0,
    noteStates: new Map(),
    activeLanes: new Set(),
    heldNotes: new Map(),
    openPresses: new Map(),
    presses: [],
    pressId: 0,
    stats: null,
    lastJudgment: "",
    lastDelta: null,
    judgmentUntil: 0,
    finished: false,
    restartTimer: null,
    lastAttempt: null,
    loading: false,
  };

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  function formatPracticeTime(ms, digits = 3) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(digits).padStart(digits + 3, "0")}`;
  }

  function parsePracticeTime(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const parts = text.split(":").map(part => part.trim());
    if (parts.some(part => part === "" || !Number.isFinite(Number(part)))) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + Number(part);
    return Math.max(0, seconds * 1000);
  }

  function normalizeKey(value, code = "") {
    if (code === "Space" || value === " ") return "space";
    const text = String(value || "").trim().toLowerCase();
    const aliases = {
      arrowleft: "arrowleft",
      arrowdown: "arrowdown",
      arrowup: "arrowup",
      arrowright: "arrowright",
      esc: "escape",
    };
    return aliases[text] || text;
  }

  function displayKey(key) {
    const labels = {
      space: "SPACE",
      arrowleft: "←",
      arrowdown: "↓",
      arrowup: "↑",
      arrowright: "→",
      ";": ";",
    };
    return labels[key] || String(key || "?").toUpperCase();
  }

  function isPracticeVisible() {
    return q("#view-practice")?.classList.contains("active");
  }

  function storageKey() {
    return practice.songFolder ? `ril-playable-practice:${practice.songFolder}` : null;
  }

  function saveSongSettings() {
    const key = storageKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify({
      startMs: practice.startMs,
      endMs: practice.endMs,
      leadInMs: practice.leadInMs,
      speed: practice.speed,
      scrollScale: practice.scrollScale,
      downscroll: practice.downscroll,
      ghostTapping: practice.ghostTapping,
      loopEnabled: practice.loopEnabled,
    }));
  }

  function readSongSettings() {
    const key = storageKey();
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }

  function newStats() {
    return {
      hits: 0,
      misses: 0,
      extras: 0,
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
  }

  function accuracy(stats = practice.stats) {
    if (!stats) return null;
    const total = stats.hits + stats.misses;
    return total ? stats.weighted / total * 100 : null;
  }

  function recordAccuracyPoint(label, atMs = practice.currentMs) {
    const value = accuracy(practice.stats);
    if (value === null) return;
    practice.stats.accuracyTimeline.push({
      time_ms: clamp(atMs, practice.startMs, practice.endMs),
      accuracy: value,
      label: String(label || ""),
      hits: practice.stats.hits,
      misses: practice.stats.misses,
    });
  }

  function gradeFor(value) {
    if (!Number.isFinite(Number(value))) return "—";
    if (value >= 98) return "S";
    if (value >= 93) return "A";
    if (value >= 85) return "B";
    if (value >= 75) return "C";
    if (value >= 60) return "D";
    return "F";
  }

  function median(values) {
    const rows = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!rows.length) return null;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  }

  function sectionRanges() {
    const rows = practice.bundle?.sections || [];
    if (!rows.length) {
      return practice.durationMs ? [{ index: 0, startMs: 0, endMs: practice.durationMs, noteCount: practice.notes.length, bpm: Number(practice.bundle?.summary?.base_bpm || 0) }] : [];
    }
    let cursor = 0;
    const sections = rows.map((row, index) => {
      const bpm = Math.max(1, Number(row.bpm || practice.bundle?.summary?.base_bpm || 120));
      const steps = Math.max(1, Number(row.length_in_steps || 16));
      const startMs = cursor;
      cursor += steps * (60000 / bpm / 4);
      return {
        index: Number.isFinite(Number(row.section_index)) ? Number(row.section_index) : index,
        startMs,
        endMs: cursor,
        noteCount: 0,
        bpm,
      };
    });
    const byIndex = new Map(sections.map(section => [section.index, section]));
    for (const note of practice.notes) {
      const section = byIndex.get(Number(note.section_index));
      if (section) section.noteCount += 1;
    }
    if (sections.length) sections[sections.length - 1].endMs = Math.max(sections[sections.length - 1].endMs, practice.durationMs);
    return sections;
  }

  function currentSectionIndex() {
    const found = practice.sections.find(section => practice.currentMs >= section.startMs && practice.currentMs < section.endMs);
    return found?.index ?? practice.sections.at(-1)?.index ?? 0;
  }

  function installPracticeView() {
    if (q('[data-view="practice"]')) return;

    const navButton = document.createElement("button");
    navButton.className = "nav-button";
    navButton.dataset.view = "practice";
    navButton.innerHTML = '<span class="nav-icon">◆</span>Practice';
    const visualizerButton = q('[data-view="visualizer"]');
    visualizerButton.parentElement.insertBefore(navButton, visualizerButton.nextSibling);

    const section = document.createElement("section");
    section.id = "view-practice";
    section.className = "view";
    section.innerHTML = `
      <div class="page-head practice-page-head">
        <div>
          <div class="eyebrow">Playable chart practice</div>
          <h1 id="practiceTitle">Practice.</h1>
          <p id="practiceSubtitle">Choose an imported chart, attach audio if available, and play any part of it.</p>
        </div>
        <div class="actions practice-head-actions">
          <select id="practiceSongSelect"><option value="">Choose song</option></select>
          <label class="button small">Instrumental<input id="practiceInstrumentalFile" type="file" accept="audio/*" class="hidden"></label>
          <label class="button small">Vocals<input id="practiceVocalsFile" type="file" accept="audio/*" class="hidden"></label>
        </div>
      </div>

      <div class="practice-workspace">
        <div class="card practice-stage-card">
          <div class="practice-stage-toolbar">
            <div class="tool-group">
              <button id="practiceStartButton" class="button primary">Start practice</button>
              <button id="practicePauseButton" class="button" disabled>Pause</button>
              <button id="practiceRetryButton" class="button" disabled>Retry</button>
            </div>
            <div class="practice-live-hud">
              <div><span>Accuracy</span><b id="practiceLiveAccuracy">—</b></div>
              <div><span>Combo</span><b id="practiceLiveCombo">0</b></div>
              <div><span>Misses</span><b id="practiceLiveMisses">0</b></div>
              <div><span>Grade</span><b id="practiceLiveGrade">—</b></div>
            </div>
          </div>

          <div id="practiceAudioStatus" class="audio-status">Instrumental: none · Vocals: none</div>
          <div class="practice-canvas-wrap" tabindex="0">
            <canvas id="practiceCanvas"></canvas>
            <div id="practiceCanvasEmpty" class="canvas-empty"><div><div style="font-size:48px">◆</div><h2>No chart loaded</h2><p>Choose a song above to open the playable practice engine.</p></div></div>
            <div id="practiceOverlay" class="practice-overlay hidden"></div>
          </div>

          <div class="practice-transport">
            <div class="practice-range-strip"><div id="practiceRangeFill" class="practice-range-fill"></div><div id="practicePlayhead" class="practice-playhead"></div></div>
            <div class="seek-row"><span id="practiceCurrentTime">0:00.000</span><input id="practiceSeek" type="range" min="0" max="1000" value="0"><span id="practiceDuration">0:00.000</span></div>
            <div class="practice-key-row" id="practiceKeyRow"></div>
          </div>
        </div>

        <aside class="card practice-inspector">
          <div class="inspector-block">
            <div class="practice-inspector-heading"><div><h2>Range</h2><div id="practiceRangeCaption" class="list-sub">Entire song</div></div><button id="practiceLoopToggle" class="button small">Loop off</button></div>
            <div class="field" style="margin-top:12px"><label>Preset</label><select id="practiceRangeMode"><option value="song">Entire song</option><option value="section">Current section</option><option value="custom">Custom range</option></select></div>
            <div class="practice-section-picker"><button id="practicePreviousSection" class="icon-button compact">‹</button><select id="practiceSectionSelect"></select><button id="practiceNextSection" class="icon-button compact">›</button></div>
            <div class="practice-range-inputs">
              <div class="field"><label>Start</label><input id="practiceStartTime" class="mono" value="0:00.000"></div>
              <div class="field"><label>End</label><input id="practiceEndTime" class="mono" value="0:00.000"></div>
            </div>
            <div class="actions"><button id="practiceSetStart" class="button small">Start here</button><button id="practiceSetEnd" class="button small">End here</button></div>
          </div>

          <div class="inspector-block">
            <h3>Playback</h3>
            <div class="practice-speed-row">
              <button class="button small practice-speed" data-speed="0.5">50%</button>
              <button class="button small practice-speed" data-speed="0.75">75%</button>
              <button class="button small practice-speed" data-speed="0.9">90%</button>
              <button class="button small practice-speed primary" data-speed="1">100%</button>
              <button class="button small practice-speed" data-speed="1.25">125%</button>
            </div>
            <div class="form-grid practice-options-grid">
              <div class="field"><label>Lead-in</label><select id="practiceLeadIn"><option value="500">0.5 s</option><option value="1000">1.0 s</option><option value="1500" selected>1.5 s</option><option value="2000">2.0 s</option><option value="3000">3.0 s</option></select></div>
              <div class="field"><label>Scroll speed</label><input id="practiceScrollSpeed" type="range" min="0.5" max="2.5" step="0.05" value="1"></div>
            </div>
            <div class="practice-toggle-row"><button id="practiceDownscrollToggle" class="button small">Downscroll off</button><button id="practiceGhostToggle" class="button small primary">Ghost tapping on</button></div>
          </div>

          <div class="inspector-block">
            <div class="practice-inspector-heading"><h3>Last attempt</h3><button id="practiceReviewButton" class="button small" disabled>Review in Visualizer</button></div>
            <div class="practice-summary-grid">
              <div><span>Accuracy</span><b id="practiceSummaryAccuracy">—</b></div>
              <div><span>Best combo</span><b id="practiceSummaryCombo">—</b></div>
              <div><span>Early / late</span><b id="practiceSummaryTiming">—</b></div>
              <div><span>Median offset</span><b id="practiceSummaryMedian">—</b></div>
              <div><span>Hold drops</span><b id="practiceSummaryHolds">—</b></div>
              <div><span>Hazards</span><b id="practiceSummaryHazards">—</b></div>
            </div>
            <div id="practiceJudgmentBreakdown" class="judgment-list"><div class="list-sub">Finish a practice attempt to see its breakdown.</div></div>
          </div>

          <div class="inspector-block practice-help">
            <h3>Controls</h3>
            <p id="practiceControlsHelp">Your saved key profile appears beneath the playfield. Escape pauses; Enter starts or retries.</p>
          </div>
        </aside>
      </div>
    `;

    const settingsView = q("#view-settings");
    settingsView.parentElement.insertBefore(section, settingsView);
    installPracticeStyles();
    bindPracticeControls();
    navButton.addEventListener("click", () => go("practice"));
  }

  function installPracticeStyles() {
    if (q("#playablePracticeStyles")) return;
    const style = document.createElement("style");
    style.id = "playablePracticeStyles";
    style.textContent = `
      .practice-page-head{gap:18px}.practice-head-actions{flex-wrap:wrap;justify-content:flex-end}.practice-workspace{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px;align-items:start}.practice-stage-card{overflow:hidden;min-width:0}.practice-stage-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line)}.practice-live-hud{display:grid;grid-template-columns:repeat(4,minmax(70px,1fr));gap:8px}.practice-live-hud>div{display:flex;flex-direction:column;gap:2px;text-align:right}.practice-live-hud span,.practice-summary-grid span{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.practice-live-hud b{font-size:15px}.practice-canvas-wrap{position:relative;height:min(67vh,720px);min-height:430px;background:#05070c;outline:none}.practice-canvas-wrap:focus-visible{box-shadow:inset 0 0 0 2px var(--accent)}#practiceCanvas{width:100%;height:100%;display:block}.practice-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;pointer-events:none;background:radial-gradient(circle at center,rgba(7,10,18,.22),rgba(7,10,18,.66));font-size:42px;font-weight:900;text-shadow:0 4px 18px #000}.practice-overlay small{display:block;font-size:13px;color:var(--muted);margin-top:8px}.practice-transport{padding:10px 14px 14px;border-top:1px solid var(--line)}.practice-range-strip{height:8px;position:relative;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;margin-bottom:8px}.practice-range-fill{position:absolute;inset-block:0;background:rgba(117,230,255,.38);border-inline:1px solid var(--accent)}.practice-playhead{position:absolute;top:-2px;bottom:-2px;width:2px;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.7)}.practice-key-row{display:grid;gap:5px;margin-top:10px;justify-content:center}.practice-key{min-width:48px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.025);text-align:center;font-weight:800;font-size:11px}.practice-key.active{background:rgba(117,230,255,.22);border-color:var(--accent);box-shadow:0 0 12px rgba(117,230,255,.18)}.practice-inspector{overflow:hidden}.practice-inspector-heading{display:flex;align-items:center;justify-content:space-between;gap:9px}.practice-section-picker{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:7px;margin-top:9px}.practice-range-inputs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.practice-speed-row{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:10px}.practice-speed-row .button{padding-inline:3px}.practice-options-grid{margin-top:10px}.practice-toggle-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.practice-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:10px}.practice-summary-grid>div{display:flex;flex-direction:column;gap:3px;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.02)}.practice-summary-grid b{font-size:12px}.practice-help p{font-size:12px;margin:8px 0 0}.practice-stage-card .audio-status{border-bottom:1px solid var(--line)}@media(max-width:1100px){.practice-workspace{grid-template-columns:1fr}.practice-inspector{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.practice-inspector .practice-help{grid-column:1/-1}}@media(max-width:760px){.practice-live-hud{grid-template-columns:repeat(2,1fr)}.practice-stage-toolbar{align-items:flex-start;flex-direction:column}.practice-inspector{display:block}.practice-canvas-wrap{min-height:390px}.practice-speed-row{grid-template-columns:repeat(3,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function bindPracticeControls() {
    q("#practiceSongSelect").addEventListener("change", event => event.target.value && loadPracticeSong(event.target.value));
    q("#practiceInstrumentalFile").addEventListener("change", event => attachPracticeAudio(event.target.files[0], "instrumental"));
    q("#practiceVocalsFile").addEventListener("change", event => attachPracticeAudio(event.target.files[0], "vocals"));
    q("#practiceStartButton").addEventListener("click", startPractice);
    q("#practicePauseButton").addEventListener("click", togglePracticePause);
    q("#practiceRetryButton").addEventListener("click", startPractice);
    q("#practiceLoopToggle").addEventListener("click", () => {
      practice.loopEnabled = !practice.loopEnabled;
      updatePracticeButtons();
      saveSongSettings();
    });
    q("#practiceRangeMode").addEventListener("change", event => applyRangeMode(event.target.value));
    q("#practiceSectionSelect").addEventListener("change", event => selectSection(Number(event.target.value)));
    q("#practicePreviousSection").addEventListener("click", () => shiftSection(-1));
    q("#practiceNextSection").addEventListener("click", () => shiftSection(1));
    q("#practiceSetStart").addEventListener("click", () => setPracticeRange(practice.currentMs, practice.endMs, "Custom range"));
    q("#practiceSetEnd").addEventListener("click", () => setPracticeRange(practice.startMs, practice.currentMs, "Custom range"));
    q("#practiceStartTime").addEventListener("change", commitRangeInputs);
    q("#practiceEndTime").addEventListener("change", commitRangeInputs);
    qa(".practice-speed").forEach(button => button.addEventListener("click", () => setPracticeSpeed(Number(button.dataset.speed))));
    q("#practiceLeadIn").addEventListener("change", event => { practice.leadInMs = Number(event.target.value); saveSongSettings(); });
    q("#practiceScrollSpeed").addEventListener("input", event => { practice.scrollScale = Number(event.target.value); saveSongSettings(); drawPractice(); });
    q("#practiceDownscrollToggle").addEventListener("click", () => { practice.downscroll = !practice.downscroll; updatePracticeButtons(); saveSongSettings(); drawPractice(); });
    q("#practiceGhostToggle").addEventListener("click", () => { practice.ghostTapping = !practice.ghostTapping; updatePracticeButtons(); saveSongSettings(); });
    q("#practiceSeek").addEventListener("input", event => seekPractice(Number(event.target.value) / 1000 * practice.durationMs));
    q("#practiceReviewButton").addEventListener("click", reviewPracticeAttempt);
    q(".practice-canvas-wrap").addEventListener("pointerdown", () => q(".practice-canvas-wrap").focus());
    window.addEventListener("keydown", handlePracticeKeyDown, true);
    window.addEventListener("keyup", handlePracticeKeyUp, true);
    window.addEventListener("resize", () => isPracticeVisible() && drawPractice());
  }

  function populatePracticeSongs() {
    const select = q("#practiceSongSelect");
    if (!select) return;
    const current = practice.songFolder || select.value;
    const songs = (state.songs || []).filter(song => song.has_chart);
    select.innerHTML = '<option value="">Choose song</option>' + songs.map(song => `<option value="${escapeHtml(song.folder)}">${escapeHtml(song.song_name)}</option>`).join("");
    if ([...select.options].some(option => option.value === current)) select.value = current;
  }

  async function loadPracticeSong(folder) {
    if (practice.loading) return;
    stopPractice(false);
    practice.loading = true;
    q("#practiceCanvasEmpty").innerHTML = '<div><h2>Loading chart…</h2></div>';
    q("#practiceCanvasEmpty").classList.remove("hidden");
    try {
      const data = await api(`/api/song?folder=${encodeURIComponent(folder)}`);
      if (!data.bundle) throw new Error("This song does not have an imported chart.");
      practice.songFolder = folder;
      practice.songName = data.song?.song_name || data.bundle.summary?.song_name || folder;
      practice.bundle = data.bundle;
      practice.durationMs = Math.max(0, Number(data.bundle.summary?.duration_ms || 0));
      practice.keyCount = clamp(Number(data.bundle.summary?.key_count || 4), 4, 9);
      practice.notes = (data.bundle.notes || [])
        .filter(note => note.owner === "player" && note.lane !== null && note.lane !== undefined)
        .map((note, index) => ({ ...note, _practiceId: index }));
      practice.sections = sectionRanges();
      configurePracticeKeys();

      state.viz.bundle = data.bundle;
      state.viz.songFolder = folder;
      state.viz.durationMs = practice.durationMs;
      state.viz.chartDurationMs = practice.durationMs;
      state.viz.currentMs = 0;
      state.viz.playing = false;
      state.viz.attempt = null;
      state.viz.comparison = null;
      state.viz.standaloneReplay = false;

      const saved = readSongSettings();
      practice.startMs = clamp(saved?.startMs ?? 0, 0, practice.durationMs);
      practice.endMs = clamp(saved?.endMs ?? practice.durationMs, 0, practice.durationMs);
      if (practice.endMs <= practice.startMs) {
        practice.startMs = 0;
        practice.endMs = practice.durationMs;
      }
      practice.leadInMs = Number(saved?.leadInMs ?? 1500);
      practice.speed = Number(saved?.speed ?? 1);
      practice.scrollScale = Number(saved?.scrollScale ?? 1);
      practice.downscroll = Boolean(saved?.downscroll);
      practice.ghostTapping = saved?.ghostTapping !== false;
      practice.loopEnabled = Boolean(saved?.loopEnabled);
      practice.currentMs = practice.startMs;
      practice.completedLoops = 0;
      practice.lastAttempt = null;
      practice.finished = false;
      practice.noteStates.clear();
      practice.stats = newStats();

      q("#practiceTitle").textContent = practice.songName;
      q("#practiceSubtitle").textContent = `${practice.keyCount}K · ${formatNumber(data.bundle.summary?.base_bpm, 1)} BPM · ${formatNumber(practice.notes.filter(note => !isHazardNote(note)).length)} playable notes`;
      q("#practiceCanvasEmpty").classList.add("hidden");
      q("#practiceDuration").textContent = formatPracticeTime(practice.durationMs);
      q("#practiceLeadIn").value = String(practice.leadInMs);
      q("#practiceScrollSpeed").value = String(practice.scrollScale);
      q("#practiceSongSelect").value = folder;
      populatePracticeSections();
      setPracticeRange(practice.startMs, practice.endMs, practice.startMs === 0 && practice.endMs === practice.durationMs ? "Entire song" : "Saved range", false);
      setPracticeSpeed(practice.speed, false);
      updatePracticeButtons();
      updatePracticeAudioStatus();
      updatePracticeHud();
      renderLastAttempt();
      drawPractice();
      toast(`${practice.songName} is ready to practice.`);
    } catch (error) {
      practice.bundle = null;
      practice.notes = [];
      q("#practiceCanvasEmpty").innerHTML = `<div><h2>Could not load chart</h2><p>${escapeHtml(error.message)}</p></div>`;
      toast(error.message, "error", 7000);
    } finally {
      practice.loading = false;
    }
  }

  function configurePracticeKeys() {
    const profile = state.settings?.profiles?.[String(practice.keyCount)];
    const keys = Array.isArray(profile?.keys) && profile.keys.length === practice.keyCount
      ? profile.keys.map(key => normalizeKey(key))
      : fallbackKeys[practice.keyCount].slice();
    practice.laneKeys = keys;
    practice.keyToLane = new Map(keys.map((key, lane) => [key, lane]));
    if (practice.keyCount === 4) {
      ["arrowleft", "arrowdown", "arrowup", "arrowright"].forEach((key, lane) => practice.keyToLane.set(key, lane));
    }
    renderPracticeKeys();
  }

  function renderPracticeKeys() {
    const row = q("#practiceKeyRow");
    if (!row) return;
    row.style.gridTemplateColumns = `repeat(${practice.keyCount},minmax(48px,68px))`;
    row.innerHTML = practice.laneKeys.map((key, lane) => `<div class="practice-key" data-lane="${lane}">${displayKey(key)}</div>`).join("");
    q("#practiceControlsHelp").textContent = `${practice.keyCount}K: ${practice.laneKeys.map(displayKey).join(" · ")} · Escape pauses · Enter starts or retries.`;
  }

  function populatePracticeSections() {
    const select = q("#practiceSectionSelect");
    select.innerHTML = practice.sections.map(section => `<option value="${section.index}">Section ${section.index + 1} · ${formatPracticeTime(section.startMs, 2)} · ${section.noteCount} notes</option>`).join("");
    if (practice.sections.length) select.value = String(currentSectionIndex());
  }

  function applyRangeMode(mode) {
    if (!practice.bundle) return;
    if (mode === "song") {
      setPracticeRange(0, practice.durationMs, "Entire song");
      return;
    }
    if (mode === "section") {
      selectSection(currentSectionIndex());
      return;
    }
    q("#practiceRangeMode").value = "custom";
  }

  function selectSection(index) {
    const section = practice.sections.find(item => item.index === Number(index));
    if (!section) return;
    setPracticeRange(section.startMs, section.endMs, `Section ${section.index + 1}`);
    seekPractice(section.startMs);
    q("#practiceRangeMode").value = "section";
    q("#practiceSectionSelect").value = String(section.index);
  }

  function shiftSection(delta) {
    if (!practice.sections.length) return;
    const current = Number(q("#practiceSectionSelect").value || currentSectionIndex());
    const position = Math.max(0, practice.sections.findIndex(section => section.index === current));
    selectSection(practice.sections[clamp(position + delta, 0, practice.sections.length - 1)].index);
  }

  function setPracticeRange(startMs, endMs, caption = "Custom range", persist = true) {
    if (!practice.bundle) return;
    let start = clamp(startMs, 0, practice.durationMs);
    let end = clamp(endMs, 0, practice.durationMs);
    if (end < start) [start, end] = [end, start];
    if (end - start < 100) end = Math.min(practice.durationMs, start + 100);
    practice.startMs = start;
    practice.endMs = end;
    practice.currentMs = clamp(practice.currentMs, start, end);
    q("#practiceStartTime").value = formatPracticeTime(start);
    q("#practiceEndTime").value = formatPracticeTime(end);
    q("#practiceRangeCaption").textContent = `${caption} · ${formatPracticeTime(start)} → ${formatPracticeTime(end)}`;
    if (caption === "Entire song") q("#practiceRangeMode").value = "song";
    else if (!caption.startsWith("Section")) q("#practiceRangeMode").value = "custom";
    updatePracticeTransport();
    if (persist) saveSongSettings();
    drawPractice();
  }

  function commitRangeInputs() {
    const start = parsePracticeTime(q("#practiceStartTime").value);
    const end = parsePracticeTime(q("#practiceEndTime").value);
    if (start === null || end === null) {
      toast("Use a time such as 1:24.283.", "error");
      q("#practiceStartTime").value = formatPracticeTime(practice.startMs);
      q("#practiceEndTime").value = formatPracticeTime(practice.endMs);
      return;
    }
    setPracticeRange(start, end, "Custom range");
  }

  function setPracticeSpeed(value, persist = true) {
    practice.speed = clamp(value, 0.25, 2);
    qa(".practice-speed").forEach(button => button.classList.toggle("primary", Number(button.dataset.speed) === practice.speed));
    for (const audio of audioElements()) audio.playbackRate = practice.speed;
    if (persist) saveSongSettings();
  }

  function updatePracticeButtons() {
    q("#practiceLoopToggle").textContent = `Loop ${practice.loopEnabled ? "on" : "off"}`;
    q("#practiceLoopToggle").classList.toggle("primary", practice.loopEnabled);
    q("#practiceDownscrollToggle").textContent = `Downscroll ${practice.downscroll ? "on" : "off"}`;
    q("#practiceDownscrollToggle").classList.toggle("primary", practice.downscroll);
    q("#practiceGhostToggle").textContent = `Ghost tapping ${practice.ghostTapping ? "on" : "off"}`;
    q("#practiceGhostToggle").classList.toggle("primary", practice.ghostTapping);
    q("#practiceStartButton").disabled = !practice.bundle || practice.playing;
    q("#practicePauseButton").disabled = !practice.bundle || practice.finished;
    q("#practicePauseButton").textContent = practice.playing ? "Pause" : "Resume";
    q("#practiceRetryButton").disabled = !practice.bundle;
  }

  function attachPracticeAudio(file, kind) {
    if (!file) return;
    const audio = audioElement(kind);
    if (!audio) return;
    if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
    const url = URL.createObjectURL(file);
    audio.dataset.url = url;
    audio.src = url;
    audio.volume = state.viz.audioVolumes?.[kind] ?? 1;
    audio.playbackRate = practice.speed;
    audio.onloadedmetadata = () => {
      state.viz.audioReady[kind] = true;
      state.viz.audioNames[kind] = file.name;
      try { audio.currentTime = practice.currentMs / 1000; } catch (_) {}
      updatePracticeAudioStatus();
      if (typeof updateAudioStatus === "function") updateAudioStatus();
      toast(`Attached ${kind}: ${file.name}.`);
    };
  }

  function updatePracticeAudioStatus() {
    const instrumental = state.viz.audioNames?.instrumental || "none";
    const vocals = state.viz.audioNames?.vocals || "none";
    q("#practiceAudioStatus").textContent = `Instrumental: ${instrumental} · Vocals: ${vocals}`;
  }

  function syncPracticeAudio(force = false) {
    const target = practice.currentMs / 1000;
    const primary = primaryAudio();
    for (const audio of audioElements()) {
      const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
      if (!state.viz.audioReady[kind]) continue;
      audio.playbackRate = practice.speed;
      if (force || Math.abs(audio.currentTime - target) > 0.045) {
        try { audio.currentTime = Math.max(0, target); } catch (_) {}
      }
    }
    if (primary) {
      for (const audio of audioElements()) {
        if (audio === primary) continue;
        const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
        if (state.viz.audioReady[kind] && Math.abs(audio.currentTime - primary.currentTime) > 0.035) {
          try { audio.currentTime = primary.currentTime; } catch (_) {}
        }
      }
    }
  }

  function playPracticeAudio() {
    syncPracticeAudio(true);
    for (const audio of audioElements()) {
      const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
      if (state.viz.audioReady[kind]) audio.play().catch(() => {});
    }
  }

  function pausePracticeAudio() {
    for (const audio of audioElements()) audio.pause();
  }

  function resetPracticeAttempt() {
    clearTimeout(practice.restartTimer);
    practice.restartTimer = null;
    practice.noteStates = new Map();
    practice.activeLanes.clear();
    practice.heldNotes.clear();
    practice.openPresses.clear();
    practice.presses = [];
    practice.pressId = 0;
    practice.stats = newStats();
    practice.lastJudgment = "";
    practice.lastDelta = null;
    practice.judgmentUntil = 0;
    practice.finished = false;
    updatePracticeHud();
    updatePracticeKeyDisplay();
  }

  function startPractice() {
    if (!practice.bundle) return toast("Choose a chart first.", "error");
    stopPractice(false);
    resetPracticeAttempt();
    practice.currentMs = Math.max(0, practice.startMs - practice.leadInMs);
    state.viz.currentMs = practice.currentMs;
    practice.playing = true;
    practice.lastFrame = performance.now();
    q("#practiceOverlay").classList.remove("hidden");
    q(".practice-canvas-wrap").focus();
    playPracticeAudio();
    updatePracticeButtons();
    updatePracticeTransport();
    drawPractice();
  }

  function togglePracticePause() {
    if (!practice.bundle) return;
    if (practice.playing) {
      practice.playing = false;
      pausePracticeAudio();
      q("#practiceOverlay").innerHTML = 'Paused<small>Press Escape or the Resume button.</small>';
      q("#practiceOverlay").classList.remove("hidden");
    } else if (!practice.finished) {
      practice.playing = true;
      practice.lastFrame = performance.now();
      playPracticeAudio();
      q("#practiceOverlay").classList.add("hidden");
    }
    updatePracticeButtons();
  }

  function stopPractice(clearOverlay = true) {
    practice.playing = false;
    pausePracticeAudio();
    closeOpenPresses();
    practice.activeLanes.clear();
    practice.heldNotes.clear();
    updatePracticeKeyDisplay();
    if (clearOverlay) q("#practiceOverlay")?.classList.add("hidden");
    updatePracticeButtons();
  }

  function closeOpenPresses() {
    for (const [lane, press] of practice.openPresses) {
      press.held_ms = Math.max(0, practice.currentMs - press.time_ms);
      practice.openPresses.delete(lane);
    }
  }

  function seekPractice(ms) {
    if (!practice.bundle || practice.playing) return;
    practice.currentMs = clamp(ms, 0, practice.durationMs);
    state.viz.currentMs = practice.currentMs;
    syncPracticeAudio(true);
    updatePracticeTransport();
    if (practice.sections.length) q("#practiceSectionSelect").value = String(currentSectionIndex());
    drawPractice();
  }

  function handlePracticeKeyDown(event) {
    if (!isPracticeVisible()) return;
    const target = event.target;
    const typing = target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
    const key = normalizeKey(event.key, event.code);
    if (typing) return;
    if (key === "escape") {
      event.preventDefault();
      if (practice.bundle && (practice.playing || !practice.finished)) togglePracticePause();
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      if (!practice.playing) startPractice();
      return;
    }
    const lane = practice.keyToLane.get(key);
    if (!Number.isInteger(lane) || event.repeat || !practice.bundle) return;
    event.preventDefault();
    practice.activeLanes.add(lane);
    updatePracticeKeyDisplay();
    if (!practice.playing) return;

    const press = {
      id: practice.pressId++,
      time_ms: practice.currentMs,
      key,
      role: "lane",
      lane,
      held_ms: null,
    };
    practice.presses.push(press);
    practice.openPresses.set(lane, press);
    judgeLanePress(lane, press);
  }

  function handlePracticeKeyUp(event) {
    if (!isPracticeVisible()) return;
    const key = normalizeKey(event.key, event.code);
    const lane = practice.keyToLane.get(key);
    if (!Number.isInteger(lane)) return;
    practice.activeLanes.delete(lane);
    updatePracticeKeyDisplay();
    const press = practice.openPresses.get(lane);
    if (press) {
      press.held_ms = Math.max(0, practice.currentMs - press.time_ms);
      practice.openPresses.delete(lane);
    }
    const heldNote = practice.heldNotes.get(lane);
    if (!heldNote) return;
    const endMs = Number(heldNote.end_ms ?? Number(heldNote.time_ms) + Number(heldNote.sustain_ms || 0));
    const outer = getChartWindows().outer;
    if (practice.currentMs < endMs - outer) {
      const noteState = practice.noteStates.get(heldNote._practiceId) || {};
      noteState.holdDropped = true;
      noteState.holdDropAt = practice.currentMs;
      practice.noteStates.set(heldNote._practiceId, noteState);
      practice.stats.holdDrops += 1;
      practice.stats.combo = 0;
      flashJudgment("Hold drop", practice.currentMs - endMs);
    }
    practice.heldNotes.delete(lane);
    updatePracticeHud();
  }

  function judgeLanePress(lane, press) {
    const windows = getChartWindows();
    const current = practice.currentMs;
    if (current < practice.startMs - windows.outer || current >= practice.endMs + windows.outer) return;
    const candidates = practice.notes
      .filter(note => Number(note.lane) === lane && Number(note.time_ms) >= practice.startMs && Number(note.time_ms) < practice.endMs && !practice.noteStates.has(note._practiceId))
      .map(note => ({ note, delta: current - Number(note.time_ms) }))
      .filter(item => Math.abs(item.delta) <= windows.outer)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    const candidate = candidates[0];
    if (!candidate) {
      if (!practice.ghostTapping) {
        practice.stats.extras += 1;
        practice.stats.misses += 1;
        practice.stats.combo = 0;
        flashJudgment("Miss", null);
        recordAccuracyPoint("Extra");
        updatePracticeHud();
      }
      return;
    }

    const { note, delta } = candidate;
    if (isHazardNote(note)) {
      practice.noteStates.set(note._practiceId, { status: "hazard-hit", hitAt: current, delta, pressId: press.id });
      practice.stats.hazardsHit += 1;
      practice.stats.misses += 1;
      practice.stats.combo = 0;
      flashJudgment("Hurt", delta);
      recordAccuracyPoint("Hurt");
      updatePracticeHud();
      return;
    }

    const judgment = judgmentFor(delta);
    practice.noteStates.set(note._practiceId, { status: "hit", hitAt: current, delta, judgment, pressId: press.id });
    practice.stats.hits += 1;
    practice.stats.judgments[judgment] += 1;
    practice.stats.weighted += weights[judgment] ?? 0;
    practice.stats.combo += 1;
    practice.stats.maxCombo = Math.max(practice.stats.maxCombo, practice.stats.combo);
    practice.stats.deltas.push(delta);
    if (delta < 0) practice.stats.early += 1;
    else practice.stats.late += 1;
    if (Number(note.sustain_ms || 0) > 0) practice.heldNotes.set(lane, note);
    flashJudgment(judgment, delta);
    recordAccuracyPoint(judgment);
    updatePracticeHud();
  }

  function flashJudgment(label, delta) {
    practice.lastJudgment = label;
    practice.lastDelta = Number.isFinite(Number(delta)) ? Number(delta) : null;
    practice.judgmentUntil = performance.now() + 600;
  }

  function processPracticeNotes() {
    if (!practice.bundle) return;
    const outer = getChartWindows().outer;
    const current = practice.currentMs;
    for (const note of practice.notes) {
      const time = Number(note.time_ms);
      if (time < practice.startMs || time >= practice.endMs || practice.noteStates.has(note._practiceId)) continue;
      if (current <= time + outer) continue;
      if (isHazardNote(note)) {
        practice.noteStates.set(note._practiceId, { status: "hazard-safe", judgedAt: current });
        practice.stats.hazardsAvoided += 1;
      } else {
        practice.noteStates.set(note._practiceId, { status: "missed", judgedAt: current });
        practice.stats.misses += 1;
        practice.stats.combo = 0;
        flashJudgment("Miss", null);
        recordAccuracyPoint("Miss", time + outer);
      }
    }
    for (const [lane, note] of practice.heldNotes) {
      const endMs = Number(note.end_ms ?? Number(note.time_ms) + Number(note.sustain_ms || 0));
      if (current >= endMs) {
        const noteState = practice.noteStates.get(note._practiceId) || {};
        noteState.holdComplete = true;
        practice.noteStates.set(note._practiceId, noteState);
        practice.heldNotes.delete(lane);
      }
    }
  }

  function finishPracticeAttempt() {
    if (practice.finished) return;
    processPracticeNotes();
    for (const note of practice.notes) {
      const time = Number(note.time_ms);
      if (time < practice.startMs || time >= practice.endMs || practice.noteStates.has(note._practiceId)) continue;
      if (isHazardNote(note)) {
        practice.noteStates.set(note._practiceId, { status: "hazard-safe", judgedAt: practice.endMs });
        practice.stats.hazardsAvoided += 1;
      } else {
        practice.noteStates.set(note._practiceId, { status: "missed", judgedAt: practice.endMs });
        practice.stats.misses += 1;
        practice.stats.combo = 0;
        recordAccuracyPoint("Miss", practice.endMs);
      }
    }
    practice.finished = true;
    practice.playing = false;
    pausePracticeAudio();
    closeOpenPresses();
    practice.activeLanes.clear();
    practice.heldNotes.clear();
    updatePracticeKeyDisplay();
    practice.currentMs = practice.endMs;
    state.viz.currentMs = practice.currentMs;
    const snapshot = {
      songFolder: practice.songFolder,
      songName: practice.songName,
      startMs: practice.startMs,
      endMs: practice.endMs,
      speed: practice.speed,
      keyCount: practice.keyCount,
      laneKeys: practice.laneKeys.slice(),
      presses: practice.presses.map(press => ({ ...press, held_ms: Number(press.held_ms || 0) })),
      stats: JSON.parse(JSON.stringify(practice.stats)),
      completedAt: new Date().toISOString(),
    };
    practice.lastAttempt = snapshot;
    renderLastAttempt();
    updatePracticeHud();
    updatePracticeButtons();
    updatePracticeTransport();

    const value = accuracy(snapshot.stats);
    q("#practiceOverlay").innerHTML = `${gradeFor(value)} · ${value === null ? "—" : `${formatNumber(value, 2)}%`}<small>${snapshot.stats.hits} hits · ${snapshot.stats.misses} misses · ${snapshot.stats.maxCombo} max combo</small>`;
    q("#practiceOverlay").classList.remove("hidden");

    if (practice.loopEnabled && isPracticeVisible()) {
      practice.completedLoops += 1;
      practice.restartTimer = setTimeout(() => {
        if (practice.loopEnabled && isPracticeVisible()) startPractice();
      }, 850);
    }
  }

  function updatePracticeHud() {
    const stats = practice.stats || newStats();
    const value = accuracy(stats);
    q("#practiceLiveAccuracy").textContent = value === null ? "—" : `${formatNumber(value, 2)}%`;
    q("#practiceLiveCombo").textContent = formatNumber(stats.combo);
    q("#practiceLiveMisses").textContent = formatNumber(stats.misses);
    q("#practiceLiveGrade").textContent = gradeFor(value);
  }

  function renderLastAttempt() {
    const attempt = practice.lastAttempt;
    q("#practiceReviewButton").disabled = !attempt;
    if (!attempt) {
      q("#practiceSummaryAccuracy").textContent = "—";
      q("#practiceSummaryCombo").textContent = "—";
      q("#practiceSummaryTiming").textContent = "—";
      q("#practiceSummaryMedian").textContent = "—";
      q("#practiceSummaryHolds").textContent = "—";
      q("#practiceSummaryHazards").textContent = "—";
      q("#practiceJudgmentBreakdown").innerHTML = '<div class="list-sub">Finish a practice attempt to see its breakdown.</div>';
      return;
    }
    const stats = attempt.stats;
    const value = accuracy(stats);
    const med = median(stats.deltas);
    q("#practiceSummaryAccuracy").textContent = value === null ? "—" : `${formatNumber(value, 2)}%`;
    q("#practiceSummaryCombo").textContent = formatNumber(stats.maxCombo);
    q("#practiceSummaryTiming").textContent = `${stats.early} / ${stats.late}`;
    q("#practiceSummaryMedian").textContent = med === null ? "—" : `${med >= 0 ? "+" : ""}${formatNumber(med, 1)} ms`;
    q("#practiceSummaryHolds").textContent = formatNumber(stats.holdDrops);
    q("#practiceSummaryHazards").textContent = `${stats.hazardsAvoided} safe · ${stats.hazardsHit} hit`;
    q("#practiceJudgmentBreakdown").innerHTML = Object.entries(stats.judgments).map(([name, count]) => `<div class="judgment-row"><span>${name}</span><b>${formatNumber(count)}</b></div>`).join("") + `<div class="divider"></div><div class="judgment-row"><span>Miss / extra</span><b>${stats.misses} / ${stats.extras}</b></div>`;
  }

  function reviewPracticeAttempt() {
    const attempt = practice.lastAttempt;
    if (!attempt || !practice.bundle) return;
    stopPractice();
    state.viz.bundle = practice.bundle;
    state.viz.songFolder = practice.songFolder;
    state.viz.durationMs = practice.durationMs;
    state.viz.chartDurationMs = practice.durationMs;
    state.viz.currentMs = attempt.startMs;
    state.viz.attempt = {
      folder: "Practice attempt",
      session: {
        song_name: attempt.songName,
        key_count: attempt.keyCount,
        lane_keys: attempt.laneKeys,
        attempt_number: "P",
      },
      analysis: {},
      presses: attempt.presses,
    };
    state.viz.attemptFolder = null;
    state.viz.attemptSource = "imported";
    state.viz.comparisonEnabled = true;
    state.viz.importedReplayName = `Practice · ${formatPracticeTime(attempt.startMs)}–${formatPracticeTime(attempt.endMs)}`;
    state.viz.standaloneReplay = false;
    state.viz.offsetMs = 0;
    state.viz.viewMode = "compare";
    q("#viewMode").value = "compare";
    q("#visualizerSongSelect").value = practice.songFolder;
    q("#visualizerTitle").textContent = `${practice.songName} · Practice review`;
    q("#visualizerSubtitle").textContent = `${attempt.keyCount}K · ${attempt.presses.length} recorded inputs · ${formatPracticeTime(attempt.startMs)} → ${formatPracticeTime(attempt.endMs)}`;
    q("#canvasEmpty").classList.add("hidden");
    recomputeComparison();
    updateReplayStatus();
    updateVisualizerStats();
    go("visualizer");
    seekTo(attempt.startMs);
    toast("Opened the last practice attempt in the Visualizer.");
  }

  function updatePracticeTransport() {
    const duration = Math.max(1, practice.durationMs);
    const start = clamp(practice.startMs / duration * 100, 0, 100);
    const end = clamp(practice.endMs / duration * 100, 0, 100);
    const current = clamp(practice.currentMs / duration * 100, 0, 100);
    q("#practiceRangeFill").style.left = `${start}%`;
    q("#practiceRangeFill").style.width = `${Math.max(0.15, end - start)}%`;
    q("#practicePlayhead").style.left = `${current}%`;
    q("#practiceCurrentTime").textContent = formatPracticeTime(practice.currentMs);
    q("#practiceDuration").textContent = formatPracticeTime(practice.durationMs);
    q("#practiceSeek").value = practice.durationMs ? String(practice.currentMs / practice.durationMs * 1000) : "0";
  }

  function updatePracticeKeyDisplay() {
    qa(".practice-key").forEach(node => node.classList.toggle("active", practice.activeLanes.has(Number(node.dataset.lane))));
  }

  function practiceAnimationLoop(now) {
    if (practice.playing && practice.bundle) {
      const primary = primaryAudio();
      if (primary && !primary.paused) {
        practice.currentMs = primary.currentTime * 1000;
        syncPracticeAudio(false);
      } else {
        const delta = practice.lastFrame ? now - practice.lastFrame : 0;
        practice.currentMs += delta * practice.speed;
      }
      practice.lastFrame = now;
      state.viz.currentMs = practice.currentMs;
      processPracticeNotes();
      if (practice.currentMs >= practice.endMs) finishPracticeAttempt();
      updatePracticeHud();
      updatePracticeTransport();
    }
    if (isPracticeVisible()) drawPractice(now);
    requestAnimationFrame(practiceAnimationLoop);
  }

  function resizePracticeCanvas() {
    const canvas = q("#practiceCanvas");
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
  }

  function drawPractice(now = performance.now()) {
    const canvas = q("#practiceCanvas");
    if (!canvas) return;
    const { ctx, width, height } = resizePracticeCanvas();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, width, height);
    if (!practice.bundle) return;

    const keyCount = practice.keyCount;
    const fieldWidth = Math.min(width - 42, keyCount * 94);
    const startX = (width - fieldWidth) / 2;
    const laneGap = 1;
    const laneWidth = (fieldWidth - laneGap * (keyCount - 1)) / keyCount;
    const receptorY = practice.downscroll ? height - 82 : 82;
    const direction = practice.downscroll ? -1 : 1;
    const pixelsPerMs = 0.43 * practice.scrollScale;
    const aheadDistance = practice.downscroll ? receptorY - 20 : height - receptorY - 20;
    const aheadMs = (aheadDistance + 120) / pixelsPerMs;
    const behindMs = 260 / pixelsPerMs;
    const current = practice.currentMs;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(117,230,255,.035)");
    gradient.addColorStop(0.5, "rgba(255,255,255,.008)");
    gradient.addColorStop(1, "rgba(169,140,255,.035)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    roundRect(ctx, startX, 18, fieldWidth, height - 36, 16);
    ctx.fillStyle = "rgba(2,4,10,.72)";
    ctx.fill();
    ctx.clip();
    for (let lane = 0; lane < keyCount; lane++) {
      const x = startX + lane * (laneWidth + laneGap);
      ctx.fillStyle = lane % 2 ? "rgba(255,255,255,.028)" : "rgba(255,255,255,.014)";
      ctx.fillRect(x, 18, laneWidth, height - 36);
      ctx.strokeStyle = "rgba(255,255,255,.055)";
      ctx.strokeRect(x, 18, laneWidth, height - 36);
    }
    ctx.strokeStyle = "rgba(117,230,255,.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, receptorY);
    ctx.lineTo(startX + fieldWidth, receptorY);
    ctx.stroke();

    const visible = practice.notes.filter(note => {
      const time = Number(note.time_ms);
      const end = Number(note.end_ms ?? time + Number(note.sustain_ms || 0));
      return end >= current - behindMs && time <= current + aheadMs && time >= practice.startMs - 1 && time < practice.endMs;
    });

    const previousViewMode = state.viz.viewMode;
    state.viz.viewMode = "chart";
    for (const note of visible) {
      if (Number(note.sustain_ms || 0) <= 0) continue;
      const lane = Number(note.lane);
      const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
      const y1 = receptorY + direction * (Number(note.time_ms) - current) * pixelsPerMs;
      const y2 = receptorY + direction * (Number(note.end_ms ?? Number(note.time_ms) + Number(note.sustain_ms || 0)) - current) * pixelsPerMs;
      drawHold(ctx, lane, cx, laneWidth * 0.48, y1, y2, 0.82, note);
    }

    for (const note of visible) {
      const lane = Number(note.lane);
      const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
      const y = receptorY + direction * (Number(note.time_ms) - current) * pixelsPerMs;
      const size = Math.min(laneWidth * 0.94, 86);
      const noteState = practice.noteStates.get(note._practiceId);
      let status = isHazardNote(note) ? "hazard" : "normal";
      if (noteState?.status === "hit") status = "matched";
      if (noteState?.status === "missed") status = "missed";
      if (noteState?.status === "hazard-hit") status = "hazard-hit";
      if (noteState?.status === "hazard-safe") status = "hazard-safe";
      drawNote(ctx, lane, cx, y, size, status, noteState?.status === "missed" ? 0.45 : 1, note);
      if (noteState?.holdDropped) {
        ctx.fillStyle = "#ff9f68";
        ctx.font = "900 11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("DROP", cx, y - 22 * direction);
      }
    }

    for (let lane = 0; lane < keyCount; lane++) {
      const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
      drawReceptor(ctx, lane, cx, receptorY, Math.min(laneWidth * 0.94, 86), practice.activeLanes.has(lane), 1);
    }

    if (state.viz.showSplashes !== false) {
      for (const note of visible) {
        const noteState = practice.noteStates.get(note._practiceId);
        if (noteState?.status !== "hit") continue;
        const age = current - Number(noteState.hitAt);
        if (age < 0 || age > 265) continue;
        const lane = Number(note.lane);
        const cx = startX + lane * (laneWidth + laneGap) + laneWidth / 2;
        drawAtlasSplash(ctx, lane, cx, receptorY, Math.min(laneWidth * 0.94, 86), age, noteState.judgment, note, false);
      }
    }
    state.viz.viewMode = previousViewMode;
    ctx.restore();

    ctx.fillStyle = "rgba(117,230,255,.8)";
    ctx.font = "800 11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(`${practice.keyCount}K · ${Math.round(practice.speed * 100)}%`, startX + 10, practice.downscroll ? height - 27 : 37);
    ctx.textAlign = "right";
    ctx.fillText(`${practice.completedLoops} loop${practice.completedLoops === 1 ? "" : "s"}`, startX + fieldWidth - 10, practice.downscroll ? height - 27 : 37);

    if (practice.lastJudgment && now <= practice.judgmentUntil) {
      const fade = clamp((practice.judgmentUntil - now) / 600, 0, 1);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = "center";
      ctx.fillStyle = practice.lastJudgment === "Miss" || practice.lastJudgment === "Hurt" || practice.lastJudgment === "Hold drop" ? "#ff6b8a" : "#f5f7ff";
      ctx.font = "900 31px system-ui";
      ctx.fillText(practice.lastJudgment, width / 2, height / 2 - 10);
      if (practice.lastDelta !== null) {
        ctx.font = "800 13px ui-monospace, monospace";
        ctx.fillStyle = practice.lastDelta < 0 ? "#75e6ff" : "#ffd166";
        ctx.fillText(`${practice.lastDelta >= 0 ? "+" : ""}${Math.round(practice.lastDelta)} ms`, width / 2, height / 2 + 17);
      }
      ctx.restore();
    }

    const overlay = q("#practiceOverlay");
    if (practice.playing && current < practice.startMs) {
      const remaining = practice.startMs - current;
      const count = Math.max(1, Math.ceil(remaining / 500));
      overlay.innerHTML = `${count}<small>${formatPracticeTime(practice.startMs)} start</small>`;
      overlay.classList.remove("hidden");
    } else if (practice.playing) {
      overlay.classList.add("hidden");
    }
  }

  const originalGo = go;
  go = view => {
    if (view !== "practice" && practice.playing) stopPractice();
    const result = originalGo(view);
    if (view === "practice") {
      populatePracticeSongs();
      updatePracticeAudioStatus();
      requestAnimationFrame(() => drawPractice());
    }
    return result;
  };

  const originalPopulateVisualizerSongs = populateVisualizerSongs;
  populateVisualizerSongs = () => {
    const result = originalPopulateVisualizerSongs();
    populatePracticeSongs();
    return result;
  };

  window.rilPracticeEngine = {
      practice,
      setPracticeRange,
      seekPractice,
      formatPracticeTime,
      accuracy,
    };

    installPracticeView();
  populatePracticeSongs();
  updatePracticeAudioStatus();
  updatePracticeButtons();
  updatePracticeHud();
  renderLastAttempt();
  requestAnimationFrame(practiceAnimationLoop);
  setTimeout(populatePracticeSongs, 500);
})();
