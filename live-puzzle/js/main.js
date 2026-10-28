// Live Puzzle: the classic sliding-tile puzzle, cut from your live camera. Every tile keeps playing,
// so you are putting yourself back together while you move.
// - The start shows the whole picture, then cuts it into tiles, drops the last one out and scrambles.
// - Tap a tile in the gap's row or column to slide it (a whole line moves at once), swipe, or use arrows.
// - Solving closes the seams back into one live picture, with confetti and a photo to save.

import { Sound } from './sound.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');
const video = $('cam');
const SRC = 720;                       // the square picture the tiles are cut from
const src = document.createElement('canvas');
src.width = src.height = SRC;
const sctx = src.getContext('2d');
const glow = document.createElement('canvas');   // tiny copy, stretched into a blurred backdrop
glow.width = glow.height = 24;
const gctx = glow.getContext('2d');

const sound = new Sound();
const SIZES = [3, 4, 5];
let N = 4;
let cells = [];          // cells[cell] = tile id; the last id is the gap
let pos = [];            // pos[tile] = shown position in cells, eased towards its target
let phase = 'idle';      // idle | intro | split | scramble | play | won
let phaseT = 0;
let split = 0;           // 0 = one seamless picture, 1 = cut into tiles
let gapAlpha = 1;        // the missing tile fades out at the start and back in when solved
let moves = 0, elapsed = 0, started = false;
let peek = 0, peeking = false;
let flash = 0;
let confetti = [];
let glints = [];         // brief mint rings where a tile lands home
let facing = 'user', camOn = false, stream = null;
let board = { x: 0, y: 0, s: 300 };
let dpr = 1;
let last = performance.now();

const gapId = () => N * N - 1;
const solved = () => cells.every((t, i) => t === i);

// ---------- layout ----------

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  const hint = $('hint'), controls = $('controls');
  const top = $('top').getBoundingClientRect().bottom + 14;
  const bottomBar = controls.getBoundingClientRect().top;
  const hintH = 30;
  hint.style.top = '';
  const bottom = bottomBar - hintH - 14;
  const s = Math.max(160, Math.min(innerWidth - 32, bottom - top, 620));
  board = { x: (innerWidth - s) / 2, y: top + Math.max(0, (bottom - top - s) / 2), s };
  hint.style.top = `${board.y + s + 10}px`;
}

// ---------- the picture ----------

function updateSource(t) {
  if (camOn && video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight, m = Math.min(vw, vh);
    const sy = vh > vw ? (vh - m) * 0.35 : (vh - m) / 2;      // portrait: keep the face, lose the lap
    sctx.save();
    if (facing === 'user') { sctx.translate(SRC, 0); sctx.scale(-1, 1); }
    sctx.drawImage(video, (vw - m) / 2, sy, m, m, 0, 0, SRC, SRC);
    sctx.restore();
  } else {
    drawPicture(t);
  }
  gctx.drawImage(src, 0, 0, 24, 24);
}

