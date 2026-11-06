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

/** Lowercase (so not a name), at least 5 letters, not everyday vocabulary. */
export function isHardWord(t) {
  return /^[a-z]{5,}$/.test(t) && !common.has(t);
}

const cache = new Map();
/** Short dictionary definition for a word (tries simple base forms), or null. */
export async function define(word) {
  if (cache.has(word)) return cache.get(word);
  const forms = [word, word.replace(/ies$/, 'y'), word.replace(/(ed|es|s|ly|ing)$/, ''), word.replace(/(ed|ing)$/, 'e'), word.replace(/ness$/, '')];
  let def = null;
  for (const w of [...new Set(forms)].filter((x) => x.length > 3)) {
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
      if (!r.ok) continue;
      const j = await r.json();
      const d = j?.[0]?.meanings?.[0]?.definitions?.[0]?.definition;
      if (d) { def = d.replace(/\.$/, ''); break; }
    } catch {}
  }
  if (def && def.length > 140) def = def.slice(0, 132).replace(/\s+\S*$/, '') + '…';
  cache.set(word, def);
  return def;
}
