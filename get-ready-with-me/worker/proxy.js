// Get Ready With Me: optional Cloudflare Worker. The app works without it (samples, pasted links, dropped photos);
// deploying it turns on live in-app Amazon search and lets the page read a pasted product page.
//
// Two jobs, same Worker:
//   ?q=<words>&store=<tld>   search an Amazon store and return product images as JSON (for the Search box)
//   ?url=<amazon url>        fetch one Amazon page or photo and stream it back (for pasted links / CORS reads)
//
// It only ever touches Amazon store pages and Amazon/Google image hosts, one request at a time, never crawls,
// and caches nothing. No API keys. Each person who clones the repo deploys their own free Worker.
//
// Deploy:  cd worker && npx wrangler deploy
//   then set ALLOWED_ORIGIN (wrangler.toml or the dashboard) to your site origin, e.g. https://you.github.io
//   and put the Worker's URL in config.js as  workerUrl: 'https://grwm-proxy.<account>.workers.dev'
//
// Honest note: Amazon actively blocks automated requests from datacentre IPs, so search can intermittently come
// back empty or blocked. The app always falls back to pasting a link or dropping a photo, which never depends on this.

const TLDS = ['in', 'com', 'co.uk', 'ae', 'sa', 'de', 'fr', 'it', 'es', 'nl', 'ca', 'com.au', 'sg', 'co.jp'];
const STORE = /^(www\.)?amazon\.(in|com|co\.uk|ae|sa|de|fr|it|es|nl|ca|com\.au|sg|co\.jp)$/;
const SHORT = /^(amzn\.(to|in|eu|asia)|a\.co)$/;
const IMAGES = /^(m\.media-amazon\.com|images-[a-z]{2}\.ssl-images-amazon\.com|encrypted-tbn\d\.gstatic\.com)$/;

// A realistic browser fingerprint cuts down (does not remove) Amazon's bot blocking.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Chromium";v="130", "Not?A_Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Upgrade-Insecure-Requests': '1',
};

// Amazon's soft-block on datacentre IPs is partly fingerprint-correlated, so rotate the UA across retries.
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];
const headersWithUA = (ua) => ({ ...BROWSER_HEADERS, 'User-Agent': ua });

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'x-final-url', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } });
    if (request.method !== 'GET') return new Response('GET only', { status: 405, headers: cors });

    const url = new URL(request.url);
    const params = url.searchParams;
    if (params.get('q') != null) return search(params, cors);
    if (params.get('analyze') != null) return analyze(params, cors, env);
    if (params.get('url') != null) return proxy(params, cors);
    // Bare URL / unknown: a friendly health message instead of "Missing ?url=".
    return new Response(JSON.stringify({
      ok: true,
      service: 'grwm-proxy',
      usage: {
        search: '?q=<words>&store=<tld>',
        analyze: '?analyze=<image url>',
        proxy: '?url=<amazon page or image url>',
      },
    }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};

// ---- analyze: ask Claude where the product is, what it is, and whether the background is clean ----
// Needs the secret ANTHROPIC_API_KEY (wrangler secret put ANTHROPIC_API_KEY, or .dev.vars locally).
// Without the key it returns { skip: true } so the app quietly falls back to its own cut-out.
const CATEGORIES = ['sunglasses', 'glasses', 'cap', 'hat', 'earrings', 'watch', 'bracelet', 'clothing', 'other', 'none'];
const ANALYZE_PROMPT =
  'This is an online shopping product photo. Respond with ONLY a JSON object and no other text:\n' +
  '{"type": one of ' + CATEGORIES.map((c) => `"${c}"`).join(', ') + ',\n' +
  ' "box": {"x":0-1,"y":0-1,"w":0-1,"h":0-1} as fractions of the image, a tight rectangle around the single main ' +
  'wearable product only (if a person is wearing it, box just the product, not the person),\n' +
  ' "clean_bg": true if the background is plain/solid/white, false if it is a busy or real-world scene}.';

async function analyze(params, cors, env) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  const key = env && env.ANTHROPIC_API_KEY;
  if (!key) return json({ skip: true, reason: 'no key' });

  let target;
  try { target = new URL(params.get('analyze')); } catch { return json({ error: 'bad image url' }, 400); }
  if (target.protocol !== 'https:' || !IMAGES.test(target.hostname.toLowerCase())) return json({ error: 'host not allowed' }, 403);

  let mediaType = 'image/jpeg', b64;
  try {
    const r = await fetch(target.href, { headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] } });
    mediaType = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\//.test(mediaType)) return json({ skip: true, reason: 'not an image' });
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    b64 = btoa(s);
  } catch { return json({ skip: true, reason: 'image fetch failed' }); }

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-5-5',
        max_tokens: 250,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: ANALYZE_PROMPT },
        ] }],
      }),
    });
  } catch { return json({ skip: true, reason: 'claude unreachable' }); }

  if (!res.ok) return json({ skip: true, reason: 'claude ' + res.status });
  let out;
  try {
    const data = await res.json();
    const text = (data.content || []).map((p) => p.text || '').join('').trim();
    out = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
  } catch { return json({ skip: true, reason: 'parse failed' }); }

  const b = out.box || {};
  const num = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
  const box = { x: num(b.x, 0), y: num(b.y, 0), w: num(b.w, 1), h: num(b.h, 1) };
  const type = CATEGORIES.includes(out.type) ? out.type : null;
  return json({ type, box, clean_bg: out.clean_bg !== false });
}

