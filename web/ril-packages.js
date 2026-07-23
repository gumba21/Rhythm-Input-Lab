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

  async function exportCurrentSong() {
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
    const heading = q("#view-dashboard .page-head h1");
    if (heading) heading.textContent = username() ? `Welcome back, ${username()}.` : "Welcome back.";
    const root = q("#rilRecentImports");
    if (!root) return;
    const rows = window.state?.dashboard?.recent_imports || [];
    root.innerHTML = rows.length ? rows.map(song => {
      const from = song.provenance?.imported_from || "anonymous";
      return `<article class="ril-home-card"><div><div class="song-title">${esc(song.song_name)}</div><div class="song-meta">from ${esc(from)} · ${song.chart?.key_count || "?"}K · ${formatDuration(song.chart?.duration_ms)}</div></div><div class="actions"><button class="button small primary" data-ril-practice="${esc(song.folder)}">Practice</button><button class="button small" data-ril-viz="${esc(song.folder)}">Visualizer</button></div></article>`;
    }).join("") : `<div class="empty">Songs imported from friends will appear here with their sharing username.</div>`;
    qa("[data-ril-practice]", root).forEach(button => button.addEventListener("click", () => openPractice(button.dataset.rilPractice)));
    qa("[data-ril-viz]", root).forEach(button => button.addEventListener("click", () => window.loadVisualizer?.(button.dataset.rilViz, null)));
  }

  function enhanceSongCards() {
    qa(".song-card[data-song-folder]").forEach(card => {
      const song = (window.state?.songs || []).find(row => row.folder === card.dataset.songFolder);
      const from = song?.provenance?.imported_from;
      if (!from || q(".ril-from-pill", card)) return;
      const row = q(".pill-row", card);
      if (!row) return;
      const pill = document.createElement("span");
      pill.className = "pill ril-from-pill";
      pill.textContent = `from ${from}`;
      row.appendChild(pill);
    });
  }

  function installRenderHooks() {
    if (window.__rilRenderHooks) return;
    window.__rilRenderHooks = true;
    if (typeof renderDashboard === "function") {
      const originalDashboard = renderDashboard;
      renderDashboard = function(...args) {
        const result = originalDashboard.apply(this, args);
        renderHome();
        setTimeout(enhanceSongCards, 0);
        return result;
      };
      window.renderDashboard = renderDashboard;
    }
    if (typeof renderSongs === "function") {
      const originalSongs = renderSongs;
      renderSongs = function(...args) {
        const result = originalSongs.apply(this, args);
        setTimeout(enhanceSongCards, 0);
        return result;
      };
      window.renderSongs = renderSongs;
    }
    if (typeof renderSettings === "function") {
      const originalSettings = renderSettings;
      renderSettings = function(...args) {
        const result = originalSettings.apply(this, args);
        renderIdentity();
        return result;
      };
      window.renderSettings = renderSettings;
    }
  }

  function installStyles() {
    if (q("#rilPackageStyles")) return;
    const style = document.createElement("style");
    style.id = "rilPackageStyles";
    style.textContent = `
      .ril-package-panel{margin-bottom:16px}.ril-import-grid{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(340px,1.2fr);gap:14px;margin-top:14px}.ril-dropzone{min-height:260px}.ril-file-icon{display:inline-grid;place-items:center;width:56px;height:56px;margin-bottom:8px;border:1px solid var(--line);border-radius:14px;background:rgba(117,230,255,.08);font-weight:950;letter-spacing:.08em;color:var(--accent)}
      .ril-preview{min-height:260px;padding:15px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018)}.ril-preview.empty{display:grid;place-items:center;text-align:center;color:var(--muted)}.ril-progress-head,.ril-preview-title,.ril-export-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.ril-progress{height:8px;margin:14px 0 8px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}.ril-progress i{display:block;height:100%;background:var(--accent)}.ril-preview-title h2,.ril-export-head h2{margin:3px 0 4px}.ril-preview-title p,.ril-export-head p{margin:0;color:var(--muted);font-size:12px}.ril-preview-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:13px 0}.ril-preview-metrics div{padding:9px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.02)}.ril-preview-metrics span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}.ril-preview-metrics b{display:block;margin-top:3px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ril-warning{margin-top:8px;padding:8px 10px;border:1px solid rgba(255,209,102,.25);border-radius:9px;background:rgba(255,209,102,.07);font-size:11px;color:var(--muted)}.ril-import-choice{margin:12px 0}.ril-import-choice label{display:flex;flex-direction:column;gap:5px;font-size:10px;color:var(--muted)}
      .ril-export-backdrop.open{display:grid}.ril-export-dialog{width:min(620px,94vw)}.ril-export-options{display:grid;gap:8px;margin:14px 0}.ril-export-options>label{display:flex;align-items:flex-start;gap:10px;padding:11px;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.018)}.ril-export-options input{margin-top:3px}.ril-export-options span{display:flex;flex-direction:column}.ril-export-options small{margin-top:2px;color:var(--muted)}.ril-provenance-line{margin-top:3px;color:var(--muted);font-size:12px}
      .ril-home-imports{margin-top:16px}.ril-home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:9px}.ril-home-card{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.018)}.ril-home-card .actions{flex:none}.ril-from-pill{border-color:rgba(117,230,255,.24);color:var(--accent)}
      @media(max-width:850px){.ril-import-grid{grid-template-columns:1fr}.ril-preview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.ril-home-card{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function boot() {
    installStyles();
    installExportModal();
    installSongExportHook();
    installRenderHooks();
    const timer = setInterval(() => {
      const ready = installIdentitySettings() && installImportPanel() && installHome();
      renderIdentity();
      renderHome();
      enhanceSongCards();
      if (ready) clearInterval(timer);
    }, 100);
    setTimeout(() => {
      installIdentitySettings();
      installImportPanel();
      installHome();
      renderHome();
      enhanceSongCards();
    }, 0);
  }

  window.rilPackages = { openExport, selectPackage, saveUsername, renderHome };
  boot();
})();
