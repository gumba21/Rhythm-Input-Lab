"use strict";

(() => {
  const KEY = "ril-visualizer-preferences:v1";
  const defaults = {
    viewMode: "compare",
    theme: "fnf",
    playbackRate: 1,
    scrollScale: 1,
    showOpponent: false,
    showEvents: true,
    showSplashes: true,
    downscroll: false,
    ghostTapping: true,
    instrumentalVolume: 100,
    vocalsVolume: 100,
    laneHeight: 560,
    offsets: {},
  };

  function read() {
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || "null") || {}) }; }
    catch (_) { return { ...defaults }; }
  }

  let preferences = read();
  let applying = false;

  function identity() {
    const folder = state.viz.songFolder || "";
    const attempt = state.viz.attemptFolder || state.viz.attempt?.folder || "chart";
    return `${folder}::${attempt}`;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)); }
    catch (_) {}
  }

  function capture() {
    if (applying) return;
    preferences = {
      ...preferences,
      viewMode: state.viz.viewMode,
      theme: state.viz.theme === "xray" ? "fnf" : state.viz.theme,
      playbackRate: Number(state.viz.playbackRate || 1),
      scrollScale: Number(state.viz.scrollScale || 1),
      showOpponent: Boolean(state.viz.showOpponent),
      showEvents: Boolean(state.viz.showEvents),
      showSplashes: Boolean(state.viz.showSplashes),
      downscroll: Boolean(state.viz.downscroll),
      ghostTapping: Boolean(state.viz.ghostTapping),
      instrumentalVolume: Number(document.querySelector("#instrumentalVolume")?.value ?? preferences.instrumentalVolume),
      vocalsVolume: Number(document.querySelector("#vocalsVolume")?.value ?? preferences.vocalsVolume),
      laneHeight: Number(document.querySelector("#laneLength")?.value ?? state.viz.laneHeight ?? preferences.laneHeight),
    };
    if (state.viz.attempt && state.viz.songFolder) {
      preferences.offsets ||= {};
      preferences.offsets[identity()] = Number(state.viz.offsetMs || 0);
      const keys = Object.keys(preferences.offsets);
      if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(key => delete preferences.offsets[key]);
      window.rilSharedResults?.clear?.();
    }
    persist();
  }

  function setValue(selector, value, eventName = "change") {
    const node = document.querySelector(selector);
    if (!node || value === undefined || value === null) return;
    node.value = String(value);
    node.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function forceFullSongCoverage() {
    const comparison = state.viz.comparison;
    if (!comparison || state.viz.attempt?.session?.full_song !== true || typeof expectedChartNotes !== "function") return;
    const notes = expectedChartNotes();
    notes.forEach((note, index) => { note._id = index; });
    comparison.coveredNotes = notes;
    comparison.coverage = {
      start: 0,
      end: Number(state.viz.chartDurationMs || state.viz.durationMs || notes.at(-1)?.time_ms || 0),
    };
    comparison.missedNoteIds = new Set(
      notes
        .filter(note => !comparison.matchByNote.has(note._id))
        .map(note => note._id),
    );
  }

  const originalRecomputeComparison = recomputeComparison;
  recomputeComparison = () => {
    originalRecomputeComparison();
    if (!state.viz.comparison) return;
    forceFullSongCoverage();
    updateVisualizerStats();
    drawVisualizer();
    drawTimeline();
  };
  window.recomputeComparison = recomputeComparison;

  function apply({ includeOffset = true } = {}) {
    if (!state?.viz) return;
    applying = true;
    try {
      state.viz.playbackRate = Number(preferences.playbackRate || 1);
      state.viz.scrollScale = Number(preferences.scrollScale || 1);
      state.viz.showOpponent = Boolean(preferences.showOpponent);
      state.viz.showEvents = preferences.showEvents !== false;
      state.viz.showSplashes = preferences.showSplashes !== false;
      state.viz.downscroll = Boolean(preferences.downscroll);
      state.viz.ghostTapping = preferences.ghostTapping !== false;
      state.viz.theme = preferences.theme === "xray" ? "fnf" : preferences.theme || "fnf";
      state.viz.xray = false;
      state.viz.viewMode = state.viz.attempt ? preferences.viewMode || "compare" : "chart";
      if (includeOffset && state.viz.attempt && Number.isFinite(Number(preferences.offsets?.[identity()]))) {
        state.viz.offsetMs = Number(preferences.offsets[identity()]);
      }

      setValue("#playbackRate", state.viz.playbackRate);
      setValue("#scrollSpeed", state.viz.scrollScale, "input");
      setValue("#themeMode", state.viz.theme);
      setValue("#viewMode", state.viz.viewMode);
      setValue("#instrumentalVolume", preferences.instrumentalVolume, "input");
      setValue("#vocalsVolume", preferences.vocalsVolume, "input");
      setValue("#laneLength", preferences.laneHeight, "input");
      const offset = document.querySelector("#offsetInput");
      if (offset) offset.value = String(Math.round(state.viz.offsetMs || 0));
      for (const audio of typeof audioElements === "function" ? audioElements() : []) audio.playbackRate = state.viz.playbackRate;
      updateVizButtons?.();
      updatePlayButton?.();
      if (state.viz.bundle) recomputeComparison?.();
      else drawVisualizer?.();
    } finally {
      setTimeout(() => { applying = false; }, 0);
    }
  }

  const originalLoadVisualizer = loadVisualizer;
  loadVisualizer = async (songFolder, attemptFolder = null) => {
    await originalLoadVisualizer(songFolder, attemptFolder);
    apply({ includeOffset: true });
  };
  window.loadVisualizer = loadVisualizer;

  const originalLoadAttempt = loadAttemptForCurrent;
  loadAttemptForCurrent = async attemptFolder => {
    await originalLoadAttempt(attemptFolder);
    apply({ includeOffset: true });
  };
  window.loadAttemptForCurrent = loadAttemptForCurrent;

  document.addEventListener("input", event => {
    if (["scrollSpeed", "instrumentalVolume", "vocalsVolume", "laneLength", "offsetInput"].includes(event.target?.id)) setTimeout(capture, 0);
  }, true);
  document.addEventListener("change", event => {
    if (["viewMode", "themeMode", "playbackRate", "scrollSpeed", "instrumentalVolume", "vocalsVolume", "laneLength", "offsetInput"].includes(event.target?.id)) setTimeout(capture, 0);
  }, true);
  document.addEventListener("click", event => {
    if (event.target.closest?.("#opponentToggle,#eventsToggle,#downscrollToggle,#ghostToggle,#splashToggle,.offset-nudge,#autoAlignButton,#resetVisualizerButton")) setTimeout(capture, 80);
  }, true);

  const wait = setInterval(() => {
    if (!document.querySelector("#scrollSpeed") || !document.querySelector("#laneLength")) return;
    clearInterval(wait);
    apply({ includeOffset: false });
  }, 100);

  window.rilVisualizerPreferences = {
    capture,
    apply,
    forceFullSongCoverage,
    offsetFor: (folder, attempt) => Number(preferences.offsets?.[`${folder || ""}::${attempt?.folder || attempt?.completedAt || "chart"}`]),
    clearOffsets: () => { preferences.offsets = {}; persist(); window.rilSharedResults?.clear?.(); },
  };
})();
