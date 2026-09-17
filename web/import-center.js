"use strict";

(() => {
  const STORAGE_KEY = "ril-import-format:v1";
  const FNF_MODE_KEY = "ril-fnf-import-mode:v1";
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const formats = ["fnf", "osu", "quaver", "ril"];
  let active = formats.includes(localStorage.getItem(STORAGE_KEY)) ? localStorage.getItem(STORAGE_KEY) : "fnf";
  let fnfMode = ["folder", "single"].includes(localStorage.getItem(FNF_MODE_KEY)) ? localStorage.getItem(FNF_MODE_KEY) : "folder";
  let installed = false;

  function setActive(format) {
    active = formats.includes(format) ? format : "fnf";
    localStorage.setItem(STORAGE_KEY, active);
    qa("[data-import-tab]").forEach(button => button.classList.toggle("primary", button.dataset.importTab === active));
    qa("[data-import-format]").forEach(panel => panel.classList.toggle("import-format-hidden", panel.dataset.importFormat !== active));
    if (active === "fnf") setFNFMode(fnfMode);
  }

  function setFNFMode(mode) {
    fnfMode = mode === "single" ? "single" : "folder";
    localStorage.setItem(FNF_MODE_KEY, fnfMode);
    qa("[data-fnf-mode-tab]").forEach(button => button.classList.toggle("primary", button.dataset.fnfModeTab === fnfMode));
    qa("[data-fnf-mode]").forEach(panel => panel.classList.toggle("fnf-mode-hidden", panel.dataset.fnfMode !== fnfMode));
  }

  function detectedName(documentValue, filename) {
    const song = documentValue?.song && typeof documentValue.song === "object" ? documentValue.song : documentValue;
    return String(song?.song || song?.title || filename.replace(/\.json$/i, "") || "").trim();
  }

  function installFNFReset() {
    const chartInput = q("#chartFile");
    if (!chartInput || chartInput.dataset.importNameFix === "1") return;
    chartInput.dataset.importNameFix = "1";
    chartInput.addEventListener("change", async event => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const name = detectedName(parsed, file.name);
        const field = q("#importSongName");
        if (field) field.value = name;
      } catch (_) {}
    });

    const preview = q("#importPreview");
    if (!preview) return;
    const observer = new MutationObserver(() => {
      if (!/import complete/i.test(preview.textContent || "")) return;
      const songName = q("#importSongName");
      const keyMode = q("#importKeyMode");
      const eventsInput = q("#eventsFile");
      chartInput.value = "";
      if (eventsInput) eventsInput.value = "";
      if (songName) songName.value = "";
      if (keyMode) keyMode.value = "";
    });
    observer.observe(preview, { childList: true, subtree: true, characterData: true });
  }

  function buildFNFPanel(legacy) {
    const panel = document.createElement("section");
    panel.id = "fnfImportPanel";
    panel.className = "import-center-panel fnf-import-panel";
    panel.dataset.importFormat = "fnf";
    panel.innerHTML = `
      <div class="card pad" style="margin-bottom:10px">
        <div class="section-title" style="padding:0">
          <div><div class="eyebrow">Friday Night Funkin' adapter</div><h2>Import FNF</h2><p>Use folder import for mods and song collections. Single JSON remains available for one-off legacy, Psych, or Codename charts.</p></div>
          <div class="fnf-adapter-modes" role="tablist"><button class="button small" data-fnf-mode-tab="folder">Folder</button><button class="button small" data-fnf-mode-tab="single">Single JSON</button></div>
        </div>
      </div>
      <div id="fnfFolderImportMount" data-fnf-mode="folder"><div class="card empty">Loading FNF folder importer…</div></div>
      <div id="fnfSingleImportMount" data-fnf-mode="single"></div>`;
    q("#fnfSingleImportMount", panel).appendChild(legacy);
    legacy.classList.add("fnf-single-import-grid");
    qa("[data-fnf-mode-tab]", panel).forEach(button => button.addEventListener("click", () => setFNFMode(button.dataset.fnfModeTab)));
    return panel;
  }

  function install() {
    if (installed) return true;
    const view = q("#view-import");
    const ril = q("#rilImportPanel");
    const osu = q("#osuImportPanel");
    const quaver = q("#quaverImportPanel");
    const legacy = q("#view-import > .grid.two");
    if (!view || !ril || !osu || !quaver || !legacy) return false;

    const center = document.createElement("section");
    center.id = "importCenter";
    center.className = "import-center";
    center.innerHTML = `
      <div class="card pad import-center-header">
        <div><div class="eyebrow">Format adapters</div><h2>Import into your library</h2><p>Choose one source format. Only that workflow stays visible while its preview and compatibility information remain intact.</p></div>
        <div class="actions import-center-tabs" role="tablist">
          <button class="button small" data-import-tab="fnf">FNF</button>
          <button class="button small" data-import-tab="osu">osu!mania</button>
          <button class="button small" data-import-tab="quaver">Quaver</button>
          <button class="button small" data-import-tab="ril">Portable .ril</button>
        </div>
      </div>
      <div id="importCenterStack"></div>`;

    const head = q("#view-import .page-head");
    (head || view.firstChild).after(center);
    const stack = q("#importCenterStack", center);
    const fnf = buildFNFPanel(legacy);
    const panels = [["fnf", fnf], ["osu", osu], ["quaver", quaver], ["ril", ril]];
    for (const [format, panel] of panels) {
      panel.dataset.importFormat = format;
      panel.classList.add("import-center-panel");
      stack.appendChild(panel);
    }
    qa("[data-import-tab]", center).forEach(button => button.addEventListener("click", () => setActive(button.dataset.importTab)));

    if (head) {
      const eyebrow = q(".eyebrow", head);
      const title = q("h1", head);
      const description = q("p", head);
      if (eyebrow) eyebrow.textContent = "Universal import workspace";
      if (title) title.textContent = "Import";
      if (description) description.textContent = "FNF, osu!mania, Quaver, and portable RIL enter the same neutral local library without sharing one giant form.";
    }

    installed = true;
    setActive(active);
    setFNFMode(fnfMode);
    installFNFReset();
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 80);
  setTimeout(install, 0);
  window.rilImportCenter = { setActive, setFNFMode, get active() { return active; }, get fnfMode() { return fnfMode; } };
})();
