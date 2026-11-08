// Why Diwali?: six stories, each a small game on one canvas, narrated, ending in a fireworks celebration.
// The world is dark and every lamp you light really lights it (a darkness layer with holes cut at each light).
// Deities and the Guru are never drawn as people: Rama's party are glowing walkers, Krishna is his chakra,
// Lakshmi her footprints, Guru Hargobind his cloak, Mahavira a flame.
import { postOnX } from '../../shared/share-x.js';
import { INTRO, CH, DAYS, END } from './story.js';

const $ = (id) => document.getElementById(id);
const cv = $('c'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, S = 1, T = 0;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (u) => 1 - (1 - u) ** 3;
const pick = (a) => a[(Math.random() * a.length) | 0];

// ---------- sound: bell chimes, whoosh, boom, narration ----------
let ac = null, soundOn = true;
function unlock() { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); } if (ac?.state === 'suspended') ac.resume(); }
const live = () => soundOn && ac && ac.state === 'running';
function bell(f = 660, vol = 0.18, dur = 1.6) {
  if (!live()) return;
  const t = ac.currentTime;
  [[1, 1], [2.76, 0.35], [5.4, 0.15]].forEach(([m, v]) => {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.frequency.value = f * m; gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol * v, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / m ** 0.3);
    o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + dur);
  });
}
let noiseBuf = null;
function noise(dur, { f = 1000, f2 = null, type = 'lowpass', vol = 0.3, q = 0.8 } = {}) {
  if (!live()) return;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = ac.currentTime, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), gn = ac.createGain();
  s.buffer = noiseBuf; s.loop = true; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(gn).connect(ac.destination); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
const whoosh = () => noise(0.4, { type: 'bandpass', f: 600, f2: 3000, vol: 0.22 });
const boom = () => { noise(1.6, { f: 900, f2: 60, vol: 0.4 }); noise(0.9, { type: 'highpass', f: 3000, vol: 0.05 }); };
const sweep = () => noise(0.18, { type: 'bandpass', f: 2500, f2: 1200, vol: 0.06 });
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
const chime = (i) => bell(SCALE[i % SCALE.length] * (1 + Math.floor(i / SCALE.length)) / 2, 0.16);
const win = () => [0, 2, 4, 5].forEach((k, i) => setTimeout(() => bell(SCALE[k], 0.14, 2), i * 130));

const voice = new Audio(); voice.preload = 'auto';
function say(name) {
  voice.pause();
  if (!soundOn || !name) return;
  voice.src = `vo/${name}.mp3`; voice.currentTime = 0;
  voice.play().catch(() => {});
}
$('sound').addEventListener('click', () => {
  soundOn = !soundOn; unlock();
  if (!soundOn) voice.pause();
  $('sound').textContent = soundOn ? '🔊' : '🔇'; $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
});

// ---------- lamps counter ----------
let lamps = 0;
function addLamp(n = 1) { lamps += n; $('lamps').textContent = `🪔 ${lamps}`; if (n) { $('lamps').animate?.([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], 300); } }

