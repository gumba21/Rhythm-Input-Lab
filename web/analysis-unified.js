"use strict";

(() => {
  const q = selector => document.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const model = { folder: null, song: null, bundle: null, attempts: [], structural: null, attemptA: null, attemptB: null, reportA: null, reportB: null, token: 0 };

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function num(value, digits = 2, suffix = "") {
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}${suffix}` : "—";
  }

  function time(ms, digits = 2) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    return `${minutes}:${(total - minutes * 60).toFixed(digits).padStart(digits + 3, "0")}`;
  }

  function title(value) {
    return String(value || "").replace(/(^|[-_\s])\w/g, match => match.toUpperCase());
  }

  async function jsonApi(path) {
    const response = await fetch(path);
    const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.data;
  }

  function handMap(keyCount) {
    const defaults = {
      4: ["L", "L", "R", "R"], 5: ["L", "L", "C", "R", "R"],
      6: ["L", "L", "L", "R", "R", "R"], 7: ["L", "L", "L", "C", "R", "R", "R"],
      8: ["L", "L", "L", "L", "R", "R", "R", "R"], 9: ["L", "L", "L", "L", "C", "R", "R", "R", "R"],
    };
    const saved = window.state?.settings?.analysis?.hand_maps?.[String(keyCount)];
    return Array.isArray(saved) && saved.length === keyCount ? saved : defaults[keyCount] || [];
  }

  function practiceAttempt() {
    const attempt = window.rilPracticeEngine?.practice?.lastAttempt;
    if (!attempt || attempt.songFolder !== model.folder) return null;
    return {
      folder: attempt.savedFolder || "Practice attempt",
      completedAt: attempt.completedAt,
      session: { song_name: attempt.songName, key_count: attempt.keyCount, lane_keys: attempt.laneKeys, recorded_at: attempt.completedAt },
      analysisRange: { startMs: attempt.startMs, endMs: attempt.endMs },
      presses: attempt.presses,
    };
  }

  async function readAttempt(value) {
    if (!value) return null;
    if (value === "__practice__") return practiceAttempt();
    return jsonApi(`/api/attempt?folder=${encodeURIComponent(model.folder)}&attempt=${encodeURIComponent(value)}`);
  }

  function populateAttempts() {
    const practice = practiceAttempt();
    const options = [];
    if (practice && !practice.savedFolder) options.push(`<option value="__practice__">Current unsaved Practice range</option>`);
    options.push(...model.attempts.map(attempt => `<option value="${esc(attempt.folder)}">Attempt ${String(attempt.attempt_number ?? "—").padStart(3, "0")} · ${esc(attempt.recorded_at || "")}</option>`));
    for (const id of ["analysisAttemptA", "analysisAttemptB"]) {
      const select = q(`#${id}`);
      if (!select) continue;
      const current = select.value;
      const placeholder = id === "analysisAttemptA" ? '<option value="">Chart only</option>' : '<option value="">Choose another attempt</option>';
      select.innerHTML = placeholder + options.join("");
      if ([...select.options].some(option => option.value === current)) select.value = current;
    }
    if (!q("#analysisAttemptA")?.value && options.length) q("#analysisAttemptA").value = model.attempts[0]?.folder || (practice ? "__practice__" : "");
  }

  function causes(report) {
    if (!report.attempt) return [];
    const comparison = report.shared.comparison;
    const missed = report.shared.coveredNotes.filter(note => !comparison.matchByNote.has(note._id));
    const extras = report.shared.presses.filter(press => comparison.extraPressIds.has(press.id));
    const outer = Number(window.getChartWindows?.().outer || 166.667);
    const wrongLane = missed.filter(note => extras.some(press => press.lane !== note.lane && Math.abs((press.time_ms - report.shared.offset) - note.time_ms) <= outer)).length;
    const dense = missed.filter(note => report.shared.coveredNotes.filter(other => Math.abs(other.time_ms - note.time_ms) <= 350).length >= 5).length;
    const missedTimes = missed.map(note => note.time_ms).sort((a, b) => a - b);
    const cascades = missedTimes.filter((value, index) => index && value - missedTimes[index - 1] <= 650).length;
    const offsets = comparison.offsets || [];
    const rows = [
      ["Late presses", offsets.filter(value => value > 45).length, "Matched notes landing more than 45 ms late."],
      ["Early presses", offsets.filter(value => value < -45).length, "Matched notes landing more than 45 ms early."],
      ["Possible wrong lane", wrongLane, "A different-lane extra input appeared near a missed note."],
      ["Dense cluster misses", dense, "Misses surrounded by at least four nearby notes."],
      ["Miss cascades", cascades, "Misses occurring within 650 ms of another miss."],
      ["Dropped holds", report.total.holdDrops || 0, "A hold head matched but the recorded release ended early."],
    ];
    return rows.map(([label, count, note]) => ({ label, count, note })).sort((a, b) => b.count - a.count);
  }

  function buildReport(attempt) {
    const ghost = window.state?.viz?.ghostTapping ?? true;
    const shared = window.rilSharedResults.compute(model.bundle, attempt, { folder: model.folder, ghostTapping: ghost });
    if (!attempt) return { attempt: null, shared, total: null, sections: model.structural.sections, lanes: [], patterns: model.structural.patterns, thirds: [], causes: [] };

    const sections = model.structural.sections
      .map(section => ({ ...section, metrics: shared.metricsFor(section.notes) }))
      .filter(section => section.metrics.notes > 0);
    const keyCount = Number(model.bundle?.summary?.key_count || 4);
    const hands = handMap(keyCount);
    const lanes = Array.from({ length: keyCount }, (_, lane) => {
      const notes = shared.notes.filter(note => note.lane === lane);
      return { lane, hand: hands[lane] || "C", metrics: shared.metricsFor(notes) };
    });
    const patterns = model.structural.patterns
      .map(pattern => ({ ...pattern, metrics: shared.metricsFor(pattern.notes) }))
      .filter(pattern => pattern.metrics.notes > 0);
    const base = shared.metricsFor(shared.notes);
    const exact = shared.stats || {};
    const total = {
      ...base,
      counts: exact.counts || base.counts,
      notes: exact.total ?? base.notes,
      misses: Number(exact.counts?.Miss ?? base.misses),
      accuracy: exact.accuracy ?? base.accuracy,
      hitRate: exact.hitRate ?? base.hitRate,
      medianAbs: exact.medianAbs ?? base.medianAbs,
      early: exact.early ?? base.early,
      late: exact.late ?? base.late,
      extras: exact.extras || 0,
      hazards: exact.hazards || { hits: 0, avoided: 0, total: 0 },
    };
    const start = Number(attempt.analysisRange?.startMs ?? shared.comparison.coverage?.start ?? shared.coveredNotes[0]?.time_ms ?? 0);
    const end = Number(attempt.analysisRange?.endMs ?? shared.comparison.coverage?.end ?? shared.coveredNotes.at(-1)?.time_ms ?? start + 1);
    const span = Math.max(1, end - start);
    const thirds = [0, 1, 2].map((index) => {
      const from = start + span * index / 3;
      const to = start + span * (index + 1) / 3;
      return { label: ["Beginning", "Middle", "Ending"][index], startMs: from, endMs: to, metrics: shared.metricsFor(shared.notes.filter(note => note.time_ms >= from && note.time_ms < to)) };
    });
    const report = { attempt, shared, total, sections, lanes, patterns, thirds, coverage: { start, end } };
    report.causes = causes(report);
    return report;
  }

  function card(label, value, note) {
    return `<div class="card metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></div>`;
  }

  function practiceButton(start, end, label) {
    return `<button class="button small unified-practice" data-start="${start}" data-end="${end}" data-label="${esc(label)}">Practice</button>`;
  }

  function bindPractice(root = document) {
    qa(".unified-practice", root).forEach(button => button.addEventListener("click", () => window.rilAnalysis.openPractice(Number(button.dataset.start), Number(button.dataset.end), button.dataset.label)));
  }

  function weakest(rows, minimum = 3) {
    return rows.filter(row => row.metrics.notes >= minimum && row.metrics.accuracy != null).sort((a, b) => a.metrics.accuracy - b.metrics.accuracy || b.metrics.misses - a.metrics.misses)[0] || null;
  }

  function groupedPatterns(patterns) {
    const groups = new Map();
    for (const pattern of patterns) {
      if (!groups.has(pattern.type)) groups.set(pattern.type, []);
      groups.get(pattern.type).push(pattern);
    }
    return [...groups.entries()].map(([type, instances]) => {
      const notes = instances.reduce((sum, item) => sum + item.metrics.notes, 0);
      const misses = instances.reduce((sum, item) => sum + item.metrics.misses, 0);
      const weighted = instances.reduce((sum, item) => sum + Number(item.metrics.accuracy || 0) * item.metrics.notes, 0);
      return { type, instances, metrics: { notes, misses, accuracy: notes ? weighted / notes : null } };
    }).sort((a, b) => (a.metrics.accuracy ?? 101) - (b.metrics.accuracy ?? 101));
  }

  function render(report) {
    if (!report.attempt) {
      q("#analysisOverview").innerHTML = [
        card("Accuracy", "Chart only", "Choose an attempt for exact Visualizer results"),
        card("Player notes", model.bundle?.summary?.player_notes || 0, "Imported chart"),
        card("Patterns", report.patterns.length, "Strict detections"),
        card("Key mode", `${model.bundle?.summary?.key_count || 4}K`, "Hand assignments are configurable"),
      ].join("");
      q("#analysisCoach").innerHTML = '<div class="analysis-callout"><b>Chart structure is ready.</b><span>Choose an attempt to use the exact same match and accuracy result as Visualizer.</span></div>';
      q("#analysisFatigue").innerHTML = '<div class="list-sub">Choose an attempt to compare consistency.</div>';
      q("#analysisSections").innerHTML = '<div class="list-sub">Section rankings require an attempt.</div>';
      q("#analysisLanes").innerHTML = '<div class="list-sub">Lane performance requires an attempt.</div>';
      renderPatterns(report);
      q("#analysisCauses").innerHTML = '<div class="list-sub">Miss-cause estimates require an attempt.</div>';
      return;
    }

    const t = report.total;
    q("#analysisOverview").innerHTML = [
      card("Accuracy", `${num(t.accuracy, 2)}%`, "Exact Visualizer result"),
      card("Misses", t.misses, `${t.counts?.Sick || 0} Sick · ${t.extras || 0} extras`),
      card("Median timing", t.medianAbs == null ? "—" : `${num(t.medianAbs, 1)} ms`, `${t.early} early · ${t.late} late`),
      card("Analyzed range", `${time(report.coverage.start)}–${time(report.coverage.end)}`, `${report.shared.coveredNotes.length} covered notes · ${report.shared.offset >= 0 ? "+" : ""}${report.shared.offset} ms offset`),
    ].join("");

    const section = weakest(report.sections);
    const lane = weakest(report.lanes);
    const pattern = weakest(groupedPatterns(report.patterns));
    const issue = report.causes.find(row => row.count > 0);
    q("#analysisCoach").innerHTML = `
      ${section ? `<div class="analysis-coach-row"><span>Weakest section</span><div><b>${time(section.startMs)}–${time(section.endMs)}</b><small>${num(section.metrics.accuracy, 2)}% · ${section.metrics.misses} misses</small></div>${practiceButton(section.startMs, section.endMs, "Weak section")}</div>` : ""}
      ${lane ? `<div class="analysis-coach-row"><span>Weakest lane</span><div><b>Lane ${lane.lane + 1} · ${lane.hand === "L" ? "Left" : lane.hand === "R" ? "Right" : "Center"}</b><small>${num(lane.metrics.accuracy, 2)}% · ${lane.metrics.misses} misses</small></div></div>` : ""}
      ${pattern ? `<div class="analysis-coach-row"><span>Weakest pattern</span><div><b>${title(pattern.type)}</b><small>${num(pattern.metrics.accuracy, 2)}% · ${pattern.metrics.misses} misses</small></div></div>` : ""}
      ${issue ? `<div class="analysis-callout warn"><b>Most visible issue: ${esc(issue.label)}</b><span>${issue.count} observations. ${esc(issue.note)}</span></div>` : '<div class="analysis-callout good"><b>No dominant issue</b><span>The remaining mistakes are too mixed for a confident label.</span></div>'}`;
    bindPractice(q("#analysisCoach"));

    q("#analysisFatigue").innerHTML = report.thirds.map(row => `<div class="analysis-third"><span>${row.label}</span><b>${num(row.metrics.accuracy, 2)}%</b><small>${row.metrics.misses} misses · ${row.metrics.median == null ? "no timing" : `${row.metrics.median >= 0 ? "+" : ""}${num(row.metrics.median, 1)} ms`}</small><div class="analysis-bar"><i style="width:${Math.max(0, Math.min(100, row.metrics.accuracy || 0))}%"></i></div></div>`).join("");
    const first = report.thirds[0]?.metrics.accuracy, last = report.thirds[2]?.metrics.accuracy;
    q("#analysisFatigue").insertAdjacentHTML("beforeend", first != null && last != null && last + 4 < first ? `<div class="analysis-callout warn"><b>Possible stamina decline</b><span>The ending is ${num(first - last, 2)}% below the beginning.</span></div>` : '<div class="analysis-callout good"><b>Stable ending</b><span>No large accuracy decline appears across the covered range.</span></div>');

    const header = labels => `<div class="analysis-table-head">${labels.map(label => `<div>${label}</div>`).join("")}</div>`;
    q("#analysisSections").innerHTML = header(["Range", "Notes", "Accuracy", "Misses", "Timing", ""]) + report.sections.sort((a, b) => (a.metrics.accuracy ?? 101) - (b.metrics.accuracy ?? 101)).slice(0, 18).map(row => `<div class="analysis-table-row"><div><b>${esc(row.label)}</b><small>${time(row.startMs)}–${time(row.endMs)}</small></div><div>${row.metrics.notes}</div><div>${num(row.metrics.accuracy, 2)}%</div><div>${row.metrics.misses}</div><div>${row.metrics.median == null ? "—" : `${row.metrics.median >= 0 ? "+" : ""}${num(row.metrics.median, 1)} ms`}</div><div>${practiceButton(row.startMs, row.endMs, row.label)}</div></div>`).join("");
    bindPractice(q("#analysisSections"));

    q("#analysisLanes").innerHTML = header(["Lane", "Hand", "Notes", "Accuracy", "Misses", "Median"]) + report.lanes.map(row => `<div class="analysis-table-row"><div><b>Lane ${row.lane + 1}</b></div><div><span class="analysis-hand ${row.hand.toLowerCase()}">${row.hand === "L" ? "Left" : row.hand === "R" ? "Right" : "Center"}</span></div><div>${row.metrics.notes}</div><div>${num(row.metrics.accuracy, 2)}%</div><div>${row.metrics.misses}</div><div>${row.metrics.median == null ? "—" : `${row.metrics.median >= 0 ? "+" : ""}${num(row.metrics.median, 1)} ms`}</div></div>`).join("");
    renderPatterns(report);
    q("#analysisCauses").innerHTML = report.causes.map((row, index) => `<div class="analysis-cause"><span>${index + 1}</span><div><b>${esc(row.label)}</b><small>${esc(row.note)}</small></div><strong>${row.count}</strong></div>`).join("");
  }

  function renderPatterns(report) {
    const groups = groupedPatterns(report.patterns);
    q("#analysisPatterns").innerHTML = groups.length ? groups.map(group => {
      const worst = group.instances.filter(row => row.metrics.misses > 0).sort((a, b) => b.metrics.misses - a.metrics.misses)[0];
      return `<article class="analysis-pattern-card"><div class="analysis-pattern-head"><div><h3>${title(group.type)}</h3><p>Strict detection using the shared result.</p></div><span>${group.instances.length} found</span></div><div class="analysis-pattern-stats"><div><span>Accuracy</span><b>${report.attempt ? `${num(group.metrics.accuracy, 2)}%` : "Chart only"}</b></div><div><span>Misses</span><b>${group.metrics.misses}</b></div><div><span>Sample</span><b class="mono">${esc((group.instances[0]?.shorthand || "").slice(0, 34))}</b></div></div><div class="comfort-actions">${worst ? practiceButton(worst.startMs, worst.endMs, `${title(group.type)} failure`) : '<button class="button small" disabled>No failures</button>'}</div></article>`;
    }).join("") : '<div class="empty">No strict patterns were detected.</div>';
    bindPractice(q("#analysisPatterns"));
  }

  function renderComparison() {
    const root = q("#analysisComparison");
    if (!model.reportA || !model.reportB) { root.innerHTML = '<div class="list-sub">Choose another attempt to compare exact results.</div>'; return; }
    const a = model.reportA.total, b = model.reportB.total;
    const metric = (label, before, after, lower = false, suffix = "") => {
      const delta = Number(after) - Number(before);
      const good = lower ? delta < 0 : delta > 0;
      return `<div class="analysis-compare-metric ${delta === 0 ? "" : good ? "good" : "bad"}"><span>${label}</span><b>${num(before, 2, suffix)} → ${num(after, 2, suffix)}</b><small>${delta >= 0 ? "+" : ""}${num(delta, 2, suffix)}</small></div>`;
    };
    root.innerHTML = `<div class="analysis-compare-grid">${metric("Accuracy", a.accuracy, b.accuracy, false, "%")}${metric("Misses", a.misses, b.misses, true)}${metric("Median abs.", a.medianAbs, b.medianAbs, true, " ms")}${metric("Hold drops", a.holdDrops, b.holdDrops, true)}</div>`;
  }

  async function analyze() {
    if (!model.bundle) return;
    const token = ++model.token;
    q("#analysisEmpty").classList.remove("hidden");
    q("#analysisEmpty").textContent = "Calculating one shared result…";
    try {
      model.attemptA = await readAttempt(q("#analysisAttemptA")?.value || "");
      if (token !== model.token) return;
      model.reportA = buildReport(model.attemptA);
      render(model.reportA);
      q("#analysisEmpty").classList.add("hidden");
      q("#analysisWorkspace").classList.remove("hidden");
      await compare();
    } catch (error) {
      q("#analysisWorkspace").classList.add("hidden");
      q("#analysisEmpty").classList.remove("hidden");
      q("#analysisEmpty").textContent = `Analysis failed: ${error.message}`;
    }
  }

  async function compare() {
    const value = q("#analysisAttemptB")?.value || "";
    model.attemptB = value ? await readAttempt(value).catch(() => null) : null;
    model.reportB = model.attemptB ? buildReport(model.attemptB) : null;
    renderComparison();
  }

  async function loadSong(folder) {
    if (!folder) return;
    const token = ++model.token;
    q("#analysisEmpty").classList.remove("hidden");
    q("#analysisWorkspace").classList.add("hidden");
    q("#analysisEmpty").textContent = "Loading chart and attempts…";
    try {
      const data = await jsonApi(`/api/song?folder=${encodeURIComponent(folder)}`);
      if (token !== model.token) return;
      model.folder = folder;
      model.song = data.song;
      model.bundle = data.bundle;
      model.attempts = data.attempts || [];
      model.structural = window.rilAnalysis.buildReport(model.bundle, null);
      populateAttempts();
      await analyze();
    } catch (error) {
      q("#analysisEmpty").textContent = `Analysis could not load: ${error.message}`;
    }
  }

  function capture(event) {
    const target = event.target;
    if (!target) return;
    if (event.type === "change" && target.id === "analysisSongSelect") {
      event.stopImmediatePropagation();
      loadSong(target.value);
    } else if (event.type === "change" && target.id === "analysisAttemptA") {
      event.stopImmediatePropagation();
      analyze();
    } else if (event.type === "change" && target.id === "analysisAttemptB") {
      event.stopImmediatePropagation();
      compare();
    } else if (event.type === "click" && target.closest?.("#analysisRefresh")) {
      event.stopImmediatePropagation();
      analyze();
    }
  }

  document.addEventListener("change", capture, true);
  document.addEventListener("click", capture, true);
  window.rilUnifiedAnalysis = { loadSong, analyze, compare, buildReport };
})();
