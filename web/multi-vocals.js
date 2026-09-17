"use strict";

(() => {
  const q = selector => document.querySelector(selector);
  const runtime = {
    folder: null,
    loading: null,
    stems: [],
    nodes: new Map(),
    meta: {},
  };

  function activeFolder() {
    if (q("#view-practice")?.classList.contains("active")) {
      return window.rilPracticeEngine?.practice?.songFolder || null;
    }
    if (q("#view-visualizer")?.classList.contains("active")) return window.state?.viz?.songFolder || null;
    return window.rilPracticeEngine?.practice?.songFolder || window.state?.viz?.songFolder || null;
  }

  function practiceActive() {
    return q("#view-practice")?.classList.contains("active");
  }

  function visualizerActive() {
    return q("#view-visualizer")?.classList.contains("active");
  }

  function desiredPlayback() {
    if (practiceActive()) return Boolean(window.rilPracticeEngine?.practice?.playing);
    if (visualizerActive()) return Boolean(window.state?.viz?.playing);
    return false;
  }

  function currentTimeSeconds() {
    if (practiceActive()) return Math.max(0, Number(window.rilPracticeEngine?.practice?.currentMs || 0) / 1000);
    return Math.max(0, Number(window.state?.viz?.currentMs || 0) / 1000);
  }

  function playbackRate() {
    if (practiceActive()) return Math.max(0.05, Number(window.rilPracticeEngine?.practice?.speed || 1));
    return Math.max(0.05, Number(window.state?.viz?.playbackRate || 1));
  }

  function vocalsVolume() {
    return Math.max(0, Math.min(1, Number(window.state?.viz?.audioVolumes?.vocals ?? 1)));
  }

  function masterAudio() {
    const instrumental = q("#instrumentalAudio");
    const vocals = q("#vocalsAudio");
    if (instrumental?.src && window.state?.viz?.audioReady?.instrumental) return instrumental;
    if (vocals?.src && window.state?.viz?.audioReady?.vocals) return vocals;
    return null;
  }

  function clearNodes() {
    for (const audio of runtime.nodes.values()) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.remove();
    }
    runtime.nodes.clear();
    runtime.stems = [];
  }

  function ensureNode(row) {
    const id = String(row.stem_id || row.stored_name || row.filename || "vocals");
    if (runtime.nodes.has(id)) return runtime.nodes.get(id);
    const audio = document.createElement("audio");
    audio.className = "hidden ril-vocal-stem-audio";
    audio.preload = "metadata";
    audio.dataset.rilStemId = id;
    audio.dataset.rilStemName = String(row.filename || row.label || id);
    audio.src = `${row.url}&v=${encodeURIComponent(row.updated_at || row.size_bytes || Date.now())}`;
    audio.volume = vocalsVolume();
    audio.playbackRate = playbackRate();
    document.body.appendChild(audio);
    runtime.nodes.set(id, audio);
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

  async function load(folder) {
    if (!folder || runtime.loading === folder || runtime.folder === folder) return;
    runtime.loading = folder;
    try {
      const response = await fetch(`/api/song-media/meta?folder=${encodeURIComponent(folder)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (folder !== activeFolder()) return;
      clearNodes();
      runtime.meta = payload.data || {};
      const primaryStored = runtime.meta?.vocals?.stored_name || "";
      const rows = Array.isArray(runtime.meta?.vocal_stems) ? runtime.meta.vocal_stems : [];
      runtime.stems = rows.filter(row => !row.primary && row.stored_name !== primaryStored);
      for (const row of runtime.stems) ensureNode(row);
      runtime.folder = folder;
      decorateStatuses();
    } catch (error) {
      console.warn("Could not load extra vocal stems", error);
      if (folder === activeFolder()) {
        clearNodes();
        runtime.folder = folder;
      }
    } finally {
      runtime.loading = null;
    }
  }

  function syncNode(audio, target, playing, rate, volume) {
    audio.playbackRate = rate;
    audio.volume = volume;
    const drift = audio.currentTime - target;
    if (Math.abs(drift) > (playing ? 0.04 : 0.09)) {
      try { audio.currentTime = target; } catch (_) {}
    }
    if (playing) {
      if (audio.paused) audio.play().catch(() => {});
    } else if (!audio.paused) {
      audio.pause();
    }
  }

  function tick() {
    const folder = activeFolder();
    if (folder && folder !== runtime.folder) load(folder);
    if (!folder && runtime.folder) {
      runtime.folder = null;
      runtime.meta = {};
      clearNodes();
    }

    if (runtime.nodes.size) {
      const master = masterAudio();
      const playing = desiredPlayback();
      const target = master?.src ? Number(master.currentTime || 0) : currentTimeSeconds();
      const rate = playbackRate();
      const volume = vocalsVolume();
      for (const audio of runtime.nodes.values()) syncNode(audio, target, playing, rate, volume);
      decorateStatuses();
    }
    requestAnimationFrame(tick);
  }

  window.rilMultiVocals = {
    load,
    clear: clearNodes,
    diagnostics: runtime,
  };
  requestAnimationFrame(tick);
})();
