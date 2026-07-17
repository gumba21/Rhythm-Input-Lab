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
    loadScript('/song-tools.js', () => {
      loadScript('/v45-polish.js', () => loadScript('/reports.js'));
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
