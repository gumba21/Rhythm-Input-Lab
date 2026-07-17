"use strict";

(() => {
  const q = selector => document.querySelector(selector);
  const qa = selector => [...document.querySelectorAll(selector)];

  state.viz.practice ||= {
    mode: "song",
    startMs: 0,
    endMs: 0,
    label: "Entire song",
    loopEnabled: false,
    loopCount: 0,
  };

  const practice = () => state.viz.practice;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  function formatPracticeTime(ms) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
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

  function practiceStorageKey() {
    return state.viz.songFolder ? `ril-practice:${state.viz.songFolder}` : null;
  }

  function bookmarkStorageKey() {
    return state.viz.songFolder ? `ril-bookmarks:${state.viz.songFolder}` : null;
  }

  function savePracticeState() {
    const key = practiceStorageKey();
    if (!key) return;
    const p = practice();
    localStorage.setItem(key, JSON.stringify({
      mode: p.mode,
      startMs: p.startMs,
      endMs: p.endMs,
      label: p.label,
      loopEnabled: p.loopEnabled,
      playbackRate: state.viz.playbackRate,
    }));
  }

  function readPracticeState() {
    const key = practiceStorageKey();
    if (!key) return null;
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }

  function sectionRanges() {
    const rows = state.viz.bundle?.sections || [];
    const chartDuration = Math.max(0, Number(state.viz.chartDurationMs || state.viz.durationMs || 0));
    if (!rows.length) {
      return chartDuration ? [{ index: 0, startMs: 0, endMs: chartDuration, bpm: Number(state.viz.bundle?.summary?.base_bpm || 0), noteCount: expectedChartNotes().length }] : [];
    }

    let cursor = 0;
    const sections = rows.map((row, index) => {
      const bpm = Math.max(1, Number(row.bpm || state.viz.bundle?.summary?.base_bpm || 120));
      const steps = Math.max(1, Number(row.length_in_steps || 16));
      const duration = steps * (60000 / bpm / 4);
      const startMs = cursor;
      cursor += duration;
      return {
        index: Number.isFinite(Number(row.section_index)) ? Number(row.section_index) : index,
        startMs,
        endMs: cursor,
        bpm,
        mustHit: Boolean(row.must_hit_section),
        noteCount: 0,
      };
    });

    const byIndex = new Map(sections.map(section => [section.index, section]));
    for (const note of expectedChartNotes()) {
      const section = byIndex.get(Number(note.section_index));
      if (section) section.noteCount += 1;
    }

    if (chartDuration && sections.length) {
      sections[sections.length - 1].endMs = Math.max(sections[sections.length - 1].endMs, chartDuration);
    }
    return sections;
  }

  function sectionAt(timeMs) {
    const sections = sectionRanges();
    if (!sections.length) return null;
    return sections.find(section => timeMs >= section.startMs && timeMs < section.endMs)
      || sections[sections.length - 1];
  }

  function gradeFor(accuracy) {
    if (accuracy === null || accuracy === undefined || !Number.isFinite(Number(accuracy))) return "—";
    if (accuracy >= 98) return "S";
    if (accuracy >= 93) return "A";
    if (accuracy >= 85) return "B";
    if (accuracy >= 75) return "C";
    if (accuracy >= 60) return "D";
    return "F";
  }

  function rangeAnalysis(startMs, endMs) {
    const notes = expectedChartNotes().filter(note => {
      const time = Number(note.time_ms || 0);
      return time >= startMs && time < endMs;
    });
    const comparison = state.viz.comparison;
    if (!comparison) {
      return {
        authored: notes.length,
        total: 0,
        matched: 0,
        misses: 0,
        accuracy: null,
        hitRate: null,
        early: 0,
        late: 0,
        maxCombo: 0,
        hazardsHit: 0,
        hazardsAvoided: 0,
      };
    }

    const coveredIds = new Set((comparison.coveredNotes || []).map(note => note._id));
    const covered = notes.filter(note => coveredIds.has(note._id));
    const weights = { Sick: 1, Good: 0.75, Bad: 0.5, Shit: 0.25 };
    let matched = 0;
    let misses = 0;
    let weighted = 0;
    let early = 0;
    let late = 0;
    let combo = 0;
    let maxCombo = 0;

    for (const note of covered.sort((a, b) => Number(a.time_ms) - Number(b.time_ms))) {
      const match = comparison.matchByNote?.get(note._id);
      if (match) {
        matched += 1;
        const judgment = judgmentFor(match.delta_ms);
        weighted += weights[judgment] ?? 0;
        if (match.delta_ms < 0) early += 1;
        else late += 1;
        combo += 1;
        maxCombo = Math.max(maxCombo, combo);
      } else if (comparison.missedNoteIds?.has(note._id)) {
        misses += 1;
        combo = 0;
      }
    }

    const hazards = (comparison.hazards?.attempts || []).filter(item => {
      const time = Number(item.note?.time_ms || 0);
      return time >= startMs && time < endMs;
    });
    const total = matched + misses;
    return {
      authored: notes.length,
      total,
      matched,
      misses,
      accuracy: total ? weighted / total * 100 : null,
      hitRate: total ? matched / total * 100 : null,
      early,
      late,
      maxCombo,
      hazardsHit: hazards.filter(item => item.hit).length,
      hazardsAvoided: hazards.filter(item => !item.hit).length,
    };
  }

  function weakestSection() {
    if (!state.viz.comparison) return null;
    const ranked = sectionRanges()
      .map(section => ({ section, stats: rangeAnalysis(section.startMs, section.endMs) }))
      .filter(item => item.stats.total > 0)
      .sort((a, b) => {
        const accuracyDifference = Number(a.stats.accuracy ?? 101) - Number(b.stats.accuracy ?? 101);
        if (accuracyDifference) return accuracyDifference;
        return b.stats.misses - a.stats.misses;
      });
    return ranked[0] || null;
  }

  function missTimes() {
    const comparison = state.viz.comparison;
    if (!comparison) return [];
    return expectedChartNotes()
      .filter(note => comparison.missedNoteIds?.has(note._id))
      .map(note => Number(note.time_ms || 0))
      .sort((a, b) => a - b);
  }

  function nearestMiss(direction) {
    const misses = missTimes();
    if (!misses.length) return null;
    const now = state.viz.currentMs;
    if (direction > 0) return misses.find(time => time > now + 1) ?? misses[0];
    return [...misses].reverse().find(time => time < now - 1) ?? misses[misses.length - 1];
  }

  function setPracticeRange(startMs, endMs, options = {}) {
    const duration = Math.max(0, Number(state.viz.durationMs || state.viz.chartDurationMs || 0));
    let start = clamp(startMs, 0, duration);
    let end = clamp(endMs, 0, duration);
    if (end < start) [start, end] = [end, start];
    if (end - start < 25) end = Math.min(duration, start + 25);

    const p = practice();
    p.startMs = start;
    p.endMs = end;
    if (options.mode) p.mode = options.mode;
    if (options.label) p.label = options.label;
    if (options.resetLoops !== false) p.loopCount = 0;

    const startInput = q("#practiceStart");
    const endInput = q("#practiceEnd");
    const mode = q("#practiceMode");
    if (startInput && document.activeElement !== startInput) startInput.value = formatPracticeTime(start);
    if (endInput && document.activeElement !== endInput) endInput.value = formatPracticeTime(end);
    if (mode) mode.value = p.mode;

    const section = sectionAt(start + Math.min(1, Math.max(0, end - start) / 2));
    if (section && q("#practiceSection")) q("#practiceSection").value = String(section.index);

    updatePracticePanel();
    savePracticeState();
  }

  function applyPracticeMode(mode) {
    const duration = Math.max(0, Number(state.viz.durationMs || state.viz.chartDurationMs || 0));
    const p = practice();
    p.mode = mode;

    if (mode === "song") {
      setPracticeRange(0, duration, { mode, label: "Entire song" });
      return;
    }
    if (mode === "section") {
      const section = sectionAt(state.viz.currentMs);
      if (section) setPracticeRange(section.startMs, section.endMs, { mode, label: `Section ${section.index + 1}` });
      return;
    }
    if (mode === "weakest") {
      const weakest = weakestSection();
      if (!weakest) {
        toast("Load an analyzed attempt before selecting the weakest section.", "error");
        q("#practiceMode").value = p.mode = "custom";
        return;
      }
      setPracticeRange(weakest.section.startMs, weakest.section.endMs, {
        mode,
        label: `Weakest · Section ${weakest.section.index + 1}`,
      });
      return;
    }
    if (mode === "last-miss") {
      const time = nearestMiss(-1);
      if (time === null) {
        toast("No reconstructed misses are available.", "error");
        q("#practiceMode").value = p.mode = "custom";
        return;
      }
      const section = sectionAt(time);
      if (section) {
        setPracticeRange(section.startMs, section.endMs, {
          mode,
          label: `Miss at ${formatPracticeTime(time)} · Section ${section.index + 1}`,
        });
        seekTo(Math.max(section.startMs, time - 750));
      }
      return;
    }

    updatePracticePanel();
    savePracticeState();
  }

  function setSection(index) {
    const section = sectionRanges().find(item => item.index === Number(index));
    if (!section) return;
    setPracticeRange(section.startMs, section.endMs, {
      mode: "section",
      label: `Section ${section.index + 1}`,
    });
    seekTo(section.startMs);
  }

  function shiftSection(delta) {
    const sections = sectionRanges();
    if (!sections.length) return;
    const current = sectionAt(state.viz.currentMs) || sections[0];
    const position = Math.max(0, sections.findIndex(section => section.index === current.index));
    const target = sections[clamp(position + delta, 0, sections.length - 1)];
    setSection(target.index);
  }

  function setPlaybackRate(rate) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0) return;
    state.viz.playbackRate = value;
    const select = q("#playbackRate");
    if (select && ![...select.options].some(option => Number(option.value) === value)) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${Math.round(value * 100)}%`;
      select.appendChild(option);
      [...select.options]
        .sort((a, b) => Number(a.value) - Number(b.value))
        .forEach(option => select.appendChild(option));
    }
    if (select) select.value = String(value);
    for (const audio of audioElements()) audio.playbackRate = value;
    qa(".practice-speed").forEach(button => button.classList.toggle("primary", Number(button.dataset.rate) === value));
    savePracticeState();
  }

  function toggleLoop(force) {
    const p = practice();
    p.loopEnabled = force === undefined ? !p.loopEnabled : Boolean(force);
    if (p.loopEnabled && (state.viz.currentMs < p.startMs || state.viz.currentMs >= p.endMs)) seekTo(p.startMs);
    updatePracticePanel();
    savePracticeState();
  }

  function bookmarkRows() {
    const key = bookmarkStorageKey();
    if (!key) return [];
    try {
      const rows = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function saveBookmarks(rows) {
    const key = bookmarkStorageKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(rows));
    renderBookmarks();
  }

  function addBookmark() {
    if (!state.viz.bundle) return;
    const input = q("#practiceBookmarkLabel");
    const rows = bookmarkRows();
    const label = input?.value.trim() || `Bookmark ${rows.length + 1}`;
    rows.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timeMs: Math.round(state.viz.currentMs),
      label,
    });
    rows.sort((a, b) => Number(a.timeMs) - Number(b.timeMs));
    saveBookmarks(rows);
    if (input) input.value = "";
    toast(`Bookmarked ${formatPracticeTime(state.viz.currentMs)}.`);
  }

  function renderBookmarks() {
    const target = q("#practiceBookmarks");
    if (!target) return;
    const rows = bookmarkRows();
    target.innerHTML = rows.length
      ? rows.map(row => `
        <div class="practice-bookmark">
          <button class="practice-bookmark-jump" data-id="${escapeHtml(row.id)}">
            <b>${escapeHtml(row.label)}</b><span class="mono">${formatPracticeTime(row.timeMs)}</span>
          </button>
          <button class="icon-button compact practice-bookmark-delete" data-id="${escapeHtml(row.id)}" title="Delete bookmark">×</button>
        </div>
      `).join("")
      : '<div class="list-sub">No bookmarks for this song.</div>';

    qa(".practice-bookmark-jump", target).forEach(button => button.addEventListener("click", () => {
      const row = bookmarkRows().find(item => item.id === button.dataset.id);
      if (row) seekTo(Number(row.timeMs));
    }));
    qa(".practice-bookmark-delete", target).forEach(button => button.addEventListener("click", () => {
      saveBookmarks(bookmarkRows().filter(item => item.id !== button.dataset.id));
    }));
  }

  function recommendationFor(stats) {
    if (stats.accuracy === null) return "Load an attempt for a speed recommendation.";
    if (stats.accuracy < 70) return "Recommended: 50% speed · 5 loops";
    if (stats.accuracy < 85) return "Recommended: 75% speed · 4 loops";
    if (stats.accuracy < 93) return "Recommended: 90% speed · 3 loops";
    if (stats.accuracy < 98) return "Recommended: 95% speed · 2 loops";
    return "Recommended: 100% speed · polish consistency";
  }

  function updatePracticeRangeMarker() {
    const fill = q("#practiceRangeFill");
    const caption = q("#practiceRangeCaption");
    if (!fill || !caption) return;
    const duration = Math.max(1, Number(state.viz.durationMs || state.viz.chartDurationMs || 1));
    const p = practice();
    const left = clamp(p.startMs / duration * 100, 0, 100);
    const right = clamp(p.endMs / duration * 100, 0, 100);
    fill.style.left = `${left}%`;
    fill.style.width = `${Math.max(0.4, right - left)}%`;
    caption.textContent = `${p.label} · ${formatPracticeTime(p.startMs)} → ${formatPracticeTime(p.endMs)}`;
  }

  function updatePracticePanel() {
    const panel = q("#practicePanel");
    if (!panel) return;
    const p = practice();
    const stats = rangeAnalysis(p.startMs, p.endMs);
    const grade = gradeFor(stats.accuracy);

    q("#practiceLoopToggle").textContent = `Loop ${p.loopEnabled ? "on" : "off"}`;
    q("#practiceLoopToggle").classList.toggle("primary", p.loopEnabled);
    q("#practiceLoopCount").textContent = `${p.loopCount} completed loop${p.loopCount === 1 ? "" : "s"}`;
    q("#practiceRangeLabel").textContent = p.label;
    q("#practiceGrade").textContent = grade;
    q("#practiceAccuracy").textContent = stats.accuracy === null ? "—" : `${formatNumber(stats.accuracy, 2)}%`;
    q("#practiceHits").textContent = stats.total ? `${stats.matched} / ${stats.total}` : `0 / ${stats.authored}`;
    q("#practiceMisses").textContent = formatNumber(stats.misses);
    q("#practiceCombo").textContent = formatNumber(stats.maxCombo);
    q("#practiceTiming").textContent = stats.total ? `${stats.early} early · ${stats.late} late` : "—";
    q("#practiceHazards").textContent = `${stats.hazardsAvoided} avoided · ${stats.hazardsHit} hit`;
    q("#practiceRecommendation").textContent = recommendationFor(stats);
    updatePracticeRangeMarker();
  }

  function populateSections() {
    const select = q("#practiceSection");
    if (!select) return;
    const sections = sectionRanges();
    select.innerHTML = sections.map(section => `
      <option value="${section.index}">Section ${section.index + 1} · ${formatPracticeTime(section.startMs)} · ${section.noteCount} notes</option>
    `).join("");
    const current = sectionAt(state.viz.currentMs);
    if (current) select.value = String(current.index);
  }

  function restoreForSong() {
    const duration = Math.max(0, Number(state.viz.durationMs || state.viz.chartDurationMs || 0));
    const saved = readPracticeState();
    practice().loopCount = 0;
    populateSections();
    renderBookmarks();

    if (saved && Number(saved.endMs) > Number(saved.startMs)) {
      setPracticeRange(saved.startMs, saved.endMs, {
        mode: saved.mode || "custom",
        label: saved.label || "Saved range",
      });
      practice().loopEnabled = Boolean(saved.loopEnabled);
      setPlaybackRate(Number(saved.playbackRate || 1));
    } else {
      practice().loopEnabled = false;
      setPracticeRange(0, duration, { mode: "song", label: "Entire song" });
      setPlaybackRate(1);
    }
    updatePracticePanel();
  }

  function installPracticePanel() {
    const inspector = q(".inspector");
    const visualizerBottom = q(".visualizer-bottom");
    if (!inspector || !visualizerBottom || q("#practicePanel")) return;

    const panel = document.createElement("div");
    panel.id = "practicePanel";
    panel.className = "inspector-block practice-panel";
    panel.innerHTML = `
      <div class="practice-heading">
        <div><h2>Practice</h2><div id="practiceRangeLabel" class="list-sub">Entire song</div></div>
        <button id="practiceLoopToggle" class="button small">Loop off</button>
      </div>

      <div class="field practice-mode-field">
        <label>Practice range</label>
        <select id="practiceMode">
          <option value="song">Entire song</option>
          <option value="section">Current section</option>
          <option value="custom">Custom range</option>
          <option value="weakest">Weakest section</option>
          <option value="last-miss">Last miss section</option>
        </select>
      </div>

      <div class="practice-section-row">
        <button id="practicePrevSection" class="icon-button compact" title="Previous section">‹</button>
        <select id="practiceSection" aria-label="Chart section"></select>
        <button id="practiceNextSection" class="icon-button compact" title="Next section">›</button>
      </div>

      <div class="practice-range-inputs">
        <div class="field"><label>Start</label><input id="practiceStart" class="mono" value="0:00.000"></div>
        <div class="field"><label>End</label><input id="practiceEnd" class="mono" value="0:00.000"></div>
      </div>
      <div class="actions practice-range-actions">
        <button id="practiceSetStart" class="button small">Set start here</button>
        <button id="practiceSetEnd" class="button small">Set end here</button>
      </div>

      <div class="practice-subtitle">Speed presets</div>
      <div class="practice-speed-row">
        <button class="button small practice-speed" data-rate="0.5">50%</button>
        <button class="button small practice-speed" data-rate="0.75">75%</button>
        <button class="button small practice-speed" data-rate="0.9">90%</button>
        <button class="button small practice-speed" data-rate="0.95">95%</button>
        <button class="button small practice-speed" data-rate="1">100%</button>
      </div>

      <div class="practice-subtitle">Miss navigation</div>
      <div class="actions">
        <button id="practicePreviousMiss" class="button small">Previous miss</button>
        <button id="practiceNextMiss" class="button small">Next miss</button>
      </div>

      <div class="practice-stats">
        <div class="practice-grade"><span>Grade</span><b id="practiceGrade">—</b></div>
        <div><span>Accuracy</span><b id="practiceAccuracy">—</b></div>
        <div><span>Hits</span><b id="practiceHits">—</b></div>
        <div><span>Misses</span><b id="practiceMisses">—</b></div>
        <div><span>Best combo</span><b id="practiceCombo">—</b></div>
        <div><span>Timing</span><b id="practiceTiming">—</b></div>
        <div class="practice-stat-wide"><span>Hazards</span><b id="practiceHazards">—</b></div>
      </div>
      <div id="practiceRecommendation" class="practice-recommendation">Load an attempt for a speed recommendation.</div>
      <div id="practiceLoopCount" class="list-sub">0 completed loops</div>

      <div class="practice-subtitle">Bookmarks</div>
      <div class="practice-bookmark-add">
        <input id="practiceBookmarkLabel" placeholder="Optional label">
        <button id="practiceAddBookmark" class="button small">Add current</button>
      </div>
      <div id="practiceBookmarks" class="practice-bookmarks"></div>
    `;
    inspector.prepend(panel);

    const rangeTrack = document.createElement("div");
    rangeTrack.id = "practiceRangeTrack";
    rangeTrack.className = "practice-range-track";
    rangeTrack.innerHTML = '<div id="practiceRangeFill" class="practice-range-fill"></div><span id="practiceRangeCaption">Entire song</span>';
    visualizerBottom.prepend(rangeTrack);

    q("#practiceLoopToggle").addEventListener("click", () => toggleLoop());
    q("#practiceMode").addEventListener("change", event => applyPracticeMode(event.target.value));
    q("#practiceSection").addEventListener("change", event => setSection(event.target.value));
    q("#practicePrevSection").addEventListener("click", () => shiftSection(-1));
    q("#practiceNextSection").addEventListener("click", () => shiftSection(1));
    q("#practiceSetStart").addEventListener("click", () => {
      setPracticeRange(state.viz.currentMs, practice().endMs, { mode: "custom", label: "Custom range" });
    });
    q("#practiceSetEnd").addEventListener("click", () => {
      setPracticeRange(practice().startMs, state.viz.currentMs, { mode: "custom", label: "Custom range" });
    });

    const commitRange = () => {
      const start = parsePracticeTime(q("#practiceStart").value);
      const end = parsePracticeTime(q("#practiceEnd").value);
      if (start === null || end === null) {
        toast("Use times like 1:24.283.", "error");
        updatePracticePanel();
        return;
      }
      setPracticeRange(start, end, { mode: "custom", label: "Custom range" });
    };
    q("#practiceStart").addEventListener("change", commitRange);
    q("#practiceEnd").addEventListener("change", commitRange);

    qa(".practice-speed").forEach(button => button.addEventListener("click", () => setPlaybackRate(button.dataset.rate)));
    q("#practicePreviousMiss").addEventListener("click", () => {
      const time = nearestMiss(-1);
      if (time === null) return toast("No reconstructed misses are available.", "error");
      seekTo(Math.max(0, time - 500));
    });
    q("#practiceNextMiss").addEventListener("click", () => {
      const time = nearestMiss(1);
      if (time === null) return toast("No reconstructed misses are available.", "error");
      seekTo(Math.max(0, time - 500));
    });
    q("#practiceAddBookmark").addEventListener("click", addBookmark);
    q("#practiceBookmarkLabel").addEventListener("keydown", event => {
      if (event.key === "Enter") addBookmark();
    });
  }

  function installStyles() {
    if (q("#practiceStyles")) return;
    const style = document.createElement("style");
    style.id = "practiceStyles";
    style.textContent = `
      .practice-panel{display:grid;gap:12px}
      .practice-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .practice-mode-field{margin-top:0}
      .practice-section-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:7px;align-items:center}
      .practice-section-row select{min-width:0}
      .practice-range-inputs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .practice-range-actions{margin-top:-4px}
      .practice-subtitle{margin-top:3px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
      .practice-speed-row{display:grid;grid-template-columns:repeat(5,1fr);gap:5px}
      .practice-speed-row .button{padding-inline:4px}
      .practice-stats{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      .practice-stats>div{display:flex;flex-direction:column;gap:3px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.025)}
      .practice-stats span{font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}
      .practice-stats b{font-size:13px}
      .practice-stats .practice-grade b{font-size:28px;line-height:1}
      .practice-stats .practice-stat-wide{grid-column:1/-1}
      .practice-recommendation{padding:10px 11px;border-radius:10px;background:rgba(117,230,255,.07);border:1px solid rgba(117,230,255,.18);font-size:12px}
      .practice-bookmark-add{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}
      .practice-bookmarks{display:grid;gap:6px;max-height:170px;overflow:auto}
      .practice-bookmark{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:center}
      .practice-bookmark-jump{display:flex;justify-content:space-between;gap:8px;align-items:center;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.02);color:inherit;text-align:left;cursor:pointer}
      .practice-bookmark-jump:hover{background:rgba(255,255,255,.055)}
      .practice-bookmark-jump span{font-size:10px;color:var(--muted)}
      .practice-range-track{position:relative;height:24px;margin:0 0 7px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.025);overflow:hidden}
      .practice-range-fill{position:absolute;inset-block:0;left:0;width:100%;background:rgba(117,230,255,.18);border-inline:1px solid rgba(117,230,255,.55)}
      .practice-range-track span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 8px;font-size:10px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
      @media(max-width:900px){.practice-speed-row{grid-template-columns:repeat(3,1fr)}}
    `;
    document.head.appendChild(style);
  }

  function wrapVisualizerFunctions() {
    const originalLoadVisualizer = loadVisualizer;
    loadVisualizer = async (songFolder, attemptFolder = null) => {
      await originalLoadVisualizer(songFolder, attemptFolder);
      if (state.viz.bundle && state.viz.songFolder === songFolder) restoreForSong();
    };

    const originalLoadAttempt = loadAttemptForCurrent;
    loadAttemptForCurrent = async attemptFolder => {
      await originalLoadAttempt(attemptFolder);
      updatePracticePanel();
    };

    const originalRecomputeComparison = recomputeComparison;
    recomputeComparison = () => {
      originalRecomputeComparison();
      updatePracticePanel();
    };

    const originalUpdateTimeUI = updateTimeUI;
    updateTimeUI = () => {
      const p = practice();
      if (
        p.loopEnabled
        && state.viz.playing
        && p.endMs > p.startMs
        && state.viz.currentMs >= p.endMs - 1
      ) {
        state.viz.currentMs = p.startMs;
        p.loopCount += 1;
        syncAudioTracks(true);
      }
      originalUpdateTimeUI();
      if (q("#practiceLoopCount")) {
        q("#practiceLoopCount").textContent = `${p.loopCount} completed loop${p.loopCount === 1 ? "" : "s"}`;
      }
    };

    const originalTogglePlayback = togglePlayback;
    togglePlayback = () => {
      const p = practice();
      if (
        !state.viz.playing
        && p.loopEnabled
        && (state.viz.currentMs < p.startMs || state.viz.currentMs >= p.endMs)
      ) seekTo(p.startMs);
      originalTogglePlayback();
    };

    const originalClearReplay = clearCurrentReplay;
    clearCurrentReplay = () => {
      originalClearReplay();
      updatePracticePanel();
    };
  }

  installStyles();
  installPracticePanel();
  wrapVisualizerFunctions();
  populateSections();
  renderBookmarks();
  updatePracticePanel();
})();