// ---------- darkness + light ----------
const dark = document.createElement('canvas'), dg = dark.getContext('2d');
let lights = [];
function light(x, y, r, a = 1) { lights.push([x, y, r, a]); }
function applyDark(level) {
  const L = lights; lights = [];
  if (level <= 0) return;
  const k = dark.width / W;
  dg.setTransform(k, 0, 0, k, 0, 0);
  dg.globalCompositeOperation = 'source-over'; dg.clearRect(0, 0, W, H);
  dg.fillStyle = `rgba(2,1,8,${level})`; dg.fillRect(0, 0, W, H);
  dg.globalCompositeOperation = 'destination-out';
  for (const [x, y, r, a] of L) {
    if (r < 1 || a <= 0) continue;
    const gr = dg.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(0.45, `rgba(0,0,0,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    dg.fillStyle = gr; dg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.drawImage(dark, 0, 0, W, H);
}

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
  if (r < 1 || a <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
}
const add = (fn) => { g.save(); g.globalCompositeOperation = 'lighter'; fn(); g.restore(); };
/** A clay diya; lit 0..1 fades the flame in. hint = pulse to say "tap me". */
function diya(x, y, s, lit, hint = false) {
  if (lit > 0) { add(() => glow(x, y - 10 * s, 70 * s, '255,170,50', 0.45 * lit)); light(x, y - 10 * s, 130 * s * lit, lit); }
  if (hint && lit === 0) { const p = 0.5 + 0.5 * Math.sin(T * 5); light(x, y, 46 * s, 0.55 + 0.3 * p); add(() => glow(x, y - 4 * s, 34 * s, '255,210,120', 0.15 + 0.15 * p)); }
  g.fillStyle = '#b5521f'; g.beginPath(); g.moveTo(x - 14 * s, y - 4 * s); g.quadraticCurveTo(x, y + 13 * s, x + 14 * s, y - 4 * s); g.lineTo(x + 18 * s, y - 7 * s); g.quadraticCurveTo(x + 9 * s, y - 2 * s, x, y - 3 * s); g.quadraticCurveTo(x - 9 * s, y - 2 * s, x - 14 * s, y - 4 * s); g.fill();
  g.fillStyle = '#e07b33'; g.beginPath(); g.ellipse(x, y - 4 * s, 14 * s, 3.2 * s, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,220,150,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x - 9 * s, y + 1 * s); g.quadraticCurveTo(x, y + 6 * s, x + 9 * s, y + 1 * s); g.stroke();
  if (lit > 0) {
    const fl = 1 + Math.sin(T * 13 + x) * 0.08, h = 13 * s * lit * fl;
    g.fillStyle = '#ffb42a'; g.beginPath(); g.moveTo(x + 9 * s, y - 6 * s); g.quadraticCurveTo(x + 15 * s, y - 6 * s - h * 0.5, x + 11 * s, y - 6 * s - h); g.quadraticCurveTo(x + 5 * s, y - 6 * s - h * 0.45, x + 9 * s, y - 6 * s); g.fill();
    g.fillStyle = '#fff3c0'; g.beginPath(); g.ellipse(x + 10 * s, y - 8 * s - h * 0.2, 1.8 * s, 3.5 * s * lit, 0, 0, Math.PI * 2); g.fill();
  }
}
// Sparkles, petals and fireworks: one particle list, drawn over the darkness.
const parts = [];
function sparkle(x, y, n = 14, col = '255,200,90', sp = 80, o = {}) {
  for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), v = rand(0.3, 1) * sp * S; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up ?? 30) * S, life: rand(0.5, 1.1) * (o.life ?? 1), age: 0, col, size: o.size ?? 2.4, grav: o.grav ?? 40, drag: o.drag ?? 0.96 }); }
}
function petals(n = 40) {
  const cols = ['255,120,40', '255,200,40', '255,80,120', '255,255,255'];
  for (let i = 0; i < n; i++) parts.push({ x: rand(0, W), y: rand(-H * 0.3, 0), vx: rand(-15, 15) * S, vy: rand(30, 60) * S, life: rand(4, 7), age: 0, col: pick(cols), size: 4, grav: 0, drag: 1, petal: true, ph: rand(0, 6) });
}
const FWC = ['255,80,80', '255,180,40', '255,230,110', '90,255,140', '90,160,255', '200,110,255', '255,100,200', '255,250,235'];
function firework(x, y) {
  const c = pick(FWC), c2 = pick(FWC), n = 80;
  for (let i = 0; i < n; i++) { const u = rand(-1, 1), t = rand(0, Math.PI * 2), r = Math.sqrt(1 - u * u), v = rand(150, 175) * S; parts.push({ x, y, vx: r * Math.cos(t) * v, vy: r * Math.sin(t) * v, life: rand(1.3, 1.9), age: 0, col: i % 3 ? c : c2, size: 2.6, grav: 55, drag: 0.975, trail: true }); }
  flashes.push({ x, y, a: 0.8, c });
  boom();
}
const flashes = [];
function drawParts(dt) {
  add(() => {
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; glow(f.x, f.y, Math.max(W, H) * 0.6, f.c, f.a * 0.35); f.a *= Math.exp(-dt * 4); if (f.a < 0.02) flashes.splice(i, 1); }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.age += dt;
      if (p.age > p.life || p.y > H + 20) { parts.splice(i, 1); continue; }
      const k = p.drag ** (dt * 60);
      p.vx *= k; p.vy = p.vy * k + p.grav * S * dt;
      if (p.petal) p.vx += Math.sin(T * 2 + p.ph) * 20 * S * dt;
      const px = p.x, py = p.y; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = p.petal ? Math.min(1, (p.life - p.age)) : 1 - p.age / p.life;
      if (p.petal) { g.fillStyle = `rgba(${p.col},${0.85 * a})`; g.beginPath(); g.ellipse(p.x, p.y, p.size * S, p.size * 0.55 * S, T * 2 + p.ph, 0, 7); g.fill(); continue; }
      if (p.trail) { g.strokeStyle = `rgba(${p.col},${a})`; g.lineWidth = p.size; g.lineCap = 'round'; g.beginPath(); g.moveTo(px - p.vx * dt * 3, py - p.vy * dt * 3); g.lineTo(p.x, p.y); g.stroke(); }
      else { g.fillStyle = `rgba(${p.col},${a})`; g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
  });
}
// Floating "+1" style words.
const pops = [];
function pop(x, y, text) { pops.push({ x, y, text, age: 0 }); }
function drawPops(dt) {
  g.textAlign = 'center'; g.font = `700 ${Math.round(15 * S)}px system-ui, sans-serif`;
  for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.age += dt; if (p.age > 1.2) { pops.splice(i, 1); continue; } g.fillStyle = `rgba(255,225,150,${1 - p.age / 1.2})`; g.fillText(p.text, p.x, p.y - p.age * 40 * S); }
}
function walker(x, y, s, col, kind) {
  light(x, y - 16 * s, 60 * s, 0.85);
  add(() => glow(x, y - 16 * s, 30 * s, col, 0.55));
  g.fillStyle = `rgb(${col})`;
  g.beginPath(); g.arc(x, y - 27 * s, 4.6 * s, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(x - 5 * s, y - 21 * s); g.lineTo(x + 5 * s, y - 21 * s); g.lineTo(x + 8 * s, y); g.lineTo(x - 8 * s, y); g.fill();
  if (kind === 'bow') { g.strokeStyle = `rgb(${col})`; g.lineWidth = 1.8 * s; g.beginPath(); g.arc(x + 9 * s, y - 15 * s, 12 * s, -1.2, 1.2); g.stroke(); g.beginPath(); g.moveTo(x + 9 * s + Math.cos(-1.2) * 12 * s, y - 15 * s + Math.sin(-1.2) * 12 * s); g.lineTo(x + 9 * s + Math.cos(1.2) * 12 * s, y - 15 * s + Math.sin(1.2) * 12 * s); g.lineWidth = 0.8 * s; g.stroke(); }
  if (kind === 'crown') { g.fillStyle = '#ffd23a'; g.beginPath(); g.moveTo(x - 4 * s, y - 31 * s); g.lineTo(x - 4 * s, y - 35 * s); g.lineTo(x - 1.5 * s, y - 33 * s); g.lineTo(x, y - 36.5 * s); g.lineTo(x + 1.5 * s, y - 33 * s); g.lineTo(x + 4 * s, y - 35 * s); g.lineTo(x + 4 * s, y - 31 * s); g.fill(); }
  if (kind === 'tail') { g.strokeStyle = `rgb(${col})`; g.lineWidth = 1.6 * s; g.beginPath(); g.moveTo(x - 6 * s, y - 4 * s); g.quadraticCurveTo(x - 18 * s, y - 6 * s, x - 15 * s, y - 22 * s); g.stroke(); }
}

// ---------- 1. Rama: light the way home ----------
function gameRama() {
  const n = 12, ds = [];
  const path = (u) => [W / 2 + Math.sin(u * 5.2) * W * 0.2, H * 0.88 - u * H * 0.52];
  for (let i = 0; i < n; i++) { const u = (i + 0.5) / n, [px, py] = path(u); ds.push({ x: px + (i % 2 ? 1 : -1) * 36 * S, y: py, lit: 0, on: false }); }
  let walk = 0, done = false, doneT = 0;
  const crowd = Array.from({ length: 16 }, (_, i) => ({ dx: (i - 7.5) * 15, ph: rand(0, 6), col: pick(['255,200,150', '255,170,200', '200,220,255', '255,230,170']) }));
  return {
    dark: 0.9,
    update(dt) {
      ds.forEach((d) => { if (d.on) d.lit = Math.min(1, d.lit + dt * 3); });
      let k = 0; while (k < n && ds[k].on) k++;
      const target = k === n ? 1.03 : k / n;
      walk += (target - walk) * Math.min(1, dt * 1.3);
      if (k === n && !done) { done = true; doneT = T; win(); setTimeout(() => { petals(60); firework(W * 0.3, H * 0.12); }, 900); setTimeout(() => firework(W * 0.72, H * 0.1), 1500); }
      return done && T - doneT > 4;
    },
    draw() {
      sky('#04030b', '#160f2c');
      // Ayodhya on the hill
      const cx = W / 2, by = H * 0.33, a = done ? clamp((T - doneT) / 1.2, 0, 1) : 0;
      g.fillStyle = '#1a1230';
      g.fillRect(cx - 130 * S, by - 44 * S, 260 * S, 54 * S);
      [[-95, 34], [-45, 28], [0, 60], [45, 28], [95, 34]].forEach(([dx, r]) => { g.beginPath(); g.arc(cx + dx * S, by - 44 * S, r * 0.5 * S, Math.PI, 0); g.fill(); g.fillRect(cx + dx * S - 1.5 * S, by - 44 * S - r * 0.5 * S - 14 * S, 3 * S, 14 * S); g.fillStyle = '#ff7a1f'; g.fillRect(cx + dx * S + 1.5 * S, by - 44 * S - r * 0.5 * S - 14 * S, 8 * S, 5 * S); g.fillStyle = '#1a1230'; });
      g.fillStyle = '#120c22'; g.beginPath(); g.moveTo(0, by + 30 * S); g.quadraticCurveTo(cx, by - 10 * S, W, by + 30 * S); g.lineTo(W, H); g.lineTo(0, H); g.fill();
      if (a > 0) {
        light(cx, by - 20 * S, 340 * S * a, a);
        g.fillStyle = `rgba(255,205,110,${a})`;
        for (let i = -5; i <= 5; i++) for (let j = 0; j < 2; j++) g.fillRect(cx + i * 22 * S - 3 * S, by - 34 * S + j * 18 * S, 6 * S, 9 * S);
        for (let i = 0; i < 15; i++) diya(cx - 120 * S + i * 17 * S, by + 14 * S, 0.5 * S, clamp(a * 3 - i * 0.12, 0, 1));
        crowd.forEach((c) => { const x = cx + c.dx * S, y = by + 40 * S; g.fillStyle = `rgba(${c.col},${a})`; g.beginPath(); g.arc(x, y - 16 * S, 3 * S, 0, 7); g.fill(); g.fillRect(x - 3 * S, y - 13 * S, 6 * S, 13 * S); const wave = Math.sin(T * 8 + c.ph) * 0.6; g.strokeStyle = `rgba(${c.col},${a})`; g.lineWidth = 1.5 * S; g.beginPath(); g.moveTo(x + 2 * S, y - 11 * S); g.lineTo(x + 2 * S + Math.sin(wave) * 7 * S, y - 11 * S - Math.cos(wave) * 7 * S); g.stroke(); });
      }
      // the path
      g.strokeStyle = 'rgba(170,125,85,.55)'; g.lineWidth = 38 * S; g.lineCap = 'round';
      g.beginPath(); for (let u = 0; u <= 1.03; u += 0.02) { const [px, py] = path(u); u ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke();
      // trees along the way
      for (let i = 0; i < 9; i++) { const u = (i + 0.3) / 9, [px, py] = path(u), side = i % 2 ? 1 : -1, tx = px + side * 85 * S; g.fillStyle = '#0f1a14'; g.beginPath(); g.moveTo(tx, py - 46 * S); g.lineTo(tx + 16 * S, py); g.lineTo(tx - 16 * S, py); g.fill(); }
      const next = ds.findIndex((d) => !d.on);
      ds.forEach((d, i) => diya(d.x, d.y, 1.05 * S, d.lit, i === next));
      // Rama (with bow), Sita, Lakshmana, Hanuman
      [[0, '255,214,140', 'bow'], [-0.04, '255,180,200', ''], [-0.08, '200,220,255', 'bow'], [-0.12, '255,190,120', 'tail']].forEach(([off, col, kind]) => {
        const [px, py] = path(clamp(walk + off, 0, 1.03)); walker(px, py, 1.25 * S, col, kind);
      });
    },
    down(x, y) {
      let best = null, bd = 48 * S;
      ds.forEach((d) => { const dd = Math.hypot(d.x - x, d.y - 6 * S - y); if (!d.on && dd < bd) { bd = dd; best = d; } });
      if (!best) return;
      best.on = true; const k = ds.filter((d) => d.on).length;
      chime(k - 1); sparkle(best.x + 9 * S, best.y - 14 * S); addLamp(); pop(best.x, best.y - 30 * S, `${k} / ${n}`);
    },
  };
}

// ---------- 2. Krishna: protect the city's lights ----------
function gameKrishna() {
  const need = 12, shades = [], disks = [];
  let cleared = 0, done = false, doneT = 0, streak = 0, lastHit = 0;
  const city = Array.from({ length: 10 }, (_, i) => ({ u: (i + 0.5) / 10, h: rand(0.1, 0.2), on: true, a: 1 }));
  const spawn = () => shades.push({ x: rand(0.12, 0.88) * W, y: -40 * S, r: rand(26, 36) * S, vx: rand(-25, 25) * S, vy: rand(26, 42) * S * (1 + cleared / 20), ph: rand(0, 6), dead: false, tgt: false });
  let nextSpawn = 0;
  return {
    dark: 0.82,
    update(dt) {
      if (!done && T > nextSpawn && shades.length < 4) { spawn(); nextSpawn = T + rand(0.6, 1.3); }
      shades.forEach((s) => {
        s.x += s.vx * dt + Math.sin(T * 1.3 + s.ph) * 14 * S * dt; s.y += s.vy * dt;
        if (s.x < s.r || s.x > W - s.r) s.vx *= -1;
        if (s.y > H * 0.7 && !s.dead) { // reaches the city: one light goes out
          s.dead = true; streak = 0;
          const lit = city.filter((c) => c.on); if (lit.length) { const c = lit.reduce((a, b) => (Math.abs(b.u * W - s.x) < Math.abs(a.u * W - s.x) ? b : a)); c.on = false; pop(c.u * W, H * 0.7, 'A light went out'); bell(150, 0.1, 0.8); }
        }
      });
      disks.forEach((d) => {
        d.t += dt / d.T;
        if (d.t >= 1 && !d.hit) {
          d.hit = true; const s = d.s;
          if (!s.dead) {
            s.dead = true; cleared++; streak = T - lastHit < 1.5 ? streak + 1 : 1; lastHit = T;
            sparkle(s.x, s.y, 36, '255,220,120', 150); chime(cleared); addLamp(); boom();
            pop(s.x, s.y - 20 * S, streak > 1 ? `${streak}× streak!` : 'Darkness gone');
            const off = city.find((c) => !c.on); if (off) off.on = true;
          }
        }
      });
      for (let i = disks.length - 1; i >= 0; i--) if (disks[i].t > 2) disks.splice(i, 1);
      for (let i = shades.length - 1; i >= 0; i--) if (shades[i].dead) shades.splice(i, 1);
      city.forEach((c) => { c.a += ((c.on ? 1 : 0) - c.a) * Math.min(1, dt * 4); });
      if (cleared >= need && !done) { done = true; doneT = T; win(); city.forEach((c) => (c.on = true)); shades.forEach((s) => { s.dead = true; sparkle(s.x, s.y, 20); }); setTimeout(() => firework(W / 2, H * 0.25), 600); }
      return done && T - doneT > 3;
    },
    draw() {
      sky('#06030f', '#1f0f2a');
      // the city
      city.forEach((c, i) => {
        const w = W / 10, x = c.u * W - w / 2, h = c.h * H + 40 * S, y = H - h;
        g.fillStyle = '#140d22'; g.fillRect(x + 1, y, w - 2, h);
        g.beginPath(); g.arc(c.u * W, y, w * 0.32, Math.PI, 0); g.fill();
        if (c.a > 0.02) {
          light(c.u * W, y + 20 * S, 110 * S * c.a, c.a);
          g.fillStyle = `rgba(255,200,110,${c.a})`;
          for (let wy = y + 12 * S; wy < H - 10 * S; wy += 16 * S) for (let wx = x + 7 * S; wx < x + w - 9 * S; wx += 11 * S) if ((wx * 7 + wy * 3 + i) % 5 < 3) g.fillRect(wx, wy, 4 * S, 6 * S);
          diya(c.u * W, y - w * 0.32 - 2 * S, 0.6 * S, c.a);
        }
      });
      shades.forEach((s) => {
        const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 1.6); gr.addColorStop(0, 'rgba(15,0,25,.98)'); gr.addColorStop(0.6, 'rgba(45,5,55,.75)'); gr.addColorStop(1, 'rgba(45,5,55,0)');
        g.fillStyle = gr; g.beginPath(); for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.35) { const rr = s.r * (1.3 + Math.sin(a * 3 + T * 3 + s.ph) * 0.2); g.lineTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr); } g.fill();
      });
    },
    hud(dt) {
      shades.forEach((s) => { add(() => { glow(s.x - 9 * S, s.y - 3 * S, 8 * S, '255,40,40', 0.8); glow(s.x + 9 * S, s.y - 3 * S, 8 * S, '255,40,40', 0.8); }); });
      disks.forEach((d) => {
        if (d.t > 1.9) return;
        const x0 = W / 2, y0 = H * 0.92, x1 = d.s.x, y1 = d.s.y;
        const u = d.t <= 1 ? ease(d.t) : 1 - ease(d.t - 1), px = x0 + (x1 - x0) * u, py = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * 60 * S;
        d.trail.push([px, py]); if (d.trail.length > 10) d.trail.shift();
        add(() => { d.trail.forEach(([tx, ty], i) => glow(tx, ty, 14 * S * (i / 10), '255,200,80', 0.5 * (i / 10))); glow(px, py, 40 * S, '255,210,90', 0.8); });
        g.save(); g.translate(px, py); g.rotate(T * 24);
        g.strokeStyle = '#ffd56a'; g.lineWidth = 2.5 * S; g.beginPath(); g.arc(0, 0, 12 * S, 0, 7); g.stroke();
        g.fillStyle = '#ffe9a8'; for (let t = 0; t < 12; t++) { g.rotate(Math.PI / 6); g.beginPath(); g.moveTo(12 * S, -2.6 * S); g.lineTo(18 * S, 0); g.lineTo(12 * S, 2.6 * S); g.fill(); }
        g.restore();
      });
      const bar = W - 32, x = 16, y = H - 22 - 6;
      g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(x, y, bar, 6); g.fillStyle = '#ffc23a'; g.fillRect(x, y, bar * cleared / need, 6);
      g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `600 13px system-ui`; g.textAlign = 'left'; g.fillText(`Shadows cleared ${cleared} / ${need}`, x, y - 8);
    },
    down(x, y) {
      let best = null, bd = 75 * S;
      shades.forEach((s) => { const d = Math.hypot(s.x - x, s.y - y); if (!s.tgt && d < bd) { bd = d; best = s; } });
      if (!best) return;
      best.tgt = true; best.vy *= 0.3; disks.push({ s: best, t: 0, T: 0.4, trail: [] }); whoosh();
    },
  };
}

// ---------- 3. Lakshmi: sweep, rangoli, lamp, footprints ----------
function gameLakshmi(setTip) {
  let phase = 0, done = false, doneT = 0, lampLit = 0, stepT = 0;
  const GX = 24, GY = 18, grid = new Uint8Array(GX * GY);
  let dust = null;
  const floorY = () => H * 0.42;
  const rcx = () => W / 2, rcy = () => H * 0.68, rr = () => Math.min(W * 0.4, H * 0.21);
  const pet = [];
  const cols = ['255,70,120', '255,165,30', '90,210,110', '90,150,255'];
  for (let ring = 0; ring < 3; ring++) for (let k = 0; k < (ring === 0 ? 1 : 8); k++) pet.push({ ring, k, on: 0 });
  function makeDust() {
    const fy = floorY(); dust = document.createElement('canvas'); dust.width = Math.round(W * DPR); dust.height = Math.round(H * DPR);
    const x = dust.getContext('2d'); x.scale(DPR, DPR);
    x.fillStyle = '#6b5e52'; x.fillRect(0, fy, W, H - fy);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${rand(70, 130) | 0},${rand(60, 105) | 0},${rand(45, 85) | 0},.65)`; x.fillRect(rand(0, W), rand(fy, H), rand(2, 7), rand(2, 7)); }
    for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(80,60,40,.8)'; x.beginPath(); x.ellipse(rand(0, W), rand(fy + 20, H - 20), rand(6, 14), rand(3, 6), rand(0, 3), 0, 7); x.fill(); }
    for (let i = 0; i < 10; i++) { x.strokeStyle = 'rgba(220,220,220,.2)'; x.lineWidth = 1; x.beginPath(); const cx = rand(0, W), cy = rand(fy, H); for (let a = 0; a < 6; a++) { x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30); } x.stroke(); }
  }
  makeDust();
  let dragging = false, broom = null, swT = 0;
  const cleaned = () => grid.reduce((a, b) => a + b, 0) / grid.length;
  function scrub(x, y) {
    const fy = floorY(); broom = [x, y]; if (y < fy - 20) return;
    const dx = dust.getContext('2d'); dx.save(); dx.globalCompositeOperation = 'destination-out';
    dx.beginPath(); dx.ellipse(x, y, 46 * S, 30 * S, 0, 0, 7); dx.fill(); dx.restore();
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) { const cx = (i + 0.5) / GX * W, cy = fy + (j + 0.5) / GY * (H - fy); if (Math.hypot((cx - x) / 46, (cy - y) / 30) < S) grid[j * GX + i] = 1; }
    if (Math.random() < 0.4) sparkle(x, y, 3, '200,180,150', 50, { life: 0.6 });
    if (T - swT > 0.16) { sweep(); swT = T; }
  }
  const petalPos = (p) => {
    const R = rr();
    if (p.ring === 0) return [rcx(), rcy(), R * 0.2, 0];
    const a = (p.k / 8) * Math.PI * 2 + (p.ring === 2 ? Math.PI / 8 : 0), d = p.ring === 1 ? R * 0.45 : R * 0.8;
    return [rcx() + Math.cos(a) * d, rcy() + Math.sin(a) * d * 0.62, R * (p.ring === 1 ? 0.2 : 0.17), a];
  };
  const lampPos = () => { const dw = Math.min(150 * S, W * 0.36); return [W / 2 + dw / 2 + 30 * S, floorY() + 18 * S]; };
  return {
    dark: 0,
    update(dt) {
      pet.forEach((p) => { if (p.on) p.on = Math.min(1, p.on + dt * 3); });
      if (phase === 0 && cleaned() > 0.8) { phase = 1; setTip('Tap every petal to colour the rangoli'); win(); sparkle(W / 2, H * 0.7, 40, '255,240,200', 160); }
      if (phase === 1 && pet.every((p) => p.on >= 1)) { phase = 2; setTip('Now light the lamp at the door'); }
      if (phase === 3) { lampLit = Math.min(1, lampLit + dt * 2); stepT += dt; if (stepT > 4.4 && !done) { done = true; doneT = T; win(); petals(40); } }
      this.dark = phase === 2 ? 0.55 : phase === 3 ? 0.55 * (1 - clamp(stepT / 3, 0, 1)) : 0;
      return done && T - doneT > 1.8;
    },
    draw() {
      sky('#07050f', '#22132e');
      const fy = floorY();
      g.fillStyle = '#3a2238'; g.fillRect(0, H * 0.14, W, fy - H * 0.14);
      for (let x = 0; x < W; x += 28 * S) { g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(x, H * 0.14, 14 * S, fy - H * 0.14); }
      const dw = Math.min(150 * S, W * 0.36), dx = W / 2 - dw / 2, dy = H * 0.2;
      const inside = phase === 3 ? clamp(stepT / 2, 0, 1) : 0;
      g.fillStyle = '#170d17'; g.fillRect(dx, dy, dw, fy - dy);
      if (inside) { g.fillStyle = `rgba(255,190,90,${0.85 * inside})`; g.fillRect(dx, dy, dw, fy - dy); light(W / 2, (dy + fy) / 2, 260 * S * inside, inside); }
      g.strokeStyle = '#8a5a30'; g.lineWidth = 7 * S; g.strokeRect(dx, dy, dw, fy - dy);
      for (let i = 0; i <= 12; i++) { const x = dx - 12 * S + (i / 12) * (dw + 24 * S), y = dy + 6 * S + Math.sin((i / 12) * Math.PI) * 12 * S; g.fillStyle = i % 2 ? '#ff9b1f' : '#3c8a3c'; g.beginPath(); g.ellipse(x, y, 6 * S, i % 2 ? 6 * S : 10 * S, 0, 0, 7); g.fill(); }
      // floor tiles
      g.fillStyle = '#d6c2a4'; g.fillRect(0, fy, W, H - fy);
      g.strokeStyle = 'rgba(130,100,70,.3)'; g.lineWidth = 1;
      for (let y = fy; y < H; y += 36 * S) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      for (let x = 0; x < W; x += 36 * S) { g.beginPath(); g.moveTo(x, fy); g.lineTo(x, H); g.stroke(); }
      if (phase >= 1) {
        g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.6;
        g.beginPath(); g.ellipse(rcx(), rcy(), rr() * 1.06, rr() * 0.66, 0, 0, 7); g.stroke();
        for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(rcx() + Math.cos(a) * rr() * 1.06, rcy() + Math.sin(a) * rr() * 0.66, 2 * S, 0, 7); g.fill(); }
        const next = pet.find((p) => !p.on);
        pet.forEach((p) => {
          const [x, y, r, a] = petalPos(p);
          g.beginPath(); g.ellipse(x, y, r, r * 0.62, p.ring ? a * 0.15 : 0, 0, 7);
          if (p.on) { const c = cols[p.ring === 0 ? 0 : p.ring === 1 ? 1 + (p.k % 2) : 2 + (p.k % 2)]; g.fillStyle = `rgba(${c},${p.on})`; g.fill(); g.fillStyle = `rgba(255,255,255,${0.5 * p.on})`; g.beginPath(); g.arc(x, y, r * 0.2, 0, 7); g.fill(); }
          else if (p === next) { g.fillStyle = `rgba(255,255,255,${0.12 + 0.1 * Math.sin(T * 6)})`; g.fill(); }
          g.strokeStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(x, y, r, r * 0.62, p.ring ? a * 0.15 : 0, 0, 7); g.stroke();
        });
      }
      const [lx, ly] = lampPos();
      diya(lx, ly, 1.2 * S, lampLit, phase === 2);
      if (phase === 3) {
        for (let i = 0; i < 8; i++) {
          const a = clamp((stepT - 0.4 - i * 0.42) / 0.4, 0, 1); if (!a) continue;
          const y = H * 0.94 - (i / 8) * (H * 0.94 - fy - 10 * S), x = W / 2 + (i % 2 ? 13 : -13) * S;
          light(x, y, 40 * S, a * 0.8);
          add(() => glow(x, y, 24 * S, '255,170,80', 0.45 * a));
          g.fillStyle = `rgba(220,40,50,${a})`; g.beginPath(); g.ellipse(x, y, 5 * S, 9 * S, 0, 0, 7); g.fill();
          for (let t = 0; t < 5; t++) { g.beginPath(); g.arc(x - 4 * S + t * 2 * S, y - 11 * S - (t === 0 ? 1.5 * S : 0), 1.4 * S, 0, 7); g.fill(); }
        }
      }
      if (phase === 0) {
        g.drawImage(dust, 0, 0, W, H);
        if (dragging && broom) { const [bx, by] = broom; g.save(); g.translate(bx, by); g.rotate(-0.5 + Math.sin(T * 20) * 0.15); g.fillStyle = '#c8a24a'; for (let i = -6; i <= 6; i++) { g.fillRect(i * 3 * S, 0, 1.5 * S, 30 * S); } g.fillStyle = '#7a4a28'; g.fillRect(-2 * S, -60 * S, 4 * S, 62 * S); g.fillStyle = '#b5521f'; g.fillRect(-20 * S, -2 * S, 40 * S, 6 * S); g.restore(); }
      }
    },
    hud() {
      if (phase === 0) { const c = cleaned(); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(16, H - 30, W - 32, 6); g.fillStyle = '#ffc23a'; g.fillRect(16, H - 30, (W - 32) * clamp(c / 0.8, 0, 1), 6); }
    },
    down(x, y) {
      if (phase === 0) { dragging = true; scrub(x, y); return; }
      if (phase === 1) {
        for (const p of pet) { const [px, py, r] = petalPos(p); if (!p.on && Math.hypot((px - x) / r, (py - y) / (r * 0.62)) < 1.3) { p.on = 0.01; chime(pet.filter((q) => q.on).length); sparkle(px, py, 10, '255,200,220', 60); return; } }
        return;
      }
      if (phase === 2) {
        const [lx, ly] = lampPos();
        if (Math.hypot(lx - x, ly - y) < 64 * S) { phase = 3; setTip('Lakshmi is welcome here'); bell(523, 0.2, 2.5); sparkle(lx + 10 * S, ly - 14 * S, 30); addLamp(); }
      }
    },
    move(x, y) { if (phase === 0 && dragging) scrub(x, y); },
    up() { dragging = false; broom = null; },
    resize() { if (phase === 0) makeDust(); },
  };
}

