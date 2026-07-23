(() => {
  const loadScript = (src, onload) => {
    const script = document.createElement('script');
    script.src = src;
    script.onerror = () => {
      const label = document.querySelector('#connectionLabel');
      if (label) label.textContent = `${src} failed to load`;
    };
    if (onload) script.onload = onload;
    document.body.appendChild(script);
  };

  const loadVisualizer = () => loadScript('/visualizer.js', () => {
    loadScript('/global-bridge.js', () => {
      loadScript('/shared-results.js', () => {
        loadScript('/song-tools.js', () => {
          loadScript('/v45-polish.js', () => {
            loadScript('/visualizer-preferences.js', () => {
              loadScript('/reports.js', () => {
                loadScript('/practice-polish.js', () => {
                  loadScript('/practice.js', () => {
                    loadScript('/practice-hotfix.js', () => {
                      loadScript('/practice-tools.js', () => {
                        loadScript('/practice-comfort.js', () => {
                          loadScript('/practice-library-menu.js', () => {
                            loadScript('/practice-save.js', () => {
                              loadScript('/song-media.js', () => {
                                loadScript('/analysis.js', () => {
                                  loadScript('/analysis-structure-bridge.js', () => {
                                    loadScript('/analysis-unified.js', () => {
                                      loadScript('/analysis-language-polish.js', () => {
                                        loadScript('/song-picker.js', () => {
                                          loadScript('/ril-packages.js', () => {
                                            loadScript('/ril-export-polish.js', () => loadScript('/osu-import.js'));
                                          });
                                        });
                                      });
                                    });
                                  });
                                });
                              });
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  fetch('/api/health')
    .then(response => response.json())
    .then(payload => {
      if (!payload?.ok) return;
      document.title = `${payload.app} ${payload.version}`;
      const subtitle = document.querySelector('.brand-subtitle');
      if (subtitle) subtitle.textContent = `Build ${payload.version}`;
      const connection = document.querySelector('#connectionLabel');
      if (connection) connection.textContent = `Local backend connected · ${payload.version}`;
    })
    .catch(() => {})
    .finally(loadVisualizer);
})();
