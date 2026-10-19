// Manifest-driven — the gallery stays in sync with options/manifest.json.
(async () => {
  const list = document.getElementById('list');
  try {
    const manifest = await (await fetch('options/manifest.json', { cache: 'no-cache' })).json();
    for (const o of manifest.options || []) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = 'options/' + o.file;
      a.textContent = o.title || o.file;
      li.append(a);
      list.append(li);
    }
  } catch (err) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Failed to load manifest.';
    list.append(li);
  }
})();
