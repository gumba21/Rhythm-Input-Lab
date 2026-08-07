"use strict";

(() => {
  const AUDIO_EXTENSIONS = new Set(["ogg", "mp3", "wav", "flac", "m4a", "aac", "opus", "webm"]);
  const normalizedPath = file => String(file.webkitRelativePath || file.name || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const pathStem = path => (String(path || "").split("/").pop() || "").replace(/\.[^.]+$/, "");
  const pathExtension = path => (String(path || "").match(/\.([^./]+)$/)?.[1] || "").toLowerCase();
  const slug = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "song";
  const titleCaseSlug = value => String(value || "song").replace(/[-_]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
  const chartRoot = parsed => parsed?.song && typeof parsed.song === "object" ? parsed.song : parsed;
  const isCodenameChart = parsed => Boolean(parsed && typeof parsed === "object" && (parsed.codenameChart === true || Array.isArray(parsed.strumLines)));
  const isLegacyChart = parsed => {
    const song = chartRoot(parsed);
    return Boolean(song && typeof song === "object" && Array.isArray(song.notes) && song.notes.some(section => Array.isArray(section?.sectionNotes)));
  };
  const isEventsOnly = (parsed, filename) => {
    if (/^events?\.json$/i.test(filename)) return true;
    const song = chartRoot(parsed);
    return (Array.isArray(parsed?.events) || Array.isArray(song?.events)) && !isCodenameChart(parsed) && !isLegacyChart(parsed);
  };

  function chartStats(parsed) {
    if (isCodenameChart(parsed)) {
      const lines = Array.isArray(parsed.strumLines) ? parsed.strumLines : [];
      const notes = lines.reduce((total, line) => total + (Array.isArray(line?.notes) ? line.notes.length : 0), 0);
      return { format: "Codename", notes, events: Array.isArray(parsed.events) ? parsed.events.length : 0 };
    }
    const song = chartRoot(parsed) || {};
    const sections = Array.isArray(song.notes) ? song.notes : [];
    return {
      format: "Legacy/Psych",
      notes: sections.reduce((total, section) => total + (Array.isArray(section?.sectionNotes) ? section.sectionNotes.length : 0), 0),
      events: (Array.isArray(song.events) ? song.events : Array.isArray(parsed?.events) ? parsed.events : []).length,
    };
  }

  function songNameFromChart(parsed, fallback) {
    if (isCodenameChart(parsed)) {
      const meta = parsed.meta && typeof parsed.meta === "object" ? parsed.meta : {};
      return String(parsed.songName || meta.name || (typeof parsed.song === "string" ? parsed.song : "") || fallback);
    }
    const song = chartRoot(parsed) || {};
    return String(song.song || parsed.songName || fallback);
  }

  function locateChart(path) {
    const normalized = String(path || "").replaceAll("\\", "/");
    const lower = normalized.toLowerCase();
    let match = lower.match(/^((?:.*\/)?songs\/([^/]+))\/charts\/[^/]+\.json$/i);
    if (match) {
      const root = normalized.slice(0, match[1].length);
      return { groupKey: match[1], songSlug: match[2], chartDirectory: `${root}/charts/`, audioPrefixes: [`${root}/song/`, `${root}/songs/`, `${root}/audio/`], layout: "Codename songs/<song>/charts + song" };
    }
    match = lower.match(/^((?:.*\/)?assets)\/data\/([^/]+)\/[^/]+\.json$/i);
    if (match) {
      const root = normalized.slice(0, match[1].length);
      return { groupKey: `${match[1]}/data/${match[2]}`, songSlug: match[2], chartDirectory: `${root}/data/${match[2]}/`, audioPrefixes: [`${root}/songs/${match[2]}/`], layout: "assets/data + assets/songs" };
    }
    match = lower.match(/^((?:.*\/)?data)\/([^/]+)\/[^/]+\.json$/i);
    if (match) {
      const dataRoot = normalized.slice(0, match[1].length);
      const root = dataRoot.replace(/\/data$/i, "");
      return { groupKey: `${match[1]}/${match[2]}`, songSlug: match[2], chartDirectory: `${dataRoot}/${match[2]}/`, audioPrefixes: [`${root}/songs/${match[2]}/`, `${dataRoot}/${match[2]}/`], layout: "data + songs" };
    }
    const parts = normalized.split("/");
    const filename = parts.pop() || "chart.json";
    const parent = parts.join("/");
    const parentName = parts.at(-1) || pathStem(filename);
    const special = /^(charts?|data)$/i.test(parentName);
    const songSlug = special ? (parts.at(-2) || pathStem(filename)) : parentName;
    const root = special ? parts.slice(0, -1).join("/") : parent;
    return { groupKey: root.toLowerCase(), songSlug, chartDirectory: `${parent}/`, audioPrefixes: [`${root}/song/`, `${root}/audio/`, `${parent}/`], layout: "Nearby folder" };
  }

  function difficultyFromPath(path, songSlug) {
    let value = pathStem(path);
    const prefix = new RegExp(`^${slug(songSlug).replaceAll("-", "[-_ ]*")}[-_ ]*`, "i");
    value = value.replace(prefix, "");
    return titleCaseSlug(!value || slug(value) === slug(songSlug) ? "normal" : value);
  }

  function scoreInstrumental(file, group) {
    const path = normalizedPath(file).toLowerCase();
    const stem = pathStem(path).toLowerCase();
    let score = group.audioPrefixes.some(prefix => path.startsWith(prefix.toLowerCase())) ? 100 : 0;
    if (stem === "inst") score += 100;
    else if (/^inst(?:rumental)?(?:[-_ ].*)?$/.test(stem)) score += 85;
    else if (stem.includes("instrumental")) score += 75;
    else if (slug(stem) === slug(group.songSlug)) score += 35;
    if (/voices?|vocals?|voice|boyfriend|dad|opponent|girlfriend/.test(stem)) score -= 100;
    return score;
  }

  function scoreVocal(file, group) {
    const path = normalizedPath(file).toLowerCase();
    const stem = pathStem(path).toLowerCase();
    let score = group.audioPrefixes.some(prefix => path.startsWith(prefix.toLowerCase())) ? 100 : 0;
    if (/^(voices?|vocals?)$/.test(stem)) score += 100;
    else if (/^(voices?|vocals?)[-_ ]/.test(stem)) score += 90;
    else if (/voice|vocal|boyfriend|opponent|dad|girlfriend/.test(stem) || /(^|[-_ ])(?:bf|gf)(?:$|[-_ ])/.test(stem)) score += 65;
    if (/^inst(?:rumental)?/.test(stem)) score -= 150;
    return score;
  }

  function findAudio(group, audioFiles) {
    const candidates = audioFiles.filter(file => {
      const path = normalizedPath(file).toLowerCase();
      return group.audioPrefixes.some(prefix => path.startsWith(prefix.toLowerCase())) || path.split("/").includes(String(group.songSlug).toLowerCase());
    });
    const instrumental = candidates.map(file => ({ file, score: scoreInstrumental(file, group) })).filter(row => row.score > 0).sort((a, b) => b.score - a.score || normalizedPath(a.file).localeCompare(normalizedPath(b.file)))[0]?.file || (candidates.length === 1 ? candidates[0] : null);
    let vocals = candidates.filter(file => file !== instrumental).map(file => ({ file, score: scoreVocal(file, group) })).filter(row => row.score > 30).sort((a, b) => b.score - a.score || normalizedPath(a.file).localeCompare(normalizedPath(b.file))).map(row => row.file);
    if (!vocals.length && candidates.length > 1) vocals = candidates.filter(file => file !== instrumental && scoreInstrumental(file, group) < 60);
    return { instrumental, vocals };
  }

  async function parseFolder(files, progress = () => {}) {
    const allFiles = [...files];
    const audioFiles = allFiles.filter(file => AUDIO_EXTENSIONS.has(pathExtension(file.name)));
    const jsonFiles = allFiles.filter(file => pathExtension(file.name) === "json");
    const parsedRows = [];
    for (let index = 0; index < jsonFiles.length; index += 1) {
      const file = jsonFiles[index];
      progress(`Scanning JSON ${index + 1}/${jsonFiles.length}…`);
      try {
        const content = await file.text();
        parsedRows.push({ file, path: normalizedPath(file), content, parsed: JSON.parse(content.replace(/^\uFEFF/, "")) });
      } catch (error) {
        parsedRows.push({ file, path: normalizedPath(file), error: error.message });
      }
    }
    const eventRows = parsedRows.filter(row => !row.error && isEventsOnly(row.parsed, row.file.name));
    const metadataRows = parsedRows.filter(row => !row.error && /^(meta|metadata|song)\.json$/i.test(row.file.name) && !isCodenameChart(row.parsed) && !isLegacyChart(row.parsed) && !isEventsOnly(row.parsed, row.file.name));
    const chartRows = parsedRows.filter(row => !row.error && (isCodenameChart(row.parsed) || isLegacyChart(row.parsed)));
    const groups = new Map();
    for (const row of chartRows) {
      const location = locateChart(row.path);
      if (!groups.has(location.groupKey)) groups.set(location.groupKey, { ...location, charts: [], events: null, metadata: null, audio: null });
      const group = groups.get(location.groupKey);
      group.charts.push({ ...row, difficulty: difficultyFromPath(row.path, location.songSlug), detectedName: songNameFromChart(row.parsed, titleCaseSlug(location.songSlug)), stats: chartStats(row.parsed), selected: true });
    }
    for (const group of groups.values()) {
      group.events = eventRows.find(row => row.path.toLowerCase().startsWith(group.chartDirectory.toLowerCase()) || row.path.toLowerCase().startsWith(group.groupKey.toLowerCase())) || null;
      group.metadata = metadataRows.find(row => row.path.toLowerCase().startsWith(group.groupKey.toLowerCase().replace(/\/charts$/, "")) || row.path.toLowerCase().startsWith(group.chartDirectory.toLowerCase())) || null;
      group.audio = findAudio(group, audioFiles);
      group.charts.sort((a, b) => a.difficulty.localeCompare(b.difficulty, undefined, { numeric: true }));
      const names = new Set(group.charts.map(chart => slug(chart.detectedName)));
      const meta = group.metadata?.parsed || {};
      group.songName = meta.displayName || meta.songName || meta.name || meta.song?.name || (names.size === 1 ? group.charts[0].detectedName : titleCaseSlug(group.songSlug));
      for (const chart of group.charts) chart.importName = group.charts.length > 1 ? `${group.songName} [${chart.difficulty}]` : group.songName;
    }
    return [...groups.values()].sort((a, b) => a.songName.localeCompare(b.songName, undefined, { numeric: true }));
  }

  window.rilFnfFolderDiscovery = { parseFolder, normalizedPath, pathStem, slug, isCodenameChart, chartStats };
})();
