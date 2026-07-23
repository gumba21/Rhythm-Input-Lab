"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  let applying = false;

  const replacements = new Map([
    ["4.7 coaching and analysis", "4.7 performance analysis"],
    ["Coach", "Summary"],
    ["What to work on", "Lowest reconstructed results"],
    ["Most visible issue:", "Highest-count classification:"],
    ["No dominant failure cause", "No dominant classification"],
    ["lane coaching", "lane summaries"],
  ]);

  function replaceText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let value = node.nodeValue || "";
      for (const [before, after] of replacements) value = value.replaceAll(before, after);
      if (value !== node.nodeValue) node.nodeValue = value;
    }
  }

  function patchStaticCopy() {
    const view = q("#view-analysis");
    if (!view) return false;
    const heading = q(".page-head", view);
    const eyebrow = q(".eyebrow", heading);
    const description = q("p", heading);
    if (eyebrow) eyebrow.textContent = "4.7 performance analysis";
    if (description) description.textContent = "Inspect section, lane, timing, pattern, consistency, and classification data. The measurements are presented for you to interpret.";

    const coachCard = q("#analysisCoach")?.closest("article");
    if (coachCard) {
      const label = q(".eyebrow", coachCard);
      const title = q("h2", coachCard);
      if (label) label.textContent = "Summary";
      if (title) title.textContent = "Lowest reconstructed results";
    }

    const handSettings = q("#analysisHandSettings .list-sub");
    if (handSettings) handSettings.textContent = "These mappings affect one-hand pattern labels and lane summaries; they do not change your keybinds.";

    if (!q("#analysisInterpretationNote", view)) {
      const note = document.createElement("div");
      note.id = "analysisInterpretationNote";
      note.className = "analysis-interpretation-note";
      note.innerHTML = "<b>Descriptive analysis</b><span>RIL identifies measurements, rankings, and confidence-limited classifications. It does not choose a training plan for you.</span>";
      q("#analysisWorkspace", view)?.prepend(note);
    }
    replaceText(view);
    return true;
  }

  function patchDynamicCopy() {
    const coach = q("#analysisCoach");
    replaceText(coach);
    const causes = q("#analysisCauses");
    replaceText(causes);
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      patchStaticCopy();
      patchDynamicCopy();
    } finally {
      applying = false;
    }
  }

  const style = document.createElement("style");
  style.id = "analysisLanguagePolishStyles";
  style.textContent = `
    .analysis-interpretation-note{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:9px 11px;border:1px solid var(--line);border-left:2px solid var(--accent);border-radius:9px;background:rgba(117,230,255,.035)}.analysis-interpretation-note b{flex:none;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.analysis-interpretation-note span{font-size:11px;color:var(--muted)}
    @media(max-width:720px){.analysis-interpretation-note{align-items:flex-start;flex-direction:column;gap:4px}}
  `;
  document.head.appendChild(style);

  const observer = new MutationObserver(() => queueMicrotask(apply));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  apply();
  setTimeout(apply, 0);
  window.rilAnalysisLanguagePolish = { apply };
})();