// ---------- 4. Bandi Chhor Divas: free the 52 kings ----------
function gameBandi(setTip) {
  const cells = Array.from({ length: 13 }, () => ({ open: 0, opened: false }));
  const kings = [];
  let freed = 0, phase = 0, phaseT = 0, done = false, walkT = 0;
  const layout = () => {
    const cols = W < 520 ? 4 : 5, rows = Math.ceil(13 / cols), cw = Math.min(84 * S, (W - 32) / cols - 8), ch = cw * 0.95;
    const top = H * 0.2, left = (W - cols * (cw + 8)) / 2 + 4;
    return { rows, ch, top, cells: cells.map((c, i) => ({ x: left + (i % cols) * (cw + 8) + (Math.floor(i / cols) === rows - 1 ? ((cols - (13 - (rows - 1) * cols)) * (cw + 8)) / 2 : 0), y: top + Math.floor(i / cols) * (ch + 8), w: cw, h: ch })) };
  };
  const gate = () => [W / 2 + walkT * W * 0.9, H * 0.8];
  return {
    get dark() { return phase === 0 ? 0.6 : phase === 1 ? 0.35 : 0.75 * (1 - clamp(phaseT / 2.5, 0, 1)); },
    update(dt) {
      cells.forEach((c) => { if (c.opened) c.open = Math.min(1, c.open + dt * 2.5); });
      kings.forEach((k) => { if (k.t < 0) { k.t += dt; return; } k.t = Math.min(1, k.t + dt * 0.8); });
      if (phase === 0 && freed >= 52 && kings.every((k) => k.t >= 1)) { phase = 1; setTip('Every king holds a tassel. Walk out free!'); win(); }
      if (phase === 1) { walkT += dt * 0.32; if (walkT > 0.75) { phase = 2; phaseT = 0; setTip('Amritsar lights up for the Guru’s return'); bell(392, 0.2, 3); } }
      if (phase === 2) { phaseT += dt; if (phaseT > 1.6 && phaseT - dt <= 1.6) { firework(W * 0.25, H * 0.2); setTimeout(() => firework(W * 0.75, H * 0.16), 500); } if (phaseT > 4.5 && !done) done = true; }
      return done;
    },
    draw() {
      if (phase < 2) {
        sky('#05040c', '#191226');
        const L = layout();
        g.fillStyle = '#4a372c'; g.fillRect(8, L.top - 26 * S, W - 16, L.rows * (L.ch + 8) + 40 * S);
        for (let x = 8; x < W - 8; x += 26 * S) g.fillRect(x, L.top - 40 * S, 16 * S, 16 * S);
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; for (let y = L.top - 20 * S; y < L.top + L.rows * (L.ch + 8); y += 14 * S) { g.beginPath(); g.moveTo(8, y); g.lineTo(W - 8, y); g.stroke(); }
        // torches
        [0.06, 0.94].forEach((u) => { const x = u * W, y = L.top - 6 * S; light(x, y, 150 * S, 0.9); add(() => glow(x, y, 30 * S, '255,150,40', 0.7 + 0.2 * Math.sin(T * 11 + u * 9))); g.fillStyle = '#ffb42a'; g.beginPath(); g.ellipse(x, y - 4 * S, 4 * S, 8 * S, 0, 0, 7); g.fill(); });
        L.cells.forEach((r, i) => {
          const c = cells[i];
          g.fillStyle = '#120c12'; g.fillRect(r.x, r.y, r.w, r.h);
          if (!c.opened) { light(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.6, 0.3 + 0.15 * Math.sin(T * 3 + i)); for (let k = 0; k < 4; k++) { const kx = r.x + r.w * (0.2 + k * 0.2), ky = r.y + r.h * 0.88; walker(kx, ky, 0.55 * S, '200,180,150', 'crown'); } }
          g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
          g.strokeStyle = '#9a9aa6'; g.lineWidth = 3 * S;
          for (let b = 1; b < 5; b++) { const bx = r.x + (b / 5) * r.w; g.beginPath(); g.moveTo(bx, r.y - c.open * r.h); g.lineTo(bx, r.y + r.h - c.open * r.h); g.stroke(); }
          g.restore();
        });
        // the Guru's cloak with 52 tassels
        const [gx, gy] = gate();
        light(gx, gy - 20 * S, 170 * S, 1);
        add(() => glow(gx, gy - 30 * S, 110 * S, '255,190,90', 0.35));
        g.fillStyle = '#e8b04a'; g.beginPath(); g.moveTo(gx - 18 * S, gy - 76 * S); g.lineTo(gx + 18 * S, gy - 76 * S); g.lineTo(gx + 62 * S, gy - 12 * S); g.lineTo(gx - 62 * S, gy - 12 * S); g.fill();
        g.fillStyle = '#c4862a'; g.fillRect(gx - 62 * S, gy - 16 * S, 124 * S, 4 * S);
        kings.forEach((k, j) => {
          if (k.t < 0) return;
          const tx = gx - 60 * S + ((j % 26) / 25) * 120 * S, row = j >= 26 ? 1 : 0;
          const ex = tx + (row ? 3 * S : 0), ey = gy + (row ? 34 : 16) * S + Math.abs(Math.sin(T * 9 + j)) * (phase === 1 ? 2 * S : 0);
          const u = ease(k.t), x = k.x0 + (ex - k.x0) * u, y = k.y0 + (ey - k.y0) * u;
          if (k.t >= 1) { g.strokeStyle = 'rgba(255,215,120,.85)'; g.lineWidth = 1; g.beginPath(); g.moveTo(tx, gy - 12 * S); g.lineTo(x + 2 * S, y - 9 * S); g.stroke(); }
          walker(x, y, 0.5 * S, '245,236,220', 'crown');
        });
      } else {
        // Harmandir Sahib (the Golden Temple), reflected in the sarovar
        sky('#03030a', '#0e0b20');
        const cx = W / 2, wy = H * 0.58, s = Math.min(W / 420, H / 760) * 1.15, a = clamp(phaseT / 1.5, 0, 1);
        g.fillStyle = '#0a1426'; g.fillRect(0, wy, W, H - wy);
        const temple = (flip) => {
          g.save(); g.translate(cx, wy); if (flip) { g.scale(1, -0.8); g.globalAlpha = 0.35; }
          g.fillStyle = `rgb(${150 + 100 * a | 0},${110 + 80 * a | 0},${40 + 20 * a | 0})`;
          g.fillRect(-72 * s, -72 * s, 144 * s, 72 * s);
          g.fillRect(-46 * s, -108 * s, 92 * s, 36 * s);
          g.beginPath(); g.ellipse(0, -114 * s, 27 * s, 24 * s, 0, Math.PI, 0); g.fill();
          g.fillRect(-2 * s, -154 * s, 4 * s, 18 * s);
          [-64, -32, 32, 64].forEach((dx) => { g.beginPath(); g.ellipse(dx * s, -80 * s, 7 * s, 8 * s, 0, Math.PI, 0); g.fill(); });
          g.fillStyle = `rgba(90,50,10,${0.5})`; for (let i = -3; i <= 3; i++) g.fillRect(i * 18 * s - 4 * s, -56 * s, 8 * s, 18 * s);
          g.restore();
        };
        light(cx, wy - 70 * s, 300 * s * a, a);
        add(() => glow(cx, wy - 60 * s, 260 * s, '255,180,60', 0.45 * a));
        temple(false); temple(true);
        g.fillStyle = '#e8d8c0'; g.fillRect(0, wy - 4 * s, W, 6 * s);
        g.fillStyle = '#d9c9b0'; g.fillRect(-1, wy - 2 * s, W + 2, 3 * s);
        const n = 24;
        for (let i = 0; i < n; i++) { const la = clamp((phaseT - 0.5 - (Math.abs(i - n / 2) / n) * 1.6) * 3, 0, 1); diya((i + 0.5) / n * W, wy - 6 * s, 0.6 * s, la); }
        for (let i = 0; i < 8; i++) { const ripple = Math.sin(T * 2 + i) * 6 * s; add(() => glow(cx + ripple, wy + (20 + i * 22) * s, 60 * s, '255,180,60', 0.12 * a)); }
      }
    },
    hud() {
      if (phase === 0) { g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '700 16px system-ui'; g.textAlign = 'center'; g.fillText(`Kings free: ${freed} / 52`, W / 2, H - 22); }
    },
    down(x, y) {
      if (phase) return;
      const L = layout();
      L.cells.forEach((r, i) => {
        const c = cells[i];
        if (c.opened || x < r.x - 4 || x > r.x + r.w + 4 || y < r.y - 4 || y > r.y + r.h + 4) return;
        c.opened = true; freed += 4; chime(i); addLamp(); pop(r.x + r.w / 2, r.y, `${freed} free`);
        noise(0.25, { type: 'bandpass', f: 1800, f2: 600, vol: 0.12 });
        for (let k = 0; k < 4; k++) kings.push({ x0: r.x + r.w * (0.2 + k * 0.2), y0: r.y + r.h * 0.88, t: -k * 0.12 });
        sparkle(r.x + r.w / 2, r.y + r.h / 2, 16);
      });
    },
  };
}

