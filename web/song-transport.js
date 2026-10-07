"use strict";

(() => {
  const q = selector => document.querySelector(selector);
  const STATES = new Set(["unloaded", "loading", "ready", "counting-in", "playing", "paused", "seeking", "finished"]);
  const ALLOWED = {
    unloaded: new Set(["loading"]),
    loading: new Set(["ready", "unloaded"]),
    ready: new Set(["counting-in", "playing", "paused", "seeking", "loading", "unloaded"]),
    "counting-in": new Set(["ready", "playing", "loading", "unloaded"]),
    playing: new Set(["paused", "seeking", "finished", "ready", "loading", "unloaded"]),
    paused: new Set(["playing", "seeking", "ready", "finished", "loading", "unloaded"]),
    seeking: new Set(["playing", "paused", "ready", "finished", "loading", "unloaded"]),
    finished: new Set(["ready", "counting-in", "playing", "paused", "seeking", "loading", "unloaded"]),
  };
  const runtime = {
    sessionId: 0,
    operationId: 0,
    owner: null,
    folder: null,
    lifecycle: "unloaded",
    rate: 1,
    positionMs: 0,
    durationMs: 0,
    anchorMs: 0,
    anchorPerfMs: 0,
    stems: new Map(),
    driftCorrections: 0,
    staleAsyncDrops: 0,
    invalidTransitions: 0,
    lastDriftMs: 0,
    lastOperation: "idle",
  };

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail: { ...detail, sessionId: runtime.sessionId, owner: runtime.owner, folder: runtime.folder, lifecycle: runtime.lifecycle } }));
  }

  function clamp(value, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
    const number = Number(value || 0);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
  }

  function nowLogicalMs() {
    if (runtime.lifecycle !== "playing") return runtime.positionMs;
    const master = masterEntry();
    if (master?.node && !master.node.paused && Number.isFinite(master.node.currentTime)) {
      runtime.positionMs = Math.max(0, master.node.currentTime * 1000);
      runtime.anchorMs = runtime.positionMs;
      runtime.anchorPerfMs = performance.now();
      return runtime.positionMs;
    }
    return runtime.anchorMs + (performance.now() - runtime.anchorPerfMs) * runtime.rate;
  }

  function ensureBaseEntries() {
    const instrumental = q("#instrumentalAudio");
    const vocals = q("#vocalsAudio");
    if (instrumental) {
      const row = runtime.stems.get("instrumental") || {};
      runtime.stems.set("instrumental", { ...row, key: "instrumental", role: "instrumental", node: instrumental, dynamic: false, sessionId: runtime.sessionId, ready: Boolean(row.ready && row.sessionId === runtime.sessionId) });
    }
    if (vocals) {
      const row = runtime.stems.get("vocals") || {};
      runtime.stems.set("vocals", { ...row, key: "vocals", role: "vocals", node: vocals, dynamic: false, sessionId: runtime.sessionId, ready: Boolean(row.ready && row.sessionId === runtime.sessionId) });
    }
  }

  function sourcePresent(node) {
    return Boolean(node && (node.currentSrc || node.src));
  }

  function activeEntries() {
    ensureBaseEntries();
    return [...runtime.stems.values()].filter(row => row.sessionId === runtime.sessionId && row.ready && sourcePresent(row.node));
  }

  function masterEntry() {
    const rows = activeEntries();
    return rows.find(row => row.key === "instrumental")
      || rows.find(row => row.key === "vocals")
      || rows[0]
      || null;
  }

  function currentSession() {
    return { id: runtime.sessionId, owner: runtime.owner, folder: runtime.folder, lifecycle: runtime.lifecycle };
  }

  function isSession(id, owner = null, folder = null) {
    return Number(id) === runtime.sessionId
      && (!owner || owner === runtime.owner)
      && (!folder || folder === runtime.folder);
  }

  function transition(next, sessionId = runtime.sessionId, options = {}) {
    if (!isSession(sessionId) || !STATES.has(next)) return false;
    const current = runtime.lifecycle;
    if (next === current) return true;
    if (!options.force && !ALLOWED[current]?.has(next)) {
      runtime.invalidTransitions += 1;
      emit("ril:transport-invalid-transition", { from: current, to: next });
      return false;
    }
    runtime.lifecycle = next;
    emit("ril:transport-state", { state: next, previousState: current });
    return true;
  }

  function pauseRows(rows = [...runtime.stems.values()]) {
    for (const row of rows) {
      try { row.node?.pause?.(); } catch (_) {}
    }
  }

  function roleVolume(role) {
    const volumes = window.state?.viz?.audioVolumes || {};
    if (role === "instrumental") return clamp(volumes.instrumental ?? 1, 0, 1);
    return clamp(volumes.vocals ?? 1, 0, 1);
  }

  function applyProperties(row) {
    if (!row?.node) return;
    try { row.node.playbackRate = runtime.rate; } catch (_) {}
    try { row.node.volume = roleVolume(row.role); } catch (_) {}
  }

  function setNodeTime(row, targetMs) {
    if (!row?.node || !row.ready || !sourcePresent(row.node)) return;
    const target = Math.max(0, Number(targetMs || 0)) / 1000;
    try {
      const duration = Number(row.node.duration);
      row.node.currentTime = Number.isFinite(duration) && duration > 0 ? Math.min(target, duration) : target;
    } catch (_) {}
  }

  function invalidateOperation(label) {
    runtime.operationId += 1;
    runtime.lastOperation = label;
    return { sessionId: runtime.sessionId, operationId: runtime.operationId };
  }

  function operationCurrent(token) {
    return Boolean(token && token.sessionId === runtime.sessionId && token.operationId === runtime.operationId);
  }

  function setAnchor(ms) {
    runtime.positionMs = Math.max(0, Number(ms || 0));
    runtime.anchorMs = runtime.positionMs;
    runtime.anchorPerfMs = performance.now();
  }

  function beginSession(owner, folder, options = {}) {
    pauseRows();
    runtime.sessionId += 1;
    runtime.operationId += 1;
    runtime.owner = owner || null;
    runtime.folder = folder || null;
    runtime.rate = clamp(options.rate ?? 1, 0.05, 4);
    runtime.durationMs = Math.max(0, Number(options.durationMs || 0));
    setAnchor(options.positionMs || 0);
    runtime.lifecycle = "loading";
    runtime.lastOperation = "begin-session";

    for (const [key, row] of runtime.stems) {
      if (row.dynamic) {
        try { row.node?.pause?.(); } catch (_) {}
        runtime.stems.delete(key);
      } else {
        row.sessionId = runtime.sessionId;
        row.ready = false;
        applyProperties(row);
      }
    }

    if (window.state?.viz?.audioReady) {
      window.state.viz.audioReady.instrumental = false;
      window.state.viz.audioReady.vocals = false;
    }
    if (window.state?.viz?.audioNames) {
      window.state.viz.audioNames.instrumental = "";
      window.state.viz.audioNames.vocals = "";
    }

    emit("ril:transport-session", { state: "loading" });
    return runtime.sessionId;
  }

  function registerStem(key, node, options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) {
      try { node?.pause?.(); } catch (_) {}
      runtime.staleAsyncDrops += 1;
      return false;
    }
    const role = options.role === "instrumental" ? "instrumental" : "vocals";
    const row = {
      key: String(key),
      role,
      node,
      dynamic: Boolean(options.dynamic),
      sessionId,
      ready: options.ready !== false,
    };
    runtime.stems.set(row.key, row);
    applyProperties(row);
    if (row.ready) {
      const target = nowLogicalMs();
      setNodeTime(row, target);
      if (runtime.lifecycle === "playing") playJoinedStem(row, { sessionId: runtime.sessionId, operationId: runtime.operationId });
    }
    emit("ril:transport-stems", { count: activeEntries().length });
    return true;
  }

  function unregisterStem(key, node = null) {
    const row = runtime.stems.get(String(key));
    if (!row || (node && row.node !== node)) return;
    try { row.node?.pause?.(); } catch (_) {}
    runtime.stems.delete(String(key));
    emit("ril:transport-stems", { count: activeEntries().length });
  }

  function markReady(key, node, options = {}) {
    return registerStem(key, node, { ...options, ready: true, dynamic: Boolean(options.dynamic) });
  }

  function markNotReady(key, node = null) {
    const row = runtime.stems.get(String(key));
    if (!row || (node && row.node !== node)) return;
    row.ready = false;
    try { row.node?.pause?.(); } catch (_) {}
  }

  function playJoinedStem(row, token) {
    if (!row?.node || !operationCurrent(token) || runtime.lifecycle !== "playing") return;
    applyProperties(row);
    setNodeTime(row, nowLogicalMs());
    let promise;
    try { promise = row.node.play(); }
    catch (_) { return; }
    if (promise?.then) {
      promise.then(() => {
        if (!operationCurrent(token) || runtime.lifecycle !== "playing") {
          runtime.staleAsyncDrops += 1;
          try { row.node.pause(); } catch (_) {}
        }
      }).catch(() => {});
    }
  }

  function prepare(positionMs, nextState = "ready", options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) return false;
    invalidateOperation("prepare");
    pauseRows(activeEntries());
    setAnchor(positionMs);
    for (const row of activeEntries()) {
      applyProperties(row);
      setNodeTime(row, runtime.positionMs);
    }
    transition(nextState, sessionId);
    emit("ril:transport-position", { positionMs: runtime.positionMs });
    return true;
  }

  function playAt(positionMs = runtime.positionMs, options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) return false;
    const token = invalidateOperation("play");
    const rows = activeEntries();
    pauseRows(rows);
    setAnchor(positionMs);
    for (const row of rows) {
      applyProperties(row);
      setNodeTime(row, runtime.positionMs);
    }
    transition("playing", sessionId);

    const pending = [];
    for (const row of rows) {
      let promise;
      try { promise = row.node.play(); }
      catch (_) { continue; }
      if (promise?.then) {
        pending.push(Promise.resolve(promise).then(() => {
          if (!operationCurrent(token) || runtime.lifecycle !== "playing") {
            runtime.staleAsyncDrops += 1;
            try { row.node.pause(); } catch (_) {}
          }
        }).catch(() => {}));
      }
    }
    if (pending.length) {
      Promise.allSettled(pending).then(() => {
        if (operationCurrent(token) && runtime.lifecycle === "playing") correctDrift(true);
      });
    }
    emit("ril:transport-position", { positionMs: runtime.positionMs });
    return true;
  }

  function pause(nextState = "paused", options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) return false;
    const current = nowLogicalMs();
    invalidateOperation("pause");
    pauseRows(activeEntries());
    setAnchor(current);
    transition(nextState, sessionId);
    emit("ril:transport-position", { positionMs: runtime.positionMs });
    return true;
  }

  function seek(positionMs, options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) return false;
    const resume = Boolean(options.resume);
    invalidateOperation("seek");
    pauseRows(activeEntries());
    setAnchor(clamp(positionMs, 0, runtime.durationMs || Number.POSITIVE_INFINITY));
    transition("seeking", sessionId);
    for (const row of activeEntries()) {
      applyProperties(row);
      setNodeTime(row, runtime.positionMs);
    }
    emit("ril:transport-position", { positionMs: runtime.positionMs });
    if (resume) return playAt(runtime.positionMs, { sessionId });
    transition(options.nextState || "paused", sessionId);
    return true;
  }

  function finish(positionMs = runtime.durationMs || runtime.positionMs, options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) return false;
    invalidateOperation("finish");
    pauseRows(activeEntries());
    setAnchor(positionMs);
    transition("finished", sessionId);
    emit("ril:transport-position", { positionMs: runtime.positionMs });
    return true;
  }

  function setRate(rate, options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) return false;
    const current = nowLogicalMs();
    runtime.rate = clamp(rate, 0.05, 4);
    setAnchor(current);
    for (const row of activeEntries()) applyProperties(row);
    emit("ril:transport-rate", { rate: runtime.rate });
    return true;
  }

  function setDuration(durationMs, options = {}) {
    const sessionId = Number(options.sessionId ?? runtime.sessionId);
    if (!isSession(sessionId)) return false;
    runtime.durationMs = Math.max(0, Number(durationMs || 0));
    runtime.positionMs = clamp(runtime.positionMs, 0, runtime.durationMs || Number.POSITIVE_INFINITY);
    return true;
  }

  function setRoleVolume(role, value) {
    const volume = clamp(value, 0, 1);
    for (const row of activeEntries()) {
      if (row.role === role) {
        try { row.node.volume = volume; } catch (_) {}
      }
    }
  }

  function correctDrift(force = false) {
    if (runtime.lifecycle !== "playing") return 0;
    const master = masterEntry();
    if (!master?.node) return 0;
    const target = Number(master.node.currentTime || 0);
    let largest = 0;
    for (const row of activeEntries()) {
      if (row === master) continue;
      const drift = Number(row.node.currentTime || 0) - target;
      largest = Math.max(largest, Math.abs(drift));
      if (force || Math.abs(drift) > 0.045) {
        try { row.node.currentTime = target; runtime.driftCorrections += 1; } catch (_) {}
      }
    }
    runtime.lastDriftMs = largest * 1000;
    return runtime.lastDriftMs;
  }

  function stop(options = {}) {
    const nextState = options.state || (runtime.folder ? "ready" : "unloaded");
    return pause(nextState, options);
  }

  function masterNode() {
    return masterEntry()?.node || null;
  }

  function diagnostics() {
    return {
      sessionId: runtime.sessionId,
      operationId: runtime.operationId,
      owner: runtime.owner,
      folder: runtime.folder,
      lifecycle: runtime.lifecycle,
      rate: runtime.rate,
      positionMs: nowLogicalMs(),
      stems: activeEntries().map(row => ({ key: row.key, role: row.role, paused: row.node.paused, timeMs: Number(row.node.currentTime || 0) * 1000 })),
      driftCorrections: runtime.driftCorrections,
      staleAsyncDrops: runtime.staleAsyncDrops,
      invalidTransitions: runtime.invalidTransitions,
      lastDriftMs: runtime.lastDriftMs,
      lastOperation: runtime.lastOperation,
    };
  }

  setInterval(() => {
    if (runtime.lifecycle === "playing") correctDrift(false);
  }, 250);

  window.rilSongTransport = {
    beginSession,
    currentSession,
    isSession,
    transition,
    prepare,
    playAt,
    pause,
    seek,
    finish,
    stop,
    setRate,
    setDuration,
    setRoleVolume,
    registerStem,
    unregisterStem,
    markReady,
    markNotReady,
    correctDrift,
    currentTimeMs: nowLogicalMs,
    masterNode,
    diagnostics,
    state: runtime,
  };
})();
