"use strict";

// The original visualizer uses top-level const/function declarations. Later
// feature modules intentionally consume a small explicit bridge instead of
// duplicating the chart/replay engine.
window.state = state;
window.go = go;
window.api = api;
window.toast = toast;
window.loadVisualizer = loadVisualizer;
window.loadAttemptForCurrent = loadAttemptForCurrent;
window.refreshSongs = refreshSongs;
window.matchChart = matchChart;
window.matchHazards = matchHazards;
window.candidateOffsets = candidateOffsets;
window.comparisonStats = comparisonStats;
window.judgmentFor = judgmentFor;
window.getChartWindows = getChartWindows;
window.isHazardNote = isHazardNote;
window.escapeHtml = escapeHtml;
window.recomputeComparison = recomputeComparison;
