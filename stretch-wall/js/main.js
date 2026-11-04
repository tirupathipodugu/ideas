// Stretch Wall. The camera sees you from the front, so the walls come from the tunnel behind you:
// each one grows behind your cut-out, reaches you, and you hold the stretch while it presses in.
// Hold long enough and it slides past the camera; drop the pose too long and it shatters.

import { bodyFrom, evaluate, figure, makeDeck, paintSilhouette, pointsFromPose } from './stretches.js';
import { Sound } from './audio.js';
import { postOnX, saveImage } from '../../shared/share-x.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d', { alpha: false });
const video = $('cam');
const sound = new Sound();

// ?sim plays with a stand-in body and no camera, for checking the game on any machine.
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const SIM_FAIL = params.get('sim') === 'fail';

const HEARTS = 3;
const FIT_ON = 0.5, FIT_OFF = 0.38;      // the pose must clear .5 to fit, then only drop out below .38
const GRACE = 1.8;                       // seconds out of pose before the wall breaks
const REST = 0.9, PASS = 0.6, SHATTER = 1.25, LOST_AFTER = 0.7;
const HUES = [174, 205, 262, 330, 28, 96];
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const BEST_KEY = 'stretch-wall-best';
const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } };
const writeBest = (n) => { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* private window: no record kept */ } };

let W = 0, H = 0, dpr = 1;
let vw = 1280, vh = 720, stream = null, tracker = null, lastVideoTime = -1;
const person = document.createElement('canvas');
const personCtx = person.getContext('2d');
const alpha = document.createElement('canvas');
const alphaCtx = alpha.getContext('2d');
let alphaData = null;

const G = {
  phase: 'idle',          // idle, frame, rest, approach, hold, pass, shatter, over
  t: 0, passed: 0, hearts: HEARTS, held: 0, areas: new Set(),
  deck: null, stretch: null, fig: null, hue: 174, wallNo: 0, skipped: false,
  approach: 7, holdFor: 4, holdT: 0, pressure: 0, fit: false, result: null,
  neutral: null, swRef: 0, frameT: 0, frameOk: 0,
  lost: 0, paused: false, shake: 0, flash: 0, tunnel: 0, wall: null, shards: [], lastTick: 0,
  photo: null, photoFor: 0,
};
const sim = { points: null, pose: { L: [10, 8], R: [10, 8] }, current: { L: [10, 8], R: [10, 8] } };

// ---------- layout ----------

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  if (G.stretch && G.phase === 'approach') buildWall();
}
addEventListener('resize', resize);

/** The video covers the screen, mirrored. */
function view() {
  const k = Math.max(W / vw, H / vh);
  return { k, ox: (W - vw * k) / 2, oy: (H - vh * k) / 2 };
}
const anchor = () => {
  const v = view();
  return { x: v.ox + G.neutral.x * v.k, y: v.oy + G.neutral.y * v.k, U: G.swRef * v.k };
};
const vanishing = () => ({ x: W / 2, y: H * 0.42 });

// ---------- the wall ----------

function paintPanels(c, w, h, hue) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `hsl(${hue} 48% 30%)`);
  g.addColorStop(1, `hsl(${hue} 56% 15%)`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  const cell = Math.max(70, w / 18);
  c.lineWidth = 2;
  for (let y = 0, row = 0; y < h; y += cell * 0.62, row++) {
    for (let x = row % 2 ? -cell / 2 : 0; x < w; x += cell) {
      c.fillStyle = `hsla(${hue} 60% ${22 + Math.random() * 16}% / .55)`;
      c.fillRect(x + 2, y + 2, cell - 4, cell * 0.62 - 4);
      c.strokeStyle = `hsla(${hue} 80% 75% / .1)`;
      c.strokeRect(x + 2, y + 2, cell - 4, cell * 0.62 - 4);
    }
  }
}

