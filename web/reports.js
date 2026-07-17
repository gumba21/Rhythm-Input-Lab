"use strict";

(() => {
  const $ = selector => document.querySelector(selector);
  let rows = [];

  function install() {
    if ($('[data-view="reports"]')) return;
    const button = document.createElement("button");
    button.className = "nav-button";
    button.dataset.view = "reports";
    button.innerHTML = '<span class="nav-icon">▤</span>Reports';
    const settings = $('[data-view="settings"]');
    settings.parentElement.insertBefore(button, settings);

    const section = document.createElement("section");
    section.id = "view-reports";
    section.className = "view";
    section.innerHTML = '<div class="page-head"><div><div class="eyebrow">Saved analysis</div><h1>Reports.</h1><p>Browse the report generated for each recorded attempt.</p></div><div class="actions"><input id="reportSearch" placeholder="Search reports…"><button id="refreshReports" class="button">Refresh</button></div></div><div class="reports-layout"><aside class="card pad"><div class="section-title"><h2>Attempts</h2><span id="reportCount" class="pill">0</span></div><div id="reportList" class="list"></div></aside><div class="card report-panel"><div class="report-head"><div><h2 id="reportTitle">Choose a report</h2><div id="reportSubtitle" class="list-sub">Select an attempt from the left.</div></div></div><div id="reportEmpty" class="empty">The saved report will appear here.</div><iframe id="reportFrame" class="report-frame hidden" title="Saved attempt report"></iframe></div></div>';
    const settingsView = $("#view-settings");
    settingsView.parentElement.insertBefore(section, settingsView);

    button.addEventListener("click", () => go("reports"));
    $("#refreshReports").addEventListener("click", refresh);
    $("#reportSearch").addEventListener("input", render);

    const style = document.createElement("style");
    style.textContent = '.reports-layout{display:grid;grid-template-columns:340px minmax(0,1fr);gap:16px;min-height:680px}.report-panel{display:flex;flex-direction:column;overflow:hidden}.report-head{padding:14px;border-bottom:1px solid var(--line)}.report-frame{width:100%;flex:1;min-height:620px;border:0;background:#fff}.report-row{width:100%;text-align:left;border:1px solid var(--line);background:rgba(255,255,255,.02);border-radius:11px;padding:11px;color:inherit;cursor:pointer;margin-bottom:8px}.report-row:hover,.report-row.selected{border-color:var(--accent)}@media(max-width:950px){.reports-layout{grid-template-columns:1fr}}';
    document.head.appendChild(style);
  }

  async function refresh() {
    const list = $("#reportList");
    list.innerHTML = '<div class="empty">Reading reports…</div>';
    try {
      const songs = await api("/api/songs");
      const collected = [];
      for (const song of songs) {
        if (!song.attempt_count) continue;
        const data = await api(`/api/song?folder=${encodeURIComponent(song.folder)}`);
        for (const attempt of data.attempts || []) collected.push({ song, attempt });
      }
      rows = collected;
      render();
    } catch (error) {
      list.textContent = `Could not load reports: ${error.message}`;
    }
  }

  function render() {
    const query = ($("#reportSearch")?.value || "").trim().toLowerCase();
    const filtered = rows.filter(({ song, attempt }) => `${song.song_name} ${attempt.folder} ${attempt.recorded_at}`.toLowerCase().includes(query));
    $("#reportCount").textContent = String(filtered.length);
    $("#reportList").innerHTML = filtered.length ? filtered.map(({ song, attempt }) => `<button class="report-row" data-song="${escapeHtml(song.folder)}" data-attempt="${escapeHtml(attempt.folder)}"><b>${escapeHtml(song.song_name)}</b><div class="list-sub">Attempt ${String(attempt.attempt_number ?? "—").padStart(3,"0")} · ${escapeHtml(attempt.recorded_at || "")}</div><div class="list-sub">${formatNumber(attempt.lane_presses)} presses · peak ${formatNumber(attempt.peak_nps,1)} NPS</div></button>`).join("") : '<div class="empty">No reports found.</div>';
    document.querySelectorAll(".report-row").forEach(button => button.addEventListener("click", () => openReport(button)));
  }

  function openReport(button) {
    document.querySelectorAll(".report-row.selected").forEach(row => row.classList.remove("selected"));
    button.classList.add("selected");
    const song = button.dataset.song;
    const attempt = button.dataset.attempt;
    const item = rows.find(row => row.song.folder === song && row.attempt.folder === attempt);
    $("#reportTitle").textContent = `${item.song.song_name} · Attempt ${String(item.attempt.attempt_number ?? "—").padStart(3,"0")}`;
    $("#reportSubtitle").textContent = item.attempt.recorded_at || "Saved report";
    $("#reportEmpty").classList.add("hidden");
    const frame = $("#reportFrame");
    frame.src = `/api/report?folder=${encodeURIComponent(song)}&attempt=${encodeURIComponent(attempt)}`;
    frame.classList.remove("hidden");
  }

  const originalGo = go;
  go = view => {
    const result = originalGo(view);
    if (view === "reports") refresh();
    return result;
  };

  install();
})();
