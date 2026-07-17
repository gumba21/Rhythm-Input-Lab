"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  settings: null,
  songs: [],
  dashboard: null,
  chartFile: null,
  eventsFile: null,
  recordDodge: false,
  recordPoll: null,
  selectedSong: null,
  selectedAttempt: null,
  viz: {
    bundle: null,
    attempt: null,
    songFolder: null,
    attemptFolder: null,
    currentMs: 0,
    durationMs: 0,
    chartDurationMs: 0,
    playing: false,
    lastFrame: 0,
    playbackRate: 1,
    scrollScale: 1,
    offsetMs: 0,
    showOpponent: false,
    showEvents: true,
    xray: false,
    viewMode: "compare",
    theme: "fnf",
    comparison: null,
    audioReady: { instrumental: false, vocals: false },
    audioNames: { instrumental: "", vocals: "" },
    audioVolumes: { instrumental: 1, vocals: 1 },
    showSplashes: true,
    downscroll: false,
    ghostTapping: true,
    attemptSource: null,
    comparisonEnabled: true,
    importedReplayName: "",
    standaloneReplay: false,
    selectedObject: null,
    renderObjects: [],
  },
};

const atlas = {
  image: new Image(),
  loaded: false,
  receptors: [
    { x: 488, y: 238, w: 155, h: 158 },
    { x: 647, y: 238, w: 157, h: 155 },
    { x: 323, y: 240, w: 157, h: 154 },
    { x: 808, y: 238, w: 155, h: 157 },
  ],
  notes: [
    { x: 0, y: 398, w: 154, h: 157 },
    { x: 0, y: 240, w: 158, h: 154 },
    { x: 162, y: 240, w: 157, h: 154 },
    { x: 647, y: 397, w: 154, h: 157 },
  ],
  pressed: [
    { x: 1898, y: 150, w: 146, h: 149 },
    { x: 1898, y: 0, w: 150, h: 146 },
    { x: 158, y: 398, w: 154, h: 151 },
    { x: 316, y: 398, w: 149, h: 152 },
  ],
  holdPieces: [
    { x: 1337, y: 457, w: 51, h: 44 },
    { x: 1282, y: 457, w: 51, h: 44 },
    { x: 1227, y: 457, w: 51, h: 44 },
    { x: 1172, y: 457, w: 51, h: 44 },
  ],
  holdEnds: [
    { x: 1117, y: 452, w: 51, h: 64 },
    { x: 1062, y: 452, w: 51, h: 64 },
    { x: 1007, y: 452, w: 51, h: 64 },
    { x: 952, y: 452, w: 51, h: 64 },
  ],
};
atlas.image.src = "/assets/NOTE_assets.png";
atlas.image.onload = () => { atlas.loaded = true; drawVisualizer(); };

const splashAtlas = {
  image: new Image(),
  loaded: false,
  // Lane order follows the FNF purple, blue, green, red note layout.
  frames: {"purple":[[{"x":623,"y":646,"w":194,"h":186,"fx":-77,"fy":-87,"fw":291,"fh":303},{"x":822,"y":646,"w":220,"h":218,"fx":-61,"fy":-64,"fw":291,"fh":303},{"x":1047,"y":646,"w":284,"h":293,"fx":-37,"fy":-32,"fw":291,"fh":303},{"x":1336,"y":646,"w":291,"h":303,"fx":-30,"fy":-30,"fw":291,"fh":303}],[{"x":1632,"y":646,"w":202,"h":211,"fx":-69,"fy":-68,"fw":315,"fh":321},{"x":0,"y":972,"w":235,"h":240,"fx":-47,"fy":-45,"fw":315,"fh":321},{"x":240,"y":972,"w":298,"h":315,"fx":-9,"fy":-6,"fw":315,"fh":321},{"x":543,"y":972,"w":315,"h":321,"fx":0,"fy":0,"fw":315,"fh":321}]],"blue":[[{"x":0,"y":0,"w":194,"h":186,"fx":-77,"fy":-87,"fw":291,"fh":303},{"x":199,"y":0,"w":220,"h":218,"fx":-61,"fy":-64,"fw":291,"fh":303},{"x":424,"y":0,"w":284,"h":293,"fx":-37,"fy":-32,"fw":291,"fh":303},{"x":713,"y":0,"w":291,"h":303,"fx":-30,"fy":-30,"fw":291,"fh":303}],[{"x":1009,"y":0,"w":202,"h":211,"fx":-69,"fy":-68,"fw":315,"fh":321},{"x":1216,"y":0,"w":235,"h":240,"fx":-47,"fy":-45,"fw":315,"fh":321},{"x":1456,"y":0,"w":298,"h":315,"fx":-9,"fy":-6,"fw":315,"fh":321},{"x":0,"y":320,"w":315,"h":321,"fx":0,"fy":0,"fw":315,"fh":321}]],"green":[[{"x":320,"y":320,"w":194,"h":186,"fx":-77,"fy":-87,"fw":291,"fh":303},{"x":519,"y":320,"w":220,"h":218,"fx":-61,"fy":-64,"fw":291,"fh":303},{"x":744,"y":320,"w":284,"h":293,"fx":-37,"fy":-32,"fw":291,"fh":303},{"x":1033,"y":320,"w":291,"h":303,"fx":-30,"fy":-30,"fw":291,"fh":303}],[{"x":1329,"y":320,"w":202,"h":211,"fx":-69,"fy":-68,"fw":315,"fh":321},{"x":1536,"y":320,"w":235,"h":240,"fx":-47,"fy":-45,"fw":315,"fh":321},{"x":0,"y":646,"w":298,"h":315,"fx":-9,"fy":-6,"fw":315,"fh":321},{"x":303,"y":646,"w":315,"h":321,"fx":0,"fy":0,"fw":315,"fh":321}]],"red":[[{"x":863,"y":972,"w":194,"h":186,"fx":-77,"fy":-87,"fw":291,"fh":303},{"x":1062,"y":972,"w":220,"h":218,"fx":-61,"fy":-64,"fw":291,"fh":303},{"x":1287,"y":972,"w":284,"h":293,"fx":-37,"fy":-32,"fw":291,"fh":303},{"x":1576,"y":972,"w":291,"h":303,"fx":-30,"fy":-30,"fw":291,"fh":303}],[{"x":0,"y":1298,"w":202,"h":211,"fx":-69,"fy":-68,"fw":315,"fh":321},{"x":207,"y":1298,"w":235,"h":240,"fx":-47,"fy":-45,"fw":315,"fh":321},{"x":447,"y":1298,"w":298,"h":315,"fx":-9,"fy":-6,"fw":315,"fh":321},{"x":750,"y":1298,"w":315,"h":321,"fx":0,"fy":0,"fw":315,"fh":321}]]},
};
splashAtlas.image.src = "/assets/noteSplashes.png";
splashAtlas.image.onload = () => { splashAtlas.loaded = true; drawVisualizer(); };


const hurtAtlas = {
  image: new Image(),
  loaded: false,
  notes: [],
  holdPieces: [],
  holdEnds: [],
};
const hurtSplashAtlas = {
  image: new Image(),
  loaded: false,
  frames: {},
};

function atlasNumber(value, fallback = 0) {
  const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : fallback;
}

function parseXmlAtlas(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  const entries = [];
  xml.querySelectorAll('SubTexture').forEach(node => {
    entries.push({
      name: node.getAttribute('name') || '',
      x: atlasNumber(node.getAttribute('x')),
      y: atlasNumber(node.getAttribute('y')),
      w: atlasNumber(node.getAttribute('width')),
      h: atlasNumber(node.getAttribute('height')),
      fx: atlasNumber(node.getAttribute('frameX')),
      fy: atlasNumber(node.getAttribute('frameY')),
      fw: atlasNumber(node.getAttribute('frameWidth')),
      fh: atlasNumber(node.getAttribute('frameHeight')),
    });
  });
  return entries;
}

function parseSplashFrames(entries) {
  const colors = ['purple', 'blue', 'green', 'red'];
  const frames = {};
  for (const color of colors) {
    const variants = new Map();
    for (const entry of entries) {
      const match = entry.name.match(new RegExp(`note splash ${color} (\d)(\d{4})`, 'i'));
      if (!match) continue;
      const variantId = Number(match[1]);
      const frameIndex = Number(String(match[2]).slice(-1));
      if (!variants.has(variantId)) variants.set(variantId, []);
      variants.get(variantId)[frameIndex] = entry;
    }
    frames[color] = [...variants.keys()].sort((a,b)=>a-b).map(key => variants.get(key).filter(Boolean));
  }
  return frames;
}

function parseHurtNoteFrames(entries) {
  const noteOrder = ['purple','blue','green','red'];
  const notes = [];
  const pieces = [];
  const ends = [];
  for (const color of noteOrder) {
    const noteEntry = entries.find(entry => entry.name.toLowerCase() === `${color}0000`);
    notes.push(noteEntry || {x:0,y:0,w:0,h:0});
    const pieceEntry = entries.find(entry => {
      const name = entry.name.toLowerCase();
      return name.includes(color) && name.includes('hold piece');
    });
    pieces.push(pieceEntry || {x:0,y:0,w:0,h:0});
    const endEntry = entries.find(entry => {
      const name = entry.name.toLowerCase();
      return (name.includes(color) || (color === 'purple' && name.includes('pruple'))) && name.includes('hold') && name.includes('end');
    });
    ends.push(endEntry || {x:0,y:0,w:0,h:0});
  }
  return { notes, holdPieces: pieces, holdEnds: ends };
}

async function loadHurtAssets() {
  try {
    const [hurtXmlText, hurtSplashXmlText] = await Promise.all([
      fetch('/assets/HURTNOTE_assets.xml').then(r => r.ok ? r.text() : null),
      fetch('/assets/HURTnoteSplashes.xml').then(r => r.ok ? r.text() : null),
    ]);
    if (hurtXmlText) {
      const parsed = parseHurtNoteFrames(parseXmlAtlas(hurtXmlText));
      hurtAtlas.notes = parsed.notes;
      hurtAtlas.holdPieces = parsed.holdPieces;
      hurtAtlas.holdEnds = parsed.holdEnds;
      hurtAtlas.image.src = '/assets/HURTNOTE_assets.png';
      hurtAtlas.image.onload = () => { hurtAtlas.loaded = true; drawVisualizer(); };
    }
    if (hurtSplashXmlText) {
      hurtSplashAtlas.frames = parseSplashFrames(parseXmlAtlas(hurtSplashXmlText));
      hurtSplashAtlas.image.src = '/assets/HURTnoteSplashes.png';
      hurtSplashAtlas.image.onload = () => { hurtSplashAtlas.loaded = true; drawVisualizer(); };
    }
  } catch (error) {
    console.warn('Failed to load hurt assets', error);
  }
}
loadHurtAssets();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
}

function formatTime(ms) {
  const total = Math.max(0, Number(ms || 0)) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, "0")}`;
}

function formatClock(ms) {
  const total = Math.max(0, Number(ms || 0)) / 1000;
  return `${Math.floor(total / 60)}:${String(Math.floor(total % 60)).padStart(2, "0")}`;
}

function formatNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function debounce(fn, wait = 180) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), wait);
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const payload = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.data ?? payload;
}

function toast(message, type = "info", timeout = 3600) {
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.textContent = message;
  $("#toastStack").appendChild(node);
  setTimeout(() => node.remove(), timeout);
}

function setToggle(element, on) {
  element.classList.toggle("on", Boolean(on));
  element.dataset.on = on ? "1" : "0";
}

function toggleValue(element) {
  const next = element.dataset.on !== "1";
  setToggle(element, next);
  return next;
}

function go(view) {
  $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${view}`));
  $$(".nav-button").forEach(v => v.classList.toggle("active", v.dataset.view === view));
  if (view === "dashboard") refreshDashboard();
  if (view === "songs") refreshSongs();
  if (view === "visualizer") resizeCanvases();
}