/** A sheet big enough to cover the tunnel, with the stretch's shape cut out of it. */
function buildWall() {
  const a = anchor(), vp = vanishing();
  const span = 1.7;
  const scale = Math.min(1, 2800 / (W * span), 2800 / (H * span));
  const bw = Math.round(W * span * scale), bh = Math.round(H * span * scale);
  const sheet = document.createElement('canvas');
  sheet.width = bw; sheet.height = bh;
  const c = sheet.getContext('2d');
  paintPanels(c, bw, bh, G.hue);
  const hx = bw / 2 + (a.x - vp.x) * scale;
  const hy = bh / 2 + (a.y - vp.y) * scale;
  const U = a.U * scale;
  c.save();
  c.shadowColor = `hsl(${G.hue} 100% 70%)`;
  c.shadowBlur = 30 * scale;
  c.fillStyle = c.strokeStyle = `hsl(${G.hue} 95% 78%)`;
  paintSilhouette(c, G.fig, hx, hy, U, 0.19);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = c.strokeStyle = '#000';
  paintSilhouette(c, G.fig, hx, hy, U, 0.12);
  c.restore();
  const cracks = [];
  for (let i = 0; i < 26; i++) {
    const angle = Math.random() * Math.PI * 2;
    const line = [];
    let r = (0.9 + Math.random() * 1.2) * a.U, b = angle;
    line.push([Math.cos(b) * r, Math.sin(b) * r]);
    const parts = 4 + Math.floor(Math.random() * 4);
    for (let j = 0; j < parts; j++) {
      r += (0.3 + Math.random() * 0.8) * a.U;
      b += (Math.random() - 0.5) * 0.5;
      line.push([Math.cos(b) * r, Math.sin(b) * r]);
    }
    cracks.push(line);
  }
  G.wall = { sheet, scale, bw, bh, offX: hx / scale, offY: hy / scale, cracks };
}

/** Where the wall sits at depth s (1 = at the player, above 1 = past them, toward the camera). */
function wallBox(s) {
  const a = anchor(), vp = vanishing();
  const cx = vp.x + (a.x - vp.x) * s, cy = vp.y + (a.y - vp.y) * s;
  const m = G.wall;
  return { x: cx - m.offX * s, y: cy - m.offY * s, w: (m.bw / m.scale) * s, h: (m.bh / m.scale) * s, cx, cy };
}

