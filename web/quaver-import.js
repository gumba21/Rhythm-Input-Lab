"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const CHUNK_SIZE = 768 * 1024;
  const runtime = { file: null, uploadId: null, preview: null, uploading: false };

  function esc(value) {
    return String(value ?? "").replace(/[&<>'\"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '\"': "&quot;",
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
    if (q("#quaverImportPanel")) return true;
    const view = q("#view-import");
    const legacyGrid = q("#view-import > .grid.two");
    if (!view || !legacyGrid) return false;
    const panel = document.createElement("section");
    panel.id = "quaverImportPanel";
    panel.className = "card pad quaver-import-panel";
    panel.innerHTML = `
      <div class="section-title">
        <div><div class="eyebrow">Universal adapter</div><h2>Import Quaver</h2><p>Drop a standalone <code>.qua</code> chart or a multi-difficulty <code>.qp</code> mapset. Notes, holds, mines, timing, SV, metadata, and source extensions become neutral RIL data.</p></div>
        <span class="pill good">Quaver</span>
      </div>
      <div class="quaver-import-grid">
        <label id="quaverDropzone" class="dropzone quaver-dropzone">
          <input id="quaverSourceFile" type="file" accept=".qua,.qp,application/octet-stream">
          <div><div class="quaver-file-icon">Q</div><h3>Drop .qua or .qp here</h3><p>Audio is discovered automatically inside .qp mapsets.</p><div id="quaverFileName" class="file-name"></div></div>
        </label>
        <div id="quaverImportPreview" class="quaver-preview empty">Choose a Quaver chart to inspect difficulties, mines, timing groups, scroll data, audio, and compatibility.</div>
      </div>`;
    const rilPanel = q("#rilImportPanel");
    const osuPanel = q("#osuImportPanel");
    (rilPanel || osuPanel || legacyGrid).before(panel);
    const head = q("#view-import .page-head");
    if (head) {
      const description = q("p", head);
      if (description) description.textContent = "Import Quaver, osu!mania, portable RIL songs, or legacy/Psych FNF charts into one shared library.";
    }
    const input = q("#quaverSourceFile");
    input.addEventListener("change", event => event.target.files?.[0] && selectSource(event.target.files[0]));
    const zone = q("#quaverDropzone");
    ["dragenter", "dragover"].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach(type => zone.addEventListener(type, event => {
      event.preventDefault();
      zone.classList.remove("drag");
    }));
    zone.addEventListener("drop", event => {
      const file = [...(event.dataTransfer?.files || [])].find(item => /\.(qua|qp)$/i.test(item.name));
      if (file) selectSource(file);
      else window.toast?.("Drop a .qua chart or .qp Quaver mapset.", "error");
    });
    return true;
  }

  async function cancelUpload() {
    if (!runtime.uploadId) return;
    const uploadId = runtime.uploadId;
    runtime.uploadId = null;
    try {
      await window.api("/api/quaver/import/cancel", { method: "POST", body: { upload_id: uploadId } });
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
    if (!/\.(qua|qp)$/i.test(file.name)) {
      window.toast?.("Choose a .qua or .qp file.", "error");
      return;
    }
    await cancelUpload();
    runtime.file = file;
    runtime.preview = null;
    runtime.uploadId = `quaver-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    q("#quaverFileName").textContent = `${file.name} · ${formatBytes(file.size)}`;
    await uploadSource(file);
  }

  async function uploadSource(file) {
    runtime.uploading = true;
    const preview = q("#quaverImportPreview");
    const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    try {
      let result = null;
      for (let index = 0; index < total; index++) {
        const start = index * CHUNK_SIZE;
        const data = arrayBufferToBase64(await file.slice(start, Math.min(file.size, start + CHUNK_SIZE)).arrayBuffer());
        result = await window.api("/api/quaver/import/chunk", {
          method: "POST",
          body: { upload_id: runtime.uploadId, filename: file.name, index, total, data },
        });
        const percent = Math.round((index + 1) / total * 100);
        preview.className = "quaver-preview";
        preview.innerHTML = `<div class="quaver-progress-head"><b>Reading Quaver mapset…</b><span>${percent}%</span></div><div class="quaver-progress"><i style="width:${percent}%"></i></div><div class="list-sub">Chunk ${index + 1} of ${total}${percent === 100 ? " · parsing every difficulty" : ""}</div>`;
      }
      if (!result?.complete || !result.preview) throw new Error("The upload finished without a Quaver preview.");
      runtime.preview = result.preview;
      renderPreview();
    } catch (error) {
      preview.className = "quaver-preview empty";
      preview.textContent = `Quaver source could not be opened: ${error.message}`;
      window.toast?.(`Quaver import failed: ${error.message}`, "error", 9000);
    } finally {
      runtime.uploading = false;
    }
  }

  function difficultyCard(row, index) {
    const warnings = (row.warnings || []).map(message => `<div class="quaver-diff-warning">${esc(message)}</div>`).join("");
    return `<label class="quaver-difficulty-card">
      <input class="quaver-difficulty-check" type="checkbox" value="${esc(row.id)}" checked>
      <div class="quaver-difficulty-main">
        <div class="quaver-difficulty-head"><div><b>${esc(row.difficulty || `Difficulty ${index + 1}`)}</b><span>${esc(row.creator ? `mapped by ${row.creator}` : "unknown mapper")}</span></div><span class="pill">${row.key_count}K</span></div>
        <div class="quaver-difficulty-meta"><span>${Number(row.notes || 0).toLocaleString()} objects</span><span>${Number(row.holds || 0).toLocaleString()} holds</span><span>${Number(row.mines || 0).toLocaleString()} mines</span><span>${formatDuration(row.duration_ms)}</span><span>${esc(bpmText(row))}</span><span>${Number(row.active_actions_per_second || 0).toFixed(2)} active APS</span></div>
        <div class="pill-row"><span class="pill good">Chart</span><span class="pill ${row.has_audio ? "good" : ""}">${row.has_audio ? "✓" : "—"} Audio</span><span class="pill">${Number(row.sv_count || 0)} SV</span><span class="pill">${Number(row.ssf_count || 0)} SSF</span></div>
        ${warnings}
      </div>
    </label>`;
  }

  function capabilityBlock(data) {
    const capabilities = data.capabilities || {};
    const group = (label, rows) => rows?.length ? `<div><b>${label}</b><span>${rows.map(esc).join(" · ")}</span></div>` : "";
    return `<details class="quaver-capabilities"><summary>Conversion capability report</summary>${group("Preserved", capabilities.preserved)}${group("Extension-stored", capabilities.extension_stored)}${group("Approximated", capabilities.approximated)}${group("Not rendered", capabilities.not_rendered)}</details>`;
  }

  function renderPreview() {
    const data = runtime.preview;
    const root = q("#quaverImportPreview");
    if (!data || !root) return;
    const rows = data.difficulties || [];
    const topWarnings = (data.warnings || []).map(message => `<div class="quaver-warning">${esc(message)}</div>`).join("");
    const unsupported = (data.unsupported || []).slice(0, 8).map(row => `<div class="quaver-unsupported"><b>${esc(row.entry_name)}</b><span>${esc(row.error)}</span></div>`).join("");
    root.className = "quaver-preview";
    root.innerHTML = `
      <div class="quaver-preview-title"><div><div class="eyebrow">${data.kind === "qp" ? "Quaver mapset" : "Standalone chart"}</div><h2>${esc(data.artist ? `${data.artist} — ${data.title}` : data.filename)}</h2><p>${rows.length} supported difficult${rows.length === 1 ? "y" : "ies"} · ${formatBytes(data.upload_size)}</p></div><span class="pill good">Neutral RIL ready</span></div>
      ${topWarnings}${capabilityBlock(data)}
      <div class="quaver-select-toolbar"><div><button id="quaverSelectAll" class="button small">Select all</button><button id="quaverSelectNone" class="button small">Select none</button></div><label>Existing names<select id="quaverImportMode"><option value="separate">Import as separate copies</option><option value="replace">Replace matching charts</option></select></label></div>
      <div class="quaver-difficulty-list">${rows.map(difficultyCard).join("")}</div>
      ${unsupported ? `<details class="quaver-unsupported-list"><summary>${data.unsupported.length} unsupported/invalid chart${data.unsupported.length === 1 ? "" : "s"} skipped</summary>${unsupported}</details>` : ""}
      <div id="quaverSelectionSummary" class="comfort-summary"></div>
      <div class="actions"><button id="quaverCommitImport" class="button primary">Import selected difficulties</button><button id="quaverCancelImport" class="button">Cancel</button></div>`;
    q("#quaverSelectAll").addEventListener("click", () => { qa(".quaver-difficulty-check", root).forEach(input => { input.checked = true; }); updateSelection(); });
    q("#quaverSelectNone").addEventListener("click", () => { qa(".quaver-difficulty-check", root).forEach(input => { input.checked = false; }); updateSelection(); });
    qa(".quaver-difficulty-check", root).forEach(input => input.addEventListener("change", updateSelection));
    q("#quaverCommitImport").addEventListener("click", commitImport);
    q("#quaverCancelImport").addEventListener("click", resetImport);
    updateSelection();
  }

  function updateSelection() {
    const root = q("#quaverImportPreview");
    const selected = qa(".quaver-difficulty-check:checked", root);
    const all = qa(".quaver-difficulty-check", root);
    const audioCount = selected.filter(input => runtime.preview.difficulties.find(row => String(row.id) === input.value)?.has_audio).length;
    const mineCount = selected.reduce((sum, input) => sum + Number(runtime.preview.difficulties.find(row => String(row.id) === input.value)?.mines || 0), 0);
    const summary = q("#quaverSelectionSummary");
    if (summary) summary.textContent = `${selected.length} of ${all.length} selected · ${audioCount} with automatic audio · ${mineCount.toLocaleString()} mines preserved as hazards.`;
    const button = q("#quaverCommitImport");
    if (button) button.disabled = selected.length === 0;
  }

  async function resetImport() {
    await cancelUpload();
    runtime.file = null;
    runtime.preview = null;
    const input = q("#quaverSourceFile");
    if (input) input.value = "";
    q("#quaverFileName").textContent = "";
    const root = q("#quaverImportPreview");
    root.className = "quaver-preview empty";
    root.textContent = "Choose a Quaver chart to inspect difficulties, mines, timing groups, scroll data, audio, and compatibility.";
  }

  async function commitImport() {
    if (!runtime.uploadId || !runtime.preview) return;
    const difficultyIds = qa(".quaver-difficulty-check:checked", q("#quaverImportPreview")).map(input => input.value);
    if (!difficultyIds.length) return;
    const button = q("#quaverCommitImport");
    button.disabled = true;
    button.textContent = "Importing charts + audio…";
    try {
      const result = await window.api("/api/quaver/import/commit", {
        method: "POST",
        body: { upload_id: runtime.uploadId, difficulty_ids: difficultyIds, mode: q("#quaverImportMode")?.value || "separate" },
      });
      runtime.uploadId = null;
      runtime.file = null;
      runtime.preview = null;
      window.rilSharedResults?.clear?.();
      await window.refreshDashboard?.();
      renderSuccess(result);
      window.toast?.(`${result.count} Quaver difficult${result.count === 1 ? "y" : "ies"} imported.`);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Import selected difficulties";
      window.toast?.(`Quaver import failed: ${error.message}`, "error", 9000);
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
    const root = q("#quaverImportPreview");
    const rows = result.imported || [];
    root.className = "quaver-preview";
    root.innerHTML = `<div class="quaver-preview-title"><div><div class="eyebrow">Import complete</div><h2>${rows.length} Quaver song${rows.length === 1 ? "" : "s"} ready</h2><p>Charts now use neutral RIL data and can be practiced, analyzed, visualized, or exported as .ril packages.</p></div><span class="pill good">Done</span></div><div class="quaver-imported-list">${rows.map(row => `<article><div><b>${esc(row.song.song_name)}</b><span>${row.summary.key_count}K · ${Number(row.summary.player_notes || 0).toLocaleString()} objects · ${Number(row.summary.mine_notes || 0).toLocaleString()} mines${row.audio_saved ? " · audio saved" : " · add audio manually"}</span></div><div class="actions"><button class="button small primary" data-quaver-practice="${esc(row.song.folder)}">Practice</button><button class="button small" data-quaver-viz="${esc(row.song.folder)}">Visualizer</button></div></article>`).join("")}</div><div class="actions"><button id="quaverImportAnother" class="button">Import another Quaver mapset</button></div>`;
    qa("[data-quaver-practice]", root).forEach(button => button.addEventListener("click", () => openPractice(button.dataset.quaverPractice)));
    qa("[data-quaver-viz]", root).forEach(button => button.addEventListener("click", () => window.loadVisualizer?.(button.dataset.quaverViz, null)));
    q("#quaverImportAnother").addEventListener("click", resetImport);
    const input = q("#quaverSourceFile");
    if (input) input.value = "";
    q("#quaverFileName").textContent = "";
  }

  function enhanceSongCards() {
    qa(".song-card[data-song-folder]").forEach(card => {
      const song = (window.state?.songs || []).find(row => row.folder === card.dataset.songFolder);
      if (song?.provenance?.source_format !== "quaver_qua" || q(".quaver-source-pill", card)) return;
      const row = q(".pill-row", card);
      if (!row) return;
      const pill = document.createElement("span");
      pill.className = "pill quaver-source-pill";
      pill.textContent = "Quaver";
      row.appendChild(pill);
    });
  }

  function installRenderHook() {
    if (window.__rilQuaverRenderHook) return;
    window.__rilQuaverRenderHook = true;
    for (const name of ["renderSongs", "renderDashboard"]) {
      const original = window[name];
      if (typeof original !== "function") continue;
      window[name] = function(...args) {
        const result = original.apply(this, args);
        setTimeout(enhanceSongCards, 0);
        return result;
      };
    }
  }

  function installStyles() {
    if (q("#quaverImportStyles")) return;
    const style = document.createElement("style");
    style.id = "quaverImportStyles";
    style.textContent = `
      .quaver-import-panel{margin-bottom:16px}.quaver-import-grid{display:grid;grid-template-columns:minmax(260px,.72fr) minmax(420px,1.28fr);gap:14px;margin-top:14px}.quaver-dropzone{min-height:300px}.quaver-file-icon{display:inline-grid;place-items:center;width:58px;height:58px;margin-bottom:9px;border:1px solid rgba(83,222,145,.34);border-radius:14px;background:rgba(83,222,145,.1);font-weight:950;color:#72eda8}.quaver-preview{min-height:300px;padding:15px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018)}.quaver-preview.empty{display:grid;place-items:center;text-align:center;color:var(--muted)}.quaver-progress-head,.quaver-preview-title,.quaver-difficulty-head,.quaver-select-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.quaver-progress{height:8px;margin:14px 0 8px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}.quaver-progress i{display:block;height:100%;background:#72eda8}.quaver-preview-title h2{margin:3px 0 4px}.quaver-preview-title p{margin:0;color:var(--muted);font-size:12px}.quaver-select-toolbar{align-items:end;margin:13px 0 9px}.quaver-select-toolbar>div{display:flex;gap:6px}.quaver-select-toolbar label{display:flex;flex-direction:column;gap:4px;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.quaver-difficulty-list{display:grid;gap:7px;max-height:460px;overflow:auto;padding-right:3px}.quaver-difficulty-card{display:flex;gap:10px;padding:11px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.018);cursor:pointer}.quaver-difficulty-card:hover{border-color:rgba(114,237,168,.3)}.quaver-difficulty-card>input{margin-top:4px}.quaver-difficulty-main{min-width:0;flex:1}.quaver-difficulty-head b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.quaver-difficulty-head span:not(.pill){display:block;margin-top:2px;color:var(--muted);font-size:10px}.quaver-difficulty-meta{display:flex;flex-wrap:wrap;gap:5px 12px;margin:8px 0;font-size:10px;color:var(--muted)}.quaver-diff-warning,.quaver-warning{margin-top:7px;padding:7px 9px;border:1px solid rgba(255,209,102,.22);border-radius:8px;background:rgba(255,209,102,.06);font-size:10px;color:var(--muted)}.quaver-capabilities{margin:10px 0;padding:8px 10px;border:1px solid var(--line);border-radius:9px}.quaver-capabilities>div{display:flex;gap:8px;padding-top:6px;font-size:10px}.quaver-capabilities b{min-width:92px}.quaver-capabilities span{color:var(--muted)}.quaver-unsupported-list{margin:10px 0;color:var(--muted);font-size:11px}.quaver-unsupported{display:flex;flex-direction:column;padding:7px 0;border-bottom:1px solid var(--line)}.quaver-unsupported span{font-size:10px}.quaver-imported-list{display:grid;gap:7px;margin:14px 0}.quaver-imported-list article{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:10px}.quaver-imported-list article span{display:block;margin-top:3px;color:var(--muted);font-size:10px}.quaver-source-pill{color:#80efb0;border-color:rgba(114,237,168,.3)}
      @media(max-width:900px){.quaver-import-grid{grid-template-columns:1fr}.quaver-select-toolbar{align-items:flex-start;flex-direction:column}.quaver-imported-list article{align-items:flex-start;flex-direction:column}.quaver-capabilities>div{flex-direction:column;gap:2px}}
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

  window.rilQuaverImport = { selectSource, cancelUpload };
  boot();
})();