async function init() {
  bindNavigation();
  bindDashboard();
  bindRecord();
  bindImport();
  bindSongs();
  bindVisualizer();
  bindSettings();
  window.addEventListener("resize", debounce(resizeCanvases, 80));
  try {
    const [settings, songs, dashboard] = await Promise.all([
      api("/api/settings"), api("/api/songs"), api("/api/dashboard"),
    ]);
    state.settings = settings;
    state.songs = songs;
    state.dashboard = dashboard;
    state.recordDodge = Boolean(settings.dodge.enabled);
    renderDashboard();
    renderSongs();
    renderSettings();
    renderRecordProfiles();
    populateVisualizerSongs();
    updateHotkeyHelp();
    startRecordPolling();
  } catch (error) {
    $("#connectionLabel").textContent = "Backend unavailable";
    $(".connection-dot").style.background = "var(--bad)";
    toast(error.message, "error", 8000);
  }
  requestAnimationFrame(animationLoop);
}

function bindNavigation() {
  $$(".nav-button").forEach(button => button.addEventListener("click", () => go(button.dataset.view)));
  $$('[data-go]').forEach(button => button.addEventListener("click", () => go(button.dataset.go)));
}

function bindDashboard() {
  $("#openOutputButton").addEventListener("click", async () => {
    try { await api("/api/open-output", { method: "POST", body: {} }); }
    catch (error) { toast(error.message, "error"); }
  });
}

async function refreshDashboard() {
  try {
    state.dashboard = await api("/api/dashboard");
    state.songs = await api("/api/songs");
    renderDashboard();
    renderSongs();
    populateVisualizerSongs();
  } catch (error) { toast(error.message, "error"); }
}

function metricCard(label, value, note = "") {
  return `<div class="card metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div>${note ? `<div class="metric-note">${escapeHtml(note)}</div>` : ""}</div>`;
}

function renderDashboard() {
  const data = state.dashboard || { songs: 0, attempts: 0, charts: 0, total_presses: 0, recent_songs: [], recent_attempts: [] };
  $("#dashboardMetrics").innerHTML = [
    metricCard("Songs", formatNumber(data.songs), "saved folders"),
    metricCard("Attempts", formatNumber(data.attempts), "recorded runs"),
    metricCard("Imported charts", formatNumber(data.charts), "ready for visualization"),
    metricCard("Physical inputs", formatNumber(data.total_presses), "lanes + dodges"),
  ].join("");

  $("#recentSongs").innerHTML = data.recent_songs?.length
    ? data.recent_songs.map(songCardHtml).join("")
    : `<div class="empty">Import a chart or record a song to begin.</div>`;
  bindSongCards($("#recentSongs"));

  $("#recentAttempts").innerHTML = data.recent_attempts?.length
    ? data.recent_attempts.map(attempt => `<div class="list-row"><div><div class="list-title">${escapeHtml(attempt.song_name)} · Attempt ${String(attempt.attempt_number ?? "—").padStart(3, "0")}</div><div class="list-sub">${escapeHtml(attempt.recorded_at)} · ${formatNumber(attempt.lane_presses)} lanes · ${formatNumber(attempt.dodge_presses)} dodges</div></div><button class="button small open-attempt" data-song="${escapeHtml(attempt.song_folder)}" data-attempt="${escapeHtml(attempt.folder)}">Replay</button></div>`).join("")
    : `<div class="empty">No attempts yet.</div>`;
  $$(".open-attempt", $("#recentAttempts")).forEach(button => button.addEventListener("click", () => loadVisualizer(button.dataset.song, button.dataset.attempt)));
}

function bindRecord() {
  $("#recordDodgeToggle").addEventListener("click", event => { state.recordDodge = toggleValue(event.currentTarget); });
  $("#armRecordButton").addEventListener("click", armRecorder);
  $("#startNowButton").addEventListener("click", () => recordAction("start"));
  $("#stopRecordButton").addEventListener("click", () => recordAction("stop"));
  $("#cancelRecordButton").addEventListener("click", () => recordAction("cancel"));
}