/** Without a camera: a moving sunset over the sea, busy enough that every tile is different. */
function drawPicture(t) {
  const S = SRC;
  const sky = sctx.createLinearGradient(0, 0, 0, S * 0.62);
  sky.addColorStop(0, '#2b1055');
  sky.addColorStop(0.55, '#d53369');
  sky.addColorStop(1, '#ffb347');
  sctx.fillStyle = sky;
  sctx.fillRect(0, 0, S, S);
  const sx = S * (0.5 + Math.sin(t * 0.2) * 0.12), sy = S * 0.5;
  sctx.save();
  sctx.translate(sx, sy);
  sctx.rotate(t * 0.15);
  sctx.fillStyle = 'rgba(255, 230, 150, .18)';
  for (let i = 0; i < 12; i++) {
    sctx.rotate(Math.PI / 6);
    sctx.beginPath(); sctx.moveTo(0, 0); sctx.lineTo(S, -S * 0.07); sctx.lineTo(S, S * 0.07); sctx.fill();
  }
  sctx.restore();
  sctx.fillStyle = '#fff1b8';
  sctx.beginPath(); sctx.arc(sx, sy, S * 0.13, 0, Math.PI * 2); sctx.fill();
  const layers = [['#3a1c71', 0.6, 0.5], ['#24124f', 0.7, 0.8], ['#120a2e', 0.82, 1.2]];
  for (const [color, base, speed] of layers) {
    sctx.fillStyle = color;
    sctx.beginPath();
    sctx.moveTo(0, S);
    for (let x = 0; x <= S; x += 12) {
      const y = S * base + Math.sin(x / S * 9 + t * speed) * S * 0.025 + Math.sin(x / S * 23 - t * speed * 1.7) * S * 0.01;
      sctx.lineTo(x, y);
    }
    sctx.lineTo(S, S);
    sctx.fill();
  }
  for (let i = 0; i < 26; i++) {
    const x = (i * 97.3 + t * 30 * (1 + (i % 3))) % S, y = S * (0.12 + ((i * 37) % 40) / 100);
    sctx.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(t * 2 + i)})`;
    sctx.fillRect(x, y, 3, 3);
  }
}

// ---------- game ----------

function newGame(introTime = 1.8) {
  cells = Array.from({ length: N * N }, (_, i) => i);
  pos = cells.map(i => ({ x: i % N, y: (i / N) | 0, tx: i % N, ty: (i / N) | 0, delay: 0, k: 20 }));
  split = 0;
  gapAlpha = 1;
  moves = 0;
  elapsed = 0;
  started = false;
  confetti = [];
  glints = [];
  phase = 'intro';
  phaseT = introTime;
  $('win').hidden = true;
  $('sizeLabel').textContent = `${N}×${N}`;
  setHint(camOn ? 'This is you. Remember the picture.' : 'Remember the picture.');
  stats();
}

function scramble() {
  let b = gapId(), prev = -1;
  const steps = N * N * 30;
  for (let i = 0; i < steps || solved(); i++) {
    const r = (b / N) | 0, c = b % N;
    const options = [];
    if (r > 0) options.push(b - N);
    if (r < N - 1) options.push(b + N);
    if (c > 0) options.push(b - 1);
    if (c < N - 1) options.push(b + 1);
    const pick = options.filter(o => o !== prev);
    const o = pick[(Math.random() * pick.length) | 0];
    cells[b] = cells[o];
    cells[o] = gapId();
    prev = b;
    b = o;
  }
  const order = cells.map((_, i) => i).sort(() => Math.random() - 0.5);
  order.forEach((tile, i) => { pos[tile].delay = i * 0.035; pos[tile].k = 7; });
  target();
  sound.shuffle();
}

function target() {
  cells.forEach((tile, i) => { pos[tile].tx = i % N; pos[tile].ty = (i / N) | 0; });
}

/** Slide the tile at cell i (and everything between it and the gap) into the gap. */
function slide(i) {
  if (phase !== 'play') return;
  const b = cells.indexOf(gapId());
  const r = (i / N) | 0, c = i % N, br = (b / N) | 0, bc = b % N;
  let step;
  if (r === br && c !== bc) step = c > bc ? 1 : -1;
  else if (c === bc && r !== br) step = r > br ? N : -N;
  else return;
  const moved = [];
  for (let j = b; j !== i; j += step) {
    cells[j] = cells[j + step];
    moved.push(cells[j]);
  }
  cells[i] = gapId();
  for (const t of moved) pos[t].k = 22;
  target();
  moves += moved.length;
  if (!started) started = true;
  sound.slide(moved.length);
  if (navigator.vibrate) navigator.vibrate(8);
  const home = moved.filter(t => cells[t] === t);
  if (home.length) {
    sound.place();
    for (const t of home) glints.push({ t, life: 0.6 });
  }
  if (solved()) win();
  stats();
}

function win() {
  phase = 'won';
  phaseT = 0;
  setHint('');
  const key = `live-puzzle:best:${N}`;
  let best = null;
  try { best = JSON.parse(localStorage.getItem(key)); } catch {}
  const record = !best || elapsed < best.time;
  if (record) {
    best = { time: elapsed, moves };
    try { localStorage.setItem(key, JSON.stringify(best)); } catch {}
  }
  $('result').textContent = `${clock(elapsed)} · ${moves} ${moves === 1 ? 'move' : 'moves'}`;
  $('best').textContent = record ? `New best for ${N}×${N}!` : `Best ${N}×${N}: ${clock(best.time)} · ${best.moves} moves`;
}

function burst() {
  const cx = board.x + board.s / 2, cy = board.y + board.s / 2;
  const colors = ['#7dffc4', '#bfe9ff', '#ff8fb1', '#ffd36e', '#ffffff'];
  for (let i = 0; i < 160; i++) {
    const a = Math.random() * Math.PI * 2, v = 300 + Math.random() * 700;
    confetti.push({
      x: cx + Math.cos(a) * board.s * 0.2, y: cy + Math.sin(a) * board.s * 0.2,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 350,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
      w: 6 + Math.random() * 7, h: 3 + Math.random() * 4,
      c: colors[i % colors.length], life: 2.2 + Math.random() * 1.2,
    });
  }
}

// ---------- frame ----------

const ease = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function update(dt) {
  if (phase === 'intro') {
    phaseT -= dt;
    if (phaseT <= 0) { phase = 'split'; setHint(''); }
  }
  if (phase === 'split') {
    split = Math.min(1, split + dt * 2.4);
    gapAlpha = Math.max(0, gapAlpha - dt * 2.6);
    if (split >= 1 && gapAlpha <= 0) { phase = 'scramble'; scramble(); }
  }
  let settled = true;
  for (const p of pos) {
    if (p.delay > 0) { p.delay -= dt; settled = false; continue; }
    const f = 1 - Math.exp(-dt * p.k);
    p.x += (p.tx - p.x) * f;
    p.y += (p.ty - p.y) * f;
    if (Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) > 0.01) settled = false;
  }
  if (phase === 'scramble' && settled) {
    phase = 'play';
    setHint('Tap a tile next to the gap to slide it.');
  }
  if (phase === 'play' && started) {
    elapsed += dt;
    if (moves > 0) setHint('');
  }
  if (phase === 'won') {
    phaseT += dt;
    const k = ease(phaseT / 0.9);
    split = 1 - k;
    gapAlpha = k;
    if (phaseT >= 0.9 && phaseT - dt < 0.9) { flash = 1; burst(); sound.win(); if (navigator.vibrate) navigator.vibrate([20, 40, 30]); }
    if (phaseT >= 1.9 && $('win').hidden) $('win').hidden = false;
  }
  peek += ((peeking && phase === 'play' ? 1 : 0) - peek) * Math.min(1, dt * 12);
  flash = Math.max(0, flash - dt * 1.6);
  for (const g of glints) g.life -= dt;
  glints = glints.filter(g => g.life > 0);
  for (const p of confetti) {
    p.vy += 900 * dt;
    p.vx *= 1 - dt * 0.8;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.r += p.vr * dt;
    p.life -= dt;
  }
  confetti = confetti.filter(p => p.life > 0 && p.y < innerHeight + 40);
  if (Math.floor(elapsed) !== Math.floor(elapsed - dt)) stats();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function draw(t) {
  const W = innerWidth, H = innerHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  // Backdrop: the picture blurred huge and dimmed.
  const cover = Math.max(W, H) * 1.1;
  ctx.drawImage(glow, (W - cover) / 2, (H - cover) / 2, cover, cover);
  ctx.fillStyle = 'rgba(4, 6, 10, .62)';
  ctx.fillRect(0, 0, W, H);

  if (phase === 'idle') return;
  const { x: bx, y: by, s } = board;
  const cell = s / N;
  const gap = split * Math.max(3, cell * 0.045);
  const rad = split * cell * 0.09;
  const part = SRC / N;

  // The tray the tiles sit in.
  if (split > 0) {
    ctx.globalAlpha = split;
    roundRect(ctx, bx - 6, by - 6, s + 12, s + 12, 14);
    ctx.fillStyle = 'rgba(0, 0, 0, .5)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(191, 233, 255, .22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (split < 0.002) {
    ctx.drawImage(src, bx, by, s, s);
  } else {
    for (let id = 0; id < N * N; id++) {
      const a = id === gapId() ? gapAlpha : 1;
      if (a < 0.01) continue;
      const p = pos[id];
      const dx = bx + p.x * cell + gap / 2, dy = by + p.y * cell + gap / 2, w = cell - gap;
      ctx.globalAlpha = a;
      ctx.save();
      roundRect(ctx, dx, dy, w, w, rad);
      ctx.clip();
      ctx.drawImage(src, (id % N) * part, ((id / N) | 0) * part, part, part, dx, dy, w, w);
      const gloss = ctx.createLinearGradient(0, dy, 0, dy + w);
      gloss.addColorStop(0, `rgba(255,255,255,${0.16 * split})`);
      gloss.addColorStop(0.4, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(dx, dy, w, w);
      ctx.restore();
      if (split > 0.3) {
        const home = cells[id] === id;
        roundRect(ctx, dx + 0.5, dy + 0.5, w - 1, w - 1, rad);
        ctx.lineWidth = home && phase === 'play' ? 2 : 1;
        ctx.strokeStyle = home && phase === 'play' ? 'rgba(125, 255, 196, .75)' : `rgba(255, 255, 255, ${0.22 * split})`;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  // Tiles landing home: a mint ring that swells and fades.
  for (const g of glints) {
    const p = pos[g.t], k = 1 - g.life / 0.6;
    const cx = bx + (p.x + 0.5) * cell, cy = by + (p.y + 0.5) * cell;
    ctx.strokeStyle = `rgba(125, 255, 196, ${0.8 * (1 - k)})`;
    ctx.lineWidth = 3;
    roundRect(ctx, cx - cell * (0.5 + k * 0.12), cy - cell * (0.5 + k * 0.12), cell * (1 + k * 0.24), cell * (1 + k * 0.24), rad + 4);
    ctx.stroke();
  }

  if (peek > 0.01) {
    ctx.globalAlpha = peek * 0.92;
    ctx.save();
    roundRect(ctx, bx, by, s, s, 10);
    ctx.clip();
    ctx.drawImage(src, bx, by, s, s);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flash * 0.45})`;
    ctx.fillRect(bx, by, s, s);
  }

  for (const p of confetti) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    ctx.fillStyle = p.c;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  updateSource(t);
  update(dt);
  draw(t);
  requestAnimationFrame(frame);
}

