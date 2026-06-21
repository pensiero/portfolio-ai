// Shared chat controller injected into every option (art-style) page.
//
// One file drives the conversational behaviour across all 31 designs:
//   - manifest-driven style caption (looked up by this page's own filename)
//   - multi-turn streaming chat (SSE) against /api/ask
//   - conversation persisted in sessionStorage so the signature "shuffle"
//     restyles the page WITHOUT losing the thread
//   - suggested-question chips (dynamic follow-ups after each answer)
//   - earthquake animation + style shuffle after a long wait, or on demand
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
  const EARTHQUAKE_DELAY_MS = 120000; // slow-answer "thinking too long" trigger (2 min)
  const EARTHQUAKE_DURATION_MS = 2000; // the shake lasts exactly 2s, then shuffle

  // Cycling status lines shown in the loading skeleton (composite design).
  const STATUSES = ['Reading my bio…', 'Connecting the dots…', 'Composing an answer…'];

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
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'portfolio-shuffle' }, '*');
        return;
      } catch {
        /* fall through to standalone navigation */
      }
    }
    // Standalone (page opened directly, no launcher iframe): hop to the
    // launcher and ask it to roll a fresh style.
    location.href = '../index.html?shuffle=1';
  }

  // The Cards button itself morphs into the "Redesigning myself…" beat (three
  // dots + label) during a shuffle. Built from currentColor so it inherits any
  // theme.
  function enterShuffleState() {
    const btn = document.querySelector('[data-llm-shuffle]');
    if (!btn || btn.classList.contains('is-shuffling')) return;
    btn.classList.add('is-shuffling');
    btn.disabled = true;
    btn.innerHTML =
      '<span class="dotwave"><span></span><span></span><span></span></span>' +
      '<span class="shuffle-beat-text">Redesigning myself…</span>';
  }

  // Full shuffle transition: announce → shake for exactly 2s → swap style.
  function triggerShuffleSequence() {
    enterShuffleState();
    triggerEarthquake();
    setTimeout(shuffleStyle, EARTHQUAKE_DURATION_MS);
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
    if (!about || !info) return;

    // Derive paragraphs from the structured manifest shape (lead + points),
    // falling back to a legacy `paragraphs` array if present.
    const paragraphs =
      info.paragraphs ||
      [info.lead, ...(info.points || []).map((p) => p.title + '. ' + p.body)].filter(Boolean);
    if (!paragraphs.length && !info.repoUrl) return;

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

    for (const p of paragraphs) {
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

  // ==========================================================================
  // COMPOSITE renderer — the rich "Direction E" design. Opt-in via
  // <body data-llm-design="composite">. Only option-1 uses it today; the other
  // styles keep the legacy renderer above untouched. Every cue is built from
  // currentColor/inherit so this still ports to any theme when adopted later.
  // ==========================================================================

  function bindComposite(form) {
    if (form.dataset.llmBound === '1') return;
    form.dataset.llmBound = '1';

    const input = form.querySelector('input[type="text"], input:not([type])');
    const submitBtn = form.querySelector('button[type="submit"], .ask-submit');
    if (!input) return;

    // --- living input: rotating ghost + blinking caret while empty/unfocused
    const ghostText = form.querySelector('.ghost-text');
    const prompts = manifest?.suggestedQuestions || [];
    let gi = 0;
    const tickGhost = () => {
      if (ghostText && prompts.length) ghostText.textContent = prompts[gi++ % prompts.length];
    };
    const refreshGhost = () => {
      const hasText = input.value.trim().length > 0;
      const active = document.activeElement === input || hasText;
      form.classList.toggle('is-active', active);
      // The "Ask" button only surfaces once the visitor has typed something.
      form.classList.toggle('has-text', hasText);
    };
    tickGhost();
    refreshGhost();
    setInterval(() => {
      if (!form.classList.contains('is-active')) tickGhost();
    }, 2600);
    input.addEventListener('focus', refreshGhost);
    input.addEventListener('blur', refreshGhost);
    input.addEventListener('input', refreshGhost);

    // --- wire the Cards shuffle button
    const shuffleBtn = document.querySelector('[data-llm-shuffle]');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', () => {
        if (!streaming) triggerShuffleSequence();
      });
    }

    // --- wire the "What's behind this?" dock button (floating overlay)
    const behindBtn = document.querySelector('[data-llm-behind]');
    let behindOverlay = null;
    function onBehindKey(e) {
      if (e.key === 'Escape') closeBehind();
    }
    function closeBehind() {
      if (behindOverlay) {
        behindOverlay.remove();
        behindOverlay = null;
      }
      behindBtn?.classList.remove('is-open');
      behindBtn?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('keydown', onBehindKey);
    }
    function openBehind() {
      if (behindOverlay) return;
      behindOverlay = buildBehindOverlay(closeBehind);
      document.body.append(behindOverlay);
      behindBtn?.classList.add('is-open');
      behindBtn?.setAttribute('aria-expanded', 'true');
      document.addEventListener('keydown', onBehindKey);
    }
    if (behindBtn) {
      behindBtn.setAttribute('aria-expanded', 'false');
      behindBtn.addEventListener('click', () => (behindOverlay ? closeBehind() : openBehind()));
    }

    // --- chat region rendered after the form
    const chat = el('div');
    chat.className = 'chat';
    form.insertAdjacentElement('afterend', chat);

    // view state
    let earlierExpanded = false;
    let justLanded = false; // newest answer just arrived → "new answer" flag
    let shimmerPending = false; // play the one-shot rule shimmer on next render
    let chipsLoading = false; // fetching follow-up suggestions for the latest answer
    let currentChips = null; // follow-up suggestions for the latest answer

    // ---- small builders -------------------------------------------------
    function makeChip(label, small) {
      const chip = el('button', {}, { type: 'button' });
      chip.className = small ? 'chip chip-sm' : 'chip';
      // Follow-up chips carry an "↗" affordance; the sent question stays clean.
      chip.textContent = small ? label + ' ↗' : label;
      chip.addEventListener('click', () => {
        if (streaming) return;
        input.value = label;
        refreshGhost();
        submit();
      });
      return chip;
    }

    function youTurn(text) {
      const wrap = el('div'); wrap.className = 'turn-you';
      const inner = el('div'); inner.className = 'inner';
      const label = el('div'); label.className = 'you-label'; label.textContent = 'You';
      const bubble = el('div'); bubble.className = 'you-bubble'; bubble.textContent = text;
      inner.append(label, bubble);
      wrap.append(inner);
      return wrap;
    }

    // A completed Oscar answer. flag: 'new answer' | 'latest' | '' ; plain dims it.
    function answerTurn(content, { flag = '', plain = false, shimmer = false, chips = null, chipsLoading = false } = {}) {
      const wrap = el('div');
      wrap.className = 'answer' + (plain ? ' is-plain' : '') + (flag === 'latest' || flag === 'new answer' ? ' is-latest' : '');
      const rule = el('div'); rule.className = 'answer-rule';
      wrap.append(rule);
      if (shimmer) {
        const sh = el('div'); sh.className = 'answer-shimmer';
        wrap.append(sh);
      }
      const head = el('div'); head.className = 'answer-head';
      const label = el('div'); label.className = 'answer-label'; label.textContent = 'Oscar AI';
      head.append(label);
      if (flag) {
        const f = el('span'); f.className = 'answer-flag'; f.textContent = flag;
        head.append(f);
      }
      wrap.append(head);

      const { main, source } = splitCitation(content);
      const body = el('div'); body.className = 'answer-body'; body.textContent = main;
      wrap.append(body);
      if (source) {
        const src = el('div'); src.className = 'answer-source'; src.textContent = 'Source: ' + source;
        wrap.append(src);
      }
      if (chipsLoading) {
        // "Thinking about follow-ups" beat while suggestions are fetched.
        const load = el('div'); load.className = 'answer-chips-loading';
        load.innerHTML =
          '<span class="dotwave"><span></span><span></span><span></span></span>' +
          '<span class="chips-loading-text">Thinking of follow-ups…</span>';
        wrap.append(load);
      } else if (chips && chips.length) {
        const row = el('div'); row.className = 'answer-chips';
        for (const q of chips.slice(0, 3)) row.append(makeChip(q, true));
        wrap.append(row);
      }
      return wrap;
    }

    // Live (streaming) Oscar slot: thinking skeleton, swapped for text on first token.
    function liveAnswerSlot() {
      const wrap = el('div'); wrap.className = 'answer is-live is-latest';
      const rule = el('div'); rule.className = 'answer-rule';
      wrap.append(rule);
      const head = el('div'); head.className = 'thinking-head';
      head.innerHTML =
        '<span class="answer-label">Oscar AI</span>' +
        '<span class="dotwave"><span></span><span></span><span></span></span>' +
        '<span class="status-text"></span>';
      wrap.append(head);
      for (const w of ['100%', '94%', '68%']) {
        const line = el('div', { width: w }); line.className = 'skeleton-line';
        wrap.append(line);
      }
      return wrap;
    }

    function buildPopular() {
      const frag = document.createDocumentFragment();
      const head = el('div'); head.className = 'popular';
      head.innerHTML = '<span class="popular-label">Popular questions</span><span class="popular-rule"></span>';
      const row = el('div'); row.className = 'chips';
      for (const q of (manifest?.suggestedQuestions || []).slice(0, 4)) row.append(makeChip(q));
      frag.append(head, row);
      return frag;
    }

    function buildFooter() {
      const footer = el('div'); footer.className = 'footer';
      const c = manifest?.contact || {};
      const links = [];
      if (c.email) links.push(['Email', 'mailto:' + c.email]);
      if (c.linkedin) links.push(['LinkedIn', c.linkedin]);
      if (c.github) links.push(['GitHub', c.github]);
      if (links.length) {
        const contact = el('div'); contact.className = 'footer-contact';
        contact.append(document.createTextNode('Want the real Oscar? '));
        links.forEach(([t, href], i) => {
          if (i) contact.append(document.createTextNode(' · '));
          const a = el('a'); a.href = href; a.textContent = t;
          if (href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          contact.append(a);
        });
        footer.append(contact);
      }
      return footer;
    }

    // Earlier-toggle + Clear conversation, shown right after the thread.
    function buildConvoActions(older) {
      const actions = el('div'); actions.className = 'convo-actions';

      if (older.length && !earlierExpanded) {
        const n = Math.ceil(older.length / 2);
        const bar = el('div'); bar.className = 'earlier-bar';
        bar.innerHTML =
          '<span class="disclosure-caret">▾</span> Earlier · ' +
          '<span class="count">' + n + (n === 1 ? ' more exchange' : ' more exchanges') + '</span>';
        bar.addEventListener('click', () => { earlierExpanded = true; render(); });
        actions.append(bar);
      }

      const clear = el('button', {}, { type: 'button' });
      clear.className = 'clear-btn';
      clear.textContent = 'Clear conversation';
      clear.addEventListener('click', () => {
        if (streaming) return;
        try { sessionStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
        conversation = [];
        currentChips = null;
        earlierExpanded = false;
        justLanded = false;
        render();
      });
      actions.append(clear);
      return actions;
    }

    // Floating "What's behind this?" overlay: a scrim + popover anchored above
    // the dock. Mounted/unmounted on demand (not part of the chat render).
    function buildBehindOverlay(onClose) {
      const info = manifest?.about || {};

      const overlay = el('div'); overlay.className = 'behind-overlay';
      const scrim = el('div'); scrim.className = 'behind-scrim';
      scrim.addEventListener('click', onClose);
      overlay.append(scrim);

      const panel = el('div'); panel.className = 'behind-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', info.label || "What's behind this?");

      const head = el('div'); head.className = 'behind-head';
      const eyebrow = el('div'); eyebrow.className = 'behind-eyebrow';
      eyebrow.textContent = info.label || "What's behind this?";
      const close = el('button', {}, { type: 'button' });
      close.className = 'behind-close'; close.setAttribute('aria-label', 'Close');
      close.textContent = '×';
      close.addEventListener('click', onClose);
      head.append(eyebrow, close);
      panel.append(head);

      if (info.lead) {
        const lead = el('p'); lead.className = 'behind-lead';
        lead.textContent = info.lead;
        panel.append(lead);
      }

      if (info.points?.length) {
        const list = el('div'); list.className = 'behind-points';
        info.points.forEach((p, i) => {
          const item = el('div'); item.className = 'behind-point';
          const num = el('div'); num.className = 'behind-point-num';
          num.textContent = String(i + 1).padStart(2, '0');
          const txt = el('div');
          const title = el('div'); title.className = 'behind-point-title'; title.textContent = p.title;
          const body = el('p'); body.className = 'behind-point-body'; body.textContent = p.body;
          txt.append(title, body);
          item.append(num, txt);
          list.append(item);
        });
        panel.append(list);
      }

      if (info.repoUrl) {
        const src = el('div'); src.className = 'behind-source';
        const strong = el('b');
        // "Open source." stays plain; the rest becomes the repo link.
        strong.textContent = 'Open source. ';
        const a = el('a');
        a.href = info.repoUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = (info.repoLabel || "See how it's built") + ' ↗';
        src.append(strong, a);
        panel.append(src);
      }

      overlay.append(panel);
      return overlay;
    }

    // ---- the one render path -------------------------------------------
    function render() {
      chat.textContent = '';

      if (conversation.length === 0 && !streaming) {
        chat.append(buildPopular());
        chat.append(buildFooter());
        return;
      }

      const thread = el('div'); thread.className = 'thread';

      // Index of the latest user turn (the live/most-recent exchange).
      const lastIsUser = conversation[conversation.length - 1]?.role === 'user';
      const latestUserIdx = lastIsUser
        ? conversation.length - 1
        : conversation.length - 2;
      const older = conversation.slice(0, Math.max(0, latestUserIdx));

      // Expanded: the full thread reads top-to-bottom under a "Conversation"
      // header. (Collapsed, the "Earlier" toggle lives in the actions row below.)
      if (older.length && earlierExpanded) {
        const header = el('div'); header.className = 'convo-header';
        header.innerHTML =
          '<span class="disclosure-caret">▴</span><span class="convo-title">Conversation</span><span class="convo-rule"></span>';
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => { earlierExpanded = false; render(); });
        thread.append(header);
        older.forEach((t) => {
          if (t.role === 'user') thread.append(youTurn(t.content));
          else thread.append(answerTurn(t.content, { plain: true }));
        });
      }

      // latest exchange
      if (latestUserIdx >= 0) thread.append(youTurn(conversation[latestUserIdx].content));

      if (streaming && lastIsUser) {
        thread.append(liveAnswerSlot());
      } else if (!lastIsUser) {
        thread.append(
          answerTurn(conversation[conversation.length - 1].content, {
            flag: justLanded ? 'new answer' : 'latest',
            shimmer: shimmerPending,
            chips: chipsLoading ? null : (currentChips || manifest?.suggestedQuestions || null),
            chipsLoading
          })
        );
        shimmerPending = false; // one-shot: don't replay on later re-renders
      }

      chat.append(thread);

      // Actions sit right after the thread, before the footer separator:
      // the "Earlier" toggle and "Clear conversation" together.
      chat.append(buildConvoActions(older));

      chat.append(buildFooter());
    }

    // ---- submit / stream -----------------------------------------------
    async function submit() {
      if (streaming) return;
      const q = input.value.trim();
      if (!q) return;
      if (q.length > MAX_CHARS) {
        alert(`Please keep it under ${MAX_CHARS} characters.`);
        return;
      }

      justLanded = false;
      streaming = true;
      if (submitBtn) submitBtn.disabled = true;
      input.value = '';
      refreshGhost();

      conversation.push({ role: 'user', content: q });
      saveConversation();
      render(); // draws the live thinking slot

      const liveAnswer = chat.querySelector('.answer.is-live');
      const statusEl = liveAnswer?.querySelector('.status-text');
      let sIdx = 0;
      if (statusEl) statusEl.textContent = STATUSES[0];
      const statusTimer = setInterval(() => {
        sIdx = (sIdx + 1) % STATUSES.length;
        if (statusEl) statusEl.textContent = STATUSES[sIdx];
      }, 1500);

      let answer = '';
      let firstToken = true;
      let bodyEl = null;
      let shuffled = false;
      let assistantSaved = false;

      // Persist the answer (whole or partial) exactly once so it survives the
      // shuffle and rehydrates on the next style — no dangling question.
      const saveAssistant = () => {
        if (assistantSaved) return;
        assistantSaved = true;
        conversation.push({ role: 'assistant', content: answer || 'No answer returned.' });
        saveConversation();
      };

      // "Thinking too long" → signature earthquake: shake for exactly 2s, then
      // shuffle. If the answer lands during the shake it's saved in full first.
      const eqTimer = setTimeout(() => {
        shuffled = true;
        enterShuffleState();
        triggerEarthquake();
        setTimeout(() => {
          saveAssistant();
          shuffleStyle();
        }, EARTHQUAKE_DURATION_MS);
      }, EARTHQUAKE_DELAY_MS);

      const swapToBody = () => {
        clearInterval(statusTimer);
        liveAnswer.innerHTML =
          '<div class="answer-rule"></div>' +
          '<div class="answer-head"><div class="answer-label">Oscar AI</div></div>';
        bodyEl = el('div'); bodyEl.className = 'answer-body';
        liveAnswer.append(bodyEl);
      };

      try {
        await streamAnswer(conversation.slice(-MAX_HISTORY), (delta) => {
          if (firstToken) { firstToken = false; swapToBody(); }
          answer += delta;
          const { main } = splitCitation(answer);
          if (bodyEl) bodyEl.textContent = main;
          liveAnswer?.scrollIntoView({ block: 'nearest' });
        });

        clearTimeout(eqTimer);
        clearInterval(statusTimer);
        saveAssistant();

        if (shuffled) {
          // Shuffle is mid-flight; the full answer is now saved and will
          // rehydrate on the next style. Leave the shaking page as-is.
          return;
        }

        justLanded = true;
        shimmerPending = true;
        streaming = false;
        if (submitBtn) submitBtn.disabled = false;
        // Show the answer right away with a "thinking of follow-ups" beat, then
        // swap in the chips once the suggestions request resolves.
        chipsLoading = true;
        render();
        currentChips = (await fetchSuggestions(q, answer)) || manifest?.suggestedQuestions || null;
        chipsLoading = false;
        render();
      } catch (err) {
        clearTimeout(eqTimer);
        clearInterval(statusTimer);
        stopEarthquake();
        conversation.pop(); // drop the unanswered question
        saveConversation();
        streaming = false;
        if (submitBtn) submitBtn.disabled = false;
        input.value = q; // let them retry
        refreshGhost();
        render();
        const note = answerTurn(`Sorry — I couldn't answer that. (${err.message})`, { plain: true });
        chat.querySelector('.thread')?.append(note) || chat.prepend(note);
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });

    render();
  }

  async function init() {
    injectStyles();
    try {
      const res = await fetch('manifest.json', { cache: 'no-cache' });
      manifest = await res.json();
    } catch {
      manifest = null;
    }

    const form =
      document.querySelector('form[data-llm-form]') || document.querySelector('form');

    if (document.body.dataset.llmDesign === 'composite') {
      if (form) bindComposite(form);
      return;
    }

    applyCaption();
    if (form) bindForm(form);
  }

  init();
})();
