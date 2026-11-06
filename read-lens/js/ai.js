// Live mode brain: send the few lines being read (plus the page for context) to Claude and get back
// one short note to float over the book. Static site, no build step and no server, so this calls
// the Messages API over plain fetch with the reader's own key (stored only on their device).

const KEY_STORE = 'rl.claudeKey';
const MODEL = 'claude-opus-5-5';

export const keyStore = {
  get() { try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; } },
  set(k) { try { localStorage.setItem(KEY_STORE, k.trim()); } catch {} },
  clear() { try { localStorage.removeItem(KEY_STORE); } catch {} },
};

const SYSTEM = `You are a reading companion. The reader is reading a printed book page right now; your note floats over the paper next to the lines they are on, so it must be glanceable in two seconds.
Given the lines being read (and the full page for context), write ONE note that makes those lines easier or richer to read. Pick whichever kind fits best:
- meaning: what a tricky phrase, old-fashioned wording or dense sentence actually says, in plain words
- context: a fact about the period, place, person or idea that makes the lines click
- insight: the point the author is making or why this moment matters
- predict: a light hint of what to watch for next (never spoil beyond the page)
- question: a short thought question to read on with
- fun: a surprising related fact
Rules: at most 22 words, plain casual English, no quotes of the passage, no "this passage" or "the author" openers, never repeat an earlier note. If a word on these lines is hard, put it in word/meaning (meaning at most 8 words); otherwise leave both empty.`;

const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['meaning', 'context', 'insight', 'predict', 'question', 'fun'] },
    note: { type: 'string' },
    word: { type: 'string' },
    meaning: { type: 'string' },
  },
  required: ['kind', 'note', 'word', 'meaning'],
  additionalProperties: false,
};

export class AIError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

let useFallbacks = true; // dropped automatically if the API rejects it

/** Ask Claude about `lines` (string) given `page` (string) and recent notes. Returns {kind, note, word, meaning}. */
export async function insightFor({ lines, page, recent, signal }) {
  if (new URLSearchParams(location.search).has('mockai')) return mock(lines, signal);
  const key = keyStore.get();
  // No key needed: without one, use the browser's own on-device AI if it has it, else free word help.
  if (!key) return (await onDeviceNote(lines, page, recent)) || freeNote(lines, recent);

  const user = `PAGE (for context, OCR so expect small typos):\n${page.slice(0, 4000)}\n\n` +
    (recent.length ? `NOTES ALREADY SHOWN (don't repeat):\n- ${recent.join('\n- ')}\n\n` : '') +
    `LINES BEING READ NOW:\n${lines}`;

  const send = async (withFallbacks) => {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: user }],
    };
    if (withFallbacks) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
    return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
  };

  let res = await send(useFallbacks);
  if (res.status === 400 && useFallbacks) {
    // Some setups reject the fallback option; one retry without it, and remember.
    const txt = await res.clone().text();
    if (/fallback|beta/i.test(txt)) { useFallbacks = false; res = await send(false); }
  }
  if (res.status === 401 || res.status === 403) throw new AIError('Key rejected', 'badkey');
  if (res.status === 429) throw new AIError('Rate limited', 'rate');
  if (res.status === 529 || res.status >= 500) throw new AIError('Claude is busy', 'busy');
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.error?.message || msg; } catch {}
    throw new AIError(msg, 'http');
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new AIError('Declined', 'refusal');
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new AIError('Bad reply', 'parse'); }
  if (!out?.note) throw new AIError('Empty reply', 'parse');
  return out;
}

// Offline stand-in for testing the live flow without a key: ?mockai
const MOCK = [
  { kind: 'meaning', note: 'Everyone assumes a rich single man must be hunting for a wife, and neighbours act like he already belongs to them.', word: 'universally', meaning: 'by everyone, everywhere' },
  { kind: 'context', note: 'In Regency England, marrying well was often a family’s only route to money and security for daughters.', word: '', meaning: '' },
  { kind: 'insight', note: 'Mrs. Bennet is all excitement, Mr. Bennet all silence. Their mismatch is the joke running through the book.', word: '', meaning: '' },
  { kind: 'fun', note: 'A "chaise and four" is a light carriage pulled by four horses, the flashy sports car of 1810.', word: 'chaise', meaning: 'light horse-drawn carriage' },
  { kind: 'question', note: 'Why does Mr. Bennet pretend not to care? Watch how he teases her.', word: '', meaning: '' },
  { kind: 'predict', note: 'Keep an eye on Bingley. One new neighbour is about to set the whole family in motion.', word: '', meaning: '' },
];
let mockIx = 0;
function mock(lines, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(MOCK[mockIx++ % MOCK.length]), 1200 + Math.random() * 900);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
  });
}

// ---------- free, no-key notes ----------

// Chrome's built-in on-device model (Prompt API), only when it's already on the device.
let lmSession = null, lmChecked = false;
async function onDeviceNote(lines, page, recent) {
  try {
    if (!lmChecked) {
      lmChecked = true;
      if (!('LanguageModel' in self) || (await self.LanguageModel.availability()) !== 'available') return null;
      lmSession = await self.LanguageModel.create({ initialPrompts: [{ role: 'system', content: SYSTEM }] });
    }
    if (!lmSession) return null;
    const s = await lmSession.clone();
    const out = await s.prompt(
      (recent.length ? `Notes already shown (don't repeat): ${recent.slice(-3).join(' | ')}\n\n` : '') +
      `Page context: ${page.slice(0, 1500)}\n\nLines being read now:\n${lines}`,
      { responseConstraint: SCHEMA },
    );
    s.destroy?.();
    const d = JSON.parse(out);
    return d?.note ? d : null;
  } catch { return null; }
}

// Everywhere else: explain the hardest word on these lines with a free dictionary (no key, no account).
const COMMON = new Set(`because between through however although something anything everything nothing
without whatever whenever together yourself himself herself themselves important different another
probably actually anyone someone everyone already business possible interest children thousand
continued answered returned replied delighted immediately impatiently invitation objection
possession neighbourhood neighborhood daughters servants`.split(/\s+/));
const dictCache = new Map();
async function define(word) {
  if (dictCache.has(word)) return dictCache.get(word);
  const tries = [word, word.replace(/ies$/, 'y'), word.replace(/(ed|es|s|ly|ing)$/, ''), word.replace(/(ed|ing)$/, 'e')];
  let def = null;
  for (const w of [...new Set(tries)].filter((x) => x.length > 3)) {
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
      if (!r.ok) continue;
      const j = await r.json();
      const d = j?.[0]?.meanings?.[0]?.definitions?.[0]?.definition;
      if (d) { def = d.replace(/\.$/, ''); break; }
    } catch {}
  }
  dictCache.set(word, def);
  return def;
}
const shown = new Set();
async function freeNote(lines, recent) {
  // Hard-word guess: long, lowercase (not a name), not common, not explained already.
  const words = [...new Set((lines.match(/\b[a-z][a-z'-]{6,}\b/g) || []).map((w) => w.replace(/['-]+$/, '')))]
    .filter((w) => !COMMON.has(w) && !shown.has(w))
    .sort((a, b) => b.length - a.length);
  for (const w of words.slice(0, 3)) {
    const def = await define(w);
    if (def) {
      shown.add(w);
      const short = def.length > 110 ? def.slice(0, 105).replace(/\s+\S*$/, '') + '…' : def;
      return { kind: 'meaning', note: short.charAt(0).toUpperCase() + short.slice(1) + '.', word: w, meaning: '', free: true };
    }
  }
  return { kind: 'none', note: '', word: '', meaning: '', free: true };
}
