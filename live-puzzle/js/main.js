// Live Puzzle: the classic sliding-tile puzzle, cut from your live camera. Every tile keeps playing,
// so you are putting yourself back together while you move. Grids go from 2×2 up to 20×20, and
// Auto solve plays a solution out one move at a time.
// - With the camera on, the board frames your face so your eyes and mouth land on their own tiles.
//   Slide an eye tile home and it blinks; slide the mouth tile home and you smile.
// - The start shows the whole picture, then cuts it into tiles, drops the last one out and scrambles.
// - Tap a tile in the gap's row or column to slide it (a whole line moves at once), swipe, or use arrows.
// - Solving closes the seams back into one live picture, with confetti and a photo to save.

import { Sound } from './sound.js';
import { solve } from './solver.js';
import { FaceTracker, Reactions, EYES, MOUTH } from './face.js';

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
const MIN = 2, MAX = 20;
let N = MIN;
let auto = null;         // { plan, at, carry, rate } while the computer is solving
let autoMoves = 0;
let lastTick = 0;
let face = null, faceLoading = false, faceFailed = false;
let crop = null;         // { cx, cy, size } in camera pixels: the square the board shows
let facePts = null;      // landmarks in picture pixels, while a face is seen
let features = null;     // { eyes: [tile, tile], mouth: tile }
let introWait = 0;
const reactions = new Reactions();
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

function updateSource(t, dt) {
  if (camOn && video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight, m = Math.min(vw, vh);
    if (face) face.detect(video, t * 1000);
    const pts = face && face.points;
    // Without a face: the middle (a bit high on a portrait phone, to keep the face and lose the lap).
    let goal = { cx: vw / 2, cy: vh > vw ? m / 2 + (vh - m) * 0.35 : vh / 2, size: m };
    if (pts) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      const fw = (x1 - x0) * vw, fh = (y1 - y0) * vh;
      // The whole face fills most of the board, so eyes, nose and mouth fall on different tiles.
      goal = { cx: (x0 + x1) / 2 * vw, cy: (y0 + y1) / 2 * vh, size: Math.min(m, Math.max(m * 0.3, fw * 1.9, fh * 1.5)) };
    }
    if (!crop) crop = goal;
    const k = 1 - Math.exp(-dt * 2.5);
    crop.cx += (goal.cx - crop.cx) * k;
    crop.cy += (goal.cy - crop.cy) * k;
    crop.size += (goal.size - crop.size) * k;
    const size = Math.min(m, crop.size);
    const sx = Math.max(0, Math.min(vw - size, crop.cx - size / 2));
    const sy = Math.max(0, Math.min(vh - size, crop.cy - size / 2));
    const mirror = facing === 'user';
    sctx.save();
    if (mirror) { sctx.translate(SRC, 0); sctx.scale(-1, 1); }
    sctx.drawImage(video, sx, sy, size, size, 0, 0, SRC, SRC);
    sctx.restore();
    if (pts) {
      const sc = SRC / size;
      facePts = pts.map(p => {
        const x = (p.x * vw - sx) * sc;
        return { x: mirror ? SRC - x : x, y: (p.y * vh - sy) * sc };
      });
      features = featureTiles(facePts);
    } else {
      facePts = null;
    }
    reactions.apply(sctx, facePts, dt);
  } else {
    drawPicture(t);
  }
  gctx.drawImage(src, 0, 0, 24, 24);
}

/** Which tile (by home position) each eye and the mouth sit on. */
function featureTiles(pts) {
  const tileAt = (x, y) => {
    const c = Math.floor(x / (SRC / N)), r = Math.floor(y / (SRC / N));
    return c >= 0 && c < N && r >= 0 && r < N ? r * N + c : -1;
  };
  const centre = ids => ids.reduce((a, i) => ({ x: a.x + pts[i].x / ids.length, y: a.y + pts[i].y / ids.length }), { x: 0, y: 0 });
  const eyes = EYES.map(e => { const p = centre(e.upper.concat(e.lower)); return tileAt(p.x, p.y); });
  const m = centre([MOUTH.left, MOUTH.right, MOUTH.upper, MOUTH.lower]);
  return { eyes, mouth: tileAt(m.x, m.y) };
}

/** Tiles that just landed home: if one carries an eye it blinks, if it carries the mouth you smile. */
function react(home) {
  if (!features || !facePts) return;
  let blinked = false, smiled = false;
  features.eyes.forEach((tile, e) => { if (home.includes(tile)) { reactions.blink(e); blinked = true; } });
  if (home.includes(features.mouth)) { reactions.smile(); smiled = true; }
  if (smiled) sound.smile(); else if (blinked) sound.blink();
}

async function loadFace() {
  if (face || faceLoading || faceFailed) return;
  faceLoading = true;
  try {
    face = await FaceTracker.create();
  } catch (err) {
    faceFailed = true;
    console.warn('Face tracking unavailable', err);
  }
  faceLoading = false;
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
  stopAuto();
  introWait = 0;
  phase = 'intro';
  phaseT = introTime;
  $('win').hidden = true;
  $('sizeLabel').textContent = `${N}×${N}`;
  $('smaller').disabled = N <= MIN;
  $('bigger').disabled = N >= MAX;
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
  const stagger = Math.min(0.035, 1.4 / (N * N));
  order.forEach((tile, i) => { pos[tile].delay = i * stagger; pos[tile].k = 7; });
  target();
  sound.shuffle();
}

function target() {
  cells.forEach((tile, i) => { pos[tile].tx = i % N; pos[tile].ty = (i / N) | 0; });
}

