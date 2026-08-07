"use strict";

(() => {
  const STORAGE_KEY = "ril-import-format:v1";
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  let active = localStorage.getItem(STORAGE_KEY) || "quaver";
  let installed = false;

  function setActive(format) {
    active = ["quaver", "osu", "ril", "fnf"].includes(format) ? format : "quaver";
    localStorage.setItem(STORAGE_KEY, active);
    qa("[data-import-tab]").forEach(button => button.classList.toggle("primary", button.dataset.importTab === active));
    qa("[data-import-format]").forEach(panel => panel.classList.toggle("import-format-hidden", panel.dataset.importFormat !== active));
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
      if (chartInput) chartInput.value = "";
      if (eventsInput) eventsInput.value = "";
      if (songName) songName.value = "";
      if (keyMode) keyMode.value = "";
    });
    observer.observe(preview, { childList: true, subtree: true, characterData: true });
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
        <div><div class="eyebrow">Local format adapters</div><h2>Choose an import type</h2><p>Only the selected importer stays expanded. Switching tabs does not discard an upload already being previewed.</p></div>
        <div class="actions import-center-tabs">
          <button class="button small" data-import-tab="quaver">Quaver</button>
          <button class="button small" data-import-tab="osu">osu!mania</button>
          <button class="button small" data-import-tab="ril">Portable .ril</button>
          <button class="button small" data-import-tab="fnf">FNF JSON</button>
        </div>
      </div>
      <div id="importCenterStack"></div>`;

    const head = q("#view-import .page-head");
    (head || view.firstChild).after(center);
    const stack = q("#importCenterStack", center);
    const panels = [
      ["quaver", quaver],
      ["osu", osu],
      ["ril", ril],
      ["fnf", legacy],
    ];
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
      if (eyebrow) eyebrow.textContent = "Universal import center";
      if (title) title.textContent = "Import songs.";
      if (description) description.textContent = "Quaver, osu!mania, portable RIL, and FNF charts all enter the same neutral local library.";
    }

    const style = document.createElement("style");
    style.id = "importCenterStyles";
    style.textContent = `
      .import-center{display:grid;gap:12px}.import-center-header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px}.import-center-header h2{margin:3px 0 4px}.import-center-header p{margin:0;color:var(--muted);font-size:12px}.import-center-tabs{flex-wrap:wrap;justify-content:flex-end}.import-center-panel{margin:0!important}.import-format-hidden{display:none!important}#importCenterStack>.card,#importCenterStack>.grid{animation:importCenterIn .14s ease-out}.import-center .ril-dropzone,.import-center .osu-dropzone,.import-center .quaver-dropzone{min-height:185px}.import-center .ril-preview,.import-center .osu-preview,.import-center .quaver-preview{min-height:185px}.import-center #chartDropzone{min-height:185px}.import-center #eventsDropzone{min-height:95px!important}@keyframes importCenterIn{from{opacity:.45;transform:translateY(3px)}to{opacity:1;transform:none}}@media(max-width:850px){.import-center-header{align-items:flex-start;flex-direction:column}.import-center-tabs{justify-content:flex-start}}`;
    document.head.appendChild(style);
    installed = true;
    setActive(active);
    installFNFReset();
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
  setTimeout(install, 0);
  window.rilImportCenter = { setActive };
})();
