# Portfolio AI — Roadmap

A conversational portfolio: visitors ask an LLM questions answered from a private
bio, behind a signature "shuffle" that loads one of 31 hand-designed art-style
pages. This file tracks what's shipped and what's next.

## Architecture (current)

```
server.js            Express: serves public/, streams /api/ask (SSE)
lib/llm.js           Swappable LLM provider (Ollama today; cloud later)
content/             private-context.md — the bio, never web-served
logs/                queries.jsonl — anonymized question log (gitignored)
public/              the entire web surface
  index.html         manifest-driven shuffle launcher
  options.html       manifest-driven gallery of all styles
  llm-hook.js        shared chat controller injected into every option
  styles.css         option-1 only
  options/
    manifest.json    SINGLE SOURCE OF TRUTH (options, captions, chips, contact)
    option-*.html    31 art-style pages
```

Adding a style = drop a file in `public/options/` + add one `manifest.json` entry.

## Done

**Bug fixes**

- Bio can no longer leak: it lives in `content/` outside the served `public/` root (the old static-file 403 guard was
  dead code — removed).
- Streaming responses (SSE) — no more frozen "Thinking…".
- Abuse protection: per-IP rate limit (20/min), 16kb body cap, per-message (500 char) and history (12 msg) caps.
- Question logging to `logs/queries.jsonl` (timestamp, question, answer length, model — no IP/PII). This is the "what
  people ask" signal.
- Multi-turn conversation (was single-turn).

**Features**

- Suggested-question chips (manifest-driven, click to ask).
- Persistent contact CTA (LinkedIn / GitHub / email) on every style.
- Best-effort citations: a trailing `Source:` line is rendered when the model emits one (quality improves with a
  stronger model).
- Honest "I don't have that information" via a hardened, injection-resistant system prompt.
- "What's behind this?" disclosure on every style — explains the living, AI-crafted profile and links to the public
  GitHub repo (manifest `about`).

**Guardrails (single-purpose lockdown)**

- Rewrote the system prompt: the assistant has exactly one job (answer about Oscar from the bio) and explicitly refuses
  general-LLM use (coding, translation, trivia, roleplay, opinions) with a fixed one-line decline.
- Defense in depth: user input is framed as data between explicit document delimiters, plus a trailing system reminder
  after the conversation (last-instruction-wins) to resist mid-thread prompt injection.
- Refuses to reveal the prompt or dump the context document verbatim.

**Going public (repo hardening)**

- `.gitignore` now excludes the real bio (`content/private-context.md`), `logs/`, `.env*`. Only the sanitized
  `content/private-context.example.md` template is tracked.
- Added `README.md` (with the privacy model), `LICENSE` (MIT), `.env.example`.
- Local model default is now `gemma4:12b-mlx` (was `llama3.1:8b-instruct-q4_K_M`).

**Refactor**

- `options/manifest.json` is now the single source of truth — replaced the triple-maintained list/caption data plus the
  hardcoded gallery (4 sources → 1).
- Stripped redundant inline form-binding scripts from all 31 options; folded `app.js` into `llm-hook.js` and deleted it;
  standardized every form on a `data-llm-form` contract.
- Restructured into a `public/` web root; provider abstraction in `lib/llm.js`.
- Chat persists across the shuffle via sessionStorage (restyle without losing the thread).

## Next

- **Scannable / skim profile (hybrid landing).** Not everyone wants to converse — recruiters skim. Add a fast, static
  profile (who/where/how-to-reach) alongside the ask-anything layer so skimmers aren't forced through chat.

## Later

- **Cloud model swap.** Move off local Ollama to a hosted model — evaluating DeepSeek V4 Flash / Pro via OpenCode or
  another provider. Already abstracted in `lib/llm.js`: add a provider + flip `LLM_PROVIDER`. Revisit best-effort
  citation quality once on the stronger model.
- **Real bio content.** `content/private-context.md` is still placeholder — the product is only as good as the bio. Pull
  the real biography from its source repo (decide: git submodule vs build-time fetch).
- **Retrieval / RAG.** When the bio grows past one file, retrieve relevant sections instead of stuffing the whole
  document into every prompt.
- **Prompt caching.** Once on a caching-capable API, cache the static bio so it isn't re-billed per call (N/A to
  Ollama).

## Notes / TODO before going public

- Replace placeholder bio content in `content/private-context.md`.
