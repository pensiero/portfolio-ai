// Shared chat controller injected into every option (art-style) page.
//
// One file drives the conversational behaviour across all 31 designs:
//   - manifest-driven style caption (looked up by this page's own filename)
//   - multi-turn streaming chat (SSE) against /api/ask
//   - conversation persisted in sessionStorage so the signature "shuffle"
//     restyles the page WITHOUT losing the thread
//   - suggested-question chips, a persistent contact CTA, and best-effort
//     "Source:" citation rendering
//
// All injected UI inherits the host design's colours/fonts (currentColor /
// inherit) so it looks native on every style.

(() => {
  const ENDPOINT = '/api/ask';
  const CHAT_KEY = 'portfolio-chat-v1';
  const MAX_CHARS = 500;
  const MAX_HISTORY = 12;

  let manifest = null;
  let conversation = loadConversation(); // [{ role, content }]
  let streaming = false;

  // ---- persistence (shared across same-origin iframes within the tab) ----
  function loadConversation() {
    try {
      const raw = sessionStorage.getItem(CHAT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  function saveConversation() {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(conversation.slice(-MAX_HISTORY)));
    } catch {
      /* sessionStorage unavailable — degrade silently */
    }
  }

  // ---- tiny DOM helper ----
  function el(tag, styles = {}, props = {}) {
    const node = document.createElement(tag);
    Object.assign(node.style, styles);
    Object.assign(node, props);
    return node;
  }

  function currentFile() {
    return location.pathname.split('/').pop() || '';
  }

  // ---- style-identity caption (inserted under the h1) ----
  function applyCaption() {
    const h1 = document.querySelector('h1');
    if (!h1) return;
    const entry = manifest?.options?.find((o) => o.file === currentFile());
    const line = entry?.caption || 'Subject: Oscar Fanelli · Interface: Query Portfolio';

    let subtitle = h1.nextElementSibling;
    if (!subtitle || subtitle.dataset?.llmCaption !== '1') {
      subtitle = el('p');
      subtitle.dataset.llmCaption = '1';
      h1.insertAdjacentElement('afterend', subtitle);
    }
    subtitle.textContent = line;
  }

  // ---- rotating placeholder (uses the same suggested questions) ----
  function setupRotatingPlaceholders(input) {
    const prompts = manifest?.suggestedQuestions || [];
    if (!input || !prompts.length) return;
    let i = 0;
    const apply = () => {
      if (document.activeElement !== input && !input.value.trim()) {
        input.placeholder = 'Try: ' + prompts[i % prompts.length];
      }
      i++;
    };
    apply();
    setInterval(apply, 3600);
  }

  // ---- chat UI ----
  function buildChat(form) {
    const panel = el('section', {
      marginTop: '14px',
      paddingTop: '12px',
      borderTop: '1px solid currentColor',
      color: 'inherit',
      font: 'inherit',
      fontSize: '0.95rem',
      lineHeight: '1.5'
    });
    panel.className = 'llm-chat';

    const history = el('div', { display: 'flex', flexDirection: 'column', gap: '12px' });
    const chips = el('div', { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' });
    const cta = el('div', { marginTop: '14px', fontSize: '0.82rem', opacity: '0.85' });
    const about = el('div', { marginTop: '10px', fontSize: '0.8rem', opacity: '0.75' });

    panel.append(history, chips, cta, about);
    form.insertAdjacentElement('afterend', panel);

    return { panel, history, chips, cta, about };
  }

  function renderTurn(history, role, content) {
    const wrap = el('div');
    const label = el('div', {
      fontSize: '0.7rem',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      opacity: '0.6',
      marginBottom: '3px'
    });
    label.textContent = role === 'user' ? 'You' : 'Oscar AI';

    const body = el('div');
    const { main, source } = splitCitation(content);
    body.textContent = main;

    wrap.append(label, body);
    if (source) {
      const src = el('div', { fontSize: '0.75rem', opacity: '0.6', marginTop: '4px' });
      src.textContent = 'Source: ' + source;
      wrap.append(src);
    }
    history.append(wrap);
    return body; // returned so streaming can append into it
  }

  // Pull a trailing "Source: ..." line off the answer, if present.
  function splitCitation(text) {
    const m = text.match(/\n?\s*Source:\s*([^\n]+)\s*$/i);
    if (!m) return { main: text.trim(), source: '' };
    return { main: text.slice(0, m.index).trim(), source: m[1].trim() };
  }

  function renderChips(chips, input, submit) {
    chips.textContent = '';
    if (conversation.length > 0) return; // only on a fresh thread
    for (const q of manifest?.suggestedQuestions || []) {
      const chip = el('button', {
        font: 'inherit',
        fontSize: '0.8rem',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid currentColor',
        borderRadius: '999px',
        padding: '5px 11px',
        cursor: 'pointer',
        opacity: '0.85'
      });
      chip.type = 'button';
      chip.textContent = q;
      chip.addEventListener('click', () => {
        if (streaming) return;
        input.value = q;
        submit();
      });
      chips.append(chip);
    }
  }

  function renderCTA(cta) {
    const c = manifest?.contact || {};
    const links = [];
    if (c.email) links.push(['Email', 'mailto:' + c.email]);
    if (c.linkedin) links.push(['LinkedIn', c.linkedin]);
    if (c.github) links.push(['GitHub', c.github]);
    if (!links.length) return;

    cta.textContent = 'Want to talk to the real Oscar? ';
    links.forEach(([text, href], idx) => {
      if (idx) cta.append(document.createTextNode(' · '));
      const a = el('a', { color: 'inherit', textDecoration: 'underline' });
      a.href = href;
      a.textContent = text;
      if (href.startsWith('http')) a.target = '_blank';
      cta.append(a);
    });
  }

  // ---- "What's behind this" disclosure (concept + repo link) ----
  function renderAbout(about) {
    const info = manifest?.about;
    if (!about || !info || !(info.paragraphs?.length || info.repoUrl)) return;

    const details = el('details');
    const summary = el('summary', {
      cursor: 'pointer',
      color: 'inherit',
      opacity: '0.85',
      textDecoration: 'underline',
      display: 'inline-block'
    });
    summary.textContent = info.label || "What's behind this?";
    details.append(summary);

    for (const p of info.paragraphs || []) {
      const para = el('p', { margin: '8px 0 0', lineHeight: '1.5', opacity: '0.95' });
      para.textContent = p;
      details.append(para);
    }

    if (info.repoUrl) {
      const wrap = el('p', { margin: '8px 0 0' });
      const a = el('a', { color: 'inherit', textDecoration: 'underline' });
      a.href = info.repoUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = (info.repoLabel || 'See how it\'s built') + ' →';
      wrap.append(a);
      details.append(wrap);
    }

    about.textContent = '';
    about.append(details);
  }

  // ---- SSE streaming from /api/ask ----
  async function streamAnswer(messages, onDelta) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });

    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch {
        /* not JSON */
      }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }

        if (event === 'error') {
          throw new Error(JSON.parse(data || '{}').error || 'Stream error');
        }
        if (event === 'done') return;
        if (event === 'message' && data) onDelta(JSON.parse(data));
      }
    }
  }

  // ---- wire up a form ----
  function bindForm(form) {
    if (form.dataset.llmBound === '1') return;
    form.dataset.llmBound = '1';

    const input = form.querySelector('input[type="text"], input:not([type])');
    const button = form.querySelector('button[type="submit"], button');
    if (!input) return;

    // Reveal the Ask button as the user types — the option styles hide it until
    // a `.show` class is present (this replaces each option's old inline script).
    if (button) {
      const toggleButton = () =>
        button.classList.toggle('show', input.value.trim().length > 0);
      input.addEventListener('input', toggleButton);
      toggleButton();
    }

    const ui = buildChat(form);

    // Rehydrate any conversation carried over from a previous (pre-shuffle) page.
    for (const turn of conversation) renderTurn(ui.history, turn.role, turn.content);

    const submit = async () => {
      if (streaming) return;
      const q = input.value.trim();
      if (!q) return;
      if (q.length > MAX_CHARS) {
        alert(`Please keep it under ${MAX_CHARS} characters.`);
        return;
      }

      streaming = true;
      if (button) button.disabled = true;
      input.value = '';

      conversation.push({ role: 'user', content: q });
      renderTurn(ui.history, 'user', q);
      saveConversation();
      renderChips(ui.chips, input, submit);

      // Assistant bubble — fills as tokens arrive.
      const answerEl = renderTurn(ui.history, 'assistant', '');
      answerEl.textContent = 'Thinking…';
      let answer = '';

      try {
        await streamAnswer(conversation.slice(-MAX_HISTORY), (delta) => {
          if (!answer) answerEl.textContent = ''; // clear "Thinking…"
          answer += delta;
          const { main } = splitCitation(answer);
          answerEl.textContent = main;
          answerEl.scrollIntoView({ block: 'nearest' });
        });

        const { source } = splitCitation(answer);
        if (source) {
          const src = el('div', { fontSize: '0.75rem', opacity: '0.6', marginTop: '4px' });
          src.textContent = 'Source: ' + source;
          answerEl.insertAdjacentElement('afterend', src);
        }

        conversation.push({ role: 'assistant', content: answer || 'No answer returned.' });
        saveConversation();
      } catch (err) {
        answerEl.textContent = `Sorry — I couldn't answer that. (${err.message})`;
        // Drop the failed user turn so the next attempt isn't poisoned by it.
        conversation.pop();
        saveConversation();
      } finally {
        streaming = false;
        if (button) button.disabled = false;
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });

    renderChips(ui.chips, input, submit);
    renderCTA(ui.cta);
    renderAbout(ui.about);
    setupRotatingPlaceholders(input);
  }

  async function init() {
    try {
      const res = await fetch('manifest.json', { cache: 'no-cache' });
      manifest = await res.json();
    } catch {
      manifest = null;
    }

    applyCaption();

    const form =
      document.querySelector('form[data-llm-form]') || document.querySelector('form');
    if (form) bindForm(form);
  }

  init();
})();
