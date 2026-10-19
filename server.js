import express from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { streamChat, modelName } from './lib/llm.js';
import { buildMessages } from './lib/prompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');
const PRIVATE_DOC_PATH =
  process.env.PRIVATE_DOC_PATH || path.join(__dirname, 'content', 'private-context.md');

// Optional durable sink for visitor questions: a Google Apps Script web app that
// appends each question as a row in a Google Sheet. When unset, queries are only
// written to stdout (local dev, or before the secret is configured in prod).
const SHEET_WEBHOOK_URL = process.env.LOGS_SHEET_WEBHOOK_URL;
const SHEET_WEBHOOK_TOKEN = process.env.LOGS_SHEET_WEBHOOK_TOKEN;

// Request shape limits (also a lightweight abuse guard).
const MAX_MESSAGE_CHARS = 500;
// Earlier answers come back from the client, so they are untrusted too: trim
// them so a forged "assistant" turn can't smuggle in a long fake history.
// Real answers run ~1–2k characters.
const MAX_ASSISTANT_CHARS = 6000;
const MAX_HISTORY = 12;
// Give up on a stalled model before the client's 2-minute auto-shuffle.
const UPSTREAM_TIMEOUT_MS = 90 * 1000;

// Everything is same-origin (fonts are self-hosted in public/fonts, so no
// visitor IP reaches Google). Inline <style> blocks (one per art style) need
// 'unsafe-inline' for styles; scripts are all files.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'"
].join('; ');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '16kb' }));

// The private bio lives OUTSIDE this directory, so it can never be served as a
// static asset regardless of routing. public/ is the entire web surface.
app.use(express.static(PUBLIC_DIR, {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    // Font files carry a content hash in their name, so they can be cached
    // for good; everything else must show a deploy immediately.
    const immutable = filePath.endsWith('.woff2');
    res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-store');
  }
}));

// Liveness/readiness probe — cheap, no LLM call, never rate-limited.
app.get('/healthz', (req, res) => res.status(200).type('text/plain').send('ok'));

// The cluster ingress forwards no client IP (no PROXY protocol, no trusted
// forwarded headers), so req.ip is the same internal address for everyone.
// Cloudflare's CF-Connecting-IP carries the real visitor; fall back to req.ip
// locally. A request that skips Cloudflare could forge that header, so a
// site-wide cap sits behind it as the hard ceiling on model spend.
const visitorLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.get('cf-connecting-ip') || req.ip),
  message: { error: 'Too many questions in a row — give it a minute.' }
});
const siteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: () => 'site',
  message: { error: 'Lots of people are asking right now — please try again in a minute.' }
});

// How a question was asked, as reported by the client (anything else → unknown).
const QUESTION_SOURCES = new Set(['typed', 'chip', 'followup']);

function logQuery(question, answerChars, source) {
  const event = {
    ts: new Date().toISOString(),
    question: String(question || '').slice(0, MAX_MESSAGE_CHARS),
    answerChars,
    model: modelName(),
    source: QUESTION_SOURCES.has(source) ? source : 'unknown'
  };

  // Emit to stdout as a JSON line — captured by the container runtime (no PVC,
  // survives the read-only filesystem). This is the "what people ask" signal,
  // and a backstop if the remote append below fails.
  process.stdout.write(JSON.stringify(event) + '\n');

  // Best-effort durable copy to the Google Sheet. Fire-and-forget: never block the
  // response path, never throw — stdout already holds the record if this fails.
  if (SHEET_WEBHOOK_URL) {
    fetch(SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, token: SHEET_WEBHOOK_TOKEN }),
      signal: AbortSignal.timeout(5000)
    }).catch(() => {});
  }
}

// Validate and normalize the conversation history sent by the client.
function parseMessages(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'Missing messages' };
  }
  if (messages.length > MAX_HISTORY) {
    return { error: `Too many messages (max ${MAX_HISTORY})` };
  }
  const clean = [];
  for (const m of messages) {
    const role = m?.role;
    const content = typeof m?.content === 'string' ? m.content.trim() : '';
    if (role !== 'user' && role !== 'assistant') {
      return { error: 'Invalid message role' };
    }
    if (!content) return { error: 'Empty message content' };
    if (role === 'user' && content.length > MAX_MESSAGE_CHARS) {
      return { error: `Message too long (max ${MAX_MESSAGE_CHARS} characters)` };
    }
    clean.push({ role, content: role === 'assistant' ? content.slice(0, MAX_ASSISTANT_CHARS) : content });
  }
  if (clean[clean.length - 1].role !== 'user') {
    return { error: 'Last message must be from the user' };
  }
  return { messages: clean };
}

app.post('/api/ask', visitorLimiter, siteLimiter, async (req, res) => {
  const { messages, error } = parseMessages(req.body);
  if (error) return res.status(400).json({ error });

  const doc = await fs.readFile(PRIVATE_DOC_PATH, 'utf8').catch(() => '');

  const llmMessages = buildMessages(doc, messages);

  // Server-Sent Events stream back to the browser.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const lastQuestion = messages[messages.length - 1].content;
  let answerChars = 0;

  try {
    for await (const delta of streamChat({
      messages: llmMessages,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)])
    })) {
      answerChars += delta.length;
      res.write(`data: ${JSON.stringify(delta)}\n\n`);
    }
    res.write('event: done\ndata: {}\n\n');
  } catch (err) {
    if (!controller.signal.aborted) {
      // Provider errors can name the gateway, the model or a missing key, so
      // the detail stays in the server log and the visitor gets a plain line.
      console.error(`LLM error: ${err.message}`);
      const error = 'The model is unavailable right now — please try again in a minute.';
      res.write(`event: error\ndata: ${JSON.stringify({ error })}\n\n`);
    }
  } finally {
    res.end();
    if (!controller.signal.aborted) logQuery(lastQuestion, answerChars, req.body?.source);
  }
});

const server = app.listen(PORT, () => {
  console.log(`Portfolio AI server running on http://localhost:${PORT}`);
  console.log(`Model: ${modelName()}`);
  console.log(`Private doc: ${PRIVATE_DOC_PATH}`);
  // Warn loudly if the bio is missing/empty — otherwise the assistant silently
  // refuses every question with no obvious cause.
  fs.readFile(PRIVATE_DOC_PATH, 'utf8').then(
    (doc) => {
      if (!doc.trim()) {
        console.warn(`⚠  Bio file is empty: ${PRIVATE_DOC_PATH} — the assistant will refuse all questions until it has content.`);
      }
    },
    () => {
      console.warn(`⚠  Bio file not found: ${PRIVATE_DOC_PATH} — copy content/private-context.example.md to it. The assistant will refuse all questions until then.`);
    }
  );
});

// Drain in-flight connections on a rolling redeploy (K8s sends SIGTERM).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received — shutting down.`);
    server.close(() => process.exit(0));
  });
}