function renderRecordProfiles() {
  const select = $("#recordKeyMode");
  const previous = select.value;
  select.innerHTML = "";
  for (let n = 4; n <= 9; n++) {
    const profile = state.settings?.profiles?.[String(n)];
    if (!profile?.enabled) continue;
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = `${n}K · ${profile.keys.map(k => k.toUpperCase()).join(" ")}`;
    select.appendChild(option);
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  setToggle($("#recordDodgeToggle"), state.recordDodge);
}

function updateHotkeyHelp() {
  if (!state.settings) return;
  $("#recordHotkeyHelp").textContent = `Start: ${state.settings.controls.start_key.toUpperCase()} · Stop: ${state.settings.controls.stop_key.toUpperCase()} · Dodge: ${state.settings.dodge.key.toUpperCase()}`;
}

async function armRecorder() {
  const metadata = {
    song_name: $("#recordSong").value.trim() || "Untitled Song",
    game: $("#recordGame").value.trim(),
    difficulty: $("#recordDifficulty").value.trim(),
    key_count: Number($("#recordKeyMode").value || 4),
    tags: $("#recordTags").value.split(",").map(v => v.trim()).filter(Boolean),
    pre_play_note: $("#recordPreNote").value.trim(),
    post_play_note: $("#recordPostNote").value.trim(),
    dodge_enabled: state.recordDodge,
    dodge_key: state.settings.dodge.key,
  };
  try {
    const status = await api("/api/record/arm", { method: "POST", body: metadata });
    renderRecordStatus(status);
    toast("Recorder armed. Switch to the game when ready.");
  } catch (error) { toast(error.message, "error"); }
}

async function recordAction(action) {
  try {
    const status = await api(`/api/record/${action}`, { method: "POST", body: {} });
    renderRecordStatus(status);
  } catch (error) { toast(error.message, "error"); }
}

function startRecordPolling() {
  clearInterval(state.recordPoll);
  state.recordPoll = setInterval(async () => {
    try { renderRecordStatus(await api("/api/record/status")); }
    catch (_) {}
  }, 180);
}

function renderRecordStatus(status) {
  const active = status.status === "recording";
  $("#recordRing").classList.toggle("recording", active);
  $("#recordStateLabel").textContent = status.status || "idle";
  $("#recordTime").textContent = formatClock(status.elapsed_ms);
  $("#liveLanePresses").textContent = formatNumber(status.lane_presses);
  $("#liveDodges").textContent = formatNumber(status.dodge_presses);
  $("#liveNps").textContent = formatNumber(status.current_nps);
  $("#recordMessage").textContent = status.message || "Ready";
  $("#armRecordButton").disabled = ["armed", "recording", "saving"].includes(status.status);
  $("#startNowButton").disabled = status.status !== "armed";
  $("#stopRecordButton").disabled = status.status !== "recording";
  $("#cancelRecordButton").disabled = !["armed", "recording"].includes(status.status);
  if (status.status === "saved" && status.saved_song && status.saved_attempt_folder && !$("#recordMessage").dataset.announced?.includes(status.saved_attempt_folder)) {
    $("#recordMessage").dataset.announced = status.saved_attempt_folder;
    toast(status.message || "Attempt saved");
    refreshDashboard();
  }
}

function bindImport() {
  setupDropzone("chartDropzone", "chartFile", file => selectChartFile(file));
  setupDropzone("eventsDropzone", "eventsFile", file => selectEventsFile(file));
  $("#importButton").addEventListener("click", importSelectedChart);
}

function setupDropzone(zoneId, inputId, callback) {
  const zone = $(`#${zoneId}`);
  const input = $(`#${inputId}`);
  input.addEventListener("change", () => input.files[0] && callback(input.files[0]));
  ["dragenter", "dragover"].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach(type => zone.addEventListener(type, event => { event.preventDefault(); zone.classList.remove("drag"); }));
  zone.addEventListener("drop", event => event.dataTransfer.files[0] && callback(event.dataTransfer.files[0]));
}

async function selectChartFile(file) {
  try {
    const content = await file.text();
    const parsed = JSON.parse(content);
    state.chartFile = { file, content, parsed };
    $("#chartFileName").textContent = file.name;
    const song = parsed.song && typeof parsed.song === "object" ? parsed.song : parsed;
    const name = song.song || file.name.replace(/\.json$/i, "");
    if (!$("#importSongName").value) $("#importSongName").value = name;
    const sections = Array.isArray(song.notes) ? song.notes : [];
    const notes = sections.reduce((count, section) => count + (Array.isArray(section.sectionNotes) ? section.sectionNotes.length : 0), 0);
    const eventGroups = Array.isArray(song.events) ? song.events : 0;
    $("#importPreview").innerHTML = `<div class="stat-grid"><div class="stat-chip"><span>Detected song</span><b style="font-size:15px">${escapeHtml(name)}</b></div><div class="stat-chip"><span>Raw notes</span><b>${formatNumber(notes)}</b></div><div class="stat-chip"><span>Sections</span><b>${formatNumber(sections.length)}</b></div><div class="stat-chip"><span>Event groups</span><b>${formatNumber(eventGroups.length || 0)}</b></div></div>`;
    $("#importButton").disabled = false;
  } catch (error) {
    state.chartFile = null;
    $("#importButton").disabled = true;
    toast(`Chart could not be parsed: ${error.message}`, "error");
  }
}

async function selectEventsFile(file) {
  try {
    const content = await file.text();
    JSON.parse(content);
    state.eventsFile = { file, content };
    $("#eventsFileName").textContent = file.name;
  } catch (error) { toast(`Events file could not be parsed: ${error.message}`, "error"); }
}

async function importSelectedChart() {
  if (!state.chartFile) return;
  const button = $("#importButton");
  button.disabled = true;
  button.textContent = "Importing…";
  try {
    const result = await api("/api/import-chart", {
      method: "POST",
      body: {
        filename: state.chartFile.file.name,
        content: state.chartFile.content,
        song_name: $("#importSongName").value.trim(),
        key_count: $("#importKeyMode").value,
        events_filename: state.eventsFile?.file.name,
        events_content: state.eventsFile?.content,
      },
    });
    toast(`Imported ${result.summary.song_name}: ${formatNumber(result.summary.player_notes)} player notes and ${formatNumber(result.summary.event_count)} events.`);
    state.chartFile = null;
    state.eventsFile = null;
    $("#chartFileName").textContent = "";
    $("#eventsFileName").textContent = "";
    $("#importPreview").innerHTML = `<div class="empty">Import complete. Open the song library to visualize it.</div>`;
    await refreshDashboard();
    go("songs");
  } catch (error) { toast(error.message, "error", 7000); }
  finally { button.disabled = !state.chartFile; button.textContent = "Import song"; }
}

function bindSongs() {
  $("#songSearch").addEventListener("input", renderSongs);
  $("#closeSongModal").addEventListener("click", closeSongModal);
  $("#songModal").addEventListener("click", event => { if (event.target.id === "songModal") closeSongModal(); });
}

async function refreshSongs() {
  try { state.songs = await api("/api/songs"); renderSongs(); populateVisualizerSongs(); }
  catch (error) { toast(error.message, "error"); }
}

function songCardHtml(song) {
  const summary = song.chart || {};
  return `<article class="card song-card" data-song-folder="${escapeHtml(song.folder)}"><div class="song-title">${escapeHtml(song.song_name)}</div><div class="song-meta">${song.has_chart ? `${summary.key_count || "?"}K · ${formatNumber(summary.base_bpm, 1)} BPM · ${formatTime(summary.duration_ms)}` : "No chart imported"}</div><div class="pill-row"><span class="pill ${song.has_chart ? "good" : "warn"}">${song.has_chart ? "Chart ready" : "Inputs only"}</span><span class="pill">${formatNumber(song.attempt_count)} attempt${song.attempt_count === 1 ? "" : "s"}</span>${summary.event_count ? `<span class="pill">${formatNumber(summary.event_count)} events</span>` : ""}</div></article>`;
}

function renderSongs() {
  const query = $("#songSearch")?.value.trim().toLowerCase() || "";
  const filtered = state.songs.filter(song => song.song_name.toLowerCase().includes(query) || song.folder.toLowerCase().includes(query));
  $("#songLibrary").innerHTML = filtered.length ? filtered.map(songCardHtml).join("") : `<div class="empty">No songs match that search.</div>`;
  bindSongCards($("#songLibrary"));
}

function bindSongCards(root) {
  $$(".song-card", root).forEach(card => card.addEventListener("click", () => openSongModal(card.dataset.songFolder)));
}

async function openSongModal(folder) {
  try {
    const data = await api(`/api/song?folder=${encodeURIComponent(folder)}`);
    state.selectedSong = data;
    $("#modalSongTitle").textContent = data.song.song_name;
    const summary = data.bundle?.summary;
    const attemptRows = data.attempts.length ? data.attempts.map(attempt => `<div class="list-row"><div><div class="list-title">Attempt ${String(attempt.attempt_number ?? "—").padStart(3, "0")}</div><div class="list-sub">${escapeHtml(attempt.recorded_at)} · ${formatNumber(attempt.lane_presses)} lane presses · peak ${formatNumber(attempt.peak_nps, 1)} NPS</div></div><button class="button small modal-replay" data-attempt="${escapeHtml(attempt.folder)}">Replay</button></div>`).join("") : `<div class="empty">No recorded attempts.</div>`;
    $("#modalSongBody").innerHTML = `${summary ? `<div class="grid metrics" style="grid-template-columns:repeat(4,minmax(0,1fr))">${metricCard("Player notes", formatNumber(summary.player_notes))}${metricCard("Events", formatNumber(summary.event_count))}${metricCard("Authored peak", `${formatNumber(summary.player_peak_1s_nps, 1)} NPS`)}${metricCard("Duration", formatTime(summary.duration_ms))}</div>` : `<div class="empty">This song has recorded inputs but no imported chart.</div>`}<div class="actions" style="margin:16px 0"><button class="button primary" id="modalChartReplay" ${summary ? "" : "disabled"}>Open chart visualizer</button><button class="button" data-close-go="import">Import / replace chart</button></div><h3>Attempts</h3><div class="list" style="margin-top:10px">${attemptRows}</div>`;
    $("#modalChartReplay").addEventListener("click", () => loadVisualizer(folder, null));
    $$(".modal-replay", $("#modalSongBody")).forEach(button => button.addEventListener("click", () => loadVisualizer(folder, button.dataset.attempt)));
    $$('[data-close-go]', $("#modalSongBody")).forEach(button => button.addEventListener("click", () => { closeSongModal(); go(button.dataset.closeGo); $("#importSongName").value = data.song.song_name; }));
    $("#songModal").classList.add("open");
  } catch (error) { toast(error.message, "error"); }
}

function closeSongModal() { $("#songModal").classList.remove("open"); }

function bindSettings() {
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#settingDodgeEnabled").addEventListener("click", event => toggleValue(event.currentTarget));
  $("#settingOpenReport").addEventListener("click", event => toggleValue(event.currentTarget));
  const recalc = () => {
    const frames = Number($("#settingSafeFrames")?.value || 10);
    const fps = Math.max(1, Number($("#settingSafeFps")?.value || 60));
    const derived = frames / fps * 1000;
    if ($("#safeFrameDerived")) $("#safeFrameDerived").textContent = `${formatNumber(derived, 2)} ms (${formatNumber(frames, 1)} frames @ ${formatNumber(fps, 0)} FPS)`;
    if ($("#settingHitWindow") && !$("#settingHitWindow").matches(':focus')) $("#settingHitWindow").value = formatNumber(derived, 3);
  };
  $("#settingSafeFrames")?.addEventListener('input', recalc);
  $("#settingSafeFps")?.addEventListener('input', recalc);
}

function renderSettings() {
  if (!state.settings) return;
  const profiles = state.settings.profiles;
  $("#profileSettings").innerHTML = Object.keys(profiles).sort((a,b) => Number(a)-Number(b)).map(n => `<div class="settings-profile"><div class="mode-badge">${n}K</div><input class="profile-keys" data-mode="${n}" value="${escapeHtml(profiles[n].keys.join(", "))}"><button class="toggle profile-enabled ${profiles[n].enabled ? "on" : ""}" data-on="${profiles[n].enabled ? "1" : "0"}" data-mode="${n}"></button></div>`).join("");
  $$(".profile-enabled").forEach(button => button.addEventListener("click", event => toggleValue(event.currentTarget)));
  $("#settingStartKey").value = state.settings.controls.start_key;
  $("#settingStopKey").value = state.settings.controls.stop_key;
  $("#settingDodgeKey").value = state.settings.dodge.key;
  $("#settingOutputRoot").value = state.settings.output_root;
  const windows = getChartWindows();
  $("#settingSafeFrames").value = state.settings.chart.safe_frames ?? 10;
  $("#settingSafeFps").value = state.settings.chart.safe_fps ?? 60;
  $("#settingHitWindow").value = formatNumber(state.settings.chart.hit_window_ms ?? windows.derivedOuter, 3);
  $("#settingPerfectWindow").value = state.settings.chart.perfect_window_ms;
  $("#settingGoodWindow").value = state.settings.chart.good_window_ms;
  $("#settingBadWindow").value = state.settings.chart.bad_window_ms;
  $("#safeFrameDerived").textContent = `${formatNumber(windows.derivedOuter, 2)} ms (${formatNumber(windows.safeFrames, 1)} frames @ ${formatNumber(windows.safeFps, 0)} FPS)`;
  setToggle($("#settingDodgeEnabled"), state.settings.dodge.enabled);
  setToggle($("#settingOpenReport"), state.settings.open_report);
}

async function saveSettings() {
  const next = JSON.parse(JSON.stringify(state.settings));
  $$(".profile-keys").forEach(input => {
    const mode = input.dataset.mode;
    next.profiles[mode].keys = input.value.split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
    next.profiles[mode].enabled = $(`.profile-enabled[data-mode="${mode}"]`).dataset.on === "1";
  });
  next.controls.start_key = $("#settingStartKey").value.trim().toLowerCase();
  next.controls.stop_key = $("#settingStopKey").value.trim().toLowerCase();
  next.dodge.key = $("#settingDodgeKey").value.trim().toLowerCase();
  next.dodge.enabled = $("#settingDodgeEnabled").dataset.on === "1";
  next.output_root = $("#settingOutputRoot").value.trim();
  next.open_report = $("#settingOpenReport").dataset.on === "1";
  next.chart.safe_frames = Number($("#settingSafeFrames").value);
  next.chart.safe_fps = Number($("#settingSafeFps").value);
  const derivedOuter = next.chart.safe_frames / Math.max(next.chart.safe_fps || 60, 1) * 1000;
  next.chart.hit_window_ms = Number($("#settingHitWindow").value) || derivedOuter;
  next.chart.perfect_window_ms = Number($("#settingPerfectWindow").value);
  next.chart.good_window_ms = Number($("#settingGoodWindow").value);
  next.chart.bad_window_ms = Number($("#settingBadWindow").value);
  try {
    state.settings = await api("/api/settings", { method: "POST", body: next });
    state.recordDodge = Boolean(state.settings.dodge.enabled);
    renderSettings(); renderRecordProfiles(); updateHotkeyHelp();
    toast("Settings saved.");
    await refreshDashboard();
  } catch (error) { toast(error.message, "error", 7000); }
}

function bindVisualizer() {
  $("#visualizerSongSelect").addEventListener("change", event => event.target.value && loadVisualizer(event.target.value, null));
  $("#visualizerAttemptSelect").addEventListener("change", event => loadAttemptForCurrent(event.target.value || null));
  $("#playButton").addEventListener("click", togglePlayback);
  $("#restartButton").addEventListener("click", () => seekTo(0));
  $("#viewMode").addEventListener("change", event => { state.viz.viewMode = event.target.value; drawVisualizer(); });
  $("#themeMode").addEventListener("change", event => { state.viz.theme = event.target.value; state.viz.xray = event.target.value === "xray"; updateVizButtons(); drawVisualizer(); });
  $("#playbackRate").addEventListener("change", event => {
    state.viz.playbackRate = Number(event.target.value);
    for (const audio of audioElements()) audio.playbackRate = state.viz.playbackRate;
  });
  $("#scrollSpeed").addEventListener("input", event => { state.viz.scrollScale = Number(event.target.value); drawVisualizer(); });
  $("#opponentToggle").addEventListener("click", () => { state.viz.showOpponent = !state.viz.showOpponent; updateVizButtons(); drawVisualizer(); });
  $("#eventsToggle").addEventListener("click", () => { state.viz.showEvents = !state.viz.showEvents; updateVizButtons(); drawVisualizer(); });
  $("#xrayToggle").addEventListener("click", () => { state.viz.xray = !state.viz.xray; updateVizButtons(); drawVisualizer(); });
  $("#downscrollToggle").addEventListener("click", () => { state.viz.downscroll = !state.viz.downscroll; updateVizButtons(); drawVisualizer(); });
  $("#ghostToggle").addEventListener("click", () => { state.viz.ghostTapping = !state.viz.ghostTapping; updateVizButtons(); updateVisualizerStats(); drawVisualizer(); drawTimeline(); });
  $("#replayFiles").addEventListener("change", event => importReplayFiles(event.target.files));
  $("#replayFolder").addEventListener("change", event => importReplayFiles(event.target.files));
  $("#clearReplay").addEventListener("click", clearCurrentReplay);
  $("#seekRange").addEventListener("input", event => seekTo(Number(event.target.value) / 1000 * state.viz.durationMs));
  $("#timelineCanvas").addEventListener("click", event => {
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width * state.viz.durationMs);
  });
  $("#visualizerCanvas").addEventListener("click", inspectCanvasObject);
  $("#offsetInput").addEventListener("input", debounce(() => { state.viz.offsetMs = Number($("#offsetInput").value || 0); recomputeComparison(); }, 80));
  $$(".offset-nudge").forEach(button => button.addEventListener("click", () => { state.viz.offsetMs += Number(button.dataset.nudge); $("#offsetInput").value = String(Math.round(state.viz.offsetMs)); recomputeComparison(); }));
  $("#autoAlignButton").addEventListener("click", () => { autoAlignCurrent(true); });
  $("#instrumentalFile").addEventListener("change", event => attachAudio(event, "instrumental"));
  $("#vocalsFile").addEventListener("change", event => attachAudio(event, "vocals"));
  $("#instrumentalVolume").addEventListener("input", event => setAudioVolume("instrumental", event.target.value));
  $("#vocalsVolume").addEventListener("input", event => setAudioVolume("vocals", event.target.value));
  $("#clearInstrumental").addEventListener("click", () => clearAudio("instrumental"));
  $("#clearVocals").addEventListener("click", () => clearAudio("vocals"));
  $("#splashToggle").addEventListener("click", () => {
    state.viz.showSplashes = !state.viz.showSplashes;
    updateVizButtons();
    drawVisualizer();
  });
  for (const audio of audioElements()) {
    audio.addEventListener("ended", () => {
      const primary = primaryAudio();
      if (!primary || primary.ended) {
        state.viz.playing = false;
        updatePlayButton();
      }
    });
  }
}

function populateVisualizerSongs() {
  const select = $("#visualizerSongSelect");
  const current = select.value;
  select.innerHTML = `<option value="">Choose song</option>` + state.songs.filter(song => song.has_chart).map(song => `<option value="${escapeHtml(song.folder)}">${escapeHtml(song.song_name)}</option>`).join("");
  if ([...select.options].some(option => option.value === current)) select.value = current;
}


function parseCsvRows(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ""; }
    else if (char === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(value => value.trim());
  return rows.filter(values => values.some(value => value !== "")).map(values => {
    const object = {};
    headers.forEach((header, index) => { object[header] = values[index] ?? ""; });
    return object;
  });
}

function pairImportedReplay(rows, laneKeys) {
  const laneMap = new Map(laneKeys.map((key, index) => [String(key).trim().toLowerCase(), index]));
  const presses = [];
  const waiting = new Map();
  for (const row of rows) {
    const event = String(row.event || "").trim().toLowerCase();
    if (!['down', 'up'].includes(event)) continue;
    const key = String(row.key || "").trim().toLowerCase();
    const role = String(row.role || "lane").trim().toLowerCase() === 'dodge' ? 'dodge' : 'lane';
    const timeMs = Number(row.time_ms);
    if (!Number.isFinite(timeMs) || !key) continue;
    const identity = `${role}\u0000${key}`;
    if (event === 'down') {
      const press = {
        id: presses.length,
        time_ms: timeMs,
        key,
        role,
        lane: role === 'lane' ? (laneMap.has(key) ? laneMap.get(key) : null) : null,
        held_ms: Number.isFinite(Number(row.held_ms)) && String(row.held_ms).trim() !== '' ? Math.max(0, Number(row.held_ms)) : null,
      };
      presses.push(press);
      if (!waiting.has(identity)) waiting.set(identity, []);
      waiting.get(identity).push(presses.length - 1);
    } else {
      const queue = waiting.get(identity) || [];
      if (!queue.length) continue;
      const index = queue.shift();
      const held = String(row.held_ms || '').trim() !== '' ? Number(row.held_ms) : timeMs - presses[index].time_ms;
      if (Number.isFinite(held)) presses[index].held_ms = Math.max(0, held);
    }
  }
  return presses.filter(press => press.role !== 'lane' || Number.isInteger(press.lane));
}

