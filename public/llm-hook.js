// Shared chat controller injected into every option (art-style) page.
//
// One file drives the conversational behaviour across every design:
//   - multi-turn streaming chat (SSE) against /api/ask
//   - conversation persisted in sessionStorage so the signature "shuffle"
//     restyles the page WITHOUT losing the thread
//   - suggested-question chips (a pinned starter + a random draw from a pool,
//     then dynamic follow-ups after each answer)
//   - earthquake animation + style shuffle after a long wait, or on demand
//   - persistent contact CTA, "What's behind this?" disclosure
//
// Its styles live in llm-hook.css, linked in each page's <head> so nothing
// paints unstyled while this script loads. All injected UI inherits the host
// design's colours/fonts (currentColor / inherit) so it looks native on every
// style.

(() => {
  const ENDPOINT = '/api/ask';
  const CHAT_KEY = 'portfolio-chat-v1';
  const MAX_CHARS = 500;
  const MAX_HISTORY = 12;
  const EARTHQUAKE_DELAY_MS = 120000; // slow-answer auto-shuffle trigger (2 min)
  const SHUFFLE_VEIL_KEY = 'portfolio-shuffle-veil';

  // Cycling status lines shown in the loading skeleton (composite design).
  // Index 0 always shows first; the rest are shuffled randomly each time.
  const STATUSES_FIRST = 'Reading my bio…';
  const STATUSES_REST = [
    'Consulting the fundamental interconnectedness of all things…',
    'Following the universe\'s subtle clues…',
    'A cat appeared. Ignoring it for now…',
    'Checking if this is relevant. It probably is…',
    'The answer exists. Locating it holistically…',
    'Rummaging through the space-time sofa cushions…',
    'Cross-referencing with the Electric Monk…',
    'Something is connected to something else. Working on it…',
    'The horse is fine. Focusing on your question…',
    'Applying Zen navigation principles…',
    'Detecting improbable correlations…',
    'Things are weirder than they look. Proceeding anyway…',
    'A ghost just walked through the server room. Good sign…',
    'The biscuit tin is empty. Caffeinating metaphysically…',
    'Following a random stranger who seems to know the way…',
    'Persuading the universe to cooperate…',
    'Odd. That should not have worked. But it did…',
    'Checking for coincidences that are definitely not coincidences…',
    'Stuck in the bath. Thinking through it…',
    'The sofa is stuck on the stairs. Routing around it…',
    'Quantum entanglement achieved. Mostly…',
    'Triangulating via a series of unlikely taxi rides…',
    'The answer came to me in a dream. Verifying now…',
    'Holistic logic circuits warming up…',
    'It\'s not a coincidence. Nothing ever is…',
    'The universe is providing. Please hold…',
    'Retracing steps that were never actually taken…',
    'Consulting a refrigerator that may be haunted…',
    'Thor (the cat) is sitting on the relevant files…',
    'Found a lead. Following it somewhere completely unrelated…',
    'A door that should be locked is open. Interesting…',
    'The Electric Monk believes this on your behalf…',
    'Detecting meaningful patterns in background noise…',
  ];
  function makeSTATUSES() {
    const rest = STATUSES_REST.slice().sort(() => Math.random() - 0.5);
    return [STATUSES_FIRST, ...rest];
  }

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

  // Starter questions: the pinned one always leads, the rest are drawn at
  // random from the pool on every load, so no chip wins just by its position.
  function starterQuestions(count = 4) {
    const pinned = manifest?.pinnedQuestion;
    const pool = (manifest?.suggestedQuestions || []).filter((q) => q !== pinned);
    const drawn = pool.slice().sort(() => Math.random() - 0.5);
    return (pinned ? [pinned, ...drawn] : drawn).slice(0, count);
  }

  // ---- style shuffle via parent postMessage or smooth veil transition ----
  function showShuffleVeil(onCovered) {
    const veil = document.createElement('div');
    veil.className = 'llm-shuffle-veil';
    document.body.append(veil);
    veil.getBoundingClientRect(); // force reflow before transition
    veil.classList.add('llm-veil-visible');
    setTimeout(onCovered, 360);
  }

  function playShuffleReveal() {
    const veil = document.createElement('div');
    veil.className = 'llm-shuffle-veil llm-veil-visible';
    document.body.append(veil);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      veil.style.transition = 'opacity 480ms cubic-bezier(0.22,1,0.36,1)';
      veil.classList.remove('llm-veil-visible');
      setTimeout(() => veil.remove(), 520);
    }));
  }

  function shuffleStyle() {
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'portfolio-shuffle' }, location.origin);
        return;
      } catch {
        /* fall through to standalone navigation */
      }
    }
    // Standalone: pick a random style from the manifest and veil-transition to it.
    const options = manifest?.options || [];
    const cur = currentFile();
    const others = options.filter(o => o.file && o.file !== cur);
    const pick = others.length ? others[Math.floor(Math.random() * others.length)] : null;
    if (!pick) { location.href = '../index.html?shuffle=1'; return; }
    showShuffleVeil(() => {
      try { sessionStorage.setItem(SHUFFLE_VEIL_KEY, '1'); } catch { /* no reveal */ }
      location.href = pick.file;
    });
  }

  // Jump back to the default style. Surfaced as a "Default style" dock button
  // only once the visitor has shuffled away from it.
  function resetStyle() {
    const def = manifest?.defaultStyle;
    if (!def) return;
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: 'portfolio-reset' }, location.origin);
        return;
      } catch {
        /* fall through to standalone navigation */
      }
    }
    showShuffleVeil(() => {
      try { sessionStorage.setItem(SHUFFLE_VEIL_KEY, '1'); } catch { /* no reveal */ }
      location.href = def;
    });
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

  // Full shuffle transition: announce the swap, then navigate with a veil.
  function triggerShuffleSequence() {
    enterShuffleState();
    shuffleStyle();
  }

  // Parse a completed answer into body text, optional Source, optional
  // Confidence, and the trailing [FOLLOWUPS] questions (up to 3).
  function parseAnswer(text) {
    let body = (text || '').trim();
    let confidence = '';
    let source = '';
    let followups = [];

    // Follow-ups come last, after a "[FOLLOWUPS]" sentinel line.
    const fi = body.search(/\[FOLLOWUPS\]/i);
    if (fi !== -1) {
      const block = body.slice(fi).replace(/\[FOLLOWUPS\]/i, '');
      body = body.slice(0, fi).trim();
      followups = block
        .split('\n')
        .map((l) => l.replace(/^\s*[-*\d.)\]]+\s*/, '').trim()) // strip "- ", "1. ", "1)" markers
        .filter(Boolean)
        .slice(0, 3);
    }

    const confM = body.match(/\n?\s*Confidence:\s*(\d+)\s*%?\s*$/i);
    if (confM) { confidence = confM[1] + '%'; body = body.slice(0, confM.index).trim(); }
    const srcM = body.match(/\n?\s*Source:\s*([^\n]+)\s*$/i);
    if (srcM) { source = srcM[1].trim(); body = body.slice(0, srcM.index).trim(); }
    return { body, source, confidence, followups };
  }

  // Strip trailing [FOLLOWUPS] block (incl. a partial sentinel still streaming)
  // and the Source/Confidence lines, so the live display shows only prose.
  function streamBody(text) {
    let t = text;
    const fi = t.search(/\[FOLLOWUPS\]/i);
    if (fi !== -1) t = t.slice(0, fi);
    else t = t.replace(/\n*\[[A-Z\]]*$/i, ''); // partial sentinel forming, e.g. "[FOLLOW"
    return t.replace(/\nSource:[^\n]*$/i, '').replace(/\nConfidence:[^\n]*$/i, '').trim();
  }

  // Lightweight markdown → HTML. Escapes entities first (XSS-safe), then parses
  // bold, italic, bare URLs, and bullet lists. Non-list lines keep their
  // newlines via pre-wrap. Quotes are escaped too: an autolinked URL lands in
  // an href="…" attribute, and a raw `"` in model output would break out of it.
  function renderMarkdown(raw) {
    const esc = (s) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const inline = (s) =>
      esc(s)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
        // Autolink bare http(s) URLs. Runs after escaping (so it can't inject
        // markup) and stops at "<" and trailing punctuation. http/https only.
        .replace(
          /\b(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g,
          '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-underline-offset:2px">$1</a>'
        );
    const lines = raw.split('\n');
    const parts = [];
    let listItems = [];
    const flushList = () => {
      if (listItems.length) {
        parts.push('<ul class="md-list">' + listItems.join('') + '</ul>');
        listItems = [];
      }
    };
    for (const line of lines) {
      const m = line.match(/^\s*[-*]\s+(.*)/);
      if (m) { listItems.push('<li>' + inline(m[1]) + '</li>'); }
      else { flushList(); parts.push(line.trim() === '' ? '' : inline(line)); }
    }
    flushList();
    return parts.join('\n');
  }

  function makeConfEl(pct) {
    const div = document.createElement('div');
    div.className = 'confidence-tag';
    div.innerHTML =
      '<span class="confidence-label">Confidence</span>' +
      '<span class="confidence-sep">·</span>' +
      '<span class="confidence-pct">' + pct + '</span>';
    return div;
  }

  // ---- SSE streaming from /api/ask ----
  // `source` says how the question was asked (typed | chip | followup) and is
  // only used for the visitor-question log.
  async function streamAnswer(messages, onDelta, source) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, source })
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

  // ==========================================================================
  // The chat renderer ("composite" design), used by every style page via
  // <body data-llm-design="composite">. Every cue is built from
  // currentColor/inherit so it ports to any theme.
  // ==========================================================================

  function bindComposite(form) {
    if (form.dataset.llmBound === '1') return;
    form.dataset.llmBound = '1';

    const input = form.querySelector('input[type="text"], input:not([type])');
    const submitBtn = form.querySelector('button[type="submit"], .ask-submit');
    if (!input) return;

    // --- living input: rotating ghost + blinking caret while empty/unfocused
    const ghostText = form.querySelector('.ghost-text');
    const prompts = manifest?.inputPrompts || manifest?.suggestedQuestions || [];
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
    }, 4600);
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

    // --- inject a "Default style" reset button to the LEFT of Shuffle, but
    // only when the visitor is on a non-default style (i.e. has shuffled away).
    const dock = document.querySelector('.dock');
    const defStyle = manifest?.defaultStyle;
    if (dock && defStyle && currentFile() !== defStyle && !dock.querySelector('[data-llm-reset]')) {
      const resetBtn = el('button', {}, { type: 'button' });
      resetBtn.className = 'dock-btn reset-btn';
      resetBtn.setAttribute('data-llm-reset', '');
      resetBtn.setAttribute('aria-label', 'Reset to the default style');
      resetBtn.innerHTML =
        '<span class="reset-ico" aria-hidden="true">↺</span>' +
        '<span class="dock-btn-text">Default style</span>';
      resetBtn.addEventListener('click', () => { if (!streaming) resetStyle(); });
      dock.prepend(resetBtn);
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

    // An answer's own [FOLLOWUPS], or a fresh starter draw (minus the pinned
    // one) if the model omitted them.
    function followupsFor(answer) {
      const { followups } = parseAnswer(answer);
      return followups.length ? followups : starterQuestions(4).slice(1);
    }

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
        submit(small ? 'followup' : 'chip');
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

      const { body: mdBody, source, confidence } = parseAnswer(content);
      const body = el('div'); body.className = 'answer-body'; body.innerHTML = renderMarkdown(mdBody);
      wrap.append(body);
      if (source) {
        const src = el('div'); src.className = 'answer-source'; src.textContent = 'Source: ' + source;
        wrap.append(src);
      }
      if (confidence) wrap.append(makeConfEl(confidence));
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
      head.innerHTML = '<span class="popular-label">or start with</span><span class="popular-rule"></span>';
      const row = el('div'); row.className = 'chips';
      for (const q of starterQuestions()) row.append(makeChip(q));
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

      // Latest exchange at the top.
      if (latestUserIdx >= 0) thread.append(youTurn(conversation[latestUserIdx].content));

      if (streaming && lastIsUser) {
        thread.append(liveAnswerSlot());
      } else if (!lastIsUser) {
        // A rehydrated (post-shuffle) answer has no chips yet: take its own.
        if (!currentChips) currentChips = followupsFor(conversation[conversation.length - 1].content);
        thread.append(
          answerTurn(conversation[conversation.length - 1].content, {
            flag: justLanded ? 'new answer' : 'latest',
            shimmer: shimmerPending,
            chips: chipsLoading ? null : currentChips,
            chipsLoading
          })
        );
        shimmerPending = false; // one-shot: don't replay on later re-renders
      }

      // Expanded older exchanges below, newest pair first, Q before A within each pair.
      if (older.length && earlierExpanded) {
        const header = el('div'); header.className = 'convo-header';
        header.innerHTML =
          '<span class="disclosure-caret">▴</span><span class="convo-title">Earlier</span><span class="convo-rule"></span>';
        header.style.cursor = 'pointer';
        header.addEventListener('click', () => { earlierExpanded = false; render(); });
        thread.append(header);
        const pairs = [];
        for (let i = 0; i < older.length; i += 2) pairs.push(older.slice(i, i + 2));
        pairs.reverse().forEach((pair) => {
          pair.forEach((t) => {
            if (t.role === 'user') thread.append(youTurn(t.content));
            else thread.append(answerTurn(t.content, { plain: true }));
          });
        });
      }

      chat.append(thread);

      // Actions sit right after the thread, before the footer separator:
      // the "Earlier" toggle and "Clear conversation" together.
      chat.append(buildConvoActions(older));

      chat.append(buildFooter());
    }

    // ---- submit / stream -----------------------------------------------
    async function submit(source = 'typed') {
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
      const statuses = makeSTATUSES();
      let sIdx = 0;
      if (statusEl) statusEl.textContent = statuses[0];
      const statusTimer = setInterval(() => {
        sIdx = (sIdx + 1) % statuses.length;
        if (statusEl) statusEl.textContent = statuses[sIdx];
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

      // "Thinking too long" → auto-shuffle to a fresh style.
      const eqTimer = setTimeout(() => {
        shuffled = true;
        enterShuffleState();
        saveAssistant();
        shuffleStyle();
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
          if (bodyEl) bodyEl.textContent = streamBody(answer);
          liveAnswer?.scrollIntoView({ block: 'nearest' });
        }, source);

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
        // Follow-up chips ride inside the answer's own [FOLLOWUPS] block, so
        // they're ready immediately — no second request.
        currentChips = followupsFor(answer);
        chipsLoading = false;
        render();
      } catch (err) {
        clearTimeout(eqTimer);
        clearInterval(statusTimer);
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
    // Blocked storage (some private modes) must not take the whole chat down.
    try {
      if (sessionStorage.getItem(SHUFFLE_VEIL_KEY) === '1') {
        sessionStorage.removeItem(SHUFFLE_VEIL_KEY);
        playShuffleReveal();
      }
    } catch { /* no reveal */ }
    try {
      const res = await fetch('manifest.json', { cache: 'no-cache' });
      manifest = await res.json();
    } catch {
      manifest = null;
    }

    const form =
      document.querySelector('form[data-llm-form]') || document.querySelector('form');

    if (form) bindComposite(form);
  }

  init();
})();