// ---- search: return product images for a query as JSON ----
async function search(params, cors) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  const q = (params.get('q') || '').trim().slice(0, 120);
  const store = params.get('store') || 'in';
  if (!q) return json({ items: [], blocked: false });
  if (!TLDS.includes(store)) return json({ error: 'bad store' }, 400);

  const url = `https://www.amazon.${store}/s?k=${encodeURIComponent(q)}`;

  // Amazon intermittently serves an empty "app shell" to datacentre IPs, so retry several times (rotating the
  // browser fingerprint each attempt) until we get a real results page.
  const ATTEMPTS = 6;
  let lastBlocked = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let res;
    const ua = UA_POOL[attempt % UA_POOL.length];
    try { res = await fetch(url, { headers: headersWithUA(ua), redirect: 'follow', cf: { cacheTtl: 0 } }); }
    catch { lastBlocked = true; continue; }

    const items = [];
    const seen = new Set();
    let blocked = false;

    const rewriter = new HTMLRewriter()
      .on('img.s-image', {
        element(el) {
          const src = el.getAttribute('src') || '';
          if (!/media-amazon\.com|ssl-images-amazon\.com/.test(src) || seen.has(src)) return;
          seen.add(src);
          if (items.length < 36) items.push({ img: src, title: (el.getAttribute('alt') || '').trim() });
        },
      })
      // Amazon's "are you a robot" page posts to /errors/validateCaptcha.
      .on('form[action*="validateCaptcha"]', { element() { blocked = true; } });

    try { await rewriter.transform(res).arrayBuffer(); }
    catch { lastBlocked = true; continue; }

    if (items.length) return json({ items, blocked: false });
    lastBlocked = blocked || !res.ok;
    // empty page (no products, no captcha): wait a jittered moment and try again with a fresh fingerprint
    if (attempt < ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
  }

  // All attempts empty: either a genuine no-match or Amazon kept stonewalling the server this moment.
  return json({ items: [], blocked: lastBlocked });
}

// ---- proxy: stream back one allowed Amazon page or photo ----
async function proxy(params, cors) {
  let target;
  try { target = new URL(params.get('url')); } catch { return new Response('Missing ?url=', { status: 400, headers: cors }); }
  const host = target.hostname.toLowerCase();
  if (target.protocol !== 'https:' || !(STORE.test(host) || SHORT.test(host) || IMAGES.test(host))) {
    return new Response('Host not allowed', { status: 403, headers: cors });
  }

  const upstream = await fetch(target.href, { redirect: 'follow', headers: BROWSER_HEADERS });
  const final = new URL(upstream.url);
  if (!(STORE.test(final.hostname) || IMAGES.test(final.hostname))) return new Response('Redirect not allowed', { status: 403, headers: cors });

  const type = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!/^(text\/html|image\/)/.test(type)) return new Response('Type not allowed', { status: 415, headers: cors });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'no-store', 'x-final-url': final.href },
  });
}
