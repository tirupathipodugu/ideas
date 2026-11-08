// Why Diwali?: six stories, each a small game on one canvas, then a quiz.
// Deities and the Guru are never drawn as people: Rama's party are small glowing walkers, Krishna is
// his chakra, Lakshmi her footprints, Guru Hargobind his cloak, Mahavira a flame.
import { postOnX } from '../../shared/share-x.js';

const $ = (id) => document.getElementById(id);
const cv = $('c'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, S = 1, T = 0;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => 1 - (1 - u) ** 3;

// ---------- sound: soft temple-bell chimes ----------
let ac = null, soundOn = true;
function unlock() { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); } if (ac?.state === 'suspended') ac.resume(); }
function bell(f = 660, vol = 0.18, dur = 1.6) {
  if (!soundOn || !ac || ac.state !== 'running') return;
  const t = ac.currentTime;
  [[1, 1], [2.76, 0.35], [5.4, 0.15]].forEach(([m, v]) => {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.frequency.value = f * m; gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol * v, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / m ** 0.3);
    o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + dur);
  });
}
function whoosh() {
  if (!soundOn || !ac || ac.state !== 'running') return;
  const t = ac.currentTime, n = ac.sampleRate * 0.4, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / n) * Math.PI);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain();
  s.buffer = b; f.type = 'bandpass'; f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.35); gn.gain.value = 0.25;
  s.connect(f).connect(gn).connect(ac.destination); s.start(t);
}
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
const chime = (i) => bell(SCALE[i % SCALE.length] * (i >= SCALE.length ? 2 : 1) / 2, 0.16);
const win = () => [0, 2, 4, 5].forEach((k, i) => setTimeout(() => bell(SCALE[k], 0.14, 2), i * 130));
$('sound').addEventListener('click', () => {
  soundOn = !soundOn; unlock();
  $('sound').textContent = soundOn ? '🔊' : '🔇'; $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
});

// ---------- lamps counter ----------
let lamps = 0;
function addLamp(n = 1) { lamps += n; $('lamps').textContent = `🪔 ${lamps}`; }