/** Slide the tile at cell i (and everything between it and the gap) into the gap. */
function slide(i, byComputer = false) {
  if (phase !== 'play' || (auto && !byComputer)) return;
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
  const k = auto ? Math.min(400, 30 + auto.rate * 0.6) : 22;
  for (const t of moved) pos[t].k = k;
  target();
  moves += moved.length;
  if (!started) started = true;
  const now = performance.now();
  if (!auto || now - lastTick > 70) { sound.slide(moved.length); lastTick = now; }
  if (!auto && navigator.vibrate) navigator.vibrate(8);
  const home = moved.filter(t => cells[t] === t);
  if (home.length) {
    if (!auto || N <= 6) sound.place();
    if (!auto || N <= 8) for (const t of home) glints.push({ t, life: 0.6 });
    react(home);
  }
  if (solved()) win();
  stats();
}

function win() {
  const byComputer = !!auto;
  stopAuto();
  phase = 'won';
  phaseT = 0;
  setHint('');
  const key = `live-puzzle:best:${N}`;
  let best = null;
  try { best = JSON.parse(localStorage.getItem(key)); } catch {}
  const record = !byComputer && (!best || elapsed < best.time);
  if (record) {
    best = { time: elapsed, moves };
    try { localStorage.setItem(key, JSON.stringify(best)); } catch {}
  }
  $('win').querySelector('.kicker').textContent = byComputer ? 'Auto solved' : 'Solved';
  $('win').querySelector('h2').textContent = byComputer ? 'Put back together for you.' : "You're back together.";
  $('result').textContent = byComputer ? `${N}×${N} · ${autoMoves} computer ${autoMoves === 1 ? 'move' : 'moves'}` : `${clock(elapsed)} · ${moves} ${moves === 1 ? 'move' : 'moves'}`;
  $('best').textContent = record ? `New best for ${N}×${N}!`
    : best ? `Your best ${N}×${N}: ${clock(best.time)} · ${best.moves} moves` : `Now try ${N}×${N} yourself.`;
  $('next').hidden = N >= MAX;
  $('next').textContent = `Next: ${N + 1}×${N + 1}`;
}

// ---------- auto solve ----------

function startAuto() {
  if (phase !== 'play' || auto) return;
  const plan = solve(cells, N);
  if (!plan.length) return;
  // Small grids go one visible move at a time; big ones speed up so any grid takes under ~20 s.
  auto = { plan, at: 0, carry: 0, rate: Math.max(9, plan.length / 18) };
  autoMoves = 0;
  const b = $('auto');
  b.classList.add('running');
  b.innerHTML = '<span aria-hidden="true">⏹</span> Stop';
}

function stopAuto() {
  if (!auto) return;
  auto = null;
  const b = $('auto');
  b.classList.remove('running');
  b.innerHTML = '<span aria-hidden="true">🤖</span> Auto solve';
  if (phase === 'play') setHint('');
  for (const p of pos) p.k = 22;
}

function runAuto(dt) {
  if (!auto || phase !== 'play') return;
  auto.carry += dt * auto.rate;
  while (auto && auto.carry >= 1 && auto.at < auto.plan.length) {
    auto.carry -= 1;
    autoMoves++;
    slide(auto.plan[auto.at++], true);
  }
  if (auto) setHint(`Solving… ${auto.at} / ${auto.plan.length} moves`);
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
    introWait += dt;
    const waiting = camOn && !facePts && !faceFailed && introWait < 6;
    if (phaseT <= 0 && waiting) setHint('Finding your face…');
    if (phaseT <= 0 && !waiting) { phase = 'split'; setHint(''); }
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
    setHint(facePts ? 'Slide your eyes and mouth home. Watch what happens.' : 'Tap a tile next to the gap to slide it.');
  }
  runAuto(dt);
  if (phase === 'play' && started && !auto) {
    elapsed += dt;
    if (moves > 0) setHint('');
  }
  if (phase === 'won') {
    phaseT += dt;
    const k = ease(phaseT / 0.9);
    split = 1 - k;
    gapAlpha = k;
    if (phaseT >= 0.9 && phaseT - dt < 0.9) {
      flash = 1;
      burst();
      sound.win();
      if (navigator.vibrate) navigator.vibrate([20, 40, 30]);
      reactions.smile(true);           // the whole face comes back together: a big smile and a wink
      reactions.blink(0);
    }
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
  const gap = split * Math.max(N > 8 ? 1 : 3, cell * 0.045);
  const rad = split * cell * 0.09;
  const fancy = N <= 8;     // big grids skip per-tile rounding, gloss and outlines to stay smooth
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
      if (!fancy) {
        ctx.drawImage(src, (id % N) * part, ((id / N) | 0) * part, part, part, dx, dy, w, w);
        ctx.globalAlpha = 1;
        continue;
      }
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
  updateSource(t, dt);
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
  crop = null;
  loadFace();
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
$('next').addEventListener('click', () => { N = Math.min(MAX, N + 1); newGame(1.2); });
$('smaller').addEventListener('click', () => { if (N > MIN) { N--; newGame(0.8); } });
$('bigger').addEventListener('click', () => { if (N < MAX) { N++; newGame(0.8); } });
$('auto').addEventListener('click', () => { if (auto) stopAuto(); else startAuto(); });
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
window.puzzle = { get cells() { return cells; }, get phase() { return phase; }, get n() { return N; }, get features() { return features; }, get face() { return !!facePts; }, reactions, slide, startAuto, solve: () => { for (let i = 0; i < N * N; i++) cells[i] = i; target(); win(); } };