// ---------- 5. Mahavira: carry the flame gently ----------
function gameMahavira() {
  const n = 8, ls = [];
  const place = () => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const u = i / n; pts.push([W * 0.13 + u * W * 0.74, H * 0.74 - Math.sin(u * Math.PI) * H * 0.3 + (i % 2 ? 22 : -22) * S]); }
    return pts;
  };
  for (let i = 0; i <= n; i++) ls.push({ on: i === 0, lit: i === 0 ? 1 : 0 });
  let carry = null, last = null, done = false, doneT = 0, outT = 0;
  const motes = Array.from({ length: 40 }, () => ({ x: rand(0, 1), y: rand(0, 1), v: rand(0.01, 0.03) }));
  return {
    dark: 0.92,
    update(dt) {
      ls.forEach((l) => { if (l.on) l.lit = Math.min(1, l.lit + dt * 2.5); });
      if (ls.every((l) => l.on) && !done) { done = true; doneT = T; win(); }
      outT = Math.max(0, outT - dt);
      motes.forEach((m) => { m.y -= m.v * dt; if (m.y < 0) m.y = 1; });
      if (done) this.dark = 0.92 * (1 - clamp((T - doneT) / 2, 0, 0.7));
      return done && T - doneT > 3;
    },
    draw() {
      sky('#040309', '#130d22');
      // a quiet temple shape in the background
      g.fillStyle = '#17112a'; const cx = W / 2, by = H * 0.4;
      g.beginPath(); g.moveTo(cx - 40 * S, by); g.lineTo(cx, by - 90 * S); g.lineTo(cx + 40 * S, by); g.fill(); g.fillRect(cx - 70 * S, by, 140 * S, 60 * S);
      if (done) { const a = clamp((T - doneT) / 1.5, 0, 1); light(W / 2, H * 0.5, Math.max(W, H) * 0.8 * a, a); add(() => glow(W / 2, H * 0.5, Math.max(W, H) * 0.7, '255,200,110', 0.25 * a)); }
      const P = place();
      ls.forEach((l, i) => diya(P[i][0], P[i][1], 1.25 * S, l.lit, !l.on && i === ls.findIndex((q) => !q.on)));
      // the flame you carry lights the dark around it
      if (carry) light(carry.x, carry.y, 110 * S, 1);
      // thread of light between lit lamps
      add(() => { g.strokeStyle = 'rgba(255,200,110,.25)'; g.lineWidth = 2; g.beginPath(); let started = false; ls.forEach((l, i) => { if (!l.on) return; const [x, y] = P[i]; started ? g.lineTo(x + 10 * S, y - 14 * S) : g.moveTo(x + 10 * S, y - 14 * S); started = true; }); g.stroke(); });
    },
    hud() {
      motes.forEach((m) => { g.fillStyle = 'rgba(255,220,160,.25)'; g.fillRect(m.x * W, m.y * H, 1.5, 1.5); });
      if (carry) {
        add(() => glow(carry.x, carry.y, 46 * S, '255,170,50', 0.6));
        const fl = 1 + Math.sin(T * 17) * 0.1 + clamp(carry.v / 900, 0, 0.5), lean = clamp(-carry.vx / 1500, -0.6, 0.6);
        g.fillStyle = '#ffb42a'; g.beginPath(); g.moveTo(carry.x, carry.y + 8 * S); g.quadraticCurveTo(carry.x + 9 * S, carry.y, carry.x + lean * 14 * S, carry.y - 18 * S * fl); g.quadraticCurveTo(carry.x - 9 * S, carry.y, carry.x, carry.y + 8 * S); g.fill();
        g.fillStyle = '#fff3c0'; g.beginPath(); g.ellipse(carry.x, carry.y - 1 * S, 2.6 * S, 5.5 * S, 0, 0, 7); g.fill();
        // speed meter: the flame warns before it goes out
        const k = clamp(carry.v / 1400, 0, 1);
        g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(16, H - 30, W - 32, 6);
        g.fillStyle = k > 0.75 ? '#ff6b6b' : k > 0.45 ? '#ffc23a' : '#7be38f'; g.fillRect(16, H - 30, (W - 32) * k, 6);
        g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '600 12px system-ui'; g.textAlign = 'left'; g.fillText(k > 0.75 ? 'Too fast!' : 'Gentle', 16, H - 38);
      }
      if (outT > 0) { g.fillStyle = `rgba(255,255,255,${Math.min(1, outT)})`; g.font = '700 16px system-ui'; g.textAlign = 'center'; g.fillText('Too fast, the flame went out. Gently!', W / 2, H * 0.9); }
      else if (!carry && !done) { const P = place(), i = ls.findIndex((l) => !l.on) - 1, [x, y] = P[Math.max(0, i)]; g.fillStyle = `rgba(255,230,170,${0.6 + 0.3 * Math.sin(T * 4)})`; g.font = '600 13px system-ui'; g.textAlign = 'center'; g.fillText('Pick up the flame here', x + 10 * S, y + 26 * S); }
    },
    down(x, y) {
      const P = place();
      ls.forEach((l, i) => { if (l.on && Math.hypot(P[i][0] + 10 * S - x, P[i][1] - 12 * S - y) < 52 * S) carry = { x, y, v: 0, vx: 0 }; });
      if (carry) { last = { x, y, t: performance.now() }; bell(880, 0.06, 0.6); }
    },
    move(x, y) {
      if (!carry) return;
      const now = performance.now(), dtm = Math.max(4, now - last.t) / 1000, v = Math.hypot(x - last.x, y - last.y) / dtm / S;
      carry.v = carry.v * 0.75 + v * 0.25; carry.vx = carry.vx * 0.75 + ((x - last.x) / dtm) * 0.25; carry.x = x; carry.y = y; last = { x, y, t: now };
      if (carry.v > 1400) { sparkle(x, y, 12, '190,190,190', 40, { up: 60 }); carry = null; outT = 1.8; noise(0.5, { type: 'bandpass', f: 800, f2: 300, vol: 0.12 }); return; }
      const P = place();
      ls.forEach((l, i) => { if (!l.on && Math.hypot(P[i][0] + 10 * S - x, P[i][1] - 10 * S - y) < 36 * S) { l.on = true; chime(i); sparkle(P[i][0] + 10 * S, P[i][1] - 14 * S); addLamp(); } });
    },
    up() { carry = null; },
  };
}