// ---------- drawing helpers ----------
let skyCache = null;
function sky(top = '#05040d', bottom = '#1c1236') {
  const key = top + bottom + W + 'x' + H;
  if (skyCache?.key !== key) {
    const c = document.createElement('canvas'); c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
    const x = c.getContext('2d'); x.scale(DPR, DPR);
    const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    let seed = 11; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < (W * H) / 2200; i++) { x.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.6})`; const s = r() < 0.08 ? 1.7 : 1; x.fillRect(r() * W, r() * H * 0.75, s, s); }
    skyCache = { key, c };
  }
  g.drawImage(skyCache.c, 0, 0, W, H);
}
function glow(x, y, r, col, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}
/** A clay diya; lit 0..1 fades the flame in. */
function diya(x, y, s, lit, hint = false) {
  if (lit > 0) { g.save(); g.globalCompositeOperation = 'lighter'; glow(x, y - 10 * s, 70 * s, '255,170,50', 0.45 * lit); g.restore(); }
  if (hint && lit === 0) { g.save(); g.globalCompositeOperation = 'lighter'; glow(x, y - 4 * s, 34 * s, '255,210,120', 0.18 + 0.14 * Math.sin(T * 5)); g.restore(); }
  g.fillStyle = '#b5521f'; g.beginPath(); g.moveTo(x - 14 * s, y - 4 * s); g.quadraticCurveTo(x, y + 13 * s, x + 14 * s, y - 4 * s); g.lineTo(x + 18 * s, y - 7 * s); g.quadraticCurveTo(x + 9 * s, y - 2 * s, x, y - 3 * s); g.quadraticCurveTo(x - 9 * s, y - 2 * s, x - 14 * s, y - 4 * s); g.fill();
  g.fillStyle = '#e07b33'; g.beginPath(); g.ellipse(x, y - 4 * s, 14 * s, 3.2 * s, 0, 0, Math.PI * 2); g.fill();
  if (lit > 0) {
    const fl = 1 + Math.sin(T * 13 + x) * 0.08, h = 13 * s * lit * fl;
    g.fillStyle = '#ffb42a'; g.beginPath(); g.moveTo(x + 9 * s, y - 6 * s); g.quadraticCurveTo(x + 15 * s, y - 6 * s - h * 0.5, x + 11 * s, y - 6 * s - h); g.quadraticCurveTo(x + 5 * s, y - 6 * s - h * 0.45, x + 9 * s, y - 6 * s); g.fill();
    g.fillStyle = '#fff3c0'; g.beginPath(); g.ellipse(x + 10 * s, y - 8 * s - h * 0.2, 1.8 * s, 3.5 * s * lit, 0, 0, Math.PI * 2); g.fill();
  }
}
// Little sparkles that rise from anything lit.
const parts = [];
function sparkle(x, y, n = 14, col = '255,200,90', sp = 80) {
  for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), v = rand(0.3, 1) * sp * S; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30 * S, life: rand(0.5, 1.1), age: 0, col }); }
}
function drawParts(dt) {
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.age += dt;
    if (p.age > p.life) { parts.splice(i, 1); continue; }
    p.vx *= 0.96; p.vy = p.vy * 0.96 + 40 * S * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    g.fillStyle = `rgba(${p.col},${1 - p.age / p.life})`; g.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
  }
  g.restore();
}
function walker(x, y, s, col, bow = false) {
  g.save(); g.globalCompositeOperation = 'lighter'; glow(x, y - 16 * s, 26 * s, col, 0.5); g.restore();
  g.fillStyle = `rgb(${col})`;
  g.beginPath(); g.arc(x, y - 26 * s, 4.2 * s, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(x - 5 * s, y - 20 * s); g.lineTo(x + 5 * s, y - 20 * s); g.lineTo(x + 7 * s, y); g.lineTo(x - 7 * s, y); g.fill();
  if (bow) { g.strokeStyle = `rgb(${col})`; g.lineWidth = 1.6 * s; g.beginPath(); g.arc(x + 8 * s, y - 15 * s, 11 * s, -1.2, 1.2); g.stroke(); }
}

// ---------- 1. Rama: light the way home ----------
function gameRama() {
  const n = 12, ds = [];
  const path = (u) => [W / 2 + Math.sin(u * 5.2) * W * 0.2, H * 0.86 - u * H * 0.52];
  for (let i = 0; i < n; i++) { const u = (i + 0.5) / n, [px, py] = path(u); ds.push({ x: px + (i % 2 ? 1 : -1) * 34 * S, y: py, lit: 0, on: false }); }
  let walk = 0, done = false, doneT = 0;
  return {
    tip: 'Tap the lamps to light their way home',
    update(dt) {
      ds.forEach((d) => { if (d.on) d.lit = Math.min(1, d.lit + dt * 3); });
      let k = 0; while (k < n && ds[k].on) k++;
      const target = k === n ? 1.06 : k / n;
      walk += (target - walk) * Math.min(1, dt * 1.2);
      if (k === n && !done) { done = true; doneT = T; win(); }
      return done && T - doneT > 2.4;
    },
    draw() {
      sky('#04030b', '#160f2c');
      const lit = ds.filter((d) => d.on).length / n;
      // Ayodhya on the hill
      const cx = W / 2, by = H * 0.3;
      g.fillStyle = '#100b1e';
      g.fillRect(cx - 120 * S, by - 40 * S, 240 * S, 50 * S);
      [[-80, 30], [0, 52], [80, 30]].forEach(([dx, r]) => { g.beginPath(); g.arc(cx + dx * S, by - 40 * S, r * 0.5 * S, Math.PI, 0); g.fill(); g.fillRect(cx + dx * S - 2 * S, by - 40 * S - r * 0.5 * S - 14 * S, 4 * S, 14 * S); });
      if (done) {
        const a = clamp((T - doneT) / 1.2, 0, 1);
        g.save(); g.globalCompositeOperation = 'lighter'; glow(cx, by - 20 * S, 260 * S, '255,170,60', 0.5 * a); g.restore();
        g.fillStyle = `rgba(255,205,110,${a})`;
        for (let i = -5; i <= 5; i++) for (let j = 0; j < 2; j++) g.fillRect(cx + i * 20 * S - 3 * S, by - 30 * S + j * 18 * S, 6 * S, 8 * S);
        for (let i = 0; i < 14; i++) diya(cx - 110 * S + i * 17 * S, by + 16 * S, 0.5 * S, a);
      }
      // the path
      g.strokeStyle = `rgba(150,110,80,${0.25 + lit * 0.4})`; g.lineWidth = 34 * S; g.lineCap = 'round';
      g.beginPath(); for (let u = 0; u <= 1.06; u += 0.02) { const [px, py] = path(u); u ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke();
      g.fillStyle = `rgba(0,0,0,${0.5 * (1 - lit)})`; g.fillRect(0, 0, W, H);
      const next = ds.findIndex((d) => !d.on);
      ds.forEach((d, i) => diya(d.x, d.y, S, d.lit, i === next));
      // Rama (with bow), Sita, Lakshmana
      [[0, '255,214,140', true], [-0.035, '255,180,200', false], [-0.07, '200,220,255', false]].forEach(([off, col, bow]) => {
        const [px, py] = path(clamp(walk + off, 0, 1.06)); walker(px, py, S, col, bow);
      });
    },
    down(x, y) {
      let best = null, bd = 44 * S;
      ds.forEach((d) => { const dd = Math.hypot(d.x - x, d.y - 6 * S - y); if (!d.on && dd < bd) { bd = dd; best = d; } });
      if (!best) return;
      best.on = true; chime(ds.filter((d) => d.on).length - 1); sparkle(best.x + 9 * S, best.y - 14 * S); addLamp();
    },
  };
}

// ---------- 2. Krishna: chase away Narakasura's darkness ----------
function gameKrishna() {
  const need = 12, shades = [], disks = [];
  let cleared = 0, spawned = 0, freed = [];
  const spawn = () => { spawned++; shades.push({ x: rand(0.12, 0.88) * W, y: rand(-0.05, 0.25) * H, r: rand(26, 38) * S, vx: rand(-20, 20) * S, vy: rand(10, 22) * S, ph: rand(0, 6), dead: false }); };
  for (let i = 0; i < 4; i++) spawn();
  let done = false, doneT = 0;
  return {
    tip: 'Tap the shadows to throw Krishna’s chakra',
    update(dt) {
      shades.forEach((s) => {
        s.x += s.vx * dt + Math.sin(T * 1.3 + s.ph) * 12 * S * dt; s.y += s.vy * dt;
        if (s.x < s.r || s.x > W - s.r) s.vx *= -1;
        if (s.y > H * 0.72) { s.y = -s.r; s.x = rand(0.12, 0.88) * W; }
      });
      disks.forEach((d) => { d.t += dt / d.T; if (d.t >= 1 && !d.hit) { d.hit = true; const s = d.s; if (!s.dead) { s.dead = true; cleared++; sparkle(s.x, s.y, 30, '255,220,120', 140); freed.push({ x: s.x, y: s.y, vy: -40 * S, age: 0 }); chime(cleared); addLamp(); } } });
      for (let i = disks.length - 1; i >= 0; i--) if (disks[i].t > 1.25) disks.splice(i, 1);
      for (let i = shades.length - 1; i >= 0; i--) if (shades[i].dead) shades.splice(i, 1);
      while (shades.length < Math.min(4, need - cleared) && spawned < need + 8 && cleared + shades.length < need) spawn();
      freed.forEach((f) => { f.age += dt; f.y += f.vy * dt; });
      freed = freed.filter((f) => f.age < 2.5);
      if (cleared >= need && !done) { done = true; doneT = T; win(); }
      return done && T - doneT > 2;
    },
    draw() {
      sky('#06030f', '#1f0f2a');
      const k = cleared / need;
      // the city below
      g.fillStyle = '#0d0918';
      let x = 0, i = 0; while (x < W) { const w = (40 + ((i * 37) % 50)) * S, h = (50 + ((i * 53) % 90)) * S; g.fillRect(x, H - h - H * 0.12, w - 3, h + H * 0.12); x += w; i++; }
      for (let j = 0; j < 22; j++) { const lx = ((j * 97) % 100) / 100 * W, a = clamp(k * 1.4 - (j / 22) * 0.4, 0, 1); if (a > 0) { g.save(); g.globalCompositeOperation = 'lighter'; glow(lx, H * 0.84, 40 * S, '255,180,70', 0.4 * a); g.restore(); } }
      g.fillStyle = `rgba(0,0,0,${0.45 * (1 - k)})`; g.fillRect(0, 0, W, H);
      shades.forEach((s) => {
        const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 1.6); gr.addColorStop(0, 'rgba(20,0,30,.95)'); gr.addColorStop(0.6, 'rgba(40,5,50,.7)'); gr.addColorStop(1, 'rgba(40,5,50,0)');
        g.fillStyle = gr; g.beginPath(); for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.4) { const rr = s.r * (1.3 + Math.sin(a * 3 + T * 3 + s.ph) * 0.18); g.lineTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr); } g.fill();
        g.fillStyle = 'rgba(255,60,60,.85)'; g.beginPath(); g.arc(s.x - 8 * S, s.y - 3 * S, 2.6 * S, 0, 7); g.arc(s.x + 8 * S, s.y - 3 * S, 2.6 * S, 0, 7); g.fill();
      });
      freed.forEach((f) => { const a = 1 - f.age / 2.5; g.save(); g.globalCompositeOperation = 'lighter'; glow(f.x, f.y, 26 * S, '255,220,140', 0.7 * a); g.restore(); });
      disks.forEach((d) => {
        const u = ease(Math.min(1, d.t)), x0 = W / 2, y0 = H * 0.9, x1 = d.s.x, y1 = d.s.y;
        const px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * 60 * S;
        if (d.t > 1) return;
        g.save(); g.globalCompositeOperation = 'lighter'; glow(px, py, 34 * S, '255,210,90', 0.8); g.restore();
        g.save(); g.translate(px, py); g.rotate(T * 22);
        g.strokeStyle = '#ffd56a'; g.lineWidth = 2.5 * S; g.beginPath(); g.arc(0, 0, 11 * S, 0, 7); g.stroke();
        g.fillStyle = '#ffe9a8'; for (let t = 0; t < 12; t++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(11 * S, -2.5 * S); g.lineTo(16 * S, 0); g.lineTo(11 * S, 2.5 * S); g.fill(); }
        g.restore();
      });
      g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `600 ${14}px system-ui`; g.textAlign = 'center';
      g.fillText(`Darkness cleared ${cleared} / ${need}`, W / 2, H * 0.96);
    },
    down(x, y) {
      let best = null, bd = 70 * S;
      shades.forEach((s) => { const d = Math.hypot(s.x - x, s.y - y); if (!s.targeted && d < bd) { bd = d; best = s; } });
      if (!best) return;
      best.targeted = true; disks.push({ s: best, t: 0, T: 0.45 }); whoosh();
    },
  };
}

// ---------- 3. Lakshmi: clean, rangoli, lamp, footprints ----------
function gameLakshmi(setTip) {
  let phase = 0, done = false, doneT = 0, lampLit = 0, stepT = 0;
  const GX = 24, GY = 18, grid = new Uint8Array(GX * GY);
  let dust = null, dusted = false;
  const floor = () => ({ x: 0, y: H * 0.42, w: W, h: H * 0.58 });
  const rcx = () => W / 2, rcy = () => H * 0.68, rr = () => Math.min(W * 0.38, H * 0.2);
  const petals = [];
  const cols = ['255,80,120', '255,170,40', '120,220,120', '120,160,255'];
  for (let ring = 0; ring < 3; ring++) for (let k = 0; k < (ring === 0 ? 1 : 8); k++) petals.push({ ring, k, on: 0 });
  function makeDust() {
    const f = floor(); dust = document.createElement('canvas'); dust.width = Math.round(W * DPR); dust.height = Math.round(H * DPR);
    const x = dust.getContext('2d'); x.scale(DPR, DPR);
    x.fillStyle = '#5b5047'; x.fillRect(f.x, f.y, f.w, f.h);
    for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(${rand(60, 120) | 0},${rand(50, 100) | 0},${rand(40, 80) | 0},.6)`; x.fillRect(rand(0, W), rand(f.y, H), rand(2, 7), rand(2, 7)); }
    for (let i = 0; i < 12; i++) { x.strokeStyle = 'rgba(200,200,200,.18)'; x.lineWidth = 1; x.beginPath(); const cx = rand(0, W), cy = rand(f.y, H); for (let a = 0; a < 6; a++) { x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); } x.stroke(); }
  }
  makeDust();
  let dragging = false;
  function scrub(x, y) {
    const f = floor(); if (y < f.y - 20) return;
    const dx = dust.getContext('2d'); dx.save(); dx.globalCompositeOperation = 'destination-out';
    dx.beginPath(); dx.arc(x, y, 40 * S, 0, 7); dx.fill(); dx.restore();
    const r = 40 * S;
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { const cx = (i + 0.5) / GX * W, cy = f.y + (j + 0.5) / GY * f.h; if (Math.hypot(cx - x, cy - y) < r) grid[j * GX + i] = 1; }
    if (Math.random() < 0.3) sparkle(x, y, 2, '255,240,210', 40);
  }
  const petalPos = (p) => {
    const R = rr();
    if (p.ring === 0) return [rcx(), rcy(), R * 0.2];
    const a = (p.k / 8) * Math.PI * 2 + (p.ring === 2 ? Math.PI / 8 : 0), d = p.ring === 1 ? R * 0.45 : R * 0.8;
    return [rcx() + Math.cos(a) * d, rcy() + Math.sin(a) * d * 0.62, R * (p.ring === 1 ? 0.2 : 0.17)];
  };
  return {
    tip: 'Swipe to clean the house',
    update(dt) {
      petals.forEach((p) => { if (p.on) p.on = Math.min(1, p.on + dt * 3); });
      if (phase === 0) { const c = grid.reduce((a, b) => a + b, 0) / grid.length; if (c > 0.82 && !dusted) { dusted = true; phase = 1; setTip('Tap every petal to colour the rangoli'); win(); } }
      if (phase === 1 && petals.every((p) => p.on)) { phase = 2; setTip('Light the lamp at the door'); }
      if (phase === 3) { lampLit = Math.min(1, lampLit + dt * 2); stepT += dt; if (stepT > 4.2 && !done) { done = true; doneT = T; win(); } }
      return done && T - doneT > 1.4;
    },
    draw() {
      sky('#07050f', '#22132e');
      const f = floor();
      // house wall and door
      g.fillStyle = '#2a1a2c'; g.fillRect(0, H * 0.14, W, f.y - H * 0.14);
      const dw = Math.min(150 * S, W * 0.36), dx = W / 2 - dw / 2, dy = H * 0.2;
      g.fillStyle = phase === 3 ? `rgba(255,190,90,${0.25 + 0.45 * lampLit})` : '#170d17'; g.fillRect(dx, dy, dw, f.y - dy);
      g.strokeStyle = '#7a4a28'; g.lineWidth = 6 * S; g.strokeRect(dx, dy, dw, f.y - dy);
      // toran (mango leaves and marigolds over the door)
      for (let i = 0; i <= 10; i++) { const x = dx - 10 * S + (i / 10) * (dw + 20 * S), y = dy + 6 * S + Math.sin((i / 10) * Math.PI) * 10 * S; g.fillStyle = i % 2 ? '#ff9b1f' : '#3c8a3c'; g.beginPath(); g.ellipse(x, y, 6 * S, i % 2 ? 6 * S : 10 * S, 0, 0, 7); g.fill(); }
      // floor
      g.fillStyle = '#c9b49a'; g.fillRect(f.x, f.y, f.w, f.h);
      g.strokeStyle = 'rgba(120,95,70,.35)'; g.lineWidth = 1; for (let y = f.y; y < H; y += 34 * S) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      // rangoli
      if (phase >= 1) {
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.5;
        petals.forEach((p) => {
          const [x, y, r] = petalPos(p);
          g.beginPath(); g.ellipse(x, y, r, r * 0.62, 0, 0, 7);
          if (p.on) { g.fillStyle = `rgba(${cols[p.ring === 0 ? 0 : p.ring === 1 ? 1 + (p.k % 2) : 2 + (p.k % 2)]},${p.on})`; g.fill(); }
          g.stroke();
        });
        g.strokeStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(rcx(), rcy(), rr() * 1.02, rr() * 0.64, 0, 0, 7); g.stroke();
      }
      // lamp by the door
      const lx = dx + dw + 28 * S, ly = f.y + 18 * S;
      diya(lx, ly, 1.1 * S, lampLit, phase === 2);
      // Lakshmi's footsteps walking in
      if (phase === 3) {
        for (let i = 0; i < 8; i++) {
          const a = clamp((stepT - 0.4 - i * 0.42) / 0.4, 0, 1); if (!a) continue;
          const y = H * 0.93 - (i / 8) * (H * 0.93 - f.y - 10 * S), x = W / 2 + (i % 2 ? 12 : -12) * S;
          g.save(); g.globalCompositeOperation = 'lighter'; glow(x, y, 22 * S, '255,170,80', 0.4 * a); g.restore();
          g.fillStyle = `rgba(230,60,60,${a})`; g.beginPath(); g.ellipse(x, y, 5 * S, 9 * S, 0, 0, 7); g.fill();
          for (let t = 0; t < 5; t++) { g.beginPath(); g.arc(x - 4 * S + t * 2 * S, y - 11 * S - (t === 0 ? 1.5 * S : 0), 1.4 * S, 0, 7); g.fill(); }
        }
      }
      if (phase === 0) g.drawImage(dust, 0, 0, W, H);
      if (phase < 3) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, W, H); }
    },
    down(x, y) {
      if (phase === 0) { dragging = true; scrub(x, y); return; }
      if (phase === 1) {
        for (const p of petals) { const [px, py, r] = petalPos(p); if (!p.on && Math.hypot((px - x) / r, (py - y) / (r * 0.62)) < 1.25) { p.on = 0.01; chime(petals.filter((q) => q.on).length); sparkle(px, py, 8, '255,200,220', 50); return; } }
        return;
      }
      if (phase === 2) {
        const dw = Math.min(150 * S, W * 0.36), lx = W / 2 + dw / 2 + 28 * S, ly = floor().y + 18 * S;
        if (Math.hypot(lx - x, ly - y) < 60 * S) { phase = 3; setTip('Lakshmi is welcome here'); bell(523, 0.2, 2.5); sparkle(lx + 10 * S, ly - 14 * S, 24); addLamp(); }
      }
    },
    move(x, y) { if (phase === 0 && dragging) scrub(x, y); },
    up() { dragging = false; },
    resize() { if (phase === 0) makeDust(); },
  };
}

