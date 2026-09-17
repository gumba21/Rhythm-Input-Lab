"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  let activeJob = null;
  let pollTimer = null;
  let currentFolder = null;

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatDuration(ms) {
    const seconds = Math.max(0, Number(ms || 0)) / 1000;
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  }

  function ensureModal() {
    let modal = q("#rilExportV2Modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "rilExportV2Modal";
    modal.className = "modal-backdrop ril-export-backdrop";
    modal.innerHTML = `
      <div class="modal card ril-export-dialog">
        <div class="ril-export-head">
          <div><div class="eyebrow">Portable playable song</div><h2 id="rilExportV2Title">Export .ril</h2><p>Runs locally in the background and saves into RIL Exports.</p></div>
          <button id="rilExportV2Close" class="icon-button">×</button>
        </div>
        <div class="field" style="margin-top:16px"><label>Shared by username</label><input id="rilExportV2Username" maxlength="48" placeholder="gumba21"></div>
        <div class="ril-export-options">
          <label><input id="rilExportV2Instrumental" type="checkbox" checked> <span><b>Instrumental</b><small id="rilExportV2InstrumentalNote"></small></span></label>
          <label><input id="rilExportV2Vocals" type="checkbox" checked> <span><b>Vocals</b><small id="rilExportV2VocalsNote"></small></span></label>
          <label><input id="rilExportV2Original" type="checkbox"> <span><b>Original source JSON</b><small>Optional; the neutral chart is always included.</small></span></label>
        </div>
        <div id="rilExportV2Summary" class="comfort-summary"></div>
        <div class="actions" style="justify-content:flex-end"><button id="rilExportV2Cancel" class="button">Close</button><button id="rilExportV2Create" class="button primary">Export .ril</button></div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => {
      if (activeJob) return;
      modal.classList.remove("open");
    };
    q("#rilExportV2Close", modal).addEventListener("click", close);
    q("#rilExportV2Cancel", modal).addEventListener("click", close);
    modal.addEventListener("pointerdown", event => { if (event.target === modal) close(); });
    q("#rilExportV2Create", modal).addEventListener("click", startExport);
    return modal;
  }

  function open(folder) {
    const song = (window.state?.songs || []).find(row => row.folder === folder);
    if (!song?.has_chart) {
      window.toast?.("This song needs a chart before it can be exported.", "error");
      return;
    }
    currentFolder = folder;
    const modal = ensureModal();
    q("#rilExportV2Title", modal).textContent = `Export ${song.song_name}`;
    q("#rilExportV2Username", modal).value = String(window.state?.settings?.profile?.username || "");
    const instrumental = Boolean(song.media?.instrumental);
    const vocals = Boolean(song.media?.vocals);
    const instInput = q("#rilExportV2Instrumental", modal);
    const vocalsInput = q("#rilExportV2Vocals", modal);
    instInput.disabled = !instrumental;
    instInput.checked = instrumental;
    vocalsInput.disabled = !vocals;
    vocalsInput.checked = vocals;
    q("#rilExportV2InstrumentalNote", modal).textContent = instrumental ? song.media.instrumental.filename || "Saved audio" : "No saved instrumental";
    q("#rilExportV2VocalsNote", modal).textContent = vocals ? song.media.vocals.filename || "Saved audio" : "No saved vocals";
    q("#rilExportV2Summary", modal).textContent = `${song.chart?.key_count || "?"}K · ${formatDuration(song.chart?.duration_ms)} · attempts and personal statistics are not included.`;
    const button = q("#rilExportV2Create", modal);
    button.disabled = false;
    button.textContent = "Export .ril";
    q("#rilExportV2Cancel", modal).textContent = "Close";
    modal.classList.add("open");
  }

  function payload() {
    let mappings = null;
    try { mappings = JSON.parse(localStorage.getItem(`ril-song-mappings:${currentFolder}`) || "null"); } catch (_) {}
    return {
      folder: currentFolder,
      username: String(q("#rilExportV2Username")?.value || "").trim(),
      include_instrumental: Boolean(q("#rilExportV2Instrumental")?.checked),
      include_vocals: Boolean(q("#rilExportV2Vocals")?.checked),
      include_original: Boolean(q("#rilExportV2Original")?.checked),
      mappings,
      discord_limit: (localStorage.getItem("ril-export-target:v1") || "discord") !== "full",
    };
  }

  function renderProgress(job) {
    const root = q("#rilExportV2Summary");
    if (!root) return;
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    const bytes = Number(job.bytes_total || 0) ? `${formatBytes(job.bytes_written)} of ${formatBytes(job.bytes_total)}` : "Preparing local files";
    root.innerHTML = `<div class="ril-job-head"><b>${esc(job.stage || "Exporting")}</b><span>${Math.round(progress)}%</span></div><div class="ril-job-progress"><i style="width:${progress}%"></i></div><div class="list-sub">${job.current_file ? `${esc(job.current_file)} · ` : ""}${bytes}</div><div class="actions ril-job-actions"><button id="rilExportV2Stop" class="button small danger">Cancel export</button></div>`;
    q("#rilExportV2Stop", root)?.addEventListener("click", cancelExport);
  }

  async function startExport() {
    if (activeJob || !currentFolder) return;
    const button = q("#rilExportV2Create");
    button.disabled = true;
    button.textContent = "Starting export…";
    try {
      const job = await window.api("/api/ril/export/start", { method: "POST", body: payload() });
      activeJob = job.job_id;
      renderProgress(job);
      poll();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Export .ril";
      window.toast?.(`RIL export failed to start: ${error.message}`, "error", 8000);
    }
  }

  async function poll() {
    if (!activeJob) return;
    try {
      const job = await window.api(`/api/ril/export/status?job=${encodeURIComponent(activeJob)}`);
      if (job.status === "completed") {
        activeJob = null;
        const result = job.result;
        q("#rilExportV2Summary").innerHTML = `<b>Saved · ${formatBytes(result.size_bytes)}</b><div class="list-sub">${esc(result.saved_path || result.filename)}</div><div class="actions ril-job-actions"><button id="rilExportV2Folder" class="button small primary">Open exports folder</button><a class="button small" href="${esc(result.download_url)}" download="${esc(result.filename)}">Download another copy</a></div>`;
        q("#rilExportV2Folder")?.addEventListener("click", () => window.api("/api/ril/export/open-folder", { method: "POST", body: {} }).catch(error => window.toast?.(error.message, "error")));
        const button = q("#rilExportV2Create");
        button.disabled = false;
        button.textContent = "Export another copy";
        q("#rilExportV2Cancel").textContent = "Close";
        return;
      }
      if (job.status === "error" || job.status === "cancelled") {
        activeJob = null;
        q("#rilExportV2Summary").innerHTML = job.status === "cancelled" ? `<b>Export cancelled.</b><div class="list-sub">No partial package was kept.</div>` : `<div class="ril-job-error"><b>Export failed</b><div class="list-sub">${esc(job.error || "Unknown export error")}</div></div>`;
        const button = q("#rilExportV2Create");
        button.disabled = false;
        button.textContent = "Export .ril";
        q("#rilExportV2Cancel").textContent = "Close";
        return;
      }
      renderProgress(job);
      pollTimer = setTimeout(poll, 300);
    } catch (error) {
      activeJob = null;
      const button = q("#rilExportV2Create");
      button.disabled = false;
      button.textContent = "Export .ril";
      window.toast?.(`Could not read export progress: ${error.message}`, "error", 8000);
    }
  }

  async function cancelExport() {
    if (!activeJob) return;
    try {
      await window.api("/api/ril/export/cancel", { method: "POST", body: { job_id: activeJob } });
    } catch (error) {
      window.toast?.(`Could not cancel export: ${error.message}`, "error", 7000);
    }
  }

  document.addEventListener("click", event => {
    const trigger = event.target.closest?.("#modalExportRil");
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const title = q("#modalSongTitle")?.textContent?.trim();
    const folder = (window.state?.songs || []).find(row => row.song_name === title)?.folder;
    if (!folder) return window.toast?.("The selected song could not be resolved.", "error");
    open(folder);
  }, true);

  const style = document.createElement("style");
  style.textContent = `.ril-job-head{display:flex;justify-content:space-between;gap:12px}.ril-job-progress{height:9px;margin:9px 0 7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}.ril-job-progress i{display:block;height:100%;background:var(--accent);transition:width .18s linear}.ril-job-actions{justify-content:flex-start;margin-top:9px}.ril-job-error{padding:9px 10px;border-left:2px solid var(--bad);background:rgba(255,107,138,.06)}`;
  document.head.appendChild(style);
  window.rilExportV2 = { open, startExport, cancelExport };
})();
