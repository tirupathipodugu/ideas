// Turn Tesseract's word list into readable text, then pick the sentences that carry the page.
// Used by Skim mode: extractive word-frequency scoring, instant on the phone with no model download.

const STOP = new Set(`a about above after again against all am an and any are aren't as at be because been before being below
between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from
further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i
i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or
other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's
the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under
until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's
whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also may might will
shall must just like one two get got make made many much every said says use used using new well even way within without upon`.split(/\s+/));

/**
 * Build text + per-word char ranges from Tesseract lines.
 * Returns { text, words: [{start, end, bbox, line}] }. Low-confidence junk is dropped and a
 * hyphen at a line end is joined ("impor-\ntant" -> "important").
 */
export function buildText(lines) {
  let text = '';
  const words = [];
  lines.forEach((ln, li) => {
    const ws = (ln.words || []).filter((w) => w.confidence >= 45 && /[\p{L}\p{N}]/u.test(w.text));
    if (!ws.length) return;
    // Running heads, section titles in capitals and page numbers aren't part of the reading.
    const letters = ws.map((w) => w.text).join('').replace(/[^\p{L}]/gu, '');
    if (!letters || (letters.length >= 3 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.8)) return;
    if (text && !/[\s]$/.test(text)) text += ' ';
    ws.forEach((w, wi) => {
      const lastInLine = wi === ws.length - 1;
      let t = w.text.replace(/[|_~]+/g, '');
      const joinNext = lastInLine && /\p{L}-$/u.test(t) && li < lines.length - 1;
      if (joinNext) t = t.slice(0, -1);
      const start = text.length;
      text += t;
      words.push({ start, end: text.length, bbox: w.bbox, line: li });
      if (!joinNext) text += ' ';
    });
    // A short line with no closing punctuation is a heading ("Chapter 1"): end it so it doesn't
    // glue onto the first sentence of the page.
    if (ws.length <= 3 && !/[.!?:;,"'”’)-]\s*$/.test(text)) text = text.replace(/\s*$/, '. ');
  });
  return { text: text.replace(/\s+$/, ''), words };
}

/** Sentence ranges over text. Falls back to line-ish chunks for lists/notices without full stops. */
function splitSentences(text) {
  const out = [];
  const re = /[^.!?]+(?:[.!?]+["'”’)]*|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    if (!raw.trim()) { if (re.lastIndex >= text.length) break; continue; }
    const lead = raw.length - raw.trimStart().length;
    out.push({ start: m.index + lead, end: m.index + raw.trimEnd().length });
    if (re.lastIndex >= text.length) break;
  }
  // Merge fragments created by abbreviations ("e.g.", "Dr.", "3.5") into the previous sentence.
  const merged = [];
  const ABBR = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|Mt|vs|etc|e\.g|i\.e|No|Vol|Ch|Fig)\.["'”’)]*$/;
  for (const s of out) {
    const body = text.slice(s.start, s.end);
    const prev = merged[merged.length - 1];
    const prevBody = prev ? text.slice(prev.start, prev.end) : '';
    if (prev && ABBR.test(prevBody)) prev.end = s.end;                  // "Mr." + "Bennet said…"
    else if (ABBR.test(body) && body.split(/\s+/).length < 3) merged.push({ ...s }); // "Mrs." opens a sentence
    else if (prev && (body.split(/\s+/).length < 3 || /^[a-z0-9]/.test(body))) prev.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

const tokens = (s) => (s.toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) || []).map((t) => t.replace(/['’]s$/, ''));

/**
 * Summarise. Returns { points: [string], picks: [{start,end}], terms: [string], sentences }.
 */
export function summarize(text) {
  const sents = splitSentences(text).filter((s) => tokens(text.slice(s.start, s.end)).length >= 4);
  if (!sents.length) return { points: [], picks: [], terms: [], sentences: 0 };

  const freq = new Map();
  const doc = sents.map((s) => tokens(text.slice(s.start, s.end)));
  doc.flat().forEach((t) => { if (t.length > 2 && !STOP.has(t)) freq.set(t, (freq.get(t) || 0) + 1); });
  const max = Math.max(1, ...freq.values());

  const scored = sents.map((s, i) => {
    const toks = doc[i];
    const content = toks.filter((t) => freq.has(t));
    let score = content.reduce((a, t) => a + freq.get(t) / max, 0) / Math.pow(Math.max(toks.length, 6), 0.55);
    if (i === 0 && /^[a-z]/.test(text.slice(s.start, s.end))) score *= 0.35; // tail of a sentence from the previous page
    else if (i === 0) score *= 1.35;       // openings usually state the point
    else if (i === 1) score *= 1.1;
    if (toks.length > 45) score *= 0.7;    // run-ons are often OCR merges
    if (/\d/.test(text.slice(s.start, s.end))) score *= 1.1; // numbers, dates, amounts matter
    return { ...s, i, score };
  });

  const n = sents.length;
  const k = n <= 2 ? n : Math.min(4, Math.max(2, Math.round(n * 0.25)));
  const picks = [...scored].sort((a, b) => b.score - a.score).slice(0, k).sort((a, b) => a.i - b.i);

  const points = picks.map((p) => {
    let s = text.slice(p.start, p.end).replace(/\s+/g, ' ').trim();
    if (s.length > 230) s = s.slice(0, 220).replace(/\s+\S*$/, '') + '…';
    return s.charAt(0).toUpperCase() + s.slice(1);
  });

  const terms = [...freq.entries()]
    .filter(([t, c]) => c >= 2 && t.length > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t);

  return { points, picks, terms, sentences: n };
}
