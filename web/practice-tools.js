"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const engine = window.rilPracticeEngine;
  if (!engine?.practice || !engine?.setPracticeRange || !engine?.seekPractice) {
    console.warn("Practice tools could not find the playable Practice engine.");
    return;
  }

  const selector = {
    zoom: 1,
    centerMs: 0,
    drag: null,
    lastSong: null,
    lastAttemptId: null,
  };

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value || 0)));
  }

  function formatTime(ms, digits = 3) {
    if (typeof engine.formatPracticeTime === "function") return engine.formatPracticeTime(ms, digits);
    const total = Math.max(0, Number(ms || 0)) / 1000;
    const minutes = Math.floor(total / 60);
    const seconds = total - minutes * 60;
    return `${minutes}:${seconds.toFixed(digits).padStart(digits + 3, "0")}`;
  }

  function installPrecisionSelector() {
    if (q("#practicePrecisionSelector")) return;
    const rangeBlock = q("#practiceRangeCaption")?.closest(".inspector-block");
    if (!rangeBlock) return;

    const node = document.createElement("div");
    node.id = "practicePrecisionSelector";
    node.className = "practice-precision-selector";
    node.innerHTML = `
      <div class="practice-precision-head">
        <div><b>Precision selector</b><span id="practicePrecisionWindow">Whole song</span></div>
        <div class="practice-precision-head-actions">
          <button id="practicePrecisionLeft" class="icon-button compact" title="Move view left">‹</button>
          <select id="practicePrecisionZoom" title="Timeline zoom">
            <option value="1">Whole</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
            <option value="8">8×</option>
            <option value="16">16×</option>
            <option value="32">32×</option>
          </select>
          <button id="practicePrecisionRight" class="icon-button compact" title="Move view right">›</button>
        </div>
      </div>
      <div id="practicePrecisionTrack" class="practice-precision-track" tabindex="0" aria-label="Practice range selector">
        <div class="practice-precision-grid"></div>
        <div id="practicePrecisionSelection" class="practice-precision-selection" title="Drag to move the selected range"></div>
        <div id="practicePrecisionPlayhead" class="practice-precision-playhead"></div>
        <button id="practicePrecisionStart" class="practice-precision-handle start" title="Drag range start"><span>S</span></button>
        <button id="practicePrecisionEnd" class="practice-precision-handle end" title="Drag range end"><span>E</span></button>
      </div>
      <div class="practice-precision-scale"><span id="practicePrecisionViewStart">0:00.000</span><span id="practicePrecisionViewEnd">0:00.000</span></div>
      <div class="practice-precision-nudge">
        <select id="practicePrecisionStep" title="Nudge amount">
          <option value="10">10 ms</option>
          <option value="50">50 ms</option>
          <option value="100" selected>100 ms</option>
          <option value="500">500 ms</option>
          <option value="1000">1 s</option>
        </select>
        <button class="button small" data-nudge-target="start" data-nudge-direction="-1">Start −</button>
        <button class="button small" data-nudge-target="start" data-nudge-direction="1">Start +</button>
        <button class="button small" data-nudge-target="end" data-nudge-direction="-1">End −</button>
        <button class="button small" data-nudge-target="end" data-nudge-direction="1">End +</button>
      </div>
      <div class="practice-precision-actions">
        <button id="practicePrecisionCenter" class="button small">Center range</button>
        <button id="practicePrecisionVisible" class="button small">Use visible window</button>
      </div>
      <div class="list-sub practice-precision-tip">Click the ruler to move the playhead. Drag S/E for the edges, or drag the highlighted range to move it without changing its length.</div>
    `;

    const actionRow = q("#practiceSetStart")?.closest(".actions");
    (actionRow || rangeBlock.lastElementChild)?.after(node);

    q("#practicePrecisionZoom").addEventListener("change", event => {
      selector.zoom = Number(event.target.value || 1);
      centerOnRange();
    });
    q("#practicePrecisionLeft").addEventListener("click", () => shiftWindow(-0.72));
    q("#practicePrecisionRight").addEventListener("click", () => shiftWindow(0.72));
    q("#practicePrecisionCenter").addEventListener("click", centerOnRange);
    q("#practicePrecisionVisible").addEventListener("click", () => {
      const view = visibleWindow();
      engine.setPracticeRange(view.start, view.end, "Visible window");
      engine.seekPractice(view.start);
      centerOnRange();
    });
    q("#practicePrecisionTrack").addEventListener("pointerdown", beginTrackInteraction);
    window.addEventListener("pointermove", continueTrackInteraction);
    window.addEventListener("pointerup", endTrackInteraction);
    window.addEventListener("pointercancel", endTrackInteraction);

    q("#practicePrecisionSelector").querySelectorAll("[data-nudge-target]").forEach(button => {
      button.addEventListener("click", () => {
        const p = engine.practice;
        if (!p.bundle || p.playing) return;
        const step = Number(q("#practicePrecisionStep").value || 100) * Number(button.dataset.nudgeDirection || 1);
        if (button.dataset.nudgeTarget === "start") {
          engine.setPracticeRange(clamp(p.startMs + step, 0, p.endMs - 100), p.endMs, "Custom range");
        } else {
          engine.setPracticeRange(p.startMs, clamp(p.endMs + step, p.startMs + 100, p.durationMs), "Custom range");
        }
        syncPrecisionSelector(true);
      });
    });
  }

  function visibleWindow() {
    const p = engine.practice;
    const duration = Math.max(1, Number(p.durationMs || 0));
    const zoom = Math.max(1, Number(selector.zoom || 1));
    const span = duration / zoom;
    const maxStart = Math.max(0, duration - span);
    const start = clamp(selector.centerMs - span / 2, 0, maxStart);
    return { start, end: Math.min(duration, start + span), span, duration };
  }

  function centerOnRange() {
    const p = engine.practice;
    selector.centerMs = (Number(p.startMs || 0) + Number(p.endMs || 0)) / 2;
    syncPrecisionSelector(true);
  }

  function shiftWindow(fraction) {
    const view = visibleWindow();
    selector.centerMs = clamp(selector.centerMs + view.span * fraction, view.span / 2, view.duration - view.span / 2);
    syncPrecisionSelector(true);
  }

  function timeFromPointer(event) {
    const track = q("#practicePrecisionTrack");
    const rect = track.getBoundingClientRect();
    const view = visibleWindow();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    return view.start + ratio * view.span;
  }

  function beginTrackInteraction(event) {
    const p = engine.practice;
    if (!p.bundle || p.playing) return;
    const target = event.target.closest(".practice-precision-handle, .practice-precision-selection");
    const time = timeFromPointer(event);
    if (target?.id === "practicePrecisionStart") {
      selector.drag = { type: "start", pointerId: event.pointerId };
    } else if (target?.id === "practicePrecisionEnd") {
      selector.drag = { type: "end", pointerId: event.pointerId };
    } else if (target?.id === "practicePrecisionSelection") {
      selector.drag = {
        type: "range",
        pointerId: event.pointerId,
        offset: time - p.startMs,
        length: p.endMs - p.startMs,
      };
    } else {
      engine.seekPractice(time);
      syncPrecisionSelector();
      return;
    }
    q("#practicePrecisionTrack").setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function continueTrackInteraction(event) {
    const drag = selector.drag;
    const p = engine.practice;
    if (!drag || drag.pointerId !== event.pointerId || !p.bundle || p.playing) return;
    const time = timeFromPointer(event);
    if (drag.type === "start") {
      engine.setPracticeRange(clamp(time, 0, p.endMs - 100), p.endMs, "Custom range");
    } else if (drag.type === "end") {
      engine.setPracticeRange(p.startMs, clamp(time, p.startMs + 100, p.durationMs), "Custom range");
    } else {
      const start = clamp(time - drag.offset, 0, Math.max(0, p.durationMs - drag.length));
      engine.setPracticeRange(start, start + drag.length, "Custom range");
    }
    selector.centerMs = (p.startMs + p.endMs) / 2;
    syncPrecisionSelector(true);
    event.preventDefault();
  }

  function endTrackInteraction(event) {
    if (!selector.drag || selector.drag.pointerId !== event.pointerId) return;
    selector.drag = null;
    try { q("#practicePrecisionTrack").releasePointerCapture?.(event.pointerId); } catch (_) {}
  }

  function syncPrecisionSelector(force = false) {
    const p = engine.practice;
    const root = q("#practicePrecisionSelector");
    if (!root) return;
    root.classList.toggle("disabled", !p.bundle || p.playing);
    if (!p.bundle) return;

    if (selector.lastSong !== p.songFolder) {
      selector.lastSong = p.songFolder;
      selector.centerMs = (p.startMs + p.endMs) / 2;
      selector.zoom = 1;
      q("#practicePrecisionZoom").value = "1";
      force = true;
    }

    let view = visibleWindow();
    if (!selector.drag && (p.startMs < view.start || p.endMs > view.end) && selector.zoom > 1) {
      selector.centerMs = (p.startMs + p.endMs) / 2;
      view = visibleWindow();
    }

    const percent = ms => clamp((ms - view.start) / view.span * 100, 0, 100);
    const start = percent(p.startMs);
    const end = percent(p.endMs);
    const current = percent(p.currentMs);
    q("#practicePrecisionSelection").style.left = `${start}%`;
    q("#practicePrecisionSelection").style.width = `${Math.max(0.4, end - start)}%`;
    q("#practicePrecisionStart").style.left = `${start}%`;
    q("#practicePrecisionEnd").style.left = `${end}%`;
    q("#practicePrecisionPlayhead").style.left = `${current}%`;
    q("#practicePrecisionViewStart").textContent = formatTime(view.start);
    q("#practicePrecisionViewEnd").textContent = formatTime(view.end);
    q("#practicePrecisionWindow").textContent = `${formatTime(view.start)} → ${formatTime(view.end)}`;
    if (force) q("#practicePrecisionTrack").dataset.refresh = String(performance.now());
  }

  function installAccuracyGraph() {
    if (q("#practiceAccuracyGraph")) return;
    const breakdown = q("#practiceJudgmentBreakdown");
    if (!breakdown) return;
    const box = document.createElement("div");
    box.id = "practiceAccuracyGraph";
    box.className = "practice-accuracy-graph";
    box.innerHTML = `
      <div class="practice-accuracy-head"><b>Accuracy over attempt</b><span id="practiceAccuracyGraphValue">—</span></div>
      <canvas id="practiceAccuracyCanvas" height="170"></canvas>
      <div id="practiceAccuracyCaption" class="list-sub">Finish an attempt to draw its cumulative accuracy.</div>
    `;
    breakdown.after(box);
    q("#practiceAccuracyCanvas").addEventListener("pointermove", updateAccuracyHover);
    q("#practiceAccuracyCanvas").addEventListener("pointerleave", () => renderAccuracyGraph());
  }

  function graphRows() {
    return engine.practice.lastAttempt?.stats?.accuracyTimeline || [];
  }

  function renderAccuracyGraph(hoverIndex = null) {
    const canvas = q("#practiceAccuracyCanvas");
    if (!canvas) return;
    const attempt = engine.practice.lastAttempt;
    const rows = graphRows();
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(260, rect.width || canvas.parentElement?.clientWidth || 300);
    const cssHeight = 170;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const rootStyle = getComputedStyle(document.documentElement);
    const text = rootStyle.getPropertyValue("--text").trim() || "#f5f7ff";
    const muted = rootStyle.getPropertyValue("--muted").trim() || "#9098aa";
    const accent = rootStyle.getPropertyValue("--accent").trim() || "#75e6ff";
    const line = rootStyle.getPropertyValue("--line").trim() || "rgba(255,255,255,.12)";

    ctx.fillStyle = "rgba(255,255,255,.018)";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (!attempt || !rows.length) {
      ctx.fillStyle = muted;
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("No judged notes yet", cssWidth / 2, cssHeight / 2);
      q("#practiceAccuracyGraphValue").textContent = "—";
      q("#practiceAccuracyCaption").textContent = "Finish an attempt to draw its cumulative accuracy.";
      return;
    }

    const left = 38;
    const right = 12;
    const top = 12;
    const bottom = 25;
    const plotWidth = Math.max(1, cssWidth - left - right);
    const plotHeight = Math.max(1, cssHeight - top - bottom);
    const minimumAccuracy = Math.min(...rows.map(row => Number(row.accuracy || 0)));
    const yMinimum = minimumAccuracy >= 95 ? 95 : minimumAccuracy >= 85 ? 80 : minimumAccuracy >= 65 ? 60 : 0;
    const start = Number(attempt.startMs || 0);
    const end = Math.max(start + 1, Number(attempt.endMs || start + 1));
    const xFor = value => left + clamp((Number(value) - start) / (end - start), 0, 1) * plotWidth;
    const yFor = value => top + (100 - clamp(value, yMinimum, 100)) / Math.max(1, 100 - yMinimum) * plotHeight;

    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.fillStyle = muted;
    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    const ticks = [...new Set([100, Math.round((100 + yMinimum) / 2), yMinimum])];
    for (const tick of ticks) {
      const y = yFor(tick);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
      ctx.fillText(`${tick}%`, left - 5, y + 3);
    }

    ctx.textAlign = "left";
    ctx.fillText(formatTime(start, 1), left, cssHeight - 7);
    ctx.textAlign = "right";
    ctx.fillText(formatTime(end, 1), left + plotWidth, cssHeight - 7);

    ctx.beginPath();
    rows.forEach((row, index) => {
      const x = xFor(row.time_ms);
      const y = yFor(row.accuracy);
      if (!index) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    rows.forEach((row, index) => {
      if (!["Miss", "Extra", "Hurt"].includes(row.label) && index !== hoverIndex) return;
      ctx.beginPath();
      ctx.arc(xFor(row.time_ms), yFor(row.accuracy), index === hoverIndex ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = row.label === "Hurt" ? "#ff9f43" : "#ff6b8a";
      ctx.fill();
    });

    const final = rows.at(-1);
    q("#practiceAccuracyGraphValue").textContent = `${Number(final.accuracy).toFixed(2)}%`;
    const worst = rows.reduce((lowest, row) => Number(row.accuracy) < Number(lowest.accuracy) ? row : lowest, rows[0]);
    q("#practiceAccuracyCaption").textContent = `Lowest cumulative accuracy: ${Number(worst.accuracy).toFixed(2)}% at ${formatTime(worst.time_ms)}.`;

    if (Number.isInteger(hoverIndex) && rows[hoverIndex]) {
      const row = rows[hoverIndex];
      const x = xFor(row.time_ms);
      const y = yFor(row.accuracy);
      const label = `${row.label || "Judgment"} · ${Number(row.accuracy).toFixed(2)}% · ${formatTime(row.time_ms)}`;
      ctx.font = "11px system-ui";
      const width = ctx.measureText(label).width + 14;
      const boxX = clamp(x - width / 2, left, cssWidth - right - width);
      const boxY = clamp(y - 31, 3, cssHeight - bottom - 23);
      ctx.fillStyle = "rgba(5,7,12,.94)";
      ctx.fillRect(boxX, boxY, width, 21);
      ctx.strokeStyle = line;
      ctx.strokeRect(boxX, boxY, width, 21);
      ctx.fillStyle = text;
      ctx.textAlign = "left";
      ctx.fillText(label, boxX + 7, boxY + 14);
    }
  }

  function updateAccuracyHover(event) {
    const rows = graphRows();
    const attempt = engine.practice.lastAttempt;
    if (!rows.length || !attempt) return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const left = 38;
    const right = 12;
    const ratio = clamp((event.clientX - rect.left - left) / Math.max(1, rect.width - left - right), 0, 1);
    const target = Number(attempt.startMs) + ratio * (Number(attempt.endMs) - Number(attempt.startMs));
    let nearest = 0;
    let distance = Infinity;
    rows.forEach((row, index) => {
      const next = Math.abs(Number(row.time_ms) - target);
      if (next < distance) {
        distance = next;
        nearest = index;
      }
    });
    renderAccuracyGraph(nearest);
  }

  function installStyles() {
    if (q("#practiceToolStyles")) return;
    const style = document.createElement("style");
    style.id = "practiceToolStyles";
    style.textContent = `
      .practice-precision-selector{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
      .practice-precision-selector.disabled{opacity:.55}
      .practice-precision-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .practice-precision-head>div:first-child{display:flex;flex-direction:column;gap:2px}
      .practice-precision-head span{font-size:10px;color:var(--muted);font-family:ui-monospace,monospace}
      .practice-precision-head-actions{display:grid;grid-template-columns:auto 72px auto;gap:5px;align-items:center}
      .practice-precision-track{position:relative;height:42px;margin-top:9px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.025);overflow:hidden;touch-action:none;cursor:crosshair}
      .practice-precision-grid{position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),rgba(255,255,255,.055) calc(10% - 1px),rgba(255,255,255,.055) 10%)}
      .practice-precision-selection{position:absolute;top:8px;bottom:8px;border:1px solid var(--accent);background:rgba(117,230,255,.22);border-radius:5px;cursor:grab;min-width:3px}
      .practice-precision-selection:active{cursor:grabbing}
      .practice-precision-playhead{position:absolute;top:4px;bottom:4px;width:2px;background:#fff;box-shadow:0 0 7px rgba(255,255,255,.75);pointer-events:none}
      .practice-precision-handle{position:absolute;top:3px;bottom:3px;width:18px;transform:translateX(-50%);padding:0;border:1px solid var(--accent);border-radius:5px;background:#0b1420;color:#fff;font-size:9px;font-weight:900;cursor:ew-resize;touch-action:none}
      .practice-precision-handle.end{border-color:#ffd166}.practice-precision-handle span{pointer-events:none}
      .practice-precision-scale{display:flex;justify-content:space-between;margin-top:4px;font:10px ui-monospace,monospace;color:var(--muted)}
      .practice-precision-nudge{display:grid;grid-template-columns:76px repeat(4,minmax(0,1fr));gap:5px;margin-top:8px}
      .practice-precision-nudge .button{padding-inline:3px}
      .practice-precision-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
      .practice-precision-tip{margin-top:7px;line-height:1.4}
      .practice-accuracy-graph{margin-top:12px;padding-top:11px;border-top:1px solid var(--line)}
      .practice-accuracy-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
      .practice-accuracy-head span{font:700 11px ui-monospace,monospace;color:var(--accent)}
      #practiceAccuracyCanvas{display:block;width:100%;border:1px solid var(--line);border-radius:9px;background:#05070c}
      #practiceAccuracyCaption{margin-top:6px;line-height:1.4}
      @media(max-width:520px){.practice-precision-nudge{grid-template-columns:1fr 1fr}.practice-precision-nudge select{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function tick() {
    installPrecisionSelector();
    installAccuracyGraph();
    syncPrecisionSelector();

    const attempt = engine.practice.lastAttempt;
    const attemptId = attempt?.completedAt || null;
    if (attemptId !== selector.lastAttemptId) {
      selector.lastAttemptId = attemptId;
      renderAccuracyGraph();
    }
    requestAnimationFrame(tick);
  }

  installStyles();
  installPrecisionSelector();
  installAccuracyGraph();
  window.addEventListener("resize", () => renderAccuracyGraph());
  requestAnimationFrame(tick);
})();