// ---------- 4. Bandi Chhor Divas: free the 52 kings ----------
function gameBandi(setTip) {
  const cells = [];
  for (let i = 0; i < 13; i++) cells.push({ open: 0, opened: false });
  const kings = [];
  let freed = 0, phase = 0, phaseT = 0, done = false;
  const layout = () => {
    const cols = W < 520 ? 4 : 5, rows = Math.ceil(13 / cols), cw = Math.min(84 * S, (W - 32) / cols - 8), ch = cw * 0.95;
    const top = H * 0.24, left = (W - cols * (cw + 8)) / 2 + 4;
    return cells.map((c, i) => ({ x: left + (i % cols) * (cw + 8), y: top + Math.floor(i / cols) * (ch + 8), w: cw, h: ch })).concat([{ rows, ch, top }]);
  };
  const gate = () => [W / 2, H * 0.86];
  return {
    tip: 'Tap the cells to set all 52 kings free',
    update(dt) {
      cells.forEach((c) => { if (c.opened) c.open = Math.min(1, c.open + dt * 2.5); });
      const [gx, gy] = gate();
      kings.forEach((k) => {
        if (k.t < 0) { k.t += dt; return; }
        k.t = Math.min(1, k.t + dt * 0.7);
        const u = ease(k.t); k.x = k.x0 + (gx + k.slot - k.x0) * u; k.y = k.y0 + (gy + k.row - k.y0) * u;
      });
      if (phase === 0 && freed >= 52 && kings.every((k) => k.t >= 1)) { phase = 1; phaseT = 0; setTip('Amritsar lights up for the Guru’s return'); win(); }
      if (phase === 1) { phaseT += dt; if (phaseT > 3.6 && !done) done = true; }
      return done;
    },
    draw() {
      if (phase === 0) {
        sky('#05040c', '#191226');
        const L = layout(), meta = L.pop();
        // fort wall
        g.fillStyle = '#3a2c25'; g.fillRect(8, meta.top - 26 * S, W - 16, meta.rows * (meta.ch + 8) + 40 * S);
        for (let x = 8; x < W - 8; x += 26 * S) g.fillRect(x, meta.top - 40 * S, 16 * S, 16 * S);
        L.forEach((r, i) => {
          const c = cells[i];
          g.fillStyle = '#120c12'; g.fillRect(r.x, r.y, r.w, r.h);
          if (!c.opened) for (let k = 0; k < 4; k++) { const kx = r.x + r.w * (0.2 + k * 0.2), ky = r.y + r.h * 0.82; g.fillStyle = '#c9a65a'; g.beginPath(); g.arc(kx, ky - 16 * S * 0.8, 3 * S, 0, 7); g.fill(); g.fillRect(kx - 3.5 * S, ky - 12 * S, 7 * S, 12 * S); g.fillStyle = '#ffd23a'; g.fillRect(kx - 3 * S, ky - 18.5 * S, 6 * S, 2.2 * S); }
          g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
          g.strokeStyle = '#8a8a96'; g.lineWidth = 3 * S;
          for (let b = 1; b < 5; b++) { const bx = r.x + (b / 5) * r.w; g.beginPath(); g.moveTo(bx, r.y - c.open * r.h); g.lineTo(bx, r.y + r.h - c.open * r.h); g.stroke(); }
          g.restore();
          if (!c.opened) { g.save(); g.globalCompositeOperation = 'lighter'; glow(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.7, '255,210,120', 0.08 + 0.06 * Math.sin(T * 4 + i)); g.restore(); }
        });
        // the Guru's cloak with 52 tassels, at the gate
        const [gx, gy] = gate();
        g.save(); g.globalCompositeOperation = 'lighter'; glow(gx, gy - 30 * S, 120 * S, '255,190,90', 0.35); g.restore();
        g.fillStyle = '#e8b04a'; g.beginPath(); g.moveTo(gx - 16 * S, gy - 70 * S); g.lineTo(gx + 16 * S, gy - 70 * S); g.lineTo(gx + 60 * S, gy - 10 * S); g.lineTo(gx - 60 * S, gy - 10 * S); g.fill();
        g.strokeStyle = '#ffd77a'; g.lineWidth = 1.2;
        for (let i = 0; i < 26; i++) { const tx = gx - 58 * S + (i / 25) * 116 * S; g.beginPath(); g.moveTo(tx, gy - 10 * S); g.lineTo(tx, gy - 2 * S); g.stroke(); }
        kings.forEach((k) => { if (k.t < 0) return; g.fillStyle = '#f2ece0'; g.beginPath(); g.arc(k.x, k.y - 10 * S, 2.6 * S, 0, 7); g.fill(); g.fillRect(k.x - 3 * S, k.y - 7 * S, 6 * S, 9 * S); g.fillStyle = '#ffd23a'; g.fillRect(k.x - 2.6 * S, k.y - 14 * S, 5.2 * S, 2 * S); });
        g.fillStyle = 'rgba(255,255,255,.88)'; g.font = '600 15px system-ui'; g.textAlign = 'center';
        g.fillText(`Kings free: ${freed} / 52`, W / 2, H * 0.97);
      } else {
        // Harmandir Sahib (the Golden Temple) lit up, reflected in the sarovar
        sky('#03030a', '#0e0b20');
        const cx = W / 2, wy = H * 0.6, s = Math.min(W / 420, H / 760) * 1.1;
        g.fillStyle = '#0a1426'; g.fillRect(0, wy, W, H - wy);
        const a = clamp(phaseT / 1.5, 0, 1);
        const temple = (flip) => {
          g.save(); g.translate(cx, wy); if (flip) g.scale(1, -0.8);
          g.fillStyle = flip ? `rgba(255,190,70,${0.25 * a})` : `rgb(${150 + 100 * a | 0},${110 + 80 * a | 0},${40 + 20 * a | 0})`;
          g.fillRect(-70 * s, -70 * s, 140 * s, 70 * s);
          g.fillRect(-46 * s, -105 * s, 92 * s, 35 * s);
          g.beginPath(); g.ellipse(0, -112 * s, 26 * s, 22 * s, 0, Math.PI, 0); g.fill();
          g.fillRect(-2 * s, -150 * s, 4 * s, 18 * s);
          [-60, 60].forEach((dx) => { g.beginPath(); g.ellipse(dx * s, -78 * s, 8 * s, 8 * s, 0, Math.PI, 0); g.fill(); });
          g.restore();
        };
        g.save(); g.globalCompositeOperation = 'lighter'; glow(cx, wy - 60 * s, 260 * s, '255,180,60', 0.45 * a); g.restore();
        temple(false); temple(true);
        g.fillStyle = '#e8d8c0'; g.fillRect(0, wy - 4 * s, W, 6 * s);
        const n = 26;
        for (let i = 0; i < n; i++) { const la = clamp((phaseT - 0.6 - (Math.abs(i - n / 2) / n) * 1.6) * 3, 0, 1); diya((i + 0.5) / n * W, wy - 6 * s, 0.55 * s, la); }
      }
    },
    down(x, y) {
      if (phase) return;
      const L = layout(); L.pop();
      L.forEach((r, i) => {
        const c = cells[i];
        if (c.opened || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return;
        c.opened = true; freed += 4; chime(i); addLamp();
        for (let k = 0; k < 4; k++) { const kx = r.x + r.w * (0.2 + k * 0.2), ky = r.y + r.h * 0.82; const j = kings.length, slot = (((j % 26) + (j >= 26 ? 0.5 : 0)) / 26 - 0.5) * 116 * S; kings.push({ x: kx, y: ky, x0: kx, y0: ky, t: -k * 0.12, slot, row: (j >= 26 ? 30 : 16) * S }); }
        sparkle(r.x + r.w / 2, r.y + r.h / 2, 14);
      });
    },
  };
}

// ---------- 5. Mahavira: carry the flame gently ----------
function gameMahavira(setTip) {
  const n = 8, ls = [];
  const place = () => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const u = i / n; pts.push([W * 0.14 + u * W * 0.72, H * 0.72 - Math.sin(u * Math.PI) * H * 0.28 + (i % 2 ? 20 : -20) * S]); }
    return pts;
  };
  for (let i = 0; i <= n; i++) ls.push({ on: i === 0, lit: i === 0 ? 1 : 0 });
  let carry = null, last = null, done = false, doneT = 0, outT = 0;
  return {
    tip: 'Drag the flame from lamp to lamp. Slowly, or it goes out',
    update(dt) {
      ls.forEach((l) => { if (l.on) l.lit = Math.min(1, l.lit + dt * 2.5); });
      if (ls.every((l) => l.on) && !done) { done = true; doneT = T; win(); }
      outT = Math.max(0, outT - dt);
      return done && T - doneT > 2.4;
    },
    draw() {
      sky('#040309', '#130d22');
      const P = place(), k = ls.filter((l) => l.on).length / ls.length;
      g.fillStyle = `rgba(0,0,0,${0.4 * (1 - k)})`; g.fillRect(0, 0, W, H);
      if (done) { const a = clamp((T - doneT) / 1.5, 0, 1); g.save(); g.globalCompositeOperation = 'lighter'; glow(W / 2, H * 0.5, Math.max(W, H) * 0.7, '255,200,110', 0.35 * a); g.restore(); }
      ls.forEach((l, i) => diya(P[i][0], P[i][1], 1.2 * S, l.lit, !l.on && !carry && i === ls.findIndex((q) => !q.on)));
      if (carry) {
        g.save(); g.globalCompositeOperation = 'lighter'; glow(carry.x, carry.y, 46 * S, '255,170,50', 0.6); g.restore();
        const fl = 1 + Math.sin(T * 17) * 0.1 + clamp(carry.v / 900, 0, 0.4);
        g.fillStyle = '#ffb42a'; g.beginPath(); g.moveTo(carry.x, carry.y + 8 * S); g.quadraticCurveTo(carry.x + 8 * S, carry.y, carry.x, carry.y - 16 * S * fl); g.quadraticCurveTo(carry.x - 8 * S, carry.y, carry.x, carry.y + 8 * S); g.fill();
        g.fillStyle = '#fff3c0'; g.beginPath(); g.ellipse(carry.x, carry.y - 1 * S, 2.4 * S, 5 * S, 0, 0, 7); g.fill();
      }
      if (outT > 0) { g.fillStyle = `rgba(255,255,255,${outT})`; g.font = '600 16px system-ui'; g.textAlign = 'center'; g.fillText('Too fast, the flame went out. Gently!', W / 2, H * 0.92); }
    },
    down(x, y) {
      const P = place();
      ls.forEach((l, i) => { if (l.on && Math.hypot(P[i][0] + 10 * S - x, P[i][1] - 12 * S - y) < 50 * S) carry = { x, y, v: 0 }; });
      if (carry) last = { x, y, t: performance.now() };
    },
    move(x, y) {
      if (!carry) return;
      const now = performance.now(), dtm = Math.max(1, now - last.t) / 1000, v = Math.hypot(x - last.x, y - last.y) / dtm / S;
      carry.v = carry.v * 0.7 + v * 0.3; carry.x = x; carry.y = y; last = { x, y, t: now };
      if (carry.v > 1500) { sparkle(x, y, 10, '200,200,200', 40); carry = null; outT = 1.6; bell(220, 0.08, 0.6); return; }
      const P = place();
      ls.forEach((l, i) => { if (!l.on && Math.hypot(P[i][0] + 10 * S - x, P[i][1] - 10 * S - y) < 34 * S) { l.on = true; chime(i); sparkle(P[i][0] + 10 * S, P[i][1] - 14 * S); addLamp(); } });
    },
    up() { carry = null; },
  };
}