async function readReplaySelection(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) throw new Error('No replay files were selected.');
  const csvFile = files.find(file => /(^|\/|\\)inputs(?:\s*\(\d+\))?\.csv$/i.test(file.webkitRelativePath || file.name))
    || files.find(file => /\.csv$/i.test(file.name));
  if (!csvFile) throw new Error('Select an inputs.csv file or an attempt folder containing one.');
  const jsonFiles = files.filter(file => /\.json$/i.test(file.name));
  let session = null;
  let analysis = null;
  for (const file of jsonFiles) {
    try {
      const value = JSON.parse(await file.text());
      const candidate = value?.metadata && !value?.lane_keys ? value.metadata : value;
      if (!session && Array.isArray(candidate?.lane_keys)) session = candidate;
      if (!analysis && value?.recording && value?.metadata) analysis = value;
    } catch (_) {}
  }
  const rows = parseCsvRows(await csvFile.text());
  if (!rows.length) throw new Error('The selected CSV does not contain readable input rows.');
  return { csvFile, rows, session: session || {}, analysis: analysis || {} };
}

async function importReplayFiles(fileList) {
  try {
    const imported = await readReplaySelection(fileList);
    const discovered = [];
    for (const row of imported.rows) {
      const role = String(row.role || 'lane').trim().toLowerCase();
      const key = String(row.key || '').trim().toLowerCase();
      if (role !== 'dodge' && key && !discovered.includes(key)) discovered.push(key);
    }
    let laneKeys = Array.isArray(imported.session.lane_keys)
      ? imported.session.lane_keys.map(key => String(key).trim().toLowerCase()).filter(Boolean)
      : [];
    if (!laneKeys.length) {
      const suggested = discovered.join(',');
      const entered = window.prompt('Enter lane keys from left to right (4K–9K).', suggested);
      if (entered === null) return;
      laneKeys = entered.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    }
    if (laneKeys.length < 4 || laneKeys.length > 9 || new Set(laneKeys).size !== laneKeys.length) {
      throw new Error('Replay lane mapping must contain 4–9 unique keys.');
    }
    const presses = pairImportedReplay(imported.rows, laneKeys);
    const laneCount = presses.filter(press => press.role === 'lane').length;
    if (!laneCount) throw new Error('No mapped lane presses were found in the replay.');
    const replayKeyCount = Number(imported.session.key_count || laneKeys.length);
    const chartKeyCount = Number(state.viz.bundle?.summary?.key_count || 0);
    if (state.viz.bundle && !state.viz.standaloneReplay && chartKeyCount && chartKeyCount !== replayKeyCount) {
      throw new Error(`This replay is ${replayKeyCount}K, but the loaded chart is ${chartKeyCount}K.`);
    }
    const replayEnd = Math.max(...presses.map(press => Number(press.time_ms) + Math.max(0, Number(press.held_ms || 0))), 0) + 700;
    const replayName = imported.session.song_name || imported.csvFile.name.replace(/\.csv$/i, '') || 'Imported replay';
    const hasRealChart = Boolean(state.viz.bundle && !state.viz.standaloneReplay && state.viz.bundle.notes?.length);
    if (!hasRealChart) {
      state.viz.bundle = {
        summary: {
          song_name: replayName,
          song_id: String(imported.session.song_id || replayName).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          format: 'input_replay',
          key_count: replayKeyCount,
          duration_ms: replayEnd,
          base_bpm: 0,
          player_notes: 0,
          opponent_notes: 0,
          event_count: 0,
        },
        notes: [], events: [], bpm_changes: [],
        mappings: { note_types: {}, event_types: {} },
      };
      state.viz.standaloneReplay = true;
      state.viz.chartDurationMs = 0;
      state.viz.songFolder = null;
      $("#visualizerSongSelect").value = '';
      $("#visualizerAttemptSelect").innerHTML = '<option value="">Imported replay</option>';
      $("#visualizerTitle").textContent = replayName;
      $("#visualizerSubtitle").textContent = `${replayKeyCount}K · imported input replay · ${laneCount.toLocaleString()} lane inputs`;
      $("#canvasEmpty").classList.add('hidden');
    }
    state.viz.attempt = {
      folder: imported.csvFile.name,
      session: { ...imported.session, key_count: replayKeyCount, lane_keys: laneKeys },
      analysis: imported.analysis,
      presses,
    };
    state.viz.attemptFolder = null;
    state.viz.attemptSource = 'imported';
    state.viz.comparisonEnabled = false;
    state.viz.importedReplayName = imported.csvFile.webkitRelativePath || imported.csvFile.name;
    state.viz.comparison = null;
    state.viz.offsetMs = 0;
    state.viz.currentMs = 0;
    state.viz.durationMs = Math.max(state.viz.chartDurationMs || Number(state.viz.bundle.summary.duration_ms || 0), replayEnd);
    $("#durationTime").textContent = formatTime(state.viz.durationMs);
    $("#offsetInput").value = '0';
    state.viz.viewMode = state.viz.standaloneReplay ? 'inputs' : 'compare';
    $("#viewMode").value = state.viz.viewMode;
    updateReplayStatus();
    updateVisualizerStats();
    resizeCanvases();
    toast(`Imported replay: ${state.viz.importedReplayName}. Accuracy reconstruction is disabled.`);
  } catch (error) {
    toast(error.message, 'error', 7000);
  } finally {
    $("#replayFiles").value = '';
    $("#replayFolder").value = '';
  }
}

function updateReplayStatus() {
  const label = state.viz.attempt
    ? `${state.viz.attemptSource === 'imported' ? 'Imported' : 'Saved'} replay: ${state.viz.importedReplayName || state.viz.attempt.folder || 'loaded'}`
    : 'Replay: none';
  $("#replayStatus").textContent = label;
}

function clearCurrentReplay() {
  state.viz.playing = false;
  updatePlayButton();
  state.viz.attempt = null;
  state.viz.attemptFolder = null;
  state.viz.attemptSource = null;
  state.viz.comparisonEnabled = true;
  state.viz.importedReplayName = '';
  state.viz.comparison = null;
  state.viz.offsetMs = 0;
  $("#offsetInput").value = '0';
  if (state.viz.standaloneReplay) {
    state.viz.bundle = null;
    state.viz.standaloneReplay = false;
    state.viz.durationMs = 0;
    state.viz.currentMs = 0;
    $("#visualizerTitle").textContent = 'Visualizer.';
    $("#visualizerSubtitle").textContent = 'Choose a song, import a chart, or load an input replay.';
    $("#durationTime").textContent = '0:00.00';
    $("#canvasEmpty").classList.remove('hidden');
  } else if (state.viz.bundle) {
    state.viz.durationMs = state.viz.chartDurationMs || Number(state.viz.bundle.summary?.duration_ms || 0);
    $("#durationTime").textContent = formatTime(state.viz.durationMs);
    $("#visualizerAttemptSelect").value = '';
  }
  updateReplayStatus();
  updateVisualizerStats();
  drawVisualizer(); drawTimeline();
}

async function loadVisualizer(songFolder, attemptFolder = null) {
  closeSongModal();
  go("visualizer");
  try {
    const data = await api(`/api/song?folder=${encodeURIComponent(songFolder)}`);
    if (!data.bundle) throw new Error("This song does not have an imported chart.");
    state.viz.bundle = data.bundle;
    state.viz.songFolder = songFolder;
    state.viz.durationMs = Number(data.bundle.summary.duration_ms || 0);
    state.viz.chartDurationMs = state.viz.durationMs;
    state.viz.currentMs = 0;
    state.viz.viewMode = "compare";
    $("#viewMode").value = "compare";
    state.viz.playing = false;
    state.viz.attempt = null;
    state.viz.attemptFolder = null;
    state.viz.comparison = null;
    state.viz.attemptSource = null;
    state.viz.comparisonEnabled = true;
    state.viz.importedReplayName = "";
    state.viz.standaloneReplay = false;
    state.viz.selectedObject = null;
    updateReplayStatus();
    $("#visualizerTitle").textContent = data.song.song_name;
    const authoredHazards = data.bundle.notes.filter(note => note.owner === "player" && note.lane !== null && note.lane !== undefined && isHazardNote(note)).length;
    $("#visualizerSubtitle").textContent = `${data.bundle.summary.key_count}K · ${formatNumber(data.bundle.summary.base_bpm, 1)} BPM · ${formatNumber(data.bundle.summary.player_notes)} player notes · ${formatNumber(authoredHazards)} hazards · ${formatNumber(data.bundle.summary.event_count)} events`;
    $("#visualizerSongSelect").value = songFolder;
    $("#visualizerAttemptSelect").innerHTML = `<option value="">Chart only</option>` + data.attempts.map(attempt => `<option value="${escapeHtml(attempt.folder)}">Attempt ${String(attempt.attempt_number ?? "—").padStart(3,"0")} · ${escapeHtml(attempt.recorded_at)}</option>`).join("");
    $("#canvasEmpty").classList.add("hidden");
    $("#durationTime").textContent = formatTime(state.viz.durationMs);
    if (attemptFolder) {
      $("#visualizerAttemptSelect").value = attemptFolder;
      await loadAttemptForCurrent(attemptFolder);
    } else {
      state.viz.offsetMs = 0;
      $("#offsetInput").value = "0";
      updateVisualizerStats();
      resizeCanvases();
    }
  } catch (error) { toast(error.message, "error", 7000); }
}

async function loadAttemptForCurrent(attemptFolder) {
  state.viz.playing = false;
  updatePlayButton();
  if (!attemptFolder) {
    state.viz.attempt = null;
    state.viz.attemptFolder = null;
    state.viz.attemptSource = null;
    state.viz.comparisonEnabled = true;
    state.viz.importedReplayName = "";
    state.viz.comparison = null;
    state.viz.offsetMs = 0;
    updateReplayStatus();
    $("#offsetInput").value = "0";
    updateVisualizerStats();
    drawVisualizer(); drawTimeline();
    return;
  }
  try {
    state.viz.attempt = await api(`/api/attempt?folder=${encodeURIComponent(state.viz.songFolder)}&attempt=${encodeURIComponent(attemptFolder)}`);
    state.viz.attemptFolder = attemptFolder;
    state.viz.attemptSource = "saved";
    state.viz.comparisonEnabled = true;
    state.viz.importedReplayName = `Attempt ${state.viz.attempt.session?.attempt_number ?? "—"}`;
    updateReplayStatus();
    const savedOffset = state.viz.attempt.analysis?.chart?.offset_ms;
    state.viz.offsetMs = Number.isFinite(Number(savedOffset)) ? Number(savedOffset) : 0;
    if (!savedOffset) autoAlignCurrent(false);
    else recomputeComparison();
    $("#offsetInput").value = String(Math.round(state.viz.offsetMs));
    state.viz.currentMs = 0;
    resizeCanvases();
  } catch (error) { toast(error.message, "error", 7000); }
}

function getChartWindows() {
  const safeFrames = Number(state.settings?.chart?.safe_frames ?? 10);
  const safeFps = Math.max(1, Number(state.settings?.chart?.safe_fps ?? 60));
  const derivedOuter = safeFrames / safeFps * 1000;
  const outer = Number(state.settings?.chart?.hit_window_ms ?? derivedOuter) || derivedOuter;
  const sick = Math.max(0, Number(state.settings?.chart?.perfect_window_ms ?? 45));
  const good = Math.max(sick, Number(state.settings?.chart?.good_window_ms ?? 90));
  const bad = Math.max(good, Number(state.settings?.chart?.bad_window_ms ?? 135));
  return { safeFrames, safeFps, outer: Math.max(bad, outer), sick, good, bad, derivedOuter };
}

