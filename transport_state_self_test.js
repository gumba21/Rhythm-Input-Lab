"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeMedia {
  constructor(name) {
    this.name = name;
    this.src = "fake://" + name;
    this.currentSrc = this.src;
    this.duration = 120;
    this.readyState = 1;
    this.paused = true;
    this.seeking = false;
    this.seekRequiresEvent = false;
    this._currentTime = 0;
    this.playbackRate = 1;
    this.volume = 1;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.listeners = new Map();
    this.playDeferred = null;
  }

  get currentTime() { return this._currentTime; }
  set currentTime(value) {
    this._currentTime = Number(value || 0);
    this.seeking = Boolean(this.seekRequiresEvent);
  }

  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }

  removeEventListener(name, fn) {
    this.listeners.get(name)?.delete(fn);
  }

  emit(name) {
    if (name === "seeked") this.seeking = false;
    for (const fn of [...(this.listeners.get(name) || [])]) fn({ type: name, target: this });
  }

  pause() {
    this.paused = true;
    this.pauseCalls += 1;
  }

  play() {
    this.paused = false;
    this.playCalls += 1;
    return this.playDeferred?.promise || Promise.resolve();
  }
}

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function main() {
  const instrumental = new FakeMedia("instrumental");
  const vocals = new FakeMedia("vocals");
  const nodes = {
    "#instrumentalAudio": instrumental,
    "#vocalsAudio": vocals,
  };

  let now = 1000;
  const events = [];
  const context = {
    console,
    Promise,
    Set,
    Map,
    Number,
    Math,
    Date,
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
    performance: { now: () => now },
    document: {
      querySelector: selector => nodes[selector] || null,
    },
    window: {
      state: {
        viz: {
          audioReady: { instrumental: false, vocals: false },
          audioNames: { instrumental: "", vocals: "" },
          audioVolumes: { instrumental: 1, vocals: 1 },
        },
      },
      dispatchEvent: event => events.push(event),
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.performance = context.performance;
  context.window.CustomEvent = context.CustomEvent;
  context.globalThis = context;

  const source = fs.readFileSync("web/song-transport.js", "utf8");
  vm.runInNewContext(source, context, { filename: "web/song-transport.js" });
  const transport = context.window.rilSongTransport;
  assert(transport, "transport should install");

  const sessionA1 = transport.beginSession("practice", "song-a", { rate: 1, positionMs: 0 });
  assert.equal(transport.currentSession().lifecycle, "loading");
  assert.equal(transport.transition("playing", sessionA1), false, "loading may not skip directly to playing");
  assert.equal(transport.diagnostics().invalidTransitions, 1);
  assert.equal(instrumental.playCalls, 0);

  transport.markReady("instrumental", instrumental, { sessionId: sessionA1, role: "instrumental" });
  transport.markReady("vocals", vocals, { sessionId: sessionA1, role: "vocals" });
  transport.setDuration(60_000, { sessionId: sessionA1 });
  assert(transport.transition("ready", sessionA1));

  instrumental.seekRequiresEvent = true;
  vocals.seekRequiresEvent = true;
  assert(transport.playAt(1_000, { sessionId: sessionA1 }));
  assert.equal(transport.currentSession().lifecycle, "seeking");
  assert.equal(instrumental.playCalls, 0, "play waits for the coordinated seek");
  assert.equal(vocals.playCalls, 0, "all stems wait for the coordinated seek");

  assert(transport.pause("paused", { sessionId: sessionA1 }));
  instrumental.emit("seeked");
  vocals.emit("seeked");
  await flush();
  assert.equal(instrumental.playCalls, 0, "a pause invalidates a pending start");
  assert.equal(vocals.playCalls, 0, "a pause invalidates every pending stem start");

  instrumental.seekRequiresEvent = false;
  vocals.seekRequiresEvent = false;
  instrumental.playDeferred = deferred();
  vocals.playDeferred = deferred();
  assert(transport.playAt(2_000, { sessionId: sessionA1 }));
  await flush();
  assert.equal(transport.currentSession().lifecycle, "playing");
  assert.equal(instrumental.playCalls, 1);
  assert.equal(vocals.playCalls, 1);
  instrumental.currentTime = 2.4;
  vocals.currentTime = 2.4;
  assert.equal(Math.round(transport.currentTimeMs()), 2400, "master audio owns the playing timeline");

  const oldInstPromise = instrumental.playDeferred;
  const oldVocalsPromise = vocals.playDeferred;
  const sessionB = transport.beginSession("visualizer", "song-b", { positionMs: 0 });
  assert(sessionB > sessionA1, "new song creates a new session generation");
  assert.equal(instrumental.paused, true);
  assert.equal(vocals.paused, true);
  oldInstPromise.resolve();
  oldVocalsPromise.resolve();
  await flush();
  assert.equal(instrumental.paused, true, "stale play resolution cannot restart an old session");
  assert.equal(vocals.paused, true, "stale vocal play resolution cannot restart an old session");
  assert(transport.diagnostics().staleAsyncDrops >= 2, "stale async completions are counted");

  const sessionA2 = transport.beginSession("practice", "song-a", { positionMs: 0 });
  assert(sessionA2 > sessionB, "A -> B -> A is still a distinct replacement session");
  assert.equal(transport.isSession(sessionA1, "practice", "song-a"), false);
  assert.equal(transport.isSession(sessionA2, "practice", "song-a"), true);

  instrumental.playDeferred = null;
  vocals.playDeferred = null;
  transport.markReady("instrumental", instrumental, { sessionId: sessionA2, role: "instrumental" });
  transport.transition("ready", sessionA2);
  transport.setDuration(30_000, { sessionId: sessionA2 });
  transport.playAt(5_000, { sessionId: sessionA2 });
  await flush();
  instrumental.currentTime = 5.25;
  now += 250;

  const extra = new FakeMedia("extra-vocals");
  transport.markReady("vocal-stem:extra", extra, { sessionId: sessionA2, role: "vocals", dynamic: true });
  await flush();
  assert.equal(extra.playCalls, 1, "a late vocal stem joins the active transport");
  assert(Math.abs(extra.currentTime - instrumental.currentTime) < 0.001, "late stem joins at master time");

  transport.pause("paused", { sessionId: sessionA2 });
  assert.equal(instrumental.paused, true);
  assert.equal(extra.paused, true, "pause is coherent across primary and extra stems");

  assert(events.some(event => event.type === "ril:transport-session"));
  assert(events.some(event => event.type === "ril:transport-state"));
  console.log("Shared song transport deterministic self-test passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
