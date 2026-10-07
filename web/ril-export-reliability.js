"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  let latestExport = null;
  let allowManualDownload = false;

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes || 0));
    if (value < 1024) return `${Math.round(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderSaved(result) {
    if (!result) return;
    const summary = q("#rilExportSummary");
    if (summary) {
      summary.innerHTML = `
        <b>Saved · ${formatBytes(result.size_bytes)}</b>
        <div class="list-sub">${esc(result.saved_path || result.filename)}</div>
        <div class="actions ril-export-saved-actions">
          <button id="rilOpenExportsFolder" class="button small primary">Open exports folder</button>
          <button id="rilDownloadExportCopy" class="button small">Download another copy</button>
        </div>`;
      q("#rilOpenExportsFolder", summary)?.addEventListener("click", async () => {
        try {
          await window.api("/api/ril/export/open-folder", { method: "POST", body: {} });
        } catch (error) {
          window.toast?.(`Could not open exports folder: ${error.message}`, "error", 7000);
        }
      });
      q("#rilDownloadExportCopy", summary)?.addEventListener("click", () => {
        if (!result.download_url) return;
        allowManualDownload = true;
        const anchor = document.createElement("a");
        anchor.href = result.download_url;
        anchor.download = result.filename || "song.ril";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      });
    }
    const button = q("#rilExportCreate");
    if (button) {
      button.disabled = false;
      button.textContent = "Export another copy";
    }
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || "";
    const response = await originalFetch(input, init);
    if (/\/api\/ril\/export(?:\?|$)/.test(url) && String(init.method || "GET").toUpperCase() === "POST") {
      try {
        const payload = await response.clone().json();
        if (payload?.ok !== false && payload?.data?.saved_path) latestExport = payload.data;
      } catch (_) {}
    }
    return response;
  };

  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a");
    if (!anchor || !/\/api\/ril\/export\/file(?:\?|$)/.test(anchor.getAttribute("href") || "")) return;
    if (allowManualDownload) {
      allowManualDownload = false;
      return;
    }
    if (!latestExport) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setTimeout(() => renderSaved(latestExport), 0);
  }, true);

  const observer = new MutationObserver(() => {
    if (!q("#rilExportModal")?.classList.contains("open")) return;
    if (q("#rilExportReliabilityNote")) return;
    const summary = q("#rilExportSummary");
    if (!summary) return;
    const note = document.createElement("div");
    note.id = "rilExportReliabilityNote";
    note.className = "list-sub ril-export-folder-note";
    note.textContent = "Exports are saved permanently in the RIL Exports folder. The browser will not download a duplicate unless you ask for one.";
    summary.before(note);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

  const style = document.createElement("style");
  style.id = "rilExportReliabilityStyles";
  style.textContent = `
    .ril-export-folder-note{margin-top:10px;padding:8px 10px;border-left:2px solid var(--accent);background:rgba(255,255,255,.012)}.ril-export-saved-actions{margin-top:9px;justify-content:flex-start}`;
  document.head.appendChild(style);
  window.rilExportReliability = { renderSaved };
})();
