"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? "").replace(/[&<>'\"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);

  const runtime = {
    navInstalled: false,
    dashboardInstalled: false,
    practiceInstalled: false,
    visualizerInstalled: false,
    lastPracticeSong: null,
    lastPracticeAttempt: null,
    activePracticePanel: null,
  };

  function formatDuration(ms) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
  }

  function formatDate(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "Unknown date";
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function navigate(view) {
    if (typeof go === "function") go(view);
    else window.go?.(view);
  }

  function chooseSongFor(target, folder) {
    if (!folder) return;
    if (target === "visualizer") {
      window.loadVisualizer?.(folder, null);
      return;
    }
    const selector = target === "practice" ? "#practiceSongSelect" : "#analysisSongSelect";
    const select = q(selector);
    navigate(target);
    if (!select) return;
    select.value = folder;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /* grouped application navigation */
  function navGroup(label, views) {
    const nav = q(".nav");
    if (!nav) return null;
    const buttons = views.map(view => q(`.nav-button[data-view="${view}"]`, nav)).filter(Boolean);
    if (!buttons.length) return null;
    const group = document.createElement("section");
    group.className = "nav-group";
    group.dataset.navGroup = label.toLowerCase();
    group.innerHTML = `<div class="nav-group-label">${esc(label)}</div><div class="nav-group-items"></div>`;
    const body = q(".nav-group-items", group);
    buttons.forEach(button => body.appendChild(button));
    return group;
  }

  function installNavigation() {
    if (runtime.navInstalled || q(".nav-group")) return true;
    const nav = q(".nav");
    if (!nav || !q('[data-view="practice"]') || !q('[data-view="analysis"]') || !q('[data-view="reports"]')) return false;
    const groups = [
      navGroup("Library", ["dashboard", "songs", "import"]),
      navGroup("Play", ["practice", "visualizer", "record"]),
      navGroup("Analyze", ["analysis", "reports"]),
      navGroup("System", ["settings"]),
    ].filter(Boolean);
    nav.replaceChildren(...groups);
    runtime.navInstalled = true;
    return true;
  }

  /* dashboard */
  function metricHtml(label, value, note = "") {
    return `<div class="card metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div>${note ? `<div class="metric-note">${esc(note)}</div>` : ""}</div>`;
  }

  function dashboardAttemptHtml(attempt) {
    const number = attempt.attempt_number === null || attempt.attempt_number === undefined ? "—" : String(attempt.attempt_number).padStart(3, "0");
    return `<div class="list-row"><div style="min-width:0"><div class="dashboard-attempt-title">${esc(attempt.song_name || "Unknown song")}</div><div class="dashboard-attempt-meta"><span>Attempt ${esc(number)}</span><span>${esc(formatDate(attempt.recorded_at))}</span>${Number.isFinite(Number(attempt.accuracy)) ? `<span>${Number(attempt.accuracy).toFixed(2)}%</span>` : ""}${Number.isFinite(Number(attempt.lane_presses)) ? `<span>${Number(attempt.lane_presses).toLocaleString()} inputs</span>` : ""}</div></div><button class="button small workspace-replay" data-song="${esc(attempt.song_folder)}" data-attempt="${esc(attempt.folder)}">Replay</button></div>`;
  }

  function installDashboardActions() {
    const metrics = q("#dashboardMetrics");
    if (!metrics) return;
    if (!q("#dashboardContinue")) {
      const continueCard = document.createElement("div");
      continueCard.id = "dashboardContinue";
      continueCard.className = "card pad dashboard-continue";
      metrics.before(continueCard);
    }
    if (!q("#dashboardQuickActions")) {
      const actions = document.createElement("div");
      actions.id = "dashboardQuickActions";
      actions.className = "dashboard-quick-actions";
      actions.innerHTML = `
        <button class="button dashboard-quick-action" data-workspace-go="practice"><b>Practice</b><span>Open a chart and play a range</span></button>
        <button class="button dashboard-quick-action" data-workspace-go="import"><b>Import</b><span>Add FNF, osu!mania, Quaver, or .ril</span></button>
        <button class="button dashboard-quick-action" data-workspace-go="record"><b>Record</b><span>Capture an external rhythm-game run</span></button>
        <button class="button dashboard-quick-action" data-workspace-go="analysis"><b>Analyze</b><span>Inspect an attempt or chart</span></button>`;
      q("#dashboardContinue").after(actions);
      qa("[data-workspace-go]", actions).forEach(button => button.addEventListener("click", () => navigate(button.dataset.workspaceGo)));
    }
  }

  function composeDashboard() {
    const data = window.state?.dashboard;
    const metrics = q("#dashboardMetrics");
    if (!data || !metrics) return;
    installDashboardActions();
    metrics.classList.add("ril-dashboard-metrics");
    metrics.innerHTML = [
      metricHtml("Songs", Number(data.songs || 0).toLocaleString(), "local library"),
      metricHtml("Attempts", Number(data.attempts || 0).toLocaleString(), "saved runs"),
      metricHtml("Imported charts", Number(data.charts || 0).toLocaleString(), "ready to play"),
    ].join("");

    let secondary = q("#dashboardSecondaryStats");
    if (!secondary) {
      secondary = document.createElement("details");
      secondary.id = "dashboardSecondaryStats";
      secondary.className = "dashboard-secondary-stats";
      metrics.after(secondary);
    }
    secondary.innerHTML = `<summary>Lifetime statistics</summary>${metricHtml("Physical inputs", Number(data.total_presses || 0).toLocaleString(), "lanes + dodges")}`;

    const recentAttempt = data.recent_attempts?.[0] || null;
    const recentSong = data.recent_songs?.[0] || null;
    const continueCard = q("#dashboardContinue");
    if (continueCard) {
      const folder = recentAttempt?.song_folder || recentSong?.folder || "";
      const name = recentAttempt?.song_name || recentSong?.song_name || "";
      continueCard.innerHTML = folder
        ? `<div class="section-title" style="padding:0"><div style="min-width:0"><div class="eyebrow">Continue where you left off</div><h2 class="ril-clamp-1" style="margin-top:4px">${esc(name)}</h2><div class="list-sub">${recentAttempt ? `Latest attempt · ${esc(formatDate(recentAttempt.recorded_at))}` : "Recently opened song"}</div></div><div class="actions"><button class="button primary" data-dashboard-continue="practice" data-song="${esc(folder)}">Practice</button>${recentAttempt ? `<button class="button" data-dashboard-replay data-song="${esc(folder)}" data-attempt="${esc(recentAttempt.folder)}">Replay</button>` : ""}</div></div>`
        : '<div class="empty" style="padding:8px">Import or record a song to start building your workspace.</div>';
      q('[data-dashboard-continue="practice"]', continueCard)?.addEventListener("click", event => chooseSongFor("practice", event.currentTarget.dataset.song));
      q("[data-dashboard-replay]", continueCard)?.addEventListener("click", event => window.loadVisualizer?.(event.currentTarget.dataset.song, event.currentTarget.dataset.attempt));
    }

    const recentSongs = q("#recentSongs");
    if (recentSongs) recentSongs.classList.add("dashboard-song-grid");
    const attempts = q("#recentAttempts");
    if (attempts) {
      attempts.innerHTML = data.recent_attempts?.length ? data.recent_attempts.map(dashboardAttemptHtml).join("") : '<div class="empty">No attempts yet.</div>';
      qa(".workspace-replay", attempts).forEach(button => button.addEventListener("click", () => window.loadVisualizer?.(button.dataset.song, button.dataset.attempt)));
    }
  }

  function installDashboard() {
    if (runtime.dashboardInstalled) return true;
    if (!q("#dashboardMetrics")) return false;
    runtime.dashboardInstalled = true;
    installDashboardActions();
    if (typeof renderDashboard === "function" && !renderDashboard._rilWorkspaceWrapped) {
      const original = renderDashboard;
      const wrapped = function workspaceRenderDashboard(...args) {
        const result = original.apply(this, args);
        composeDashboard();
        return result;
      };
      wrapped._rilWorkspaceWrapped = true;
      renderDashboard = wrapped;
    }
    composeDashboard();
    return true;
  }

  /* Practice progressive disclosure */
  function panelMarkup(id, title) {
    return `<section id="${id}" class="practice-context-panel"><div class="practice-context-head"><h3>${esc(title)}</h3><button class="icon-button compact" data-practice-close title="Close">×</button></div><div class="practice-context-body"></div></section>`;
  }

  function practicePanel(name) { return q(`#practice${name[0].toUpperCase()}${name.slice(1)}Panel`); }

  function setPracticePanel(name = null) {
    runtime.activePracticePanel = name;
    for (const panelName of ["range", "mixer", "settings", "results", "diagnostics"]) {
      practicePanel(panelName)?.classList.toggle("open", panelName === name);
      q(`[data-practice-panel="${panelName}"]`)?.classList.toggle("primary", panelName === name);
    }
  }

  function practiceMetaText() {
    const practice = window.rilPracticeEngine?.practice;
    if (!practice?.bundle) return "Choose a song";
    const summary = practice.bundle.summary || {};
    const parts = [summary.key_count ? `${summary.key_count}K` : "", summary.base_bpm ? `${Number(summary.base_bpm).toFixed(1)} BPM` : "", practice.durationMs ? formatDuration(practice.durationMs) : ""].filter(Boolean);
    return parts.join(" · ");
  }

  function clickSpeed(value) {
    const button = qa(".practice-speed").find(node => Math.abs(Number(node.dataset.speed) - Number(value)) < 0.001);
    button?.click();
  }

  function buildPracticeToolbar(stage) {
    const toolbar = document.createElement("div");
    toolbar.id = "practiceContextToolbar";
    toolbar.className = "practice-context-toolbar";
    toolbar.innerHTML = `
      <button class="practice-song-chip" id="practiceWorkspaceSong" title="Choose a Practice song"><b>Choose a song</b><span>Shared library</span></button>
      <button class="button small" id="practiceWorkspaceBrowse">Browse</button>
      <label class="field" style="display:flex;align-items:center;gap:5px;grid-template-columns:auto auto"><span style="font-size:9px;color:var(--muted)">Speed</span><select id="practiceWorkspaceSpeed" style="width:84px;padding:6px 7px"><option value="0.5">50%</option><option value="0.75">75%</option><option value="0.9">90%</option><option value="1">100%</option><option value="1.25">125%</option></select></label>
      <span id="practiceWorkspaceLoopMount"></span>
      <span class="ril-toolbar-spacer"></span>
      <button class="button small" data-practice-panel="range">Range</button>
      <button class="button small" data-practice-panel="mixer">Mixer</button>
      <button class="button small" data-practice-panel="settings">Settings</button>
      <button class="button small" data-practice-panel="results" id="practiceWorkspaceResults" disabled>Results</button>
      <button class="button small" id="practiceWorkspaceLibrary">Library</button>
      <button class="button small" data-practice-panel="diagnostics">Diagnostics</button>`;
    q(".practice-stage-toolbar", stage)?.after(toolbar);
    q("#practiceWorkspaceSong")?.addEventListener("click", () => window.rilSongBrowser?.open?.("practice"));
    q("#practiceWorkspaceBrowse")?.addEventListener("click", () => window.rilSongBrowser?.open?.("practice"));
    q("#practiceWorkspaceSpeed")?.addEventListener("change", event => clickSpeed(event.target.value));
    qa("[data-practice-panel]", toolbar).forEach(button => button.addEventListener("click", () => {
      const name = button.dataset.practicePanel;
      setPracticePanel(runtime.activePracticePanel === name ? null : name);
    }));
  }

  function buildPracticePanels(stage) {
    const host = document.createElement("div");
    host.id = "practiceContextHost";
    host.className = "practice-context-host";
    host.innerHTML = [
      panelMarkup("practiceRangePanel", "Range editor"),
      panelMarkup("practiceMixerPanel", "Audio mixer"),
      panelMarkup("practiceSettingsPanel", "Practice settings"),
      panelMarkup("practiceResultsPanel", "Results"),
      panelMarkup("practiceDiagnosticsPanel", "Diagnostics & shortcuts"),
    ].join("");
    q(".practice-transport", stage)?.after(host);
    qa("[data-practice-close]", host).forEach(button => button.addEventListener("click", () => setPracticePanel(null)));
  }

  function movePracticeControls() {
    const rangeBlock = q("#practiceRangeCaption")?.closest(".inspector-block");
    const playbackBlock = q("#practiceLeadIn")?.closest(".inspector-block");
    const lastAttemptBlock = q("#practiceJudgmentBreakdown")?.closest(".inspector-block");
    const dataBlock = q(".practice-polish-data");
    if (!rangeBlock || !playbackBlock || !lastAttemptBlock) return false;

    q(".practice-context-body", practicePanel("range"))?.appendChild(rangeBlock);
    q(".practice-context-body", practicePanel("settings"))?.appendChild(playbackBlock);

    const hotfix = q("#practiceHotfixControls", playbackBlock);
    const mixerBody = q(".practice-context-body", practicePanel("mixer"));
    if (hotfix && mixerBody) {
      const subtitle = q(".practice-hotfix-subtitle", hotfix);
      const mixer = q(".practice-hotfix-mixer", hotfix);
      if (subtitle) mixerBody.appendChild(subtitle);
      if (mixer) mixerBody.appendChild(mixer);
    }

    const headAudio = qa("#view-practice .practice-head-actions > label");
    if (headAudio.length && mixerBody) {
      const files = document.createElement("div");
      files.className = "actions";
      files.style.marginTop = "10px";
      headAudio.forEach(label => files.appendChild(label));
      mixerBody.appendChild(files);
    }
    if (mixerBody && !q("#practiceWorkspaceStemList", mixerBody)) {
      const stems = document.createElement("div");
      stems.id = "practiceWorkspaceStemList";
      stems.className = "practice-mixer-stems";
      mixerBody.appendChild(stems);
    }

    const resultsBody = q(".practice-context-body", practicePanel("results"));
    if (resultsBody) {
      const headline = document.createElement("div");
      headline.id = "practiceWorkspaceResultHeadline";
      headline.className = "song-identity-grid";
      resultsBody.appendChild(headline);
      const actions = document.createElement("div");
      actions.className = "practice-results-actions";
      actions.id = "practiceWorkspaceResultActions";
      const polishActions = q("#practicePolishResultActions");
      if (polishActions) {
        polishActions.style.position = "static";
        polishActions.style.transform = "none";
        polishActions.style.opacity = "1";
        polishActions.style.pointerEvents = "auto";
        actions.appendChild(polishActions);
      }
      const analysis = document.createElement("button");
      analysis.id = "practiceWorkspaceAnalyze";
      analysis.className = "button small";
      analysis.textContent = "Analysis";
      analysis.addEventListener("click", () => {
        const folder = window.rilPracticeEngine?.practice?.songFolder;
        if (folder) chooseSongFor("analysis", folder);
      });
      actions.appendChild(analysis);
      resultsBody.appendChild(actions);
      resultsBody.appendChild(lastAttemptBlock);
      if (dataBlock) resultsBody.appendChild(dataBlock);
    }

    const loop = q("#practiceLoopToggle");
    const loopMount = q("#practiceWorkspaceLoopMount");
    if (loop && loopMount) loopMount.appendChild(loop);
    const favorite = q("#practiceFavoriteButton");
    if (favorite) q("#practiceWorkspaceBrowse")?.after(favorite);
    const oldBrowse = q('[data-song-picker-target="practice"]', q("#view-practice .practice-head-actions"));
    if (oldBrowse) oldBrowse.style.display = "none";
    return true;
  }

  function installPracticeLibrary() {
    const library = q("#practiceComfort");
    if (!library || q("#practiceWorkspaceLibraryModal")) return false;
    const modal = document.createElement("div");
    modal.id = "practiceWorkspaceLibraryModal";
    modal.className = "workspace-modal";
    modal.innerHTML = `<div class="workspace-modal-dialog"><div class="workspace-modal-head"><div><div class="eyebrow">Practice library</div><h2>Setups, collections, goals & history</h2></div><button class="icon-button" id="practiceWorkspaceLibraryClose">×</button></div><div class="workspace-modal-body"></div></div>`;
    document.body.appendChild(modal);
    q(".workspace-modal-body", modal).appendChild(library);
    const open = () => modal.classList.add("open");
    const close = () => modal.classList.remove("open");
    q("#practiceWorkspaceLibrary")?.addEventListener("click", open);
    q("#practiceWorkspaceLibraryClose")?.addEventListener("click", close);
    modal.addEventListener("pointerdown", event => { if (event.target === modal) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && modal.classList.contains("open")) close(); });
    return true;
  }

  function gradeFor(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    if (number >= 98) return "S";
    if (number >= 93) return "A";
    if (number >= 85) return "B";
    if (number >= 75) return "C";
    if (number >= 60) return "D";
    return "F";
  }

  function attemptAccuracy(attempt) {
    const stats = attempt?.stats || {};
    const hits = Number(stats.hits || 0);
    const misses = Number(stats.misses || 0);
    return hits + misses ? Number(stats.weighted || 0) / (hits + misses) * 100 : null;
  }

  function updatePracticeWorkspace() {
    const practice = window.rilPracticeEngine?.practice;
    if (!practice) return;
    const song = q("#practiceWorkspaceSong");
    if (song) song.innerHTML = `<b>${esc(practice.songName || "Choose a song")}</b><span>${esc(practiceMetaText())}</span>`;
    const speed = q("#practiceWorkspaceSpeed");
    if (speed && document.activeElement !== speed) speed.value = String(Number(practice.speed || 1));

    const resultButton = q("#practiceWorkspaceResults");
    const hasResult = Boolean(practice.lastAttempt);
    if (resultButton) resultButton.disabled = !hasResult;
    if (hasResult && runtime.lastPracticeAttempt !== practice.lastAttempt) {
      runtime.lastPracticeAttempt = practice.lastAttempt;
      if (q("#view-practice")?.classList.contains("active")) setPracticePanel("results");
    }
    if (runtime.lastPracticeSong !== practice.songFolder) {
      runtime.lastPracticeSong = practice.songFolder;
      runtime.lastPracticeAttempt = practice.lastAttempt || null;
      if (runtime.activePracticePanel === "results" && !practice.lastAttempt) setPracticePanel(null);
    }

    const attempt = practice.lastAttempt;
    const headline = q("#practiceWorkspaceResultHeadline");
    if (headline) {
      if (!attempt) headline.innerHTML = "";
      else {
        const value = attemptAccuracy(attempt);
        const stats = attempt.stats || {};
        headline.innerHTML = `<div class="song-identity-card"><span>Accuracy</span><b>${value === null ? "—" : `${value.toFixed(2)}%`}</b></div><div class="song-identity-card"><span>Grade</span><b>${gradeFor(value)}</b></div><div class="song-identity-card"><span>Best combo</span><b>${Number(stats.maxCombo || 0).toLocaleString()}</b></div><div class="song-identity-card"><span>Misses</span><b>${Number(stats.misses || 0).toLocaleString()}</b></div>`;
      }
    }

    const stemsRoot = q("#practiceWorkspaceStemList");
    if (stemsRoot) {
      const extra = window.rilMultiVocals?.diagnostics?.stems || [];
      const primaryName = window.state?.viz?.audioNames?.vocals || "";
      const rows = [];
      if (primaryName) rows.push(`Primary vocals · ${primaryName}`);
      for (const stem of extra) rows.push(stem.filename || stem.label || stem.stem_id || "Vocal stem");
      stemsRoot.innerHTML = rows.length
        ? `<b>${rows.length} vocal track${rows.length === 1 ? "" : "s"}</b><div>${rows.map(row => esc(row)).join("<br>")}</div><div style="margin-top:5px">The Vocals control is the shared level for every detected vocal stem.</div>`
        : "No saved vocal stems are loaded. Instrumental-only and silent Practice remain supported.";
    }

    const diagnostics = q(".practice-context-body", practicePanel("diagnostics"));
    if (diagnostics) {
      const backpolish = window.rilPracticeEngine?.backpolish?.diagnostics;
      const source = q("#practiceSourceStatus")?.textContent || "—";
      const timing = q("#practiceTimingStatus")?.textContent || "—";
      const audio = q("#practicePolishAudioStatus")?.textContent || q("#practiceAudioStatus")?.textContent || "—";
      const stateLabel = q("#practiceRunState")?.textContent || (practice.playing ? "Playing" : practice.bundle ? "Ready" : "No chart");
      const shortcuts = q("#practiceControlsHelp")?.textContent || "Enter starts; Escape/P pauses; R retries; L toggles loop.";
      diagnostics.innerHTML = `<div class="practice-diagnostics"><div class="practice-diagnostic-box"><span>State</span><b>${esc(stateLabel)}</b></div><div class="practice-diagnostic-box"><span>Source</span><b>${esc(source)}</b></div><div class="practice-diagnostic-box"><span>Timing</span><b>${esc(timing)}</b></div><div class="practice-diagnostic-box"><span>Audio</span><b>${esc(audio)}</b></div><div class="practice-diagnostic-box"><span>Input clock</span><b>Conductor + event timestamps</b></div><div class="practice-diagnostic-box"><span>Clock sample</span><b>${Number(backpolish?.lastSongMs || practice.currentMs || 0).toFixed(2)} ms</b></div></div><div class="song-detail-section"><h3>Keyboard shortcuts</h3><div class="list-sub" style="margin-top:7px;line-height:1.6">${esc(shortcuts)}</div></div><div class="list-sub" style="margin-top:10px">Diagnostics are informational. Timing behavior is unchanged by this panel.</div>`;
    }
  }

  function installPractice() {
    if (runtime.practiceInstalled) return true;
    const stage = q("#view-practice .practice-stage-card");
    const inspector = q("#view-practice .practice-inspector");
    if (!stage || !inspector || !q("#practicePrecisionSelector") || !q("#practiceHotfixControls") || !q("#practiceComfort") || !q(".practice-polish-data")) return false;
    buildPracticeToolbar(stage);
    buildPracticePanels(stage);
    if (!movePracticeControls()) {
      q("#practiceContextToolbar")?.remove();
      q("#practiceContextHost")?.remove();
      return false;
    }
    installPracticeLibrary();
    const badge = q("#practiceEngineBackpolishBadge");
    if (badge) badge.style.display = "none";
    runtime.practiceInstalled = true;
    updatePracticeWorkspace();
    return true;
  }

  /* Visualizer keeps transport primary while setup/media are disclosed on demand. */
  function installVisualizerDisclosure() {
    if (runtime.visualizerInstalled) return true;
    const toolbar = q("#view-visualizer .visualizer-toolbar");
    if (!toolbar || !q("#laneLength")) return false;
    const groups = qa(":scope > .tool-group", toolbar);
    if (groups.length <= 3) { runtime.visualizerInstalled = true; return true; }
    const details = document.createElement("details");
    details.id = "visualizerMoreControls";
    details.className = "visualizer-more-controls card";
    details.style.marginBottom = "8px";
    details.innerHTML = '<summary class="button small" style="margin:8px;display:inline-flex">View, replay & media</summary><div class="visualizer-more-body" style="display:flex;gap:8px;flex-wrap:wrap;padding:0 10px 10px"></div>';
    toolbar.after(details);
    const body = q(".visualizer-more-body", details);
    groups.slice(3).forEach(group => body.appendChild(group));
    runtime.visualizerInstalled = true;
    return true;
  }

  function tick() {
    installNavigation();
    installDashboard();
    installPractice();
    installPracticeLibrary();
    installVisualizerDisclosure();
    updatePracticeWorkspace();
    requestAnimationFrame(tick);
  }

  window.rilWorkspaceUi = {
    installNavigation,
    composeDashboard,
    installPractice,
    setPracticePanel,
    diagnostics: runtime,
  };
  requestAnimationFrame(tick);
})();
