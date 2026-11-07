// Word meanings for Snap: pick the words worth explaining (rarer than everyday English) and look
// them up in a free dictionary (dictionaryapi.dev: no key, no account).

// Everyday words (the ~9,500 most common English words) are never explained; anything rarer is.
let common = new Set();
let loading = null;
export function loadCommon() {
  if (!loading) {
    loading = fetch(new URL('../vendor/common-words.txt', import.meta.url))
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => { common = new Set(t.split(/\r?\n/)); })
      .catch(() => {});
  }
  return loading;
}

// Simple base forms, so "dislikes", "determined" or "comparisons" count as the everyday word they are.
const bases = (t) => [t, t.replace(/ies$/, 'y'), t.replace(/s$/, ''), t.replace(/es$/, ''), t.replace(/(ed|ing)$/, ''), t.replace(/(ed|ing)$/, 'e'),
  t.replace(/([^aeiou])\1(ed|ing)$/, '$1'), t.replace(/ly$/, ''), t.replace(/ily$/, 'y'), t.replace(/(able|ness|ment)$/, ''),
  t.replace(/able$/, 'e'), t.replace(/ations?$/, 'e'), t.replace(/(er|ers)$/, ''), t.replace(/(er|ers)$/, 'e')];

/** Lowercase (so not a name), at least 5 letters, not everyday vocabulary in any simple form. */
export function isHardWord(t) {
  return /^[a-z]{5,}$/.test(t) && !bases(t).some((b) => b.length >= 3 && common.has(b));
}

const cache = new Map();
/** Short dictionary definition for a word (tries simple base forms), or null. */
export async function define(word) {
  if (cache.has(word)) return cache.get(word);
  const forms = [word, word.replace(/ies$/, 'y'), word.replace(/(ed|es|s|ly|ing)$/, ''), word.replace(/(ed|ing)$/, 'e'), word.replace(/ness$/, '')];
  let def = null;
  for (const w of [...new Set(forms)].filter((x) => x.length > 3)) {
    // The free service sometimes answers 5xx/429 or drops the connection: retry those, not a 404.
    for (let attempt = 0; attempt < 3 && !def; attempt++) {
      try {
        const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
        if (r.status === 404) break;
        if (!r.ok) { await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1))); continue; }
        const j = await r.json();
        // First definition that explains the word instead of repeating it ("A heuristic method").
        const all = (j?.[0]?.meanings || []).flatMap((m) => (m.definitions || []).map((x) => x.definition)).filter(Boolean);
        const stem = word.slice(0, Math.max(4, word.length - 3));
        const d = all.find((x) => !x.toLowerCase().includes(stem)) || all[0];
        if (d) def = d.replace(/\.$/, '');
        break;
      } catch { await new Promise((ok) => setTimeout(ok, 600 * (attempt + 1))); }
    }
    if (def) break;
  }
  if (def && def.length > 140) def = def.slice(0, 132).replace(/\s+\S*$/, '') + '…';
  cache.set(word, def);
  return def;
}
