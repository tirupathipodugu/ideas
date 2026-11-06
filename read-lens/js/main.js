// Read Lens: read the page once with on-device OCR (Tesseract), keep the printed lines locked to the
// paper with a cheap image tracker, and draw the reading guides (Pacer / Focus / Skim) over the live feed.
import { buildText, summarize } from './summarize.js';
import { Sound } from './sound.js';
import { startDemo, startPhoto } from './sources.js';

const $ = (id) => document.getElementById(id);
const video = $('cam');
const marks = $('marks');
const g = marks.getContext('2d');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const S = {
  mode: 'pacer',
  wpm: store.get('rl.wpm', 250),
  push: store.get('rl.push', true),
  playing: false,
  page: null,          // { lines, text, words, skim, ref, refW, refH }
  cur: 0, lineT: 0,
  pageNo: 0, pageActive: 0, pageWords: 0, pageDone: false, resumeOnNewPage: false,
  off: { x: 0, y: 0 }, cost: 0, lostFor: 0, tracked: false, bigMove: false, base: 0, baseN: 0,
  busy: false, steadyFor: 0, cooldown: 0, prevSmall: null, motion: 1,
  facing: 'environment', stream: null, stopSource: null,
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
        if (m.status === 'recognizing text' && S.busy) setState(`Reading the page… ${Math.round(m.progress * 100)}%`);
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
function view() {
  const W = innerWidth, H = innerHeight, vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const s = Math.max(W / vw, H / vh);
  return { s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2, W, mirror: video.classList.contains('mirror') };
}
function rectToScreen(v, r) {
  let x0 = (r.x0 + S.off.x) * v.s + v.ox, x1 = (r.x1 + S.off.x) * v.s + v.ox;
  const y0 = (r.y0 + S.off.y) * v.s + v.oy, y1 = (r.y1 + S.off.y) * v.s + v.oy;
  if (v.mirror) [x0, x1] = [v.W - x1, v.W - x0];
  return { x0, y0, x1, y1 };
}

// ---------- small gray frames for tracking ----------
const SMALL_W = 160;
const small = document.createElement('canvas');
const sg = small.getContext('2d', { willReadFrequently: true });
function grabSmall() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return null;
  const h = Math.round(SMALL_W * vh / vw);
  if (small.width !== SMALL_W || small.height !== h) { small.width = SMALL_W; small.height = h; }
  sg.filter = "blur(0.8px)"; // soften text so sub-pixel drift is not mistaken for motion
  sg.drawImage(video, 0, 0, SMALL_W, h);
  const d = sg.getImageData(0, 0, SMALL_W, h).data;
  const out = new Float32Array(SMALL_W * h);
  let sum = 0;
  for (let i = 0, j = 0; j < out.length; i += 4, j++) { const y = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; out[j] = y; sum += y; }
  const mean = sum / out.length;
  for (let j = 0; j < out.length; j++) out[j] -= mean; // ignore overall brightness shifts
  return { px: out, w: SMALL_W, h };
}
const MARGIN = 22;
function sad(ref, cur, dx, dy) {
  let s = 0, n = 0;
  const { w, h } = ref;
  for (let y = MARGIN; y < h - MARGIN; y += 2) {
    const ry = y * w, cy = (y + dy) * w;
    for (let x = MARGIN; x < w - MARGIN; x += 2) { s += Math.abs(ref.px[ry + x] - cur.px[cy + x + dx]); n++; }
  }
  return s / n;
}
// Where did the page move to since we read it? Text lines repeat every few pixels, so a wide search
// happily locks onto the line above. Search only a small window around the last answer and charge a
// little for every pixel of movement, so the nearest good match wins.
function trackOffset(ref, cur, last) {
  let best = { dx: last.dx, dy: last.dy, c: Infinity }, bestPen = Infinity;
  const lim = MARGIN - 1;
  for (let dy = last.dy - 3; dy <= last.dy + 3; dy++) {
    for (let dx = last.dx - 3; dx <= last.dx + 3; dx++) {
      if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;
      const raw = sad(ref, cur, dx, dy);
      const pen = raw + 0.0015 * (Math.abs(dx - last.dx) + Math.abs(dy - last.dy));
      if (pen < bestPen) { bestPen = pen; best = { dx, dy, c: raw }; }
    }
  }
  return best;
}
function motionBetween(a, b) {
  // Residual after the best small shift: a slowly drifting hand still counts as "steady",
  // a page being turned or the phone swinging does not.
  if (!a || !b || a.px.length !== b.px.length) return 1;
  return trackOffset(a, b, { dx: 0, dy: 0 }).c;
}