function drawWall(s, opacity = 1) {
  if (!G.wall) return;
  const box = wallBox(s);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(G.wall.sheet, box.x, box.y, box.w, box.h);
  ctx.restore();
  if (G.pressure > 0) {
    const n = Math.ceil(G.pressure * G.wall.cracks.length);
    ctx.save();
    ctx.lineWidth = 2 + G.pressure * 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255, 245, 235, ${0.5 + G.pressure * 0.5})`;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 5;
    for (let i = 0; i < n; i++) {
      const line = G.wall.cracks[i];
      ctx.beginPath();
      line.forEach(([x, y], j) => {
        if (j) ctx.lineTo(box.cx + x * s, box.cy + y * s);
        else ctx.moveTo(box.cx + x * s, box.cy + y * s);
      });
      ctx.stroke();
    }
    ctx.restore();
  }
}

function shatter() {
  const m = G.wall;
  const small = document.createElement('canvas');
  small.width = Math.round(m.bw / 2); small.height = Math.round(m.bh / 2);
  small.getContext('2d').drawImage(m.sheet, 0, 0, small.width, small.height);
  const box = wallBox(1);
  const cols = 11, rows = 8;
  const cw = box.w / cols, ch = box.h / rows;
  G.shards = [];
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const jitter = () => (Math.random() - 0.5) * 0.5;
      const poly = [
        [-0.5 + jitter() * 0.5, -0.5 + jitter() * 0.5],
        [0.5 + jitter() * 0.5, -0.5 + jitter() * 0.5],
        [0.5 + jitter() * 0.5, 0.5 + jitter() * 0.5],
        [-0.5 + jitter() * 0.5, 0.5 + jitter() * 0.5],
      ].map(([x, y]) => [x * cw * 1.15, y * ch * 1.15]);
      const x = box.x + (col + 0.5) * cw, y = box.y + (r + 0.5) * ch;
      const dx = x - box.cx, dy = y - box.cy, len = Math.hypot(dx, dy) || 1;
      const speed = 260 + Math.random() * 760;
      G.shards.push({
        x, y, poly, ix: x - box.x, iy: y - box.y,
        vx: (dx / len) * speed, vy: (dy / len) * speed - 170,
        spin: (Math.random() - 0.5) * 7, rot: 0, grow: 0.5 + Math.random() * 1.6, s: 1,
      });
    }
  }
  G.shardImage = small;
  G.shardBox = { w: box.w, h: box.h };
}

function drawShards(dt) {
  const img = G.shardImage;
  if (!img) return;
  const fade = clamp(1.25 - G.t / SHATTER, 0, 1);
  ctx.save();
  ctx.globalAlpha = fade;
  for (const p of G.shards) {
    p.vy += 900 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.spin * dt; p.s += p.grow * dt;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(p.s, p.s);
    ctx.beginPath();
    p.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, -p.ix, -p.iy, G.shardBox.w, G.shardBox.h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ---------- the scene ----------

function drawTunnel() {
  const vp = vanishing();
  const hue = G.hue;
  ctx.fillStyle = `hsl(${hue} 42% 5%)`;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(vp.x, vp.y, 8, vp.x, vp.y, Math.max(W, H) * 0.75);
  glow.addColorStop(0, `hsla(${hue} 90% 66% / .42)`);
  glow.addColorStop(0.4, `hsla(${hue} 70% 34% / .16)`);
  glow.addColorStop(1, 'hsla(0 0% 0% / 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `hsla(${hue} 90% 75% / .2)`;
  ctx.beginPath();
  for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H], [W * 0.28, H], [W * 0.72, H], [W * 0.28, 0], [W * 0.72, 0], [0, H * 0.5], [W, H * 0.5]]) {
    ctx.moveTo(vp.x, vp.y); ctx.lineTo(x, y);
  }
  ctx.stroke();
  // Rings rushing past sell the motion down the tunnel.
  for (let i = 0; i < 7; i++) {
    const depth = ((i / 7 + G.tunnel) % 1);
    const s = depth * depth;
    ctx.strokeStyle = `hsla(${hue} 90% 76% / ${0.3 * s})`;
    ctx.lineWidth = 1 + s * 2;
    ctx.strokeRect(vp.x - vp.x * s, vp.y - vp.y * s, W * s, H * s);
  }
}

function drawPerson() {
  const v = view();
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  if (SIM) {
    if (G.neutral) {
      const a = anchor();
      ctx.restore(); ctx.save();
      ctx.fillStyle = ctx.strokeStyle = '#c9d4de';
      paintSilhouette(ctx, figure(sim.current), a.x, a.y, a.U);
    }
  } else if (video.readyState >= 2) {
    refreshCutout();
    ctx.drawImage(person, W - (v.ox + vw * v.k), v.oy, vw * v.k, vh * v.k);
  }
  ctx.restore();
}

/** The person mask, reduced to a small alpha image and stamped over the current video frame. */
function refreshCutout() {
  if (person.width !== vw || person.height !== vh) { person.width = vw; person.height = vh; }
  personCtx.globalCompositeOperation = 'source-over';
  personCtx.clearRect(0, 0, vw, vh);
  personCtx.drawImage(video, 0, 0, vw, vh);
  if (!tracker?.mask) return;
  const mw = tracker.maskW, mh = tracker.maskH, m = tracker.mask;
  const step = Math.max(1, Math.floor(mw / 320));
  const aw = Math.floor(mw / step), ah = Math.floor(mh / step);
  if (alpha.width !== aw || alpha.height !== ah || !alphaData) {
    alpha.width = aw; alpha.height = ah;
    alphaData = alphaCtx.createImageData(aw, ah);
  }
  if (tracker.maskFresh) {
    tracker.maskFresh = false;
    const d = alphaData.data;
    for (let y = 0; y < ah; y++) {
      const row = y * step * mw;
      for (let x = 0; x < aw; x++) {
        const value = m[row + x * step];
        d[(y * aw + x) * 4 + 3] = value < 90 ? 0 : value > 170 ? 255 : (value - 90) * 3.19;
      }
    }
    alphaCtx.putImageData(alphaData, 0, 0);
  }
  personCtx.globalCompositeOperation = 'destination-in';
  personCtx.drawImage(alpha, 0, 0, vw, vh);
}

const SEG = [['head', 'neck', 'head'], ['L', 'sL', 'eL'], ['L', 'eL', 'wL'], ['R', 'sR', 'eR'], ['R', 'eR', 'wR'], ['torso', 'sL', 'sR']];

/** The target pose drawn over the player; each limb turns green as it gets into place. */
function drawGuide(limbs, opacity) {
  if (!G.fig || opacity <= 0) return;
  const a = anchor(), f = G.fig;
  const X = (p) => a.x + p.x * a.U, Y = (p) => a.y + p.y * a.U;
  const color = (limb) => (limbs && limbs[limb] < 0.5 ? '#ffb347' : '#7dffc4');
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.lineCap = 'round';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 6;
  ctx.lineWidth = Math.max(5, a.U * 0.055);
  for (const [limb, from, to] of SEG) {
    ctx.strokeStyle = color(limb);
    ctx.beginPath();
    ctx.moveTo(X(f[from]), Y(f[from]));
    ctx.lineTo(X(f[to]), Y(f[to]));
    ctx.stroke();
  }
  ctx.strokeStyle = color('head');
  ctx.beginPath();
  ctx.arc(X(f.head), Y(f.head), f.headR * a.U, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const k of ['eL', 'wL', 'eR', 'wR']) {
    ctx.beginPath();
    ctx.arc(X(f[k]), Y(f[k]), Math.max(5, a.U * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHoldRing() {
  const a = anchor(), f = G.fig;
  const r = (f.headR + 0.14) * a.U;
  const x = a.x + f.head.x * a.U, y = a.y + f.head.y * a.U;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(8, a.U * 0.07);
  ctx.strokeStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = G.fit ? '#7dffc4' : '#ff6b6b';
  ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + (G.holdT / G.holdFor) * Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawMini(pose) {
  const mini = $('mini'), c = mini.getContext('2d');
  c.clearRect(0, 0, mini.width, mini.height);
  c.fillStyle = c.strokeStyle = `hsl(${G.hue} 90% 72%)`;
  c.save();
  c.beginPath();
  c.rect(0, 0, mini.width, mini.height);
  c.clip();
  paintSilhouette(c, figure(pose), mini.width / 2, mini.height * 0.56, mini.width * 0.21, 0.02);
  c.restore();
}

// ---------- game flow ----------

function setCount(text, cls = '') {
  const el = $('count');
  el.hidden = !text;
  el.textContent = text;
  el.className = 'count ' + cls;
}
function setHint(text, good = false) {
  const el = $('hint');
  if (el.textContent !== text) el.textContent = text;
  el.classList.toggle('good', good);
}
function updateStats() {
  $('hearts').textContent = '♥'.repeat(G.hearts) + '♡'.repeat(HEARTS - G.hearts);
  $('hearts').setAttribute('aria-label', `${G.hearts} of ${HEARTS} lives left`);
  $('score').textContent = `${G.passed} wall${G.passed === 1 ? '' : 's'}`;
}

function enter(phase) { G.phase = phase; G.t = 0; }

function nextWall() {
  G.stretch = G.deck();
  G.fig = figure(G.stretch.pose);
  G.hue = HUES[G.wallNo++ % HUES.length];
  G.approach = Math.max(4.5, 7.5 - G.passed * 0.2);
  G.holdFor = Math.round(Math.min(8, 4 + G.passed * 0.25));
  G.holdT = 0; G.pressure = 0; G.fit = false; G.skipped = false;
  G.result = null;
  buildWall();
  $('cueName').textContent = G.stretch.name;
  $('cueHow').textContent = G.stretch.how;
  $('cue').hidden = false;
  drawMini(G.stretch.pose);
  setCount('');
  sound.say(G.stretch.name);
  sim.pose = SIM_FAIL ? { L: [10, 8], R: [10, 8] } : G.stretch.pose;
  enter('approach');
}

function passWall() {
  if (!G.skipped) {
    G.passed++;
    G.areas.add(G.stretch.area);
    updateStats();
    setCount(praise(), 'pop');
    sound.pass();
  }
  $('cue').hidden = true;
  setHint('');
  enter('pass');
}
function praise() {
  const n = G.stretch.area;
  return { neck: 'Neck thanks you', back: 'Back feels longer', chest: 'Chest wide open', shoulders: 'Shoulders loose', arms: 'Arms woken up', wrists: 'Wrists saved' }[n] || 'Through!';
}

function breakWall() {
  G.hearts--;
  updateStats();
  shatter();
  sound.smash();
  G.shake = REDUCED ? 0 : 1;
  G.flash = 1;
  G.pressure = 0;
  $('cue').hidden = true;
  setHint('');
  setCount('Wall broken!', 'pop bad');
  G.photoFor = 2;
  enter('shatter');
}

function endGame() {
  sound.rumble(0);
  window.speechSynthesis?.cancel();
  enter('over');
  const best = readBest();
  const isBest = G.passed > best;
  if (isBest) writeBest(G.passed);
  const secs = Math.round(G.held);
  $('overKicker').textContent = G.hearts <= 0 ? 'The walls won this round' : 'Stretch break done';
  $('overTitle').textContent = G.passed ? `You got through ${G.passed} wall${G.passed === 1 ? '' : 's'}.` : 'The first wall got you.';
  $('overResult').textContent = `${secs} second${secs === 1 ? '' : 's'} of real stretching`;
  $('overAreas').textContent = G.areas.size ? `Worked: ${[...G.areas].join(', ')}.` : '';
  $('overBest').textContent = isBest ? 'New personal best!' : best ? `Your best: ${best} walls` : '';
  $('cue').hidden = true;
  setCount('');
  setHint('');
  $('top').hidden = true;
  $('controls').hidden = true;
  const photo = $('overPhoto');
  photo.hidden = !G.photo;
  $('save').hidden = !G.photo;
  if (G.photo) photo.src = URL.createObjectURL(G.photo);
  $('over').hidden = false;
  stopCamera();
}

function setPaused(paused) {
  if (!['frame', 'rest', 'approach', 'hold', 'pass', 'shatter'].includes(G.phase)) return;
  G.paused = paused;
  $('paused').hidden = !paused;
  $('pause').innerHTML = paused ? '<span aria-hidden="true">▶</span> Resume' : '<span aria-hidden="true">⏸</span> Pause';
  $('pause').setAttribute('aria-pressed', String(paused));
  if (paused) { sound.rumble(0); window.speechSynthesis?.cancel(); }
}

function skipWall() {
  if (G.phase !== 'approach' && G.phase !== 'hold') return;
  G.skipped = true;
  G.pressure = 0;
  passWall();
}

function currentBody() {
  if (SIM) {
    const blend = (a, b) => a.map((v, i) => v + (b[i] - v) * 0.09);
    const next = {
      L: blend(sim.current.L || [10, 8], sim.pose.L || [10, 8]),
      R: blend(sim.current.R || [10, 8], sim.pose.R || [10, 8]),
      lean: (sim.current.lean || 0) + ((sim.pose.lean || 0) - (sim.current.lean || 0)) * 0.09,
      tilt: (sim.current.tilt || 0) + ((sim.pose.tilt || 0) - (sim.current.tilt || 0)) * 0.09,
    };
    sim.current = next;
    sim.points = pointsFromPose(next, vw, vh, { x: vw / 2, y: vh * 0.5 }, vw * 0.17);
    return { points: sim.points, found: true };
  }
  if (!tracker) return { found: false };
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    tracker.detect(video, performance.now());
  }
  return { points: tracker.points, found: tracker.found };
}

function step(dt) {
  const seen = currentBody();
  let body = null;
  const visible = seen.found && seen.points[11 * 3 + 2] > 0.4 && seen.points[12 * 3 + 2] > 0.4;
  if (visible) {
    G.lost = 0;
    const ref = G.swRef || 1;
    body = bodyFrom(seen.points, vw, vh, ref, G.neutral);
  } else {
    G.lost += dt;
  }

  if (G.phase === 'idle' || G.phase === 'over') return { body: null };

  if (G.phase === 'frame') {
    framing(dt, body);
    return { body };
  }
  if (G.paused) return { body };

  const lost = G.lost > LOST_AFTER;
  if (lost && G.phase !== 'shatter' && G.phase !== 'pass') {
    setHint("I can't see you. Sit back into view and the wall will wait.");
    sound.rumble(0);
    return { body, lost };
  }
  G.t += dt;
  G.tunnel = (G.tunnel + dt * (G.phase === 'approach' ? 0.34 : 0.12)) % 1;

  if (body && (G.phase === 'rest' || G.phase === 'pass')) settleNeutral(body, dt);

  let result = null;
  if (body && G.stretch && (G.phase === 'approach' || G.phase === 'hold')) {
    result = evaluate(G.stretch, body);
    const was = G.fit;
    G.fit = was ? result.score >= FIT_OFF : result.score >= FIT_ON;
    if (G.fit && !was && !G.fitChimed) { sound.fit(); G.fitChimed = true; }
    G.result = result;
    window.__stretchWall = SIM ? { phase: G.phase, stretch: G.stretch.id, score: result.score, fit: G.fit, passed: G.passed, hearts: G.hearts } : undefined;
  }

  switch (G.phase) {
    case 'rest':
      if (G.t >= REST) { setCount(''); G.fitChimed = false; nextWall(); }
      break;
    case 'approach': {
      const p = G.t / G.approach;
      sound.rumble(p * p);
      const left = Math.ceil(G.approach - G.t);
      if (result) {
        if (G.fit) setHint('That\'s it. Stay there.', true);
        else setHint(result.hint);
      }
      if (left <= 3 && left !== G.lastTick) { G.lastTick = left; sound.tick(); }
      setCount(left <= 3 ? String(left) : '');
      if (p >= 1) { G.lastTick = 0; setCount(''); enter('hold'); }
      break;
    }
    case 'hold': {
      sound.rumble(0.55);
      const lostFrame = !body;
      if (G.fit && !lostFrame) {
        G.holdT += dt;
        G.held += dt;
        G.pressure = Math.max(0, G.pressure - dt * 0.5);
        setHint('Hold it. Breathe.', true);
      } else if (!lostFrame) {
        const before = G.pressure;
        G.pressure += dt / GRACE;
        if (Math.floor(before * 4) !== Math.floor(G.pressure * 4)) sound.strain();
        setHint(result ? result.hint : '');
      }
      const left = Math.ceil(G.holdFor - G.holdT);
      setCount(String(Math.max(1, left)), G.fit ? '' : 'bad');
      if (left !== G.lastTick) { G.lastTick = left; if (G.holdT > 0) sound.tick(); }
      if (G.holdT >= G.holdFor) { G.lastTick = 0; passWall(); }
      else if (G.pressure >= 1) { G.lastTick = 0; breakWall(); }
      break;
    }
    case 'pass':
      sound.rumble(Math.max(0, 0.6 - G.t));
      if (G.t >= PASS) { G.wall = null; enter('rest'); }
      break;
    case 'shatter':
      sound.rumble(0);
      if (G.t >= SHATTER) {
        G.wall = null; G.shards = []; G.shardImage = null;
        setCount('');
        if (G.hearts <= 0) { sound.over(); endGame(); }
        else enter('rest');
      }
      break;
  }
  return { body, result };
}

/** Seconds after the player moves their seat, the wall's hole should follow them. */
function settleNeutral(b, dt) {
  const rate = clamp(dt * 0.9, 0, 1);
  G.neutral.x += (b.origin.x - G.neutral.x) * rate;
  G.neutral.y += (b.origin.y - G.neutral.y) * rate;
  G.swRef += (b.shoulderPx - G.swRef) * rate;
}

function framing(dt, body) {
  G.frameT += dt;
  if (!body) {
    G.frameOk = 0;
    setHint('Sit in front of the camera so I can see your shoulders');
    return;
  }
  const width = body.shoulderPx / vw;
  const inShot = width >= 0.1 && width <= 0.42;
  if (!G.neutral) { G.neutral = { ...body.origin }; G.swRef = body.shoulderPx; }
  settleNeutral(body, dt * 3);
  if (width > 0.42) setHint('Sit back a little so your arms fit');
  else if (width < 0.1) setHint('Come a little closer');
  else setHint('Perfect, stay there', true);
  G.frameOk = inShot ? G.frameOk + dt : 0;
  if (G.frameOk > 1.1 || G.frameT > 7) {
    setHint('');
    enter('rest');
    G.t = REST - 0.4;
  }
}

// ---------- drawing a frame ----------

function render(dt, state) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  if (G.shake > 0) {
    ctx.translate((Math.random() - 0.5) * 34 * G.shake, (Math.random() - 0.5) * 34 * G.shake);
    G.shake = Math.max(0, G.shake - dt * 2.6);
  }
  drawTunnel();
  const ready = G.neutral && G.wall;
  if (ready && G.phase === 'approach') {
    const p = clamp(G.t / G.approach, 0, 1);
    drawWall(1 / (1 + (1 - p) * 8));
  } else if (ready && G.phase === 'hold') {
    drawWall(1 + G.holdT * 0.002);
  }
  drawPerson();
  if (G.phase === 'approach' && G.neutral) drawGuide(state.result?.limbs, 0.92);
  if (G.phase === 'hold' && G.neutral) { drawGuide(state.result?.limbs, 0.92); drawHoldRing(); }
  if (ready && G.phase === 'pass') {
    const p = clamp(G.t / PASS, 0, 1);
    const eased = p * p;
    drawWall(1 + eased * 5, 1 - eased * 0.7);
  }
  if (G.phase === 'shatter') drawShards(dt);
  if (G.pressure > 0) {
    const edge = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    edge.addColorStop(0, 'rgba(255,50,50,0)');
    edge.addColorStop(1, `rgba(255,50,50,${G.pressure * 0.5})`);
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  if (G.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${G.flash * 0.55})`;
    ctx.fillRect(0, 0, W, H);
    G.flash = Math.max(0, G.flash - dt * 4.5);
  }
  // The break photo: taken just after the flash clears, with the shards mid-air.
  if (G.photoFor > 0 && G.phase === 'shatter' && G.t > 0.22) {
    G.photoFor = 0;
    canvas.toBlob((blob) => { if (blob) G.photo = blob; }, 'image/jpeg', 0.9);
  }
}