function noteTypeMapping(note) {
  const mappings = state.viz.bundle?.mappings?.note_types || {};
  const key = String(note?.note_type || '');
  const mapped = mappings[key];
  if (mapped) return mapped;
  const folded = key.trim().toLowerCase();
  if (!folded || folded === 'normal' || folded === 'no animation') return { category: 'normal', gameplay: true, should_press: true };
  if (['hurt note','hurt','mine','death note'].includes(folded)) return { category: 'hazard', gameplay: true, should_press: false };
  return { category: 'normal', gameplay: true, should_press: true };
}

function isHazardNote(note) {
  const mapping = noteTypeMapping(note);
  return mapping.should_press === false || mapping.category === 'hazard';
}

function expectedHazardNotes() {
  const bundle = state.viz.bundle;
  if (!bundle) return [];
  return bundle.notes.filter(note => note.owner === 'player' && note.lane !== null && note.lane !== undefined && isHazardNote(note));
}

function expectedChartNotes() {
  const bundle = state.viz.bundle;
  if (!bundle) return [];
  return bundle.notes.filter(note => {
    if (note.owner !== "player" || note.lane === null || note.lane === undefined) return false;
    return !isHazardNote(note);
  });
}

function lanePresses() {
  return (state.viz.attempt?.presses || []).filter(press => press.role === "lane" && Number.isInteger(press.lane));
}

function dodgePresses() {
  return (state.viz.attempt?.presses || []).filter(press => press.role === "dodge");
}

