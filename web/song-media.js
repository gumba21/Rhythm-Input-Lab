"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const CHUNK_SIZE = 768 * 1024;
  const runtime = {
    loadedFolder: null,
    loadingFolder: null,
    uploading: new Set(),
    meta: {},
  };

  function activeFolder() {
    if (q("#view-practice")?.classList.contains("active")) {
      return window.rilPracticeEngine?.practice?.songFolder || null;
    }
    if (q("#view-visualizer")?.classList.contains("active")) return window.state?.viz?.songFolder || null;
    return window.rilPracticeEngine?.practice?.songFolder || window.state?.viz?.songFolder || null;
  }

  function audioNode(kind) {
    return q(kind === "vocals" ? "#vocalsAudio" : "#instrumentalAudio");
  }

  function labelFor(kind) {
    return kind === "vocals" ? "Vocals" : "Instrumental";
  }

  async function jsonApi(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
    });
    const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.data;
  }

  function updateStatuses(extra = "") {
    const instrumental = window.state?.viz?.audioNames?.instrumental || "none";
    const vocals = window.state?.viz?.audioNames?.vocals || "none";
    const suffix = extra ? ` · ${extra}` : "";
    const text = `Instrumental: ${instrumental} · Vocals: ${vocals}${suffix}`;
    const visual = q("#audioStatus");
    const practice = q("#practiceAudioStatus");
    if (visual) visual.textContent = text;
    if (practice) practice.textContent = text;
  }

  function detachAudio(kind) {
    const audio = audioNode(kind);
    if (!audio) return;
    audio.pause();
    if (audio.dataset.url?.startsWith("blob:")) URL.revokeObjectURL(audio.dataset.url);
    audio.removeAttribute("src");
    audio.dataset.url = "";
    audio.load();
    if (window.state?.viz?.audioReady) window.state.viz.audioReady[kind] = false;
    if (window.state?.viz?.audioNames) window.state.viz.audioNames[kind] = "";
  }

  function loadSavedTrack(folder, kind, row) {
    const audio = audioNode(kind);
    if (!audio || !row?.url) return;
    detachAudio(kind);
    const cacheKey = encodeURIComponent(row.updated_at || row.size_bytes || Date.now());
    const url = `${row.url}&v=${cacheKey}`;
    audio.dataset.url = url;
    audio.src = url;
    audio.volume = window.state?.viz?.audioVolumes?.[kind] ?? 1;
    audio.playbackRate = q("#view-practice")?.classList.contains("active")
      ? Number(window.rilPracticeEngine?.practice?.speed || 1)
      : Number(window.state?.viz?.playbackRate || 1);
    audio.onloadedmetadata = () => {
      if (folder !== activeFolder()) return;
      window.state.viz.audioReady[kind] = true;
      window.state.viz.audioNames[kind] = `${row.filename} · saved`;
      const currentMs = q("#view-practice")?.classList.contains("active")
        ? Number(window.rilPracticeEngine?.practice?.currentMs || 0)
        : Number(window.state?.viz?.currentMs || 0);
      try { audio.currentTime = Math.max(0, currentMs / 1000); } catch (_) {}
      updateStatuses("loaded from song folder");
    };
    audio.onerror = () => {
      if (folder !== activeFolder()) return;
      window.state.viz.audioReady[kind] = false;
      window.state.viz.audioNames[kind] = "";
      updateStatuses(`${labelFor(kind)} could not be loaded`);
    };
  }

  async function loadSavedAudio(folder, force = false) {
    if (!folder || runtime.loadingFolder === folder || (!force && runtime.loadedFolder === folder)) return;
    runtime.loadingFolder = folder;
    try {
      const meta = await jsonApi(`/api/song-media/meta?folder=${encodeURIComponent(folder)}`);
      if (folder !== activeFolder()) return;
      runtime.meta = meta || {};
      for (const kind of ["instrumental", "vocals"]) {
        if (meta?.[kind]) loadSavedTrack(folder, kind, meta[kind]);
        else detachAudio(kind);
      }
      runtime.loadedFolder = folder;
      updateStatuses(Object.keys(meta || {}).length ? "saved audio ready" : "no saved audio");
      updateSavedBadges();
    } catch (error) {
      if (folder === activeFolder()) updateStatuses(`audio lookup failed: ${error.message}`);
    } finally {
      runtime.loadingFolder = null;
    }
  }

  function fileChunkBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Could not read audio chunk"));
      reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
      reader.readAsDataURL(blob);
    });
  }

  async function uploadTrack(file, kind, folder) {
    if (!file || !folder) return;
    const marker = `${folder}:${kind}`;
    if (runtime.uploading.has(marker)) return;
    runtime.uploading.add(marker);
    updateSavedBadges();
    try {
      const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
      const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      for (let index = 0; index < total; index++) {
        if (folder !== activeFolder()) throw new Error("Song changed during upload");
        const start = index * CHUNK_SIZE;
        const chunk = file.slice(start, Math.min(file.size, start + CHUNK_SIZE));
        const data = await fileChunkBase64(chunk);
        updateStatuses(`saving ${labelFor(kind).toLowerCase()} ${Math.round(index / total * 100)}%`);
        const result = await jsonApi("/api/song-media/chunk", {
          method: "POST",
          body: { folder, kind, filename: file.name, upload_id: uploadId, index, total, data },
        });
        if (result.complete) runtime.meta[kind] = result.media;
      }
      runtime.loadedFolder = null;
      await loadSavedAudio(folder, true);
      if (typeof toast === "function") toast(`${labelFor(kind)} saved with ${songName(folder)}. It will load automatically next time.`);
    } catch (error) {
      if (typeof toast === "function") toast(`Could not save ${kind}: ${error.message}`, "error", 7000);
      else console.error(error);
    } finally {
      runtime.uploading.delete(marker);
      updateSavedBadges();
    }
  }

  async function clearSavedTrack(kind) {
    const folder = activeFolder();
    if (!folder) return;
    try {
      runtime.meta = await jsonApi("/api/song-media/clear", { method: "POST", body: { folder, kind } });
      detachAudio(kind);
      updateStatuses(`${labelFor(kind)} removed from song`);
      updateSavedBadges();
    } catch (error) {
      if (typeof toast === "function") toast(`Could not remove saved ${kind}: ${error.message}`, "error");
    }
  }

  function songName(folder) {
    return (window.state?.songs || []).find(song => song.folder === folder)?.song_name || folder;
  }

  function attachInput(input, kind) {
    if (!input || input.dataset.mediaSaveBound === "1") return;
    input.dataset.mediaSaveBound = "1";
    input.addEventListener("change", event => {
      const file = event.target.files?.[0];
      const folder = activeFolder();
      if (!file || !folder) return;
      setTimeout(() => uploadTrack(file, kind, folder), 0);
    });
  }

  function attachClear(button, kind) {
    if (!button || button.dataset.mediaClearBound === "1") return;
    button.dataset.mediaClearBound = "1";
    button.title = `Clear local and saved ${kind}`;
    button.addEventListener("click", () => clearSavedTrack(kind));
  }

  function installBadges() {
    for (const [selector, kind] of [["#instrumentalFile", "instrumental"], ["#vocalsFile", "vocals"], ["#practiceInstrumentalFile", "instrumental"], ["#practiceVocalsFile", "vocals"]]) {
      const input = q(selector);
      const label = input?.closest("label");
      if (!label || label.querySelector(".saved-audio-badge")) continue;
      const badge = document.createElement("span");
      badge.className = "saved-audio-badge";
      badge.dataset.kind = kind;
      label.appendChild(badge);
    }
  }

  function updateSavedBadges() {
    document.querySelectorAll(".saved-audio-badge").forEach(badge => {
      const kind = badge.dataset.kind;
      const folder = activeFolder();
      const busy = runtime.uploading.has(`${folder}:${kind}`);
      badge.textContent = busy ? "…" : runtime.meta?.[kind] ? "saved" : "";
      badge.classList.toggle("busy", busy);
    });
  }

  function bindControls() {
    attachInput(q("#instrumentalFile"), "instrumental");
    attachInput(q("#vocalsFile"), "vocals");
    attachInput(q("#practiceInstrumentalFile"), "instrumental");
    attachInput(q("#practiceVocalsFile"), "vocals");
    attachClear(q("#clearInstrumental"), "instrumental");
    attachClear(q("#clearVocals"), "vocals");
    attachClear(q("#practiceClearInstrumental"), "instrumental");
    attachClear(q("#practiceClearVocals"), "vocals");
    installBadges();
    updateSavedBadges();
  }

  function installStyles() {
    if (q("#songMediaStyles")) return;
    const style = document.createElement("style");
    style.id = "songMediaStyles";
    style.textContent = `
      .saved-audio-badge{display:inline-flex;min-width:0;margin-left:6px;padding:1px 5px;border-radius:999px;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;background:rgba(105,240,174,.16);color:#69f0ae;vertical-align:middle}
      .saved-audio-badge:empty{display:none}.saved-audio-badge.busy{display:inline-flex;color:#ffd166;background:rgba(255,209,102,.15)}
    `;
    document.head.appendChild(style);
  }

  let previousFolder = null;
  function tick() {
    bindControls();
    const folder = activeFolder();
    if (folder && folder !== previousFolder) {
      previousFolder = folder;
      runtime.loadedFolder = null;
      runtime.meta = {};
      loadSavedAudio(folder, true);
    }
    if (!folder && previousFolder) {
      previousFolder = null;
      runtime.loadedFolder = null;
      runtime.meta = {};
    }
    requestAnimationFrame(tick);
  }

  installStyles();
  bindControls();
  window.rilSongMedia = { loadSavedAudio, uploadTrack, clearSavedTrack };
  requestAnimationFrame(tick);
})();
