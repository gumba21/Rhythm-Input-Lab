"use strict";

(() => {
  const engine = window.rilPracticeEngine;
  if (!engine?.practice) return;
  const handled = new Set();
  const completedValidity = new Map();
  let saving = null;
  let observed = null;
  let run = null;

  function fullSongRange(attempt) {
    const duration = Number(engine.practice.durationMs || attempt?.endMs || 0);
    const tolerance = 500;
    return Boolean(attempt && Number(attempt.startMs || 0) <= tolerance && Number(attempt.endMs || 0) >= duration - tolerance);
  }

  function fullSong(attempt) {
    return fullSongRange(attempt) && completedValidity.get(attempt.completedAt) !== false;
  }

  function compactStats(stats = {}) {
    return {
      hits: Number(stats.hits || 0), misses: Number(stats.misses || 0), extras: Number(stats.extras || 0),
      weighted: Number(stats.weighted || 0), maxCombo: Number(stats.maxCombo || 0),
      early: Number(stats.early || 0), late: Number(stats.late || 0), holdDrops: Number(stats.holdDrops || 0),
      hazardsHit: Number(stats.hazardsHit || 0), hazardsAvoided: Number(stats.hazardsAvoided || 0),
      judgments: { ...(stats.judgments || {}) },
    };
  }

  async function saveAttempt(attempt) {
    if (!attempt || attempt.savedFolder || saving === attempt.completedAt || handled.has(attempt.completedAt) || !fullSong(attempt)) return;
    handled.add(attempt.completedAt);
    saving = attempt.completedAt;
    attempt.saveState = "saving";
    try {
      const response = await fetch("/api/practice-attempt/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: attempt.songFolder,
          song_name: attempt.songName,
          start_ms: attempt.startMs,
          end_ms: attempt.endMs,
          speed: attempt.speed,
          key_count: attempt.keyCount,
          lane_keys: attempt.laneKeys,
          presses: attempt.presses,
          stats: compactStats(attempt.stats),
          completed_at: attempt.completedAt,
        }),
      });
      const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      attempt.savedFolder = payload.data.folder;
      attempt.savedAttemptNumber = payload.data.attempt_number;
      attempt.saveState = "saved";
      window.rilSharedResults?.clear?.();
      await window.refreshSongs?.();
      if (typeof window.toast === "function") window.toast(`Full-song Practice run saved as Attempt ${String(payload.data.attempt_number).padStart(3, "0")}.`);
      const overlay = document.querySelector("#practiceOverlay small");
      if (overlay) overlay.textContent += ` · saved as Attempt ${String(payload.data.attempt_number).padStart(3, "0")}`;
    } catch (error) {
      attempt.saveState = "error";
      attempt.saveError = error.message;
      if (typeof window.toast === "function") window.toast(`Practice finished, but saving the full-song attempt failed: ${error.message}`, "error", 7000);
    } finally {
      saving = null;
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest?.("#practiceReviewButton");
    if (!button) return;
    const attempt = engine.practice.lastAttempt;
    if (attempt?.saveState === "saving") {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.toast?.("The full-song attempt is still being saved. Try Review again in a moment.");
      return;
    }
    if (!attempt?.savedFolder) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.loadVisualizer?.(attempt.songFolder, attempt.savedFolder);
  }, true);

  setInterval(() => {
    const practice = engine.practice;
    const current = Number(practice.currentMs || 0);
    if (practice.playing) {
      if (!run || run.finished || run.stats !== practice.stats) {
        run = {
          stats: practice.stats,
          finished: false,
          valid: current <= Number(practice.startMs || 0) + 650,
          last: current,
          maximum: current,
        };
      } else {
        const forwardJump = current - run.last;
        if (forwardJump > 1500 || current < run.last - 500) run.valid = false;
        run.last = current;
        run.maximum = Math.max(run.maximum, current);
      }
    }

    const attempt = practice.lastAttempt;
    if (practice.finished && run && !run.finished && attempt?.completedAt) {
      run.finished = true;
      const reachedEnd = run.maximum >= Number(attempt.endMs || 0) - 1000;
      completedValidity.set(attempt.completedAt, Boolean(run.valid && reachedEnd));
    }

    if (!attempt?.completedAt || attempt.completedAt === observed) return;
    observed = attempt.completedAt;
    if (fullSong(attempt)) saveAttempt(attempt);
  }, 200);

  window.rilPracticeSave = { saveAttempt, fullSong, fullSongRange };
})();
