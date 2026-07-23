"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PREF_KEY = "ril-song-picker:v1";

  function readPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) || "null") || {};
      return {
        sort: ["az", "za", "recent", "attempts", "mode"].includes(saved.sort) ? saved.sort : "az",
        keyMode: ["all", "4", "5", "6", "7", "8", "9"].includes(String(saved.keyMode)) ? String(saved.keyMode) : "all",
        favoritesFirst: saved.favoritesFirst !== false,
      };
    } catch (_) {
      return { sort: "az", keyMode: "all", favoritesFirst: true };
    }
  }

  const savedPreferences = readPreferences();
  const runtime = {
    target: null,
    query: "",
    sort: savedPreferences.sort,
    keyMode: savedPreferences.keyMode,
    favoritesFirst: savedPreferences.favoritesFirst,
  };

  function savePreferences() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        sort: runtime.sort,
        keyMode: runtime.keyMode,
        favoritesFirst: runtime.favoritesFirst,
      }));
    } catch (_) {}
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  function comfortStore() {
    try { return JSON.parse(localStorage.getItem("ril-practice-comfort:v1") || "null") || {}; }
    catch (_) { return {}; }
  }

  function songs() {
    const rows = Array.isArray(window.state?.songs) ? window.state.songs : [];
    return rows.filter(song => song?.has_chart);
  }

  function songKeyMode(song) {
    return Number(song?.chart?.key_count || 0);
  }

  function latestStamp(song) {
    return Date.parse(song?.latest_attempt?.recorded_at || "") || 0;
  }

  function savedAudioLabel(song) {
    const media = song?.media || {};
    const tracks = [];
    if (media.instrumental) tracks.push("Inst");
    if (media.vocals) tracks.push("Vocals");
    return tracks.length ? `${tracks.join(" + ")} saved` : "No saved audio";
  }

  function sortedSongs() {
    const favorites = new Set(comfortStore().favorites || []);
    let rows = songs().filter(song => {
      const query = runtime.query.trim().toLocaleLowerCase();
      const matchesSearch = !query || String(song.song_name).toLocaleLowerCase().includes(query) || String(song.folder).toLocaleLowerCase().includes(query);
      const matchesMode = runtime.keyMode === "all" || songKeyMode(song) === Number(runtime.keyMode);
      return matchesSearch && matchesMode;
    });
    const compareName = (a, b) => String(a.song_name).localeCompare(String(b.song_name), undefined, { numeric: true, sensitivity: "base" });
    rows.sort((a, b) => {
      if (runtime.favoritesFirst) {
        const favoriteDifference = Number(favorites.has(b.folder)) - Number(favorites.has(a.folder));
        if (favoriteDifference) return favoriteDifference;
      }
      if (runtime.sort === "za") return -compareName(a, b);
      if (runtime.sort === "attempts") return Number(b.attempt_count || 0) - Number(a.attempt_count || 0) || compareName(a, b);
      if (runtime.sort === "recent") return latestStamp(b) - latestStamp(a) || compareName(a, b);
      if (runtime.sort === "mode") return songKeyMode(a) - songKeyMode(b) || compareName(a, b);
      return compareName(a, b);
    });
    return rows;
  }

  function installModal() {
    if (q("#songPickerModal")) return;
    const modal = document.createElement("div");
    modal.id = "songPickerModal";
    modal.className = "song-picker-modal";
    modal.innerHTML = `
      <div class="song-picker-dialog card">
        <div class="song-picker-head">
          <div><div class="eyebrow">Chart library</div><h2>Choose a song</h2><p id="songPickerCaption">Search and sort every imported chart.</p></div>
          <button id="songPickerClose" class="icon-button" title="Close">×</button>
        </div>
        <div class="song-picker-controls">
          <input id="songPickerSearch" placeholder="Search song names or folders…" autocomplete="off">
          <select id="songPickerSort" title="Sort songs">
            <option value="az">Name A–Z</option><option value="za">Name Z–A</option><option value="recent">Recently attempted</option><option value="attempts">Most attempts</option><option value="mode">Key mode</option>
          </select>
          <select id="songPickerMode" title="Filter key mode"><option value="all">All modes</option><option value="4">4K</option><option value="5">5K</option><option value="6">6K</option><option value="7">7K</option><option value="8">8K</option><option value="9">9K</option></select>
          <button id="songPickerFavorites" class="button small">Favorites first</button>
        </div>
        <div class="song-picker-summary"><span id="songPickerCount">0 songs</span><span>Click a row or use ↑ ↓ Enter</span></div>
        <div id="songPickerRows" class="song-picker-rows" role="listbox"></div>
      </div>
    `;
    document.body.appendChild(modal);

    q("#songPickerSort").value = runtime.sort;
    q("#songPickerMode").value = runtime.keyMode;
    q("#songPickerFavorites").classList.toggle("primary", runtime.favoritesFirst);
    q("#songPickerFavorites").textContent = runtime.favoritesFirst ? "Favorites first" : "Mixed favorites";

    q("#songPickerClose").addEventListener("click", close);
    modal.addEventListener("pointerdown", event => { if (event.target === modal) close(); });
    q("#songPickerSearch").addEventListener("input", event => { runtime.query = event.target.value; render(); });
    q("#songPickerSort").addEventListener("change", event => { runtime.sort = event.target.value; savePreferences(); render(); });
    q("#songPickerMode").addEventListener("change", event => { runtime.keyMode = event.target.value; savePreferences(); render(); });
    q("#songPickerFavorites").addEventListener("click", event => {
      runtime.favoritesFirst = !runtime.favoritesFirst;
      event.currentTarget.classList.toggle("primary", runtime.favoritesFirst);
      event.currentTarget.textContent = runtime.favoritesFirst ? "Favorites first" : "Mixed favorites";
      savePreferences();
      render();
    });
    modal.addEventListener("keydown", handleKeys);
  }

  function targetLabel() {
    if (runtime.target === "practice") return "Practice";
    if (runtime.target === "analysis") return "Analysis";
    return "Visualizer";
  }

  function open(target = "visualizer") {
    installModal();
    runtime.target = target;
    runtime.query = "";
    q("#songPickerSearch").value = "";
    q("#songPickerCaption").textContent = `Load a chart into ${targetLabel()}. Names are sorted naturally, so Song 2 appears before Song 10.`;
    q("#songPickerModal").classList.add("open");
    render();
    requestAnimationFrame(() => q("#songPickerSearch").focus());
  }

  function close() {
    q("#songPickerModal")?.classList.remove("open");
  }

  function render() {
    const rows = sortedSongs();
    const favorites = new Set(comfortStore().favorites || []);
    q("#songPickerCount").textContent = `${rows.length} song${rows.length === 1 ? "" : "s"}`;
    q("#songPickerRows").innerHTML = rows.length ? rows.map((song, index) => {
      const summary = song.chart || {};
      const favorite = favorites.has(song.folder);
      return `<button class="song-picker-row${index === 0 ? " selected" : ""}" data-folder="${esc(song.folder)}" role="option" aria-selected="${index === 0}">
        <span class="song-picker-star">${favorite ? "★" : "☆"}</span>
        <span class="song-picker-main"><b>${esc(song.song_name)}</b><small>${esc(song.folder)} · ${esc(savedAudioLabel(song))}</small></span>
        <span class="song-picker-meta"><b>${Number(summary.key_count || 0)}K</b><small>${Number(song.attempt_count || 0)} attempts</small></span>
        <span class="song-picker-meta"><b>${Number(summary.base_bpm || 0).toFixed(1)} BPM</b><small>${summary.player_notes || 0} notes</small></span>
      </button>`;
    }).join("") : `<div class="empty">No imported charts match these filters.</div>`;
    qa(".song-picker-row", q("#songPickerRows")).forEach(row => row.addEventListener("click", () => choose(row.dataset.folder)));
  }

  function selectedRow() {
    return q(".song-picker-row.selected", q("#songPickerRows"));
  }

  function selectRelative(delta) {
    const rows = qa(".song-picker-row", q("#songPickerRows"));
    if (!rows.length) return;
    let index = Math.max(0, rows.indexOf(selectedRow()));
    index = Math.max(0, Math.min(rows.length - 1, index + delta));
    rows.forEach((row, rowIndex) => {
      row.classList.toggle("selected", rowIndex === index);
      row.setAttribute("aria-selected", rowIndex === index ? "true" : "false");
    });
    rows[index].scrollIntoView({ block: "nearest" });
  }

  function handleKeys(event) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); selectRelative(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); selectRelative(-1); }
    else if (event.key === "Enter") {
      const row = selectedRow();
      if (row) { event.preventDefault(); choose(row.dataset.folder); }
    }
  }

  function choose(folder) {
    if (!folder) return;
    const selector = runtime.target === "practice" ? "#practiceSongSelect" : runtime.target === "analysis" ? "#analysisSongSelect" : "#visualizerSongSelect";
    const select = q(selector);
    if (select) {
      select.value = folder;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
  }

  function naturalSortSelect(select) {
    if (!select || select.dataset.songPickerSorting === "1") return;
    const placeholder = [...select.options].find(option => !option.value);
    const current = select.value;
    const existing = [...select.options].filter(option => option.value);
    const sorted = [...existing].sort((a, b) => a.textContent.localeCompare(b.textContent, undefined, { numeric: true, sensitivity: "base" }));
    const actualSignature = existing.map(option => `${option.value}:${option.textContent}`).join("|");
    const sortedSignature = sorted.map(option => `${option.value}:${option.textContent}`).join("|");
    if (actualSignature === sortedSignature) {
      select.dataset.songPickerSignature = sortedSignature;
      return;
    }
    select.dataset.songPickerSorting = "1";
    select.innerHTML = "";
    if (placeholder) select.appendChild(placeholder);
    sorted.forEach(option => select.appendChild(option));
    select.value = current;
    select.dataset.songPickerSignature = sortedSignature;
    select.dataset.songPickerSorting = "0";
  }

  function addBrowseButton(select, target) {
    if (!select || q(`[data-song-picker-target="${target}"]`, select.parentElement)) return;
    const button = document.createElement("button");
    button.className = "button small song-picker-open";
    button.dataset.songPickerTarget = target;
    button.textContent = "Browse songs";
    button.addEventListener("click", () => open(target));
    select.insertAdjacentElement("afterend", button);
  }

  function installControls() {
    const visual = q("#visualizerSongSelect");
    const practice = q("#practiceSongSelect");
    const analysis = q("#analysisSongSelect");
    naturalSortSelect(visual);
    naturalSortSelect(practice);
    naturalSortSelect(analysis);
    addBrowseButton(visual, "visualizer");
    addBrowseButton(practice, "practice");
    addBrowseButton(analysis, "analysis");
  }

  function installStyles() {
    if (q("#songPickerStyles")) return;
    const style = document.createElement("style");
    style.id = "songPickerStyles";
    style.textContent = `
      .song-picker-modal{position:fixed;inset:0;z-index:1000;display:none;place-items:center;padding:24px;background:rgba(0,0,0,.72);backdrop-filter:blur(8px)}
      .song-picker-modal.open{display:grid}.song-picker-dialog{width:min(920px,96vw);height:min(760px,88vh);padding:18px;display:flex;flex-direction:column;overflow:hidden}
      .song-picker-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.song-picker-head h2{margin:3px 0}.song-picker-head p{margin:0;color:var(--muted)}
      .song-picker-controls{display:grid;grid-template-columns:minmax(220px,1fr) 160px 120px auto;gap:8px;margin-top:16px}
      .song-picker-summary{display:flex;justify-content:space-between;gap:12px;padding:9px 2px 7px;font-size:11px;color:var(--muted)}
      .song-picker-rows{min-height:0;overflow:auto;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.015)}
      .song-picker-row{width:100%;display:grid;grid-template-columns:28px minmax(180px,1fr) 110px 130px;gap:10px;align-items:center;padding:11px 12px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--text);text-align:left;cursor:pointer}
      .song-picker-row:last-child{border-bottom:0}.song-picker-row:hover,.song-picker-row.selected{background:rgba(117,230,255,.09);box-shadow:inset 3px 0 var(--accent)}
      .song-picker-star{font-size:16px;color:#ffd166}.song-picker-main,.song-picker-meta{display:flex;flex-direction:column;gap:2px;min-width:0}.song-picker-main b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.song-picker-main small,.song-picker-meta small{color:var(--muted)}
      .song-picker-meta{text-align:right}.song-picker-open{white-space:nowrap}
      @media(max-width:720px){.song-picker-controls{grid-template-columns:1fr 1fr}.song-picker-controls input{grid-column:1/-1}.song-picker-row{grid-template-columns:24px minmax(150px,1fr) 78px}.song-picker-row .song-picker-meta:last-child{display:none}}
    `;
    document.head.appendChild(style);
  }

  function tick() {
    installControls();
    requestAnimationFrame(tick);
  }

  installStyles();
  installModal();
  window.rilSongPicker = { open, close, render, choose };
  requestAnimationFrame(tick);
})();
