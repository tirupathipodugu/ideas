// Read Lens: wait for a steady, sharp camera frame, read it with on-device OCR (Tesseract), keep the
// printed lines locked to the paper with a two-level image tracker, and draw reading guides over the
// live feed: Live (Claude notes on the lines you're on), Pacer, Focus and Skim.
import { buildText, summarize } from './summarize.js';
import { Sound } from './sound.js';
import { startDemo, startPhoto } from './sources.js';
import { insightFor, keyStore } from './ai.js';

const $ = (id) => document.getElementById(id);
const video = $('cam');
const marks = $('marks');
const g = marks.getContext('2d');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const CHUNK = 3; // lines per Live note
const S = {
  mode: store.get('rl.mode', 'live'),
  wpm: store.get('rl.wpm', 250),
  push: store.get('rl.push', true),
  playing: false,
  page: null,          // { lines, text, skim, ref, nWords, picks }
  cur: 0, lineT: 0,
  pageNo: 0, pageActive: 0, pageWords: 0, pageDone: false, resumeOnNewPage: false,
  off: { x: 0, y: 0 }, last: { dx: 0, dy: 0 }, cost: 0, lostFor: 0, tracked: false, bigMove: false, base: 0, baseN: 0,
  busy: false, steadyFor: 0, cooldown: 0, prevSmall: null, motion: 1, lastScanAt: 0,
  cand: null,          // sharpest frame seen while holding steady: { canvas, ref, sharp, n }
  facing: 'environment', stream: null, stopSource: null, demoTurn: null,
  notes: new Map(),    // chunk text -> { state: 'loading'|'ready'|'error', data, err }
  recent: [],          // last notes shown, so Claude doesn't repeat itself
  aiBackoffUntil: 0,
};
const sound = new Sound();
window.__readLens = S; // handy for debugging from the console

// ---------- OCR worker ----------
let workerP = null;
function ocrWorker() {
  if (!workerP) {
    const abs = (p) => new URL(p, location.href).href;
    workerP = Tesseract.createWorker('eng', 1, {
      workerPath: abs('vendor/worker.min.js'),
      corePath: abs('vendor/'),
      langPath: abs('vendor/'),
      workerBlobURL: false,
      logger: (m) => {
        if (m.status === 'recognizing text' && S.busy && !S.page) setState(`Reading the page… ${Math.round(m.progress * 100)}%`);
      },
    });
  }
  return workerP;
}

