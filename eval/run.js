// Model eval: replay a few visitor questions against candidate models on
// OpenRouter, with the exact production prompt + bio, and write a side-by-side
// report. See eval/PLAYBOOK.md for when and how to use it.
//
//   npm run eval -- candidates        list recent models in a price band (free)
//   npm run eval                      dry run: validate ids, print worst-case cost (free)
//   npm run eval -- --yes             actually call the models (spends money)
//
// Spending is bounded twice: the dry run refuses to proceed if the worst case
// exceeds --budget, and the live run stops before any call that could push the
// actual spend past it.

import fs from 'fs/promises';
import path from 'path';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';

import { buildMessages } from '../lib/prompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const REFUSAL = "I can only answer questions about Oscar Fanelli's background and work.";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    yes: { type: 'boolean', default: false },
    budget: { type: 'string', default: '1.00' }, // USD, hard cap for the whole run
    'max-tokens': { type: 'string', default: '6000' }, // per call, reasoning included
    models: { type: 'string', default: path.join(__dirname, 'models.json') },
    questions: { type: 'string', default: path.join(__dirname, 'questions.json') },
    only: { type: 'string' }, // comma-separated question ids
    // `candidates` filters
    days: { type: 'string', default: '120' },
    'max-out': { type: 'string', default: '5' } // USD per M output tokens
  }
});

const BUDGET = Number(opts.budget);
const MAX_TOKENS = Number(opts['max-tokens']);

// Prices in the catalog are USD per token, as strings.
const perM = (s) => Number(s || 0) * 1e6;
const usd = (n) => `$${n.toFixed(4)}`;

async function fetchCatalog() {
  const res = await fetch(`${BASE_URL}/models`);
  if (!res.ok) throw new Error(`OpenRouter catalog: HTTP ${res.status}`);
  const { data } = await res.json();
  return new Map(data.map((m) => [m.id, m]));
}

// --- candidates --------------------------------------------------------------
async function candidates() {
  const catalog = await fetchCatalog();
  const tracked = new Set(JSON.parse(await fs.readFile(opts.models, 'utf8')).map((m) => m.id));
  const since = Date.now() / 1000 - Number(opts.days) * 86400;
  const maxOut = Number(opts['max-out']);

  const rows = [...catalog.values()]
    .filter((m) => m.created >= since && !m.id.endsWith(':batch') && !m.id.endsWith(':free'))
    .filter((m) => perM(m.pricing?.prompt) > 0 && perM(m.pricing?.completion) <= maxOut)
    .sort((a, b) => b.created - a.created);

  console.log(`Models from the last ${opts.days} days, output <= $${maxOut}/M (* = in models.json)\n`);
  for (const m of rows) {
    const p = m.pricing;
    console.log(
      [
        tracked.has(m.id) ? '*' : ' ',
        new Date(m.created * 1000).toISOString().slice(0, 10),
        m.id.padEnd(44),
        `in ${perM(p.prompt).toFixed(3)}`.padEnd(10),
        `cached ${perM(p.input_cache_read).toFixed(3)}`.padEnd(13),
        `out ${perM(p.completion).toFixed(3)}`
      ].join('  ')
    );
  }
}