function candidateOffsets(notes, presses) {
  const byLaneNotes = new Map();
  const byLanePresses = new Map();
  for (const note of notes) {
    if (!byLaneNotes.has(note.lane)) byLaneNotes.set(note.lane, []);
    if (byLaneNotes.get(note.lane).length < 48) byLaneNotes.get(note.lane).push(Number(note.time_ms));
  }
  for (const press of presses) {
    if (!byLanePresses.has(press.lane)) byLanePresses.set(press.lane, []);
    if (byLanePresses.get(press.lane).length < 48) byLanePresses.get(press.lane).push(Number(press.time_ms));
  }
  const counts = new Map();
  for (const [lane, noteTimes] of byLaneNotes) {
    const pressTimes = byLanePresses.get(lane) || [];
    for (const noteTime of noteTimes) {
      for (const pressTime of pressTimes) {
        const rounded = Math.round((pressTime - noteTime) / 5) * 5;
        counts.set(rounded, (counts.get(rounded) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a,b) => b[1]-a[1]).slice(0, 36).map(([offset]) => Number(offset));
}

function autoAlignCurrent(announce = true) {
  const notes = expectedChartNotes();
  const presses = lanePresses();
  if (!notes.length || !presses.length) {
    if (announce) toast("Load an attempt before auto-aligning.", "error");
    return;
  }
  const candidates = candidateOffsets(notes, presses);
  candidates.push(presses[0].time_ms - notes[0].time_ms, state.viz.offsetMs || 0);
  let best = null;
  for (const offset of [...new Set(candidates.map(v => Math.round(v)))]) {
    const result = matchChart(notes, presses, offset, getChartWindows().outer);
    const score = result.matches.length * 1000 - result.medianAbsolute;
    if (!best || score > best.score) best = { offset, score, result };
  }
  if (best) {
    state.viz.offsetMs = best.offset;
    $("#offsetInput").value = String(Math.round(best.offset));
    recomputeComparison();
    if (announce) toast(`Auto-aligned at ${Math.round(best.offset)} ms with ${best.result.matches.length} note matches.`);
  }
}

function matchChart(notes, presses, offsetMs, windowMs) {
  const matches = [];
  const missedNoteIds = new Set();
  const extraPressIds = new Set(presses.map(press => press.id));
  const matchByNote = new Map();
  const matchByPress = new Map();
  const offsets = [];
  const lanes = new Set([...notes.map(n => n.lane), ...presses.map(p => p.lane)]);

  const firstInputChart = presses.length ? Math.min(...presses.map(p => p.time_ms - offsetMs)) : 0;
  const lastInputChart = presses.length ? Math.max(...presses.map(p => p.time_ms - offsetMs)) : 0;
  const coveredNotes = notes.filter(note => note.time_ms >= firstInputChart - windowMs && note.time_ms <= lastInputChart + windowMs);

  for (const lane of lanes) {
    const laneNotes = coveredNotes.filter(n => n.lane === lane).sort((a,b) => a.time_ms-b.time_ms);
    const lanePresses = presses.filter(p => p.lane === lane).sort((a,b) => a.time_ms-b.time_ms);
    let cursor = 0;
    const used = new Set();
    for (const note of laneNotes) {
      const target = Number(note.time_ms) + offsetMs;
      while (cursor < lanePresses.length && lanePresses[cursor].time_ms < target - windowMs) cursor++;
      let bestIndex = -1;
      let bestDistance = windowMs + 1;
      for (let j = Math.max(0, cursor - 1); j < Math.min(lanePresses.length, cursor + 4); j++) {
        if (used.has(j)) continue;
        const distance = Math.abs(lanePresses[j].time_ms - target);
        if (distance <= windowMs && distance < bestDistance) { bestDistance = distance; bestIndex = j; }
      }
      if (bestIndex >= 0) {
        used.add(bestIndex);
        const press = lanePresses[bestIndex];
        const delta = press.time_ms - target;
        const match = { note, press, delta_ms: delta };
        matches.push(match);
        matchByNote.set(note._id, match);
        matchByPress.set(press.id, match);
        extraPressIds.delete(press.id);
        offsets.push(delta);
        if (bestIndex >= cursor) cursor = bestIndex + 1;
      } else missedNoteIds.add(note._id);
    }
  }
  const abs = offsets.map(Math.abs).sort((a,b) => a-b);
  return {
    matches, missedNoteIds, extraPressIds, matchByNote, matchByPress, offsets,
    medianAbsolute: median(abs) ?? 9999,
    coveredNotes,
    coverage: { start: firstInputChart, end: lastInputChart },
  };
}

function matchDodges(events, presses, offsetMs, windowMs = 500) {
  const mappings = state.viz.bundle?.mappings?.event_types || {};
  const dodgeEvents = (events || []).filter(event => (mappings[event.name]?.category || "") === "dodge");
  const used = new Set();
  const attempts = [];
  for (const event of dodgeEvents) {
    const expected = Number(event.time_ms) + offsetMs;
    let best = -1, distance = windowMs + 1;
    for (let i = 0; i < presses.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(presses[i].time_ms - expected);
      if (d <= windowMs && d < distance) { distance = d; best = i; }
    }
    if (best >= 0) {
      used.add(best);
      attempts.push({ event, press: presses[best], delta_ms: presses[best].time_ms - expected, matched: true });
    } else attempts.push({ event, press: null, delta_ms: null, matched: false });
  }
  return { attempts, matched: attempts.filter(v => v.matched).length, missed: attempts.filter(v => !v.matched).length, extras: presses.length - used.size };
}

function matchHazards(notes, presses, offsetMs, windowMs) {
  const attempts = [];
  const hitPressIds = new Set();
  const byLane = new Map();
  for (const press of presses) {
    if (!byLane.has(press.lane)) byLane.set(press.lane, []);
    byLane.get(press.lane).push(press);
  }
  for (const note of notes) {
    const lanePresses = (byLane.get(note.lane) || []).sort((a,b) => a.time_ms - b.time_ms);
    const expected = Number(note.time_ms) + offsetMs;
    let best = null;
    for (const press of lanePresses) {
      if (hitPressIds.has(press.id)) continue;
      const distance = Math.abs(Number(press.time_ms) - expected);
      if (distance > windowMs) continue;
      if (!best || distance < best.distance) best = { press, distance, delta_ms: Number(press.time_ms) - expected };
    }
    const attempt = { note, press: best?.press || null, delta_ms: best?.delta_ms ?? null, hit: Boolean(best) };
    if (best) hitPressIds.add(best.press.id);
    attempts.push(attempt);
  }
  return { attempts, hitPressIds, hitCount: attempts.filter(v => v.hit).length, avoidedCount: attempts.filter(v => !v.hit).length };
}

function recomputeComparison() {
  const notes = expectedChartNotes().map((note, index) => ({ ...note, _id: index }));
  if (state.viz.bundle) {
    const player = state.viz.bundle.notes.filter(n => n.owner === "player" && n.lane !== null && n.lane !== undefined);
    let i = 0;
    for (const note of player) note._id = i++;
  }
  if (!state.viz.attempt || !state.viz.comparisonEnabled) {
    state.viz.comparison = null;
    updateVisualizerStats(); drawVisualizer(); drawTimeline();
    return;
  }
  const windows = getChartWindows();
  const actualNotes = expectedChartNotes();
  actualNotes.forEach((note, index) => { note._id = index; });
  const result = matchChart(actualNotes, lanePresses(), state.viz.offsetMs, windows.outer);
  const hazardNotes = expectedHazardNotes();
  const unmatchedPresses = lanePresses().filter(press => !result.matchByPress.has(press.id));
  result.hazards = matchHazards(hazardNotes, unmatchedPresses, state.viz.offsetMs, windows.outer);
  for (const id of result.hazards.hitPressIds) result.extraPressIds.delete(id);
  result.dodges = matchDodges(state.viz.bundle.events, dodgePresses(), state.viz.offsetMs, Number(state.settings?.chart?.event_window_ms || 500));
  state.viz.comparison = result;
  updateVisualizerStats(); drawVisualizer(); drawTimeline();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2;
}

function judgmentFor(delta) {
  const abs = Math.abs(delta);
  const windows = getChartWindows();
  if (abs <= windows.sick) return "Sick";
  if (abs <= windows.good) return "Good";
  if (abs <= windows.bad) return "Bad";
  if (abs <= windows.outer) return "Shit";
  return "Miss";
}

function comparisonStats() {
  const comparison = state.viz.comparison;
  if (!comparison) return null;
  const counts = { Sick: 0, Good: 0, Bad: 0, Shit: 0, Miss: comparison.missedNoteIds.size };
  const weights = { Sick: 1, Good: .75, Bad: .5, Shit: .25, Miss: 0, Extra: 0, Ghost: 0 };
  for (const match of comparison.matches) counts[judgmentFor(match.delta_ms)]++;
  const rawExtras = comparison.extraPressIds.size;
  if (rawExtras) counts[state.viz.ghostTapping ? 'Ghost' : 'Extra'] = rawExtras;
  const judgmentTotal = ['Sick','Good','Bad','Shit','Miss'].reduce((sum, name) => sum + (counts[name] || 0), 0);
  const penalizedExtras = state.viz.ghostTapping ? 0 : rawExtras;
  const hazardHits = comparison.hazards?.hitCount || 0;
  const scoreTotal = judgmentTotal + penalizedExtras + hazardHits;
  const weighted = Object.entries(counts).reduce((sum,[name,count]) => sum + count * (weights[name] ?? 0), 0);
  return {
    counts,
    total: judgmentTotal,
    accuracy: scoreTotal ? weighted / scoreTotal * 100 : null,
    hitRate: judgmentTotal ? comparison.matches.length / judgmentTotal * 100 : null,
    medianAbs: median(comparison.offsets.map(Math.abs)),
    extras: rawExtras,
    hazards: { hits: comparison.hazards?.hitCount || 0, avoided: comparison.hazards?.avoidedCount || 0, total: (comparison.hazards?.hitCount || 0) + (comparison.hazards?.avoidedCount || 0) },
    penalizedExtras,
    ignoredExtras: state.viz.ghostTapping ? rawExtras : 0,
    early: comparison.offsets.filter(v => v < 0).length,
    late: comparison.offsets.filter(v => v >= 0).length,
  };
}

function updateVisualizerStats() {
  const importedOnly = state.viz.attemptSource === 'imported' && !state.viz.comparisonEnabled;
  const stats = comparisonStats();
  const windows = getChartWindows();
  $("#statAccuracy").textContent = stats ? `${formatNumber(stats.accuracy, 2)}%` : "—";
  $("#statHitRate").textContent = stats ? `${formatNumber(stats.hitRate, 2)}%` : "—";
  $("#statMedianAbs").textContent = stats?.medianAbs != null ? `${formatNumber(stats.medianAbs, 1)} ms` : "—";
  $("#statExtras").textContent = stats
    ? (state.viz.ghostTapping && stats.extras ? `${formatNumber(stats.extras)} ignored` : formatNumber(stats.extras))
    : "—";
  const authoredHazardCount = expectedHazardNotes().length;
  if ($("#statHazards")) $("#statHazards").textContent = stats ? formatNumber(stats.hazards.hits) : `${formatNumber(authoredHazardCount)} authored`;
  if (importedOnly) {
    $("#judgmentList").innerHTML = `<div class="list-sub">Imported replay mode. Inputs can be watched and overlaid, but reconstructed accuracy is intentionally disabled.</div>`;
  } else {
    $("#judgmentList").innerHTML = stats
      ? Object.entries(stats.counts).map(([name,count]) => `<div class="judgment-row"><span>${name}</span><b>${formatNumber(count)}</b></div>`).join("") + `<div class="divider"></div><div class="judgment-row"><span>Early / late</span><b>${stats.early} / ${stats.late}</b></div><div class="judgment-row"><span>Windows</span><b>S ${formatNumber(windows.sick,0)} · G ${formatNumber(windows.good,0)} · B ${formatNumber(windows.bad,0)} · Sh ${formatNumber(windows.outer,0)}</b></div>${stats.hazards.total ? `<div class="divider"></div><div class="judgment-row"><span>Hazards avoided / hit</span><b>${formatNumber(stats.hazards.avoided)} / ${formatNumber(stats.hazards.hits)}</b></div>` : ''}`
      : `<div class="list-sub">Load a saved attempt to reconstruct judgments.</div>`;
  }
  const dodges = state.viz.comparison?.dodges;
  const hazards = state.viz.comparison?.hazards;
  $("#dodgeMatched").textContent = dodges ? formatNumber(dodges.matched) : "—";
  $("#dodgeMissed").textContent = dodges ? formatNumber(dodges.missed) : "—";
  if ($("#hazardAvoided")) $("#hazardAvoided").textContent = hazards ? formatNumber(hazards.avoidedCount) : `${formatNumber(authoredHazardCount)} authored`;
  if ($("#hazardHit")) $("#hazardHit").textContent = hazards ? formatNumber(hazards.hitCount) : "—";
  updateEventsNow();
}

function updateVizButtons() {
  $("#opponentToggle").textContent = `Opponent ${state.viz.showOpponent ? "on" : "off"}`;
  $("#eventsToggle").textContent = `Events ${state.viz.showEvents ? "on" : "off"}`;
  $("#xrayToggle").textContent = `X-ray ${state.viz.xray ? "on" : "off"}`;
  $("#splashToggle").textContent = `Splashes ${state.viz.showSplashes ? "on" : "off"}`;
  $("#downscrollToggle").textContent = `Downscroll ${state.viz.downscroll ? "on" : "off"}`;
  $("#ghostToggle").textContent = `Ghost tapping ${state.viz.ghostTapping ? "on" : "off"}`;
}

function audioElements() {
  return [$("#instrumentalAudio"), $("#vocalsAudio")].filter(Boolean);
}

function audioElement(kind) {
  return kind === "vocals" ? $("#vocalsAudio") : $("#instrumentalAudio");
}

function primaryAudio() {
  if (state.viz.audioReady.instrumental) return $("#instrumentalAudio");
  if (state.viz.audioReady.vocals) return $("#vocalsAudio");
  return null;
}

function syncAudioTracks(force = false) {
  const target = state.viz.currentMs / 1000;
  const primary = primaryAudio();
  for (const audio of audioElements()) {
    const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
    if (!state.viz.audioReady[kind]) continue;
    audio.playbackRate = state.viz.playbackRate;
    if (force || Math.abs(audio.currentTime - target) > 0.045) {
      try { audio.currentTime = Math.max(0, target); } catch (_) {}
    }
  }
  if (primary) {
    for (const audio of audioElements()) {
      if (audio === primary) continue;
      const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
      if (state.viz.audioReady[kind] && Math.abs(audio.currentTime - primary.currentTime) > 0.035) {
        try { audio.currentTime = primary.currentTime; } catch (_) {}
      }
    }
  }
}

function togglePlayback() {
  if (!state.viz.bundle) return;
  state.viz.playing = !state.viz.playing;
  state.viz.lastFrame = performance.now();
  if (primaryAudio()) {
    syncAudioTracks(true);
    for (const audio of audioElements()) {
      const kind = audio.id === "vocalsAudio" ? "vocals" : "instrumental";
      if (!state.viz.audioReady[kind]) continue;
      if (state.viz.playing) audio.play().catch(() => {});
      else audio.pause();
    }
  }
  updatePlayButton();
}

function updatePlayButton() { $("#playButton").textContent = state.viz.playing ? "Ⅱ" : "▶"; }

function seekTo(ms) {
  state.viz.currentMs = Math.max(0, Math.min(state.viz.durationMs || 0, Number(ms || 0)));
  syncAudioTracks(true);
  updateTimeUI(); drawVisualizer(); drawTimeline(); updateEventsNow();
}

function setAudioVolume(kind, rawValue) {
  const value = Math.max(0, Math.min(1, Number(rawValue) / 100));
  state.viz.audioVolumes[kind] = value;
  const audio = audioElement(kind);
  if (audio) audio.volume = value;
  const output = kind === "vocals" ? $("#vocalsVolumeLabel") : $("#instrumentalVolumeLabel");
  if (output) output.textContent = `${Math.round(value * 100)}%`;
}

function updateAudioStatus() {
  const instrumental = state.viz.audioNames.instrumental || "none";
  const vocals = state.viz.audioNames.vocals || "none";
  $("#audioStatus").textContent = `Instrumental: ${instrumental} · Vocals: ${vocals}`;
}

function clearAudio(kind) {
  const audio = audioElement(kind);
  if (!audio) return;
  audio.pause();
  if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
  audio.removeAttribute("src");
  audio.load();
  audio.dataset.url = "";
  state.viz.audioReady[kind] = false;
  state.viz.audioNames[kind] = "";
  const input = kind === "vocals" ? $("#vocalsFile") : $("#instrumentalFile");
  if (input) input.value = "";
  updateAudioStatus();
  toast(`${kind === "vocals" ? "Vocals" : "Instrumental"} cleared.`);
}

function attachAudio(event, kind) {
  const file = event.target.files[0];
  if (!file) return;
  const audio = audioElement(kind);
  if (!audio) return;
  if (audio.dataset.url) URL.revokeObjectURL(audio.dataset.url);
  const url = URL.createObjectURL(file);
  audio.dataset.url = url;
  audio.src = url;
  audio.volume = state.viz.audioVolumes[kind] ?? 1;
  audio.playbackRate = state.viz.playbackRate;
  audio.onloadedmetadata = () => {
    state.viz.audioReady[kind] = true;
    state.viz.audioNames[kind] = file.name;
    try { audio.currentTime = state.viz.currentMs / 1000; } catch (_) {}
    updateAudioStatus();
    toast(`Attached ${kind}: ${file.name}. It remains local and is not copied.`);
  };
}

function animationLoop(now) {
  if (state.viz.playing && state.viz.bundle) {
    const primary = primaryAudio();
    if (primary && !primary.paused) {
      state.viz.currentMs = primary.currentTime * 1000;
      syncAudioTracks(false);
    } else {
      const delta = state.viz.lastFrame ? now - state.viz.lastFrame : 0;
      state.viz.currentMs += delta * state.viz.playbackRate;
    }
    state.viz.lastFrame = now;
    if (state.viz.currentMs >= state.viz.durationMs) {
      state.viz.currentMs = state.viz.durationMs;
      state.viz.playing = false;
      for (const audio of audioElements()) audio.pause();
      updatePlayButton();
    }
    updateTimeUI(); drawVisualizer(); drawTimeline(); updateEventsNow();
  }
  requestAnimationFrame(animationLoop);
}

function updateTimeUI() {
  $("#currentTime").textContent = formatTime(state.viz.currentMs);
  $("#durationTime").textContent = formatTime(state.viz.durationMs);
  $("#seekRange").value = state.viz.durationMs ? String(state.viz.currentMs / state.viz.durationMs * 1000) : "0";
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height, dpr };
}

function resizeCanvases() { drawVisualizer(); drawTimeline(); }

const laneColors = ["#c24fa6", "#42ddff", "#55f486", "#ff5571", "#ffd166", "#a98cff", "#ff9f68", "#72d3ff", "#e67cff"];
const eventColors = { dodge: "#ff6b8a", dodge_warning: "#ffd166", lane_transform: "#a98cff", visual: "#75e6ff", presentation: "#73809d", scroll_speed: "#69f0ae", unmapped: "#b9bfd2" };

function drawVisualizer() {
  const canvas = $("#visualizerCanvas");
  if (!canvas) return;
  const { ctx, width, height } = resizeCanvas(canvas);
  ctx.clearRect(0,0,width,height);
  state.viz.renderObjects = [];
  if (!state.viz.bundle) return;

  const showOpp = state.viz.showOpponent && Boolean(state.viz.bundle.notes?.some(note => note.owner === 'opponent'));
  const keyCount = Number(state.viz.bundle.summary.key_count || 4);
  const gap = 18;
  const eventWidth = state.viz.showEvents && ((state.viz.bundle.events?.length || 0) || dodgePresses().length) ? 86 : 0;
  const totalFieldWidth = width - eventWidth - 36;
  const availableSingle = showOpp ? (totalFieldWidth - gap) / 2 : totalFieldWidth;
  const desiredLaneWidth = showOpp ? 67 : 86;
  const fieldWidth = Math.min(availableSingle, keyCount * desiredLaneWidth);
  const occupiedWidth = showOpp ? fieldWidth * 2 + gap : fieldWidth;
  const startX = 18 + Math.max(0, (totalFieldWidth - occupiedWidth) / 2);
  const receptorY = state.viz.downscroll ? height - 74 : 74;
  const direction = state.viz.downscroll ? -1 : 1;
  const pixelsPerMs = .42 * state.viz.scrollScale;
  const aheadDistance = state.viz.downscroll ? receptorY - 18 : height - receptorY - 18;
  const behindDistance = state.viz.downscroll ? height - receptorY + 90 : receptorY + 90;
  const aheadMs = (Math.max(160, aheadDistance) + 100) / pixelsPerMs;
  const behindMs = Math.max(180, behindDistance) / pixelsPerMs;

  ctx.fillStyle = "rgba(255,255,255,.018)";
  ctx.fillRect(0,0,width,height);
  if (showOpp) drawField(ctx, startX, fieldWidth, receptorY, pixelsPerMs, aheadMs, behindMs, direction, "opponent");
  drawField(ctx, showOpp ? startX + fieldWidth + gap : startX, fieldWidth, receptorY, pixelsPerMs, aheadMs, behindMs, direction, "player");
  if (eventWidth) drawEventRail(ctx, width - eventWidth + 4, eventWidth - 10, receptorY, pixelsPerMs, aheadMs, behindMs, direction);
}

function drawField(ctx, x, width, receptorY, pixelsPerMs, aheadMs, behindMs, direction, owner) {
  const keyCount = Number(state.viz.bundle.summary.key_count || 4);
  const laneGap = .5;
  const laneWidth = (width - laneGap * (keyCount - 1)) / keyCount;
  const current = state.viz.currentMs;
  const notes = (state.viz.bundle.notes || []).filter(note => note.owner === owner && note.lane !== null && note.time_ms >= current - behindMs && note.time_ms <= current + aheadMs);
  const isPlayer = owner === "player";
  const fieldHeight = ctx.canvas.getBoundingClientRect().height - 36;

  ctx.save();
  roundRect(ctx, x, 18, width, fieldHeight, 16);
  ctx.fillStyle = "rgba(4,6,12,.58)";
  ctx.fill();
  ctx.clip();
  for (let lane = 0; lane < keyCount; lane++) {
    const lx = x + lane * (laneWidth + laneGap);
    ctx.fillStyle = lane % 2 ? "rgba(255,255,255,.026)" : "rgba(255,255,255,.015)";
    ctx.fillRect(lx, 18, laneWidth, fieldHeight);
    ctx.strokeStyle = "rgba(255,255,255,.055)";
    ctx.strokeRect(lx, 18, laneWidth, fieldHeight);
  }
  ctx.strokeStyle = "rgba(117,230,255,.7)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, receptorY); ctx.lineTo(x + width, receptorY); ctx.stroke();

  if (state.viz.viewMode !== 'inputs') {
    // Holds first so note heads remain readable.
    for (const note of notes) {
      if (Number(note.sustain_ms || 0) <= 0) continue;
      const lane = Number(note.lane);
      const centerX = x + lane * (laneWidth + laneGap) + laneWidth / 2;
      const yStart = receptorY + direction * (Number(note.time_ms) - current) * pixelsPerMs;
      const yEnd = receptorY + direction * (Number(note.end_ms) - current) * pixelsPerMs;
      drawHold(ctx, lane, centerX, laneWidth * .48, yStart, yEnd, isPlayer ? .8 : .28, note);
    }

    for (const note of notes) {
      const lane = Number(note.lane);
      const cx = x + lane * (laneWidth + laneGap) + laneWidth / 2;
      const y = receptorY + direction * (Number(note.time_ms) - current) * pixelsPerMs;
      const size = Math.min(laneWidth * .96, 86);
      let status = isHazardNote(note) ? "hazard" : "normal";
      let match = null;
      let hazardAttempt = null;
      if (isPlayer && state.viz.comparison) {
        if (isHazardNote(note)) {
          hazardAttempt = state.viz.comparison.hazards?.attempts?.find(item => item.note === note) || null;
          status = hazardAttempt?.hit ? "hazard-hit" : "hazard-safe";
        } else {
          match = state.viz.comparison.matchByNote.get(note._id);
          if (match) status = "matched";
          else if (state.viz.comparison.missedNoteIds.has(note._id)) status = "missed";
        }
      }
      drawNote(ctx, lane, cx, y, size, status, isPlayer ? 1 : .24, note);
      if (state.viz.xray && match && Math.abs(y - receptorY) < 160) {
        ctx.fillStyle = match.delta_ms < 0 ? "#75e6ff" : "#ffd166";
        ctx.font = "700 11px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${match.delta_ms >= 0 ? "+" : ""}${Math.round(match.delta_ms)}ms`, cx, y - size * .58 * direction);
      }
      state.viz.renderObjects.push({ type: "note", x: cx-size/2, y: y-size/2, w: size, h: size, data: note, match, hazardAttempt, status });
    }
  }

  if (isPlayer && state.viz.attempt && ["compare","inputs"].includes(state.viz.viewMode)) {
    const presses = lanePresses().filter(press => {
      const chartTime = press.time_ms - state.viz.offsetMs;
      return chartTime >= current - behindMs && chartTime <= current + aheadMs;
    });

    if (state.viz.viewMode === 'inputs') {
      for (const press of presses) {
        if (!(Number(press.held_ms || 0) > 0)) continue;
        const lane = Number(press.lane);
        const cx = x + lane * (laneWidth + laneGap) + laneWidth / 2;
        const chartTime = press.time_ms - state.viz.offsetMs;
        const y1 = receptorY + direction * (chartTime - current) * pixelsPerMs;
        const y2 = receptorY + direction * (chartTime + Number(press.held_ms || 0) - current) * pixelsPerMs;
        drawHold(ctx, lane, cx, laneWidth * .48, y1, y2, .78, null);
      }
    }

    for (const press of presses) {
      const lane = Number(press.lane);
      const cx = x + lane * (laneWidth + laneGap) + laneWidth / 2;
      const chartTime = press.time_ms - state.viz.offsetMs;
      const y = receptorY + direction * (chartTime - current) * pixelsPerMs;
      const match = state.viz.comparison?.matchByPress.get(press.id);
      const extra = state.viz.comparison?.extraPressIds.has(press.id);
      if (state.viz.viewMode === 'inputs') {
        const size = Math.min(laneWidth * .96, 86);
        drawReplayInputNote(ctx, lane, cx, y, size, .98);
        state.viz.renderObjects.push({ type: "input", x: cx-size/2, y: y-size/2, w: size, h: size, data: press, match, extra });
      } else {
        const size = Math.min(laneWidth * .34, 25);
        const penalizedExtra = extra && !state.viz.ghostTapping;
        ctx.beginPath(); ctx.arc(cx, y, size/2, 0, Math.PI*2);
        ctx.fillStyle = penalizedExtra ? "#ff9f68" : extra ? "#75e6ff" : match ? "#69f0ae" : "#f5f7ff";
        ctx.globalAlpha = .74;
        ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.stroke();
        if (press.held_ms > 0) {
          const y2 = receptorY + direction * (chartTime + press.held_ms - current) * pixelsPerMs;
          ctx.strokeStyle = penalizedExtra ? "rgba(255,159,104,.75)" : extra ? "rgba(117,230,255,.55)" : "rgba(105,240,174,.65)";
          ctx.lineWidth = Math.max(3, size*.35); ctx.beginPath(); ctx.moveTo(cx,y); ctx.lineTo(cx,y2); ctx.stroke();
        }
        state.viz.renderObjects.push({ type: "input", x: cx-size/2, y: y-size/2, w: size, h: size, data: press, match, extra });
      }
    }
  }

  // Receptors and current key state.
  for (let lane = 0; lane < keyCount; lane++) {
    const cx = x + lane * (laneWidth + laneGap) + laneWidth / 2;
    const active = isPlayer && inputActiveAt(lane, current);
    drawReceptor(ctx, lane, cx, receptorY, Math.min(laneWidth * .96, 86), active, owner === "opponent" ? .38 : 1);
  }

  if (isPlayer && state.viz.showSplashes) {
    if (state.viz.comparison) {
      for (const match of state.viz.comparison.matches) {
        const hitTime = Number(match.press.time_ms) - state.viz.offsetMs;
        const age = current - hitTime;
        if (age < 0 || age > 265) continue;
        const lane = Number(match.note.lane);
        const cx = x + lane * (laneWidth + laneGap) + laneWidth / 2;
        drawAtlasSplash(ctx, lane, cx, receptorY, Math.min(laneWidth * .96, 86), age, judgmentFor(match.delta_ms), match.note, false);
      }
      for (const hazard of state.viz.comparison.hazards?.attempts || []) {
        if (!hazard.hit) continue;
        const hitTime = Number(hazard.press.time_ms) - state.viz.offsetMs;
        const age = current - hitTime;
        if (age < 0 || age > 265) continue;
        const lane = Number(hazard.note.lane);
        const cx = x + lane * (laneWidth + laneGap) + laneWidth / 2;
        drawAtlasSplash(ctx, lane, cx, receptorY, Math.min(laneWidth * .96, 86), age, 'Sick', hazard.note, true);
      }
    } else if ((state.viz.attemptSource === 'imported' || state.viz.viewMode === 'inputs') && splashAtlas.loaded) {
      for (const press of lanePresses()) {
        const hitTime = Number(press.time_ms) - state.viz.offsetMs;
        const age = current - hitTime;
        if (age < 0 || age > 265) continue;
        const lane = Number(press.lane);
        const cx = x + lane * (laneWidth + laneGap) + laneWidth / 2;
        drawAtlasSplash(ctx, lane, cx, receptorY, Math.min(laneWidth * .96, 86), age, 'Sick', press, false);
      }
    }
  }

  ctx.fillStyle = owner === "player" ? "rgba(117,230,255,.85)" : "rgba(255,255,255,.35)";
  ctx.font = "800 11px system-ui"; ctx.textAlign = "left";
  ctx.fillText(owner === "player" ? "PLAYER" : "OPPONENT", x+9, state.viz.downscroll ? fieldHeight + 9 : 36);
  ctx.restore();
}

function inputActiveAt(lane, chartTime) {
  if (!state.viz.attempt) return false;
  return lanePresses().some(press => press.lane === lane && chartTime >= press.time_ms - state.viz.offsetMs && chartTime <= press.time_ms - state.viz.offsetMs + Math.max(55, press.held_ms || 0));
}

function drawReceptor(ctx, lane, cx, cy, size, active, alpha) {
  ctx.save(); ctx.globalAlpha = alpha;
  const frame = (active ? atlas.pressed : atlas.receptors)[lane % 4];
  if (state.viz.theme === "fnf" && atlas.loaded) {
    ctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, cx-size/2, cy-size/2, size, size);
  } else {
    ctx.fillStyle = active ? laneColors[lane % laneColors.length] : "rgba(255,255,255,.09)";
    ctx.strokeStyle = laneColors[lane % laneColors.length]; ctx.lineWidth = 2;
    roundRect(ctx, cx-size/2, cy-size/2, size, size, size*.24); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "white"; ctx.font = `900 ${size*.35}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(["←","↓","↑","→"][lane%4], cx, cy+1);
  }
  ctx.restore();
}

function drawReplayInputNote(ctx, lane, cx, cy, size, alpha) {
  ctx.save(); ctx.globalAlpha = alpha;
  const frame = atlas.notes[lane % 4];
  if (state.viz.theme === 'fnf' && atlas.loaded) {
    ctx.drawImage(atlas.image, frame.x, frame.y, frame.w, frame.h, cx-size/2, cy-size/2, size, size);
  } else {
    ctx.fillStyle = laneColors[lane % laneColors.length];
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, cx-size/2, cy-size/2, size, size, size*.24); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'white'; ctx.font = `900 ${size*.35}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(['←','↓','↑','→'][lane%4], cx, cy+1);
  }
  ctx.restore();
}

function drawNote(ctx, lane, cx, cy, size, status, alpha, note) {
  if (state.viz.viewMode === "inputs") return;
  ctx.save(); ctx.globalAlpha = alpha;
  const hazard = isHazardNote(note);
  if (status === "missed") { ctx.shadowColor = "#ff6b8a"; ctx.shadowBlur = 18; }
  else if (status === "matched") { ctx.shadowColor = "#69f0ae"; ctx.shadowBlur = 10; }
  else if (status === 'hazard-hit') { ctx.shadowColor = '#ff3b30'; ctx.shadowBlur = 18; }
  else if (status === 'hazard-safe') { ctx.shadowColor = '#8dff9a'; ctx.shadowBlur = 8; }
  const frameSet = hazard && hurtAtlas.loaded ? hurtAtlas.notes : atlas.notes;
  const frame = frameSet[lane % 4];
  if (state.viz.theme === "fnf" && frame?.w) {
    const image = hazard && hurtAtlas.loaded ? hurtAtlas.image : atlas.image;
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, cx-size/2, cy-size/2, size, size);
  } else {
    ctx.fillStyle = hazard ? "#ff5a6e" : laneColors[lane % laneColors.length];
    if (status === "missed") ctx.fillStyle = "#ff6b8a";
    if (status === 'hazard-safe') ctx.fillStyle = '#ff6a7d';
    roundRect(ctx, cx-size/2, cy-size/2, size, size, size*.28); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.font = `900 ${size*.34}px system-ui`; ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(["←","↓","↑","→"][lane%4],cx,cy);
  }
  if (note.note_type && state.viz.xray) {
    ctx.fillStyle = "#fff"; ctx.font="700 9px system-ui";ctx.textAlign="center";ctx.fillText(note.note_type,cx,cy+size*.66);
  }
  ctx.restore();
}


