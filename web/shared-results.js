"use strict";

(() => {
  const CACHE_LIMIT = 24;
  const cache = new Map();
  const weights = { Sick: 1, Good: 0.75, Bad: 0.5, Shit: 0.25, Miss: 0 };

  function isHazard(bundle, note) {
    const key = String(note?.note_type || "");
    const mappings = bundle?.mappings?.note_types || {};
    const mapped = mappings[key];
    if (mapped) return mapped.should_press === false || mapped.category === "hazard";
    const folded = key.trim().toLocaleLowerCase();
    return ["hurt note", "hurt", "mine", "death note", "hazard"].includes(folded);
  }

  function playableNotes(bundle) {
    return (bundle?.notes || [])
      .filter(note => note.owner === "player" && Number.isInteger(Number(note.lane)) && !isHazard(bundle, note))
      .map((note, index) => ({ ...note, lane: Number(note.lane), time_ms: Number(note.time_ms), _id: index }));
  }

  function hazardNotes(bundle) {
    return (bundle?.notes || [])
      .filter(note => note.owner === "player" && Number.isInteger(Number(note.lane)) && isHazard(bundle, note))
      .map((note, index) => ({ ...note, lane: Number(note.lane), time_ms: Number(note.time_ms), _hazardId: index }));
  }

  function lanePresses(attempt) {
    return (attempt?.presses || [])
      .filter(press => press.role === "lane" && Number.isInteger(Number(press.lane)))
      .map((press, index) => ({
        ...press,
        id: press.id ?? index,
        lane: Number(press.lane),
        time_ms: Number(press.time_ms),
        held_ms: Number(press.held_ms || 0),
      }));
  }

  function median(values) {
    const rows = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (!rows.length) return null;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  }

  function preferenceStore() {
    try { return JSON.parse(localStorage.getItem("ril-visualizer-preferences:v1") || "null") || {}; }
    catch (_) { return {}; }
  }

  function attemptIdentity(folder, attempt) {
    return `${folder || ""}::${attempt?.folder || attempt?.completedAt || attempt?.session?.recorded_at || "chart"}`;
  }

  function savedOffset(folder, attempt) {
    const preferenceOffset = Number(preferenceStore().offsets?.[attemptIdentity(folder, attempt)]);
    if (Number.isFinite(preferenceOffset)) return preferenceOffset;
    const analysisOffset = Number(attempt?.analysis?.chart?.offset_ms);
    if (attempt?.analysis?.chart?.offset_ms && Number.isFinite(analysisOffset)) return analysisOffset;
    const sessionOffset = Number(attempt?.session?.visualizer_offset_ms);
    if (Number.isFinite(sessionOffset)) return sessionOffset;
    return null;
  }

  function autoOffset(notes, presses) {
    if (!notes.length || !presses.length || typeof window.matchChart !== "function") return 0;
    const candidates = typeof window.candidateOffsets === "function" ? window.candidateOffsets(notes, presses) : [];
    candidates.push(Number(presses[0].time_ms) - Number(notes[0].time_ms), 0);
    let best = null;
    const outer = Number(window.getChartWindows?.().outer || 166.667);
    for (const offset of [...new Set(candidates.map(value => Math.round(Number(value) || 0)))]) {
      const result = window.matchChart(notes, presses, offset, outer);
      const score = result.matches.length * 1000 - Number(result.medianAbsolute || 9999);
      if (!best || score > best.score) best = { offset, score };
    }
    return best?.offset || 0;
  }

  function exactStats(comparison, ghostTapping) {
    if (typeof window.comparisonStats !== "function" || !window.state?.viz) return null;
    const previousComparison = window.state.viz.comparison;
    const previousGhost = window.state.viz.ghostTapping;
    try {
      window.state.viz.comparison = comparison;
      window.state.viz.ghostTapping = Boolean(ghostTapping);
      return window.comparisonStats();
    } finally {
      window.state.viz.comparison = previousComparison;
      window.state.viz.ghostTapping = previousGhost;
    }
  }

  function metricsFor(notes, comparison, coveredIds = null) {
    const rows = coveredIds ? notes.filter(note => coveredIds.has(note._id)) : notes;
    const matches = rows.map(note => comparison.matchByNote.get(note._id)).filter(Boolean);
    const misses = rows.filter(note => !comparison.matchByNote.has(note._id));
    const counts = { Sick: 0, Good: 0, Bad: 0, Shit: 0, Miss: misses.length };
    matches.forEach(match => { counts[window.judgmentFor(match.delta_ms)] += 1; });
    const weighted = Object.entries(counts).reduce((sum, [name, count]) => sum + Number(count) * (weights[name] || 0), 0);
    const offsets = matches.map(match => Number(match.delta_ms));
    return {
      notes: rows.length,
      matches: matches.length,
      misses: misses.length,
      counts,
      accuracy: rows.length ? weighted / rows.length * 100 : null,
      hitRate: rows.length ? matches.length / rows.length * 100 : null,
      median: median(offsets),
      medianAbs: median(offsets.map(Math.abs)),
      early: offsets.filter(value => value < 0).length,
      late: offsets.filter(value => value >= 0).length,
      holdDrops: matches.filter(match => Number(match.note.sustain_ms || 0) > 0 && Number(match.press.held_ms || 0) + 45 < Number(match.note.sustain_ms || 0)).length,
    };
  }

  function cacheKey(bundle, attempt, options, offset) {
    const presses = attempt?.presses || [];
    const windows = window.getChartWindows?.() || {};
    return JSON.stringify([
      options.folder || "",
      attempt?.folder || attempt?.completedAt || attempt?.session?.recorded_at || "chart",
      presses.length,
      presses.at(-1)?.time_ms || 0,
      bundle?.summary?.player_notes || 0,
      offset,
      Boolean(options.ghostTapping),
      attempt?.session?.full_song === true,
      attempt?.analysisRange?.startMs ?? null,
      attempt?.analysisRange?.endMs ?? null,
      windows.sick, windows.good, windows.bad, windows.outer,
    ]);
  }

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return value;
  }

  function setCoverage(comparison, notes, attempt, bundle) {
    const explicit = attempt?.analysisRange;
    const fullSong = attempt?.session?.full_song === true;
    let coveredNotes = comparison.coveredNotes || notes;

    if (fullSong) {
      coveredNotes = notes;
      comparison.coverage = {
        start: 0,
        end: Number(bundle?.summary?.duration_ms || notes.at(-1)?.time_ms || 0),
      };
    } else if (explicit && Number(explicit.endMs) > Number(explicit.startMs)) {
      const start = Number(explicit.startMs);
      const end = Number(explicit.endMs);
      coveredNotes = notes.filter(note => note.time_ms >= start && note.time_ms <= end);
      comparison.coverage = { start, end };
    }

    comparison.coveredNotes = coveredNotes;
    comparison.missedNoteIds = new Set(
      coveredNotes
        .filter(note => !comparison.matchByNote.has(note._id))
        .map(note => note._id),
    );
    return coveredNotes;
  }

  function compute(bundle, attempt, options = {}) {
    const notes = playableNotes(bundle);
    const hazards = hazardNotes(bundle);
    const presses = lanePresses(attempt);
    if (!attempt) {
      return {
        notes,
        hazards,
        presses,
        offset: 0,
        comparison: null,
        stats: null,
        coveredNotes: notes,
        coveredIds: new Set(notes.map(note => note._id)),
        metricsFor: rows => ({ ...metricsFor(rows, { matchByNote: new Map() }), accuracy: null, misses: 0 }),
      };
    }

    const offset = Number.isFinite(Number(options.offset))
      ? Number(options.offset)
      : savedOffset(options.folder, attempt) ?? autoOffset(notes, presses);
    const key = cacheKey(bundle, attempt, options, offset);
    if (cache.has(key)) return cache.get(key);

    const outer = Number(window.getChartWindows?.().outer || 166.667);
    const comparison = window.matchChart(notes, presses, offset, outer);
    const unmatched = presses.filter(press => !comparison.matchByPress.has(press.id));
    comparison.hazards = typeof window.matchHazards === "function"
      ? window.matchHazards(hazards, unmatched, offset, outer)
      : { attempts: [], hitPressIds: new Set(), hitCount: 0, avoidedCount: hazards.length };
    for (const id of comparison.hazards.hitPressIds || []) comparison.extraPressIds.delete(id);

    const coveredNotes = setCoverage(comparison, notes, attempt, bundle);
    const coveredIds = new Set(coveredNotes.map(note => note._id));
    const stats = exactStats(comparison, options.ghostTapping ?? window.state?.viz?.ghostTapping ?? true);
    const result = {
      notes,
      hazards,
      presses,
      offset,
      comparison,
      stats,
      coveredNotes,
      coveredIds,
      metricsFor: rows => metricsFor(rows, comparison, coveredIds),
    };
    return remember(key, result);
  }

  function clear() { cache.clear(); }

  window.rilSharedResults = { compute, clear, metricsFor, attemptIdentity, savedOffset, setCoverage, isHazard };
})();