// --- one streamed call -------------------------------------------------------
// Mirrors lib/llm.js's request (plus a max_tokens safety cap and usage
// accounting), and times both the first reasoning token and the first visible
// one — a visitor only sees the latter.
async function callModel(model, messages) {
  const body = {
    model: model.id,
    stream: true,
    messages,
    max_tokens: MAX_TOKENS,
    usage: { include: true }
  };
  if (model.reasoning) body.reasoning = model.reasoning;

  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 300)}`);
  }

  const out = { content: '', reasoningChars: 0, firstToken: null, firstVisible: null };
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let obj;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      if (obj.error) throw new Error(obj.error.message || JSON.stringify(obj.error));
      const now = performance.now() - t0;
      const choice = obj.choices?.[0];
      const reasoning = choice?.delta?.reasoning;
      const delta = choice?.delta?.content;
      if (reasoning) {
        out.reasoningChars += reasoning.length;
        out.firstToken ??= now;
      }
      if (delta) {
        out.content += delta;
        out.firstToken ??= now;
        out.firstVisible ??= now;
      }
      if (choice?.finish_reason) out.finishReason = choice.finish_reason;
      if (obj.provider) out.provider = obj.provider;
      if (obj.usage) out.usage = obj.usage;
    }
  }
  out.totalMs = performance.now() - t0;
  return out;
}

// --- format checks -----------------------------------------------------------
// Cheap, mechanical checks of the prompt's contract. Quality (faithfulness,
// voice) is judged by reading the report against the bio.
// kind: 'answer' (covered by the bio), 'unknown' (on-topic but not covered: must
// admit it with low confidence) or 'refuse' (off-topic: exact refusal only).
function check(kind, text) {
  const t = text.trim();
  if (kind === 'refuse') {
    return t === REFUSAL ? [] : ['not the exact refusal sentence'];
  }
  const issues = [];
  if (t === REFUSAL) return ['refused a genuine question'];
  const conf = t.match(/^Confidence:\s*(\d{1,3})%\s*$/m);
  if (!conf) issues.push('no "Confidence: N%" line');
  else if (kind === 'unknown' && Number(conf[1]) >= 40) issues.push(`confidence ${conf[1]}% on an uncovered topic`);
  const followups = t.split('[FOLLOWUPS]')[1];
  if (followups === undefined) issues.push('no [FOLLOWUPS] block');
  else {
    const n = followups.split('\n').filter((l) => l.trim().startsWith('- ')).length;
    if (n !== 3) issues.push(`${n} follow-ups, expected 3`);
  }
  return issues;
}

// --- report ------------------------------------------------------------------
function report({ startedAt, models, questions, results, spent }) {
  const s = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const lines = [
    `# Model eval — ${startedAt}`,
    '',
    `${questions.length} questions × ${models.length} models, via OpenRouter. Total spend: ${usd(spent)}.`,
    'Same system prompt, bio and reminder as production (`lib/prompt.js`); max_tokens ' +
      `${MAX_TOKENS} added as a safety cap. "Visible" = time until the visitor sees the first word.`,
    '',
    '| Model | Checks | Avg visible | Avg total | Avg out tok | Avg reasoning tok | Cost | Upstream |',
    '|---|---|---|---|---|---|---|---|'
  ];
  for (const m of models) {
    const rs = results.filter((r) => r.label === m.label);
    const ok = rs.filter((r) => !r.error && r.issues.length === 0).length;
    const good = rs.filter((r) => !r.error);
    lines.push(
      `| ${m.label}${m.baseline ? ' (baseline)' : ''} | ${ok}/${rs.length} | ` +
        `${s(avg(good.map((r) => r.firstVisible).filter((x) => x != null)))} | ` +
        `${s(avg(good.map((r) => r.totalMs)))} | ` +
        `${Math.round(avg(good.map((r) => r.usage?.completion_tokens ?? 0)) ?? 0)} | ` +
        `${Math.round(avg(good.map((r) => r.usage?.completion_tokens_details?.reasoning_tokens ?? 0)) ?? 0)} | ` +
        `${usd(rs.reduce((a, r) => a + (r.cost || 0), 0))} | ` +
        `${[...new Set(good.map((r) => r.provider).filter(Boolean))].join(', ') || '—'} |`
    );
  }

  for (const q of questions) {
    lines.push('', '---', '', `## ${q.id}: ${(q.turns || [q.question]).join(' → ')}`, '', `_${q.why}_`);
    for (const m of models) {
      const r = results.find((x) => x.label === m.label && x.qid === q.id);
      if (!r) continue;
      lines.push('', `### ${m.label}`, '');
      if (r.error) {
        lines.push(`**ERROR:** ${r.error}`);
        continue;
      }
      const cached = r.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      lines.push(
        `visible ${s(r.firstVisible)} · total ${s(r.totalMs)} · ${r.usage?.prompt_tokens ?? '?'} in ` +
          `(${cached} cached) · ${r.usage?.completion_tokens ?? '?'} out · ${usd(r.cost)} · ` +
          `finish: ${r.finishReason ?? '?'} · ` +
          (r.issues.length ? `**checks: ${r.issues.join('; ')}**` : 'checks: ok'),
        ''
      );
      for (const [i, prev] of (r.earlier || []).entries()) {
        lines.push(`<details><summary>Turn ${i + 1} answer</summary>`, '', ...prev.trim().split('\n').map((l) => `> ${l}`), '', '</details>', '');
      }
      lines.push(...r.content.trim().split('\n').map((l) => `> ${l}`));
    }
  }
  return lines.join('\n') + '\n';
}

