"use strict";

(() => {
  const q = selector => document.querySelector(selector);
  const runtime = {
    folder: null,
    sessionId: 0,
    loadingToken: 0,
    stems: [],
    nodes: new Map(),
    meta: {},
  };

  function transport() { return window.rilSongTransport || null; }

  function activeFolder() {
    if (q("#view-practice")?.classList.contains("active")) {
      return window.rilPracticeEngine?.practice?.songFolder || null;
    }
    if (q("#view-visualizer")?.classList.contains("active")) return window.state?.viz?.songFolder || null;
    return window.rilPracticeEngine?.practice?.songFolder || window.state?.viz?.songFolder || null;
  }

  function vocalsVolume() {
    return Math.max(0, Math.min(1, Number(window.state?.viz?.audioVolumes?.vocals ?? 1)));
  }

  function clearNodes() {
    for (const [key, audio] of runtime.nodes) {
      transport()?.unregisterStem?.(key, audio);
      try { audio.pause(); } catch (_) {}
      audio.removeAttribute("src");
      try { audio.load(); } catch (_) {}
      audio.remove();
    }
    runtime.nodes.clear();
    runtime.stems = [];
    runtime.folder = null;
    runtime.sessionId = 0;
  }

  function sessionCurrent(folder, sessionId) {
    const owner = transport();
    return owner ? owner.isSession(sessionId, null, folder) : folder === activeFolder();
  }

  function stemKey(row) {
    return `vocal-stem:${String(row.stem_id || row.stored_name || row.filename || "vocals")}`;
  }

  function ensureNode(row, sessionId) {
    const key = stemKey(row);
    if (runtime.nodes.has(key)) return runtime.nodes.get(key);
    const audio = document.createElement("audio");
    audio.className = "hidden ril-vocal-stem-audio";
    audio.preload = "metadata";
    audio.dataset.rilStemId = key;
    audio.dataset.rilStemName = String(row.filename || row.label || key);
    audio.volume = vocalsVolume();
    audio.src = `${row.url}&v=${encodeURIComponent(row.updated_at || row.size_bytes || Date.now())}`;
    document.body.appendChild(audio);
    runtime.nodes.set(key, audio);

    transport()?.registerStem?.(key, audio, {
      sessionId,
      role: "vocals",
      dynamic: true,
      ready: false,
    });

    audio.addEventListener("loadedmetadata", () => {
      if (!sessionCurrent(runtime.folder, sessionId)) return;
      transport()?.markReady?.(key, audio, {
        sessionId,
        role: "vocals",
        dynamic: true,
      });
    }, { once: true });

    audio.addEventListener("error", () => {
      transport()?.markNotReady?.(key, audio);
    });

    return audio;
  }

  function decorateStatuses() {
    const count = runtime.stems.length;
    for (const selector of ["#audioStatus", "#practiceAudioStatus"]) {
      const node = q(selector);
      if (!node) continue;
      const base = node.textContent.replace(/ · Vocal stems: \d+$/i, "");
      node.textContent = count ? `${base} · Vocal stems: ${count + 1}` : base;
    }
  }

  async function load(folder, sessionId = transport()?.currentSession?.().id || 0) {
    if (!folder || !sessionId || !sessionCurrent(folder, sessionId)) return;
    const token = ++runtime.loadingToken;
    try {
      const response = await fetch(`/api/song-media/meta?folder=${encodeURIComponent(folder)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (token !== runtime.loadingToken || !sessionCurrent(folder, sessionId)) return;

      clearNodes();
      runtime.folder = folder;
      runtime.sessionId = sessionId;
      runtime.meta = payload.data || {};
      const primaryStored = runtime.meta?.vocals?.stored_name || "";
      const rows = Array.isArray(runtime.meta?.vocal_stems) ? runtime.meta.vocal_stems : [];
      runtime.stems = rows.filter(row => !row.primary && row.stored_name !== primaryStored);
      for (const row of runtime.stems) ensureNode(row, sessionId);
      decorateStatuses();
    } catch (error) {
      if (token !== runtime.loadingToken || !sessionCurrent(folder, sessionId)) return;
      console.warn("Could not load extra vocal stems", error);
      clearNodes();
      runtime.folder = folder;
      runtime.sessionId = sessionId;
    }
  }

  function syncVolume() {
    const volume = vocalsVolume();
    transport()?.setRoleVolume?.("vocals", volume);
    for (const audio of runtime.nodes.values()) audio.volume = volume;
  }

  window.addEventListener("ril:transport-session", event => {
    const detail = event.detail || {};
    runtime.loadingToken += 1;
    clearNodes();
    if (detail.folder && ["practice", "visualizer"].includes(detail.owner)) {
      load(detail.folder, detail.sessionId);
    }
  });

  document.addEventListener("input", event => {
    if (["vocalsVolume", "practiceVocalsVolume"].includes(event.target?.id)) syncVolume();
  }, true);

  document.addEventListener("change", event => {
    if (["vocalsVolume", "practiceVocalsVolume"].includes(event.target?.id)) syncVolume();
  }, true);

  const current = transport()?.currentSession?.();
  if (current?.folder && ["practice", "visualizer"].includes(current.owner)) load(current.folder, current.id);

  window.rilMultiVocals = {
    load,
    clear: clearNodes,
    diagnostics: runtime,
  };
})();