// ---------- 6. The five days (DOM cards over a lamp-lit sky) ----------
const DAYS = [
  ['🪙', 'Dhanteras', 'Buy something new, like gold, silver or a pot, and pray for health and wealth.'],
  ['🌅', 'Naraka Chaturdashi', 'Choti Diwali. An early bath and lamps, for Krishna’s win over Narakasura.'],
  ['🪔', 'Lakshmi Puja', 'The main night, under the new moon. Lamps everywhere and prayers to Lakshmi.'],
  ['⛰️', 'Govardhan Puja', 'Krishna lifted Govardhan hill to shelter his village. A feast of food offerings.'],
  ['🤝', 'Bhai Dooj', 'Sisters and brothers pray for each other and share sweets.'],
];
function gameDays() {
  const box = $('days'), placed = [];
  let done = false, doneT = 0;
  box.innerHTML = '';
  const slots = document.createElement('div'); slots.className = 'slots';
  DAYS.forEach((_, i) => { const s = document.createElement('div'); s.className = 'slot'; s.textContent = `Day ${i + 1}`; slots.append(s); });
  box.append(slots);
  const order = DAYS.map((d, i) => i).sort(() => Math.random() - 0.5);
  order.forEach((i) => {
    const [e, name, line] = DAYS[i];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'daycard';
    b.innerHTML = `<span class="e" aria-hidden="true">${e}</span><span><b>${name}</b><small>${line}</small></span>`;
    b.addEventListener('click', () => {
      unlock();
      if (i !== placed.length) { b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong'); bell(196, 0.08, 0.5); return; }
      placed.push(i); b.remove();
      const s = slots.children[i]; s.classList.add('filled'); s.innerHTML = `<span>${e}</span>${name.split(' ')[0]}`;
      chime(i * 2); addLamp();
      if (placed.length === 5) { done = true; doneT = T; win(); }
    });
    box.append(b);
  });
  box.hidden = false;
  return {
    tip: 'Tap the five days in order, first to last',
    update() { if (done && T - doneT > 1.6) { box.hidden = true; return true; } return false; },
    draw() {
      sky('#05040c', '#1d1230');
      const n = 5;
      for (let i = 0; i < n; i++) diya(W * (0.14 + i * 0.18), H * 0.22, 1.1 * S, i < placed.length ? 1 : 0, i === placed.length);
    },
    end() { box.hidden = true; },
  };
}

// ---------- quiz ----------
const QUIZ = [
  ['What does “Deepavali” mean?', ['A row of lamps', 'Festival of colours', 'The new moon', 'Night of sweets'], 0, 'Deep = lamp, avali = row.'],
  ['Who came home to Ayodhya after 14 years away?', ['Krishna', 'Rama', 'Arjuna', 'Bhima'], 1, 'Rama, with Sita and Lakshmana, after defeating Ravana.'],
  ['On which night of the moon is the main night of Diwali?', ['Full moon', 'Half moon', 'New moon', 'Any night'], 2, 'The darkest night of the month of Kartik.'],
  ['Which goddess do families welcome on the main night?', ['Saraswati', 'Durga', 'Parvati', 'Lakshmi'], 3, 'Lakshmi, goddess of wealth and good fortune.'],
  ['What do Sikhs celebrate at Diwali?', ['Bandi Chhor Divas', 'Vaisakhi', 'Lohri', 'Holla Mohalla'], 0, 'Guru Hargobind’s release with the 52 kings.'],
  ['For Jains, Diwali marks…', ['Mahavira’s birth', 'Mahavira’s nirvana', 'The harvest', 'A new temple'], 1, 'His nirvana at Pavapuri, about 2,500 years ago.'],
];
function gameQuiz() {
  const box = $('quiz'); let i = 0, right = 0, done = false, doneT = 0;
  const lit = [];
  function show() {
    const [q, opts, ans, why] = QUIZ[i];
    box.innerHTML = `<div class="q"><p class="n">Question ${i + 1} of ${QUIZ.length}</p><h2></h2><div class="opts"></div><p class="why" hidden></p></div>`;
    box.querySelector('h2').textContent = q;
    const os = box.querySelector('.opts');
    opts.forEach((o, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.textContent = o;
      b.addEventListener('click', () => {
        if (os.dataset.done) return; os.dataset.done = '1'; unlock();
        os.children[ans].classList.add('right');
        if (k === ans) { right++; lit.push(1); chime(i * 2); addLamp(); } else { b.classList.add('no'); lit.push(0); bell(196, 0.08, 0.5); }
        const w = box.querySelector('.why'); w.textContent = why; w.hidden = false;
        setTimeout(() => { i++; if (i < QUIZ.length) show(); else { box.hidden = true; done = true; doneT = T; win(); } }, 1700);
      });
      os.append(b);
    });
  }
  show(); box.hidden = false;
  return {
    tip: '',
    get score() { return right; },
    update() { return done && T - doneT > 0.8; },
    draw() {
      sky('#05040c', '#1d1230');
      QUIZ.forEach((_, k) => diya(W * (0.12 + k * (0.76 / (QUIZ.length - 1))), H * 0.2, 1.1 * S, lit[k] ? 1 : 0));
    },
    end() { box.hidden = true; },
  };
}

// ---------- the story ----------
const CH = [
  { key: 'rama', kicker: 'Story 1 · The Ramayana', title: 'The way home', game: gameRama,
    story: ['Prince <b>Rama</b> was sent to live in the forest for 14 years. There the demon king <b>Ravana</b> took his wife <b>Sita</b>.', 'With his brother <b>Lakshmana</b> and Hanuman’s army, Rama rescued her and defeated Ravana. Now they are walking home to <b>Ayodhya</b> on a moonless night.'],
    fact: ['The people of Ayodhya lit rows of clay lamps to welcome them home.', 'That is the name: <b>Deepavali</b> means <b>“a row of lamps”</b>. In North India this homecoming is the heart of Diwali.'] },
  { key: 'krishna', kicker: 'Story 2 · Krishna', title: 'The night before', game: gameKrishna,
    story: ['The demon king <b>Narakasura</b> spread fear across the land and held <b>16,000 people</b> captive.', '<b>Krishna</b>, with his wife <b>Satyabhama</b>, set out to stop him.'],
    fact: ['Krishna defeated Narakasura and freed every captive.', 'This is <b>Naraka Chaturdashi</b> (Choti Diwali), the day before the main night. In much of South India it is the main day of Diwali: an early oil bath, new clothes and lamps.'] },
  { key: 'lakshmi', kicker: 'Story 3 · Lakshmi', title: 'Welcome home, Lakshmi', game: gameLakshmi,
    story: ['<b>Lakshmi</b> is the goddess of wealth and good fortune.', 'On the main night of Diwali, the <b>new moon</b>, families get their homes ready to welcome her in.'],
    fact: ['A clean home, a <b>rangoli</b> at the door and lamps everywhere: that is how families invite Lakshmi in. Many draw her small footprints walking into the house.', 'Many businesses also start their new account books on this night.'] },
  { key: 'bandi', kicker: 'Story 4 · The Sikh story', title: 'The Day of Liberation', game: gameBandi,
    story: ['In the 1600s, the Mughal emperor <b>Jahangir</b> held the sixth Sikh Guru, <b>Guru Hargobind</b>, in Gwalior Fort, along with <b>52 kings</b>.', 'When the Guru was to be freed, he would not leave without the kings. The emperor said only those who could hold on to the Guru’s cloak could go. So the Guru had a cloak made with <b>52 tassels</b>.'],
    fact: ['Each king held a tassel and walked out free. The Guru reached <b>Amritsar</b> at Diwali, and the Golden Temple was lit with lamps.', 'Sikhs celebrate this as <b>Bandi Chhor Divas</b>, the Day of Liberation.'] },
  { key: 'mahavira', kicker: 'Story 5 · The Jain story', title: 'The light of knowledge', game: gameMahavira,
    story: ['<b>Mahavira</b>, the 24th Jain Tirthankara, taught non-violence and truth.', 'On the night of Diwali, about 2,500 years ago, he reached <b>nirvana</b>: freedom from the cycle of birth and death. His followers said: the light of knowledge has gone, so let us light lamps.'],
    fact: ['Jains celebrate Diwali as the night of <b>Mahavira’s nirvana</b>, and many start their new year the next day.', 'Moving gently fits the story: <b>ahimsa</b>, non-violence, is at the heart of what he taught.'] },
  { key: 'days', kicker: 'Story 6 · The festival', title: 'Five days, not one night', game: gameDays,
    story: ['Diwali is not just one night. It runs for <b>five days</b>, and each day has its own meaning.', 'Put them in order.'],
    fact: ['From <b>Dhanteras</b> to <b>Bhai Dooj</b>: five days of lamps, sweets, family and new beginnings.', 'Places add their own too: <b>Kali Puja</b> in Bengal, <b>Bali Pratipada</b> (King Mahabali’s visit) in Karnataka and Maharashtra, and the <b>new year</b> in Gujarat.'] },
  { key: 'quiz', kicker: 'Last one', title: 'Quick quiz', game: gameQuiz, story: ['Six questions. Every right answer lights a lamp.'] },
];

// ---------- flow ----------
let ci = -1, game = null, playing = false;
const dots = $('dots');
CH.forEach(() => dots.append(document.createElement('i')));
function setTip(t) { const el = $('tip'); el.textContent = t; el.hidden = !t; }
function card({ kicker, title, paras, buttons }) {
  $('kicker').textContent = kicker; $('title').textContent = title;
  $('body').innerHTML = paras.map((p) => `<p>${p}</p>`).join('');
  const a = $('actions'); a.innerHTML = '';
  buttons.forEach(([label, fn, ghost]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (ghost ? ' ghost' : ''); b.textContent = label; b.addEventListener('click', () => { unlock(); fn(); }); a.append(b); });
  $('card').classList.add('show');
  setTimeout(() => a.firstChild?.focus({ preventScroll: true }), 50);
}
const hideCard = () => $('card').classList.remove('show');

function intro() {
  ci = -1; game = null; playing = false; lamps = 0; endFx = -1; addLamp(0); setTip(''); $('where').textContent = 'Why Diwali?';
  [...dots.children].forEach((d) => d.classList.remove('on'));
  card({ kicker: 'A game about Diwali', title: 'Why do people celebrate Diwali?',
    paras: ['Every year, on the darkest night of autumn, more than a billion people light lamps.', 'Different people have different reasons. Play through six stories to find out why, one lamp at a time.', '<span class="muted">About 5 minutes. Sound on.</span>'],
    buttons: [['🪔 Begin', () => chapter(0)]] });
}
function chapter(i) {
  ci = i; const ch = CH[i];
  game = null; playing = false; setTip('');
  $('where').textContent = ch.title;
  [...dots.children].forEach((d, k) => d.classList.toggle('on', k <= i));
  card({ kicker: ch.kicker, title: ch.title, paras: ch.story, buttons: [[ch.key === 'quiz' ? 'Start the quiz' : 'Play', () => { hideCard(); start(); }]] });
}
function start() {
  game = CH[ci].game(setTip); setTip(game.tip); playing = true;
}
function finish() {
  playing = false; setTip(''); game?.end?.();
  const ch = CH[ci];
  if (ch.key === 'quiz') { ending(game.score); return; }
  card({ kicker: ch.kicker, title: 'Why it matters', paras: ch.fact, buttons: [['Next story →', () => chapter(ci + 1)]] });
}
function ending(score) {
  $('where').textContent = 'Happy Diwali';
  card({ kicker: `Quiz: ${score} of ${QUIZ.length} · ${lamps} lamps lit`, title: 'So, why Diwali?',
    paras: ['In every story, <b>light wins over darkness</b>: good over evil, freedom over captivity, knowledge over ignorance.', 'That’s why, on the darkest night, people light lamps. <b>Happy Diwali!</b> 🪔'],
    buttons: [['Share on X', () => postOnX({ path: 'why-diwali/', text: `I lit ${lamps} lamps and learned why people celebrate Diwali 🪔 (quiz: ${score}/${QUIZ.length})` })], ['Play again', intro, true]] });
  endFx = T;
}
let endFx = -1;

// ---------- input ----------
const pt = (e) => [e.clientX, e.clientY];
cv.addEventListener('pointerdown', (e) => { unlock(); if (!playing) return; cv.setPointerCapture(e.pointerId); game.down?.(...pt(e)); });
cv.addEventListener('pointermove', (e) => { if (playing) game.move?.(...pt(e)); });
['pointerup', 'pointercancel'].forEach((ev) => cv.addEventListener(ev, () => { if (playing) game.up?.(); }));

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (game) {
    const over = game.update(dt);
    game.draw();
    if (over && playing) finish();
  } else {
    sky();
    // the ending (and the intro): a row of lamps across the bottom
    const n = Math.max(7, Math.round(W / 60));
    for (let i = 0; i < n; i++) diya((i + 0.5) / n * W, H * 0.3, 1.1 * S, endFx >= 0 ? clamp((T - endFx) * 2 - i * 0.15, 0, 1) : (i === (n >> 1) ? 1 : 0));
  }
  drawParts(dt);
  requestAnimationFrame(frame);
}
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1); S = clamp(Math.min(W / 400, H / 760), 0.75, 1.5);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  game?.resize?.();
}
addEventListener('resize', resize);
resize(); intro(); requestAnimationFrame(frame);
if (location.hash === '#test') window.__wd = { get game() { return game; }, finish, chapter };
