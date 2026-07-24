"use strict";

(() => {
  const CHUNK_SIZE = 768 * 1024;
  const runtime = { active: false, uploading: false, sources: [] };
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function formatBytes(bytes) {
    let value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return `${Math.round(value)} B`;
    const units = ["KB", "MB", "GB"];
    value /= 1024;
    let unit = units[0];
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

  function quaverFiles(fileList) {
    return [...(fileList || [])].filter(file => /\.(qua|qp)$/i.test(file.name));
  }

  function base64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
    }
    return btoa(binary);
  }

  async function cancelSource(source) {
    if (!source?.uploadId || source.committed) return;
    try {
      await window.api("/api/quaver/import/cancel", {
        method: "POST",
        body: { upload_id: source.uploadId },
      });
    } catch (_) {}
  }

  async function cancelBatch() {
    const sources = [...runtime.sources];
    runtime.active = false;
    runtime.uploading = false;
    runtime.sources = [];
    await Promise.all(sources.map(cancelSource));
  }

  function renderProgress(activeIndex = 0, filePercent = 0) {
    const root = q("#quaverImportPreview");
    if (!root) return;
    const completed = runtime.sources.filter(source => source.preview || source.error).length;
    const overall = runtime.sources.length
      ? Math.round(((completed + Math.max(0, Math.min(1, filePercent / 100))) / runtime.sources.length) * 100)
      : 0;
    const current = runtime.sources[activeIndex];
    root.className = "quaver-preview";
    root.innerHTML = `
      <div class="quaver-progress-head"><b>Reading ${runtime.sources.length} Quaver source${runtime.sources.length === 1 ? "" : "s"}…</b><span>${Math.min(100, overall)}%</span></div>
      <div class="quaver-progress"><i style="width:${Math.min(100, overall)}%"></i></div>
      <div class="list-sub">${current ? `${esc(current.file.name)} · ${Math.round(filePercent)}%` : "Preparing files"}</div>`;
  }

  async function uploadSource(source, sourceIndex) {
    const file = source.file;
    const total = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    let result = null;
    for (let index = 0; index < total; index++) {
      if (!runtime.active) throw new Error("Batch import cancelled");
      const start = index * CHUNK_SIZE;
      result = await window.api("/api/quaver/import/chunk", {
        method: "POST",
        body: {
          upload_id: source.uploadId,
          filename: file.name,
          index,
          total,
          data: base64(await file.slice(start, Math.min(file.size, start + CHUNK_SIZE)).arrayBuffer()),
        },
      });
      renderProgress(sourceIndex, (index + 1) / total * 100);
    }
    if (!result?.complete || !result.preview) throw new Error("Upload finished without a Quaver preview");
    source.preview = result.preview;
  }

  async function startBatch(files) {
    if (runtime.uploading) return;
    await window.rilQuaverImport?.cancelUpload?.();
    await cancelBatch();
    runtime.active = true;
    runtime.uploading = true;
    runtime.sources = files.map((file, index) => ({
      file,
      uploadId: `quaver-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 9)}`,
      preview: null,
      error: "",
      committed: false,
    }));
    q("#quaverFileName").textContent = `${files.length} files · ${formatBytes(files.reduce((sum, file) => sum + file.size, 0))}`;
    renderProgress();
    for (let index = 0; index < runtime.sources.length; index++) {
      const source = runtime.sources[index];
      try {
        await uploadSource(source, index);
      } catch (error) {
        source.error = error.message;
        await cancelSource(source);
      }
    }
    runtime.uploading = false;
    if (runtime.active) renderBatchPreview();
  }

  function difficultyCard(row, sourceIndex, difficultyIndex) {
    const warnings = (row.warnings || []).map(message => `<div class="quaver-diff-warning">${esc(message)}</div>`).join("");
    return `<label class="quaver-difficulty-card">
      <input class="quaver-batch-check" type="checkbox" data-source-index="${sourceIndex}" value="${esc(row.id)}" checked>
      <div class="quaver-difficulty-main">
        <div class="quaver-difficulty-head"><div><b>${esc(row.difficulty || `Difficulty ${difficultyIndex + 1}`)}</b><span>${esc(row.creator ? `mapped by ${row.creator}` : "unknown mapper")}</span></div><span class="pill">${row.key_count}K</span></div>
        <div class="quaver-difficulty-meta"><span>${Number(row.notes || 0).toLocaleString()} objects</span><span>${Number(row.holds || 0).toLocaleString()} holds</span><span>${Number(row.mines || 0).toLocaleString()} mines</span><span>${formatDuration(row.duration_ms)}</span><span>${esc(bpmText(row))}</span><span>${Number(row.active_actions_per_second || 0).toFixed(2)} active APS</span></div>
        <div class="pill-row"><span class="pill good">Chart</span><span class="pill ${row.has_audio ? "good" : ""}">${row.has_audio ? "✓" : "—"} Audio</span><span class="pill">${Number(row.sv_count || 0)} SV</span><span class="pill">${Number(row.ssf_count || 0)} SSF</span></div>
        ${warnings}
      </div>
    </label>`;
  }

  function sourceBlock(source, sourceIndex) {
    if (source.error) {
      return `<section class="quaver-batch-source error"><div class="quaver-batch-source-head"><div><b>${esc(source.file.name)}</b><span>Could not be opened</span></div><span class="pill warn">Failed</span></div><div class="quaver-warning">${esc(source.error)}</div></section>`;
    }
    const preview = source.preview || {};
    const rows = preview.difficulties || [];
    const unsupported = preview.unsupported || [];
    return `<section class="quaver-batch-source">
      <div class="quaver-batch-source-head"><div><b>${esc(source.file.name)}</b><span>${rows.length} supported difficult${rows.length === 1 ? "y" : "ies"}${unsupported.length ? ` · ${unsupported.length} skipped` : ""}</span></div><span class="pill good">${preview.kind === "qp" ? ".qp mapset" : ".qua chart"}</span></div>
      <div class="quaver-difficulty-list">${rows.map((row, difficultyIndex) => difficultyCard(row, sourceIndex, difficultyIndex)).join("")}</div>
      ${unsupported.length ? `<details class="quaver-unsupported-list"><summary>${unsupported.length} unsupported chart${unsupported.length === 1 ? "" : "s"}</summary>${unsupported.slice(0, 10).map(row => `<div class="quaver-unsupported"><b>${esc(row.entry_name)}</b><span>${esc(row.error)}</span></div>`).join("")}</details>` : ""}
    </section>`;
  }

  function selectedForSource(sourceIndex) {
    return qa(`.quaver-batch-check[data-source-index="${sourceIndex}"]:checked`, q("#quaverImportPreview")).map(input => input.value);
  }

  function updateSelection() {
    const root = q("#quaverImportPreview");
    if (!root) return;
    const selected = qa(".quaver-batch-check:checked", root);
    const all = qa(".quaver-batch-check", root);
    const summary = q("#quaverBatchSelection", root);
    if (summary) summary.textContent = `${selected.length} of ${all.length} difficulties selected across ${runtime.sources.length} source files.`;
    const button = q("#quaverBatchCommit", root);
    if (button) button.disabled = selected.length === 0;
  }

  function renderBatchPreview() {
    const root = q("#quaverImportPreview");
    if (!root) return;
    const supported = runtime.sources.reduce((sum, source) => sum + (source.preview?.difficulties?.length || 0), 0);
    const failed = runtime.sources.filter(source => source.error).length;
    root.className = "quaver-preview quaver-batch-preview";
    root.innerHTML = `
      <div class="quaver-preview-title"><div><div class="eyebrow">Multi-file Quaver import</div><h2>${supported} supported difficult${supported === 1 ? "y" : "ies"}</h2><p>${runtime.sources.length} source files${failed ? ` · ${failed} failed to parse` : ""}</p></div><span class="pill good">Batch ready</span></div>
      <div class="quaver-select-toolbar"><div><button id="quaverBatchAll" class="button small">Select all</button><button id="quaverBatchNone" class="button small">Select none</button></div><label>Existing names<select id="quaverBatchMode"><option value="separate">Import as separate copies</option><option value="replace">Replace matching charts</option></select></label></div>
      <div class="quaver-batch-list">${runtime.sources.map(sourceBlock).join("")}</div>
      <div id="quaverBatchSelection" class="comfort-summary"></div>
      <div class="actions"><button id="quaverBatchCommit" class="button primary">Import selected difficulties</button><button id="quaverBatchCancel" class="button">Cancel batch</button></div>`;
    q("#quaverBatchAll", root).addEventListener("click", () => { qa(".quaver-batch-check", root).forEach(input => { input.checked = true; }); updateSelection(); });
    q("#quaverBatchNone", root).addEventListener("click", () => { qa(".quaver-batch-check", root).forEach(input => { input.checked = false; }); updateSelection(); });
    qa(".quaver-batch-check", root).forEach(input => input.addEventListener("change", updateSelection));
    q("#quaverBatchCommit", root).addEventListener("click", commitBatch);
    q("#quaverBatchCancel", root).addEventListener("click", resetBatch);
    updateSelection();
  }

  async function commitBatch() {
    const root = q("#quaverImportPreview");
    const button = q("#quaverBatchCommit", root);
    if (!button) return;
    button.disabled = true;
    const mode = q("#quaverBatchMode", root)?.value || "separate";
    const imported = [];
    const failures = [];
    for (let index = 0; index < runtime.sources.length; index++) {
      const source = runtime.sources[index];
      if (source.error || !source.preview) continue;
      const ids = selectedForSource(index);
      if (!ids.length) {
        await cancelSource(source);
        continue;
      }
      button.textContent = `Importing ${index + 1} of ${runtime.sources.length}…`;
      try {
        const result = await window.api("/api/quaver/import/commit", {
          method: "POST",
          body: { upload_id: source.uploadId, difficulty_ids: ids, mode },
        });
        source.committed = true;
        imported.push(...(result.imported || []));
      } catch (error) {
        failures.push({ filename: source.file.name, error: error.message });
      }
    }
    runtime.active = false;
    runtime.uploading = false;
    window.rilSharedResults?.clear?.();
    await window.refreshDashboard?.();
    renderBatchSuccess(imported, failures);
  }

  function openPractice(folder) {
    window.go?.("practice");
    const select = q("#practiceSongSelect");
    if (!select) return;
    select.value = folder;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderBatchSuccess(imported, failures) {
    const root = q("#quaverImportPreview");
    if (!root) return;
    root.className = "quaver-preview";
    root.innerHTML = `
      <div class="quaver-preview-title"><div><div class="eyebrow">Batch complete</div><h2>${imported.length} Quaver song${imported.length === 1 ? "" : "s"} ready</h2><p>${failures.length ? `${failures.length} source file${failures.length === 1 ? "" : "s"} failed during import.` : "Every selected difficulty was imported."}</p></div><span class="pill ${failures.length ? "warn" : "good"}">${failures.length ? "Partial" : "Done"}</span></div>
      <div class="quaver-imported-list">${imported.map(row => `<article><div><b>${esc(row.song.song_name)}</b><span>${row.summary.key_count}K · ${Number(row.summary.player_notes || 0).toLocaleString()} objects · ${Number(row.summary.mine_notes || 0).toLocaleString()} mines${row.audio_saved ? " · audio saved" : " · add audio manually"}</span></div><div class="actions"><button class="button small primary" data-quaver-batch-practice="${esc(row.song.folder)}">Practice</button><button class="button small" data-quaver-batch-viz="${esc(row.song.folder)}">Visualizer</button></div></article>`).join("")}</div>
      ${failures.map(row => `<div class="quaver-warning"><b>${esc(row.filename)}</b><br>${esc(row.error)}</div>`).join("")}
      <div class="actions"><button id="quaverBatchAnother" class="button">Import more Quaver files</button></div>`;
    qa("[data-quaver-batch-practice]", root).forEach(button => button.addEventListener("click", () => openPractice(button.dataset.quaverBatchPractice)));
    qa("[data-quaver-batch-viz]", root).forEach(button => button.addEventListener("click", () => window.loadVisualizer?.(button.dataset.quaverBatchViz, null)));
    q("#quaverBatchAnother", root).addEventListener("click", resetBatch);
    const input = q("#quaverSourceFile");
    if (input) input.value = "";
    q("#quaverFileName").textContent = "";
    window.toast?.(`${imported.length} Quaver song${imported.length === 1 ? "" : "s"} imported${failures.length ? `; ${failures.length} failed` : ""}.`, failures.length ? "error" : "info", 8000);
  }

  async function resetBatch() {
    await cancelBatch();
    const input = q("#quaverSourceFile");
    if (input) input.value = "";
    q("#quaverFileName").textContent = "";
    const root = q("#quaverImportPreview");
    if (root) {
      root.className = "quaver-preview empty";
      root.textContent = "Choose one or more Quaver charts or mapsets to inspect difficulties, mines, timing groups, scroll data, audio, and compatibility.";
    }
  }

  function install() {
    const input = q("#quaverSourceFile");
    const zone = q("#quaverDropzone");
    if (!input || !zone || input.dataset.multiQuaver === "1") return false;
    input.dataset.multiQuaver = "1";
    input.multiple = true;
    input.setAttribute("multiple", "");
    input.addEventListener("change", event => {
      const chosen = [...(event.currentTarget.files || [])];
      if (chosen.length <= 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const files = quaverFiles(chosen);
      if (!files.length) return window.toast?.("Choose .qua or .qp files.", "error");
      if (files.length === 1) return window.rilQuaverImport?.selectSource?.(files[0]);
      startBatch(files);
    }, true);
    zone.addEventListener("drop", event => {
      const dropped = [...(event.dataTransfer?.files || [])];
      if (dropped.length <= 1) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      zone.classList.remove("drag");
      const files = quaverFiles(dropped);
      if (!files.length) return window.toast?.("Drop one or more .qua or .qp files.", "error");
      if (files.length === 1) return window.rilQuaverImport?.selectSource?.(files[0]);
      startBatch(files);
    }, true);
    const heading = q("#quaverDropzone h3");
    if (heading) heading.textContent = "Drop one or more .qua / .qp files";
    const note = q("#quaverDropzone p");
    if (note) note.textContent = "Select several loose charts or mapsets and import them together.";
    const style = document.createElement("style");
    style.id = "quaverMultiImportStyles";
    style.textContent = `
      .quaver-batch-list{display:grid;gap:10px;max-height:560px;overflow:auto;padding-right:3px}.quaver-batch-source{padding:10px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.012)}.quaver-batch-source.error{border-color:rgba(255,107,138,.25)}.quaver-batch-source-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px}.quaver-batch-source-head b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.quaver-batch-source-head span:not(.pill){display:block;margin-top:2px;color:var(--muted);font-size:10px}.quaver-batch-source .quaver-difficulty-list{max-height:none;overflow:visible}.quaver-batch-preview{min-height:360px}`;
    document.head.appendChild(style);
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
  setTimeout(install, 0);
  window.rilQuaverMultiImport = { startBatch, cancelBatch, resetBatch };
})();