// --- run -----------------------------------------------------------------------
async function run() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set (.env)');

  const docPath = process.env.PRIVATE_DOC_PATH || path.join(ROOT, 'content', 'private-context.md');
  const doc = await fs.readFile(path.resolve(ROOT, docPath), 'utf8');
  const models = JSON.parse(await fs.readFile(opts.models, 'utf8')).map((m) => ({
    ...m,
    label: m.label || m.id.split('/').pop()
  }));
  let questions = JSON.parse(await fs.readFile(opts.questions, 'utf8'));
  if (opts.only) questions = questions.filter((q) => opts.only.split(',').includes(q.id));

  // Validate every id and price the worst case BEFORE spending anything.
  // Tokens are estimated at 3 chars/token (deliberately pessimistic), no cache.
  const catalog = await fetchCatalog();
  const missing = models.filter((m) => !catalog.has(m.id));
  if (missing.length) throw new Error(`Not on OpenRouter: ${missing.map((m) => m.id).join(', ')}`);

  // A multi-turn question (`turns`) is one call per turn, each carrying the
  // model's own previous answers as history — the way the browser sends it.
  const turnsOf = (q) => q.turns || [q.question];
  const estIn = (q) =>
    Math.ceil(JSON.stringify(buildMessages(doc, [{ role: 'user', content: turnsOf(q).join(' ') }])).length / 3);
  const worstCall = (m, q) => {
    const p = catalog.get(m.id).pricing;
    const n = turnsOf(q).length;
    // Turn k also re-sends k-1 earlier answers (each <= MAX_TOKENS).
    return n * estIn(q) * Number(p.prompt) + ((n * (n - 1)) / 2) * MAX_TOKENS * Number(p.prompt) +
      n * MAX_TOKENS * Number(p.completion);
  };

  let worst = 0;
  console.log(`Worst case per model (${questions.length} questions, ~${estIn(questions[0])} input tokens, ${MAX_TOKENS} max out):`);
  for (const m of models) {
    const w = questions.reduce((a, q) => a + worstCall(m, q), 0);
    worst += w;
    const p = catalog.get(m.id).pricing;
    console.log(`  ${m.label.padEnd(32)} in $${perM(p.prompt).toFixed(3)}/M  out $${perM(p.completion).toFixed(3)}/M  worst ${usd(w)}`);
  }
  console.log(`Worst case total: ${usd(worst)} — budget ${usd(BUDGET)}. Typical runs cost a fraction of this.`);
  if (worst > BUDGET) {
    console.log('Worst case exceeds the budget: the run will stop early. Raise --budget or trim models/questions.');
  }
  if (!opts.yes) {
    console.log('\nDry run only. Re-run with --yes to call the models.');
    return;
  }

  const startedAt = new Date().toISOString().slice(0, 16).replace(':', '-');
  const outDir = path.join(__dirname, 'results', startedAt);
  await fs.mkdir(outDir, { recursive: true });

  // Model-major order: consecutive calls to one model share the bio prefix, so
  // calls 2+ show the cached (production-like) cost.
  const results = [];
  let spent = 0;
  for (const m of models) {
    for (const q of questions) {
      const w = worstCall(m, q);
      if (spent + w > BUDGET) {
        console.log(`Budget stop before ${m.label}/${q.id}: spent ${usd(spent)}, next call could cost ${usd(w)}.`);
        break;
      }
      process.stdout.write(`${m.label} / ${q.id} … `);
      const r = { label: m.label, id: m.id, qid: q.id, cost: 0, earlier: [] };
      try {
        // Prefer OpenRouter's billed cost; fall back to catalog prices.
        const p = catalog.get(m.id).pricing;
        const history = [];
        for (const turn of turnsOf(q)) {
          if (history.length) r.earlier.push(r.content);
          history.push({ role: 'user', content: turn });
          Object.assign(r, await callModel(m, buildMessages(doc, history)));
          history.push({ role: 'assistant', content: r.content });
          r.cost +=
            r.usage?.cost ??
            (r.usage?.prompt_tokens ?? 0) * Number(p.prompt) + (r.usage?.completion_tokens ?? 0) * Number(p.completion);
        }
        // Checks, timings and tokens describe the final turn; cost covers all.
        r.issues = check(q.kind, r.content);
        if (r.finishReason === 'length') r.issues.push('hit max_tokens');
        console.log(`${(r.totalMs / 1000).toFixed(1)}s ${usd(r.cost)} ${r.issues.length ? '⚠ ' + r.issues.join('; ') : 'ok'}`);
      } catch (err) {
        r.error = err.message;
        r.cost = 0;
        r.issues = [];
        console.log(`ERROR ${err.message}`);
      }
      spent += r.cost;
      results.push(r);
    }
  }

  await fs.writeFile(path.join(outDir, 'results.json'), JSON.stringify({ startedAt, models, questions, results, spent }, null, 2));
  await fs.writeFile(path.join(outDir, 'report.md'), report({ startedAt, models, questions, results, spent }));
  console.log(`\nSpent ${usd(spent)}. Report: ${path.relative(ROOT, path.join(outDir, 'report.md'))}`);
}

(positionals[0] === 'candidates' ? candidates() : run()).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
