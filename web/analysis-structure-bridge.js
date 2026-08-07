"use strict";

(() => {
  const analysis = window.rilAnalysis;
  if (!analysis?.buildReport || !window.state?.viz) return;
  const originalBuildReport = analysis.buildReport;
  analysis.buildReport = (bundle, attempt) => {
    const previousBundle = window.state.viz.bundle;
    try {
      window.state.viz.bundle = bundle;
      return originalBuildReport(bundle, attempt);
    } finally {
      window.state.viz.bundle = previousBundle;
    }
  };
})();
