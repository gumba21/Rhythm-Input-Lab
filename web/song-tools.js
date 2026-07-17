"use strict";

(() => {
  const mappingKey = folder => `ril-song-mappings:${folder}`;

  function savedMappings(folder) {
    try { return JSON.parse(localStorage.getItem(mappingKey(folder)) || "null"); }
    catch { return null; }
  }

  function applySavedMappings(folder, bundle) {
    const saved = savedMappings(folder);
    if (!saved || !bundle) return bundle;
    bundle.mappings ||= { note_types: {}, event_types: {} };
    bundle.mappings.note_types = { ...(bundle.mappings.note_types || {}), ...(saved.note_types || {}) };
    bundle.mappings.event_types = { ...(bundle.mappings.event_types || {}), ...(saved.event_types || {}) };
    return bundle;
  }

  function installStyles() {
    if (document.querySelector("#songToolsStyles")) return;
    const style = document.createElement("style");
    style.id = "songToolsStyles";
    style.textContent = `.mechanic-grid{display:grid;gap:8px;margin-top:10px}.mechanic-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.025)}.mechanic-row select{width:150px}.analyzer-section{margin-top:18px}.lane-analysis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:10px}.visualizer-canvas-wrap{height:560px;min-height:320px}`;
    document.head.appendChild(style);
  }

  function installVisualizerControls() {
    const toolbar = document.querySelector(".visualizer-toolbar");
    const canvasWrap = document.querySelector(".visualizer-canvas-wrap");
    if (!toolbar || !canvasWrap || document.querySelector("#laneLength")) return;

    const mode = document.querySelector('#viewMode option[value="inputs"]');
    if (mode) mode.textContent = "Attempt only";

    const laneGroup = document.createElement("div");
    laneGroup.className = "tool-group";
    laneGroup.innerHTML = '<label>Lane length</label><input id="laneLength" type="range" min="320" max="900" step="20" value="560" style="width:110px"><span id="laneLengthLabel" class="mono">560</span>';
    const scrollGroup = document.querySelector("#scrollSpeed")?.closest(".tool-group");
    (scrollGroup || toolbar.lastElementChild)?.after(laneGroup);

    const reset = document.createElement("button");
    reset.id = "resetVisualizerButton";
    reset.className = "button small";
    reset.textContent = "Reset view";
    document.querySelector("#restartButton")?.after(reset);

    const setLength = value => {
      const height = Math.max(320, Math.min(900, Number(value || 560)));
      state.viz.laneHeight = height;
      canvasWrap.style.height = `${height}px`;
      document.querySelector("#laneLength").value = String(height);
      document.querySelector("#laneLengthLabel").textContent = String(height);
      localStorage.setItem("ril-lane-height", String(height));
      resizeCanvases();
    };

    document.querySelector("#laneLength").addEventListener("input", event => setLength(event.target.value));
    setLength(localStorage.getItem("ril-lane-height") || 560);

    reset.addEventListener("click", () => {
      state.viz.playing = false;
      state.viz.playbackRate = 1;
      state.viz.scrollScale = 1;
      state.viz.offsetMs = 0;
      state.viz.showOpponent = false;
      state.viz.showEvents = true;
      state.viz.xray = false;
      state.viz.theme = "fnf";
      state.viz.showSplashes = true;
      state.viz.downscroll = false;
      state.viz.ghostTapping = true;
      state.viz.viewMode = state.viz.attempt ? "compare" : "chart";
      document.querySelector("#playbackRate").value = "1";
      document.querySelector("#scrollSpeed").value = "1";
      document.querySelector("#offsetInput").value = "0";
      document.querySelector("#themeMode").value = "fnf";
      document.querySelector("#viewMode").value = state.viz.viewMode;
      setLength(560);
      seekTo(0);
      updateVizButtons();
      updatePlayButton();
      recomputeComparison();
      toast("Visualizer view reset.");
    });
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
      return `<div class="mechanic-row"><div><b>${escapeHtml(displayName)}</b><div class="list-sub">${formatNumber(count)} authored note${count === 1 ? "" : "s"}</div></div><select class="note-category" data-name="${escapeHtml(key)}"><option value="normal" ${hazard ? "" : "selected"}>Normal / press</option><option value="hazard" ${hazard ? "selected" : ""}>Hazard / avoid</option></select></div>`;
    }).join("");
    const categories = ["unmapped", "hazard", "dodge", "dodge_warning", "lane_transform", "scroll_speed", "visual", "presentation"];
    const eventRows = Object.entries(eventCounts).map(([name, count]) => {
      const current = eventMappings[name]?.category || "unmapped";
      return `<div class="mechanic-row"><div><b>${escapeHtml(name)}</b><div class="list-sub">${formatNumber(count)} event${count === 1 ? "" : "s"}</div></div><select class="event-category" data-name="${escapeHtml(name)}">${categories.map(category => `<option value="${category}" ${category === current ? "selected" : ""}>${category.replaceAll("_", " ")}</option>`).join("")}</select></div>`;
    }).join("");
    return { noteRows, eventRows };
  }

  async function renderAnalyzer(folder, data) {
    const target = document.querySelector("#songAnalyzerBody");
    if (!target) return;
    try {
      const attempts = await Promise.all((data.attempts || []).map(attempt => api(`/api/attempt?folder=${encodeURIComponent(folder)}&attempt=${encodeURIComponent(attempt.folder)}`)));
      const analyses = attempts.map(item => item.analysis || {}).filter(item => item.recording);
      const summary = data.bundle?.summary || {};
      const sum = values => values.reduce((total, value) => total + Number(value || 0), 0);
      const avg = values => values.length ? sum(values) / values.length : null;
      const latest = analyses[0] || null;
      const laneStats = latest?.per_lane ? Object.entries(latest.per_lane).map(([key, lane]) => `<div class="stat-chip"><span>${escapeHtml(key)}</span><b>${formatNumber(lane.press_count)}</b><div class="list-sub">${formatNumber(lane.share_percent, 1)}% · ${formatNumber(lane.peak_1s_nps, 1)} NPS</div></div>`).join("") : "";
      target.className = "";
      target.innerHTML = `<div class="grid metrics" style="grid-template-columns:repeat(4,minmax(0,1fr))">${metricCard("Attempts", formatNumber(analyses.length))}${metricCard("Total presses", formatNumber(sum(analyses.map(a => a.recording?.lane_press_count))))}${metricCard("Average NPS", formatNumber(avg(analyses.map(a => a.recording?.average_lane_nps)), 2))}${metricCard("Average peak", `${formatNumber(avg(analyses.map(a => a.speed?.peak_1s?.nps)), 1)} NPS`)}</div><div class="grid two" style="margin-top:10px"><div class="card pad"><h4>Chart</h4><div class="list-sub" style="margin-top:8px">${formatNumber(summary.key_count)}K · ${formatNumber(summary.base_bpm, 1)} BPM<br>${formatNumber(summary.player_notes)} player notes · ${formatNumber(summary.sustain_notes)} sustains<br>${formatNumber(summary.player_chord_groups)} chords · ${formatNumber(summary.player_jack_pairs_250ms)} jack pairs<br>authored peak ${formatNumber(summary.player_peak_1s_nps, 1)} NPS</div></div><div class="card pad"><h4>Recorded play</h4><div class="list-sub" style="margin-top:8px">${formatNumber(sum(analyses.map(a => a.recording?.dodge_press_count)))} dodge presses total<br>median interpress ${formatNumber(avg(analyses.map(a => a.timing?.median_interpress_ms)), 1)} ms<br>${formatNumber(sum(analyses.map(a => a.chords?.count)))} detected chords<br>${formatNumber(sum(analyses.map(a => a.jacks?.pair_count)))} detected jack pairs</div></div></div>${laneStats ? `<h4 style="margin-top:14px">Latest attempt by lane</h4><div class="lane-analysis">${laneStats}</div>` : `<div class="empty" style="margin-top:10px">No attempt analysis yet.</div>`}`;
    } catch (error) {
      target.textContent = `Could not load analyzer: ${error.message}`;
    }
  }

  const originalOpenSongModal = openSongModal;
  openSongModal = async folder => {
    try {
      const data = await api(`/api/song?folder=${encodeURIComponent(folder)}`);
      applySavedMappings(folder, data.bundle);
      state.selectedSong = data;
      document.querySelector("#modalSongTitle").textContent = data.song.song_name;
      const summary = data.bundle?.summary;
      const attemptRows = data.attempts.length ? data.attempts.map(attempt => `<div class="list-row"><div><div class="list-title">Attempt ${String(attempt.attempt_number ?? "—").padStart(3, "0")}</div><div class="list-sub">${escapeHtml(attempt.recorded_at)} · ${formatNumber(attempt.lane_presses)} lane presses · peak ${formatNumber(attempt.peak_nps, 1)} NPS</div></div><button class="button small modal-replay" data-attempt="${escapeHtml(attempt.folder)}">Replay</button></div>`).join("") : `<div class="empty">No recorded attempts.</div>`;
      const { noteRows, eventRows } = categoryRows(data);
      document.querySelector("#modalSongBody").innerHTML = `${summary ? `<div class="grid metrics" style="grid-template-columns:repeat(4,minmax(0,1fr))">${metricCard("Player notes", formatNumber(summary.player_notes))}${metricCard("Events", formatNumber(summary.event_count))}${metricCard("Authored peak", `${formatNumber(summary.player_peak_1s_nps, 1)} NPS`)}${metricCard("Duration", formatTime(summary.duration_ms))}</div>` : `<div class="empty">This song has recorded inputs but no imported chart.</div>`}<div class="actions" style="margin:16px 0"><button class="button primary" id="modalChartReplay" ${summary ? "" : "disabled"}>Open visualizer</button><button class="button" data-close-go="import">Import / replace chart</button></div>${summary ? `<div class="analyzer-section"><div class="section-title"><div><h3>Mechanic categories</h3><div class="list-sub">Group custom notes and events, then tell the analyzer what they mean.</div></div><button class="button small primary" id="saveMechanicMappings">Save categories</button></div><h4 style="margin-top:12px">Note types</h4><div class="mechanic-grid">${noteRows || `<div class="empty">No note labels.</div>`}</div><h4 style="margin-top:14px">Event types</h4><div class="mechanic-grid">${eventRows || `<div class="empty">No events.</div>`}</div></div>` : ""}<div class="analyzer-section"><h3>Song analyzer</h3><div id="songAnalyzerBody" class="empty" style="margin-top:10px">Reading attempt data…</div></div><div class="analyzer-section"><h3>Attempts</h3><div class="list" style="margin-top:10px">${attemptRows}</div></div>`;
      document.querySelector("#modalChartReplay")?.addEventListener("click", () => loadVisualizer(folder, null));
      document.querySelectorAll(".modal-replay").forEach(button => button.addEventListener("click", () => loadVisualizer(folder, button.dataset.attempt)));
      document.querySelectorAll('[data-close-go]').forEach(button => button.addEventListener("click", () => { closeSongModal(); go(button.dataset.closeGo); document.querySelector("#importSongName").value = data.song.song_name; }));
      document.querySelector("#saveMechanicMappings")?.addEventListener("click", () => {
        const next = JSON.parse(JSON.stringify(data.bundle.mappings || { note_types: {}, event_types: {} }));
        document.querySelectorAll(".note-category").forEach(select => {
          const hazard = select.value === "hazard";
          next.note_types[select.dataset.name] = { ...(next.note_types[select.dataset.name] || {}), category: hazard ? "hazard" : "normal", gameplay: true, should_press: !hazard };
        });
        document.querySelectorAll(".event-category").forEach(select => {
          next.event_types[select.dataset.name] = { ...(next.event_types[select.dataset.name] || {}), category: select.value };
        });
        localStorage.setItem(mappingKey(folder), JSON.stringify(next));
        data.bundle.mappings = next;
        if (state.viz.songFolder === folder && state.viz.bundle) {
          state.viz.bundle.mappings = next;
          recomputeComparison();
        }
        toast("Mechanic categories saved for this song.");
      });
      document.querySelector("#songModal").classList.add("open");
      renderAnalyzer(folder, data);
    } catch (error) {
      console.warn("Enhanced song page failed; using original", error);
      return originalOpenSongModal(folder);
    }
  };

  const originalLoadVisualizer = loadVisualizer;
  loadVisualizer = async (songFolder, attemptFolder = null) => {
    await originalLoadVisualizer(songFolder, attemptFolder);
    if (state.viz.bundle && state.viz.songFolder === songFolder) {
      applySavedMappings(songFolder, state.viz.bundle);
      recomputeComparison();
    }
  };

  installStyles();
  installVisualizerControls();
})();