// ---------- camera ----------
async function startCamera() {
  stopSource();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: S.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  S.stream = stream;
  // Ask for continuous autofocus where the camera supports it (sharper text for OCR).
  try {
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch {}
  video.srcObject = stream;
  video.classList.toggle('mirror', S.facing === 'user');
  await video.play().catch(() => {});
  resetPage();
}
function stopSource() {
  S.stopSource?.(); S.stopSource = null; S.demoTurn = null;
  S.stream?.getTracks().forEach((t) => t.stop()); S.stream = null;
}
async function useCanvasSource(start) {
  stopSource();
  const { stream, stop, turn } = start();
  S.stopSource = stop;
  S.demoTurn = turn || null;
  video.srcObject = stream;
  video.classList.remove('mirror');
  await video.play().catch(() => {});
  resetPage();
}

// ---------- geometry: video pixels -> screen ----------
// Measured from the video element itself, not the window: on phones the address bar changes
// innerHeight while the fixed video keeps its own size, which shifted every highlight down.
function view() {
  const r = video.getBoundingClientRect();
  const W = r.width || 1, H = r.height || 1, vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const s = Math.max(W / vw, H / vh);
  return { s, ox: r.left + (W - vw * s) / 2, oy: r.top + (H - vh * s) / 2, left: r.left, W, mirror: video.classList.contains('mirror') };
}
function rectToScreen(v, r) {
  let x0 = (r.x0 + S.off.x) * v.s + v.ox, x1 = (r.x1 + S.off.x) * v.s + v.ox;
  const y0 = (r.y0 + S.off.y) * v.s + v.oy, y1 = (r.y1 + S.off.y) * v.s + v.oy;
  if (v.mirror) [x0, x1] = [2 * v.left + v.W - x1, 2 * v.left + v.W - x0];
  return { x0, y0, x1, y1 };
}

// ---------- small gray frames for tracking ----------
const SMALL_W = 160, COARSE = 5;
const small = document.createElement('canvas');
const sg = small.getContext('2d', { willReadFrequently: true });
function grabSmall(src = video) {
  const vw = src.videoWidth || src.width, vh = src.videoHeight || src.height;
  if (!vw) return null;
  const h = Math.round(SMALL_W * vh / vw);
  if (small.width !== SMALL_W || small.height !== h) { small.width = SMALL_W; small.height = h; }
  sg.filter = 'blur(0.8px)'; // soften text so sub-pixel drift is not mistaken for motion
  sg.drawImage(src, 0, 0, SMALL_W, h);
  const d = sg.getImageData(0, 0, SMALL_W, h).data;
  const px = new Float32Array(SMALL_W * h);
  let sum = 0;
  for (let i = 0, j = 0; j < px.length; i += 4, j++) { const y = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; px[j] = y; sum += y; }
  const mean = sum / px.length;
  for (let j = 0; j < px.length; j++) px[j] -= mean; // ignore overall brightness shifts
  // Coarse level: 5x5 block averages. Individual lines blur away, paragraphs and margins remain,
  // so this level can't confuse one line of text for the next.
  const cw = Math.floor(SMALL_W / COARSE), ch = Math.floor(h / COARSE);
  const cpx = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    let s = 0;
    for (let yy = 0; yy < COARSE; yy++) for (let xx = 0; xx < COARSE; xx++) s += px[(y * COARSE + yy) * SMALL_W + x * COARSE + xx];
    cpx[y * cw + x] = s / (COARSE * COARSE);
  }
  return { px, w: SMALL_W, h, coarse: { px: cpx, w: cw, h: ch } };
}
const MARGIN = 26;
function sad(ref, cur, dx, dy, m, stepPx) {
  let s = 0, n = 0;
  const { w, h } = ref;
  for (let y = m; y < h - m; y += stepPx) {
    const ry = y * w, cy = (y + dy) * w;
    for (let x = m; x < w - m; x += stepPx) { s += Math.abs(ref.px[ry + x] - cur.px[cy + x + dx]); n++; }
  }
  return s / Math.max(1, n);
}
function searchAround(ref, cur, cx, cy, r, lim, m, stepPx, pen) {
  let best = { dx: cx, dy: cy, c: Infinity }, bestPen = Infinity;
  for (let dy = cy - r; dy <= cy + r; dy++) {
    for (let dx = cx - r; dx <= cx + r; dx++) {
      if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;
      const raw = sad(ref, cur, dx, dy, m, stepPx);
      const p = raw + pen * (Math.abs(dx - cx) + Math.abs(dy - cy));
      if (p < bestPen) { bestPen = p; best = { dx, dy, c: raw }; }
    }
  }
  return best;
}
// Where did the page move to since we read it? Coarse level first (big moves, unambiguous), then a
// small fine search around it, charging a little per pixel so the nearest good match wins.
function trackOffset(ref, cur, last) {
  const cm = Math.ceil(MARGIN / COARSE), clim = cm - 1;
  const c = searchAround(ref.coarse, cur.coarse, Math.round(last.dx / COARSE), Math.round(last.dy / COARSE), 3, clim, cm, 1, 0.004);
  // If the coarse answer agrees with where we were, trust the fine level around the old spot.
  const near = Math.abs(c.dx * COARSE - last.dx) <= COARSE && Math.abs(c.dy * COARSE - last.dy) <= COARSE;
  const sx = near ? last.dx : c.dx * COARSE, sy = near ? last.dy : c.dy * COARSE;
  return searchAround(ref, cur, sx, sy, 3, MARGIN - 1, MARGIN, 2, 0.0015);
}
function motionBetween(a, b) {
  // Residual after the best small shift: a slowly drifting hand still counts as "steady",
  // a page being turned or the phone swinging does not.
  if (!a || !b || a.px.length !== b.px.length) return 1;
  return searchAround(a, b, 0, 0, 3, MARGIN - 1, MARGIN, 2, 0.0015).c;
}

