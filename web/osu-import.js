"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const CHUNK_SIZE = 768 * 1024;
  const runtime = { file: null, uploadId: null, preview: null, uploading: false };

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function formatBytes(bytes) {
    let value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return `${value.toFixed(0)} B`;
    const units = ["KB", "MB", "GB"];
    let unit = units[0];
    value /= 1024;
    for (let index = 1; index < units.length && value >= 1024; index++) {
      value /= 1024;
      unit = units[index];
    }
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${unit}`;
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Number(ms || 0)) / 1000;
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }

  function bpmText(row) {
    const low = Number(row.min_bpm || row.base_bpm || 0);
    const high = Number(row.max_bpm || row.base_bpm || 0);
    if (!low && !high) return "Unknown BPM";
    return Math.abs(high - low) > 0.001 ? `${low.toFixed(2)}–${high.toFixed(2)} BPM` : `${low.toFixed(2)} BPM`;
  }

  function installPanel() {
    if (q("#osuImportPanel")) return true;
    const view = q("#view-import");
    const legacyGrid = q("#view-import > .grid.two");
    if (!view || !legacyGrid) return false;
    const panel = document.createElement("section");
    panel.id = "osuImportPanel";
    panel.className = "card pad osu-import-panel";
    panel.innerHTML = `
      <div class="section-title">
        <div><div class="eyebrow">First external adapter</div><h2>Import osu!mania</h2><p>Drop an <code>.osz</code> beatmap set or standalone <code>.osu</code> chart. Every selected difficulty becomes a neutral RIL song for Practice, Visualizer, Analysis, and portable export.</p></div>
        <span class="pill good">osu!mania</span>
      </div>
      <div class="osu-import-grid">
        <label id="osuDropzone" class="dropzone osu-dropzone">
          <input id="osuSourceFile" type="file" accept=".osz,.osu,application/octet-stream">
          <div><div class="osu-file-icon">osu!</div><h3>Drop .osz or .osu here</h3><p>Audio is discovered automatically inside .osz sets.</p><div id="osuFileName" class="file-name"></div></div>
        </label>
        <div id="osuImportPreview" class="osu-preview empty">Choose an osu!mania beatmap to inspect its difficulties, timing points, holds, audio, and compatibility.</div>
      </div>`;
    const rilPanel = q("#rilImportPanel");
    (rilPanel || legacyGrid).before(panel);
    const head = q("#view-import .page-head");
    if (head) {
      const eyebrow = q(".eyebrow", head);
      const description = q("p", head);
      if (eyebrow) eyebrow.textContent = "Universal importer";
      if (description) description.textContent = "Import osu!mania beatmaps, portable RIL songs, or legacy/Psych FNF charts into one shared library.";
    }
    const input = q("#osuSourceFile");
    input.addEventListener("change", event => event.target.files?.[0] && selectSource(event.target.files[0]));
    const zone = q("#osuDropzone");
    ["dragenter", "dragover"].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.remove("drag");
    }));
    zone.addEventListener("drop", event => {
      const file = [...(event.dataTransfer?.files || [])].find(item => /\.(osz|osu)$/i.test(item.name));
      if (file) selectSource(file);
      else window.toast?.("Drop an .osz beatmap set or standalone .osu chart.", "error");
    });
    return true;
  }

  async function cancelUpload() {
    if (!runtime.uploadId) return;
    const uploadId = runtime.uploadId;
    runtime.uploadId = null;
    try {
      await window.api("/api/osu/import/cancel", { method: "POST", body: { upload_id: uploadId } });
    } catch (_) {}
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return btoa(binary);
  }

  async function selectSource(file) {
    if (runtime.uploading) return;
    if (!/\.(osz|osu)$/i.test(file.name)) {
      window.toast?.("Choose an .osz or .osu file.", "error");
      return;
    }
    await cancelUpload();
    runtime.file = file;
    runtime.preview = null;
    runtime.uploadId = `osu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    q("#osuFileName").textContent = `${file.name} · ${formatBytes(file.size)}`;
    await uploadSource(file);
  }

  async function uploadSource(file) {
    runtime.uploading = true;
    const preview = q("#osuImportPreview");
    const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    try {
      let result = null;
      for (let index = 0; index < total; index++) {
        const start = index * CHUNK_SIZE;
        const data = arrayBufferToBase64(await file.slice(start, Math.min(file.size, start + CHUNK_SIZE)).arrayBuffer());
        result = await window.api("/api/osu/import/chunk", {
          method: "POST",
          body: { upload_id: runtime.uploadId, filename: file.name, index, total, data },
        });
        const percent = Math.round((index + 1) / total * 100);
        preview.className = "osu-preview";
        preview.innerHTML = `<div class="osu-progress-head"><b>Reading osu! beatmap…</b><span>${percent}%</span></div><div class="osu-progress"><i style="width:${percent}%"></i></div><div class="list-sub">Chunk ${index + 1} of ${total}${percent === 100 ? " · parsing every mania difficulty" : ""}</div>`;
      }
      if (!result?.complete || !result.preview) throw new Error("The upload finished without a beatmap preview.");
      runtime.preview = result.preview;
      renderPreview();
    } catch (error) {
      preview.className = "osu-preview empty";
      preview.textContent = `Beatmap could not be opened: ${error.message}`;
      window.toast?.(`osu!mania import failed: ${error.message}`, "error", 8000);
    } finally {
      runtime.uploading = false;
    }
  }

  function difficultyCard(row, index) {
    const warnings = (row.warnings || []).map(message => `<div class="osu-diff-warning">${esc(message)}</div>`).join("");
    return `<label class="osu-difficulty-card">
      <input class="osu-difficulty-check" type="checkbox" value="${esc(row.id)}" checked>
      <div class="osu-difficulty-main">
        <div class="osu-difficulty-head"><div><b>${esc(row.version || `Difficulty ${index + 1}`)}</b><span>${esc(row.creator ? `mapped by ${row.creator}` : "unknown mapper")}</span></div><span class="pill">${row.key_count}K</span></div>
        <div class="osu-difficulty-meta"><span>${Number(row.notes || 0).toLocaleString()} notes</span><span>${Number(row.holds || 0).toLocaleString()} holds</span><span>${formatDuration(row.duration_ms)}</span><span>${esc(bpmText(row))}</span></div>
        <div class="pill-row"><span class="pill good">Chart</span><span class="pill ${row.has_audio ? "good" : ""}">${row.has_audio ? "✓" : "—"} Audio</span></div>
        ${warnings}
      </div>
    </label>`;
  }

  function renderPreview() {
    const data = runtime.preview;
    const root = q("#osuImportPreview");
    if (!data || !root) return;
    const rows = data.difficulties || [];
    const topWarnings = (data.warnings || []).map(message => `<div class="osu-warning">${esc(message)}</div>`).join("");
    const unsupported = (data.unsupported || []).slice(0, 8).map(row => `<div class="osu-unsupported"><b>${esc(row.entry_name)}</b><span>${esc(row.error)}</span></div>`).join("");
    root.className = "osu-preview";
    root.innerHTML = `
      <div class="osu-preview-title"><div><div class="eyebrow">${data.kind === "osz" ? "Beatmap set" : "Standalone chart"}</div><h2>${esc(data.artist ? `${data.artist} — ${data.title}` : data.filename)}</h2><p>${rows.length} supported mania difficult${rows.length === 1 ? "y" : "ies"} · ${formatBytes(data.upload_size)}</p></div><span class="pill good">Neutral RIL ready</span></div>
      ${topWarnings}
      <div class="osu-select-toolbar"><div><button id="osuSelectAll" class="button small">Select all</button><button id="osuSelectNone" class="button small">Select none</button></div><label>Existing names<select id="osuImportMode"><option value="separate">Import as separate copies</option><option value="replace">Replace matching charts</option></select></label></div>
      <div class="osu-difficulty-list">${rows.map(difficultyCard).join("")}</div>
      ${unsupported ? `<details class="osu-unsupported-list"><summary>${data.unsupported.length} unsupported/invalid chart${data.unsupported.length === 1 ? "" : "s"} skipped</summary>${unsupported}</details>` : ""}
      <div id="osuSelectionSummary" class="comfort-summary"></div>
      <div class="actions"><button id="osuCommitImport" class="button primary">Import selected difficulties</button><button id="osuCancelImport" class="button">Cancel</button></div>`;
    q("#osuSelectAll").addEventListener("click", () => { qa(".osu-difficulty-check", root).forEach(input => { input.checked = true; }); updateSelection(); });
    q("#osuSelectNone").addEventListener("click", () => { qa(".osu-difficulty-check", root).forEach(input => { input.checked = false; }); updateSelection(); });
    qa(".osu-difficulty-check", root).forEach(input => input.addEventListener("change", updateSelection));
    q("#osuCommitImport").addEventListener("click", commitImport);
    q("#osuCancelImport").addEventListener("click", resetImport);
    updateSelection();
  }

  function updateSelection() {
    const root = q("#osuImportPreview");
    const selected = qa(".osu-difficulty-check:checked", root);
    const all = qa(".osu-difficulty-check", root);
    const audioCount = selected.filter(input => runtime.preview.difficulties.find(row => String(row.id) === input.value)?.has_audio).length;
    const summary = q("#osuSelectionSummary");
    if (summary) summary.textContent = `${selected.length} of ${all.length} selected · ${audioCount} with automatic audio · each difficulty becomes its own song entry.`;
    const button = q("#osuCommitImport");
    if (button) button.disabled = selected.length === 0;
  }

  async function resetImport() {
    await cancelUpload();
    runtime.file = null;
    runtime.preview = null;
    const input = q("#osuSourceFile");
    if (input) input.value = "";
    q("#osuFileName").textContent = "";
    const root = q("#osuImportPreview");
    root.className = "osu-preview empty";
    root.textContent = "Choose an osu!mania beatmap to inspect its difficulties, timing points, holds, audio, and compatibility.";
  }

  async function commitImport() {
    if (!runtime.uploadId || !runtime.preview) return;
    const difficultyIds = qa(".osu-difficulty-check:checked", q("#osuImportPreview")).map(input => input.value);
    if (!difficultyIds.length) return;
    const button = q("#osuCommitImport");
    button.disabled = true;
    button.textContent = "Importing charts + audio…";
    try {
      const result = await window.api("/api/osu/import/commit", {
        method: "POST",
        body: { upload_id: runtime.uploadId, difficulty_ids: difficultyIds, mode: q("#osuImportMode")?.value || "separate" },
      });
      runtime.uploadId = null;
      runtime.file = null;
      runtime.preview = null;
      window.rilSharedResults?.clear?.();
      await window.refreshDashboard?.();
      renderSuccess(result);
      window.toast?.(`${result.count} osu!mania difficult${result.count === 1 ? "y" : "ies"} imported.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Import selected difficulties";
      window.toast?.(`osu!mania import failed: ${error.message}`, "error", 9000);
    }
  }

  function openPractice(folder) {
    window.go?.("practice");
    const select = q("#practiceSongSelect");
    if (!select) return;
    select.value = folder;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderSuccess(result) {
    const root = q("#osuImportPreview");
    const rows = result.imported || [];
    root.className = "osu-preview";
    root.innerHTML = `<div class="osu-preview-title"><div><div class="eyebrow">Import complete</div><h2>${rows.length} osu!mania song${rows.length === 1 ? "" : "s"} ready</h2><p>Charts are now neutral RIL data and can be practiced, analyzed, visualized, or exported as .ril packages.</p></div><span class="pill good">Done</span></div><div class="osu-imported-list">${rows.map(row => `<article><div><b>${esc(row.song.song_name)}</b><span>${row.summary.key_count}K · ${Number(row.summary.player_notes || 0).toLocaleString()} notes${row.audio_saved ? " · audio saved" : " · add audio manually"}</span></div><div class="actions"><button class="button small primary" data-osu-practice="${esc(row.song.folder)}">Practice</button><button class="button small" data-osu-viz="${esc(row.song.folder)}">Visualizer</button></div></article>`).join("")}</div><div class="actions"><button id="osuImportAnother" class="button">Import another osu! beatmap</button></div>`;
    qa("[data-osu-practice]", root).forEach(button => button.addEventListener("click", () => openPractice(button.dataset.osuPractice)));
    qa("[data-osu-viz]", root).forEach(button => button.addEventListener("click", () => window.loadVisualizer?.(button.dataset.osuViz, null)));
    q("#osuImportAnother").addEventListener("click", resetImport);
    const input = q("#osuSourceFile");
    if (input) input.value = "";
    q("#osuFileName").textContent = "";
  }

  function enhanceSongCards() {
    qa(".song-card[data-song-folder]").forEach(card => {
      const song = (window.state?.songs || []).find(row => row.folder === card.dataset.songFolder);
      if (song?.provenance?.source_format !== "osu_mania" || q(".osu-source-pill", card)) return;
      const row = q(".pill-row", card);
      if (!row) return;
      const pill = document.createElement("span");
      pill.className = "pill osu-source-pill";
      pill.textContent = "osu!mania";
      row.appendChild(pill);
    });
  }

  function installRenderHook() {
    if (window.__rilOsuRenderHook) return;
    window.__rilOsuRenderHook = true;
    if (typeof renderSongs === "function") {
      const original = renderSongs;
      renderSongs = function(...args) {
        const result = original.apply(this, args);
        setTimeout(enhanceSongCards, 0);
        return result;
      };
      window.renderSongs = renderSongs;
    }
    if (typeof renderDashboard === "function") {
      const original = renderDashboard;
      renderDashboard = function(...args) {
        const result = original.apply(this, args);
        setTimeout(enhanceSongCards, 0);
        return result;
      };
      window.renderDashboard = renderDashboard;
    }
  }

  function installStyles() {
    if (q("#osuImportStyles")) return;
    const style = document.createElement("style");
    style.id = "osuImportStyles";
    style.textContent = `
      .osu-import-panel{margin-bottom:16px}.osu-import-grid{display:grid;grid-template-columns:minmax(260px,.72fr) minmax(420px,1.28fr);gap:14px;margin-top:14px}.osu-dropzone{min-height:300px}.osu-file-icon{display:inline-grid;place-items:center;width:58px;height:58px;margin-bottom:9px;border:1px solid rgba(255,102,171,.32);border-radius:50%;background:rgba(255,102,171,.1);font-weight:950;color:#ff78b7}.osu-preview{min-height:300px;padding:15px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018)}.osu-preview.empty{display:grid;place-items:center;text-align:center;color:var(--muted)}.osu-progress-head,.osu-preview-title,.osu-difficulty-head,.osu-select-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.osu-progress{height:8px;margin:14px 0 8px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}.osu-progress i{display:block;height:100%;background:#ff78b7}.osu-preview-title h2{margin:3px 0 4px}.osu-preview-title p{margin:0;color:var(--muted);font-size:12px}.osu-select-toolbar{align-items:end;margin:13px 0 9px}.osu-select-toolbar>div{display:flex;gap:6px}.osu-select-toolbar label{display:flex;flex-direction:column;gap:4px;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.osu-difficulty-list{display:grid;gap:7px;max-height:460px;overflow:auto;padding-right:3px}.osu-difficulty-card{display:flex;gap:10px;padding:11px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.018);cursor:pointer}.osu-difficulty-card:hover{border-color:rgba(255,120,183,.28)}.osu-difficulty-card>input{margin-top:4px}.osu-difficulty-main{min-width:0;flex:1}.osu-difficulty-head b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.osu-difficulty-head span:not(.pill){display:block;margin-top:2px;color:var(--muted);font-size:10px}.osu-difficulty-meta{display:flex;flex-wrap:wrap;gap:5px 12px;margin:8px 0;font-size:10px;color:var(--muted)}.osu-diff-warning,.osu-warning{margin-top:7px;padding:7px 9px;border:1px solid rgba(255,209,102,.22);border-radius:8px;background:rgba(255,209,102,.06);font-size:10px;color:var(--muted)}.osu-unsupported-list{margin:10px 0;color:var(--muted);font-size:11px}.osu-unsupported{display:flex;flex-direction:column;padding:7px 0;border-bottom:1px solid var(--line)}.osu-unsupported span{font-size:10px}.osu-imported-list{display:grid;gap:7px;margin:14px 0}.osu-imported-list article{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:10px}.osu-imported-list article span{display:block;margin-top:3px;color:var(--muted);font-size:10px}.osu-source-pill{color:#ff91c5;border-color:rgba(255,120,183,.28)}
      @media(max-width:900px){.osu-import-grid{grid-template-columns:1fr}.osu-select-toolbar{align-items:flex-start;flex-direction:column}.osu-imported-list article{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function boot() {
    installStyles();
    installRenderHook();
    const timer = setInterval(() => {
      if (installPanel()) clearInterval(timer);
      enhanceSongCards();
    }, 100);
    setTimeout(() => { installPanel(); enhanceSongCards(); }, 0);
  }

  window.rilOsuImport = { selectSource, cancelUpload };
  boot();
})();