// ---------- reading the page ----------
const shot = document.createElement('canvas');
async function scanPage() {
  if (S.busy || !video.videoWidth) return;
  S.busy = true;
  setState('Reading the page…');
  try {
    const vw = video.videoWidth, vh = video.videoHeight;
    const c = Math.min(1, 2000 / Math.max(vw, vh));
    shot.width = Math.round(vw * c); shot.height = Math.round(vh * c);
    const sctx = shot.getContext('2d', { willReadFrequently: true });
    sctx.filter = 'grayscale(1) contrast(1.25)';
    sctx.drawImage(video, 0, 0, shot.width, shot.height);
    const ref = grabSmall();
    const worker = await ocrWorker();
    const { data } = await worker.recognize(shot);
    const lines = data.lines || [];
    const page = buildPage(lines, 1 / c);
    if (!page || page.lines.length < 2) {
      setState('No lines found. Move closer and hold steady.');
      S.cooldown = 1.5;
      return;
    }
    page.ref = ref;
    adoptPage(page);
  } catch (e) {
    console.error(e);
    setState('Could not read the page. Try again.');
    S.cooldown = 2;
  } finally {
    S.busy = false;
    idleState();
  }
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

function adoptPage(page) {
  const prev = S.page;
  const same = prev && similarity(prev.text, page.text) > 0.6;
  S.page = page;
  S.off = { x: 0, y: 0 }; S.last = { dx: 0, dy: 0 }; S.tracked = true; S.lostFor = 0; S.base = 0; S.baseN = 0;
  if (same) {
    S.cur = Math.min(S.cur, page.lines.length - 1); // same page re-read: keep your place
  } else {
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
  S.page = null; S.cur = 0; S.lineT = 0; S.pageDone = false; S.tracked = false;
  setPlaying(false);
  setState('Point at a page and hold steady');
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

function draw() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  if (marks.width !== Math.round(W * dpr) || marks.height !== Math.round(H * dpr)) { marks.width = Math.round(W * dpr); marks.height = Math.round(H * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
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
    g.fillRect(0, 0, W, H);
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
  if (S.mode === 'pacer') {
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
    const cur = grabSmall();
    S.motion = motionBetween(S.prevSmall, cur);
    S.prevSmall = cur;
    S.steadyFor = S.motion < 0.045 ? S.steadyFor + 0.08 : 0;
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
    const needScan = !S.page || S.bigMove || (!S.tracked && S.lostFor > 0.4);
    if (needScan && !S.busy && S.cooldown === 0 && S.steadyFor >= 0.7 && !startShown()) { S.bigMove = false; scanPage(); }
  }
  step(dt);
  draw();
  requestAnimationFrame(loop);
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
  $('play').setAttribute('aria-label', on ? 'Pause pacer' : 'Start pacer');
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
  if (S.mode === 'skim') setMode('pacer');
  if (S.pageDone) { S.pageDone = false; S.resumeOnNewPage = false; S.cur = 0; S.lineT = 0; S.pageActive = 0; S.pageWords = 0; hideToast(); }
  setPlaying(!S.playing);
  if (S.playing) sound.start();
});
$('slower').addEventListener('click', () => { setWpm(S.wpm - 25); sound.tick(); });
$('faster').addEventListener('click', () => { setWpm(S.wpm + 25); sound.tick(); });
$('rescan').addEventListener('click', () => { S.cooldown = 0; if (S.page) { S.page = null; S.tracked = false; } setState('Hold steady…'); S.steadyFor = 0.7; });
$('sound').addEventListener('click', (e) => {
  sound.on = !sound.on;
  e.currentTarget.setAttribute('aria-pressed', String(sound.on));
  e.currentTarget.setAttribute('aria-label', sound.on ? 'Sound on' : 'Sound off');
  e.currentTarget.firstElementChild.textContent = sound.on ? '🔊' : '🔇';
});

function setMode(m) {
  S.mode = m;
  document.querySelectorAll('.modes button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  if (m === 'skim') setPlaying(false);
  sound.tick();
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
  } catch (err) {
    $('startStatus').textContent = 'Camera blocked or missing. Try the sample page instead.';
  }
});
$('demo').addEventListener('click', () => { sound.ready(); ocrWorker(); $('start').hidden = true; useCanvasSource(startDemo); });

setWpm(S.wpm);
$('play').disabled = true;
renderStats();
if (new URLSearchParams(location.search).has('demo')) { $('start').hidden = true; ocrWorker(); useCanvasSource(startDemo); }
requestAnimationFrame(loop);
