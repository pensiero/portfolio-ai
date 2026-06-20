// Swappable LLM provider layer.
//
// The rest of the app only knows about `streamChat({ messages })`, an async
// generator that yields text deltas. Swapping local Ollama for a hosted model
// later (e.g. DeepSeek via OpenCode/another provider) means adding a provider
// here and flipping LLM_PROVIDER — no route or frontend changes.

const PROVIDER = process.env.LLM_PROVIDER || 'ollama';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b-mlx';

export function modelName() {
  if (PROVIDER === 'ollama') return OLLAMA_MODEL;
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

const providers = {
  ollama: ollamaStream
};

export function streamChat({ messages, signal }) {
  const provider = providers[PROVIDER];
  if (!provider) {
    throw new Error(`Unknown LLM_PROVIDER: ${PROVIDER}`);
  }
  return provider({ messages, signal });
}
