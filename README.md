# Portfolio AI

A conversational portfolio. Instead of a static page, visitors **ask questions**
and an LLM answers them from a structured biography — behind a signature
"shuffle" that loads one of 23 hand-designed art-style pages on every visit.

It's a conversational layer over a *living professional profile*: a knowledge
base that's continuously crafted and structured together with AI and evolves
over time, rather than a one-off CV or LinkedIn export.

## How it works

```
server.js            Express: serves public/, streams /api/ask over SSE
lib/llm.js           Swappable LLM provider (local Ollama; hosted OpenCode Go / OpenRouter)
lib/prompt.js        System prompt + message envelope (shared by server and eval)
eval/                Model eval harness + playbook for comparing candidate models
content/             The biography the AI answers from — git-ignored, never served
public/              The entire web surface
  index.html         Shuffle launcher (logic in shell.js; options.html → gallery.js)
  llm-hook.js        Shared chat controller loaded by every style
  llm-hook.css       Its styles, linked in each style's <head> (no unstyled flash)
  fonts/             Self-hosted web fonts, one stylesheet per style that uses them
  options/
    manifest.json    Single source of truth (styles, chips, placeholder prompts, contact, about)
    option-*.html    24 art-style pages
```

Starter chips are `pinnedQuestion` (always first) plus a random draw from
`suggestedQuestions`, so no question wins just by its position.

A hardened, single-purpose system prompt keeps the assistant scoped to questions
about the subject only — it is not a general-purpose chatbot and refuses
off-topic use and prompt-injection attempts. Requests are rate-limited per
visitor (by Cloudflare's `CF-Connecting-IP`) and site-wide, length-capped, and
served under a strict Content-Security-Policy with every script and font
same-origin.

## Privacy model

The biography is **private and is never committed or served**:

- The real bio lives at `content/private-context.md`, which is git-ignored.
- Only the sanitized `content/private-context.example.md` template is tracked.
- The bio sits **outside** the `public/` web root, so it can't be served as a
  static asset under any route.
- Visitor questions are logged (stdout, plus an optional Google Sheet) as the
  question text, answer length, model and how it was asked (`typed`, `chip`,
  `followup`) — no IP, no cookies. The site says so in "What's behind this?".
- Fonts are self-hosted, so loading a page sends no visitor IP to Google.

## Run locally

Requires [Node.js](https://nodejs.org). The model runs either locally via
[Ollama](https://ollama.com) (default) or on a hosted, OpenAI-compatible gateway
([OpenCode Go](https://opencode.ai)) — see Configuration below. `npm start`
auto-loads a `.env` file if present.

```bash
npm install

# Pull the model (default: gemma4:12b-mlx — override with OLLAMA_MODEL)
ollama pull gemma4:12b-mlx

# Create your bio from the template
cp content/private-context.example.md content/private-context.md
#   …then edit content/private-context.md with your real biography

npm start
# → http://localhost:8787
```

## Configuration

| Variable           | Default                                  | Purpose                                  |
| ------------------ | ---------------------------------------- | ---------------------------------------- |
| `PORT`             | `8787`                                   | HTTP port                                |
| `LLM_PROVIDER`     | `ollama`                                 | `ollama` (local), `opencode` or `openrouter` (hosted) |
| `OLLAMA_URL`       | `http://127.0.0.1:11434`                 | Ollama endpoint                          |
| `OLLAMA_MODEL`     | `gemma4:12b-mlx`                         | Local model                              |
| `OPENCODE_API_KEY` | —                                        | OpenCode Go key (https://opencode.ai/auth) |
| `OPENCODE_BASE_URL`| `https://opencode.ai/zen/go/v1`          | OpenAI-compatible base URL               |
| `OPENCODE_MODEL`   | `deepseek-v4-flash`                      | Hosted model (any Zen model id)          |
| `OPENROUTER_API_KEY` | —                                      | OpenRouter key (https://openrouter.ai/keys) |
| `OPENROUTER_BASE_URL`| `https://openrouter.ai/api/v1`         | OpenAI-compatible base URL               |
| `OPENROUTER_MODEL` | `deepseek/deepseek-v4.1-flash-1017`      | Hosted model (`vendor/model` id) — pick with `eval/PLAYBOOK.md` |
| `PRIVATE_DOC_PATH` | `content/private-context.md`             | Path to the bio                          |

## Roadmap

See [`PLAN.md`](./PLAN.md).

## License

[MIT](./LICENSE)