function drawAtlasSplash(ctx, lane, cx, cy, receptorSize, ageMs, judgment, seedObject, useHurt = false) {
  const atlasSource = useHurt ? hurtSplashAtlas : splashAtlas;
  if (!atlasSource.loaded || ['Bad', 'Shit', 'Miss'].includes(judgment)) return;
  const laneFrames = atlasSource.frames[['purple','blue','green','red'][lane % 4]];
  if (!laneFrames) return;
  const seed = Math.abs(Math.round(Number(seedObject?.time_ms ?? seedObject?.id ?? 0)) + lane * 31);
  const variant = laneFrames[seed % laneFrames.length];
  const frameIndex = Math.min(variant.length - 1, Math.floor(Math.max(0, ageMs) / (265 / variant.length)));
  const frame = variant[frameIndex];
  if (!frame) return;
  const opacity = judgment === 'Good' ? .68 : 1;
  const targetFull = receptorSize * 2.6;
  const scale = targetFull / Math.max(frame.fw || frame.w, frame.fh || frame.h, 1);
  const fullW = (frame.fw || frame.w) * scale;
  const fullH = (frame.fh || frame.h) * scale;
  const dx = cx - fullW / 2 + (-(frame.fx || 0)) * scale;
  const dy = cy - fullH / 2 + (-(frame.fy || 0)) * scale;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(atlasSource.image, frame.x, frame.y, frame.w, frame.h, dx, dy, frame.w * scale, frame.h * scale);
  ctx.restore();
}