// ---------- 6. The five days ----------
function gameDays() {
  const box = $('days'), placed = [];
  let done = false, doneT = 0;
  box.innerHTML = '';
  const slots = document.createElement('div'); slots.className = 'slots';
  DAYS.forEach((_, i) => { const s = document.createElement('div'); s.className = 'slot'; s.textContent = `Day ${i + 1}`; slots.append(s); });
  box.append(slots);
  DAYS.map((d, i) => i).sort(() => Math.random() - 0.5).forEach((i) => {
    const [e, name, line] = DAYS[i];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'daycard';
    b.innerHTML = `<span class="e" aria-hidden="true">${e}</span><span><b>${name}</b><small>${line}</small></span>`;
    b.addEventListener('click', () => {
      unlock();
      if (i !== placed.length) { b.classList.remove('wrong'); void b.offsetWidth; b.classList.add('wrong'); bell(196, 0.08, 0.5); return; }
      placed.push(i); b.remove();
      const s = slots.children[i]; s.classList.add('filled'); s.innerHTML = `<span>${e}</span>${name.split(' ')[0]}`;
      chime(i * 2); addLamp(); sparkle(W * (0.14 + i * 0.18) + 10 * S, H * 0.2, 20);
      if (placed.length === 5) { done = true; doneT = T; win(); setTimeout(() => firework(W / 2, H * 0.12), 400); }
    });
    box.append(b);
  });
  box.hidden = false;
  return {
    dark: 0.7,
    update() { if (done && T - doneT > 2.2) { box.hidden = true; return true; } return false; },
    draw() {
      sky('#05040c', '#1d1230');
      for (let i = 0; i < 5; i++) diya(W * (0.14 + i * 0.18), H * 0.22, 1.2 * S, i < placed.length ? 1 : 0, i === placed.length);
    },
    end() { box.hidden = true; },
  };
}
const GAMES = { rama: gameRama, krishna: gameKrishna, lakshmi: gameLakshmi, bandi: gameBandi, mahavira: gameMahavira, days: gameDays };

