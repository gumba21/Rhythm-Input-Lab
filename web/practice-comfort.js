"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const engine = window.rilPracticeEngine;
  if (!engine?.practice || !engine?.setPracticeRange || !engine?.seekPractice) {
    console.warn("Practice Comfort could not find the playable Practice engine.");
    return;
  }

  const STORAGE_KEY = "ril-practice-comfort:v1";
  const MAX_ATTEMPTS = 250;
  const MAX_RECENT = 12;
  const commonTags = ["first attempt", "warmed up", "tired", "keyboard issue", "PB", "late night", "experimental"];
  const runtime = {
    observedFolder: null,
    observedAttempt: null,
    applyingSettings: false,
    pendingSetup: null,
    selectedAttemptId: null,
    activeCollectionId: null,
    activeCollectionIndex: -1,
    renderQueued: false,
  };

  function defaults() {
    return {
      version: 1,
      useGlobalSettings: true,
      globalSettings: null,
      favorites: [],
      recent: [],
      presets: {},
      goals: {},
      collections: [],
      attempts: [],
    };
  }

  function readStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return defaults();
      const base = defaults();
      return {
        ...base,
        ...parsed,
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        recent: Array.isArray(parsed.recent) ? parsed.recent : [],
        presets: parsed.presets && typeof parsed.presets === "object" ? parsed.presets : {},
        goals: parsed.goals && typeof parsed.goals === "object" ? parsed.goals : {},
        collections: Array.isArray(parsed.collections) ? parsed.collections : [],
        attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      };
    } catch (error) {
      console.warn("Could not read Practice Comfort data", error);
      return defaults();
    }
  }

  let store = readStore();

  function persist() {
    try {
      store.attempts = store.attempts.slice(0, MAX_ATTEMPTS);
      store.recent = store.recent.slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
      notify("Practice Comfort could not save more local history.", "error");
      console.warn(error);
    }
  }

  function notify(message, type = "info") {
    if (typeof toast === "function") toast(message, type, 5000);
    else console.log(message);
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatTime(ms, digits = 3) {
    if (typeof engine.formatPracticeTime === "function") return engine.formatPracticeTime(ms, digits);
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(digits).padStart(digits + 3, "0")}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Unknown date";
    return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function songName(folder) {
    const found = (window.state?.songs || []).find(song => song.folder === folder);
    return found?.song_name || store.recent.find(item => item.folder === folder)?.songName || folder || "Unknown song";
  }

  function currentSongAttempts() {
    return store.attempts.filter(attempt => attempt.songFolder === engine.practice.songFolder);
  }

  function calculateAccuracy(stats) {
    if (typeof engine.accuracy === "function") return engine.accuracy(stats);
    const hits = Number(stats?.hits || 0);
    const misses = Number(stats?.misses || 0);
    return hits + misses ? Number(stats?.weighted || 0) / (hits + misses) * 100 : null;
  }

  function readCurrentSettings() {
    const p = engine.practice;
    return {
      speed: Number(p.speed || 1),
      leadInMs: Number(p.leadInMs || 1500),
      scrollScale: Number(p.scrollScale || 1),
      downscroll: Boolean(p.downscroll),
      ghostTapping: Boolean(p.ghostTapping),
      loopEnabled: Boolean(p.loopEnabled),
      instrumentalVolume: Number(q("#practiceInstrumentalVolume")?.value ?? 100),
      vocalsVolume: Number(q("#practiceVocalsVolume")?.value ?? 100),
      laneLength: Number(q("#practiceLaneLength")?.value ?? 620),
    };
  }

  function settingsSummary(settings = store.globalSettings) {
    if (!settings) return "Load a song and adjust Practice once; those values will become your defaults.";
    const direction = settings.downscroll ? "downscroll" : "upscroll";
    const ghost = settings.ghostTapping ? "ghost on" : "ghost off";
    const loop = settings.loopEnabled ? "loop on" : "loop off";
    return `${Math.round(settings.speed * 100)}% · ${Number(settings.scrollScale).toFixed(2)}× scroll · ${direction} · ${ghost} · ${loop} · ${settings.leadInMs / 1000}s lead-in · ${settings.laneLength}px lanes`;
  }

  function saveGlobalSettings(showToast = false) {
    if (!engine.practice.bundle || runtime.applyingSettings) return;
    store.globalSettings = readCurrentSettings();
    persist();
    renderGlobalSettings();
    if (showToast) notify("Current Practice settings will now be used for every song.");
  }

  function clickToggle(selector, desired, current) {
    if (Boolean(desired) !== Boolean(current)) q(selector)?.click();
  }

  function dispatchValue(selector, value, eventName = "change") {
    const input = q(selector);
    if (!input || value === undefined || value === null) return;
    input.value = String(value);
    input.dispatchEvent(new Event(eventName, { bubbles: true }));
  }

  function setSpeed(speed) {
    const requested = Number(speed || 1);
    const button = qa(".practice-speed").find(node => Math.abs(Number(node.dataset.speed) - requested) < 0.001);
    if (button) button.click();
  }

  function applySettings(settings, { saveAsGlobal = false } = {}) {
    if (!settings || !engine.practice.bundle) return;
    runtime.applyingSettings = true;
    try {
      setSpeed(settings.speed);
      dispatchValue("#practiceLeadIn", settings.leadInMs, "change");
      dispatchValue("#practiceScrollSpeed", settings.scrollScale, "input");
      clickToggle("#practiceDownscrollToggle", settings.downscroll, engine.practice.downscroll);
      clickToggle("#practiceGhostToggle", settings.ghostTapping, engine.practice.ghostTapping);
      clickToggle("#practiceLoopToggle", settings.loopEnabled, engine.practice.loopEnabled);
      dispatchValue("#practiceInstrumentalVolume", settings.instrumentalVolume, "input");
      dispatchValue("#practiceVocalsVolume", settings.vocalsVolume, "input");
      dispatchValue("#practiceLaneLength", settings.laneLength, "input");
      if (saveAsGlobal) {
        store.globalSettings = readCurrentSettings();
        persist();
      }
    } finally {
      setTimeout(() => { runtime.applyingSettings = false; }, 0);
    }
  }

  function applyGlobalSettings() {
    if (!store.useGlobalSettings || !store.globalSettings || !engine.practice.bundle) return;
    applySettings(store.globalSettings);
  }

  function touchRecent(folder, attemptDelta = 0) {
    if (!folder) return;
    const current = store.recent.find(item => item.folder === folder) || {
      folder,
      songName: songName(folder),
      attempts: 0,
      lastOpened: new Date().toISOString(),
    };
    current.songName = songName(folder);
    current.lastOpened = new Date().toISOString();
    current.attempts = Math.max(0, Number(current.attempts || 0) + attemptDelta);
    store.recent = [current, ...store.recent.filter(item => item.folder !== folder)].slice(0, MAX_RECENT);
    persist();
  }

  function loadSong(folder, pendingSetup = null) {
    if (!folder) return;
    runtime.pendingSetup = pendingSetup;
    const select = q("#practiceSongSelect");
    if (!select) return;
    select.value = folder;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applySetup(setup) {
    if (!setup || !engine.practice.bundle) return;
    if (setup.settings) applySettings(setup.settings);
    if (Number.isFinite(Number(setup.startMs)) && Number.isFinite(Number(setup.endMs))) {
      engine.setPracticeRange(Number(setup.startMs), Number(setup.endMs), setup.name || setup.label || "Saved setup");
      engine.seekPractice(Number(setup.startMs));
      const mode = q("#practiceRangeMode");
      if (mode) mode.value = "custom";
    }
  }

  function toggleFavorite() {
    const folder = engine.practice.songFolder;
    if (!folder) return;
    if (store.favorites.includes(folder)) store.favorites = store.favorites.filter(item => item !== folder);
    else store.favorites.unshift(folder);
    persist();
    renderAll();
  }

  function savePreset() {
    const p = engine.practice;
    if (!p.bundle) return notify("Load a song before saving a Practice setup.", "error");
    const input = q("#comfortPresetName");
    const automatic = `${formatTime(p.startMs)}–${formatTime(p.endMs)} · ${Math.round(p.speed * 100)}%`;
    const name = String(input?.value || "").trim() || automatic;
    const preset = {
      id: uid("preset"),
      name,
      songFolder: p.songFolder,
      songName: p.songName,
      startMs: p.startMs,
      endMs: p.endMs,
      settings: readCurrentSettings(),
      createdAt: new Date().toISOString(),
    };
    const rows = Array.isArray(store.presets[p.songFolder]) ? store.presets[p.songFolder] : [];
    store.presets[p.songFolder] = [preset, ...rows].slice(0, 40);
    if (input) input.value = "";
    persist();
    renderPresets();
    notify(`Saved “${name}”.`);
  }

  function loadPreset(id) {
    const preset = Object.values(store.presets).flat().find(item => item.id === id);
    if (!preset) return;
    if (engine.practice.songFolder !== preset.songFolder) loadSong(preset.songFolder, preset);
    else applySetup(preset);
  }

  function deletePreset(id) {
    for (const [folder, rows] of Object.entries(store.presets)) {
      store.presets[folder] = rows.filter(item => item.id !== id);
    }
    persist();
    renderPresets();
  }

  function saveGoal() {
    const folder = engine.practice.songFolder;
    if (!folder) return notify("Load a song before setting a goal.", "error");
    const accuracy = clamp(q("#comfortGoalAccuracy")?.value || 0, 0, 100);
    const misses = Math.max(0, Math.round(Number(q("#comfortGoalMisses")?.value || 0)));
    const speed = clamp(q("#comfortGoalSpeed")?.value || 1, 0.5, 1.25);
    store.goals[folder] = {
      accuracy,
      maxMisses: misses,
      speed,
      updatedAt: new Date().toISOString(),
    };
    persist();
    renderGoal();
    notify("Song goal saved.");
  }

  function clearGoal() {
    const folder = engine.practice.songFolder;
    if (!folder) return;
    delete store.goals[folder];
    persist();
    renderGoal();
  }

  function createCollection() {
    const input = q("#comfortCollectionName");
    const name = String(input?.value || "").trim();
    if (!name) return notify("Give the collection a name first.", "error");
    const collection = { id: uid("collection"), name, items: [], createdAt: new Date().toISOString() };
    store.collections.unshift(collection);
    if (input) input.value = "";
    persist();
    renderCollections(collection.id);
    notify(`Created “${name}”.`);
  }

  function selectedCollection() {
    const id = q("#comfortCollectionSelect")?.value;
    return store.collections.find(collection => collection.id === id) || store.collections[0] || null;
  }

  function addCurrentToCollection() {
    const collection = selectedCollection();
    const p = engine.practice;
    if (!collection) return notify("Create a collection first.", "error");
    if (!p.bundle) return notify("Load a song before adding a range.", "error");
    const labelInput = q("#comfortCollectionItemLabel");
    const label = String(labelInput?.value || "").trim() || `${p.songName} · ${formatTime(p.startMs)}–${formatTime(p.endMs)}`;
    collection.items.push({
      id: uid("item"),
      label,
      songFolder: p.songFolder,
      songName: p.songName,
      startMs: p.startMs,
      endMs: p.endMs,
      settings: readCurrentSettings(),
    });
    if (labelInput) labelInput.value = "";
    persist();
    renderCollections(collection.id);
    notify(`Added “${label}” to ${collection.name}.`);
  }

  function removeCollectionItem(collectionId, itemId) {
    const collection = store.collections.find(row => row.id === collectionId);
    if (!collection) return;
    collection.items = collection.items.filter(item => item.id !== itemId);
    persist();
    renderCollections(collectionId);
  }

  function deleteCollection(id) {
    store.collections = store.collections.filter(collection => collection.id !== id);
    if (runtime.activeCollectionId === id) stopCollectionQueue();
    persist();
    renderCollections();
  }

  function loadCollectionItem(collectionId, itemId) {
    const collection = store.collections.find(row => row.id === collectionId);
    const item = collection?.items.find(row => row.id === itemId);
    if (!item) return;
    if (engine.practice.songFolder !== item.songFolder) loadSong(item.songFolder, { ...item, name: item.label });
    else applySetup({ ...item, name: item.label });
  }

  function startCollectionQueue() {
    const collection = selectedCollection();
    if (!collection?.items.length) return notify("This collection does not contain any Practice ranges yet.", "error");
    runtime.activeCollectionId = collection.id;
    runtime.activeCollectionIndex = 0;
    loadQueueItem();
    renderQueue();
  }

  function stopCollectionQueue() {
    runtime.activeCollectionId = null;
    runtime.activeCollectionIndex = -1;
    renderQueue();
  }

  function loadQueueItem() {
    const collection = store.collections.find(row => row.id === runtime.activeCollectionId);
    const item = collection?.items[runtime.activeCollectionIndex];
    if (!item) return stopCollectionQueue();
    loadCollectionItem(collection.id, item.id);
    notify(`Collection ${runtime.activeCollectionIndex + 1}/${collection.items.length}: ${item.label}`);
  }

  function nextCollectionItem() {
    const collection = store.collections.find(row => row.id === runtime.activeCollectionId);
    if (!collection) return stopCollectionQueue();
    runtime.activeCollectionIndex += 1;
    if (runtime.activeCollectionIndex >= collection.items.length) {
      notify(`Finished the “${collection.name}” collection.`);
      stopCollectionQueue();
      return;
    }
    loadQueueItem();
    renderQueue();
  }

  function attemptRecord(snapshot) {
    const value = calculateAccuracy(snapshot.stats);
    return {
      id: snapshot.completedAt || uid("attempt"),
      songFolder: snapshot.songFolder,
      songName: snapshot.songName,
      startMs: Number(snapshot.startMs || 0),
      endMs: Number(snapshot.endMs || 0),
      speed: Number(snapshot.speed || 1),
      keyCount: Number(snapshot.keyCount || 4),
      accuracy: value,
      misses: Number(snapshot.stats?.misses || 0),
      extras: Number(snapshot.stats?.extras || 0),
      maxCombo: Number(snapshot.stats?.maxCombo || 0),
      holdDrops: Number(snapshot.stats?.holdDrops || 0),
      hazardsHit: Number(snapshot.stats?.hazardsHit || 0),
      judgments: { ...(snapshot.stats?.judgments || {}) },
      durationMs: Math.max(0, (Number(snapshot.endMs || 0) - Number(snapshot.startMs || 0)) / Math.max(0.01, Number(snapshot.speed || 1))),
      completedAt: snapshot.completedAt || new Date().toISOString(),
      tags: [],
      notes: "",
    };
  }

  function recordAttempt(snapshot) {
    if (!snapshot?.completedAt || store.attempts.some(row => row.id === snapshot.completedAt)) return;
    const record = attemptRecord(snapshot);
    const previous = store.attempts.filter(row => row.songFolder === record.songFolder && Number.isFinite(row.accuracy));
    const previousBest = previous.length ? Math.max(...previous.map(row => Number(row.accuracy))) : -Infinity;
    if (Number.isFinite(record.accuracy) && record.accuracy > previousBest) record.tags.push("PB");
    store.attempts.unshift(record);
    runtime.selectedAttemptId = record.id;
    touchRecent(record.songFolder, 1);
    persist();
    renderAll();
  }

  function selectAttempt(id) {
    runtime.selectedAttemptId = id;
    renderAttemptEditor();
  }

  function saveAttemptNotes() {
    const attempt = store.attempts.find(row => row.id === runtime.selectedAttemptId);
    if (!attempt) return;
    const tags = String(q("#comfortAttemptTags")?.value || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);
    attempt.tags = [...new Set(tags)].slice(0, 12);
    attempt.notes = String(q("#comfortAttemptNotes")?.value || "").trim().slice(0, 2000);
    persist();
    renderAttempts();
    notify("Attempt notes saved.");
  }

  function toggleAttemptTag(tag) {
    const attempt = store.attempts.find(row => row.id === runtime.selectedAttemptId);
    if (!attempt) return;
    const tags = new Set(attempt.tags || []);
    if (tags.has(tag)) tags.delete(tag);
    else tags.add(tag);
    attempt.tags = [...tags];
    persist();
    renderAttemptEditor();
    renderAttemptList();
  }

  function deleteAttempt(id) {
    store.attempts = store.attempts.filter(row => row.id !== id);
    if (runtime.selectedAttemptId === id) runtime.selectedAttemptId = store.attempts[0]?.id || null;
    persist();
    renderAttempts();
  }

  function installView() {
    if (q("#practiceComfort")) return;
    const workspace = q("#view-practice .practice-workspace");
    if (!workspace) return;

    const favorite = document.createElement("button");
    favorite.id = "practiceFavoriteButton";
    favorite.className = "button small practice-favorite-button";
    favorite.title = "Favorite this song";
    favorite.textContent = "☆ Favorite";
    q("#view-practice .practice-head-actions")?.prepend(favorite);

    const section = document.createElement("section");
    section.id = "practiceComfort";
    section.className = "practice-comfort card";
    section.innerHTML = `
      <div class="practice-comfort-head">
        <div><div class="eyebrow">4.6.2 Comfort update</div><h2>Practice library</h2><p>Defaults, saved setups, goals, collections, and attempt history stay on this device.</p></div>
        <div id="comfortQueue" class="comfort-queue"></div>
      </div>
      <div class="practice-comfort-grid">
        <article class="comfort-panel comfort-panel-wide">
          <div class="comfort-panel-head"><div><h3>Quick songs</h3><p>Favorites and recently practiced charts.</p></div></div>
          <div class="comfort-song-columns">
            <div><b class="comfort-label">Favorites</b><div id="comfortFavorites" class="comfort-chip-list"></div></div>
            <div><b class="comfort-label">Recently played</b><div id="comfortRecent" class="comfort-chip-list"></div></div>
          </div>
        </article>
        <article class="comfort-panel">
          <div class="comfort-panel-head"><div><h3>Global Practice defaults</h3><p>Stop fixing scroll, speed, direction, audio, and lane length for every chart.</p></div></div>
          <div class="comfort-actions"><button id="comfortGlobalToggle" class="button small"></button><button id="comfortSaveDefaults" class="button small primary">Use current everywhere</button></div>
          <div id="comfortGlobalSummary" class="comfort-summary"></div>
        </article>
        <article class="comfort-panel">
          <div class="comfort-panel-head"><div><h3>Song goal</h3><p>Track one accuracy/miss target at a chosen speed.</p></div></div>
          <div class="comfort-goal-grid">
            <label>Accuracy<input id="comfortGoalAccuracy" type="number" min="0" max="100" step="0.01" value="96"></label>
            <label>Max misses<input id="comfortGoalMisses" type="number" min="0" step="1" value="15"></label>
            <label>Speed<select id="comfortGoalSpeed"><option value="0.5">50%</option><option value="0.75">75%</option><option value="0.9">90%</option><option value="1" selected>100%</option><option value="1.25">125%</option></select></label>
          </div>
          <div class="comfort-actions"><button id="comfortSaveGoal" class="button small primary">Save goal</button><button id="comfortClearGoal" class="button small">Clear</button></div>
          <div id="comfortGoalStatus" class="comfort-summary"></div>
        </article>
        <article class="comfort-panel">
          <div class="comfort-panel-head"><div><h3>Saved Practice setups</h3><p>Save multiple named ranges with their playback settings.</p></div></div>
          <div class="comfort-inline"><input id="comfortPresetName" placeholder="Finale, left-hand streams…"><button id="comfortSavePreset" class="button small primary">Save current</button></div>
          <div id="comfortPresets" class="comfort-list"></div>
        </article>
        <article class="comfort-panel">
          <div class="comfort-panel-head"><div><h3>Collections</h3><p>Build warmups, songs to learn, or a queue of difficult ranges.</p></div></div>
          <div class="comfort-inline"><input id="comfortCollectionName" placeholder="Warmups"><button id="comfortCreateCollection" class="button small">Create</button></div>
          <div class="comfort-inline"><select id="comfortCollectionSelect"></select><button id="comfortDeleteCollection" class="button small">Delete</button></div>
          <div class="comfort-inline"><input id="comfortCollectionItemLabel" placeholder="Optional range label"><button id="comfortAddCollectionItem" class="button small primary">Add current range</button></div>
          <div class="comfort-actions"><button id="comfortRunCollection" class="button small">Run collection</button><button id="comfortStopCollection" class="button small">Stop queue</button></div>
          <div id="comfortCollectionItems" class="comfort-list"></div>
        </article>
        <article class="comfort-panel comfort-panel-wide">
          <div class="comfort-panel-head"><div><h3>Attempt history and statistics</h3><p>Practice runs are summarized locally so 4.7 can build on real history later.</p></div></div>
          <div id="comfortStats" class="comfort-stat-grid"></div>
          <div class="comfort-attempt-layout"><div id="comfortAttemptList" class="comfort-list comfort-attempt-list"></div><div id="comfortAttemptEditor" class="comfort-attempt-editor"></div></div>
        </article>
      </div>
    `;
    workspace.after(section);

    favorite.addEventListener("click", toggleFavorite);
    q("#comfortGlobalToggle").addEventListener("click", () => {
      store.useGlobalSettings = !store.useGlobalSettings;
      if (store.useGlobalSettings && !store.globalSettings) saveGlobalSettings();
      persist();
      if (store.useGlobalSettings) applyGlobalSettings();
      renderGlobalSettings();
    });
    q("#comfortSaveDefaults").addEventListener("click", () => saveGlobalSettings(true));
    q("#comfortSavePreset").addEventListener("click", savePreset);
    q("#comfortPresetName").addEventListener("keydown", event => { if (event.key === "Enter") savePreset(); });
    q("#comfortSaveGoal").addEventListener("click", saveGoal);
    q("#comfortClearGoal").addEventListener("click", clearGoal);
    q("#comfortCreateCollection").addEventListener("click", createCollection);
    q("#comfortCollectionName").addEventListener("keydown", event => { if (event.key === "Enter") createCollection(); });
    q("#comfortCollectionSelect").addEventListener("change", () => renderCollections(q("#comfortCollectionSelect").value));
    q("#comfortDeleteCollection").addEventListener("click", () => selectedCollection() && deleteCollection(selectedCollection().id));
    q("#comfortAddCollectionItem").addEventListener("click", addCurrentToCollection);
    q("#comfortRunCollection").addEventListener("click", startCollectionQueue);
    q("#comfortStopCollection").addEventListener("click", stopCollectionQueue);

    section.addEventListener("click", event => {
      const button = event.target.closest("button[data-comfort-action]");
      if (!button) return;
      const action = button.dataset.comfortAction;
      if (action === "load-song") loadSong(button.dataset.folder);
      if (action === "load-preset") loadPreset(button.dataset.id);
      if (action === "delete-preset") deletePreset(button.dataset.id);
      if (action === "load-item") loadCollectionItem(button.dataset.collectionId, button.dataset.id);
      if (action === "delete-item") removeCollectionItem(button.dataset.collectionId, button.dataset.id);
      if (action === "select-attempt") selectAttempt(button.dataset.id);
      if (action === "delete-attempt") deleteAttempt(button.dataset.id);
      if (action === "toggle-tag") toggleAttemptTag(button.dataset.tag);
      if (action === "save-attempt") saveAttemptNotes();
      if (action === "next-collection") nextCollectionItem();
      if (action === "stop-collection") stopCollectionQueue();
    });

    installStyles();
    bindGlobalSettingCapture();
    renderAll();
  }

  function bindGlobalSettingCapture() {
    const selectors = new Set(["practiceLeadIn", "practiceScrollSpeed", "practiceDownscrollToggle", "practiceGhostToggle", "practiceLoopToggle", "practiceInstrumentalVolume", "practiceVocalsVolume", "practiceLaneLength"]);
    document.addEventListener("input", event => {
      if (!store.useGlobalSettings || !selectors.has(event.target?.id)) return;
      setTimeout(() => saveGlobalSettings(false), 0);
    }, true);
    document.addEventListener("change", event => {
      if (!store.useGlobalSettings || !selectors.has(event.target?.id)) return;
      setTimeout(() => saveGlobalSettings(false), 0);
    }, true);
    document.addEventListener("click", event => {
      if (!store.useGlobalSettings) return;
      const target = event.target.closest(".practice-speed, #practiceDownscrollToggle, #practiceGhostToggle, #practiceLoopToggle");
      if (target) setTimeout(() => saveGlobalSettings(false), 0);
    }, true);
  }

  function installStyles() {
    if (q("#practiceComfortStyles")) return;
    const style = document.createElement("style");
    style.id = "practiceComfortStyles";
    style.textContent = `
      .practice-comfort{margin-top:16px;padding:16px}.practice-comfort-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.practice-comfort-head h2{margin:2px 0 4px}.practice-comfort-head p,.comfort-panel-head p{margin:0;color:var(--muted);font-size:12px;line-height:1.45}.practice-comfort-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.comfort-panel{padding:13px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.018);min-width:0}.comfort-panel-wide{grid-column:1/-1}.comfort-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.comfort-panel h3{margin:0 0 3px;font-size:14px}.comfort-actions,.comfort-inline{display:flex;align-items:center;gap:7px;margin-top:10px;flex-wrap:wrap}.comfort-inline>*:first-child{flex:1;min-width:120px}.comfort-summary{margin-top:9px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.02);font-size:11px;color:var(--muted);line-height:1.5}.comfort-song-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:11px}.comfort-label{display:block;margin-bottom:6px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.comfort-chip-list{display:flex;gap:6px;flex-wrap:wrap}.comfort-chip{padding:6px 8px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.025);color:var(--text);font-size:11px;cursor:pointer}.comfort-chip:hover{border-color:var(--accent)}.comfort-chip small{color:var(--muted);margin-left:4px}.comfort-goal-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:10px}.comfort-goal-grid label{font-size:10px;color:var(--muted)}.comfort-goal-grid input,.comfort-goal-grid select{display:block;width:100%;margin-top:4px}.comfort-list{display:flex;flex-direction:column;gap:7px;margin-top:10px;max-height:280px;overflow:auto}.comfort-row{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.02)}.comfort-row-main{min-width:0}.comfort-row-main b{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.comfort-row-main span{display:block;margin-top:2px;color:var(--muted);font-size:10px}.comfort-row-actions{display:flex;gap:5px;flex:none}.comfort-row-actions .button{padding:5px 7px}.comfort-stat-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:10px}.comfort-stat{padding:9px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.02)}.comfort-stat span{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.comfort-stat b{display:block;margin-top:4px;font-size:15px}.comfort-attempt-layout{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr);gap:12px;margin-top:11px}.comfort-attempt-list{max-height:360px;margin-top:0}.comfort-attempt-editor{padding:11px;border:1px solid var(--line);border-radius:10px;background:rgba(0,0,0,.12);min-height:180px}.comfort-tag-row{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.comfort-tag{padding:5px 7px;border:1px solid var(--line);border-radius:999px;background:transparent;color:var(--muted);font-size:10px;cursor:pointer}.comfort-tag.active{border-color:var(--accent);background:rgba(117,230,255,.16);color:var(--text)}.comfort-attempt-editor textarea{width:100%;min-height:88px;resize:vertical}.comfort-queue{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.comfort-queue-state{padding:8px 10px;border:1px solid var(--accent);border-radius:9px;background:rgba(117,230,255,.1);font-size:11px}.practice-favorite-button.active{border-color:#ffd166;color:#ffd166;background:rgba(255,209,102,.1)}
      @media(max-width:900px){.practice-comfort-grid{grid-template-columns:1fr}.comfort-panel-wide{grid-column:auto}.comfort-attempt-layout{grid-template-columns:1fr}.comfort-stat-grid{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:560px){.comfort-song-columns{grid-template-columns:1fr}.comfort-goal-grid{grid-template-columns:1fr 1fr}.comfort-stat-grid{grid-template-columns:repeat(2,1fr)}.practice-comfort-head{flex-direction:column}.comfort-row{align-items:flex-start;flex-direction:column}.comfort-row-actions{width:100%;flex-wrap:wrap}}
    `;
    document.head.appendChild(style);
  }

  function renderAll() {
    if (runtime.renderQueued) return;
    runtime.renderQueued = true;
    queueMicrotask(() => {
      runtime.renderQueued = false;
      renderFavoriteButton(); renderQuickSongs(); renderGlobalSettings(); renderPresets(); renderGoal(); renderCollections(); renderAttempts(); renderQueue();
    });
  }

  function renderFavoriteButton() {
    const button = q("#practiceFavoriteButton");
    if (!button) return;
    const favorite = store.favorites.includes(engine.practice.songFolder);
    button.disabled = !engine.practice.songFolder;
    button.classList.toggle("active", favorite);
    button.textContent = favorite ? "★ Favorited" : "☆ Favorite";
  }

  function songChip(folder, suffix = "") {
    return `<button class="comfort-chip" data-comfort-action="load-song" data-folder="${esc(folder)}">${esc(songName(folder))}${suffix ? `<small>${esc(suffix)}</small>` : ""}</button>`;
  }

  function renderQuickSongs() {
    const favorites = q("#comfortFavorites"); const recent = q("#comfortRecent");
    if (!favorites || !recent) return;
    favorites.innerHTML = store.favorites.length ? store.favorites.map(folder => songChip(folder)).join("") : '<span class="list-sub">Favorite a loaded chart to pin it here.</span>';
    recent.innerHTML = store.recent.length ? store.recent.map(item => songChip(item.folder, `${item.attempts || 0} attempts`)).join("") : '<span class="list-sub">Opened songs will appear here.</span>';
  }

  function renderGlobalSettings() {
    const toggle = q("#comfortGlobalToggle"); const summary = q("#comfortGlobalSummary");
    if (!toggle || !summary) return;
    toggle.textContent = `Use across songs: ${store.useGlobalSettings ? "On" : "Off"}`;
    toggle.classList.toggle("primary", store.useGlobalSettings);
    summary.textContent = settingsSummary();
  }

  function renderPresets() {
    const root = q("#comfortPresets"); if (!root) return;
    const folder = engine.practice.songFolder;
    const rows = folder && Array.isArray(store.presets[folder]) ? store.presets[folder] : [];
    root.innerHTML = rows.length ? rows.map(preset => `<div class="comfort-row"><div class="comfort-row-main"><b>${esc(preset.name)}</b><span>${formatTime(preset.startMs)} → ${formatTime(preset.endMs)} · ${Math.round(Number(preset.settings?.speed || 1) * 100)}%</span></div><div class="comfort-row-actions"><button class="button small" data-comfort-action="load-preset" data-id="${esc(preset.id)}">Load</button><button class="button small" data-comfort-action="delete-preset" data-id="${esc(preset.id)}">×</button></div></div>`).join("") : '<div class="list-sub">No saved setups for this song yet.</div>';
  }

  function renderGoal() {
    const folder = engine.practice.songFolder; const goal = folder ? store.goals[folder] : null; const status = q("#comfortGoalStatus");
    if (!status) return;
    if (goal) { q("#comfortGoalAccuracy").value = String(goal.accuracy); q("#comfortGoalMisses").value = String(goal.maxMisses); q("#comfortGoalSpeed").value = String(goal.speed); }
    if (!folder) { status.textContent = "Load a song to create or inspect its goal."; return; }
    if (!goal) { status.textContent = "No goal saved for this song."; return; }
    const eligible = currentSongAttempts().filter(attempt => Number(attempt.speed || 1) >= Number(goal.speed || 1) - 0.001);
    if (!eligible.length) { status.textContent = `Target: ${goal.accuracy.toFixed(2)}% with ≤${goal.maxMisses} misses at ${Math.round(goal.speed * 100)}%. No qualifying attempt yet.`; return; }
    const bestAccuracy = Math.max(...eligible.map(attempt => Number(attempt.accuracy ?? 0)));
    const bestMisses = Math.min(...eligible.map(attempt => Number(attempt.misses || 0)));
    const reached = eligible.some(attempt => Number(attempt.accuracy || 0) >= goal.accuracy && Number(attempt.misses || 0) <= goal.maxMisses);
    const accuracyGap = Math.max(0, goal.accuracy - bestAccuracy); const missGap = Math.max(0, bestMisses - goal.maxMisses);
    status.textContent = reached ? `Goal reached. Best qualifying run: ${bestAccuracy.toFixed(2)}% · ${bestMisses} misses.` : `Best qualifying run: ${bestAccuracy.toFixed(2)}% · ${bestMisses} misses. Need +${accuracyGap.toFixed(2)} points and ${missGap} fewer misses.`;
  }

  function renderCollections(preferredId = null) {
    const select = q("#comfortCollectionSelect"); const list = q("#comfortCollectionItems"); if (!select || !list) return;
    const previous = preferredId || select.value;
    select.innerHTML = store.collections.length ? store.collections.map(collection => `<option value="${esc(collection.id)}">${esc(collection.name)} · ${collection.items.length}</option>`).join("") : '<option value="">No collections</option>';
    if (store.collections.some(collection => collection.id === previous)) select.value = previous;
    const collection = selectedCollection();
    q("#comfortDeleteCollection").disabled = !collection; q("#comfortAddCollectionItem").disabled = !collection || !engine.practice.bundle; q("#comfortRunCollection").disabled = !collection?.items.length;
    if (!collection) { list.innerHTML = '<div class="list-sub">Create a collection to organize songs and ranges.</div>'; return; }
    list.innerHTML = collection.items.length ? collection.items.map((item, index) => `<div class="comfort-row"><div class="comfort-row-main"><b>${index + 1}. ${esc(item.label)}</b><span>${esc(item.songName)} · ${formatTime(item.startMs)} → ${formatTime(item.endMs)} · ${Math.round(Number(item.settings?.speed || 1) * 100)}%</span></div><div class="comfort-row-actions"><button class="button small" data-comfort-action="load-item" data-collection-id="${esc(collection.id)}" data-id="${esc(item.id)}">Load</button><button class="button small" data-comfort-action="delete-item" data-collection-id="${esc(collection.id)}" data-id="${esc(item.id)}">×</button></div></div>`).join("") : '<div class="list-sub">Add the current song or selected range to begin.</div>';
  }

  function renderStats() {
    const root = q("#comfortStats"); if (!root) return;
    const rows = currentSongAttempts(); const valid = rows.filter(attempt => Number.isFinite(Number(attempt.accuracy)));
    const best = valid.length ? Math.max(...valid.map(attempt => Number(attempt.accuracy))) : null;
    const average = valid.length ? valid.reduce((sum, attempt) => sum + Number(attempt.accuracy), 0) / valid.length : null;
    const totalTime = rows.reduce((sum, attempt) => sum + Number(attempt.durationMs || 0), 0);
    const combo = rows.length ? Math.max(...rows.map(attempt => Number(attempt.maxCombo || 0))) : 0;
    root.innerHTML = [["Attempts", rows.length], ["Best accuracy", best === null ? "—" : `${best.toFixed(2)}%`], ["Average", average === null ? "—" : `${average.toFixed(2)}%`], ["Practice time", formatDuration(totalTime)], ["Best combo", combo || "—"]].map(([label, value]) => `<div class="comfort-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join("");
  }

  function renderAttemptList() {
    const root = q("#comfortAttemptList"); if (!root) return;
    const rows = currentSongAttempts();
    root.innerHTML = rows.length ? rows.slice(0, 30).map(attempt => `<div class="comfort-row ${attempt.id === runtime.selectedAttemptId ? "selected" : ""}"><div class="comfort-row-main"><b>${Number(attempt.accuracy).toFixed(2)}% · ${attempt.misses} misses · ${Math.round(attempt.speed * 100)}%</b><span>${formatDate(attempt.completedAt)} · ${formatTime(attempt.startMs)}–${formatTime(attempt.endMs)}${attempt.tags?.length ? ` · ${attempt.tags.map(esc).join(", ")}` : ""}</span></div><div class="comfort-row-actions"><button class="button small" data-comfort-action="select-attempt" data-id="${esc(attempt.id)}">Edit</button><button class="button small" data-comfort-action="delete-attempt" data-id="${esc(attempt.id)}">×</button></div></div>`).join("") : '<div class="list-sub">Finish a Practice attempt and it will be saved here.</div>';
  }

  function renderAttemptEditor() {
    const root = q("#comfortAttemptEditor"); if (!root) return;
    const rows = currentSongAttempts();
    if (!rows.some(row => row.id === runtime.selectedAttemptId)) runtime.selectedAttemptId = rows[0]?.id || null;
    const attempt = rows.find(row => row.id === runtime.selectedAttemptId);
    if (!attempt) { root.innerHTML = '<div class="list-sub">Select an attempt to add tags or notes.</div>'; return; }
    root.innerHTML = `<div class="comfort-panel-head"><div><h3>${Number(attempt.accuracy).toFixed(2)}% · ${attempt.misses} misses</h3><p>${formatDate(attempt.completedAt)} · ${attempt.keyCount}K · ${Math.round(attempt.speed * 100)}%</p></div></div><div class="comfort-tag-row">${commonTags.map(tag => `<button class="comfort-tag ${(attempt.tags || []).includes(tag) ? "active" : ""}" data-comfort-action="toggle-tag" data-tag="${esc(tag)}">${esc(tag)}</button>`).join("")}</div><label class="field" style="margin-top:10px"><span>Tags, comma separated</span><input id="comfortAttemptTags" value="${esc((attempt.tags || []).join(", "))}"></label><label class="field" style="margin-top:8px"><span>Notes</span><textarea id="comfortAttemptNotes" placeholder="Left hand was dying, trying 125%…">${esc(attempt.notes || "")}</textarea></label><div class="comfort-actions"><button class="button small primary" data-comfort-action="save-attempt">Save notes</button></div>`;
  }

  function renderAttempts() { renderStats(); renderAttemptList(); renderAttemptEditor(); }

  function renderQueue() {
    const root = q("#comfortQueue"); if (!root) return;
    const collection = store.collections.find(row => row.id === runtime.activeCollectionId);
    if (!collection || runtime.activeCollectionIndex < 0) { root.innerHTML = ""; return; }
    const current = collection.items[runtime.activeCollectionIndex]; const hasNext = runtime.activeCollectionIndex + 1 < collection.items.length;
    root.innerHTML = `<div class="comfort-queue-state"><b>${esc(collection.name)}</b> · ${runtime.activeCollectionIndex + 1}/${collection.items.length}${current ? ` · ${esc(current.label)}` : ""}</div><button class="button small primary" data-comfort-action="next-collection">${hasNext ? "Next range" : "Finish collection"}</button><button class="button small" data-comfort-action="stop-collection">Stop</button>`;
  }

  function observe() {
    installView();
    const p = engine.practice;
    if (p.bundle && !p.loading && p.songFolder !== runtime.observedFolder) {
      runtime.observedFolder = p.songFolder;
      touchRecent(p.songFolder, 0);
      if (!store.globalSettings) saveGlobalSettings(false); else applyGlobalSettings();
      if (runtime.pendingSetup && runtime.pendingSetup.songFolder === p.songFolder) {
        const pending = runtime.pendingSetup; runtime.pendingSetup = null; setTimeout(() => applySetup(pending), 0);
      }
      renderAll();
    }
    const completedAt = p.lastAttempt?.completedAt || null;
    if (completedAt && completedAt !== runtime.observedAttempt) { runtime.observedAttempt = completedAt; recordAttempt(p.lastAttempt); renderQueue(); }
    requestAnimationFrame(observe);
  }

  requestAnimationFrame(observe);
})();
