"use strict";

(() => {
  const q = selector => document.querySelector(selector);
  const runtime = {
    installed: false,
    pendingFolder: "",
    songSwitching: false,
    sawLoading: false,
    observer: null,
    renderQueued: false,
  };

  function practiceVisible() {
    return q("#view-practice")?.classList.contains("active");
  }

  function practice() {
    return window.rilPracticeEngine?.practice || null;
  }

  function polish() {
    return window.rilPracticePolish || null;
  }

  function countdownEnabled() {
    return polish()?.settings?.countdown !== false;
  }

  function countdownActive() {
    return q("#practiceCountdownOverlay")?.classList.contains("active") ||
      q("#practiceRunState")?.classList.contains("countdown");
  }

  function readyAudioCount() {
    const state = window.state?.viz;
    if (!state) return 0;
    let count = 0;
    if (state.audioReady?.instrumental && q("#instrumentalAudio")?.src) count += 1;
    if (state.audioReady?.vocals && q("#vocalsAudio")?.src) count += 1;
    return count;
  }

  function songLoading(p) {
    if (!p) return runtime.songSwitching;
    return Boolean(runtime.songSwitching || p.loading);
  }

  function pausedState() {
    return q("#practiceRunState")?.classList.contains("paused");
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function setDisabled(node, value) {
    if (node && node.disabled !== Boolean(value)) node.disabled = Boolean(value);
  }

  function renderButtons() {
    runtime.renderQueued = false;
    const p = practice();
    const start = q("#practiceStartButton");
    const pause = q("#practicePauseButton");
    const retry = q("#practiceRetryButton");
    if (!start || !pause || !retry) return;

    const loading = songLoading(p);
    const counting = countdownActive();
    const hasBundle = Boolean(p?.bundle);

    if (loading) {
      setText(start, "Loading…");
      setDisabled(start, true);
      setDisabled(retry, true);
      setDisabled(pause, true);
      return;
    }

    if (!hasBundle) {
      setText(start, "Start practice");
      setDisabled(start, true);
      setDisabled(retry, true);
      setDisabled(pause, true);
      return;
    }

    if (p.playing) {
      setText(start, "Playing");
      setDisabled(start, true);
      setDisabled(retry, false);
      setText(pause, "Pause");
      setDisabled(pause, false);
      return;
    }

    if (counting) {
      setText(start, "Starting…");
      setDisabled(start, true);
      setDisabled(retry, true);
      setText(pause, "Cancel countdown");
      setDisabled(pause, false);
      return;
    }

    if (p.finished) {
      setText(start, "Start new run");
      setDisabled(start, false);
      setDisabled(retry, false);
      setText(pause, "Resume");
      setDisabled(pause, true);
      return;
    }

    if (pausedState()) {
      setText(start, "Restart range");
      setDisabled(start, false);
      setDisabled(retry, false);
      setText(pause, "Resume");
      setDisabled(pause, false);
      return;
    }

    setText(start, readyAudioCount() ? "Start practice" : "Start without audio");
    setDisabled(start, false);
    setDisabled(retry, !p.lastAttempt);
    setText(pause, "Resume");
    setDisabled(pause, true);
  }

  function queueRender() {
    if (runtime.renderQueued) return;
    runtime.renderQueued = true;
    queueMicrotask(renderButtons);
  }

  function beginCountdown(kind, button) {
    const p = practice();
    const controller = polish();
    if (!p?.bundle || p.loading || !controller?.beginCountdown || !countdownEnabled()) return false;
    controller.beginCountdown(kind, button);
    queueRender();
    return true;
  }

  // Registered after Practice Polish but before the base Practice engine. If the
  // polish layer misses Enter during a song transition, this prevents the base
  // engine from starting immediately without its count-in.
  window.addEventListener("keydown", event => {
    if (event.key !== "Enter" || !practiceVisible()) return;
    const target = event.target;
    if (target && (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable)) return;
    const p = practice();
    if (!p?.bundle || p.playing || p.loading || !countdownEnabled()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const retry = Boolean(p.finished || p.lastAttempt);
    beginCountdown(retry ? "retry" : "start", q(retry && p.finished ? "#practiceRetryButton" : "#practiceStartButton"));
  }, true);

  // The existing polish listener gets first chance. This is a fallback for the
  // short async window while a newly selected song replaces the previous one.
  document.addEventListener("click", event => {
    const button = event.target.closest?.("#practiceStartButton,#practiceRetryButton");
    if (!button || !practiceVisible() || !countdownEnabled()) return;
    // Practice Polish finishes its count-in with button.click(). That synthetic
    // click must reach the base engine; re-catching it here restarts the count-in.
    if (!event.isTrusted) return;
    const p = practice();
    if (!p?.bundle || p.loading || songLoading(p)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginCountdown(button.id === "practiceRetryButton" ? "retry" : "start", button);
  }, true);

  document.addEventListener("change", event => {
    if (event.target?.id !== "practiceSongSelect") return;
    runtime.pendingFolder = String(event.target.value || "");
    runtime.songSwitching = Boolean(runtime.pendingFolder);
    runtime.sawLoading = false;
    polish()?.cancelCountdown?.({ silent: true, resetPosition: false });
    setTimeout(() => {
      if (practice()?.loading) runtime.sawLoading = true;
      queueRender();
    }, 0);
    queueRender();
  }, true);

  function installObserver() {
    if (runtime.installed) return true;
    const start = q("#practiceStartButton");
    const pause = q("#practicePauseButton");
    const retry = q("#practiceRetryButton");
    if (!start || !pause || !retry) return false;
    runtime.installed = true;
    runtime.observer = new MutationObserver(queueRender);
    for (const node of [start, pause, retry, q("#practiceRunState"), q("#practiceCountdownOverlay")].filter(Boolean)) {
      runtime.observer.observe(node, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    renderButtons();
    return true;
  }

  function poll() {
    installObserver();
    const p = practice();
    if (runtime.songSwitching && p) {
      if (p.loading) runtime.sawLoading = true;
      if (runtime.sawLoading && !p.loading) {
        runtime.songSwitching = false;
        runtime.pendingFolder = "";
        runtime.sawLoading = false;
      }
    }
    renderButtons();
    setTimeout(poll, 50);
  }

  window.rilPracticeStateHotfix = {
    renderButtons,
    diagnostics: runtime,
  };

  poll();
})();
