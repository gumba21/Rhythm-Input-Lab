"use strict";

(() => {
  const q = selector => document.querySelector(selector);
  let installed = false;

  function normalizeKey(event) {
    if (event.code === "Space" || event.key === " ") return "space";
    return String(event.key || "").trim().toLowerCase();
  }

  function install() {
    if (installed) return true;
    const api = window.rilPracticeEngine;
    const backpolish = api?.backpolish;
    const practice = api?.practice;
    if (!backpolish || !practice) return false;
    installed = true;

    window.addEventListener("keyup", event => {
      if (!q("#view-practice")?.classList.contains("active")) return;
      const lane = practice.keyToLane?.get(normalizeKey(event));
      if (!Number.isInteger(lane)) return;
      const atMs = backpolish.eventSongTime(event);
      let press = null;
      for (let index = (practice.presses || []).length - 1; index >= 0; index -= 1) {
        const row = practice.presses[index];
        if (Number(row.lane) === lane && row.held_ms !== null && row.held_ms !== undefined) {
          press = row;
          break;
        }
      }
      if (!press) return;
      press.held_ms = Math.max(0, atMs - Number(press.time_ms || atMs));

      let matched = null;
      for (const note of practice.notes || []) {
        const state = practice.noteStates.get(note._practiceId);
        if (state?.pressId === press.id) {
          matched = { note, state };
          break;
        }
      }
      if (!matched || Number(matched.note.sustain_ms || 0) <= 0) return;

      const endMs = Number(matched.note.end_ms ?? Number(matched.note.time_ms || 0) + Number(matched.note.sustain_ms || 0));
      let outer = 180;
      try {
        if (typeof getChartWindows === "function") outer = Number(getChartWindows().outer || outer);
      } catch (_) {}
      if (atMs < endMs - outer) {
        matched.state.holdDropped = true;
        matched.state.holdDropAt = atMs;
        practice.lastJudgment = "Hold drop";
        practice.lastDelta = atMs - endMs;
        practice.judgmentUntil = performance.now() + 600;
      } else {
        matched.state.holdDropped = false;
        delete matched.state.holdDropAt;
        matched.state.holdComplete = true;
      }
      practice.noteStates.set(matched.note._practiceId, matched.state);
      backpolish.rebuildStats();
    }, true);
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  setTimeout(install, 0);
})();
