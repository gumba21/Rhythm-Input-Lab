"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const runtime = {
    folder: null,
    sourceData: null,
    preview: null,
    previewStrength: null,
    savedFolder: null,
  };

  const strengthCopy = {
    light: "Fill clear player silence only. Handoff overlap stays extremely conservative.",
    balanced: "Fill silence, weave safe vocal handoffs, and allow limited sparse accents. Recommended.",
    hard: "Allow more authored opponent accents in sparse player phrases while keeping collision and density protection.",
  };

  function esc(value) {
    return typeof escapeHtml === "function"
      ? escapeHtml(value)
      : String(value ?? "").replace(/[&<>'"]/g, character => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
        })[character]);
  }

  function modal() {
    let root = q("#combinedChartModal");
    if (root) return root;
    root = document.createElement("div");
    root.id = "combinedChartModal";
    root.className = "modal-backdrop";
    root.style.zIndex = "120";
    root.innerHTML = `
      <div class="modal card combined-chart-modal" role="dialog" aria-modal="true" aria-labelledby="combinedChartTitle" style="width:min(760px,100%)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px">
          <div><div class="eyebrow">Derived FNF chart</div><h2 id="combinedChartTitle" style="font-size:28px;margin-top:4px">Combined Chart</h2><p id="combinedChartSubtitle" class="list-sub" style="margin-top:6px"></p></div>
          <button class="icon-button" id="combinedChartClose" aria-label="Close">×</button>
        </div>
        <div class="song-detail-section" style="margin-top:16px">
          <div class="form-grid">
            <label class="field"><span>Merge strength</span><select id="combinedChartStrength"><option value="light">Light</option><option value="balanced" selected>Balanced</option><option value="hard">Hard</option></select></label>
            <div class="field"><span>Output</span><div class="list-sub" id="combinedChartOutputName" style="padding:10px 0"></div></div>
          </div>
          <div class="list-sub" id="combinedChartStrengthHelp" style="margin-top:9px"></div>
          <div class="actions" style="margin-top:14px"><button class="button primary" id="combinedChartPreview">Preview merge</button><button class="button" id="combinedChartSave" disabled>Save as new chart</button></div>
        </div>
        <div id="combinedChartStatus" class="list-sub" style="margin-top:12px">Preview before saving. The source chart and source audio are never modified.</div>
        <div id="combinedChartPreviewBody"></div>
      </div>`;
    document.body.appendChild(root);

    q("#combinedChartClose", root).addEventListener("click", close);
    root.addEventListener("pointerdown", event => { if (event.target === root) close(); });
    q("#combinedChartStrength", root).addEventListener("change", () => {
      invalidatePreview();
      updateStrengthHelp();
    });
    q("#combinedChartPreview", root).addEventListener("click", preview);
    q("#combinedChartSave", root).addEventListener("click", save);
    return root;
  }

  function currentStrength() {
    return q("#combinedChartStrength", modal())?.value || "balanced";
  }

  function updateStrengthHelp() {
    const strength = currentStrength();
    const node = q("#combinedChartStrengthHelp", modal());
    if (node) node.textContent = strengthCopy[strength] || "";
  }

  function invalidatePreview() {
    runtime.preview = null;
    runtime.previewStrength = null;
    runtime.savedFolder = null;
    const saveButton = q("#combinedChartSave", modal());
    if (saveButton) saveButton.disabled = true;
    const body = q("#combinedChartPreviewBody", modal());
    if (body) body.innerHTML = "";
    const status = q("#combinedChartStatus", modal());
    if (status) status.textContent = "Preview before saving. The source chart and source audio are never modified.";
  }

  function open(folder, data = null) {
    runtime.folder = String(folder || "");
    runtime.sourceData = data || null;
    runtime.preview = null;
    runtime.previewStrength = null;
    runtime.savedFolder = null;
    const root = modal();
    const title = data?.song?.song_name || data?.bundle?.summary?.song_name || folder || "FNF chart";
    q("#combinedChartTitle", root).textContent = "Generate Combined Chart";
    q("#combinedChartSubtitle", root).textContent = `${title} · player/right side remains the backbone`;
    q("#combinedChartOutputName", root).textContent = `${title} — Combined`;
    q("#combinedChartStrength", root).value = "balanced";
    updateStrengthHelp();
    invalidatePreview();
    root.classList.add("open");
    q("#combinedChartPreview", root)?.focus({ preventScroll: true });
  }

  function close() {
    q("#combinedChartModal")?.classList.remove("open");
  }

  function metric(label, value) {
    return `<div class="song-identity-card"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  }

  function reasonLabel(value) {
    return String(value || "")
      .replaceAll("-", " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function renderPreview(data) {
    const root = modal();
    const stats = data.stats || {};
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const inserted = stats.insertions_by_reason || {};
    const rejected = stats.rejections_by_reason || {};
    const reasonRows = Object.entries(inserted).map(([reason, count]) =>
      `<div class="list-row"><div><div class="list-title">${esc(reasonLabel(reason))}</div><div class="list-sub">Opponent notes accepted for this reason</div></div><b>${Number(count || 0).toLocaleString()}</b></div>`
    ).join("");
    const rejectRows = Object.entries(rejected).map(([reason, count]) =>
      `<div class="list-row"><div><div class="list-title">${esc(reasonLabel(reason))}</div><div class="list-sub">Rejected deterministically</div></div><b>${Number(count || 0).toLocaleString()}</b></div>`
    ).join("");

    q("#combinedChartPreviewBody", root).innerHTML = `
      <section class="song-detail-section" style="margin-top:12px">
        <h3>Preview</h3>
        <div class="song-identity-grid" style="margin-top:10px">
          ${metric("Player notes", Number(stats.original_player_notes || 0).toLocaleString())}
          ${metric("Opponent source", Number(stats.original_opponent_notes || 0).toLocaleString())}
          ${metric("Opponent inserted", Number(stats.opponent_notes_inserted || 0).toLocaleString())}
          ${metric("Opponent rejected", Number(stats.opponent_notes_rejected || 0).toLocaleString())}
          ${metric("Handoffs", Number(stats.handoffs_detected || 0).toLocaleString())}
          ${metric("Collision rejects", Number(stats.collision_rejections || 0).toLocaleString())}
          ${metric("Player peak", `${Number(stats.original_player_peak_nps || 0).toFixed(1)} NPS`)}
          ${metric("Combined peak", `${Number(stats.combined_peak_nps || 0).toFixed(1)} NPS`)}
          ${metric("Result notes", Number(stats.resulting_total_note_count || 0).toLocaleString())}
          ${metric("Result sustains", Number(stats.sustain_count || 0).toLocaleString())}
        </div>
      </section>
      <section class="song-detail-section">
        <h3>Accepted opponent material</h3>
        <div class="list" style="margin-top:9px">${reasonRows || '<div class="empty">No opponent notes accepted at this strength.</div>'}</div>
      </section>
      <section class="song-detail-section">
        <h3>Rejections</h3>
        <div class="list" style="margin-top:9px">${rejectRows || '<div class="empty">No opponent notes rejected.</div>'}</div>
      </section>
      ${warnings.length ? `<section class="song-detail-section"><h3>Warnings</h3><div class="list-sub" style="margin-top:8px;line-height:1.7">${warnings.map(row => esc(row)).join("<br>")}</div></section>` : ""}
      <div class="list-sub" style="margin-top:12px">v1 only selects authored source notes. It never invents or retimes note timestamps. Events are preserved once, unchanged.</div>`;
  }

  async function preview() {
    if (!runtime.folder) return;
    const root = modal();
    const strength = currentStrength();
    const button = q("#combinedChartPreview", root);
    const saveButton = q("#combinedChartSave", root);
    const status = q("#combinedChartStatus", root);
    button.disabled = true;
    saveButton.disabled = true;
    status.textContent = "Analyzing player phrases, opponent phrases, handoffs, collisions, sustains, and local density…";
    try {
      const result = await api("/api/combined-chart/preview", {
        method: "POST",
        body: { folder: runtime.folder, strength },
      });
      runtime.preview = result;
      runtime.previewStrength = strength;
      q("#combinedChartOutputName", root).textContent = result.suggested_name || q("#combinedChartOutputName", root).textContent;
      renderPreview(result);
      status.textContent = `Preview ready · ${Number(result.stats?.opponent_notes_inserted || 0).toLocaleString()} opponent notes selected.`;
      saveButton.disabled = false;
    } catch (error) {
      runtime.preview = null;
      runtime.previewStrength = null;
      status.textContent = error.message;
      q("#combinedChartPreviewBody", root).innerHTML = `<div class="empty" style="margin-top:12px">${esc(error.message)}</div>`;
      toast(error.message, "error", 7000);
    } finally {
      button.disabled = false;
    }
  }

  async function save() {
    if (!runtime.folder || !runtime.preview || runtime.previewStrength !== currentStrength()) return;
    const root = modal();
    const button = q("#combinedChartSave", root);
    const previewButton = q("#combinedChartPreview", root);
    const status = q("#combinedChartStatus", root);
    button.disabled = true;
    previewButton.disabled = true;
    status.textContent = "Saving a new neutral derived chart and linking its existing media…";
    try {
      const result = await api("/api/combined-chart/save", {
        method: "POST",
        body: { folder: runtime.folder, strength: currentStrength() },
      });
      runtime.savedFolder = result.song?.folder || null;
      status.textContent = `Saved ${result.song?.song_name || "Combined Chart"} as a separate library chart.`;
      q("#combinedChartPreviewBody", root).insertAdjacentHTML("beforeend", `
        <section class="song-detail-section"><div class="pill good">Saved as new chart</div><div class="actions" style="margin-top:10px"><button class="button primary" id="combinedChartOpenPractice">Practice</button><button class="button" id="combinedChartOpenVisualizer">Visualizer</button></div></section>`);
      await refreshDashboard?.();
      q("#combinedChartOpenPractice", root)?.addEventListener("click", () => openSaved("practice"));
      q("#combinedChartOpenVisualizer", root)?.addEventListener("click", () => openSaved("visualizer"));
      toast(`${result.song?.song_name || "Combined Chart"} saved.`);
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
      toast(error.message, "error", 7000);
    } finally {
      previewButton.disabled = false;
    }
  }

  function openSaved(target) {
    const folder = runtime.savedFolder;
    if (!folder) return;
    close();
    closeSongModal?.();
    if (target === "visualizer") {
      loadVisualizer?.(folder, null);
      return;
    }
    window.go?.("practice");
    const select = q("#practiceSongSelect");
    if (select) {
      select.value = folder;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && q("#combinedChartModal")?.classList.contains("open")) {
      event.preventDefault();
      close();
    }
  });

  window.rilCombinedChart = { open, close, preview };
})();
