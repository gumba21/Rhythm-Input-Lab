"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  let folder = null;
  let activeJob = null;
  let pollTimer = null;
  let pollInFlight = false;
  let boundButton = null;

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

  function currentFolder() {
    if (folder && (window.state?.songs || []).some(row => row.folder === folder)) return folder;
    const modalTitle = q("#modalSongTitle")?.textContent?.trim();
    const exportTitle = q("#rilExportTitle")?.textContent?.replace(/^Export\s+/i, "")?.trim();
    return (window.state?.songs || []).find(row => row.song_name === modalTitle || row.song_name === exportTitle)?.folder || null;
  }

  function exportPayload() {
    const selectedFolder = currentFolder();
    if (!selectedFolder) throw new Error("The selected song could not be resolved.");
    let mappings = null;
    try { mappings = JSON.parse(localStorage.getItem(`ril-song-mappings:${selectedFolder}`) || "null"); }
    catch (_) {}
    return {
      folder: selectedFolder,
      username: String(q("#rilExportUsername")?.value || "").trim(),
      include_instrumental: Boolean(q("#rilExportInstrumental")?.checked),
      include_vocals: Boolean(q("#rilExportVocals")?.checked),
      include_original: Boolean(q("#rilExportOriginal")?.checked),
      mappings,
      discord_limit: (localStorage.getItem("ril-export-target:v1") || "discord") !== "full",
    };
  }

  function renderProgress(job) {
    const root = q("#rilExportSummary");
    if (!root) return;
    const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
    const bytes = Number(job.bytes_total || 0)
      ? `${formatBytes(job.bytes_written)} of ${formatBytes(job.bytes_total)}`
      : "Preparing local files";
    root.innerHTML = `
      <div class="ril-job-head"><b>${esc(job.stage || "Exporting")}</b><span>${Math.round(progress)}%</span></div>
      <div class="ril-job-progress"><i style="width:${progress}%"></i></div>
      <div class="list-sub">${job.current_file ? `${esc(job.current_file)} · ` : ""}${bytes}</div>
      <div class="actions ril-job-actions"><button id="rilCancelExportJob" class="button small danger">Cancel export</button></div>`;
    q("#rilCancelExportJob", root)?.addEventListener("click", cancelExport);
  }

  function resetButton(label = "Export .ril") {
    const button = q("#rilExportCreate");
    if (!button) return;
    button.disabled = false;
    button.textContent = label;
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    pollInFlight = false;
  }

  async function pollJob() {
    if (!activeJob || pollInFlight) return;
    pollInFlight = true;
    try {
      const job = await window.api(`/api/ril/export/status?job=${encodeURIComponent(activeJob)}`);
      if (job.status === "completed") {
        stopPolling();
        activeJob = null;
        window.rilExportReliability?.renderSaved?.(job.result);
        window.toast?.(`${job.result.filename} saved in RIL Exports.`);
        return;
      }
      if (job.status === "error") {
        stopPolling();
        activeJob = null;
        resetButton();
        const root = q("#rilExportSummary");
        if (root) root.innerHTML = `<div class="ril-job-error"><b>Export failed</b><div class="list-sub">${esc(job.error || "Unknown export error")}</div></div>`;
        window.toast?.(`RIL export failed: ${job.error || "unknown error"}`, "error", 9000);
        return;
      }
      if (job.status === "cancelled") {
        stopPolling();
        activeJob = null;
        resetButton();
        const root = q("#rilExportSummary");
        if (root) root.innerHTML = `<b>Export cancelled.</b><div class="list-sub">No partial .ril file was kept.</div>`;
        return;
      }
      renderProgress(job);
      pollInFlight = false;
      pollTimer = setTimeout(pollJob, 250);
    } catch (error) {
      stopPolling();
      activeJob = null;
      resetButton();
      window.toast?.(`Could not read export progress: ${error.message}`, "error", 8000);
    }
  }

  async function startExport(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    if (activeJob) return;
    const button = q("#rilExportCreate");
    if (button) {
      button.disabled = true;
      button.textContent = "Starting export…";
    }
    try {
      const job = await window.api("/api/ril/export/start", {
        method: "POST",
        body: exportPayload(),
      });
      activeJob = job.job_id;
      renderProgress(job);
      pollJob();
    } catch (error) {
      resetButton();
      window.toast?.(`RIL export failed to start: ${error.message}`, "error", 8000);
    }
  }

  async function cancelExport() {
    if (!activeJob) return;
    const button = q("#rilCancelExportJob");
    if (button) {
      button.disabled = true;
      button.textContent = "Cancelling…";
    }
    try {
      await window.api("/api/ril/export/cancel", {
        method: "POST",
        body: { job_id: activeJob },
      });
    } catch (error) {
      window.toast?.(`Could not cancel export: ${error.message}`, "error", 7000);
    }
  }

  function bindExportButton() {
    const button = q("#rilExportCreate");
    if (!button) return false;
    if (button.dataset.rilExportJobOwner === "1") {
      boundButton = button;
      return true;
    }

    // ril-packages.js installs the original synchronous exporter directly on
    // this button. Cloning is deliberate: it removes every listener previously
    // attached to the node, so the old blocking POST cannot run alongside the
    // background-job exporter.
    const replacement = button.cloneNode(true);
    replacement.dataset.rilExportJobOwner = "1";
    button.replaceWith(replacement);
    replacement.addEventListener("click", startExport);
    boundButton = replacement;
    return true;
  }

  document.addEventListener("click", event => {
    if (!event.target.closest?.("#modalExportRil")) return;
    const title = q("#modalSongTitle")?.textContent?.trim();
    folder = (window.state?.songs || []).find(row => row.song_name === title)?.folder || null;
    setTimeout(bindExportButton, 0);
  }, true);

  const observer = new MutationObserver(bindExportButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const style = document.createElement("style");
  style.id = "rilExportJobStyles";
  style.textContent = `
    .ril-job-head{display:flex;justify-content:space-between;gap:12px}.ril-job-progress{height:9px;margin:9px 0 7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.06)}.ril-job-progress i{display:block;height:100%;background:var(--accent);transition:width .18s linear}.ril-job-actions{justify-content:flex-start;margin-top:9px}.ril-job-error{padding:9px 10px;border-left:2px solid var(--bad);background:rgba(255,107,138,.06)}`;
  document.head.appendChild(style);
  setTimeout(bindExportButton, 0);
  window.rilExportJobs = { startExport, cancelExport, pollJob, bindExportButton };
})();
