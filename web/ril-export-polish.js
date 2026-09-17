"use strict";

(() => {
  const LIMIT = 8000000;
  const STORAGE_KEY = "ril-export-target:v1";
  const runtime = { folder: null, target: localStorage.getItem(STORAGE_KEY) || "discord", nextDiscordExport: false };
  const q = (selector, root = document) => root.querySelector(selector);

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes || 0));
    if (value < 1000) return `${Math.round(value)} B`;
    if (value < 1_000_000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)} KB`;
    return `${(value / 1_000_000).toFixed(2)} MB`;
  }

  function currentSong() {
    const rows = window.state?.songs || [];
    if (runtime.folder) {
      const exact = rows.find(row => row.folder === runtime.folder);
      if (exact) return exact;
    }
    const title = q("#modalSongTitle")?.textContent?.trim();
    return rows.find(row => row.song_name === title) || null;
  }

  function estimate() {
    const song = currentSong();
    const notes = Number(song?.chart?.player_notes || song?.chart?.total_notes || 0);
    const events = Number(song?.chart?.event_count || 0);
    let size = 180_000 + notes * 52 + events * 110;
    if (q("#rilExportInstrumental")?.checked) size += Number(song?.media?.instrumental?.size_bytes || 0);
    if (q("#rilExportVocals")?.checked) size += Number(song?.media?.vocals?.size_bytes || 0);
    if (q("#rilExportOriginal")?.checked) size += Math.max(350_000, notes * 80);
    return size;
  }

  function setTarget(value, autoFit = true) {
    runtime.target = value === "full" ? "full" : "discord";
    localStorage.setItem(STORAGE_KEY, runtime.target);
    q("#rilTargetFull")?.classList.toggle("primary", runtime.target === "full");
    q("#rilTargetDiscord")?.classList.toggle("primary", runtime.target === "discord");
    if (runtime.target === "discord" && autoFit) fitDiscordBudget();
    renderPlan();
  }

  function fitDiscordBudget() {
    const vocals = q("#rilExportVocals");
    const instrumental = q("#rilExportInstrumental");
    const original = q("#rilExportOriginal");
    if (original) original.checked = false;
    if (estimate() <= LIMIT) return;
    if (vocals?.checked) vocals.checked = false;
    if (estimate() <= LIMIT) return;
    if (instrumental?.checked) instrumental.checked = false;
  }

  function renderPlan() {
    const root = q("#rilExportTargetSummary");
    if (!root) return;
    const bytes = estimate();
    const ready = bytes <= LIMIT;
    const selected = [
      q("#rilExportInstrumental")?.checked ? "instrumental" : null,
      q("#rilExportVocals")?.checked ? "vocals" : null,
      q("#rilExportOriginal")?.checked ? "source JSON" : null,
    ].filter(Boolean);
    if (runtime.target === "full") {
      root.className = "ril-export-target-summary";
      root.innerHTML = `<b>Estimated ${formatBytes(bytes)}</b><span>Full package · chart and mappings plus ${selected.length ? selected.join(", ") : "no optional files"}.</span>`;
      return;
    }
    root.className = `ril-export-target-summary ${ready ? "ready" : "over"}`;
    root.innerHTML = ready
      ? `<b>Discord-ready · estimated ${formatBytes(bytes)}</b><span>${formatBytes(LIMIT - bytes)} of safety room remains. The backend enforces the exact 8,000,000-byte limit.</span>`
      : `<b>${formatBytes(bytes - LIMIT)} over Discord's 8 MB target</b><span>Remove another optional file before exporting.</span>`;
  }

  function install() {
    const dialog = q("#rilExportModal .ril-export-dialog");
    const options = q("#rilExportModal .ril-export-options");
    if (!dialog || !options || q("#rilExportTargetChooser")) return false;
    const chooser = document.createElement("div");
    chooser.id = "rilExportTargetChooser";
    chooser.className = "ril-export-target-chooser";
    chooser.innerHTML = `
      <div class="practice-inspector-heading"><div><div class="eyebrow">Export target</div><h3>Package size</h3></div><div class="actions"><button id="rilTargetDiscord" class="button small">Discord · 8 MB</button><button id="rilTargetFull" class="button small">Full package</button></div></div>
      <div id="rilExportTargetSummary" class="ril-export-target-summary"></div>`;
    options.before(chooser);
    q("#rilTargetDiscord")?.addEventListener("click", () => setTarget("discord"));
    q("#rilTargetFull")?.addEventListener("click", () => setTarget("full", false));
    ["#rilExportInstrumental", "#rilExportVocals", "#rilExportOriginal"].forEach(selector => q(selector)?.addEventListener("change", renderPlan));
    const style = document.createElement("style");
    style.id = "rilExportPolishStyles";
    style.textContent = `
      .ril-export-target-chooser{margin-top:14px;padding:12px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.018)}.ril-export-target-chooser h3{margin:3px 0 0}.ril-export-target-summary{display:flex;flex-direction:column;gap:3px;margin-top:9px;padding:9px 10px;border-left:2px solid var(--line);background:rgba(255,255,255,.012)}.ril-export-target-summary.ready{border-left-color:#69f0ae}.ril-export-target-summary.over{border-left-color:#ff6b8a}.ril-export-target-summary b{font-size:12px}.ril-export-target-summary span{font-size:10px;color:var(--muted)}
    `;
    document.head.appendChild(style);
    setTarget(runtime.target);
    return true;
  }

  document.addEventListener("click", event => {
    if (event.target.closest?.("#modalExportRil")) {
      const title = q("#modalSongTitle")?.textContent?.trim();
      runtime.folder = (window.state?.songs || []).find(row => row.song_name === title)?.folder || null;
      setTimeout(() => {
        install();
        setTarget(runtime.target);
      }, 0);
      return;
    }
    if (!event.target.closest?.("#rilExportCreate") || runtime.target !== "discord") return;
    renderPlan();
    if (estimate() > LIMIT) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.toast?.("This package is still over 8 MB. Remove another optional file.", "error", 6500);
      return;
    }
    runtime.nextDiscordExport = true;
  }, true);

  const originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || "";
    if (runtime.nextDiscordExport && /\/api\/ril\/export(?:\?|$)/.test(url) && String(init.method || "GET").toUpperCase() === "POST") {
      runtime.nextDiscordExport = false;
      try {
        const body = JSON.parse(init.body || "{}");
        init = { ...init, body: JSON.stringify({ ...body, discord_limit: true }) };
      } catch (_) {}
    }
    return originalFetch(input, init);
  };

  const observer = new MutationObserver(() => {
    if (q("#rilExportModal")?.classList.contains("open")) {
      install();
      renderPlan();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  setTimeout(install, 0);
  window.rilExportPolish = { LIMIT, estimate, fitDiscordBudget, setTarget };
})();
