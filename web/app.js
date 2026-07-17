(() => {
  const loadVisualizer = () => {
    const script = document.createElement('script');
    script.src = '/visualizer.js';
    script.onerror = () => {
      const label = document.querySelector('#connectionLabel');
      if (label) label.textContent = 'Visualizer script failed to load';
    };
    document.body.appendChild(script);
  };

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