// ---------- flow ----------
let ci = -1, game = null, playing = false, mode = 'intro', endT = 0, nextFw = 0;
const dots = $('dots');
CH.forEach(() => dots.append(document.createElement('i')));
function setTip(t) { const el = $('tip'); el.textContent = t; el.hidden = !t; }
function card({ kicker, title, paras, buttons, vo }) {
  $('kicker').textContent = kicker; $('title').textContent = title;
  $('body').innerHTML = paras.map((p) => `<p>${p}</p>`).join('');
  const a = $('actions'); a.innerHTML = '';
  buttons.forEach(([label, fn, ghost]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (ghost ? ' ghost' : ''); b.textContent = label; b.addEventListener('click', () => { unlock(); fn(); }); a.append(b); });
  $('card').classList.add('show');
  say(vo);
  setTimeout(() => a.firstChild?.focus({ preventScroll: true }), 50);
}
const hideCard = () => $('card').classList.remove('show');

function intro() {
  ci = -1; game = null; playing = false; mode = 'intro'; lamps = 0; addLamp(0); setTip(''); $('where').textContent = 'Why Diwali?';
  [...dots.children].forEach((d) => d.classList.remove('on'));
  card({ ...INTRO, vo: 'intro', paras: [...INTRO.paras, '<span class="muted">About 5 minutes. Turn your sound on: a narrator tells each story.</span>'], buttons: [['🪔 Begin', () => chapter(0)]] });
}
function chapter(i) {
  ci = i; const ch = CH[i];
  game = null; playing = false; mode = 'story'; setTip('');
  $('where').textContent = ch.title;
  [...dots.children].forEach((d, k) => d.classList.toggle('on', k <= i));
  card({ kicker: ch.kicker, title: ch.title, paras: ch.story, vo: `${ch.key}-story`, buttons: [['Play', () => { hideCard(); voice.pause(); start(); }]] });
}
function start() { const ch = CH[ci]; game = GAMES[ch.key](setTip); setTip(ch.tip); playing = true; mode = 'game'; }
function finish() {
  playing = false; setTip(''); game?.end?.();
  const ch = CH[ci], last = ci === CH.length - 1;
  card({ kicker: ch.kicker, title: 'Why it matters', paras: ch.fact, vo: `${ch.key}-fact`, buttons: [[last ? '🎆 Celebrate' : 'Next story →', () => (last ? ending() : chapter(ci + 1))]] });
}
function ending() {
  game = null; mode = 'end'; endT = T; nextFw = T + 0.3;
  $('where').textContent = 'Happy Diwali';
  card({ kicker: `${lamps} lamps lit · tap the sky for fireworks`, title: END.title, paras: END.paras, vo: 'end',
    buttons: [['Share on X', () => postOnX({ path: 'why-diwali/', text: `I lit ${lamps} lamps and found out why people celebrate Diwali 🪔` })], ['Play again', intro, true]] });
}

