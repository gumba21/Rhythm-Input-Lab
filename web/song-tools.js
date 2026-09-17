"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const mappingKey = folder => `ril-song-mappings:${folder}`;

  function esc(value) {
    return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
  }

  function savedMappings(folder) {
    try { return JSON.parse(localStorage.getItem(mappingKey(folder)) || "null"); }
    catch (_) { return null; }
  }

  function applySavedMappings(folder, bundle) {
    const saved = savedMappings(folder);
    if (!saved || !bundle) return bundle;
    bundle.mappings ||= { note_types: {}, event_types: {} };
    bundle.mappings.note_types = { ...(bundle.mappings.note_types || {}), ...(saved.note_types || {}) };
    bundle.mappings.event_types = { ...(bundle.mappings.event_types || {}), ...(saved.event_types || {}) };
    return bundle;
  }

  function sourceLabel(summary = {}, song = {}) {
    const raw = String(summary.source_format || summary.format || song.source_format || "").toLowerCase();
    if (raw.includes("quaver")) return "Quaver";
    if (raw.includes("osu")) return "osu!mania";
    if (raw.includes("fnf") || raw.includes("psych") || raw.includes("codename")) return "FNF";
    if (raw.includes("ril") || song.imported_from || song.shared_by) return "Portable RIL";
    return raw ? raw.replaceAll("_", " ") : "Unknown source";
  }

  function creatorLabel(summary = {}) {
    return summary.mapper || summary.charter || summary.creator || summary.artist || summary.original_charter || "Unknown creator";
  }

  function durationLabel(ms) {
    return typeof formatTime === "function" ? formatTime(ms) : `${Math.floor(Number(ms || 0) / 60000)}:${String(Math.floor(Number(ms || 0) / 1000) % 60).padStart(2,"0")}`;
  }

  function mediaFor(folder, data) {
    const listed = (window.state?.songs || []).find(song => song.folder === folder);
    return listed?.media || data.song?.media || {};
  }

  function mediaSummary(media = {}) {
    const stems = Array.isArray(media.vocal_stems) ? media.vocal_stems : [];
    return {
      instrumental: Boolean(media.instrumental),
      vocals: Boolean(media.vocals || stems.length),
      stems,
    };
  }

  function goToSong(folder, target) {
    if (!folder) return;
    const selector = target === "practice" ? "#practiceSongSelect" : target === "analysis" ? "#analysisSongSelect" : "#visualizerSongSelect";
    const select = q(selector);
    if (select) {
      select.value = folder;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closeSongModal?.();
    if (target === "visualizer" && typeof loadVisualizer === "function") loadVisualizer(folder, null);
    else window.go?.(target);
  }

  function categoryRows(data) {
    const summary = data.bundle?.summary || {};
    const noteCounts = summary.note_type_counts || {};
    const eventCounts = summary.event_type_counts || {};
    const noteMappings = data.bundle?.mappings?.note_types || {};
    const eventMappings = data.bundle?.mappings?.event_types || {};
    const noteRows = Object.entries(noteCounts).map(([displayName, count]) => {
      const key = displayName === "(normal)" ? "" : displayName;
      const mapping = noteMappings[key] || {};
      const hazard = mapping.should_press === false || mapping.category === "hazard";
      return `<div class="mechanic-row"><div><b>${esc(displayName)}</b><div class="list-sub">${Number(count || 0).toLocaleString()} authored note${count === 1 ? "" : "s"}</div></div><select class="note-category" data-name="${esc(key)}"><option value="normal" ${hazard ? "" : "selected"}>Normal / press</option><option value="hazard" ${hazard ? "selected" : ""}>Hazard / avoid</option></select></div>`;
    }).join("");
    const categories = ["unmapped", "hazard", "dodge", "dodge_warning", "lane_transform", "scroll_speed", "visual", "presentation"];
    const eventRows = Object.entries(eventCounts).map(([name, count]) => {
      const current = eventMappings[name]?.category || "unmapped";
      return `<div class="mechanic-row"><div><b>${esc(name)}</b><div class="list-sub">${Number(count || 0).toLocaleString()} event${count === 1 ? "" : "s"}</div></div><select class="event-category" data-name="${esc(name)}">${categories.map(category => `<option value="${category}" ${category === current ? "selected" : ""}>${category.replaceAll("_", " ")}</option>`).join("")}</select></div>`;
    }).join("");
    return { noteRows, eventRows };
  }

  function saveMechanicMappings(folder, data) {
    const next = JSON.parse(JSON.stringify(data.bundle?.mappings || { note_types: {}, event_types: {} }));
    next.note_types ||= {};
    next.event_types ||= {};
    qa(".note-category", q("#modalSongBody")).forEach(select => {
      const hazard = select.value === "hazard";
      next.note_types[select.dataset.name] = { ...(next.note_types[select.dataset.name] || {}), category: hazard ? "hazard" : "normal", gameplay: true, should_press: !hazard };
    });
    qa(".event-category", q("#modalSongBody")).forEach(select => {
      next.event_types[select.dataset.name] = { ...(next.event_types[select.dataset.name] || {}), category: select.value };
    });
    localStorage.setItem(mappingKey(folder), JSON.stringify(next));
    data.bundle.mappings = next;
    if (state.viz.songFolder === folder && state.viz.bundle) {
      state.viz.bundle.mappings = next;
      recomputeComparison();
    }
    toast("Mechanic categories saved for this song.");
  }

  function identityCard(label, value) {
    return `<div class="song-identity-card"><span>${esc(label)}</span><b title="${esc(value)}">${esc(value || "—")}</b></div>`;
  }

  function attemptRows(folder, attempts) {
    if (!attempts?.length) return '<div class="empty">No recorded attempts yet.</div>';
    return attempts.map(attempt => `<div class="list-row"><div style="min-width:0"><div class="list-title">Attempt ${String(attempt.attempt_number ?? "—").padStart(3,"0")}</div><div class="list-sub">${esc(attempt.recorded_at || "Unknown date")} · ${Number(attempt.lane_presses || 0).toLocaleString()} lane presses${attempt.peak_nps ? ` · peak ${Number(attempt.peak_nps).toFixed(1)} NPS` : ""}</div></div><div class="actions"><button class="button small modal-analysis-attempt" data-attempt="${esc(attempt.folder)}">Analyze</button><button class="button small modal-replay" data-attempt="${esc(attempt.folder)}">Replay</button></div></div>`).join("");
  }

  function overviewHtml(folder, data) {
    const summary = data.bundle?.summary || {};
    const media = mediaSummary(mediaFor(folder, data));
    const artist = summary.artist || summary.song_artist || summary.album_artist || "—";
    const difficulty = summary.difficulty || summary.difficulty_name || summary.version || "—";
    return `<section class="song-detail-section"><div class="song-identity-grid">${identityCard("Artist", artist)}${identityCard("Mapper / charter", creatorLabel(summary))}${identityCard("Difficulty", difficulty)}${identityCard("Source", sourceLabel(summary, data.song))}${identityCard("Key mode", summary.key_count ? `${summary.key_count}K` : "—")}${identityCard("BPM", summary.base_bpm ? Number(summary.base_bpm).toFixed(2) : "—")}${identityCard("Duration", summary.duration_ms ? durationLabel(summary.duration_ms) : "—")}${identityCard("Attempts", String(data.attempts?.length || 0))}</div></section>
      <section class="song-detail-section"><h3>Media</h3><div class="pill-row" style="margin-top:8px"><span class="pill ${media.instrumental ? "good" : "warn"}">${media.instrumental ? "Instrumental available" : "Instrumental missing"}</span><span class="pill ${media.vocals ? "good" : ""}">${media.vocals ? `${media.stems.length > 1 ? `${media.stems.length} vocal stems` : "Vocals available"}` : "No vocals"}</span></div></section>
      ${data.song?.imported_from || data.song?.shared_by ? `<section class="song-detail-section"><h3>Provenance</h3><div class="list-sub" style="margin-top:7px">${esc(data.song.imported_from ? `Imported from ${data.song.imported_from}` : `Shared by ${data.song.shared_by}`)}</div></section>` : ""}`;
  }

  function mediaHtml(folder, data) {
    const media = mediaSummary(mediaFor(folder, data));
    const raw = mediaFor(folder, data);
    const stemRows = media.stems.length ? media.stems.map(row => `<div class="list-row"><div><div class="list-title">${esc(row.label || row.filename || row.stem_id)}</div><div class="list-sub">${esc(row.filename || row.stored_name || "Saved vocal stem")}${row.primary ? " · primary" : ""}</div></div><span class="pill good">Saved</span></div>`).join("") : '<div class="empty">No separate vocal stems are stored for this song.</div>';
    return `<section class="song-detail-section"><div class="song-identity-grid">${identityCard("Instrumental", media.instrumental ? raw.instrumental?.filename || "Available" : "Missing")}${identityCard("Vocals", media.vocals ? raw.vocals?.filename || `${media.stems.length} stem(s)` : "Missing")}${identityCard("Vocal stems", String(media.stems.length))}${identityCard("Playback", media.instrumental || media.vocals ? "Ready" : "Silent")}</div></section><section class="song-detail-section"><h3>Vocal stems</h3><div class="list" style="margin-top:9px">${stemRows}</div></section><div class="list-sub" style="margin-top:12px">Media can be attached or replaced from Practice/Visualizer. Extra vocal stems remain synchronized by the multi-vocal playback layer.</div>`;
  }

  function sourceHtml(data) {
    const summary = data.bundle?.summary || {};
    const metadata = data.bundle?.song_metadata || {};
    const provenance = [data.song?.imported_from && `Imported from ${data.song.imported_from}`, data.song?.shared_by && `Shared by ${data.song.shared_by}`, summary.original_charter && `Original charter ${summary.original_charter}`].filter(Boolean);
    return `<section class="song-detail-section"><div class="song-identity-grid">${identityCard("Adapter", sourceLabel(summary, data.song))}${identityCard("Source format", summary.source_format || summary.format || "—")}${identityCard("Source file", summary.source_name || metadata.source_name || "—")}${identityCard("Song ID", summary.song_id || data.song?.song_id || "—")}</div></section><section class="song-detail-section"><h3>Source / provenance</h3><div class="list-sub" style="margin-top:8px;line-height:1.7">${provenance.length ? provenance.map(row => esc(row)).join("<br>") : "No additional sharing provenance is recorded."}</div></section>`;
  }

  async function renderAnalyzer(folder, data) {
    const target = q("#songAnalyzerBody");
    if (!target) return;
    try {
      const attempts = await Promise.all((data.attempts || []).map(attempt => api(`/api/attempt?folder=${encodeURIComponent(folder)}&attempt=${encodeURIComponent(attempt.folder)}`)));
      const analyses = attempts.map(item => item.analysis || {}).filter(item => item.recording);
      const summary = data.bundle?.summary || {};
      const sum = values => values.reduce((total, value) => total + Number(value || 0), 0);
      const avg = values => values.length ? sum(values) / values.length : null;
      const latest = analyses[0] || null;
      const laneStats = latest?.per_lane ? Object.entries(latest.per_lane).map(([key, lane]) => `<div class="stat-chip"><span>${esc(key)}</span><b>${Number(lane.press_count || 0).toLocaleString()}</b><div class="list-sub">${Number(lane.share_percent || 0).toFixed(1)}% · ${Number(lane.peak_1s_nps || 0).toFixed(1)} NPS</div></div>`).join("") : "";
      target.className = "";
      target.innerHTML = `<div class="song-identity-grid">${identityCard("Attempts", String(analyses.length))}${identityCard("Total presses", sum(analyses.map(a => a.recording?.lane_press_count)).toLocaleString())}${identityCard("Average NPS", avg(analyses.map(a => a.recording?.average_lane_nps))?.toFixed(2) || "—")}${identityCard("Average peak", avg(analyses.map(a => a.speed?.peak_1s?.nps)) ? `${avg(analyses.map(a => a.speed?.peak_1s?.nps)).toFixed(1)} NPS` : "—")}</div><div class="grid two" style="margin-top:12px"><div class="card pad"><h3>Chart</h3><div class="list-sub" style="margin-top:8px;line-height:1.7">${Number(summary.player_notes || 0).toLocaleString()} player notes<br>${Number(summary.sustain_notes || 0).toLocaleString()} sustains<br>${Number(summary.player_chord_groups || 0).toLocaleString()} chord groups<br>authored peak ${Number(summary.player_peak_1s_nps || 0).toFixed(1)} NPS</div></div><div class="card pad"><h3>Recorded play</h3><div class="list-sub" style="margin-top:8px;line-height:1.7">${sum(analyses.map(a => a.recording?.dodge_press_count)).toLocaleString()} dodge presses total<br>median interpress ${avg(analyses.map(a => a.timing?.median_interpress_ms))?.toFixed(1) || "—"} ms<br>${sum(analyses.map(a => a.chords?.count)).toLocaleString()} detected chords<br>${sum(analyses.map(a => a.jacks?.pair_count)).toLocaleString()} detected jack pairs</div></div></div>${laneStats ? `<h3 style="margin-top:14px">Latest attempt by lane</h3><div class="lane-analysis">${laneStats}</div>` : '<div class="empty">No attempt analysis yet.</div>'}`;
    } catch (error) { target.textContent = `Could not load statistics: ${error.message}`; }
  }

  function bindTabs(body) {
    qa("[data-song-detail-tab]", body).forEach(button => button.addEventListener("click", () => {
      const tab = button.dataset.songDetailTab;
      qa("[data-song-detail-tab]", body).forEach(item => item.classList.toggle("active", item.dataset.songDetailTab === tab));
      qa("[data-song-detail-panel]", body).forEach(panel => { panel.hidden = panel.dataset.songDetailPanel !== tab; });
    }));
  }

  const originalOpenSongModal = openSongModal;
  openSongModal = async folder => {
    try {
      const data = await api(`/api/song?folder=${encodeURIComponent(folder)}`);
      applySavedMappings(folder, data.bundle);
      state.selectedSong = data;
      const summary = data.bundle?.summary || {};
      const modal = q("#songModal .modal");
      const staticHead = modal?.firstElementChild;
      staticHead?.classList.add("song-detail-head");
      q("#modalSongTitle").textContent = data.song.song_name;
      q("#modalSongTitle").classList.add("song-detail-title", "ril-clamp-2");
      const eyebrow = q(".eyebrow", staticHead);
      if (eyebrow) eyebrow.textContent = "Song details";

      const { noteRows, eventRows } = categoryRows(data);
      const body = q("#modalSongBody");
      body.style.marginTop = "0";
      body.innerHTML = `<div class="song-detail-primary"><button class="button primary" id="songDetailPractice" ${data.bundle ? "" : "disabled"}>Practice</button><button class="button primary" id="songDetailVisualizer" ${data.bundle ? "" : "disabled"}>Visualizer</button><button class="button primary" id="songDetailAnalysis" ${data.bundle ? "" : "disabled"}>Analysis</button><span style="flex:1"></span><button class="button" id="songDetailExport" ${data.bundle ? "" : "disabled"}>Export .ril</button><button class="button" id="songDetailManage">Manage</button></div>
        <div class="song-detail-tabs" role="tablist"><button class="song-detail-tab active" data-song-detail-tab="overview">Overview</button><button class="song-detail-tab" data-song-detail-tab="attempts">Attempts</button><button class="song-detail-tab" data-song-detail-tab="chart">Chart / mechanics</button><button class="song-detail-tab" data-song-detail-tab="media">Media</button><button class="song-detail-tab" data-song-detail-tab="source">Source</button><button class="song-detail-tab" data-song-detail-tab="statistics">Statistics</button></div>
        <div class="song-detail-body"><div class="song-detail-panel" data-song-detail-panel="overview">${data.bundle ? overviewHtml(folder, data) : '<div class="empty">This song has recorded inputs but no imported chart.</div>'}</div><div class="song-detail-panel" data-song-detail-panel="attempts" hidden><div class="list">${attemptRows(folder, data.attempts)}</div></div><div class="song-detail-panel" data-song-detail-panel="chart" hidden>${data.bundle ? `<div class="song-detail-section"><div class="section-title" style="padding:0"><div><h3>Mechanic categories</h3><div class="list-sub">Tell RIL how custom notes and events should be interpreted. This changes local mappings, not the source chart.</div></div><button class="button small primary" id="saveMechanicMappings">Save categories</button></div><h3 style="margin-top:14px">Note types</h3><div class="mechanic-grid">${noteRows || '<div class="empty">No custom note labels.</div>'}</div><h3 style="margin-top:16px">Event types</h3><div class="mechanic-grid">${eventRows || '<div class="empty">No events.</div>'}</div></div>` : '<div class="empty">No chart is available.</div>'}</div><div class="song-detail-panel" data-song-detail-panel="media" hidden>${mediaHtml(folder, data)}</div><div class="song-detail-panel" data-song-detail-panel="source" hidden>${sourceHtml(data)}</div><div class="song-detail-panel" data-song-detail-panel="statistics" hidden><div id="songAnalyzerBody" class="empty">Reading attempt statistics…</div></div></div>`;

      bindTabs(body);
      q("#songDetailPractice", body)?.addEventListener("click", () => goToSong(folder, "practice"));
      q("#songDetailVisualizer", body)?.addEventListener("click", () => goToSong(folder, "visualizer"));
      q("#songDetailAnalysis", body)?.addEventListener("click", () => goToSong(folder, "analysis"));
      q("#songDetailExport", body)?.addEventListener("click", () => window.rilPackages?.openExport?.(folder));
      q("#songDetailManage", body)?.addEventListener("click", () => {
        closeSongModal(); window.go?.("import"); window.rilImportCenter?.setActive?.("fnf");
        const field = q("#importSongName"); if (field) field.value = data.song.song_name;
      });
      q("#saveMechanicMappings", body)?.addEventListener("click", () => saveMechanicMappings(folder, data));
      qa(".modal-replay", body).forEach(button => button.addEventListener("click", () => loadVisualizer(folder, button.dataset.attempt)));
      qa(".modal-analysis-attempt", body).forEach(button => button.addEventListener("click", () => {
        goToSong(folder, "analysis");
        setTimeout(() => { const select = q("#analysisAttemptA"); if (select) { select.value = button.dataset.attempt; select.dispatchEvent(new Event("change", { bubbles: true })); } }, 80);
      }));
      q("#songModal").classList.add("open");
      renderAnalyzer(folder, data);
    } catch (error) {
      console.warn("Redesigned song page failed; using base details", error);
      return originalOpenSongModal(folder);
    }
  };
  window.openSongModal = openSongModal;

  /* Preserve visualizer utilities and local mechanic mappings. */
  function installVisualizerControls() {
    const toolbar = q(".visualizer-toolbar");
    const canvasWrap = q(".visualizer-canvas-wrap");
    if (!toolbar || !canvasWrap || q("#laneLength")) return;
    const mode = q('#viewMode option[value="inputs"]');
    if (mode) mode.textContent = "Attempt only";
    const laneGroup = document.createElement("div");
    laneGroup.className = "tool-group";
    laneGroup.innerHTML = '<label>Lane length</label><input id="laneLength" type="range" min="320" max="900" step="20" value="560" style="width:110px"><span id="laneLengthLabel" class="mono">560</span>';
    const scrollGroup = q("#scrollSpeed")?.closest(".tool-group");
    (scrollGroup || toolbar.lastElementChild)?.after(laneGroup);
    const reset = document.createElement("button");
    reset.id = "resetVisualizerButton";
    reset.className = "button small";
    reset.textContent = "Reset view";
    q("#restartButton")?.after(reset);
    const setLength = value => {
      const height = Math.max(320, Math.min(900, Number(value || 560)));
      state.viz.laneHeight = height;
      canvasWrap.style.height = `${height}px`;
      q("#laneLength").value = String(height);
      q("#laneLengthLabel").textContent = String(height);
      localStorage.setItem("ril-lane-height", String(height));
      resizeCanvases();
    };
    q("#laneLength").addEventListener("input", event => setLength(event.target.value));
    setLength(localStorage.getItem("ril-lane-height") || 560);
    reset.addEventListener("click", () => {
      state.viz.playing = false; state.viz.playbackRate = 1; state.viz.scrollScale = 1; state.viz.offsetMs = 0;
      state.viz.showOpponent = false; state.viz.showEvents = true; state.viz.xray = false; state.viz.theme = "fnf";
      state.viz.showSplashes = true; state.viz.downscroll = false; state.viz.ghostTapping = true;
      state.viz.viewMode = state.viz.attempt ? "compare" : "chart";
      q("#playbackRate").value = "1"; q("#scrollSpeed").value = "1"; q("#offsetInput").value = "0"; q("#themeMode").value = "fnf"; q("#viewMode").value = state.viz.viewMode;
      setLength(560); seekTo(0); updateVizButtons(); updatePlayButton(); recomputeComparison(); toast("Visualizer view reset.");
    });
  }

  const originalLoadVisualizer = loadVisualizer;
  loadVisualizer = async (songFolder, attemptFolder = null) => {
    await originalLoadVisualizer(songFolder, attemptFolder);
    if (state.viz.bundle && state.viz.songFolder === songFolder) {
      applySavedMappings(songFolder, state.viz.bundle);
      recomputeComparison();
    }
  };
  window.loadVisualizer = loadVisualizer;

  const style = document.createElement("style");
  style.id = "songToolsStyles";
  style.textContent = `.mechanic-grid{display:grid;gap:8px;margin-top:10px}.mechanic-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.025)}.mechanic-row select{width:160px}.lane-analysis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:10px}.visualizer-canvas-wrap{height:560px;min-height:320px}`;
  document.head.appendChild(style);
  installVisualizerControls();
})();
