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
  const EARTHQUAKE_DELAY_MS = 120000; // slow-answer auto-shuffle trigger (2 min)
  const SHUFFLE_VEIL_KEY = 'portfolio-shuffle-veil';

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
      .llm-shuffle-veil {
        position:fixed;inset:0;z-index:9999;
        background:#000;opacity:0;pointer-events:none;
        transition:opacity 320ms cubic-bezier(0.4,0,1,1);
      }
      .llm-shuffle-veil.llm-veil-visible {
        opacity:1;pointer-events:all;
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

    // Full composite-renderer CSS, injected for every page that opts in.
    // Uses currentColor throughout so it adapts to any theme automatically.
    // Each option only needs to define --card-bg (their card/panel bg colour).
    if (document.body.dataset.llmDesign === 'composite') {
      s.textContent += `
        :root {
          --line: color-mix(in srgb, currentColor 12%, transparent);
          --line-soft: color-mix(in srgb, currentColor 8%, transparent);
          --chip-line: color-mix(in srgb, currentColor 26%, transparent);
          --bubble-bg: color-mix(in srgb, currentColor 8%, transparent);
          --answer-bg: color-mix(in srgb, currentColor 4%, transparent);
        }
        /* presence dot */
        .presence{display:flex;align-items:center;gap:10px;margin-bottom:14px}
        .presence-dot{position:relative;flex:none;width:10px;height:10px}
        .presence-core,.presence-ring{position:absolute;inset:0;border-radius:50%}
        .presence-core{background:currentColor;animation:breathe 3.2s ease-in-out infinite}
        .presence-ring{border:1.5px solid currentColor;animation:ring 3.2s ease-out infinite}
        .presence-label{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;opacity:.6}
        /* subhead */
        .subhead{font-size:1rem;line-height:1.5;opacity:.72;margin:0 0 24px}
        /* ask field */
        .ask-field{position:relative;display:flex;align-items:center;border:1.5px solid color-mix(in srgb,currentColor 50%,transparent);border-radius:11px;padding:0 8px 0 18px;height:60px;transition:border-color 160ms ease}
        .ask-field:focus-within{border-color:currentColor}
        .ask-input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:17px;color:inherit}
        .ask-ghost{position:absolute;left:18px;right:96px;display:flex;align-items:center;pointer-events:none;font-size:17px;opacity:.55;white-space:nowrap;overflow:hidden}
        .ask-ghost .ghost-text{overflow:hidden;text-overflow:ellipsis;transition:opacity 200ms ease}
        .ask-caret{flex:none;display:inline-block;width:2px;height:22px;margin-left:2px;background:currentColor;animation:caretBlink 1.05s step-end infinite}
        .ask-field.is-active .ask-ghost{display:none}
        .ask-submit{flex:none;display:none;font:inherit;font-weight:600;font-size:15px;color:var(--card-bg,#fff);background:currentColor;border:none;border-radius:8px;height:44px;padding:0 24px;cursor:pointer;transition:opacity 160ms ease}
        .ask-submit:disabled{opacity:.5;cursor:default}
        .ask-field.has-text .ask-submit{display:block}
        .sr-only{position:absolute;width:1px;height:1px;margin:-1px;border:0;padding:0;clip:rect(0 0 0 0);overflow:hidden}
        /* chat */
        .chat{margin-top:4px}
        .popular{display:flex;align-items:center;gap:10px;margin:22px 0 12px}
        .popular-label{font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;opacity:.55}
        .popular-rule{flex:1;height:1px;background:var(--line)}
        .chips{display:flex;flex-wrap:wrap;gap:10px}
        .chip{font:inherit;font-size:15px;font-weight:600;color:inherit;background:transparent;border:1.5px solid var(--chip-line);border-radius:100px;padding:10px 17px;cursor:pointer;transition:background 140ms ease,transform 140ms ease}
        .chip:hover{background:var(--bubble-bg)}
        .chip:active{transform:scale(.97)}
        .chip.chip-sm{font-size:13.5px;font-weight:500;padding:7px 13px}
        /* turns */
        .turn-you{display:flex;justify-content:flex-end;margin-top:18px;animation:rowGrow .4s ease both}
        .turn-you .inner{max-width:82%}
        .you-label,.answer-label{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:600;opacity:.55;margin-bottom:6px}
        .you-label{text-align:right}
        .you-bubble{font-size:15.5px;line-height:1.5;color:inherit;background:var(--bubble-bg);border-radius:14px 14px 4px 14px;padding:10px 15px;white-space:pre-wrap}
        /* answer */
        .answer{position:relative;margin-top:16px;padding:18px 20px;border-radius:12px;background:var(--answer-bg);animation:ansIn .5s ease both}
        .answer.is-plain{background:transparent;padding:14px 18px}
        .answer-rule{position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:currentColor;opacity:.55}
        .answer.is-latest .answer-rule{opacity:1}
        .answer-shimmer{position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:3px;background:currentColor;transform-origin:top;animation:shimmerLine 1.6s ease-out forwards;pointer-events:none}
        .answer-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
        .answer-head .answer-label{margin-bottom:0}
        .answer-flag{font-size:10.5px;font-weight:600;color:inherit;border:1px solid color-mix(in srgb,currentColor 30%,transparent);border-radius:100px;padding:2px 8px}
        .answer-body{font-size:16px;line-height:1.6;color:inherit;white-space:pre-wrap}
        .answer.is-plain .answer-body{font-size:15px;line-height:1.55}
        .answer-source{margin-top:10px;font-size:12.5px;opacity:.55}
        .answer-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
        .answer-chips-loading{display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12.5px;opacity:.55}
        /* thinking skeleton */
        .thinking-head{display:flex;align-items:center;gap:10px;margin-bottom:15px}
        .dotwave{display:flex;gap:3px}
        .dotwave span{width:5px;height:5px;border-radius:50%;background:currentColor;animation:dotwave 1.1s ease-in-out infinite}
        .dotwave span:nth-child(2){animation-delay:.18s}
        .dotwave span:nth-child(3){animation-delay:.36s}
        .status-text{font-size:13px;opacity:.6}
        .skeleton-line{height:12px;border-radius:6px;margin-bottom:9px;background:linear-gradient(90deg,color-mix(in srgb,currentColor 6%,transparent) 25%,color-mix(in srgb,currentColor 16%,transparent) 50%,color-mix(in srgb,currentColor 6%,transparent) 75%);background-size:200% 100%;animation:skeleton 1.4s linear infinite}
        .skeleton-line:last-child{margin-bottom:0}
        .skeleton-line:nth-child(2){animation-delay:.2s}
        .skeleton-line:nth-child(3){animation-delay:.4s}
        /* earlier / conversation */
        .earlier-bar,.convo-header{display:flex;align-items:center;gap:8px;margin-top:18px;font-size:12px;letter-spacing:.04em;opacity:.7}
        .earlier-bar{cursor:pointer}
        .earlier-bar:hover{opacity:1}
        .disclosure-caret{opacity:.7}
        .earlier-bar .count,.convo-title{font-weight:600;text-transform:uppercase;letter-spacing:.14em;font-size:10.5px}
        .convo-rule{flex:1;height:1px;background:var(--line)}
        .convo-actions{display:flex;align-items:center;gap:10px;margin-top:16px}
        .convo-actions .earlier-bar,.convo-actions .clear-btn{margin-top:0}
        /* footer */
        .footer{margin-top:22px;padding-top:16px;border-top:1px solid var(--line-soft);font-size:13.5px;opacity:.92}
        .footer a{color:inherit}
        .footer-contact{opacity:.85}
        /* clear btn */
        .clear-btn{font:inherit;font-size:13px;color:inherit;background:transparent;border:0;padding:0;margin-left:auto;cursor:pointer;opacity:.55;text-decoration:underline;text-underline-offset:2px}
        .clear-btn:hover{opacity:.85}
        /* dock */
        .dock{position:fixed;right:clamp(14px,2.5vw,26px);bottom:clamp(14px,2.5vw,26px);z-index:40;display:flex;align-items:center;gap:10px}
        .dock-btn{display:inline-flex;align-items:center;gap:9px;font:inherit;font-size:13px;font-weight:500;color:inherit;background:var(--card-bg,rgba(255,255,255,.92));border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:100px;padding:9px 16px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.1);opacity:.94;transition:opacity 160ms ease,transform 160ms ease,box-shadow 160ms ease;backdrop-filter:blur(8px)}
        .dock-btn:hover{opacity:1;box-shadow:0 6px 22px rgba(0,0,0,.14)}
        .dock-btn:active{transform:scale(.97)}
        .dock-btn-text{white-space:nowrap}
        .shuffle-btn.is-shuffling{opacity:1;cursor:default}
        .shuffle-btn .shuffle-beat-text{white-space:nowrap}
        .shuffle-cards{position:relative;display:inline-block;width:15px;height:12px;flex:none}
        .shuffle-cards i{position:absolute;width:9px;height:11px;border:1.5px solid currentColor;border-radius:2.5px;background:var(--card-bg,rgba(255,255,255,.92));animation:deal 2.4s ease-in-out infinite}
        .shuffle-cards i:nth-child(1){left:0;top:1px}
        .shuffle-cards i:nth-child(2){left:3px;top:.5px;animation-delay:.3s}
        .shuffle-cards i:nth-child(3){left:6px;top:0;animation-delay:.6s}
        .behind-trigger.is-open{opacity:1;border-color:color-mix(in srgb,currentColor 38%,transparent)}
        .behind-trigger .behind-q{display:inline-grid;place-items:center;flex:none;width:17px;height:17px;border-radius:50%;border:1.5px solid currentColor;font-size:10.5px;font-weight:700;line-height:1}
        /* behind overlay */
        .behind-overlay{position:fixed;inset:0;z-index:60}
        .behind-scrim{position:absolute;inset:0;background:rgba(0,0,0,.32);backdrop-filter:blur(2px);animation:scrimIn .25s ease both}
        .behind-panel{position:absolute;right:clamp(14px,2.5vw,26px);bottom:clamp(64px,9vh,84px);width:min(420px,calc(100vw - 28px));max-height:min(76vh,640px);overflow-y:auto;background:var(--card-bg,#fff);color:inherit;border:1px solid var(--line);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.24);padding:22px 24px 24px;transform-origin:bottom right;animation:behindIn .32s cubic-bezier(.22,1,.36,1) both}
        .behind-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
        .behind-eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;opacity:.55}
        .behind-close{flex:none;display:grid;place-items:center;width:28px;height:28px;margin:-4px -6px -4px 0;font-size:19px;line-height:1;color:inherit;background:transparent;border:0;border-radius:50%;cursor:pointer;opacity:.55;transition:opacity 140ms ease,background 140ms ease}
        .behind-close:hover{opacity:.95;background:var(--bubble-bg)}
        .behind-lead{font-size:16px;line-height:1.55;margin:0 0 18px}
        .behind-points{display:flex;flex-direction:column;gap:15px;padding-top:18px;border-top:1px solid var(--line-soft)}
        .behind-point{display:flex;gap:12px}
        .behind-point-num{flex:none;font-size:11px;font-weight:700;letter-spacing:.04em;opacity:.4;padding-top:2px}
        .behind-point-title{font-size:14px;font-weight:600;margin:0 0 2px}
        .behind-point-body{font-size:13.5px;line-height:1.5;opacity:.8;margin:0}
        .behind-source{margin-top:18px;padding-top:16px;border-top:1px solid var(--line-soft);font-size:13.5px;opacity:.85}
        .behind-source a{color:inherit;text-underline-offset:2px}
        /* keyframes */
        @keyframes caretBlink{0%,45%{opacity:1}55%,100%{opacity:0}}
        @keyframes breathe{0%,100%{transform:scale(1);opacity:.5}50%{transform:scale(1.32);opacity:.95}}
        @keyframes ring{0%{transform:scale(.55);opacity:.55}100%{transform:scale(2.4);opacity:0}}
        @keyframes ansIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        @keyframes dotwave{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
        @keyframes shimmerLine{0%{transform:scaleY(0);opacity:.9}100%{transform:scaleY(1);opacity:0}}
        @keyframes skeleton{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes deal{0%,100%{transform:translate(0,0) rotate(0)}30%{transform:translate(3px,-3px) rotate(9deg)}60%{transform:translate(-2px,1px) rotate(-5deg)}}
        @keyframes rowGrow{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        @keyframes scrimIn{from{opacity:0}to{opacity:1}}
        @keyframes behindIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion:reduce){
          .presence-core,.presence-ring,.ask-caret,.shuffle-cards i,
          .dotwave span,.skeleton-line,.answer-shimmer,
          .answer,.turn-you,.behind-panel,.behind-scrim{animation:none!important}
        }
        @media (max-width:460px){
          .behind-panel{right:14px;left:14px;width:auto;bottom:76px}
          .ask-submit{padding:0 16px}
          .dock-btn{font-size:12px;padding:8px 13px}
        }
      `;
    }

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
        window.parent.postMessage({ type: 'portfolio-shuffle' }, '*');
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
      sessionStorage.setItem(SHUFFLE_VEIL_KEY, '1');
      location.href = pick.file;
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
      let autoShuffled = false;

      const earthquakeTimer = setTimeout(() => {
        autoShuffled = true;
        enterShuffleState();
        shuffleStyle();
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

        if (autoShuffled) return;

        // Fetch AI-generated follow-up suggestions, fall back to static list.
        const suggestions = await fetchSuggestions(q, answer);
        currentChips = suggestions || manifest?.suggestedQuestions || null;
        renderChips(ui.chips, input, submit, currentChips);
      } catch (err) {
        clearTimeout(earthquakeTimer);
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
    if (sessionStorage.getItem(SHUFFLE_VEIL_KEY) === '1') {
      sessionStorage.removeItem(SHUFFLE_VEIL_KEY);
      playShuffleReveal();
    }
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
