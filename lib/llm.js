// Swappable LLM provider layer.
//
// The rest of the app only knows about `streamChat({ messages })`, an async
// generator that yields text deltas. Swapping local Ollama for a hosted model
// later (e.g. DeepSeek via OpenCode/another provider) means adding a provider
// here and flipping LLM_PROVIDER — no route or frontend changes.

const PROVIDER = process.env.LLM_PROVIDER || 'ollama';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b-mlx';

// OpenCode Go (Zen) — OpenAI-compatible gateway. One Bearer key unlocks the
// whole Zen catalog; swap models by changing OPENCODE_MODEL alone.
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/go/v1';
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'deepseek-v4-flash';
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || '';

export function modelName() {
  if (PROVIDER === 'ollama') return OLLAMA_MODEL;
  if (PROVIDER === 'opencode') return OPENCODE_MODEL;
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

// --- OpenCode Go provider (OpenAI-compatible) ------------------------------
// Streams POST /chat/completions with stream:true, which returns Server-Sent
// Events: `data: {json}\n\n` lines carrying `choices[0].delta.content`, ending
// with `data: [DONE]`. Generic enough to reuse for any OpenAI-compatible API.
async function* opencodeStream({ messages, signal }) {
  const res = await fetch(`${OPENCODE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENCODE_API_KEY}`
    },
    body: JSON.stringify({ model: OPENCODE_MODEL, stream: true, messages }),
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
    throw new Error(`OpenCode request failed: ${detail}`);
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
}

const providers = {
  ollama: ollamaStream,
  opencode: opencodeStream
};

export function streamChat({ messages, signal }) {
  const provider = providers[PROVIDER];
  if (!provider) {
    throw new Error(`Unknown LLM_PROVIDER: ${PROVIDER}`);
  }
  return provider({ messages, signal });
}