// ---------- taking the picture: keep the sharpest frame while the reader holds steady ----------
const probe = document.createElement('canvas');
const pg = probe.getContext('2d', { willReadFrequently: true });
function sharpness() {
  // Variance of a Laplacian over a centre crop: blurry (moving / unfocused) frames score low.
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = 320, ch = Math.round(320 * 0.6);
  probe.width = cw; probe.height = ch;
  const sw = vw * 0.6, sh = sw * 0.6;
  pg.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cw, ch);
  const d = pg.getImageData(0, 0, cw, ch).data;
  const gy = (x, y) => { const i = (y * cw + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < ch - 1; y += 2) for (let x = 1; x < cw - 1; x += 2) {
    const l = 4 * gy(x, y) - gy(x - 1, y) - gy(x + 1, y) - gy(x, y - 1) - gy(x, y + 1);
    s += l; s2 += l * l; n++;
  }
  const m = s / n;
  return s2 / n - m * m;
}
function offerFrame() {
  const sh = sharpness();
  if (!S.cand) S.cand = { canvas: document.createElement('canvas'), ref: null, sharp: -1, n: 0 };
  const c = S.cand;
  c.n++;
  if (sh > c.sharp) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.min(1, 2000 / Math.max(vw, vh));
    c.canvas.width = Math.round(vw * k); c.canvas.height = Math.round(vh * k);
    c.canvas.getContext('2d').drawImage(video, 0, 0, c.canvas.width, c.canvas.height);
    c.ref = grabSmall(c.canvas); // tracking reference from the very same frame
    c.k = k;
    c.sharp = sh;
  }
}

// ---------- reading the page ----------
async function scanPage(silent = false) {
  const c = S.cand;
  if (S.busy || !c?.ref) return;
  S.cand = null;
  S.busy = true;
  S.lastScanAt = performance.now();
  const offAtShot = { ...S.off };
  if (!silent) { setState('Got it. Reading the page…'); sound.shutter(); flash(); }
  try {
    const shot = document.createElement('canvas');
    shot.width = c.canvas.width; shot.height = c.canvas.height;
    const sctx = shot.getContext('2d', { willReadFrequently: true });
    sctx.filter = 'grayscale(1) contrast(1.25)';
    sctx.drawImage(c.canvas, 0, 0);
    const worker = await ocrWorker();
    const { data } = await worker.recognize(shot);
    const page = buildPage(data.lines || [], 1 / c.k);
    if (!page || page.lines.length < 2) {
      if (!silent) setState('No lines found. Move closer and hold steady.');
      S.cooldown = 1.5;
      return;
    }
    page.ref = c.ref;
    adoptPage(page, offAtShot);
  } catch (e) {
    console.error(e);
    if (!silent) setState('Could not read the page. Try again.');
    S.cooldown = 2;
  } finally {
    S.busy = false;
    idleState();
  }
}

function flash() {
  const f = $('flash');
  f.hidden = false;
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  setTimeout(() => { f.hidden = true; }, 450);
}

function buildPage(tLines, inv) {
  const { text, words } = buildText(tLines);
  if (text.length < 40) return null;
  const scale = (b) => ({ x0: b.x0 * inv, y0: b.y0 * inv, x1: b.x1 * inv, y1: b.y1 * inv });
  const byLine = new Map();
  words.forEach((w) => {
    const r = { ...scale(w.bbox), start: w.start, end: w.end };
    if (!byLine.has(w.line)) byLine.set(w.line, []);
    byLine.get(w.line).push(r);
  });
  const lines = [...byLine.values()]
    .filter((ws) => ws.length >= 2 || ws[0].end - ws[0].start >= 4)
    .map((ws) => ({
      words: ws,
      n: ws.length,
      start: ws[0].start, end: ws[ws.length - 1].end,
      x0: Math.min(...ws.map((w) => w.x0)), x1: Math.max(...ws.map((w) => w.x1)),
      y0: Math.min(...ws.map((w) => w.y0)), y1: Math.max(...ws.map((w) => w.y1)),
    }));
  // Skim: highlight the chosen sentences, one rectangle per printed line they cross.
  const { picks } = summarize(text);
  const skim = [];
  picks.forEach((p) => lines.forEach((ln) => {
    const ws = ln.words.filter((w) => w.start >= p.start && w.end <= p.end + 1);
    if (ws.length) skim.push({ x0: Math.min(...ws.map((w) => w.x0)), x1: Math.max(...ws.map((w) => w.x1)), y0: ln.y0, y1: ln.y1 });
  }));
  return { lines, text, skim, nWords: lines.reduce((a, l) => a + l.n, 0), picks: picks.length };
}

const tokenSet = (t) => new Set(t.toLowerCase().match(/[a-z]{3,}/g) || []);
function similarity(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  let inter = 0; A.forEach((x) => { if (B.has(x)) inter++; });
  return inter / Math.max(1, Math.min(A.size, B.size));
}