let last = performance.now();
function frame(now) {
  const dt = clamp((now - last) / 1000, 0.001, 0.05);
  last = now;
  const state = step(dt);
  render(dt, state);
  requestAnimationFrame(frame);
}

// ---------- start up ----------

async function startCamera() {
  if (SIM) return;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  video.hidden = false;
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  await video.play();
  await new Promise((resolve) => (video.videoWidth ? resolve() : video.addEventListener('loadedmetadata', resolve, { once: true })));
  vw = video.videoWidth; vh = video.videoHeight;
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

async function loadTracker() {
  if (SIM || tracker) return;
  const { PoseTracker } = await import('../../body-mirror/js/pose.js');
  tracker = await PoseTracker.create('lite');
}

function resetGame() {
  Object.assign(G, {
    passed: 0, hearts: HEARTS, held: 0, areas: new Set(), deck: makeDeck(), stretch: null, fig: null, wall: null,
    neutral: null, swRef: 0, frameT: 0, frameOk: 0, lost: 0, paused: false, shards: [], shardImage: null, shake: 0,
    flash: 0, pressure: 0, photo: null, photoFor: 0, wallNo: 0, fitChimed: false, lastTick: 0,
  });
  updateStats();
  $('top').hidden = false;
  $('controls').hidden = false;
  $('over').hidden = true;
  $('paused').hidden = true;
  enter('frame');
}

async function begin() {
  const button = $('go'), status = $('status');
  sound.unlock();
  button.disabled = true;
  try {
    status.textContent = 'Asking for your camera…';
    await startCamera();
    status.textContent = 'Warming up body tracking…';
    await loadTracker();
    $('start').hidden = true;
    resetGame();
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    const none = err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError');
    status.textContent = denied ? 'Camera is blocked. Allow it in your browser, then tap Start again.'
      : none ? 'No camera found. Stretch Wall needs one to see your stretches.'
      : 'Something went wrong starting the game. Please reload and try again.';
    console.warn('Stretch Wall could not start', err);
    stopCamera();
  } finally {
    button.disabled = false;
  }
}

$('go').addEventListener('click', begin);
$('again').addEventListener('click', begin2);
async function begin2() {
  sound.unlock();
  $('again').disabled = true;
  try {
    await startCamera();
    resetGame();
  } catch (err) {
    console.warn('Stretch Wall could not restart', err);
    $('overResult').textContent = 'The camera did not come back. Please reload the page.';
  } finally {
    $('again').disabled = false;
  }
}
$('sound').addEventListener('click', () => {
  const on = !sound.on;
  sound.unlock();
  sound.setOn(on);
  $('sound').setAttribute('aria-pressed', String(on));
  $('sound').innerHTML = `<span aria-hidden="true">${on ? '🔊' : '🔇'}</span> Sound ${on ? 'on' : 'off'}`;
});
$('pause').addEventListener('click', () => setPaused(!G.paused));
$('resume').addEventListener('click', () => setPaused(false));
$('skip').addEventListener('click', skipWall);
$('end').addEventListener('click', () => { if (G.phase !== 'over') { G.paused = false; $('paused').hidden = true; endGame(); } });
$('save').addEventListener('click', () => { if (G.photo) saveImage(G.photo, 'stretch-wall.jpg', 'Stretch Wall'); });
$('post').addEventListener('click', () => {
  const n = G.passed;
  postOnX({
    path: 'stretch-wall/',
    text: n ? `I stretched my way through ${n} wall${n === 1 ? '' : 's'} at my desk. How many can you pass?` : 'A wall just beat me at stretching. Can you do better?',
  });
});
addEventListener('keydown', (e) => {
  if (e.target.closest?.('button')) return;
  if (e.code === 'Space') { e.preventDefault(); setPaused(!G.paused); }
  if (e.key === 's' || e.key === 'S') skipWall();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

resize();
updateStats();
requestAnimationFrame(frame);
