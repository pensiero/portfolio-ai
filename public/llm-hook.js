// Shared chat controller injected into every option (art-style) page.
//
// One file drives the conversational behaviour across all 31 designs:
//   - manifest-driven style caption (looked up by this page's own filename)
//   - multi-turn streaming chat (SSE) against /api/ask
//   - conversation persisted in sessionStorage so the signature "shuffle"
//     restyles the page WITHOUT losing the thread
//   - suggested-question chips (dynamic follow-ups after each answer)
//   - earthquake animation + style shuffle after 5 s of thinking
//   - persistent contact CTA, "What's behind this?" disclosure
//
// All injected UI inherits the host design's colours/fonts (currentColor /
// inherit) so it looks native on every style.

(() => {
  const ENDPOINT = '/api/ask';
  const SUGGESTIONS_ENDPOINT = '/api/suggestions';
  const CHAT_KEY = 'portfolio-chat-v1';
  const MAX_CHARS = 500;
  const MAX_HISTORY = 12;
  const EARTHQUAKE_DELAY_MS = 5000;
  const EARTHQUAKE_DURATION_MS = 2500;

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

  // ---- inject page-level animation styles ----
  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      @keyframes llm-earthquake {
        0%,100%{transform:translate(0,0) rotate(0deg)}
        10%{transform:translate(-5px,-3px) rotate(-.4deg)}
        20%{transform:translate(5px,3px) rotate(.4deg)}
        30%{transform:translate(-8px,2px) rotate(-.8deg)}
        40%{transform:translate(8px,-2px) rotate(.8deg)}
        50%{transform:translate(-4px,4px) rotate(-.4deg)}
        60%{transform:translate(4px,-4px) rotate(.4deg)}
        70%{transform:translate(-7px,3px) rotate(-.7deg)}
        80%{transform:translate(7px,-3px) rotate(.7deg)}
        90%{transform:translate(-3px,6px) rotate(-.3deg)}
      }
      body.llm-shaking {
        animation: llm-earthquake 0.09s infinite;
        transform-origin: center center;
      }
      @keyframes llm-dot-pulse {
        0%,80%,100%{opacity:.2;transform:scale(.75)}
        40%{opacity:1;transform:scale(1)}
      }
      .llm-dot {
        display:inline-block;
        width:5px;height:5px;border-radius:50%;
        background:currentColor;margin:0 2px;vertical-align:middle;
        animation:llm-dot-pulse 1.3s ease-in-out infinite;
      }
      .llm-dot:nth-child(2){animation-delay:.22s}
      .llm-dot:nth-child(3){animation-delay:.44s}
    `;
    document.head.append(s);
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

  // ---- style-identity caption (replaces/reuses existing subtitle after h1) ----
  function applyCaption() {
    const h1 = document.querySelector('h1');
    if (!h1) return;
    const entry = manifest?.options?.find((o) => o.file === currentFile());
    const line = entry?.caption || 'Subject: Oscar Fanelli · Interface: Query Portfolio';

    let subtitle = h1.nextElementSibling;

    if (subtitle && subtitle.dataset?.llmCaption === '1') {
      // Already injected (rehydrated page) — just update text.
      subtitle.textContent = line;
      return;
    }

    if (
      subtitle &&
      !['FORM', 'SECTION', 'MAIN', 'ARTICLE', 'NAV', 'ASIDE', 'HEADER', 'FOOTER'].includes(
        subtitle.tagName
      )
    ) {
      // Reuse the first text-like element as our caption.
      subtitle.dataset.llmCaption = '1';
      subtitle.textContent = line;
      // Hide any additional pre-form text elements so there's never a double subtitle.
      let sibling = subtitle.nextElementSibling;
      while (sibling) {
        if (sibling.hasAttribute('data-llm-form') || sibling.tagName === 'FORM') break;
        if (['P', 'DIV', 'SPAN', 'SMALL', 'EM', 'STRONG'].includes(sibling.tagName)) {
          sibling.style.display = 'none';
        }
        sibling = sibling.nextElementSibling;
      }
    } else {
      // No suitable element — create one.
      subtitle = el('p');
      subtitle.dataset.llmCaption = '1';
      h1.insertAdjacentElement('afterend', subtitle);
      subtitle.textContent = line;
    }
  }

  // ---- rotating placeholder ----
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

  // ---- animated thinking indicator ----
  function createThinkingEl() {
    const wrap = document.createElement('span');
    wrap.className = 'llm-thinking';
    wrap.textContent = 'Thinking ';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'llm-dot';
      wrap.append(dot);
    }
    return wrap;
  }

  // ---- earthquake + style shuffle via parent postMessage ----
  function triggerEarthquake() {
    document.body.classList.add('llm-shaking');
  }
  function stopEarthquake() {
    document.body.classList.remove('llm-shaking');
  }
  function shuffleStyle() {
    try {
      window.parent.postMessage({ type: 'portfolio-shuffle' }, '*');
    } catch {
      /* standalone page — ignore */
    }
  }

  // ---- dynamic follow-up suggestions ----
  async function fetchSuggestions(lastQuestion, lastAnswer) {
    try {
      const res = await fetch(SUGGESTIONS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: lastQuestion,
          answer: lastAnswer,
          staticQuestions: manifest?.suggestedQuestions || []
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data.suggestions) && data.suggestions.length ? data.suggestions : null;
    } catch {
      return null;
    }
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
    const clearBtn = el('button', {
      display: 'none',
      fontSize: '0.72rem',
      opacity: '0.4',
      cursor: 'pointer',
      background: 'transparent',
      border: 'none',
      color: 'inherit',
      padding: '0',
      marginTop: '12px',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
      pointerEvents: 'auto'
    });
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear conversation';

    panel.append(history, chips, cta, about, clearBtn);
    form.insertAdjacentElement('afterend', panel);

    return { panel, history, chips, cta, about, clearBtn };
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

  function renderChips(chips, input, submit, questions) {
    chips.textContent = '';
    const qs = questions || manifest?.suggestedQuestions || [];
    for (const q of qs.slice(0, 5)) {
      const chip = el('button', {
        font: 'inherit',
        fontSize: '0.8rem',
        color: 'inherit',
        background: 'transparent',
        border: '1px solid currentColor',
        borderRadius: '999px',
        padding: '5px 11px',
        cursor: 'pointer',
        opacity: '0.85',
        pointerEvents: 'auto'
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
      a.textContent = (info.repoLabel || "See how it's built") + ' →';
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

    if (button) {
      const toggleButton = () =>
        button.classList.toggle('show', input.value.trim().length > 0);
      input.addEventListener('input', toggleButton);
      toggleButton();
    }

    const ui = buildChat(form);

    // Rehydrate any conversation carried over from a previous (pre-shuffle) page.
    for (const turn of conversation) renderTurn(ui.history, turn.role, turn.content);
    if (conversation.length > 0) ui.clearBtn.style.display = '';

    // Track the current chip question set (null = static list).
    let currentChips = null;

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
      if (button) button.classList.remove('show');

      conversation.push({ role: 'user', content: q });
      renderTurn(ui.history, 'user', q);
      saveConversation();

      // Clear chips while thinking.
      ui.chips.textContent = '';

      // Assistant bubble with animated thinking indicator.
      const answerEl = renderTurn(ui.history, 'assistant', '');
      const thinkingEl = createThinkingEl();
      answerEl.append(thinkingEl);

      let answer = '';
      let earthquakeTriggered = false;

      const earthquakeTimer = setTimeout(() => {
        earthquakeTriggered = true;
        triggerEarthquake();
        setTimeout(stopEarthquake, EARTHQUAKE_DURATION_MS);
      }, EARTHQUAKE_DELAY_MS);

      try {
        await streamAnswer(conversation.slice(-MAX_HISTORY), (delta) => {
          if (answerEl.contains(thinkingEl)) answerEl.textContent = '';
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
        ui.clearBtn.style.display = '';

        clearTimeout(earthquakeTimer);

        if (earthquakeTriggered) {
          // Keep shaking; navigate to a new style after saving is done.
          shuffleStyle();
        } else {
          stopEarthquake();
          // Fetch AI-generated follow-up suggestions, fall back to static list.
          const suggestions = await fetchSuggestions(q, answer);
          currentChips = suggestions || manifest?.suggestedQuestions || null;
          renderChips(ui.chips, input, submit, currentChips);
        }
      } catch (err) {
        clearTimeout(earthquakeTimer);
        stopEarthquake();
        if (answerEl.contains(thinkingEl)) answerEl.textContent = '';
        answerEl.textContent = `Sorry — I couldn't answer that. (${err.message})`;
        conversation.pop();
        saveConversation();
        renderChips(ui.chips, input, submit, currentChips || undefined);
      } finally {
        streaming = false;
        if (button) button.disabled = false;
      }
    };

    ui.clearBtn.addEventListener('click', () => {
      try { sessionStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
      conversation = [];
      ui.history.textContent = '';
      ui.clearBtn.style.display = 'none';
      currentChips = null;
      renderChips(ui.chips, input, submit);
    });

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
    injectStyles();
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
