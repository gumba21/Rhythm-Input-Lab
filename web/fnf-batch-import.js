"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const runtime = { groups: [], importing: false };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function api() {
    return window.rilFnfFolderDiscovery;
  }

  function setProgress(text) {
    const node = q("#fnfBatchProgress");
    if (node) node.textContent = text;
  }

  function selectedCharts() {
    return runtime.groups.flatMap(group => group.charts.filter(chart => chart.selected).map(chart => ({ group, chart })));
  }

  function renderPreview() {
    const root = q("#fnfBatchPreview");
    const button = q("#fnfBatchImportButton");
    if (!root || !button) return;
    const charts = runtime.groups.reduce((total, group) => total + group.charts.length, 0);
    const selected = selectedCharts().length;
    button.disabled = runtime.importing || selected === 0;
    q("#fnfBatchSummary").textContent = runtime.groups.length ? `${runtime.groups.length} songs · ${charts} charts · ${selected} selected` : "Choose a mod, songs, or assets folder.";
    if (!runtime.groups.length) {
      root.innerHTML = '<div class="empty">RIL will detect Codename, legacy, and Psych charts plus nearby audio.</div>';
      return;
    }
    root.innerHTML = runtime.groups.map((group, groupIndex) => {
      const inst = group.audio?.instrumental ? api().normalizedPath(group.audio.instrumental).split("/").pop() : "not found";
      const vocals = group.audio?.vocals || [];
      return `<article class="fnf-batch-group"><div class="fnf-batch-group-head"><div><b>${esc(group.songName)}</b><span>${esc(group.layout)}</span></div><div class="fnf-batch-media"><span>Inst: ${esc(inst)}</span><span>Vocals: ${vocals.length ? vocals.map(file => esc(file.name)).join(" + ") : "not found"}</span></div></div><div class="fnf-batch-charts">${group.charts.map((chart, chartIndex) => `<label class="fnf-batch-chart"><input type="checkbox" data-fnf-group="${groupIndex}" data-fnf-chart="${chartIndex}" ${chart.selected ? "checked" : ""}><span><b>${esc(chart.difficulty)}</b><small>${esc(chart.stats.format)} · ${chart.stats.notes.toLocaleString()} notes · ${chart.stats.events.toLocaleString()} events</small></span><input class="fnf-batch-name" data-fnf-name-group="${groupIndex}" data-fnf-name-chart="${chartIndex}" value="${esc(chart.importName)}" aria-label="Imported song name"></label>`).join("")}</div></article>`;
    }).join("");
    root.querySelectorAll("[data-fnf-group]").forEach(input => input.addEventListener("change", () => {
      runtime.groups[Number(input.dataset.fnfGroup)].charts[Number(input.dataset.fnfChart)].selected = input.checked;
      renderPreview();
    }));
    root.querySelectorAll("[data-fnf-name-group]").forEach(input => input.addEventListener("change", () => {
      runtime.groups[Number(input.dataset.fnfNameGroup)].charts[Number(input.dataset.fnfNameChart)].importName = input.value.trim() || "Untitled Song";
    }));
  }

  async function jsonApi(path, body) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.data;
  }

  function chunkBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Could not read file chunk"));
      reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
      reader.readAsDataURL(blob);
    });
  }

  async function uploadMedia(file, folders, role, stemId, primary, label) {
    if (!file || !folders.length) return;
    const chunkSize = 640 * 1024;
    const total = Math.max(1, Math.ceil(file.size / chunkSize));
    const uploadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    for (let index = 0; index < total; index += 1) {
      const chunk = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
      setProgress(`${label} · ${Math.round((index + 1) / total * 100)}%`);
      await jsonApi("/api/fnf-batch/media-chunk", {
        upload_id: uploadId,
        index,
        total,
        data: await chunkBase64(chunk),
        filename: file.name,
        folders,
        role,
        stem_id: stemId,
        primary,
      });
    }
  }

  async function importBatch() {
    const rows = selectedCharts();
    if (!rows.length || runtime.importing) return;
    runtime.importing = true;
    renderPreview();
    const foldersByGroup = new Map();
    let imported = 0;
    try {
      for (const { group, chart } of rows) {
        setProgress(`Importing ${imported + 1}/${rows.length}: ${chart.importName}`);
        const result = await jsonApi("/api/fnf-batch/import", { chart: {
          filename: chart.file.name,
          relative_path: chart.path,
          content: chart.content,
          import_name: chart.importName,
          song_name: group.songName,
          difficulty: chart.difficulty,
          group_key: group.groupKey,
          events_filename: group.events?.file.name,
          events_content: group.events?.content,
          metadata_filename: group.metadata?.file.name,
          metadata_content: group.metadata?.content,
        }});
        const folder = result?.song?.folder;
        if (folder) {
          if (!foldersByGroup.has(group.groupKey)) foldersByGroup.set(group.groupKey, []);
          foldersByGroup.get(group.groupKey).push(folder);
        }
        imported += 1;
      }

      let mediaIndex = 0;
      const mediaTotal = runtime.groups.reduce((total, group) => foldersByGroup.get(group.groupKey)?.length ? total + (group.audio?.instrumental ? 1 : 0) + (group.audio?.vocals?.length || 0) : total, 0);
      for (const group of runtime.groups) {
        const folders = foldersByGroup.get(group.groupKey) || [];
        if (!folders.length) continue;
        if (group.audio?.instrumental) {
          mediaIndex += 1;
          await uploadMedia(group.audio.instrumental, folders, "instrumental", "instrumental", false, `Audio ${mediaIndex}/${mediaTotal}: ${group.songName} instrumental`);
        }
        const vocals = group.audio?.vocals || [];
        for (let index = 0; index < vocals.length; index += 1) {
          mediaIndex += 1;
          const file = vocals[index];
          await uploadMedia(file, folders, "vocal", api().slug(api().pathStem(file.name)), index === 0, `Audio ${mediaIndex}/${mediaTotal}: ${group.songName} ${file.name}`);
        }
      }
      setProgress(`Imported ${imported} chart${imported === 1 ? "" : "s"}.`);
      window.toast?.(`FNF batch complete: ${imported} chart${imported === 1 ? "" : "s"} imported.`);
      if (typeof window.refreshDashboard === "function") await window.refreshDashboard();
      if (typeof window.go === "function") window.go("songs");
    } catch (error) {
      setProgress(`Stopped after ${imported}/${rows.length}: ${error.message}`);
      window.toast?.(`FNF batch import stopped: ${error.message}`, "error", 9000);
    } finally {
      runtime.importing = false;
      renderPreview();
    }
  }

  async function chooseFolder(event) {
    runtime.groups = [];
    renderPreview();
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    try {
      runtime.groups = await api().parseFolder(files, setProgress);
      setProgress(runtime.groups.length ? "Discovery complete. Review the charts and audio below." : "No supported FNF charts were found in that selection.");
      renderPreview();
    } catch (error) {
      setProgress(error.message);
      window.toast?.(`Could not scan FNF folder: ${error.message}`, "error", 8000);
    }
  }

  function enhanceSingleFilePreview() {
    const input = q("#chartFile");
    if (!input || input.dataset.fnfCompatPreview === "1") return;
    input.dataset.fnfCompatPreview = "1";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
        if (!api().isCodenameChart(parsed)) return;
        const stats = api().chartStats(parsed);
        setTimeout(() => {
          const preview = q("#importPreview");
          if (preview) preview.innerHTML = `<div class="stat-grid"><div class="stat-chip"><span>Detected format</span><b>Codename</b></div><div class="stat-chip"><span>Raw notes</span><b>${stats.notes.toLocaleString()}</b></div><div class="stat-chip"><span>Strum lines</span><b>${(parsed.strumLines || []).length}</b></div><div class="stat-chip"><span>Events</span><b>${stats.events.toLocaleString()}</b></div></div><div class="list-sub" style="margin-top:10px">For automatic song naming and audio discovery, use the batch folder importer below.</div>`;
        }, 0);
      } catch (_) {}
    });
  }

  function installUi() {
    const view = q("#view-import");
    if (!view || q("#fnfBatchImporter")) return false;
    const node = document.createElement("div");
    node.id = "fnfBatchImporter";
    node.className = "card pad fnf-batch-importer";
    node.innerHTML = `<div class="section-title fnf-batch-title"><div><div class="eyebrow">Folder-first FNF import</div><h2>Import a mod or song collection.</h2><p>Select the highest useful folder. RIL scans it for Codename, legacy, and Psych charts, then matches nearby instrumental and vocal stems.</p></div><label class="button primary">Choose folder<input id="fnfBatchFolder" type="file" webkitdirectory directory multiple class="hidden"></label></div><div class="fnf-batch-toolbar"><b id="fnfBatchSummary">Choose a mod, songs, or assets folder.</b><button id="fnfBatchImportButton" class="button primary" disabled>Import selected</button></div><div id="fnfBatchProgress" class="list-sub">Nothing selected.</div><div id="fnfBatchPreview" class="fnf-batch-preview"><div class="empty">RIL will detect Codename, legacy, and Psych charts plus nearby audio.</div></div>`;
    const grid = q("#view-import > .grid.two") || q("#view-import .grid.two");
    (grid || view).after(node);
    q("#fnfBatchFolder").addEventListener("change", chooseFolder);
    q("#fnfBatchImportButton").addEventListener("click", importBatch);
    const style = document.createElement("style");
    style.id = "fnfBatchImportStyles";
    style.textContent = `.fnf-batch-importer{margin-top:16px}.fnf-batch-title{align-items:flex-start}.fnf-batch-title p{max-width:760px;margin:7px 0 0}.fnf-batch-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.018)}.fnf-batch-preview{display:grid;gap:10px;margin-top:12px;max-height:620px;overflow:auto}.fnf-batch-group{border:1px solid var(--line);border-radius:13px;overflow:hidden;background:rgba(255,255,255,.012)}.fnf-batch-group-head{display:flex;justify-content:space-between;gap:12px;padding:11px 12px;background:rgba(255,255,255,.025)}.fnf-batch-group-head>div:first-child{display:flex;flex-direction:column;gap:2px}.fnf-batch-group-head span,.fnf-batch-chart small{font-size:10px;color:var(--muted)}.fnf-batch-media{display:flex;flex-direction:column;text-align:right;max-width:55%}.fnf-batch-charts{display:grid}.fnf-batch-chart{display:grid;grid-template-columns:auto minmax(150px,.8fr) minmax(220px,1.2fr);align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--line)}.fnf-batch-chart>span{display:flex;flex-direction:column}.fnf-batch-name{width:100%}@media(max-width:760px){.fnf-batch-group-head,.fnf-batch-toolbar{align-items:flex-start;flex-direction:column}.fnf-batch-media{max-width:100%;text-align:left}.fnf-batch-chart{grid-template-columns:auto 1fr}.fnf-batch-name{grid-column:2}}`;
    document.head.appendChild(style);
    enhanceSingleFilePreview();
    return true;
  }

  function boot() {
    if (api()) {
      const timer = setInterval(() => { if (installUi()) clearInterval(timer); }, 50);
      setTimeout(installUi, 0);
      window.rilFnfBatchImport = { importBatch, diagnostics: runtime };
      return;
    }
    const script = document.createElement("script");
    script.src = "/fnf-folder-discovery.js";
    script.onload = boot;
    script.onerror = () => window.toast?.("FNF folder discovery failed to load.", "error");
    document.body.appendChild(script);
  }

  boot();
})();
