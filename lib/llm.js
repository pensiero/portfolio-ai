// Swappable LLM provider layer.
//
// The rest of the app only knows about `streamChat({ messages })`, an async
// generator that yields text deltas. Swapping local Ollama for a hosted model
// means flipping LLM_PROVIDER — no route or frontend changes.
//
// Three providers: `ollama` (local default), plus two hosted OpenAI-compatible
// gateways that differ only by base URL, Bearer key and model catalog —
// `opencode` (OpenCode Zen) and `openrouter` (OpenRouter). Both are built from
// the same `openAiCompatibleStream` factory.

const PROVIDER = process.env.LLM_PROVIDER || 'ollama';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b-mlx';

// OpenCode Go (Zen) — one Bearer key unlocks the whole Zen catalog; swap models
// by changing OPENCODE_MODEL alone.
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/go/v1';
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'deepseek-v4-flash';

// OpenRouter — gateway to many vendors; models are namespaced (`vendor/model`).
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';

export function modelName() {
  if (PROVIDER === 'ollama') return OLLAMA_MODEL;
  if (PROVIDER === 'opencode') return OPENCODE_MODEL;
  if (PROVIDER === 'openrouter') return OPENROUTER_MODEL;
  return PROVIDER;
}

// --- Ollama provider -------------------------------------------------------
// Streams /api/chat with stream:true, which returns newline-delimited JSON
// objects. Each carries an incremental `message.content` until `done: true`.
async function* ollamaStream({ messages, signal }) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, stream: true, messages }),
    signal
  });

  if (!res.ok || !res.body) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      detail = data?.error || detail;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(`Ollama request failed: ${detail}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue; // partial/garbled line — skip
      }
      const delta = obj?.message?.content;
      if (delta) yield delta;
      if (obj?.done) return;
    }
  }
}

// --- OpenAI-compatible providers -------------------------------------------
// Streams POST /chat/completions with stream:true, which returns Server-Sent
// Events: `data: {json}\n\n` lines carrying `choices[0].delta.content`, ending
// with `data: [DONE]`. OpenCode Zen and OpenRouter both speak this contract, so
// one factory serves both — they differ only in the config passed here.
//
// The key is read at call time (not module load) so a missing one surfaces as a
// clear error on the failing provider rather than a 401 from the gateway.
function openAiCompatible({ label, baseUrl, model, apiKeyEnv }) {
  return async function* stream({ messages, signal }) {
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
      throw new Error(`${apiKeyEnv} is not set; required for the '${label}' provider`);
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, stream: true, messages }),
      signal
    });

    if (!res.ok || !res.body) {
      let detail = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        detail = data?.error?.message || data?.error || detail;
      } catch {
        /* ignore parse errors */
      }
      throw new Error(`${label} request failed: ${detail}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        let obj;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue; // partial/garbled line — skip
        }
        const delta = obj?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  };
}

const opencodeStream = openAiCompatible({
  label: 'OpenCode',
  baseUrl: OPENCODE_BASE_URL,
  model: OPENCODE_MODEL,
  apiKeyEnv: 'OPENCODE_API_KEY'
});

const openrouterStream = openAiCompatible({
  label: 'OpenRouter',
  baseUrl: OPENROUTER_BASE_URL,
  model: OPENROUTER_MODEL,
  apiKeyEnv: 'OPENROUTER_API_KEY'
});

const providers = {
  ollama: ollamaStream,
  opencode: opencodeStream,
  openrouter: openrouterStream
};

export function streamChat({ messages, signal }) {
  const provider = providers[PROVIDER];
  if (!provider) {
    throw new Error(`Unknown LLM_PROVIDER: ${PROVIDER}`);
  }
  return provider({ messages, signal });
}