function drawHold(ctx, lane, cx, width, yStart, yEnd, alpha, note = null) {
  ctx.save(); ctx.globalAlpha = alpha;
  const top = Math.min(yStart,yEnd), bottom = Math.max(yStart,yEnd);
  const hazard = note && isHazardNote(note);
  const color = hazard ? '#ff5a6e' : laneColors[lane % laneColors.length];
  if (state.viz.theme === 'fnf' && hazard && hurtAtlas.loaded && hurtAtlas.holdPieces[lane % 4]?.w) {
    const bodyFrame = hurtAtlas.holdPieces[lane % 4];
    const endFrame = hurtAtlas.holdEnds[lane % 4];
    const bodyX = cx - width / 2;
    const bodyH = Math.max(6, bottom - top - width * .78);
    ctx.drawImage(hurtAtlas.image, bodyFrame.x, bodyFrame.y, bodyFrame.w, bodyFrame.h, bodyX, top + width * .24, width, bodyH);
    ctx.drawImage(hurtAtlas.image, endFrame.x, endFrame.y, endFrame.w, endFrame.h, bodyX, bottom - width * .58, width, width * .78);
  } else {
    ctx.fillStyle = color; ctx.globalAlpha *= .65;
    roundRect(ctx, cx-width/2, top, width, Math.max(5,bottom-top), width/2); ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fillRect(cx-width*.13, top+4, width*.14, Math.max(1,bottom-top-8));
  }
  ctx.restore();
}

function drawEventRail(ctx, x, width, receptorY, pixelsPerMs, aheadMs, behindMs, direction) {
  const current = state.viz.currentMs;
  const mappings = state.viz.bundle.mappings?.event_types || {};
  const events = state.viz.bundle.events.filter(event => event.time_ms >= current - behindMs && event.time_ms <= current + aheadMs);
  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,.7)"; roundRect(ctx,x,18,width,ctx.canvas.getBoundingClientRect().height-36,14);ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.55)";ctx.font="800 10px system-ui";ctx.textAlign="center";ctx.fillText("MECH",x+width/2,36);
  for (const event of events) {
    const category = mappings[event.name]?.category || "unmapped";
    const y = receptorY + direction * (Number(event.time_ms)-current)*pixelsPerMs;
    const color = eventColors[category] || eventColors.unmapped;
    ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(x+8,y);ctx.lineTo(x+18,y-7);ctx.lineTo(x+18,y+7);ctx.closePath();ctx.fill();
    if (state.viz.xray || Math.abs(y-receptorY)<120) {
      ctx.fillStyle="rgba(245,247,255,.9)";ctx.font="700 9px system-ui";ctx.textAlign="left";ctx.fillText(event.name.slice(0,13),x+23,y+3);
    }
    state.viz.renderObjects.push({ type:"event", x:x+5,y:y-9,w:width-10,h:18,data:event,category });
  }
  for (const press of dodgePresses()) {
    const chartTime = Number(press.time_ms) - state.viz.offsetMs;
    if (chartTime < current - behindMs || chartTime > current + aheadMs) continue;
    const y = receptorY + direction * (chartTime-current)*pixelsPerMs;
    ctx.save();
    ctx.translate(x+14,y); ctx.rotate(Math.PI/4);
    ctx.fillStyle="#ff6b8a"; ctx.fillRect(-6,-6,12,12);
    ctx.restore();
    if (state.viz.xray || Math.abs(y-receptorY)<120) {
      ctx.fillStyle="rgba(245,247,255,.9)";ctx.font="700 9px system-ui";ctx.textAlign="left";ctx.fillText("DODGE",x+25,y+3);
    }
    state.viz.renderObjects.push({ type:"dodge_input", x:x+5,y:y-10,w:width-10,h:20,data:press,category:"dodge" });
  }
  ctx.restore();
}

function drawTimeline() {
  const canvas = $("#timelineCanvas");
  if (!canvas) return;
  const { ctx, width, height } = resizeCanvas(canvas);
  ctx.clearRect(0,0,width,height);
  if (!state.viz.bundle || !state.viz.durationMs) return;
  const duration = state.viz.durationMs;
  const bins = Math.max(60, Math.floor(width/4));
  const counts = new Array(bins).fill(0);
  const playerNotes = (state.viz.bundle.notes || []).filter(note => note.owner === "player");
  if (playerNotes.length) {
    for (const note of playerNotes) {
      const index = Math.min(bins-1, Math.max(0, Math.floor(Number(note.time_ms)/duration*bins)));
      counts[index]++;
    }
  } else {
    for (const press of lanePresses()) {
      const chartTime = Number(press.time_ms) - state.viz.offsetMs;
      const index = Math.min(bins-1, Math.max(0, Math.floor(chartTime/duration*bins)));
      counts[index]++;
    }
  }
  const max = Math.max(1,...counts);
  for (let i=0;i<bins;i++) {
    const h=counts[i]/max*(height-24);
    ctx.fillStyle="rgba(117,230,255,.28)";ctx.fillRect(i/bins*width,height-h,(width/bins)+1,h);
  }
  if (state.viz.showEvents) {
    const mappings=state.viz.bundle.mappings?.event_types||{};
    for (const event of state.viz.bundle.events) {
      const x=Number(event.time_ms)/duration*width;
      const category=mappings[event.name]?.category||"unmapped";
      ctx.strokeStyle=eventColors[category]||eventColors.unmapped;ctx.globalAlpha=.7;ctx.beginPath();ctx.moveTo(x,4);ctx.lineTo(x,18);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  if (state.viz.comparison) {
    ctx.fillStyle="#ff6b8a";
    for (const noteId of state.viz.comparison.missedNoteIds) {
      const note=expectedChartNotes()[noteId];if(!note)continue;const x=Number(note.time_ms)/duration*width;ctx.fillRect(x-1,0,2,height);
    }
  }
  if (state.viz.comparison?.extraPressIds?.size) {
    ctx.fillStyle = state.viz.ghostTapping ? "rgba(117,230,255,.65)" : "rgba(255,159,104,.85)";
    for (const pressId of state.viz.comparison.extraPressIds) {
      const press = lanePresses().find(item => item.id === pressId);
      if (!press) continue;
      const x = (Number(press.time_ms)-state.viz.offsetMs)/duration*width;
      ctx.fillRect(x-1,height-12,2,12);
    }
  }
  if (state.viz.comparison?.hazards?.attempts?.length) {
    for (const attempt of state.viz.comparison.hazards.attempts) {
      const x = Number(attempt.note.time_ms)/duration*width;
      ctx.fillStyle = attempt.hit ? 'rgba(255,59,48,.95)' : 'rgba(141,255,154,.65)';
      ctx.fillRect(x-1, height-24, 2, 10);
    }
  }
  for (const press of dodgePresses()) {
    const x=(Number(press.time_ms)-state.viz.offsetMs)/duration*width;
    ctx.fillStyle="#ff6b8a";ctx.fillRect(x-1,0,2,10);
  }
  const currentX=state.viz.currentMs/duration*width;
  ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(currentX,0);ctx.lineTo(currentX,height);ctx.stroke();
}

function updateEventsNow() {
  const container=$("#eventsNow");
  if(!state.viz.bundle){container.innerHTML='<div class="list-sub">No chart loaded.</div>';return;}
  const mappings=state.viz.bundle.mappings?.event_types||{};
  const nearby=state.viz.bundle.events.filter(event=>Math.abs(Number(event.time_ms)-state.viz.currentMs)<=350).slice(0,8);
  const nearbyDodges=dodgePresses().filter(press=>Math.abs((Number(press.time_ms)-state.viz.offsetMs)-state.viz.currentMs)<=350).slice(0,4);
  const eventHtml=nearby.map(event=>`<div class="event-chip" style="border-left-color:${eventColors[mappings[event.name]?.category||"unmapped"]||eventColors.unmapped}"><b>${escapeHtml(event.name)}</b><div class="list-sub">${formatTime(event.time_ms)} · ${escapeHtml(event.value1||"")} ${escapeHtml(event.value2||"")}</div></div>`).join("");
  const dodgeHtml=nearbyDodges.map(press=>`<div class="event-chip" style="border-left-color:#ff6b8a"><b>Dodge input</b><div class="list-sub">${formatTime(Number(press.time_ms)-state.viz.offsetMs)} · ${escapeHtml(String(press.key||'').toUpperCase())}</div></div>`).join("");
  container.innerHTML=(eventHtml||dodgeHtml)?eventHtml+dodgeHtml:'<div class="list-sub">No event within ±350 ms.</div>';
}

function inspectCanvasObject(event) {
  const rect=event.currentTarget.getBoundingClientRect();
  const x=event.clientX-rect.left,y=event.clientY-rect.top;
  const objects=[...state.viz.renderObjects].reverse();
  const found=objects.find(object=>x>=object.x&&x<=object.x+object.w&&y>=object.y&&y<=object.y+object.h);
  if(!found)return;
  state.viz.selectedObject=found;
  if(found.type==="note"){
    const n=found.data;const m=found.match;const h=found.hazardAttempt;
    $("#objectInspector").innerHTML=`<b>${isHazardNote(n)?'Hazard note':'Chart note'}</b><div class="divider"></div><div class="mono">Time: ${formatTime(n.time_ms)}<br>Lane: ${Number(n.lane)+1}<br>Hold: ${formatNumber(n.sustain_ms,1)} ms<br>Type: ${escapeHtml(n.note_type||"normal")}<br>Status: ${escapeHtml(found.status)}${m?`<br>Input: ${formatTime(m.press.time_ms-state.viz.offsetMs)}<br>Offset: ${m.delta_ms>=0?"+":""}${formatNumber(m.delta_ms,2)} ms<br>Judgment: ${judgmentFor(m.delta_ms)}`:''}${h?.hit?`<br>Hazard press: ${formatTime(h.press.time_ms-state.viz.offsetMs)}<br>Hazard offset: ${h.delta_ms>=0?'+':''}${formatNumber(h.delta_ms,2)} ms`:''}</div>`;
  }else if(found.type==="input"){
    const p=found.data;const hazardMatch = state.viz.comparison?.hazards?.attempts?.find(item => item.press?.id === p.id);
    $("#objectInspector").innerHTML=`<b>Physical input</b><div class="divider"></div><div class="mono">Time: ${formatTime(p.time_ms-state.viz.offsetMs)}<br>Key: ${escapeHtml(p.key.toUpperCase())}<br>Lane: ${Number(p.lane)+1}<br>Held: ${formatNumber(p.held_ms,1)} ms<br>${hazardMatch?`Hurt note hit · ${hazardMatch.delta_ms>=0?"+":""}${formatNumber(hazardMatch.delta_ms,2)} ms`:found.extra?(state.viz.ghostTapping?"Ghost tap · ignored":"Extra press · penalized"):found.match?`Matched · ${found.match.delta_ms>=0?"+":""}${formatNumber(found.match.delta_ms,2)} ms`:"Unclassified"}</div>`;
  }else if(found.type==="dodge_input"){
    const p=found.data;$("#objectInspector").innerHTML=`<b>Dodge input</b><div class="divider"></div><div class="mono">Time: ${formatTime(Number(p.time_ms)-state.viz.offsetMs)}<br>Key: ${escapeHtml(String(p.key||'').toUpperCase())}<br>Held: ${formatNumber(p.held_ms,1)} ms</div>`;
  }else{
    const e=found.data;$("#objectInspector").innerHTML=`<b>${escapeHtml(e.name)}</b><div class="divider"></div><div class="mono">Time: ${formatTime(e.time_ms)}<br>Category: ${escapeHtml(found.category)}<br>Value 1: ${escapeHtml(e.value1||"")}<br>Value 2: ${escapeHtml(e.value2||"")}</div>`;
  }
}

function roundRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

init();