function adoptPage(page, offAtShot) {
  const prev = S.page;
  const same = prev && similarity(prev.text, page.text) > 0.6;
  if (same) {
    // Same page re-read (a quiet re-align): keep your place by matching the current line's position.
    const old = prev.lines[S.cur];
    if (old) {
      const cy = (old.y0 + old.y1) / 2 + offAtShot.y;
      let best = S.cur, bd = Infinity;
      page.lines.forEach((ln, i) => { const d = Math.abs((ln.y0 + ln.y1) / 2 - cy); if (d < bd) { bd = d; best = i; } });
      S.cur = best;
    }
    S.cur = Math.min(S.cur, page.lines.length - 1);
  }
  S.page = page;
  S.off = { x: 0, y: 0 }; S.last = { dx: 0, dy: 0 }; S.tracked = true; S.lostFor = 0; S.base = 0; S.baseN = 0; S.bigMove = false;
  if (!same) {
    S.pageNo++; S.cur = 0; S.lineT = 0; S.pageActive = 0; S.pageWords = 0;
    hideToast();
    sound.found();
    if (S.resumeOnNewPage && S.mode !== 'skim') setPlaying(true);
    S.pageDone = false; S.resumeOnNewPage = false;
  }
  $('play').disabled = false;
  idleState();
}

function resetPage() {
  S.page = null; S.cur = 0; S.lineT = 0; S.pageDone = false; S.tracked = false; S.cand = null;
  setPlaying(false);
  setState('Point at a page and hold steady');
  renderNote();
}

// ---------- Live: Claude notes, a few lines at a time ----------
const lineText = (ln) => S.page.text.slice(ln.start, ln.end);
function chunkLines(ci) { return S.page ? S.page.lines.slice(ci * CHUNK, ci * CHUNK + CHUNK) : []; }
function chunkKey(ci) { return chunkLines(ci).map(lineText).join(' ').toLowerCase().replace(/[^a-z]/g, '').slice(0, 60); }

function requestNote(ci) {
  const ls = chunkLines(ci);
  if (!ls.length) return;
  const key = chunkKey(ci);
  if (!key || S.notes.has(key)) return;
  if (performance.now() < S.aiBackoffUntil) return;
  if (!keyStore.get() && !new URLSearchParams(location.search).has('mockai')) return;
  const entry = { state: 'loading' };
  S.notes.set(key, entry);
  insightFor({ lines: ls.map(lineText).join('\n'), page: S.page.text, recent: S.recent.slice(-6) })
    .then((data) => { entry.state = 'ready'; entry.data = data; S.recent.push(data.note); renderNote(); })
    .catch((err) => {
      entry.state = 'error'; entry.err = err;
      if (err.code === 'rate' || err.code === 'busy') { S.aiBackoffUntil = performance.now() + 5000; setTimeout(() => S.notes.delete(key), 5000); }
      renderNote();
    });
}

const KIND = { meaning: ['💬', 'In plain words'], context: ['🏛️', 'Context'], insight: ['💡', 'Why it matters'], predict: ['👀', 'Watch for'], question: ['🤔', 'Think about'], fun: ['✨', 'Fun fact'] };
let shownKey = '';
function renderNote() {
  const card = $('note');
  if (S.mode !== 'live' || !S.page || !S.tracked) { card.hidden = true; shownKey = ''; return; }
  const hasKey = keyStore.get() || new URLSearchParams(location.search).has('mockai');
  const ci = Math.floor(S.cur / CHUNK);
  const key = chunkKey(ci);
  const entry = S.notes.get(key);
  card.hidden = false;
  let sig;
  if (!hasKey) sig = 'nokey';
  else if (!entry || entry.state === 'loading') sig = `load:${key}`;
  else if (entry.state === 'error') sig = `err:${key}:${entry.err?.code}`;
  else sig = `ok:${key}`;
  if (sig === shownKey) return;
  shownKey = sig;
  const kind = $('noteKind'), body = $('noteBody'), word = $('noteWord'), act = $('noteAction');
  word.hidden = true; act.hidden = true; card.classList.remove('loading');
  if (sig === 'nokey') {
    kind.textContent = '🔑 Live notes';
    body.textContent = 'Add your Claude API key and I’ll explain the lines you’re on as you read.';
    act.textContent = 'Add key'; act.hidden = false;
  } else if (sig.startsWith('load')) {
    kind.textContent = '✦ Reading along';
    body.textContent = 'Thinking about these lines…';
    card.classList.add('loading');
  } else if (sig.startsWith('err')) {
    const code = entry.err?.code;
    kind.textContent = '⚠️ Live notes';
    body.textContent = code === 'badkey' ? 'Claude rejected the API key.' : code === 'rate' || code === 'busy' ? 'Claude is busy. Trying again in a moment.' : code === 'refusal' ? 'No note for these lines.' : `Couldn’t get a note (${entry.err?.message || 'error'}).`;
    if (code === 'badkey') { act.textContent = 'Change key'; act.hidden = false; }
  } else {
    const d = entry.data;
    const [emo, label] = KIND[d.kind] || ['💡', 'Note'];
    kind.textContent = `${emo} ${label}`;
    body.textContent = d.note;
    if (d.word && d.meaning) { word.hidden = false; word.innerHTML = ''; const b = document.createElement('b'); b.textContent = d.word; word.append(b, ` ${d.meaning}`); }
    card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop');
    sound.note();
  }
}

