"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const weights = { Sick: 1, Good: 0.75, Bad: 0.5, Shit: 0.25, Miss: 0 };
  const DEFAULT_HANDS = {
    4: ["L", "L", "R", "R"],
    5: ["L", "L", "C", "R", "R"],
    6: ["L", "L", "L", "R", "R", "R"],
    7: ["L", "L", "L", "C", "R", "R", "R"],
    8: ["L", "L", "L", "L", "R", "R", "R", "R"],
    9: ["L", "L", "L", "L", "C", "R", "R", "R", "R"],
  };
  const PATTERN_HELP = {
    jack: "The same lane repeated quickly.",
    trill: "Strict alternation between two lanes.",
    roll: "A repeated sequence of three to six unique lanes.",
    stair: "A strict ascending or descending lane run.",
    stream: "A long, mostly even run of fast notes.",
    burst: "A short run significantly denser than nearby charting.",
    chordstream: "A stream containing frequent chords.",
    holdstream: "A stream containing hold notes.",
    panning: "A run that consistently travels left or right.",
    flam: "Different-lane notes close enough to feel like one motion.",
    chord: "Two or more notes sharing one timing point.",
    bracket: "6K only: an outer two-note chord alternating with its middle lane.",
    ringtrill: "6K only: a strict trill on lanes 1–2 or 5–6.",
  };

  const model = {
    folder: null,
    song: null,
    bundle: null,
    attempts: [],
    attemptA: null,
    attemptB: null,
    reportA: null,
    reportB: null,
    loading: false,
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  function formatTime(ms, digits = 2) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    return `${minutes}:${(total - minutes * 60).toFixed(digits).padStart(digits + 3, "0")}`;
  }

  function formatNumber(value, digits = 1, suffix = "") {
    if (!Number.isFinite(Number(value))) return "—";
    return `${Number(value).toFixed(digits)}${suffix}`;
  }

  function medianValue(values) {
    const rows = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!rows.length) return null;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  }

  async function jsonApi(path) {
    const response = await fetch(path);
    const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.data;
  }

  function isHazard(note) {
    if (typeof window.isHazardNote === "function") return window.isHazardNote(note);
    const name = String(note?.note_type || "").toLocaleLowerCase();
    return name.includes("hurt") || name.includes("mine") || name.includes("hazard");
  }

  function playableNotes(bundle = model.bundle) {
    return (bundle?.notes || []).filter(note => note.owner === "player" && Number.isInteger(Number(note.lane)) && !isHazard(note));
  }

  function handMaps() {
    const stored = window.state?.settings?.analysis?.hand_maps || {};
    const result = {};
    for (let keyCount = 4; keyCount <= 9; keyCount++) {
      const row = stored[String(keyCount)] || stored[keyCount];
      result[keyCount] = Array.isArray(row) && row.length === keyCount ? row.map(normalizeHand) : DEFAULT_HANDS[keyCount].slice();
    }
    return result;
  }

  function normalizeHand(value) {
    const text = String(value || "").trim().toUpperCase();
    return ["L", "R", "C"].includes(text) ? text : "C";
  }

  function handName(code) {
    return code === "L" ? "Left" : code === "R" ? "Right" : "Center";
  }

  function installSettings() {
    const profileCard = q("#profileSettings")?.closest(".card");
    if (!profileCard || q("#analysisHandSettings")) return;
    const block = document.createElement("div");
    block.id = "analysisHandSettings";
    block.className = "analysis-hand-settings";
    block.innerHTML = `<div class="divider"></div><h2>Analysis hand assignment</h2><p>Choose which hand normally controls each lane. Use L, R, or C for a shared center lane.</p><div id="analysisHandRows"></div><div class="list-sub">These mappings affect one-hand pattern labels and lane coaching; they do not change your keybinds.</div>`;
    profileCard.appendChild(block);
    renderHandSettings();

    const save = q("#saveSettingsButton");
    save?.addEventListener("click", () => {
      if (!window.state?.settings) return;
      window.state.settings.analysis ||= {};
      window.state.settings.analysis.hand_maps = {};
      qa(".analysis-hand-row").forEach(row => {
        const keyCount = Number(row.dataset.mode);
        const values = qa("select", row).map(select => normalizeHand(select.value));
        window.state.settings.analysis.hand_maps[String(keyCount)] = values;
      });
    }, true);
  }

  function renderHandSettings() {
    const root = q("#analysisHandRows");
    if (!root) return;
    const maps = handMaps();
    root.innerHTML = Object.entries(maps).map(([keyCount, values]) => `<div class="analysis-hand-row" data-mode="${keyCount}"><div class="mode-badge">${keyCount}K</div><div class="analysis-hand-lanes">${values.map((value, lane) => `<label><span>${lane + 1}</span><select><option value="L"${value === "L" ? " selected" : ""}>L</option><option value="C"${value === "C" ? " selected" : ""}>C</option><option value="R"${value === "R" ? " selected" : ""}>R</option></select></label>`).join("")}</div></div>`).join("");
  }

  function installView() {
    if (q('[data-view="analysis"]')) return;
    const nav = document.createElement("button");
    nav.className = "nav-button";
    nav.dataset.view = "analysis";
    nav.innerHTML = '<span class="nav-icon">⌁</span>Analysis';
    const practice = q('[data-view="practice"]') || q('[data-view="visualizer"]');
    practice.parentElement.insertBefore(nav, practice.nextSibling);

    const section = document.createElement("section");
    section.id = "view-analysis";
    section.className = "view";
    section.innerHTML = `
      <div class="page-head">
        <div><div class="eyebrow">4.7 coaching and analysis</div><h1>Analysis.</h1><p>Find weak sections, lane problems, strict pattern failures, likely miss causes, and the exact ranges worth practicing.</p></div>
        <div class="actions analysis-head-actions"><select id="analysisSongSelect"><option value="">Choose song</option></select><select id="analysisAttemptA"><option value="">Choose attempt</option></select><button id="analysisRefresh" class="button primary">Analyze</button></div>
      </div>
      <div id="analysisEmpty" class="card empty">Choose an imported song and attempt. Chart-only pattern analysis is available even before an attempt exists.</div>
      <div id="analysisWorkspace" class="analysis-workspace hidden">
        <section class="grid metrics" id="analysisOverview"></section>
        <section class="grid two analysis-main-grid">
          <article class="card pad"><div class="section-title"><div><div class="eyebrow">Coach</div><h2>What to work on</h2></div></div><div id="analysisCoach" class="analysis-coach"></div></article>
          <article class="card pad"><div class="section-title"><div><div class="eyebrow">Consistency</div><h2>Beginning → ending</h2></div></div><div id="analysisFatigue"></div></article>
        </section>
        <article class="card pad analysis-block"><div class="section-title"><div><div class="eyebrow">Exact ranges</div><h2>Weakest sections</h2></div><span class="list-sub">Strictly ranked from reconstructed results</span></div><div id="analysisSections" class="analysis-table"></div></article>
        <article class="card pad analysis-block"><div class="section-title"><div><div class="eyebrow">Hands and columns</div><h2>Lane performance</h2></div></div><div id="analysisLanes" class="analysis-table"></div></article>
        <article class="card pad analysis-block"><div class="section-title"><div><div class="eyebrow">General rhythm vocabulary</div><h2>Pattern detector</h2><p>High-confidence labels only. Messy near-patterns stay unlabeled instead of being guessed.</p></div></div><div id="analysisPatterns" class="analysis-patterns"></div></article>
        <section class="grid two analysis-main-grid">
          <article class="card pad"><div class="section-title"><div><div class="eyebrow">Estimates, not mind reading</div><h2>Likely miss causes</h2></div></div><div id="analysisCauses"></div></article>
          <article class="card pad"><div class="section-title"><div><div class="eyebrow">Attempt comparison</div><h2>Compare progress</h2></div></div><div class="analysis-compare-picker"><select id="analysisAttemptB"><option value="">Choose another attempt</option></select></div><div id="analysisComparison"></div></article>
        </section>
      </div>
    `;
    q("main.main").appendChild(section);
  nav.addEventListener("click", () => window.go("analysis"));

    q("#analysisSongSelect").addEventListener("change", event => loadSong(event.target.value));
    q("#analysisAttemptA").addEventListener("change", () => analyzeSelected());
    q("#analysisAttemptB").addEventListener("change", () => compareSelected());
    q("#analysisRefresh").addEventListener("click", analyzeSelected);
  }

  function populateSongs() {
    const select = q("#analysisSongSelect");
    if (!select || !window.state?.songs) return;
    const current = select.value;
    const rows = window.state.songs.filter(song => song.has_chart).sort((a, b) => String(a.song_name).localeCompare(String(b.song_name), undefined, { numeric: true, sensitivity: "base" }));
    const signature = rows.map(song => `${song.folder}:${song.song_name}`).join("|");
    if (select.dataset.signature === signature) return;
    select.innerHTML = `<option value="">Choose song</option>${rows.map(song => `<option value="${esc(song.folder)}">${esc(song.song_name)}</option>`).join("")}`;
    if (rows.some(song => song.folder === current)) select.value = current;
    select.dataset.signature = signature;
  }

  async function loadSong(folder) {
    if (!folder || model.loading) return;
    model.loading = true;
    q("#analysisEmpty").textContent = "Loading chart and attempts…";
    try {
      const data = await jsonApi(`/api/song?folder=${encodeURIComponent(folder)}`);
      model.folder = folder;
      model.song = data.song;
      model.bundle = data.bundle;
      model.attempts = data.attempts || [];
      populateAttempts();
      await analyzeSelected();
    } catch (error) {
      q("#analysisEmpty").classList.remove("hidden");
      q("#analysisWorkspace").classList.add("hidden");
      q("#analysisEmpty").textContent = `Analysis could not load: ${error.message}`;
    } finally {
      model.loading = false;
    }
  }

  function practiceAttemptAvailable() {
    const attempt = window.rilPracticeEngine?.practice?.lastAttempt;
    return attempt && attempt.songFolder === model.folder;
  }

  function populateAttempts() {
    const options = [];
    if (practiceAttemptAvailable()) options.push(`<option value="__practice__">Current Practice attempt</option>`);
    options.push(...model.attempts.map(attempt => `<option value="${esc(attempt.folder)}">Attempt ${String(attempt.attempt_number ?? "—").padStart(3, "0")} · ${esc(attempt.recorded_at || "")}</option>`));
    for (const id of ["analysisAttemptA", "analysisAttemptB"]) {
      const select = q(`#${id}`);
      const current = select.value;
      select.innerHTML = `${id === "analysisAttemptB" ? '<option value="">Choose another attempt</option>' : '<option value="">Chart only</option>'}${options.join("")}`;
      if ([...select.options].some(option => option.value === current)) select.value = current;
    }
    if (!q("#analysisAttemptA").value && options.length) q("#analysisAttemptA").value = practiceAttemptAvailable() ? "__practice__" : model.attempts[0]?.folder || "";
  }

  async function readAttempt(value) {
    if (!value) return null;
    if (value === "__practice__") {
      const attempt = window.rilPracticeEngine?.practice?.lastAttempt;
      if (!attempt) return null;
      return {
        folder: "Practice attempt",
        session: { song_name: attempt.songName, key_count: attempt.keyCount, lane_keys: attempt.laneKeys, recorded_at: attempt.completedAt },
        presses: attempt.presses,
      };
    }
    return jsonApi(`/api/attempt?folder=${encodeURIComponent(model.folder)}&attempt=${encodeURIComponent(value)}`);
  }

  async function analyzeSelected() {
    if (!model.bundle) return;
    const value = q("#analysisAttemptA")?.value || "";
    try {
      model.attemptA = await readAttempt(value);
      model.reportA = buildReport(model.bundle, model.attemptA);
      renderReport(model.reportA);
      q("#analysisEmpty").classList.add("hidden");
      q("#analysisWorkspace").classList.remove("hidden");
      await compareSelected();
    } catch (error) {
      q("#analysisEmpty").classList.remove("hidden");
      q("#analysisWorkspace").classList.add("hidden");
      q("#analysisEmpty").textContent = `Analysis failed: ${error.message}`;
    }
  }

  async function compareSelected() {
    if (!model.bundle || !model.reportA) return;
    const value = q("#analysisAttemptB")?.value || "";
    model.attemptB = value ? await readAttempt(value).catch(() => null) : null;
    model.reportB = model.attemptB ? buildReport(model.bundle, model.attemptB) : null;
    renderComparison();
  }

  function autoOffset(notes, presses, outer) {
    if (!notes.length || !presses.length || typeof window.matchChart !== "function") return 0;
    let best = { offset: 0, matches: -1, median: Infinity };
    const test = offset => {
      const result = window.matchChart(notes, presses, offset, outer);
      const med = result.medianAbsolute ?? Infinity;
      if (result.matches.length > best.matches || (result.matches.length === best.matches && med < best.median)) best = { offset, matches: result.matches.length, median: med };
    };
    for (let offset = -1000; offset <= 1000; offset += 20) test(offset);
    const coarse = best.offset;
    for (let offset = coarse - 24; offset <= coarse + 24; offset += 2) test(offset);
    return best.offset;
  }

  function buildReport(bundle, attempt) {
    const notes = playableNotes(bundle).map((note, index) => ({ ...note, _id: index }));
    const presses = (attempt?.presses || []).filter(press => press.role === "lane" && Number.isInteger(Number(press.lane))).map((press, index) => ({ ...press, id: press.id ?? index, lane: Number(press.lane), time_ms: Number(press.time_ms), held_ms: Number(press.held_ms || 0) }));
    const outer = typeof window.getChartWindows === "function" ? window.getChartWindows().outer : 166.667;
    const offset = attempt ? autoOffset(notes, presses, outer) : 0;
    const match = attempt && typeof window.matchChart === "function" ? window.matchChart(notes, presses, offset, outer) : emptyMatch(notes, presses);
    const sections = buildSections(bundle, notes).map(section => ({ ...section, metrics: metricsFor(section.notes, match) }));
    const lanes = buildLanes(bundle, notes, match);
    const moments = buildMoments(notes);
    const patterns = detectPatterns(moments, Number(bundle.summary?.key_count || 4)).map(pattern => ({ ...pattern, metrics: metricsFor(pattern.notes, match) }));
    const total = metricsFor(notes, match);
    const thirds = splitThirds(notes, match);
    const causes = likelyCauses(notes, presses, match, patterns, outer);
    return { bundle, attempt, notes, presses, match, offset, sections, lanes, moments, patterns, total, thirds, causes };
  }

  function emptyMatch(notes, presses) {
    return { chartOnly: true, matches: [], missedNoteIds: new Set(), extraPressIds: new Set(presses.map(press => press.id)), matchByNote: new Map(), matchByPress: new Map(), offsets: [], coveredNotes: notes };
  }

  function judgment(delta) {
    if (typeof window.judgmentFor === "function") return window.judgmentFor(delta);
    const abs = Math.abs(delta);
    return abs <= 45 ? "Sick" : abs <= 90 ? "Good" : abs <= 135 ? "Bad" : abs <= 166.667 ? "Shit" : "Miss";
  }

  function metricsFor(notes, match) {
    const rows = notes || [];
    if (match.chartOnly) {
      return { notes: rows.length, matches: 0, misses: 0, counts: { Sick: 0, Good: 0, Bad: 0, Shit: 0, Miss: 0 }, accuracy: null, hitRate: null, median: null, medianAbs: null, early: 0, late: 0, holdDrops: 0, chartOnly: true };
    }
    const matches = rows.map(note => match.matchByNote.get(note._id)).filter(Boolean);
    const missed = rows.filter(note => !match.matchByNote.has(note._id));
    const counts = { Sick: 0, Good: 0, Bad: 0, Shit: 0, Miss: missed.length };
    matches.forEach(row => counts[judgment(row.delta_ms)]++);
    const total = rows.length;
    const weighted = Object.entries(counts).reduce((sum, [name, count]) => sum + (weights[name] || 0) * count, 0);
    const offsets = matches.map(row => Number(row.delta_ms));
    const holdDrops = matches.filter(row => Number(row.note.sustain_ms || 0) > 0 && Number(row.press.held_ms || 0) + 45 < Number(row.note.sustain_ms || 0)).length;
    return {
      notes: total,
      matches: matches.length,
      misses: missed.length,
      counts,
      accuracy: total ? weighted / total * 100 : null,
      hitRate: total ? matches.length / total * 100 : null,
      median: medianValue(offsets),
      medianAbs: medianValue(offsets.map(Math.abs)),
      early: offsets.filter(value => value < 0).length,
      late: offsets.filter(value => value >= 0).length,
      holdDrops,
    };
  }

  function buildSections(bundle, notes) {
    const raw = bundle.sections || [];
    if (!raw.length) return chunkByTime(notes, Number(bundle.summary?.duration_ms || 0), 10000);
    let cursor = 0;
    const sections = raw.map((row, index) => {
      const bpm = Math.max(1, Number(row.bpm || bundle.summary?.base_bpm || 120));
      const steps = Math.max(1, Number(row.length_in_steps || 16));
      const startMs = cursor;
      cursor += steps * (60000 / bpm / 4);
      return { index, label: `Section ${index + 1}`, startMs, endMs: cursor, bpm, notes: [] };
    });
    if (sections.length) sections.at(-1).endMs = Math.max(sections.at(-1).endMs, Number(bundle.summary?.duration_ms || 0));
    for (const note of notes) {
      const found = sections.find(section => note.time_ms >= section.startMs && note.time_ms < section.endMs) || sections.at(-1);
      found?.notes.push(note);
    }
    return sections;
  }

  function chunkByTime(notes, duration, size) {
    const count = Math.max(1, Math.ceil(Math.max(duration, notes.at(-1)?.time_ms || 0) / size));
    return Array.from({ length: count }, (_, index) => {
      const startMs = index * size;
      const endMs = Math.min(Math.max(duration, startMs + size), startMs + size);
      return { index, label: `Range ${index + 1}`, startMs, endMs, bpm: null, notes: notes.filter(note => note.time_ms >= startMs && note.time_ms < endMs) };
    });
  }

  function buildLanes(bundle, notes, match) {
    const keyCount = Number(bundle.summary?.key_count || Math.max(4, ...notes.map(note => Number(note.lane) + 1)));
    const hands = handMaps()[keyCount] || DEFAULT_HANDS[keyCount] || [];
    return Array.from({ length: keyCount }, (_, lane) => {
      const laneNotes = notes.filter(note => Number(note.lane) === lane);
      return { lane, hand: hands[lane] || "C", metrics: metricsFor(laneNotes, match) };
    });
  }

  function splitThirds(notes, match) {
    if (!notes.length) return [];
    const start = notes[0].time_ms;
    const end = notes.at(-1).time_ms + 1;
    const span = Math.max(1, end - start);
    return [0, 1, 2].map(index => {
      const from = start + span * index / 3;
      const to = start + span * (index + 1) / 3;
      return { label: ["Beginning", "Middle", "Ending"][index], startMs: from, endMs: to, metrics: metricsFor(notes.filter(note => note.time_ms >= from && note.time_ms < to), match) };
    });
  }

  function buildMoments(notes) {
    const chordWindow = Number(window.state?.settings?.thresholds?.chord_ms || 35);
    const sorted = notes.slice().sort((a, b) => a.time_ms - b.time_ms || a.lane - b.lane);
    const moments = [];
    for (const note of sorted) {
      const last = moments.at(-1);
      if (last && note.time_ms - last.timeMs <= chordWindow) {
        last.notes.push(note);
        last.lanes.push(Number(note.lane));
        last.lanes.sort((a, b) => a - b);
      } else moments.push({ timeMs: Number(note.time_ms), notes: [note], lanes: [Number(note.lane)] });
    }
    moments.forEach(moment => { moment.token = moment.lanes.length > 1 ? `[${moment.lanes.map(lane => lane + 1).join("")}]` : String(moment.lanes[0] + 1); });
    return moments;
  }

  function pattern(type, moments, confidence = 1) {
    const notes = moments.flatMap(moment => moment.notes);
    return {
      id: `${type}-${moments[0].timeMs}-${moments.at(-1).timeMs}`,
      type,
      startMs: Math.max(0, moments[0].timeMs - 250),
      endMs: moments.at(-1).timeMs + Math.max(500, Number(moments.at(-1).notes[0]?.sustain_ms || 0) + 250),
      moments,
      notes,
      confidence,
      shorthand: moments.map(moment => moment.token).join(""),
    };
  }

  function detectPatterns(moments, keyCount) {
    const found = [];
    const singles = moment => moment.lanes.length === 1;
    const gap = (a, b) => b.timeMs - a.timeMs;
    const maxFast = Number(window.state?.settings?.thresholds?.jack_ms || 250);

    for (const moment of moments) if (moment.lanes.length > 1) found.push(pattern("chord", [moment]));

    for (let start = 0; start < moments.length;) {
      let end = start + 1;
      while (end < moments.length && singles(moments[start]) && singles(moments[end]) && moments[end].lanes[0] === moments[start].lanes[0] && gap(moments[end - 1], moments[end]) <= maxFast) end++;
      if (end - start >= 3) found.push(pattern("jack", moments.slice(start, end)));
      start = Math.max(start + 1, end);
    }

    for (let start = 0; start < moments.length - 4; start++) {
      if (!singles(moments[start]) || !singles(moments[start + 1])) continue;
      const a = moments[start].lanes[0], b = moments[start + 1].lanes[0];
      if (a === b || gap(moments[start], moments[start + 1]) > maxFast) continue;
      let end = start + 2;
      while (end < moments.length) {
        const expected = (end - start) % 2 === 0 ? a : b;
        if (!singles(moments[end]) || moments[end].lanes[0] !== expected || gap(moments[end - 1], moments[end]) > maxFast) break;
        end++;
      }
      if (end - start >= 5) {
        const type = keyCount === 6 && ((a === 0 && b === 1) || (a === 4 && b === 5)) ? "ringtrill" : "trill";
        found.push(pattern(type, moments.slice(start, end)));
        start = end - 2;
      }
    }

    for (let start = 0; start < moments.length - 3; start++) {
      if (!singles(moments[start])) continue;
      const direction = moments[start + 1]?.lanes?.[0] - moments[start].lanes[0];
      if (![1, -1].includes(direction)) continue;
      let end = start + 2;
      while (end < moments.length && singles(moments[end]) && moments[end].lanes[0] - moments[end - 1].lanes[0] === direction && gap(moments[end - 1], moments[end]) <= maxFast * 1.4) end++;
      if (end - start >= 4) found.push(pattern("stair", moments.slice(start, end)));
    }

    for (let start = 0; start < moments.length - 5; start++) {
      if (!singles(moments[start])) continue;
      for (let length = 3; length <= 6 && start + length * 2 <= moments.length; length++) {
        const first = moments.slice(start, start + length);
        const second = moments.slice(start + length, start + length * 2);
        if (first.some(moment => !singles(moment)) || second.some(moment => !singles(moment))) continue;
        const lanes = first.map(moment => moment.lanes[0]);
        if (new Set(lanes).size !== length) continue;
        if (lanes.every((lane, index) => lane === second[index].lanes[0])) {
          found.push(pattern("roll", moments.slice(start, start + length * 2)));
          start += length * 2 - 2;
          break;
        }
      }
    }

    let runStart = 0;
    while (runStart < moments.length - 3) {
      let runEnd = runStart + 1;
      while (runEnd < moments.length) {
        const interval = gap(moments[runEnd - 1], moments[runEnd]);
        if (interval < 20 || interval > 260) break;
        runEnd++;
      }
      const run = moments.slice(runStart, runEnd);
      if (run.length >= 4) {
        const intervals = run.slice(1).map((moment, index) => gap(run[index], moment));
        const med = medianValue(intervals) || 999;
        const consistent = intervals.filter(value => Math.abs(value - med) <= Math.max(22, med * 0.28)).length / intervals.length >= 0.75;
        if (consistent) {
          const hasHold = run.some(moment => moment.notes.some(note => Number(note.sustain_ms || 0) > 0));
          const chordRatio = run.filter(moment => moment.lanes.length > 1).length / run.length;
          const type = run.length >= 8 ? hasHold ? "holdstream" : chordRatio >= 0.25 ? "chordstream" : "stream" : "burst";
          found.push(pattern(type, run, 0.92));
        }
      }
      runStart = Math.max(runStart + 1, runEnd);
    }

    for (let start = 0; start < moments.length - 4; start++) {
      const run = moments.slice(start, start + 5);
      if (run.some(moment => !singles(moment))) continue;
      const differences = run.slice(1).map((moment, index) => moment.lanes[0] - run[index].lanes[0]);
      const signs = differences.filter(value => value !== 0).map(Math.sign);
      if (signs.length >= 4 && signs.every(sign => sign === signs[0])) found.push(pattern("panning", run, 0.9));
    }

    for (let index = 1; index < moments.length; index++) {
      const interval = gap(moments[index - 1], moments[index]);
      if (interval >= 10 && interval <= 45 && singles(moments[index - 1]) && singles(moments[index]) && moments[index - 1].lanes[0] !== moments[index].lanes[0]) found.push(pattern("flam", [moments[index - 1], moments[index]], 0.9));
    }

    if (keyCount === 6) {
      for (let start = 0; start < moments.length - 4; start++) {
        const run = moments.slice(start, start + 5);
        const left = run.every((moment, index) => index % 2 === 0 ? moment.token === "[13]" : moment.token === "2");
        const right = run.every((moment, index) => index % 2 === 0 ? moment.token === "[46]" : moment.token === "5");
        if (left || right) found.push(pattern("bracket", run));
      }
    }

    const deduped = new Map();
    for (const row of found) deduped.set(`${row.type}:${Math.round(row.startMs)}:${Math.round(row.endMs)}`, row);
    return [...deduped.values()].sort((a, b) => a.startMs - b.startMs || a.type.localeCompare(b.type));
  }

  function likelyCauses(notes, presses, match, patterns, outer) {
    const missed = notes.filter(note => !match.matchByNote.has(note._id));
    const extras = presses.filter(press => match.extraPressIds.has(press.id));
    const wrongLane = missed.filter(note => extras.some(press => press.lane !== note.lane && Math.abs((press.time_ms - matchOffset(match)) - note.time_ms) <= outer)).length;
    const dense = missed.filter(note => notes.filter(other => Math.abs(other.time_ms - note.time_ms) <= 350).length >= 5).length;
    const missedTimes = missed.map(note => note.time_ms).sort((a, b) => a - b);
    const cascades = missedTimes.filter((time, index) => index && time - missedTimes[index - 1] <= 650).length;
    const offsets = match.offsets || [];
    const strongEarly = offsets.filter(value => value < -45).length;
    const strongLate = offsets.filter(value => value > 45).length;
    const holdDrops = match.matches.filter(row => Number(row.note.sustain_ms || 0) > 0 && Number(row.press.held_ms || 0) + 45 < Number(row.note.sustain_ms || 0)).length;
    const patternMisses = new Map();
    for (const patternRow of patterns) {
      const misses = patternRow.metrics.misses;
      if (misses) patternMisses.set(patternRow.type, (patternMisses.get(patternRow.type) || 0) + misses);
    }
    const worstPattern = [...patternMisses.entries()].sort((a, b) => b[1] - a[1])[0];
    const rows = [
      { label: "Late presses", count: strongLate, note: "Matched notes landing more than 45 ms late." },
      { label: "Early presses", count: strongEarly, note: "Matched notes landing more than 45 ms early." },
      { label: "Possible wrong lane", count: wrongLane, note: "A different-lane extra input occurred near a missed note." },
      { label: "Dense cluster misses", count: dense, note: "Misses surrounded by at least four nearby notes." },
      { label: "Miss cascades", count: cascades, note: "Misses occurring shortly after another miss." },
      { label: "Dropped holds", count: holdDrops, note: "The head was hit but the recorded hold ended early." },
    ];
    if (worstPattern) rows.push({ label: `${title(worstPattern[0])} trouble`, count: worstPattern[1], note: `Misses found inside strict ${worstPattern[0]} detections.` });
    return rows.sort((a, b) => b.count - a.count);
  }

  function matchOffset(match) {
    const rows = match.matches || [];
    if (!rows.length) return 0;
    return medianValue(rows.map(row => row.press.time_ms - row.note.time_ms - row.delta_ms)) || 0;
  }

  function title(value) {
    return String(value || "").replace(/(^|[-_\s])\w/g, match => match.toUpperCase());
  }

  function renderReport(report) {
    const total = report.total;
    const keyCount = Number(report.bundle.summary?.key_count || 4);
    const attemptLabel = report.attempt?.folder || "Chart only";
    q("#analysisOverview").innerHTML = [
      metric("Accuracy", total.accuracy == null ? "Chart only" : formatNumber(total.accuracy, 2, "%"), attemptLabel),
      metric("Misses", total.accuracy == null ? "—" : total.misses, `${total.matches}/${total.notes} matched`),
      metric("Median timing", total.median == null ? "—" : `${total.median >= 0 ? "+" : ""}${formatNumber(total.median, 1, " ms")}`, `${total.early} early · ${total.late} late`),
      metric("Auto alignment", report.attempt ? `${report.offset >= 0 ? "+" : ""}${report.offset} ms` : "—", `${keyCount}K · strict reconstruction`),
    ].join("");
    renderCoach(report);
    renderFatigue(report);
    renderSections(report);
    renderLanes(report);
    renderPatterns(report);
    renderCauses(report);
  }

  function metric(label, value, note) {
    return `<div class="card metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note || "")}</div></div>`;
  }

  function weakest(rows, minimumNotes = 1) {
    return rows.filter(row => row.metrics.notes >= minimumNotes && row.metrics.accuracy != null).sort((a, b) => a.metrics.accuracy - b.metrics.accuracy || b.metrics.misses - a.metrics.misses)[0] || null;
  }

  function renderCoach(report) {
    if (!report.attempt) {
      q("#analysisCoach").innerHTML = `<div class="analysis-callout"><b>Chart structure is ready.</b><span>Load an attempt to rank weak sections and likely causes. Pattern detection below still works from the chart alone.</span></div>`;
      return;
    }
    const weakSection = weakest(report.sections, 3);
    const weakLane = weakest(report.lanes, 3);
    const grouped = groupPatterns(report.patterns);
    const weakPattern = weakest(grouped, 3);
    const cause = report.causes.find(row => row.count > 0);
    q("#analysisCoach").innerHTML = `
      ${weakSection ? coachRow("Weakest section", `${formatTime(weakSection.startMs)}–${formatTime(weakSection.endMs)}`, `${formatNumber(weakSection.metrics.accuracy, 2, "%")} · ${weakSection.metrics.misses} misses`, weakSection.startMs, weakSection.endMs) : ""}
      ${weakLane ? coachRow("Weakest lane", `Lane ${weakLane.lane + 1} · ${handName(weakLane.hand)} hand`, `${formatNumber(weakLane.metrics.accuracy, 2, "%")} · ${weakLane.metrics.misses} misses`) : ""}
      ${weakPattern ? coachRow("Weakest strict pattern", title(weakPattern.type), `${formatNumber(weakPattern.metrics.accuracy, 2, "%")} · ${weakPattern.metrics.misses} misses`) : ""}
      ${cause ? `<div class="analysis-callout warn"><b>Most visible issue: ${esc(cause.label)}</b><span>${cause.count} observations. ${esc(cause.note)}</span></div>` : `<div class="analysis-callout good"><b>No dominant failure cause</b><span>This attempt is either clean or the remaining mistakes are too mixed for a confident label.</span></div>`}
    `;
    bindPracticeButtons(q("#analysisCoach"));
  }

  function coachRow(label, titleText, detail, startMs = null, endMs = null) {
    return `<div class="analysis-coach-row"><span>${esc(label)}</span><div><b>${esc(titleText)}</b><small>${esc(detail)}</small></div>${startMs != null ? `<button class="button small analysis-practice" data-start="${startMs}" data-end="${endMs}">Practice</button>` : ""}</div>`;
  }

  function renderFatigue(report) {
    q("#analysisFatigue").innerHTML = report.thirds.map((third, index) => `<div class="analysis-third"><span>${third.label}</span><b>${third.metrics.accuracy == null ? "—" : formatNumber(third.metrics.accuracy, 2, "%")}</b><small>${third.metrics.misses} misses · ${third.metrics.median == null ? "no timing" : `${third.metrics.median >= 0 ? "+" : ""}${formatNumber(third.metrics.median, 1, " ms")}`}</small><div class="analysis-bar"><i style="width:${clamp(third.metrics.accuracy || 0, 0, 100)}%"></i></div></div>`).join("") || `<div class="list-sub">Load an attempt to compare consistency.</div>`;
    if (report.attempt && report.thirds.length === 3) {
      const first = report.thirds[0].metrics.accuracy;
      const last = report.thirds[2].metrics.accuracy;
      const note = q("#analysisFatigue").appendChild(document.createElement("div"));
      note.className = `analysis-callout ${last != null && first != null && last + 4 < first ? "warn" : "good"}`;
      note.innerHTML = last != null && first != null && last + 4 < first ? `<b>Possible stamina decline</b><span>The ending is ${formatNumber(first - last, 2, "%")} below the beginning. This is a correlation, not proof of physical fatigue.</span>` : `<b>Stable through the ending</b><span>No large cumulative accuracy drop appears between the first and final third.</span>`;
    }
  }

  function renderSections(report) {
    const rows = report.sections.slice().sort((a, b) => {
      if (a.metrics.accuracy == null && b.metrics.accuracy == null) return a.startMs - b.startMs;
      if (a.metrics.accuracy == null) return 1;
      if (b.metrics.accuracy == null) return -1;
      return a.metrics.accuracy - b.metrics.accuracy || b.metrics.misses - a.metrics.misses;
    });
    q("#analysisSections").innerHTML = tableHeader(["Range", "Notes", "Accuracy", "Misses", "Timing", ""]) + rows.slice(0, 16).map(row => `<div class="analysis-table-row"><div><b>${esc(row.label)}</b><small>${formatTime(row.startMs)}–${formatTime(row.endMs)}</small></div><div>${row.metrics.notes}</div><div>${row.metrics.accuracy == null ? "—" : formatNumber(row.metrics.accuracy, 2, "%")}</div><div>${row.metrics.misses}</div><div>${row.metrics.median == null ? "—" : `${row.metrics.median >= 0 ? "+" : ""}${formatNumber(row.metrics.median, 1, " ms")}`}</div><div><button class="button small analysis-practice" data-start="${row.startMs}" data-end="${row.endMs}">Practice</button></div></div>`).join("");
    bindPracticeButtons(q("#analysisSections"));
  }

  function renderLanes(report) {
    q("#analysisLanes").innerHTML = tableHeader(["Lane", "Hand", "Notes", "Accuracy", "Misses", "Median"]) + report.lanes.map(row => `<div class="analysis-table-row"><div><b>Lane ${row.lane + 1}</b></div><div><span class="analysis-hand ${row.hand.toLowerCase()}">${handName(row.hand)}</span></div><div>${row.metrics.notes}</div><div>${row.metrics.accuracy == null ? "—" : formatNumber(row.metrics.accuracy, 2, "%")}</div><div>${row.metrics.misses}</div><div>${row.metrics.median == null ? "—" : `${row.metrics.median >= 0 ? "+" : ""}${formatNumber(row.metrics.median, 1, " ms")}`}</div></div>`).join("");
  }

  function tableHeader(labels) {
    return `<div class="analysis-table-head">${labels.map(label => `<div>${esc(label)}</div>`).join("")}</div>`;
  }

  function groupPatterns(patterns) {
    const groups = new Map();
    for (const row of patterns) {
      if (!groups.has(row.type)) groups.set(row.type, []);
      groups.get(row.type).push(row);
    }
    return [...groups.entries()].map(([type, instances]) => {
      const notes = instances.flatMap(instance => instance.notes);
      const metrics = aggregateMetrics(instances.map(instance => instance.metrics));
      return { type, instances, notes, metrics };
    }).sort((a, b) => (a.metrics.accuracy ?? 101) - (b.metrics.accuracy ?? 101) || b.instances.length - a.instances.length);
  }

  function aggregateMetrics(rows) {
    if (rows.length && rows.every(row => row.chartOnly)) {
      return { notes: rows.reduce((sum, row) => sum + Number(row.notes || 0), 0), misses: 0, counts: { Sick: 0, Good: 0, Bad: 0, Shit: 0, Miss: 0 }, accuracy: null, chartOnly: true };
    }
    const counts = { Sick: 0, Good: 0, Bad: 0, Shit: 0, Miss: 0 };
    rows.forEach(row => Object.keys(counts).forEach(name => { counts[name] += Number(row.counts?.[name] || 0); }));
    const notes = rows.reduce((sum, row) => sum + Number(row.notes || 0), 0);
    const weighted = Object.entries(counts).reduce((sum, [name, count]) => sum + (weights[name] || 0) * count, 0);
    return { notes, misses: counts.Miss, counts, accuracy: notes ? weighted / notes * 100 : null };
  }

  function renderPatterns(report) {
    const groups = groupPatterns(report.patterns);
    if (!groups.length) {
      q("#analysisPatterns").innerHTML = `<div class="empty">No strict patterns were detected. The analyzer intentionally avoids labeling uncertain fragments.</div>`;
      return;
    }
    q("#analysisPatterns").innerHTML = groups.map(group => {
      const failed = group.instances.filter(instance => instance.metrics.misses > 0);
      const sample = group.instances[0]?.shorthand || "";
      return `<article class="analysis-pattern-card"><div class="analysis-pattern-head"><div><h3>${title(group.type)}</h3><p>${esc(PATTERN_HELP[group.type] || "Strict detected pattern.")}</p></div><span>${group.instances.length} found</span></div><div class="analysis-pattern-stats"><div><span>Accuracy</span><b>${group.metrics.accuracy == null ? "Chart only" : formatNumber(group.metrics.accuracy, 2, "%")}</b></div><div><span>Misses</span><b>${group.metrics.misses}</b></div><div><span>Sample</span><b class="mono">${esc(sample.slice(0, 34))}${sample.length > 34 ? "…" : ""}</b></div></div><div class="comfort-actions"><button class="button small analysis-pattern-practice" data-type="${esc(group.type)}"${failed.length ? "" : " disabled"}>Practice worst</button><button class="button small analysis-pattern-collection" data-type="${esc(group.type)}"${failed.length ? "" : " disabled"}>Save failures as collection</button></div></article>`;
    }).join("");
    qa(".analysis-pattern-practice", q("#analysisPatterns")).forEach(button => button.addEventListener("click", () => {
      const group = groups.find(row => row.type === button.dataset.type);
      const worst = group?.instances.filter(instance => instance.metrics.misses > 0).sort((a, b) => b.metrics.misses - a.metrics.misses || (a.metrics.accuracy ?? 101) - (b.metrics.accuracy ?? 101))[0];
      if (worst) openPractice(worst.startMs, worst.endMs, `${title(group.type)} failure`);
    }));
    qa(".analysis-pattern-collection", q("#analysisPatterns")).forEach(button => button.addEventListener("click", () => createPatternCollection(button.dataset.type, groups)));
  }

  function renderCauses(report) {
    if (!report.attempt) {
      q("#analysisCauses").innerHTML = `<div class="list-sub">Miss-cause estimates require an attempt.</div>`;
      return;
    }
    q("#analysisCauses").innerHTML = report.causes.slice(0, 7).map((row, index) => `<div class="analysis-cause"><span>${index + 1}</span><div><b>${esc(row.label)}</b><small>${esc(row.note)}</small></div><strong>${row.count}</strong></div>`).join("");
  }

  function renderComparison() {
    const root = q("#analysisComparison");
    if (!model.reportB) {
      root.innerHTML = `<div class="list-sub">Choose another attempt to compare reconstructed results.</div>`;
      return;
    }
    const a = model.reportA.total;
    const b = model.reportB.total;
    const delta = (next, previous) => Number.isFinite(next) && Number.isFinite(previous) ? next - previous : null;
    const accuracyDelta = delta(b.accuracy, a.accuracy);
    const missDelta = delta(b.misses, a.misses);
    const timingDelta = delta(b.medianAbs, a.medianAbs);
    root.innerHTML = `<div class="analysis-compare-grid">${compareMetric("Accuracy", a.accuracy, b.accuracy, accuracyDelta, "%", true)}${compareMetric("Misses", a.misses, b.misses, missDelta, "", false)}${compareMetric("Median abs.", a.medianAbs, b.medianAbs, timingDelta, " ms", false)}${compareMetric("Hold drops", a.holdDrops, b.holdDrops, delta(b.holdDrops, a.holdDrops), "", false)}</div>`;
  }

  function compareMetric(label, before, after, difference, suffix, higherBetter) {
    const improvement = difference == null ? null : higherBetter ? difference : -difference;
    const className = improvement == null ? "" : improvement > 0 ? "good" : improvement < 0 ? "bad" : "";
    return `<div class="analysis-compare-metric ${className}"><span>${esc(label)}</span><b>${before == null ? "—" : formatNumber(before, Number.isInteger(before) ? 0 : 2, suffix)} → ${after == null ? "—" : formatNumber(after, Number.isInteger(after) ? 0 : 2, suffix)}</b><small>${difference == null ? "No comparable value" : `${difference >= 0 ? "+" : ""}${formatNumber(difference, Number.isInteger(difference) ? 0 : 2, suffix)}`}</small></div>`;
  }

  function bindPracticeButtons(root) {
    qa(".analysis-practice", root).forEach(button => button.addEventListener("click", () => openPractice(Number(button.dataset.start), Number(button.dataset.end), "Analysis range")));
  }

  function openPractice(startMs, endMs, label) {
    const folder = model.folder;
    if (!folder) return;
    if (typeof window.go === "function") window.go("practice");
    const select = q("#practiceSongSelect");
    if (select && select.value !== folder) {
      select.value = folder;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const deadline = performance.now() + 8000;
    const apply = () => {
      const engine = window.rilPracticeEngine;
      if (engine?.practice?.songFolder === folder && engine.practice.bundle) {
        engine.setPracticeRange(startMs, endMs, label || "Analysis range");
        engine.seekPractice(startMs);
        q("#practiceRangeMode").value = "custom";
        if (typeof toast === "function") toast(`Loaded ${formatTime(startMs)}–${formatTime(endMs)} from Analysis.`);
      } else if (performance.now() < deadline) setTimeout(apply, 80);
    };
    apply();
  }

  function createPatternCollection(type, groups) {
    const group = groups.find(row => row.type === type);
    const failures = group?.instances.filter(instance => instance.metrics.misses > 0).sort((a, b) => a.startMs - b.startMs) || [];
    if (!failures.length) return;
    try {
      const key = "ril-practice-comfort:v1";
      const store = JSON.parse(localStorage.getItem(key) || "null") || {};
      store.collections = Array.isArray(store.collections) ? store.collections : [];
      const id = `analysis-${type}-${Date.now().toString(36)}`;
      store.collections.unshift({
        id,
        name: `${model.song.song_name} · ${title(type)} failures`,
        createdAt: new Date().toISOString(),
        items: failures.slice(0, 40).map((instance, index) => ({
          id: `${id}-${index}`,
          label: `${title(type)} ${index + 1} · ${formatTime(instance.startMs)}–${formatTime(instance.endMs)}`,
          songFolder: model.folder,
          songName: model.song.song_name,
          startMs: instance.startMs,
          endMs: instance.endMs,
          settings: null,
        })),
      });
      localStorage.setItem(key, JSON.stringify(store));
      if (typeof toast === "function") toast(`Saved ${failures.length} ${type} failure ranges as a Practice collection.`);
    } catch (error) {
      if (typeof toast === "function") toast(`Could not save collection: ${error.message}`, "error");
    }
  }

  function installStyles() {
    if (q("#analysisStyles")) return;
    const style = document.createElement("style");
    style.id = "analysisStyles";
    style.textContent = `
      .analysis-workspace{display:grid;gap:16px}.analysis-main-grid{align-items:start}.analysis-block{overflow:hidden}.analysis-head-actions select{min-width:190px}
      .analysis-coach{display:grid;gap:8px}.analysis-coach-row{display:grid;grid-template-columns:120px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:10px}.analysis-coach-row>span{font-size:10px;text-transform:uppercase;color:var(--muted);font-weight:800}.analysis-coach-row div{display:flex;flex-direction:column}.analysis-coach-row small{color:var(--muted)}
      .analysis-callout{display:flex;flex-direction:column;gap:3px;padding:11px;border-radius:10px;border:1px solid var(--line);background:rgba(117,230,255,.07)}.analysis-callout.warn{background:rgba(255,209,102,.08);border-color:rgba(255,209,102,.28)}.analysis-callout.good{background:rgba(105,240,174,.07);border-color:rgba(105,240,174,.24)}.analysis-callout span{font-size:12px;color:var(--muted);line-height:1.45}
      #analysisFatigue{display:grid;gap:9px}.analysis-third{display:grid;grid-template-columns:80px 74px 1fr;gap:8px;align-items:center}.analysis-third span{font-size:11px;color:var(--muted)}.analysis-third small{text-align:right;color:var(--muted)}.analysis-bar{grid-column:1/-1;height:5px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden}.analysis-bar i{display:block;height:100%;background:var(--accent)}
      .analysis-table{display:grid;margin-top:12px;overflow:auto}.analysis-table-head,.analysis-table-row{display:grid;grid-template-columns:minmax(140px,1.4fr) repeat(4,minmax(78px,.7fr)) 92px;gap:10px;align-items:center;min-width:680px;padding:9px 10px}.analysis-table-head{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);border-bottom:1px solid var(--line)}.analysis-table-row{border-bottom:1px solid var(--line);font-size:12px}.analysis-table-row:last-child{border-bottom:0}.analysis-table-row>div:first-child{display:flex;flex-direction:column}.analysis-table-row small{color:var(--muted)}
      .analysis-hand{display:inline-flex;padding:3px 7px;border-radius:999px;font-size:10px;font-weight:900}.analysis-hand.l{color:#75e6ff;background:rgba(117,230,255,.12)}.analysis-hand.r{color:#ff8ba1;background:rgba(255,107,138,.12)}.analysis-hand.c{color:#ffd166;background:rgba(255,209,102,.12)}
      .analysis-patterns{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:12px}.analysis-pattern-card{padding:12px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.018)}.analysis-pattern-head{display:flex;justify-content:space-between;gap:12px}.analysis-pattern-head h3{margin:0}.analysis-pattern-head p{margin:4px 0 0;font-size:11px;color:var(--muted);line-height:1.4}.analysis-pattern-head>span{font-size:10px;white-space:nowrap;color:var(--muted)}.analysis-pattern-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}.analysis-pattern-stats div{display:flex;flex-direction:column;min-width:0;padding:7px;background:rgba(255,255,255,.025);border-radius:7px}.analysis-pattern-stats span{font-size:9px;text-transform:uppercase;color:var(--muted)}.analysis-pattern-stats b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
      .analysis-cause{display:grid;grid-template-columns:25px 1fr auto;gap:9px;align-items:center;padding:9px;border-bottom:1px solid var(--line)}.analysis-cause>span{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.05);font-size:10px}.analysis-cause div{display:flex;flex-direction:column}.analysis-cause small{color:var(--muted);line-height:1.35}.analysis-cause strong{font-size:18px}
      .analysis-compare-picker{margin-bottom:10px}.analysis-compare-picker select{width:100%}.analysis-compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.analysis-compare-metric{display:flex;flex-direction:column;padding:10px;border:1px solid var(--line);border-radius:9px}.analysis-compare-metric span,.analysis-compare-metric small{font-size:10px;color:var(--muted)}.analysis-compare-metric.good{border-color:rgba(105,240,174,.3)}.analysis-compare-metric.bad{border-color:rgba(255,107,138,.3)}
      .analysis-hand-settings{margin-top:16px}.analysis-hand-row{display:grid;grid-template-columns:48px minmax(0,1fr);gap:8px;align-items:center;margin:8px 0}.analysis-hand-lanes{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(36px,1fr);gap:4px}.analysis-hand-lanes label{display:flex;flex-direction:column;gap:2px}.analysis-hand-lanes span{text-align:center;font-size:9px;color:var(--muted)}.analysis-hand-lanes select{padding:5px 3px;text-align:center}
      @media(max-width:800px){.analysis-head-actions{display:grid!important;grid-template-columns:1fr 1fr}.analysis-head-actions select:first-child{grid-column:1/-1}.analysis-coach-row{grid-template-columns:1fr}.analysis-coach-row>span{margin-bottom:-4px}.analysis-third{grid-template-columns:70px 70px 1fr}}
    `;
    document.head.appendChild(style);
  }

  let handSettingsSignature = "";
  function syncHandSettings() {
    const signature = JSON.stringify(handMaps());
    if (signature !== handSettingsSignature && q("#analysisHandRows")) {
      handSettingsSignature = signature;
      renderHandSettings();
    }
  }

  function tick() {
    installSettings();
    syncHandSettings();
    populateSongs();
    if (model.folder && practiceAttemptAvailable()) populateAttemptsOnce();
    requestAnimationFrame(tick);
  }

  let lastPracticeAttempt = null;
  function populateAttemptsOnce() {
    const id = window.rilPracticeEngine?.practice?.lastAttempt?.completedAt || null;
    if (id && id !== lastPracticeAttempt) {
      lastPracticeAttempt = id;
      populateAttempts();
    }
  }

  installStyles();
  installView();
  installSettings();
  window.rilAnalysis = { loadSong, analyzeSelected, openPractice, detectPatterns, buildReport };
  requestAnimationFrame(tick);
})();
