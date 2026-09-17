"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PREF_KEY = "ril-song-browser:v2";
  const LEGACY_PREF_KEY = "ril-song-picker:v1";
  const COMFORT_KEY = "ril-practice-comfort:v1";
  const scopes = [
    "all", "favorites", "recent", "imported", "attempts", "unplayed",
    "source:fnf", "source:osu", "source:quaver", "source:ril",
    "media:audio", "media:missing",
  ];

  function readJson(key, fallback = {}) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value && typeof value === "object" ? value : fallback;
    } catch (_) { return fallback; }
  }

  function readPreferences() {
    const saved = readJson(PREF_KEY, null) || readJson(LEGACY_PREF_KEY, {});
    return {
      sort: ["az", "za", "recent", "attempts", "mode", "imported"].includes(saved.sort) ? saved.sort : "az",
      keyMode: ["all", "4", "5", "6", "7", "8", "9"].includes(String(saved.keyMode)) ? String(saved.keyMode) : "all",
      favoritesFirst: saved.favoritesFirst !== false,
      view: ["compact", "comfortable"].includes(saved.view) ? saved.view : "compact",
      scope: scopes.includes(saved.scope) || String(saved.scope || "").startsWith("collection:") ? saved.scope : "all",
    };
  }

  const preferences = readPreferences();
  const runtime = {
    target: null,
    query: "",
    sort: preferences.sort,
    keyMode: preferences.keyMode,
    favoritesFirst: preferences.favoritesFirst,
    view: preferences.view,
    scope: preferences.scope,
    selectedFolder: null,
    installedMain: false,
  };

  function savePreferences() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        sort: runtime.sort,
        keyMode: runtime.keyMode,
        favoritesFirst: runtime.favoritesFirst,
        view: runtime.view,
        scope: runtime.scope,
      }));
    } catch (_) {}
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function comfortStore() { return readJson(COMFORT_KEY, {}); }

  function writeComfort(store) {
    try { localStorage.setItem(COMFORT_KEY, JSON.stringify(store)); }
    catch (_) {}
  }

  function allSongs() {
    return Array.isArray(window.state?.songs) ? window.state.songs : [];
  }

  function pickerSongs() { return allSongs().filter(song => song?.has_chart); }

  function favorites() { return new Set(comfortStore().favorites || []); }

  function toggleFavorite(folder) {
    const store = comfortStore();
    const rows = Array.isArray(store.favorites) ? store.favorites : [];
    store.favorites = rows.includes(folder) ? rows.filter(item => item !== folder) : [folder, ...rows];
    writeComfort(store);
    renderMain();
    if (q("#songPickerModal")?.classList.contains("open")) renderPicker();
  }

  function songKeyMode(song) { return Number(song?.chart?.key_count || 0); }
  function latestStamp(song) { return Date.parse(song?.latest_attempt?.recorded_at || "") || 0; }

  function importedStamp(song) {
    const candidates = [
      song?.imported_at,
      song?.recent_imported_at,
      song?.provenance?.imported_at,
      song?.chart?.imported_at,
      song?.chart?.source_imported_at,
    ];
    for (const value of candidates) {
      const stamp = Date.parse(value || "");
      if (stamp) return stamp;
    }
    return 0;
  }

  function sourceKey(song) {
    const summary = song?.chart || {};
    const raw = String(summary.source_format || summary.format || song?.source_format || "").toLowerCase();
    if (raw.includes("quaver")) return "quaver";
    if (raw.includes("osu")) return "osu";
    if (raw.includes("fnf") || raw.includes("psych") || raw.includes("codename")) return "fnf";
    if (raw.includes("ril") || song?.imported_from || song?.shared_by) return "ril";
    return "other";
  }

  function sourceLabel(song) {
    const key = sourceKey(song);
    return key === "osu" ? "osu!mania" : key === "fnf" ? "FNF" : key === "quaver" ? "Quaver" : key === "ril" ? "Portable RIL" : "Other";
  }

  function mediaInfo(song) {
    const media = song?.media || {};
    const vocals = Boolean(media.vocals || (Array.isArray(media.vocal_stems) && media.vocal_stems.length));
    const instrumental = Boolean(media.instrumental);
    return { instrumental, vocals, any: instrumental || vocals };
  }

  function durationText(ms) {
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    return `${minutes}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
  }

  function naturalCompare(a, b) {
    return String(a?.song_name || "").localeCompare(String(b?.song_name || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function collectionRows() {
    const store = comfortStore();
    return (Array.isArray(store.collections) ? store.collections : []).filter(row => row && row.id && row.name);
  }

  function collectionFolders(id) {
    const collection = collectionRows().find(row => String(row.id) === String(id));
    return new Set((collection?.items || []).map(item => item.songFolder).filter(Boolean));
  }

  function recentFolders() {
    return new Set((comfortStore().recent || []).map(row => row.folder).filter(Boolean));
  }

  function matchesScope(song, scope = runtime.scope) {
    const favorite = favorites().has(song.folder);
    if (scope === "all") return true;
    if (scope === "favorites") return favorite;
    if (scope === "recent") return recentFolders().has(song.folder) || latestStamp(song) > 0;
    if (scope === "imported") return importedStamp(song) > 0;
    if (scope === "attempts") return Number(song.attempt_count || 0) > 0;
    if (scope === "unplayed") return Number(song.attempt_count || 0) === 0;
    if (scope === "media:audio") return mediaInfo(song).any;
    if (scope === "media:missing") return song.has_chart && !mediaInfo(song).any;
    if (scope.startsWith("source:")) return sourceKey(song) === scope.split(":", 2)[1];
    if (scope.startsWith("collection:")) return collectionFolders(scope.slice("collection:".length)).has(song.folder);
    return true;
  }

  function filterRows(rows, { query = runtime.query, scope = runtime.scope, keyMode = runtime.keyMode } = {}) {
    const needle = String(query || "").trim().toLocaleLowerCase();
    return rows.filter(song => {
      const haystack = `${song.song_name || ""} ${song.folder || ""} ${sourceLabel(song)} ${song.chart?.artist || ""} ${song.chart?.charter || song.chart?.creator || ""}`.toLocaleLowerCase();
      const searchOkay = !needle || haystack.includes(needle);
      const keyOkay = keyMode === "all" || songKeyMode(song) === Number(keyMode);
      return searchOkay && keyOkay && matchesScope(song, scope);
    });
  }

  function sortRows(rows) {
    const favoriteSet = favorites();
    return [...rows].sort((a, b) => {
      if (runtime.favoritesFirst) {
        const favoriteDifference = Number(favoriteSet.has(b.folder)) - Number(favoriteSet.has(a.folder));
        if (favoriteDifference) return favoriteDifference;
      }
      if (runtime.sort === "za") return -naturalCompare(a, b);
      if (runtime.sort === "attempts") return Number(b.attempt_count || 0) - Number(a.attempt_count || 0) || naturalCompare(a, b);
      if (runtime.sort === "recent") return latestStamp(b) - latestStamp(a) || naturalCompare(a, b);
      if (runtime.sort === "imported") return importedStamp(b) - importedStamp(a) || naturalCompare(a, b);
      if (runtime.sort === "mode") return songKeyMode(a) - songKeyMode(b) || naturalCompare(a, b);
      return naturalCompare(a, b);
    });
  }

  function visibleRows(rows = allSongs()) { return sortRows(filterRows(rows)); }
  function scopeCount(scope) { return allSongs().filter(song => matchesScope(song, scope)).length; }

  function exceptionalPills(song) {
    const pills = [];
    const media = mediaInfo(song);
    if (!song.has_chart) pills.push('<span class="pill warn">No chart</span>');
    else if (!media.any) pills.push('<span class="pill warn">Missing audio</span>');
    if (importedStamp(song) && Date.now() - importedStamp(song) < 14 * 86400000) pills.push('<span class="pill good">Recent import</span>');
    const warnings = song?.chart?.warnings || song?.compatibility_warnings;
    if (Array.isArray(warnings) && warnings.length) pills.push(`<span class="pill warn">${warnings.length} warning${warnings.length === 1 ? "" : "s"}</span>`);
    return pills.join("");
  }

  function rowHtml(song, selected = false) {
    const summary = song.chart || {};
    const favorite = favorites().has(song.folder);
    const media = mediaInfo(song);
    const source = sourceLabel(song);
    return `<div class="library-row${selected ? " selected" : ""}" data-library-folder="${esc(song.folder)}" role="option" aria-selected="${selected}">
      <button class="library-favorite${favorite ? " active" : ""}" data-library-favorite="${esc(song.folder)}" title="${favorite ? "Remove favorite" : "Add favorite"}">${favorite ? "★" : "☆"}</button>
      <div class="library-song-main"><b>${esc(song.song_name)}</b><small>${esc(summary.artist || summary.mapper || summary.charter || summary.creator || source)}</small></div>
      <div class="library-cell"><b>${summary.key_count ? `${summary.key_count}K` : "—"}</b><small>${Number(summary.base_bpm || 0) ? `${Number(summary.base_bpm).toFixed(1)} BPM` : ""}</small></div>
      <div class="library-cell"><b>${Number(song.attempt_count || 0)}</b><small>attempt${Number(song.attempt_count || 0) === 1 ? "" : "s"}</small></div>
      <div class="library-cell"><b>${summary.duration_ms ? durationText(summary.duration_ms) : "—"}</b><small>${esc(source)}</small></div>
      <div class="library-state">${exceptionalPills(song)}${media.any ? '<span class="pill">Audio</span>' : ""}</div>
    </div>`;
  }

  function cardHtml(song, selected = false) {
    const summary = song.chart || {};
    const favorite = favorites().has(song.folder);
    return `<article class="library-card${selected ? " selected" : ""}" data-library-folder="${esc(song.folder)}" tabindex="0">
      <div style="display:flex;justify-content:space-between;gap:8px"><div class="library-card-title ril-clamp-2">${esc(song.song_name)}</div><button class="library-favorite${favorite ? " active" : ""}" data-library-favorite="${esc(song.folder)}">${favorite ? "★" : "☆"}</button></div>
      <div class="library-card-meta">${summary.key_count ? `${summary.key_count}K · ` : ""}${Number(summary.base_bpm || 0) ? `${Number(summary.base_bpm).toFixed(1)} BPM · ` : ""}${summary.duration_ms ? durationText(summary.duration_ms) : sourceLabel(song)}</div>
      <div class="library-card-bottom"><div class="library-state">${exceptionalPills(song)}</div><small class="list-sub">${Number(song.attempt_count || 0)} attempt${Number(song.attempt_count || 0) === 1 ? "" : "s"}</small></div>
    </article>`;
  }

  function openTarget(folder, target) {
    if (!folder) return;
    if (target === "details") return window.openSongModal?.(folder);
    const selector = target === "practice" ? "#practiceSongSelect" : target === "analysis" ? "#analysisSongSelect" : "#visualizerSongSelect";
    const select = q(selector);
    if (select) {
      select.value = folder;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    window.go?.(target);
  }

  function inspectorHtml(song) {
    if (!song) return '<div class="library-inspector-empty">Select a song to see its actions and useful details.</div>';
    const summary = song.chart || {};
    const media = mediaInfo(song);
    const mapper = summary.mapper || summary.charter || summary.creator || summary.artist || "Unknown creator";
    return `<div><div class="eyebrow">Selected song</div><h2 class="ril-clamp-2">${esc(song.song_name)}</h2><div class="list-sub ril-clamp-1">${esc(mapper)} · ${esc(sourceLabel(song))}</div>
      <div class="library-inspector-meta">${summary.key_count ? `<span class="pill">${summary.key_count}K</span>` : ""}${summary.base_bpm ? `<span class="pill">${Number(summary.base_bpm).toFixed(1)} BPM</span>` : ""}${media.any ? '<span class="pill good">Audio available</span>' : '<span class="pill warn">No audio</span>'}</div>
      <div class="library-inspector-actions"><button class="button primary" data-library-action="practice" ${song.has_chart ? "" : "disabled"}>Practice</button><button class="button" data-library-action="visualizer" ${song.has_chart ? "" : "disabled"}>Visualizer</button><button class="button" data-library-action="analysis" ${song.has_chart ? "" : "disabled"}>Analysis</button><button class="button" data-library-action="details">Details</button></div>
      <div class="library-inspector-block"><div class="library-inspector-grid"><div class="library-inspector-stat"><span>Attempts</span><b>${Number(song.attempt_count || 0)}</b></div><div class="library-inspector-stat"><span>Duration</span><b>${summary.duration_ms ? durationText(summary.duration_ms) : "—"}</b></div><div class="library-inspector-stat"><span>Notes</span><b>${Number(summary.player_notes || 0).toLocaleString()}</b></div><div class="library-inspector-stat"><span>Media</span><b>${media.instrumental ? "Inst" : "—"}${media.vocals ? " + Vocals" : ""}</b></div></div></div>
      ${exceptionalPills(song) ? `<div class="library-inspector-block"><div class="library-state" style="justify-content:flex-start">${exceptionalPills(song)}</div></div>` : ""}
    </div>`;
  }

  function railHtml() {
    const sourceRows = [["source:fnf","FNF"],["source:osu","osu!mania"],["source:quaver","Quaver"],["source:ril","Portable RIL"]];
    const modeRows = [4,5,6,7,8,9].map(mode => [`key:${mode}`, `${mode}K`]);
    const collections = collectionRows().map(row => [`collection:${row.id}`, row.name]);
    const scopeButton = (scope, label, customCount = null) => `<button class="library-scope${runtime.scope === scope ? " active" : ""}" data-library-scope="${esc(scope)}"><span class="ril-clamp-1">${esc(label)}</span><small>${customCount ?? scopeCount(scope)}</small></button>`;
    const modeButton = ([scope, label]) => {
      const mode = Number(scope.split(":")[1]);
      const count = allSongs().filter(song => songKeyMode(song) === mode).length;
      return `<button class="library-scope${runtime.keyMode === String(mode) ? " active" : ""}" data-library-mode="${mode}"><span>${label}</span><small>${count}</small></button>`;
    };
    return `<div class="library-rail-group"><div class="library-rail-label">Library</div>${scopeButton("all","All songs")}${scopeButton("favorites","Favorites")}${scopeButton("recent","Recently played")}${scopeButton("imported","Recently imported")}${scopeButton("attempts","With attempts")}${scopeButton("unplayed","Unplayed")}</div>
      <div class="library-rail-group"><div class="library-rail-label">Source</div>${sourceRows.map(([scope,label]) => scopeButton(scope,label)).join("")}</div>
      <div class="library-rail-group"><div class="library-rail-label">Key mode</div>${modeRows.map(modeButton).join("")}</div>
      <div class="library-rail-group"><div class="library-rail-label">Media</div>${scopeButton("media:audio","Audio available")}${scopeButton("media:missing","Missing audio")}</div>
      ${collections.length ? `<div class="library-rail-group"><div class="library-rail-label">Collections</div>${collections.map(([scope,label]) => scopeButton(scope,label,collectionFolders(scope.slice(11)).size)).join("")}</div>` : ""}`;
  }

  function installMainLibrary() {
    if (runtime.installedMain) return true;
    const root = q("#songLibrary");
    const view = q("#view-songs");
    const search = q("#songSearch");
    if (!root || !view || !search) return false;
    runtime.installedMain = true;

    const shell = document.createElement("div");
    shell.id = "songLibraryShell";
    shell.className = "library-shell";
    shell.innerHTML = `<aside id="songLibraryRail" class="library-rail"></aside><section class="library-main"><div class="library-toolbar" id="songLibraryToolbar"></div><div class="library-summary"><span id="songLibraryCount">0 songs</span><span>↑ ↓ select · Enter details</span></div><div id="songLibraryResults" class="library-results" role="listbox" tabindex="0"></div></section><aside id="songLibraryInspector" class="library-inspector"></aside>`;
    root.replaceWith(shell);
    const toolbar = q("#songLibraryToolbar");
    search.placeholder = "Search titles, artists, mappers…";
    toolbar.appendChild(search);
    toolbar.insertAdjacentHTML("beforeend", `<select id="songLibrarySort"><option value="az">Name A–Z</option><option value="za">Name Z–A</option><option value="recent">Recently played</option><option value="imported">Recently imported</option><option value="attempts">Most attempts</option><option value="mode">Key mode</option></select><select id="songLibraryMode"><option value="all">All key modes</option><option value="4">4K</option><option value="5">5K</option><option value="6">6K</option><option value="7">7K</option><option value="8">8K</option><option value="9">9K</option></select><div class="ril-segmented"><button class="button small" data-library-view="compact">List</button><button class="button small" data-library-view="comfortable">Cards</button></div>`);
    q("#songLibrarySort").value = runtime.sort;
    q("#songLibraryMode").value = runtime.keyMode;
    search.addEventListener("input", event => { runtime.query = event.target.value; renderMain(); });
    q("#songLibrarySort").addEventListener("change", event => { runtime.sort = event.target.value; savePreferences(); renderMain(); });
    q("#songLibraryMode").addEventListener("change", event => { runtime.keyMode = event.target.value; savePreferences(); renderMain(); });
    qa("[data-library-view]", toolbar).forEach(button => button.addEventListener("click", () => {
      runtime.view = button.dataset.libraryView;
      savePreferences(); renderMain();
    }));
    q("#songLibraryResults").addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); selectRelative(event.key === "ArrowDown" ? 1 : -1, q("#songLibraryResults"));
      } else if (event.key === "Enter" && runtime.selectedFolder) {
        event.preventDefault(); window.openSongModal?.(runtime.selectedFolder);
      }
    });

    const head = q("#view-songs .page-head");
    if (head) {
      q(".eyebrow", head).textContent = "Local library";
      q("h1", head).textContent = "Songs";
      q("p", head).textContent = "Browse, filter, and launch hundreds of charts without turning every song into a wall of metadata.";
    }
    renderMain();
    return true;
  }

  function bindLibraryNodes(root) {
    qa("[data-library-folder]", root).forEach(node => {
      const folder = node.dataset.libraryFolder;
      node.addEventListener("click", event => {
        if (event.target.closest("[data-library-favorite]")) return;
        runtime.selectedFolder = folder;
        renderMain(false);
      });
      node.addEventListener("dblclick", event => {
        if (!event.target.closest("[data-library-favorite]")) window.openSongModal?.(folder);
      });
      node.addEventListener("keydown", event => {
        if (event.key === "Enter") window.openSongModal?.(folder);
      });
    });
    qa("[data-library-favorite]", root).forEach(button => button.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); toggleFavorite(button.dataset.libraryFavorite);
    }));
  }

  function renderMain(resetSelection = false) {
    if (!installMainLibrary()) return;
    const rows = visibleRows();
    if (resetSelection || (runtime.selectedFolder && !rows.some(song => song.folder === runtime.selectedFolder))) runtime.selectedFolder = null;
    if (!runtime.selectedFolder && rows.length) runtime.selectedFolder = rows[0].folder;
    q("#songLibraryRail").innerHTML = railHtml();
    q("#songLibraryCount").textContent = `${rows.length.toLocaleString()} song${rows.length === 1 ? "" : "s"}`;
    q("#songLibrarySort").value = runtime.sort;
    q("#songLibraryMode").value = runtime.keyMode;
    qa("[data-library-view]").forEach(button => button.classList.toggle("active", button.dataset.libraryView === runtime.view));
    const results = q("#songLibraryResults");
    results.innerHTML = rows.length
      ? `<div class="${runtime.view === "comfortable" ? "library-comfortable" : "library-list"}">${rows.map(song => runtime.view === "comfortable" ? cardHtml(song, song.folder === runtime.selectedFolder) : rowHtml(song, song.folder === runtime.selectedFolder)).join("")}</div>`
      : '<div class="empty">No songs match these library filters.</div>';
    bindLibraryNodes(results);
    q("#songLibraryInspector").innerHTML = inspectorHtml(rows.find(song => song.folder === runtime.selectedFolder) || allSongs().find(song => song.folder === runtime.selectedFolder));
    qa("[data-library-action]", q("#songLibraryInspector")).forEach(button => button.addEventListener("click", () => openTarget(runtime.selectedFolder, button.dataset.libraryAction)));
    qa("[data-library-scope]", q("#songLibraryRail")).forEach(button => button.addEventListener("click", () => {
      runtime.scope = button.dataset.libraryScope;
      runtime.keyMode = "all";
      savePreferences(); renderMain(true);
    }));
    qa("[data-library-mode]", q("#songLibraryRail")).forEach(button => button.addEventListener("click", () => {
      runtime.scope = "all";
      runtime.keyMode = String(button.dataset.libraryMode);
      savePreferences(); renderMain(true);
    }));
  }

  function selectedRow(root) { return q("[data-library-folder].selected", root); }

  function selectRelative(delta, root) {
    const rows = qa("[data-library-folder]", root);
    if (!rows.length) return;
    let index = Math.max(0, rows.indexOf(selectedRow(root)));
    index = Math.max(0, Math.min(rows.length - 1, index + delta));
    rows.forEach((row, rowIndex) => {
      row.classList.toggle("selected", rowIndex === index);
      row.setAttribute("aria-selected", rowIndex === index ? "true" : "false");
    });
    runtime.selectedFolder = rows[index].dataset.libraryFolder;
    rows[index].scrollIntoView({ block: "nearest" });
    if (root.id === "songLibraryResults") {
      const song = allSongs().find(item => item.folder === runtime.selectedFolder);
      q("#songLibraryInspector").innerHTML = inspectorHtml(song);
      qa("[data-library-action]", q("#songLibraryInspector")).forEach(button => button.addEventListener("click", () => openTarget(runtime.selectedFolder, button.dataset.libraryAction)));
    }
  }

  function pickerScopeOptions() {
    const base = [
      ["all", "All songs"], ["favorites", "Favorites"], ["recent", "Recently played"],
      ["imported", "Recently imported"], ["attempts", "With attempts"], ["unplayed", "Unplayed"],
      ["source:fnf", "Source · FNF"], ["source:osu", "Source · osu!mania"],
      ["source:quaver", "Source · Quaver"], ["source:ril", "Source · Portable RIL"],
      ["media:audio", "Media · Audio available"], ["media:missing", "Media · Missing audio"],
    ];
    const collections = collectionRows().map(row => [`collection:${row.id}`, `Collection · ${row.name}`]);
    return [...base, ...collections];
  }

  function syncPickerScopeOptions() {
    const select = q("#songPickerScope");
    if (!select) return;
    const rows = pickerScopeOptions();
    select.innerHTML = rows.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("");
    if (!rows.some(([value]) => value === runtime.scope)) runtime.scope = "all";
    select.value = runtime.scope;
  }

  /* Shared modal picker for Practice, Visualizer, and Analysis. */
  function installPicker() {
    if (q("#songPickerModal")) return;
    const modal = document.createElement("div");
    modal.id = "songPickerModal";
    modal.className = "song-picker-modal";
    modal.innerHTML = `<div class="song-picker-dialog card"><div class="song-picker-head"><div><div class="eyebrow">Shared song library</div><h2>Choose a song</h2><p id="songPickerCaption">Use the same library organization everywhere.</p></div><button id="songPickerClose" class="icon-button" title="Close">×</button></div><div class="song-picker-controls"><input id="songPickerSearch" placeholder="Search titles, artists, mappers…" autocomplete="off"><select id="songPickerScope" title="Library view"></select><select id="songPickerSort"><option value="az">Name A–Z</option><option value="za">Name Z–A</option><option value="recent">Recently played</option><option value="imported">Recently imported</option><option value="attempts">Most attempts</option><option value="mode">Key mode</option></select><select id="songPickerMode"><option value="all">All modes</option><option value="4">4K</option><option value="5">5K</option><option value="6">6K</option><option value="7">7K</option><option value="8">8K</option><option value="9">9K</option></select><button id="songPickerFavorites" class="button small">Favorites first</button></div><div class="song-picker-summary"><span id="songPickerCount">0 songs</span><span>↑ ↓ Enter</span></div><div id="songPickerRows" class="song-picker-rows" role="listbox" tabindex="0"></div></div>`;
    document.body.appendChild(modal);
    syncPickerScopeOptions();
    q("#songPickerClose").addEventListener("click", closePicker);
    modal.addEventListener("pointerdown", event => { if (event.target === modal) closePicker(); });
    q("#songPickerSearch").addEventListener("input", event => { runtime.query = event.target.value; renderPicker(); });
    q("#songPickerScope").addEventListener("change", event => { runtime.scope = event.target.value; savePreferences(); renderPicker(); });
    q("#songPickerSort").addEventListener("change", event => { runtime.sort = event.target.value; savePreferences(); renderPicker(); });
    q("#songPickerMode").addEventListener("change", event => { runtime.keyMode = event.target.value; savePreferences(); renderPicker(); });
    q("#songPickerFavorites").addEventListener("click", () => { runtime.favoritesFirst = !runtime.favoritesFirst; savePreferences(); renderPicker(); });
    q("#songPickerRows").addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); closePicker(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); selectRelative(event.key === "ArrowDown" ? 1 : -1, q("#songPickerRows")); }
      else if (event.key === "Enter") { const row = selectedRow(q("#songPickerRows")); if (row) { event.preventDefault(); choose(row.dataset.libraryFolder); } }
    });
  }

  function targetLabel() { return runtime.target === "practice" ? "Practice" : runtime.target === "analysis" ? "Analysis" : "Visualizer"; }

  function openPicker(target = "visualizer") {
    installPicker();
    runtime.target = target;
    runtime.query = "";
    q("#songPickerSearch").value = "";
    syncPickerScopeOptions();
    q("#songPickerCaption").textContent = `Choose a chart for ${targetLabel()}. Library views, sorting, favorites, and key filters match Songs.`;
    q("#songPickerModal").classList.add("open");
    renderPicker();
    requestAnimationFrame(() => q("#songPickerSearch")?.focus());
  }

  function closePicker() { q("#songPickerModal")?.classList.remove("open"); }

  function renderPicker() {
    installPicker();
    syncPickerScopeOptions();
    const rows = sortRows(filterRows(pickerSongs(), { query: runtime.query, scope: runtime.scope, keyMode: runtime.keyMode }));
    q("#songPickerScope").value = runtime.scope;
    q("#songPickerSort").value = runtime.sort;
    q("#songPickerMode").value = runtime.keyMode;
    q("#songPickerFavorites").classList.toggle("primary", runtime.favoritesFirst);
    q("#songPickerFavorites").textContent = runtime.favoritesFirst ? "Favorites first" : "Mixed favorites";
    q("#songPickerCount").textContent = `${rows.length} song${rows.length === 1 ? "" : "s"}`;
    const root = q("#songPickerRows");
    root.innerHTML = rows.length ? rows.map((song, index) => rowHtml(song, index === 0)).join("") : '<div class="empty">No playable charts match these filters.</div>';
    qa("[data-library-folder]", root).forEach(row => row.addEventListener("click", event => { if (!event.target.closest("[data-library-favorite]")) choose(row.dataset.libraryFolder); }));
    qa("[data-library-favorite]", root).forEach(button => button.addEventListener("click", event => { event.stopPropagation(); toggleFavorite(button.dataset.libraryFavorite); }));
  }

  function choose(folder) {
    if (!folder) return;
    const target = runtime.target || "visualizer";
    const selector = target === "practice" ? "#practiceSongSelect" : target === "analysis" ? "#analysisSongSelect" : "#visualizerSongSelect";
    const select = q(selector);
    if (select) {
      select.value = folder;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    closePicker();
  }

  function naturalSortSelect(select) {
    if (!select || select.dataset.songPickerSorting === "1") return;
    const placeholder = [...select.options].find(option => !option.value);
    const current = select.value;
    const existing = [...select.options].filter(option => option.value);
    const sorted = [...existing].sort((a, b) => a.textContent.localeCompare(b.textContent, undefined, { numeric: true, sensitivity: "base" }));
    const actual = existing.map(option => `${option.value}:${option.textContent}`).join("|");
    const desired = sorted.map(option => `${option.value}:${option.textContent}`).join("|");
    if (actual === desired) return;
    select.dataset.songPickerSorting = "1";
    select.innerHTML = "";
    if (placeholder) select.appendChild(placeholder);
    sorted.forEach(option => select.appendChild(option));
    select.value = current;
    select.dataset.songPickerSorting = "0";
  }

  function addBrowseButton(select, target) {
    if (!select || q(`[data-song-picker-target="${target}"]`, select.parentElement)) return;
    const button = document.createElement("button");
    button.className = "button small song-picker-open";
    button.dataset.songPickerTarget = target;
    button.textContent = "Browse songs";
    button.addEventListener("click", () => openPicker(target));
    select.insertAdjacentElement("afterend", button);
  }

  function installControls() {
    const visual = q("#visualizerSongSelect");
    const practice = q("#practiceSongSelect");
    const analysis = q("#analysisSongSelect");
    naturalSortSelect(visual); naturalSortSelect(practice); naturalSortSelect(analysis);
    addBrowseButton(visual, "visualizer"); addBrowseButton(practice, "practice"); addBrowseButton(analysis, "analysis");
  }

  installPicker();
  installMainLibrary();

  /* Replace only the Songs presentation; refreshSongs still owns data loading. */
  if (typeof renderSongs === "function") renderSongs = renderMain;

  window.rilSongBrowser = {
    render: renderMain,
    open: openPicker,
    choose,
    filterRows,
    sortRows,
    sourceKey,
    mediaInfo,
    toggleFavorite,
    state: runtime,
  };
  window.rilSongPicker = { open: openPicker, close: closePicker, render: renderPicker, choose };

  function tick() {
    installMainLibrary();
    installControls();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
