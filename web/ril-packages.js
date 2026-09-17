"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const CHUNK_SIZE = 768 * 1024;
  const runtime = {
    file: null,
    uploadId: null,
    preview: null,
    uploading: false,
    exportingFolder: null,
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return `${value.toFixed(0)} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let amount = value / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && amount >= 1024; index++) {
      amount /= 1024;
      unit = units[index];
    }
    return `${amount.toFixed(amount >= 100 ? 0 : amount >= 10 ? 1 : 2)} ${unit}`;
  }

  function formatDuration(ms) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = Math.floor(total % 60);
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function username() {
    return String(window.state?.settings?.profile?.username || "").trim();
  }

  async function saveUsername(value, announce = false) {
    const cleaned = String(value || "").replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 48);
    if (!window.state?.settings) return cleaned;
    window.state.settings.profile ||= {};
    if (window.state.settings.profile.username === cleaned) return cleaned;
    window.state.settings.profile.username = cleaned;
    try {
      window.state.settings = await window.api("/api/settings", { method: "POST", body: window.state.settings });
      if (announce) window.toast?.(`RIL sharing name saved as ${cleaned || "blank"}.`);
      renderIdentity();
      renderHome();
    } catch (error) {
      window.toast?.(`Could not save sharing name: ${error.message}`, "error", 7000);
    }
    return cleaned;
  }

  function installIdentitySettings() {
    if (q("#rilIdentitySettings")) return true;
    const rightColumn = q("#view-settings .grid.two > .grid");
    if (!rightColumn) return false;
    const card = document.createElement("div");
    card.id = "rilIdentitySettings";
    card.className = "card pad";
    card.innerHTML = `
      <div class="eyebrow">Portable RIL packages</div>
      <h2 style="margin-top:4px">Sharing identity</h2>
      <p>This local name appears as “Imported from …” when a friend opens a song package. It is provenance, not proof of chart ownership.</p>
      <div class="field" style="margin-top:14px">
        <label>Username</label>
        <input id="settingRilUsername" maxlength="48" placeholder="gumba21" autocomplete="off">
      </div>
      <div id="rilIdentitySummary" class="list-sub" style="margin-top:9px"></div>`;
    rightColumn.prepend(card);
    q("#saveSettingsButton")?.addEventListener("click", () => {
      if (!window.state?.settings) return;
      window.state.settings.profile ||= {};
      window.state.settings.profile.username = String(q("#settingRilUsername")?.value || "").trim().slice(0, 48);
    }, true);
    q("#settingRilUsername")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveUsername(event.currentTarget.value, true);
      }
    });
    renderIdentity();
    return true;
  }

  function renderIdentity() {
    const input = q("#settingRilUsername");
    if (input && document.activeElement !== input) input.value = username();
    const summary = q("#rilIdentitySummary");
    if (summary) summary.textContent = username()
      ? `Exports will say “Shared by ${username()}”.`
      : "Set a name to label packages you share. Blank exports remain anonymous.";
  }

  function installImportPanel() {
    if (q("#rilImportPanel")) return true;
    const view = q("#view-import");
    const legacyGrid = q("#view-import > .grid.two");
    if (!view || !legacyGrid) return false;
    const panel = document.createElement("section");
    panel.id = "rilImportPanel";
    panel.className = "card pad ril-package-panel";
    panel.innerHTML = `
      <div class="section-title">
        <div><div class="eyebrow">Portable playable song</div><h2>Import a .ril package</h2><p>One compressed file can contain the neutral chart, mechanic mappings, instrumental, vocals, and sharing metadata.</p></div>
        <span class="pill good">RIL v1</span>
      </div>
      <div class="ril-import-grid">
        <label id="rilDropzone" class="dropzone ril-dropzone">
          <input id="rilPackageFile" type="file" accept=".ril,application/vnd.rhythm-input-lab.package">
          <div><div class="ril-file-icon">RIL</div><h3>Drop a .ril song here</h3><p>or click to browse</p><div id="rilFileName" class="file-name"></div></div>
        </label>
        <div id="rilImportPreview" class="ril-preview empty">Choose a package to verify its chart, hashes, audio, and metadata before importing.</div>
      </div>`;
    legacyGrid.before(panel);
    q("#rilPackageFile")?.addEventListener("change", event => event.target.files?.[0] && selectPackage(event.target.files[0]));
    const zone = q("#rilDropzone");
    ["dragenter", "dragover"].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.remove("drag");
    }));
    zone.addEventListener("drop", event => {
      const file = [...(event.dataTransfer?.files || [])].find(item => item.name.toLowerCase().endsWith(".ril"));
      if (file) selectPackage(file);
      else window.toast?.("Drop a .ril package.", "error");
    });
    return true;
  }

  async function cancelUpload() {
    if (!runtime.uploadId) return;
    const uploadId = runtime.uploadId;
    runtime.uploadId = null;
    try {
      await window.api("/api/ril/import/cancel", { method: "POST", body: { upload_id: uploadId } });
    } catch (_) {}
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const block = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += block) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + block)));
    }
    return btoa(binary);
  }

  async function selectPackage(file) {
    if (runtime.uploading) return;
    if (!file.name.toLowerCase().endsWith(".ril")) {
      window.toast?.("Choose a .ril package.", "error");
      return;
    }
    await cancelUpload();
    runtime.file = file;
    runtime.preview = null;
    runtime.uploadId = `ril-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    q("#rilFileName").textContent = `${file.name} · ${formatBytes(file.size)}`;
    await uploadPackage(file);
  }

  async function uploadPackage(file) {
    runtime.uploading = true;
    const preview = q("#rilImportPreview");
    const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    try {
      let result = null;
      for (let index = 0; index < total; index++) {
        const start = index * CHUNK_SIZE;
        const data = arrayBufferToBase64(await file.slice(start, Math.min(file.size, start + CHUNK_SIZE)).arrayBuffer());
        result = await window.api("/api/ril/import/chunk", {
          method: "POST",
          body: {
            upload_id: runtime.uploadId,
            filename: file.name,
            index,
            total,
            data,
          },
        });
        const percent = Math.round((index + 1) / total * 100);
        preview.className = "ril-preview";
        preview.innerHTML = `<div class="ril-progress-head"><b>Verifying package…</b><span>${percent}%</span></div><div class="ril-progress"><i style="width:${percent}%"></i></div><div class="list-sub">Chunk ${index + 1} of ${total} · hashes are checked after upload</div>`;
      }
      if (!result?.complete || !result.preview) throw new Error("The upload finished without a package preview.");
      runtime.preview = result.preview;
      renderImportPreview();
    } catch (error) {
      preview.className = "ril-preview empty";
      preview.textContent = `Package could not be opened: ${error.message}`;
      window.toast?.(`RIL import failed: ${error.message}`, "error", 8000);
    } finally {
      runtime.uploading = false;
    }
  }

  function contentPill(active, label) {
    return `<span class="pill ${active ? "good" : ""}">${active ? "✓" : "—"} ${esc(label)}</span>`;
  }

  function renderImportPreview() {
    const data = runtime.preview;
    const root = q("#rilImportPreview");
    if (!data || !root) return;
    const existing = data.existing;
    const from = data.exported_by ? `Imported from ${data.exported_by}` : "Anonymous package";
    const warnings = (data.warnings || []).map(message => `<div class="ril-warning">${esc(message)}</div>`).join("");
    const modes = existing
      ? `<label>Import behavior<select id="rilImportMode"><option value="separate">Import as a separate copy</option><option value="replace">Replace chart + included audio</option><option value="merge_audio">Only fill missing audio</option></select></label><div class="list-sub">A song named “${esc(existing.song_name)}” already exists. Existing attempts are never deleted.</div>`
      : `<input id="rilImportMode" type="hidden" value="separate"><div class="list-sub">This will create a new song in your local library.</div>`;
    root.className = "ril-preview";
    root.innerHTML = `
      <div class="ril-preview-title"><div><div class="eyebrow">Verified playable package</div><h2>${esc(data.title)}</h2><p>${esc(from)}${data.original_charter ? ` · charter: ${esc(data.original_charter)}` : ""}</p></div><span class="pill good">Compatible</span></div>
      <div class="ril-preview-metrics">
        <div><span>Mode</span><b>${data.key_count}K</b></div>
        <div><span>BPM</span><b>${Number(data.base_bpm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
        <div><span>Duration</span><b>${formatDuration(data.duration_ms)}</b></div>
        <div><span>Chart</span><b>${Number(data.notes || 0).toLocaleString()} notes</b></div>
        <div><span>Package</span><b>${formatBytes(data.package_size)}</b></div>
        <div><span>Source</span><b>${esc(data.source_format || "unknown")}</b></div>
      </div>
      <div class="pill-row">${contentPill(true, "Chart")}${contentPill(data.instrumental, "Instrumental")}${contentPill(data.vocals, "Vocals")}${contentPill(data.original_source, "Original source")}</div>
      ${warnings}
      <div class="ril-import-choice">${modes}</div>
      <div class="actions"><button id="rilCommitImport" class="button primary">Import playable song</button><button id="rilCancelImport" class="button">Cancel</button></div>`;
    q("#rilCommitImport")?.addEventListener("click", commitImport);
    q("#rilCancelImport")?.addEventListener("click", async () => {
      await cancelUpload();
      runtime.preview = null;
      runtime.file = null;
      q("#rilPackageFile").value = "";
      q("#rilFileName").textContent = "";
      root.className = "ril-preview empty";
      root.textContent = "Choose a package to verify its chart, hashes, audio, and metadata before importing.";
    });
  }

  async function commitImport() {
    if (!runtime.uploadId || !runtime.preview) return;
    const button = q("#rilCommitImport");
    const mode = q("#rilImportMode")?.value || "separate";
    button.disabled = true;
    button.textContent = "Importing…";
    try {
      const result = await window.api("/api/ril/import/commit", {
        method: "POST",
        body: { upload_id: runtime.uploadId, mode },
      });
      runtime.uploadId = null;
      runtime.preview = null;
      runtime.file = null;
      window.rilSharedResults?.clear?.();
      if (result.mappings && result.song?.folder) {
        try { localStorage.setItem(`ril-song-mappings:${result.song.folder}`, JSON.stringify(result.mappings)); }
        catch (_) {}
      }
      await window.refreshDashboard?.();
      window.toast?.(`${result.song.song_name} imported${result.imported_from ? ` from ${result.imported_from}` : ""}.`);
      q("#rilImportPreview").className = "ril-preview empty";
      q("#rilImportPreview").innerHTML = `<b>${esc(result.song.song_name)} is ready.</b><div class="actions" style="justify-content:center;margin-top:10px"><button class="button small primary" id="rilOpenImportedPractice">Practice</button><button class="button small" id="rilOpenImportedVisualizer">Visualizer</button></div>`;
      q("#rilOpenImportedPractice")?.addEventListener("click", () => openPractice(result.song.folder));
      q("#rilOpenImportedVisualizer")?.addEventListener("click", () => window.loadVisualizer?.(result.song.folder, null));
      q("#rilPackageFile").value = "";
      q("#rilFileName").textContent = "";
    } catch (error) {
      window.toast?.(`RIL import failed: ${error.message}`, "error", 8000);
      button.disabled = false;
      button.textContent = "Import playable song";
    }
  }

  function installExportModal() {
    if (q("#rilExportModal")) return;
    const modal = document.createElement("div");
    modal.id = "rilExportModal";
    modal.className = "modal-backdrop ril-export-backdrop";
    modal.innerHTML = `
      <div class="modal card ril-export-dialog">
        <div class="ril-export-head"><div><div class="eyebrow">Portable playable song</div><h2 id="rilExportTitle">Export .ril</h2><p>Creates one compressed file your friend can import and immediately play.</p></div><button id="rilExportClose" class="icon-button">×</button></div>
        <div class="field" style="margin-top:16px"><label>Shared by username</label><input id="rilExportUsername" maxlength="48" placeholder="gumba21"></div>
        <div class="ril-export-options">
          <label><input id="rilExportInstrumental" type="checkbox" checked> <span><b>Instrumental</b><small id="rilExportInstrumentalNote"></small></span></label>
          <label><input id="rilExportVocals" type="checkbox" checked> <span><b>Vocals</b><small id="rilExportVocalsNote"></small></span></label>
          <label><input id="rilExportOriginal" type="checkbox"> <span><b>Original source JSON</b><small>Optional; the compact neutral chart is always included.</small></span></label>
        </div>
        <div id="rilExportSummary" class="comfort-summary"></div>
        <div class="actions" style="justify-content:flex-end"><button id="rilExportCancel" class="button">Cancel</button><button id="rilExportCreate" class="button primary">Export .ril</button></div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.classList.remove("open");
    q("#rilExportClose").addEventListener("click", close);
    q("#rilExportCancel").addEventListener("click", close);
    modal.addEventListener("pointerdown", event => { if (event.target === modal) close(); });
    q("#rilExportCreate").addEventListener("click", exportCurrentSong);
  }

  function openExport(folder) {
    installExportModal();
    const song = (window.state?.songs || []).find(row => row.folder === folder);
    if (!song?.has_chart) return window.toast?.("This song needs a chart before it can be exported.", "error");
    runtime.exportingFolder = folder;
    window.rilExportJobs?.setFolder?.(folder);
    q("#rilExportTitle").textContent = `Export ${song.song_name}`;
    q("#rilExportUsername").value = username();
    const inst = Boolean(song.media?.instrumental);
    const vocals = Boolean(song.media?.vocals);
    q("#rilExportInstrumental").disabled = !inst;
    q("#rilExportInstrumental").checked = inst;
    q("#rilExportVocals").disabled = !vocals;
    q("#rilExportVocals").checked = vocals;
    q("#rilExportInstrumentalNote").textContent = inst ? song.media.instrumental.filename || "Saved audio" : "No saved instrumental";
    q("#rilExportVocalsNote").textContent = vocals ? song.media.vocals.filename || "Saved audio" : "No saved vocals";
    q("#rilExportSummary").textContent = `${song.chart?.key_count || "?"}K · ${formatDuration(song.chart?.duration_ms)} · attempts and personal statistics are not included.`;
    q("#rilExportCreate").disabled = false;
    q("#rilExportCreate").textContent = "Export .ril";
    q("#rilExportModal").classList.add("open");
  }

  async function exportCurrentSong(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    if (window.rilExportJobs?.startExport) {
      window.rilExportJobs.setFolder?.(runtime.exportingFolder);
      return window.rilExportJobs.startExport(event);
    }
    const folder = runtime.exportingFolder;
    if (!folder) return;
    const button = q("#rilExportCreate");
    button.disabled = true;
    button.textContent = "Packing audio…";
    try {
      const exportName = await saveUsername(q("#rilExportUsername")?.value || "");
      const result = await window.api("/api/ril/export", {
        method: "POST",
        body: {
          folder,
          username: exportName,
          include_instrumental: q("#rilExportInstrumental")?.checked,
          include_vocals: q("#rilExportVocals")?.checked,
          include_original: q("#rilExportOriginal")?.checked,
          mappings: (() => {
            try { return JSON.parse(localStorage.getItem(`ril-song-mappings:${folder}`) || "null"); }
            catch (_) { return null; }
          })(),
        },
      });
      q("#rilExportSummary").innerHTML = `<b>Package ready · ${formatBytes(result.size_bytes)}</b><div class="list-sub">Chart, mappings, hashes, metadata${q("#rilExportInstrumental")?.checked ? ", instrumental" : ""}${q("#rilExportVocals")?.checked ? ", vocals" : ""}.</div>`;
      const anchor = document.createElement("a");
      anchor.href = result.download_url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      button.textContent = "Exported";
      window.toast?.(`${result.filename} is ready to share.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Export .ril";
      window.toast?.(`RIL export failed: ${error.message}`, "error", 8000);
    }
  }

  function installSongExportHook() {
    if (window.__rilSongExportHook) return;
    window.__rilSongExportHook = true;
    const original = window.openSongModal || (typeof openSongModal === "function" ? openSongModal : null);
    if (!original) return;
    const wrapped = async folder => {
      const result = await original(folder);
      const actions = q("#modalSongBody .actions");
      if (actions && !q("#modalExportRil", actions)) {
        const button = document.createElement("button");
        button.id = "modalExportRil";
        button.className = "button";
        button.textContent = "Export .ril";
        button.addEventListener("click", () => openExport(folder));
        actions.appendChild(button);
      }
      const song = (window.state?.songs || []).find(row => row.folder === folder);
      const from = song?.provenance?.imported_from;
      if (from && !q("#modalRilProvenance")) {
        const line = document.createElement("div");
        line.id = "modalRilProvenance";
        line.className = "ril-provenance-line";
        line.textContent = `Imported from ${from}${song.provenance.source_format ? ` · source ${song.provenance.source_format}` : ""}`;
        q("#modalSongTitle")?.after(line);
      }
      return result;
    };
    window.openSongModal = wrapped;
    try { openSongModal = wrapped; } catch (_) {}
  }

  function installHome() {
    if (q("#rilHomeImports")) return true;
    const dashboard = q("#view-dashboard");
    const existingGrid = q("#view-dashboard > .grid.two");
    if (!dashboard || !existingGrid) return false;
    const card = document.createElement("section");
    card.id = "rilHomeImports";
    card.className = "card ril-home-imports";
    card.innerHTML = `<div class="section-title"><div><div class="eyebrow">Portable library</div><h2>Recently imported</h2></div><button class="button small" data-go-ril="import">Import .ril</button></div><div class="section-body"><div id="rilRecentImports" class="ril-home-grid"></div></div>`;
    existingGrid.after(card);
    q('[data-go-ril="import"]', card).addEventListener("click", () => window.go?.("import"));
    renderHome();
    return true;
  }

  function openPractice(folder) {
    window.go?.("practice");
    const select = q("#practiceSongSelect");
    if (!select) return;
    select.value = folder;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderHome() {
    const root = q("#rilRecentImports");
    if (!root) return;
    const songs = (window.state?.songs || []).filter(song => song.provenance?.imported_from).slice(0, 8);
    root.innerHTML = songs.length
      ? songs.map(song => `<article><div><b>${esc(song.song_name)}</b><span>${esc(song.provenance.imported_from || "Unknown source")}${song.provenance.original_charter ? ` · charter ${esc(song.provenance.original_charter)}` : ""}</span></div><div class="actions"><button class="button small primary" data-ril-practice="${esc(song.folder)}">Practice</button><button class="button small" data-ril-viz="${esc(song.folder)}">Visualizer</button></div></article>`).join("")
      : `<div class="empty">Imported .ril songs will appear here.</div>`;
    qa("[data-ril-practice]", root).forEach(button => button.addEventListener("click", () => openPractice(button.dataset.rilPractice)));
    qa("[data-ril-viz]", root).forEach(button => button.addEventListener("click", () => window.loadVisualizer?.(button.dataset.rilViz, null)));
  }

  function install() {
    installExportModal();
    const ready = installImportPanel() && installIdentitySettings();
    installSongExportHook();
    renderIdentity();
    renderHome();
    return ready;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
  setTimeout(install, 0);
  window.rilPackages = { openExport, selectPackage, cancelUpload, renderHome };
})();