// ---------- input ----------
const pt = (e) => [e.clientX, e.clientY];
cv.addEventListener('pointerdown', (e) => {
  unlock();
  if (mode === 'end') { firework(e.clientX, Math.min(e.clientY, H * 0.6)); return; }
  if (!playing) return; cv.setPointerCapture(e.pointerId); game.down?.(...pt(e));
});
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
    applyDark(game.dark ?? 0);
    game.hud?.(dt);
    if (over && playing) finish();
  } else {
    sky();
    // skyline with a row of lamps; the intro lights them one by one, the ending lights them all
    g.fillStyle = '#0d0918';
    let x = 0, i = 0; while (x < W) { const w = (36 + ((i * 37) % 44)) * S, h = (60 + ((i * 53) % 110)) * S; g.fillRect(x, H * 0.62 - h * 0.5, w - 2, H); x += w; i++; }
    const n = Math.max(7, Math.round(W / 56));
    for (let k = 0; k < n; k++) {
      const lit = mode === 'end' ? clamp((T - endT) * 2 - k * 0.12, 0, 1) : clamp(((T * 1.2) % (n + 3)) - Math.abs(k - (n - 1) / 2) * 1.0, 0, 1);
      diya((k + 0.5) / n * W, H * 0.3, 1.1 * S, mode === 'intro' || mode === 'end' ? lit : (k === (n >> 1) ? 1 : 0));
    }
    applyDark(0.75);
    if (mode === 'end' && T > nextFw) { firework(rand(0.15, 0.85) * W, rand(0.08, 0.3) * H); nextFw = T + rand(0.5, 1.2); }
  }
  drawParts(dt);
  drawPops(dt);
  requestAnimationFrame(frame);
}
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1); S = clamp(Math.min(W / 400, H / 760), 0.75, 1.5);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  dark.width = Math.max(1, Math.round(W / 2)); dark.height = Math.max(1, Math.round(H / 2));
  game?.resize?.();
}
addEventListener('resize', resize);
resize(); intro(); requestAnimationFrame(frame);
if (location.hash === '#test') window.__wd = { get game() { return game; }, finish, chapter, ending };