// ---------- pacing ----------
function lineDur(ln) { return Math.max(0.5, (ln.n / S.wpm) * 60); }

function step(dt) {
  if (!S.page || !S.tracked || S.mode === 'skim' || !S.playing) return;
  const ln = S.page.lines[S.cur];
  if (!ln) return;
  S.pageActive += dt;
  S.lineT += dt;
  if (S.lineT >= lineDur(ln)) {
    S.pageWords += ln.n;
    S.lineT = 0;
    S.cur++;
    if (S.cur >= S.page.lines.length) { S.cur = S.page.lines.length - 1; S.lineT = lineDur(S.page.lines[S.cur]); finishPage(); }
    else sound.tick();
    idleState();
  }
}

function finishPage() {
  setPlaying(false);
  S.pageDone = true; S.resumeOnNewPage = true;
  const secs = Math.max(1, S.pageActive);
  const pace = Math.round(S.pageWords / (secs / 60));
  const st = todayStats();
  st.pages++; st.words += S.pageWords; st.secs += secs; st.best = Math.max(st.best, pace);
  store.set('rl.stats', st);
  sound.done();
  let next = '';
  if (S.push) { setWpm(Math.round((S.wpm * 1.05) / 5) * 5); next = ` Next page at ${S.wpm} wpm.`; }
  showToast('Page done', `${pace} wpm`, `${S.pageWords} words in ${fmt(secs)}. Turn the page and hold steady.${next}`);
  setState('Turn the page');
  renderStats();
  if (S.demoTurn) setTimeout(() => S.demoTurn?.(), 2500); // the sample page turns itself
}

