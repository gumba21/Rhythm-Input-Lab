"use strict";

(() => {
  let installed = false;

  function install() {
    if (installed) return true;
    const library = document.querySelector("#practiceComfort");
    const actions = document.querySelector("#view-practice .practice-head-actions");
    if (!library || !actions) return false;
    installed = true;

    const openButton = document.createElement("button");
    openButton.id = "practiceLibraryButton";
    openButton.className = "button small";
    openButton.textContent = "Practice library";
    openButton.title = "Open saved setups, collections, goals, and history";
    actions.appendChild(openButton);

    const modal = document.createElement("div");
    modal.id = "practiceLibraryModal";
    modal.className = "practice-library-modal";
    modal.innerHTML = `
      <div class="practice-library-dialog">
        <div class="practice-library-toolbar">
          <div class="practice-library-tabs" role="tablist">
            <button class="button small primary" data-library-tab="overview">Overview</button>
            <button class="button small" data-library-tab="setups">Setups & collections</button>
            <button class="button small" data-library-tab="history">History</button>
          </div>
          <button id="practiceLibraryClose" class="icon-button" title="Close Practice library">×</button>
        </div>
        <div id="practiceLibraryBody" class="practice-library-body"></div>
      </div>`;
    document.body.appendChild(modal);
    document.querySelector("#practiceLibraryBody").appendChild(library);

    library.classList.add("practice-library-contained");
    const panels = [...library.querySelectorAll(".comfort-panel")];
    for (const panel of panels) {
      const title = panel.querySelector("h3")?.textContent?.toLowerCase() || "";
      panel.dataset.libraryGroup = title.includes("attempt history") ? "history"
        : title.includes("saved practice") || title.includes("collections") ? "setups"
        : "overview";
    }

    function selectTab(name) {
      library.dataset.activeLibraryTab = name;
      panels.forEach(panel => { panel.hidden = panel.dataset.libraryGroup !== name; });
      modal.querySelectorAll("[data-library-tab]").forEach(button => button.classList.toggle("primary", button.dataset.libraryTab === name));
    }

    function open() {
      modal.classList.add("open");
      document.body.classList.add("practice-library-open");
      selectTab(library.dataset.activeLibraryTab || "overview");
      requestAnimationFrame(() => document.querySelector("#practiceLibraryClose")?.focus());
    }

    function close() {
      modal.classList.remove("open");
      document.body.classList.remove("practice-library-open");
      openButton.focus();
    }

    openButton.addEventListener("click", open);
    document.querySelector("#practiceLibraryClose").addEventListener("click", close);
    modal.addEventListener("pointerdown", event => { if (event.target === modal) close(); });
    modal.querySelectorAll("[data-library-tab]").forEach(button => button.addEventListener("click", () => selectTab(button.dataset.libraryTab)));
    document.addEventListener("keydown", event => { if (event.key === "Escape" && modal.classList.contains("open")) close(); });

    const style = document.createElement("style");
    style.id = "practiceLibraryMenuStyles";
    style.textContent = `
      .practice-library-modal{position:fixed;inset:0;z-index:1100;display:none;place-items:center;padding:22px;background:rgba(0,0,0,.74);backdrop-filter:blur(8px)}
      .practice-library-modal.open{display:grid}.practice-library-dialog{display:flex;flex-direction:column;width:min(1050px,96vw);height:min(850px,92vh);overflow:hidden;border:1px solid var(--line);border-radius:16px;background:var(--panel,#0b0e14);box-shadow:0 25px 90px rgba(0,0,0,.55)}
      .practice-library-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.025)}
      .practice-library-tabs{display:flex;gap:7px;flex-wrap:wrap}.practice-library-body{min-height:0;overflow:auto;padding:14px}.practice-library-contained{margin:0!important;border:0!important;background:transparent!important;box-shadow:none!important}
      .practice-library-contained .practice-comfort-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.practice-library-contained .comfort-panel[hidden]{display:none!important}
      body.practice-library-open{overflow:hidden}
      @media(max-width:720px){.practice-library-modal{padding:8px}.practice-library-dialog{width:100%;height:96vh}.practice-library-contained .practice-comfort-grid{grid-template-columns:1fr}.practice-library-contained .comfort-panel-wide{grid-column:auto}}
    `;
    document.head.appendChild(style);
    selectTab("overview");
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
})();