// ---------- UI ----------

function clock(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function stats() {
  $('time').textContent = clock(elapsed);
  $('moves').textContent = `${moves} ${moves === 1 ? 'move' : 'moves'}`;
}

function setHint(text) {
  const h = $('hint');
  if (h.textContent !== text) h.textContent = text;
}

async function startCamera() {
  if (stream) stream.getTracks().forEach(tr => tr.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play().catch(() => {});
  camOn = true;
}

$('go').addEventListener('click', async () => {
  sound.ready();
  $('status').textContent = 'Starting your camera…';
  try {
    await startCamera();
    $('start').hidden = true;
    newGame();
  } catch {
    $('status').textContent = "Couldn't open the camera. You can play with a picture instead.";
  }
});

$('nocam').addEventListener('click', () => {
  sound.ready();
  camOn = false;
  $('flip').disabled = true;
  $('start').hidden = true;
  newGame(1.4);
});

$('again').addEventListener('click', () => newGame(1.2));
$('shuffle').addEventListener('click', () => { if (phase === 'play' || phase === 'won') newGame(0.6); });
$('size').addEventListener('click', () => {
  N = SIZES[(SIZES.indexOf(N) + 1) % SIZES.length];
  newGame(0.8);
});
$('sound').addEventListener('click', e => {
  sound.on = !sound.on;
  const b = e.currentTarget;
  b.setAttribute('aria-pressed', String(sound.on));
  b.innerHTML = `<span aria-hidden="true">${sound.on ? '🔊' : '🔇'}</span> Sound ${sound.on ? 'on' : 'off'}`;
  if (sound.on) sound.ready();
});
$('flip').addEventListener('click', async () => {
  if (!camOn) return;
  facing = facing === 'user' ? 'environment' : 'user';
  try { await startCamera(); } catch { facing = facing === 'user' ? 'environment' : 'user'; }
});

const peekBtn = $('peek');
const peekOn = e => { e.preventDefault(); peeking = true; peekBtn.classList.add('held'); };
const peekOff = () => { peeking = false; peekBtn.classList.remove('held'); };
peekBtn.addEventListener('pointerdown', peekOn);
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) peekBtn.addEventListener(ev, peekOff);
peekBtn.addEventListener('contextmenu', e => e.preventDefault());

$('save').addEventListener('click', async () => {
  const out = document.createElement('canvas');
  out.width = 1080;
  out.height = 1240;
  const o = out.getContext('2d');
  o.fillStyle = '#07090d';
  o.fillRect(0, 0, 1080, 1240);
  o.drawImage(src, 0, 0, 1080, 1080);
  o.fillStyle = '#f2f6fa';
  o.font = '700 46px system-ui, sans-serif';
  o.textAlign = 'center';
  o.fillText(`Solved ${N}×${N} in ${clock(elapsed)} · ${moves} moves`, 540, 1150);
  o.fillStyle = 'rgba(242,246,250,.6)';
  o.font = '500 30px system-ui, sans-serif';
  o.fillText('Live Puzzle', 540, 1200);
  const blob = await new Promise(r => out.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'live-puzzle.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'live-puzzle.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

// Board input: tap a tile, or swipe anywhere to push the tile next to the gap that way.
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!down) return;
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  const from = down;
  down = null;
  if (phase !== 'play') return;
  if (Math.hypot(dx, dy) < 18) {
    const c = Math.floor((from.x - board.x) / (board.s / N)), r = Math.floor((from.y - board.y) / (board.s / N));
    if (c >= 0 && c < N && r >= 0 && r < N) slide(r * N + c);
  } else {
    push(Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0]);
  }
});

/** Push the tile beside the gap in direction [dr, dc] (i.e. the tile on the opposite side of the gap). */
function push([dr, dc]) {
  const b = cells.indexOf(gapId());
  const r = ((b / N) | 0) - dr, c = (b % N) - dc;
  if (r >= 0 && r < N && c >= 0 && c < N) slide(r * N + c);
}

addEventListener('keydown', e => {
  const dirs = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (dirs[e.key]) { e.preventDefault(); push(dirs[e.key]); }
  if (e.key === ' ' && !e.repeat) { e.preventDefault(); peeking = true; }
});
addEventListener('keyup', e => { if (e.key === ' ') peeking = false; });

addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);
window.puzzle = { get cells() { return cells; }, get phase() { return phase; }, slide, solve: () => { for (let i = 0; i < N * N; i++) cells[i] = i; target(); win(); } };
