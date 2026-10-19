import express from 'express';
import rateLimit from 'express-rate-limit';
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
const MAX_HISTORY = 12;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));

// The private bio lives OUTSIDE this directory, so it can never be served as a
// static asset regardless of routing. public/ is the entire web surface.
app.use(express.static(PUBLIC_DIR, {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
  }
}));

// Liveness/readiness probe — cheap, no LLM call, never rate-limited.
app.get('/healthz', (req, res) => res.status(200).type('text/plain').send('ok'));

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' }
});

function logQuery(question, answerChars) {
  const event = {
    ts: new Date().toISOString(),
    question: String(question || '').slice(0, MAX_MESSAGE_CHARS),
    answerChars,
    model: modelName()
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
    clean.push({ role, content });
  }
  if (clean[clean.length - 1].role !== 'user') {
    return { error: 'Last message must be from the user' };
  }
  return { messages: clean };
}

app.post('/api/ask', askLimiter, async (req, res) => {
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
      signal: controller.signal
    })) {
      answerChars += delta.length;
      res.write(`data: ${JSON.stringify(delta)}\n\n`);
    }
    res.write('event: done\ndata: {}\n\n');
  } catch (err) {
    if (!controller.signal.aborted) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    }
  } finally {
    res.end();
    if (!controller.signal.aborted) logQuery(lastQuestion, answerChars);
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