function todayStats() {
  const day = new Date().toISOString().slice(0, 10);
  const st = store.get('rl.stats', null);
  return st && st.day === day ? st : { day, pages: 0, words: 0, secs: 0, best: 0 };
}
function renderStats() {
  const st = todayStats();
  $('stats').textContent = st.pages
    ? `Today: ${st.pages} page${st.pages > 1 ? 's' : ''}, ${st.words} words, avg ${Math.round(st.words / (st.secs / 60))} wpm, best ${st.best} wpm.`
    : 'Finish a page with the pacer to see your reading speed here.';
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// ---------- drawing ----------
const HI = '255, 216, 77';
function rr(x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

function placeNote(v) {
  // Dock the note on whichever half of the screen the reader is NOT looking at.
  const card = $('note');
  if (card.hidden || !S.page) return null;
  const ls = chunkLines(Math.floor(S.cur / CHUNK));
  if (!ls.length) return null;
  const qs = ls.map((l) => rectToScreen(v, l));
  const top = Math.min(...qs.map((q) => q.y0)), bottom = Math.max(...qs.map((q) => q.y1));
  const H = innerHeight;
  const below = (top + bottom) / 2 < H * 0.5;
  card.classList.toggle('at-bottom', below);
  card.classList.toggle('at-top', !below);
  return { qs, top, bottom, below, rect: card.getBoundingClientRect() };
}

function draw() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cr = marks.getBoundingClientRect();
  const W = cr.width, H = cr.height;
  if (marks.width !== Math.round(W * dpr) || marks.height !== Math.round(H * dpr)) { marks.width = Math.round(W * dpr); marks.height = Math.round(H * dpr); }
  // Canvas space = screen space minus the canvas's own offset.
  g.setTransform(dpr, 0, 0, dpr, -cr.left * dpr, -cr.top * dpr);
  g.clearRect(cr.left, cr.top, W, H);
  if (!S.page || !S.tracked) return;
  const v = view();
  const ln = S.page.lines[S.cur];

  if (S.mode === 'skim') {
    S.page.skim.forEach((r) => {
      const q = rectToScreen(v, r), pad = (q.y1 - q.y0) * 0.18;
      g.fillStyle = `rgba(${HI}, .42)`;
      rr(q.x0 - pad, q.y0 - pad, q.x1 - q.x0 + pad * 2, q.y1 - q.y0 + pad * 2, 4); g.fill();
    });
    return;
  }

  if (S.mode === 'focus' && ln) {
    g.fillStyle = 'rgba(6, 8, 12, .78)';
    g.fillRect(cr.left, cr.top, W, H);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const cut = (l, a) => {
      const q = rectToScreen(v, l), h = q.y1 - q.y0, pad = h * 0.45;
      g.fillStyle = `rgba(0,0,0,${a})`;
      g.shadowColor = `rgba(0,0,0,${a})`; g.shadowBlur = h * 0.8;
      rr(q.x0 - pad * 1.5, q.y0 - pad, q.x1 - q.x0 + pad * 3, h + pad * 2, h * 0.4); g.fill();
    };
    cut(ln, 1);
    const nx = S.page.lines[S.cur + 1];
    if (nx) cut(nx, 0.3);
    g.restore();
  }

  if (S.mode === 'live') {
    // The chunk being explained: a soft wash, a bracket in the margin, and a thread to the note.
    const pl = placeNote(v);
    if (pl) {
      g.fillStyle = `rgba(${HI}, .16)`;
      pl.qs.forEach((q) => { const pad = (q.y1 - q.y0) * 0.2; rr(q.x0 - pad, q.y0 - pad, q.x1 - q.x0 + pad * 2, q.y1 - q.y0 + pad * 2, 4); g.fill(); });
      const bx = Math.min(...pl.qs.map((q) => q.x0)) - 12;
      g.save();
      g.strokeStyle = `rgb(${HI})`; g.lineWidth = 4; g.lineCap = 'round';
      g.shadowColor = `rgba(${HI}, .9)`; g.shadowBlur = 10;
      g.beginPath(); g.moveTo(bx, pl.top); g.lineTo(bx, pl.bottom); g.stroke();
      const r = pl.rect, ty = pl.below ? r.top : r.bottom;
      const tx = Math.max(r.left + 24, Math.min(r.right - 24, bx));
      const fy = pl.below ? pl.bottom : pl.top;
      g.lineWidth = 2; g.setLineDash([4, 5]); g.shadowBlur = 6;
      g.beginPath(); g.moveTo(bx, fy); g.bezierCurveTo(bx, (fy + ty) / 2, tx, (fy + ty) / 2, tx, ty); g.stroke();
      g.restore();
    }
  }

  if (!ln) return;
  // The pacer: words already passed get a soft highlighter wash, a glowing rule runs under the line.
  const p = Math.min(1, S.lineT / lineDur(ln));
  const first = rectToScreen(v, ln.words[0]), lastW = rectToScreen(v, ln.words[ln.words.length - 1]);
  const lineScr = rectToScreen(v, ln);
  const left = v.mirror ? lineScr.x1 : lineScr.x0, right = v.mirror ? lineScr.x0 : lineScr.x1;
  const headX = left + (right - left) * p;
  const baseAt = (x) => {
    const xa = v.mirror ? first.x1 : first.x0, xb = v.mirror ? lastW.x0 : lastW.x1;
    const t = xb === xa ? 0 : (x - xa) / (xb - xa);
    return first.y1 + (lastW.y1 - first.y1) * t;
  };
  if (S.mode === 'pacer' || S.mode === 'live') {
    g.fillStyle = `rgba(${HI}, .3)`;
    ln.words.forEach((w) => {
      const q = rectToScreen(v, w);
      const end = v.mirror ? Math.max(q.x0, headX) : Math.min(q.x1, headX);
      if (!v.mirror && end > q.x0) { rr(q.x0 - 2, q.y0 - 2, end - q.x0 + 4, q.y1 - q.y0 + 4, 3); g.fill(); }
      if (v.mirror && end < q.x1) { rr(end - 2, q.y0 - 2, q.x1 - end + 4, q.y1 - q.y0 + 4, 3); g.fill(); }
    });
  }
  const h = lineScr.y1 - lineScr.y0;
  const off = Math.max(3, h * 0.22);
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = `rgb(${HI})`;
  g.shadowColor = `rgba(${HI}, .95)`; g.shadowBlur = 14;
  g.lineWidth = Math.max(3, h * 0.13);
  g.beginPath();
  g.moveTo(left, baseAt(left) + off);
  g.lineTo(headX, baseAt(headX) + off);
  g.stroke();
  g.beginPath();
  g.fillStyle = '#fff';
  g.arc(headX, baseAt(headX) + off, Math.max(4, h * 0.2), 0, Math.PI * 2);
  g.fill();
  g.restore();
}

// ---------- main loop ----------
let lastT = performance.now(), trackAcc = 0;
function loop(t) {
  const dt = Math.min(0.25, (t - lastT) / 1000); // keep true speed even when frames drop during OCR
  lastT = t;
  trackAcc += dt;
  if (trackAcc >= 0.08 && video.videoWidth) {
    trackAcc = 0;
    tick();
  }
  step(dt);
  if (S.mode === 'live' && S.page && S.tracked) {
    const ci = Math.floor(S.cur / CHUNK);
    requestNote(ci);
    requestNote(ci + 1); // fetch ahead so the next note is ready when you get there
  }
  renderNote();
  draw();
  requestAnimationFrame(loop);
}

function tick() {
  const cur = grabSmall();
  S.motion = motionBetween(S.prevSmall, cur);
  S.prevSmall = cur;
  S.steadyFor = S.motion < 0.045 ? S.steadyFor + 0.08 : 0;
  if (S.steadyFor === 0) S.cand = null; // the shot must come from this steady stretch
  S.cooldown = Math.max(0, S.cooldown - 0.08);
  // A big jolt (page flip, phone swung away): hide the guides and re-read once things settle.
  if (S.motion > 0.09 && S.page) { S.bigMove = true; if (S.tracked) { S.tracked = false; setState(S.pageDone ? 'Turn the page and hold steady' : 'Hold steady on the page…'); } }
  if (S.page && cur && S.page.ref && S.page.ref.px.length === cur.px.length) {
    const best = trackOffset(S.page.ref, cur, S.last);
    S.last = best; S.cost = best.c;
    const k = video.videoWidth / SMALL_W;
    S.off = { x: best.dx * k * 0.6 + S.off.x * 0.4, y: best.dy * k * 0.6 + S.off.y * 0.4 }; // light smoothing
    // "Lost" is judged against how well this page matched right after it was read.
    if (S.baseN < 5) { S.base = (S.base * S.baseN + best.c) / (S.baseN + 1); S.baseN++; }
    const lost = best.c > Math.max(0.03, S.base * 2.2);
    S.lostFor = lost ? S.lostFor + 0.08 : 0;
    if (S.lostFor > 0.4 && S.tracked) { S.tracked = false; setState(S.pageDone ? 'Turn the page and hold steady' : 'Hold steady on the page…'); }
    if (!lost && !S.tracked && !S.bigMove && !S.busy) { S.tracked = true; idleState(); }
  }
  if (startShown() || S.busy || S.cooldown > 0) return;

  const needScan = !S.page || S.bigMove || (!S.tracked && S.lostFor > 0.4);
  // Quiet re-align: while steady on a tracked page, re-read it every ~10 s so the guides can't drift.
  const refresh = S.page && S.tracked && performance.now() - S.lastScanAt > 10000;
  if ((needScan || refresh) && S.steadyFor >= 0.3) {
    offerFrame();
    if (S.steadyFor >= 0.9 && S.cand?.n >= 5) { if (needScan) S.bigMove = false; scanPage(!needScan); }
    else if (needScan && S.page == null) setState('Hold steady…');
  }
}

// ---------- UI ----------
function setState(t) { $('state').textContent = t; }
function idleState() {
  if (!S.page || S.busy) return;
  if (S.pageDone) return setState('Turn the page');
  if (S.mode === 'skim') return setState(`${S.page.picks} key ideas lit · ${S.page.nWords} words on the page`);
  setState(S.playing ? `Line ${S.cur + 1} of ${S.page.lines.length}` : `Page found · ${S.page.lines.length} lines · tap ▶`);
}
function setPlaying(on) {
  S.playing = on;
  $('playIcon').textContent = on ? '❚❚' : '▶';
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Start reading');
  idleState();
}
function setWpm(w) {
  S.wpm = Math.max(100, Math.min(900, w));
  $('wpmNum').textContent = S.wpm;
  store.set('rl.wpm', S.wpm);
}
function showToast(k, big, smallText) { $('toastKicker').textContent = k; $('toastBig').textContent = big; $('toastSmall').textContent = smallText; $('toast').hidden = false; }
function hideToast() { $('toast').hidden = true; }
const startShown = () => !$('start').hidden;

$('play').addEventListener('click', () => {
  sound.ready();
  if (!S.page) return;
  if (S.mode === 'skim') setMode('live');
  if (S.pageDone) { S.pageDone = false; S.resumeOnNewPage = false; S.cur = 0; S.lineT = 0; S.pageActive = 0; S.pageWords = 0; hideToast(); }
  setPlaying(!S.playing);
  if (S.playing) sound.start();
});
$('slower').addEventListener('click', () => { setWpm(S.wpm - 25); sound.tick(); });
$('faster').addEventListener('click', () => { setWpm(S.wpm + 25); sound.tick(); });
$('rescan').addEventListener('click', () => {
  S.cooldown = 0; S.cand = null;
  if (S.page) { S.page = null; S.tracked = false; }
  setState('Hold steady…');
});
$('sound').addEventListener('click', (e) => {
  sound.on = !sound.on;
  e.currentTarget.setAttribute('aria-pressed', String(sound.on));
  e.currentTarget.setAttribute('aria-label', sound.on ? 'Sound on' : 'Sound off');
  e.currentTarget.firstElementChild.textContent = sound.on ? '🔊' : '🔇';
});

function setMode(m) {
  S.mode = m;
  store.set('rl.mode', m);
  document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  if (m === 'skim') setPlaying(false);
  if (m === 'live' && !keyStore.get() && !new URLSearchParams(location.search).has('mockai') && S.page) openKey();
  sound.tick();
  shownKey = '';
  idleState();
}
document.querySelectorAll('.modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// Tap a printed line to move the pacer there.
marks.addEventListener('click', (e) => {
  if (!S.page || !S.tracked || S.mode === 'skim') return;
  const v = view();
  let best = -1, bd = Infinity;
  S.page.lines.forEach((ln, i) => {
    const q = rectToScreen(v, ln);
    const d = e.clientY < q.y0 ? q.y0 - e.clientY : e.clientY > q.y1 ? e.clientY - q.y1 : 0;
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0 && bd < 40) { S.cur = best; S.lineT = 0; sound.tick(); idleState(); }
});

// API key sheet
const keyDlg = $('keyDlg');
function openKey() {
  $('keyInput').value = '';
  $('keyStatus').textContent = keyStore.get() ? 'A key is saved on this device.' : '';
  $('keyRemove').hidden = !keyStore.get();
  if (!keyDlg.open) keyDlg.showModal();
}
$('keySave').addEventListener('click', (e) => {
  e.preventDefault();
  const k = $('keyInput').value.trim();
  if (!k) { $('keyStatus').textContent = 'Paste your key first.'; return; }
  keyStore.set(k);
  S.notes.clear(); shownKey = '';
  keyDlg.close();
});
$('keyRemove').addEventListener('click', (e) => { e.preventDefault(); keyStore.clear(); S.notes.clear(); shownKey = ''; keyDlg.close(); });
$('keyCancel').addEventListener('click', (e) => { e.preventDefault(); keyDlg.close(); });
$('noteAction').addEventListener('click', openKey);
$('keyBtn').addEventListener('click', () => { menu.hidden = true; openKey(); });

const menu = $('menu');
$('more').addEventListener('click', (e) => {
  menu.hidden = !menu.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!menu.hidden));
  renderStats();
});
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target.closest('#more') == null) { menu.hidden = true; $('more').setAttribute('aria-expanded', 'false'); } });
$('push').setAttribute('aria-pressed', String(S.push));
$('push').addEventListener('click', (e) => { S.push = !S.push; store.set('rl.push', S.push); e.currentTarget.setAttribute('aria-pressed', String(S.push)); });
$('flip').addEventListener('click', async () => { menu.hidden = true; S.facing = S.facing === 'environment' ? 'user' : 'environment'; try { await startCamera(); } catch { setState('No other camera found'); } });
$('demoBtn').addEventListener('click', () => { menu.hidden = true; useCanvasSource(startDemo); });
$('upload').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  menu.hidden = true;
  $('start').hidden = true;
  const img = new Image();
  img.src = URL.createObjectURL(f);
  await img.decode().catch(() => {});
  useCanvasSource(() => startPhoto(img));
  e.target.value = '';
});

$('go').addEventListener('click', async () => {
  sound.ready();
  $('startStatus').textContent = 'Asking for the camera…';
  ocrWorker();
  try {
    await startCamera();
    $('start').hidden = true;
    if (S.mode === 'live' && !keyStore.get()) openKey();
  } catch (err) {
    $('startStatus').textContent = 'Camera blocked or missing. Try the sample page instead.';
  }
});
$('demo').addEventListener('click', () => { sound.ready(); ocrWorker(); $('start').hidden = true; useCanvasSource(startDemo); });

setWpm(S.wpm);
setMode(S.mode);
$('play').disabled = true;
renderStats();
if (new URLSearchParams(location.search).has('demo')) { $('start').hidden = true; ocrWorker(); useCanvasSource(startDemo); }
requestAnimationFrame(loop);
