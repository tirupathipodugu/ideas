// Live Kit: the shared camera + tracking + three.js layer behind the live camera toys
// (Portal Palm, Head World, Mini Me, Pet Cloud). One file so every app gets the same
// pixel-space scene over a mirrored selfie video, MediaPipe hands / pose / face, particles,
// synthesized sound, light matching and a one-tap recorder.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export { THREE };

export const Q = new URLSearchParams(location.search);
export const DEBUG = Q.has('debug');
const MP = new URL('../get-ready-with-me/vendor/mediapipe/', import.meta.url).href;
export const $ = (s) => document.querySelector(s);
export const video = $('#cam'), glCanvas = $('#gl'), overlay = $('#overlay'), octx = overlay.getContext('2d');
export const MIRROR = Q.has('video') ? Q.get('mirror') === '1' : true;
if (!MIRROR) video.classList.add('nomirror');

// ---------- helpers ----------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
export function hsl(h, s, l) { const c = new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l); return [c.r, c.g, c.b]; }
let toastT = 0;
export function toast(msg, secs = 2.2) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); toastT = secs; }

export class OneEuro { // smooths a 2D point: steady when still, quick when moving
  constructor(minCut = 1.4, beta = 0.006) { this.mc = minCut; this.b = beta; this.x = null; }
  f(p, t) {
    if (!this.x || t - this.t > 0.5) { this.x = { ...p }; this.dx = { x: 0, y: 0 }; this.t = t; return { ...p }; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const a = (c) => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    const dx = { x: (p.x - this.x.x) / dt, y: (p.y - this.x.y) / dt };
    this.dx = { x: lerp(this.dx.x, dx.x, a(1)), y: lerp(this.dx.y, dx.y, a(1)) };
    const ax = a(this.mc + this.b * Math.hypot(this.dx.x, this.dx.y));
    this.x = { ...p, x: lerp(this.x.x, p.x, ax), y: lerp(this.x.y, p.y, ax) };
    return { ...this.x };
  }
}
const filt = {};
export const F = (k, p, t, mc, b) => (filt[k] ??= new OneEuro(mc, b)).f(p, t);

// ---------- renderer / scene (orthographic, 1 unit = 1 CSS px, y up) ----------
export const S = { W: innerWidth, H: innerHeight, t: 0 };
export const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true, preserveDrawingBuffer: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(S.W, S.H, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
export const scene = new THREE.Scene();
export const cam = new THREE.OrthographicCamera(0, S.W, S.H, 0, -5000, 5000);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
export const hemi = new THREE.HemisphereLight(0xfff4e6, 0x6b6470, 1.1); scene.add(hemi);
export const keyLight = new THREE.DirectionalLight(0xfff1dd, 2.2); keyLight.position.set(-0.6, 1, 1.1); scene.add(keyLight);
export const rimLight = new THREE.DirectionalLight(0xcfe4ff, 1.4); rimLight.position.set(0.8, 0.6, -1); scene.add(rimLight);
const resizers = [];
export const onResize = (f) => resizers.push(f);
function resize() {
  S.W = innerWidth; S.H = innerHeight; renderer.setSize(S.W, S.H, false);
  cam.right = S.W; cam.top = S.H; cam.updateProjectionMatrix();
  overlay.width = S.W; overlay.height = S.H; resizers.forEach((f) => f());
}
addEventListener('resize', resize); overlay.width = S.W; overlay.height = S.H;
/** screen px point (y down) → scene position */
/** additive light that does not punch the canvas alpha (premultiplied canvas over the video) */
export const GLOW_BLEND = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
export const toW = (p, z = 0, out = new THREE.Vector3()) => out.set(p.x, S.H - p.y, z);

// ---------- textures ----------
export function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const radialTex = (stops, size = 128) => canvasTex(size, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
export const TEX = {
  glow: radialTex([[0, 'rgba(255,250,230,1)'], [0.25, 'rgba(255,214,140,.55)'], [1, 'rgba(255,190,90,0)']]),
  white: radialTex([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]),
  shadow: radialTex([[0, 'rgba(0,0,0,.55)'], [0.55, 'rgba(0,0,0,.25)'], [1, 'rgba(0,0,0,0)']]),
  star: canvasTex(128, (g, s) => {
    g.translate(s / 2, s / 2); g.globalCompositeOperation = 'lighter';
    for (const [len, w, rot] of [[62, 5, 0], [62, 5, Math.PI / 2], [34, 3, Math.PI / 4], [34, 3, -Math.PI / 4]]) {
      g.save(); g.rotate(rot); const gr = g.createLinearGradient(-len, 0, len, 0);
      gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, 'rgba(255,255,245,1)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, len, w, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }),
};

// ---------- particles: screen-space points with life, drag, gravity, growth ----------
export class Particles {
  constructor(max, blending = THREE.AdditiveBlending, { soft = 1, order = 20 } = {}) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.c = new Float32Array(max * 4); this.s = new Float32Array(max);
    this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.L = new Float32Array(max);
    this.a0 = new Float32Array(max); this.s0 = new Float32Array(max); this.g = new Float32Array(max); this.grow = new Float32Array(max); this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('col', new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { pr: { value: renderer.getPixelRatio() }, soft: { value: soft } }, transparent: true, depthWrite: false, depthTest: false, blending,
      vertexShader: 'attribute vec4 col;attribute float size;uniform float pr;varying vec4 vc;void main(){vc=col;gl_PointSize=size*pr;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform float soft;varying vec4 vc;void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,.5-.5*soft,d);gl_FragColor=vec4(vc.rgb,vc.a*a*(soft>.9?a:1.));}',
    });
    this.pts = new THREE.Points(geo, mat); this.pts.frustumCulled = false; this.pts.renderOrder = order; scene.add(this.pts);
    this.onDie = null;
  }
  emit(x, y, vx, vy, life, size, r, g, b, a = 1, grav = 0, grow = 0, drag = 1.6) { // px, y down; grav px/s² downward
    if (this.n >= this.max) return -1; const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = S.H - y; this.p[i * 3 + 2] = 900;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = -vy;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a;
    this.life[i] = 0; this.L[i] = life; this.a0[i] = a; this.s0[i] = size; this.s[i] = size; this.g[i] = grav; this.grow[i] = grow; this.drag[i] = drag;
    return i;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.L[i]) { this.onDie?.(this.p[i * 3], S.H - this.p[i * 3 + 1], i); this.kill(i); i--; continue; }
      const k = this.life[i] / this.L[i], dr = 1 - this.drag[i] * dt;
      this.v[i * 3 + 1] -= this.g[i] * dt; this.v[i * 3] *= dr; this.v[i * 3 + 1] *= dr;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.c[i * 4 + 3] = this.a0[i] * (1 - k) * Math.min(1, this.life[i] * 12);
      this.s[i] = this.s0[i] * (1 + this.grow[i] * k);
    }
    this.geo.setDrawRange(0, this.n);
    for (const k of ['position', 'col', 'size']) this.geo.attributes[k].needsUpdate = true;
  }
  kill(i) {
    const j = --this.n; if (i === j) return;
    for (const [arr, w] of [[this.p, 3], [this.v, 3], [this.c, 4]]) for (let k = 0; k < w; k++) arr[i * w + k] = arr[j * w + k];
    for (const arr of [this.s, this.life, this.L, this.a0, this.s0, this.g, this.grow, this.drag]) arr[i] = arr[j];
  }
}
export const glitter = new Particles(3000, THREE.AdditiveBlending);
export const dust = new Particles(800, THREE.NormalBlending);
export function burst(x, y, size, n = 90, hue = null) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(1.5, 5) * size, c = hue == null ? [1, rand(0.8, 1), rand(0.5, 0.85)] : hsl(hue + rand(-30, 30), 0.9, 0.7);
    glitter.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.5, 1.1), size * rand(0.08, 0.2), ...c, 1, -size * 2.5);
  }
}
export function puff(x, y, size, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = rand(-0.4, Math.PI + 0.4), sp = rand(0.6, 1.6) * size;
    dust.emit(x + Math.cos(a) * size * 0.1, y, Math.cos(a) * sp, -Math.abs(Math.sin(a)) * sp * 0.35, rand(0.35, 0.7), size * rand(0.25, 0.45), 1, 0.98, 0.95, 0.45, 0, 1.6);
  }
}

// ---------- sound (synthesized, no files) ----------
export const AC = new (window.AudioContext || window.webkitAudioContext)();
export const master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
const recDest = AC.createMediaStreamDestination(); master.connect(recDest);
export const audio = { on: true };
export function tone(f0, f1, dur, type = 'sine', vol = 0.12, delay = 0) {
  if (!audio.on || AC.state !== 'running') return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
export function noise(dur, f0, f1, vol = 0.15, { type = 'bandpass', q = 1.2, attack = 0, delay = 0 } = {}) {
  if (!audio.on || AC.state !== 'running') return;
  const t = AC.currentTime + delay, n = Math.floor(AC.sampleRate * dur), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = b; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); } else g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t);
}
/** a looping filtered-noise bed (rain, portal hum); returns {set(vol, freq)} */
export function loopNoise(freq = 800, type = 'lowpass') {
  const n = AC.sampleRate * 2, b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = b; s.loop = true; f.type = type; f.frequency.value = freq; g.gain.value = 0;
  s.connect(f).connect(g).connect(master); s.start();
  return { set(vol, fr) { const t = AC.currentTime; g.gain.setTargetAtTime(audio.on ? vol : 0, t, 0.08); if (fr) f.frequency.setTargetAtTime(fr, t, 0.1); } };
}
export function hum(freq = 70) {
  const o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain();
  o.type = 'sawtooth'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 1.5; g.gain.value = 0;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
  o.connect(f); o2.connect(f); f.connect(g).connect(master); o.start(); o2.start();
  return { set(vol, fr) { const t = AC.currentTime; g.gain.setTargetAtTime(audio.on ? vol : 0, t, 0.1); if (fr) { o.frequency.setTargetAtTime(fr, t, 0.2); o2.frequency.setTargetAtTime(fr * 1.5, t, 0.2); } } };
}

// ---------- tracking ----------
export const T = {
  body: { ok: false, seen: -9 }, hands: [], face: { ok: false, seen: -9, bs: {} }, scale: 140,
};
function toScreen(l) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720, s = Math.max(S.W / vw, S.H / vh);
  const ox = (S.W - vw * s) / 2, oy = (S.H - vh * s) / 2;
  const x = ox + l.x * vw * s;
  return { x: MIRROR ? S.W - x : x, y: oy + l.y * vh * s, v: l.visibility ?? 1 };
}
/** px rectangle of the video frame on screen, for sampling camera pixels */
export function videoRect() {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720, s = Math.max(S.W / vw, S.H / vh);
  return { vw, vh, s, ox: (S.W - vw * s) / 2, oy: (S.H - vh * s) / 2 };
}
const upOf = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; let n = { x: dy / L, y: -dx / L }; if (n.y > 0) n = { x: -n.x, y: -n.y }; return n; };
const add = (a, v, k) => ({ x: a.x + v.x * k, y: a.y + v.y * k });

function readPose(lm, t) {
  const L = lm.map(toScreen), v = (i) => L[i].v > 0.5, B = T.body;
  if (!v(11) || !v(12)) { B.ok = false; return; }
  const rightIsLeft = L[11].x > L[12].x; // which landmark is on the right of the screen
  const R = rightIsLeft ? { sh: 11, el: 13, wr: 15 } : { sh: 12, el: 14, wr: 16 };
  const Lf = rightIsLeft ? { sh: 12, el: 14, wr: 16 } : { sh: 11, el: 13, wr: 15 };
  const sR = L[R.sh], sL = L[Lf.sh], sw = dist(sR, sL);
  const dn = { x: (sR.x - sL.x) / sw, y: (sR.y - sL.y) / sw }, up = upOf(sL, sR), ang = Math.atan2(dn.y, dn.x);
  Object.assign(B, { sw, up, dn, ang, raw: L });
  B.seatR = F('seatR', { ...add(add(sR, up, 0.12 * sw), dn, -0.08 * sw), ang }, t);
  B.seatL = F('seatL', { ...add(add(sL, up, 0.12 * sw), dn, 0.08 * sw), ang }, t);
  B.neck = F('neck', { ...add({ x: (sR.x + sL.x) / 2, y: (sR.y + sL.y) / 2 }, up, 0.05 * sw), ang }, t);
  const arm = (A, k) => v(A.el) && v(A.wr) ? {
    sh: F(k + 'sh', { ...L[A.sh] }, t), el: F(k + 'el', { ...L[A.el] }, t), wr: F(k + 'wr', { ...L[A.wr] }, t),
  } : null;
  B.armR = arm(R, 'aR'); B.armL = arm(Lf, 'aL');
  B.ok = true; B.seen = t;
  T.scale = lerp(T.scale, clamp(0.45 * sw, 60, S.H * 0.4), 0.2);
}
function readHands(res, t) {
  const out = [];
  (res.landmarks || []).forEach((lm) => {
    const L = lm.map(toScreen), d = (a, b) => dist(L[a], L[b]);
    const fing = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([tip, pip]) => d(tip, 0) > d(pip, 0) * 1.12), ext = fing.filter(Boolean).length;
    let side = { x: L[17].x - L[5].x, y: L[17].y - L[5].y }; if (side.x < 0) side = { x: -side.x, y: -side.y };
    const hl = d(9, 0) || 1, hup = { x: (L[9].x - L[0].x) / hl, y: (L[9].y - L[0].y) / hl };
    const c = { x: (L[0].x + L[5].x + L[9].x + L[17].x) / 4, y: (L[0].y + L[5].y + L[9].y + L[17].y) / 4 };
    // how "face-on" the palm is: projected palm area vs its length² (flat-to-camera ≈ 0.5+)
    const area = Math.abs((L[5].x - L[0].x) * (L[17].y - L[0].y) - (L[17].x - L[0].x) * (L[5].y - L[0].y)) / 2;
    out.push({ L, ext, fing, hup, pw: d(5, 17), hl, raw: c, wrist: L[0], tip: L[12], ang: Math.atan2(side.y, side.x), flat: area / (hl * hl) });
  });
  out.sort((a, b) => a.raw.x - b.raw.x);
  out.forEach((h, i) => {
    h.seat = F('hand' + i, { ...h.raw, ang: h.ang }, t);
    h.size = F('hsz' + i, { x: h.pw, y: h.hl }, t);
    // the palm's own axes on screen: across the knuckles (5→17) and wrist → middle knuckle (0→9)
    h.ax = F('hax' + i, { x: h.L[17].x - h.L[5].x, y: h.L[17].y - h.L[5].y }, t);
    h.ay = F('hay' + i, { x: h.L[9].x - h.L[0].x, y: h.L[9].y - h.L[0].y }, t);
    // pointing: index out, the other three curled (not a fist, not an open hand)
    h.point = !!h.fing && h.fing[0] && !h.fing[1] && !h.fing[2] && !h.fing[3];
    h.open = h.ext >= 3; h.closed = h.ext <= 1 && !h.point;
    h.tip8 = F('htip' + i, { x: h.L[8].x, y: h.L[8].y }, t);
    // a point just above the palm, along the fingers (where things hover)
    h.above = F('habv' + i, { x: h.seat.x + h.hup.x * h.hl * 0.55, y: h.seat.y + h.hup.y * h.hl * 0.55 }, t);
  });
  T.hands.length = 0; T.hands.push(...out);
}
function readFace(res, t) {
  const lm = res.faceLandmarks?.[0], Fc = T.face;
  if (!lm) { Fc.ok = false; return; }
  const L = lm.map(toScreen); Fc.L = L;
  const l = L[234], r = L[454]; const sl = l.x < r.x ? l : r, sr = l.x < r.x ? r : l; // screen left / right cheek
  const w = dist(sl, sr), top = L[10], chin = L[152];
  const roll = Math.atan2(sr.y - sl.y, sr.x - sl.x);
  const up = { x: (top.x - chin.x) / dist(top, chin), y: (top.y - chin.y) / dist(top, chin) };
  const fw = F('fw', { x: w, y: dist(top, chin) }, t); Fc.w = fw.x; Fc.h = fw.y;
  Fc.roll = F('froll', { x: roll, y: 0 }, t, 2.5, 0.02).x;
  Fc.up = up;
  Fc.center = F('fc', { x: (sl.x + sr.x) / 2, y: (top.y + chin.y) / 2 }, t);
  Fc.top = F('ftop', { x: top.x + up.x * 0.42 * Fc.h, y: top.y + up.y * 0.42 * Fc.h }, t, 2.2, 0.01);
  Fc.chin = { ...chin };
  // yaw / pitch from the nose against the face box (robust and mirror-safe)
  const nose = L[1], midEye = { x: (L[33].x + L[263].x) / 2, y: (L[33].y + L[263].y) / 2 };
  Fc.yaw = F('fyaw', { x: ((nose.x - (sl.x + sr.x) / 2) / w) * 2.2, y: 0 }, t, 2, 0.02).x;
  const pitchRaw = (nose.y - midEye.y) / Math.max(1, chin.y - midEye.y);
  Fc.pitch = F('fpitch', { x: pitchRaw, y: 0 }, t, 3, 0.02).x;
  const bs = {}; for (const c of res.faceBlendshapes?.[0]?.categories || []) bs[c.categoryName] = c.score; Fc.bs = bs;
  Fc.ok = true; Fc.seen = t;
  if (!T.body.ok) T.scale = lerp(T.scale, clamp(0.75 * w, 60, S.H * 0.4), 0.2);
}

let vision = null, models = {}, lastVT = -1, frameN = 0, lastTs = 0;
async function initTracking(need) {
  vision = await import(MP + 'vision_bundle.js');
  const fs = { wasmLoaderPath: MP + 'wasm/vision_wasm_internal.js', wasmBinaryPath: MP + 'wasm/vision_wasm_internal.wasm' };
  const mk = async (Cls, file, extra) => {
    try { return await Cls.createFromOptions(fs, { baseOptions: { modelAssetPath: MP + file, delegate: 'GPU' }, runningMode: 'VIDEO', ...extra }); }
    catch { return Cls.createFromOptions(fs, { baseOptions: { modelAssetPath: MP + file, delegate: 'CPU' }, runningMode: 'VIDEO', ...extra }); }
  };
  const jobs = [];
  if (need.hands) jobs.push(mk(vision.HandLandmarker, 'hand_landmarker.task', { numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }).then((m) => (models.hands = m)));
  if (need.pose) jobs.push(mk(vision.PoseLandmarker, 'pose_landmarker.task', { numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }).then((m) => (models.pose = m)));
  if (need.face) jobs.push(mk(vision.FaceLandmarker, 'face_landmarker.task', { numFaces: 1, outputFaceBlendshapes: true }).then((m) => (models.face = m)));
  await Promise.all(jobs);
}
function track(now) {
  if (window.__freeze || video.readyState < 2 || video.currentTime === lastVT) return false;
  lastVT = video.currentTime; frameN++;
  const ts = Math.max(lastTs + 1, now); lastTs = ts; const t = now / 1000;
  try {
    if (models.hands) readHands(models.hands.detectForVideo(video, ts), t);
    // stagger the heavier models so a phone keeps its frame rate
    if (models.face && (!models.pose || frameN % 2 === 1)) readFace(models.face.detectForVideo(video, ts), t);
    if (models.pose && frameN % 2 === 0) {
      const r = models.pose.detectForVideo(video, ts); if (r.landmarks?.[0]) readPose(r.landmarks[0], t); else T.body.ok = false;
    }
  } catch (e) { console.warn(e); }
  return true;
}
function drawDebug() {
  octx.clearRect(0, 0, S.W, S.H);
  const dot = (p, c, r = 5) => { if (!p) return; octx.fillStyle = c; octx.beginPath(); octx.arc(p.x, p.y, r, 0, 7); octx.fill(); };
  const B = T.body; if (B.ok) { for (const k of ['seatR', 'seatL', 'neck']) dot(B[k], '#0f0'); for (const a of [B.armR, B.armL]) if (a) { dot(a.el, '#0ff'); dot(a.wr, '#0ff'); } }
  for (const h of T.hands) { dot(h.seat, h.open ? '#ff0' : h.closed ? '#f00' : '#fa0', 8); dot(h.above, '#fff', 4); }
  if (T.face.ok) { dot(T.face.top, '#f0f', 7); dot(T.face.center, '#f0f', 4); }
}

// ---------- light matching: tint the 3D lights to the room ----------
const probe = document.createElement('canvas'); probe.width = probe.height = 16; const pctx = probe.getContext('2d', { willReadFrequently: true });
let probeT = 0; export const room = { lum: 0.5, tint: new THREE.Color(1, 1, 1) };
function matchLight(dt) {
  probeT -= dt; if (probeT > 0 || video.readyState < 2) return; probeT = 0.5;
  pctx.drawImage(video, 0, 0, 16, 16); const d = pctx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4; r /= n * 255; g /= n * 255; b /= n * 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, m = Math.max(r, g, b, 1e-3);
  room.lum = lum; room.tint.setRGB(lerp(1, r / m, 0.45), lerp(1, g / m, 0.45), lerp(1, b / m, 0.45));
  hemi.color.copy(room.tint); keyLight.color.copy(room.tint).lerp(new THREE.Color(1, 0.96, 0.9), 0.5);
  const k = clamp(0.55 + lum * 1.3, 0.6, 1.5); hemi.intensity = 1.1 * k; keyLight.intensity = 2.2 * k;
  renderer.toneMappingExposure = clamp(0.85 + lum * 0.5, 0.85, 1.2);
}

// ---------- recording: video + 3D + vignette, with mic and effects audio ----------
let rec = null, recCtx = null, recCanvas = null, micStream = null;
export const fx2d = []; // extra 2D layers apps draw into the recording (fn(ctx, w, h))
function composite() {
  const c = recCanvas, x = recCtx, cw = c.width, ch = c.height, vw = video.videoWidth, vh = video.videoHeight, s = Math.max(cw / vw, ch / vh);
  x.save(); x.filter = 'contrast(1.06) saturate(1.08)';
  if (MIRROR) { x.translate(cw, 0); x.scale(-1, 1); }
  x.drawImage(video, (cw - vw * s) / 2, (ch - vh * s) / 2, vw * s, vh * s); x.restore();
  for (const f of fx2d) f(x, cw, ch, 'under');
  x.drawImage(glCanvas, 0, 0, cw, ch);
  for (const f of fx2d) f(x, cw, ch, 'over');
  const g = x.createRadialGradient(cw / 2, ch * 0.45, Math.min(cw, ch) * 0.35, cw / 2, ch * 0.45, Math.max(cw, ch) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); x.fillStyle = g; x.fillRect(0, 0, cw, ch);
  if (!$('#bars').classList.contains('off')) { x.fillStyle = '#000'; x.fillRect(0, 0, cw, ch * 0.11); x.fillRect(0, ch * 0.89, cw, ch * 0.11); }
}
function toggleRecord(name) {
  const btn = $('#record');
  if (rec) { rec.stop(); return; }
  recCanvas = document.createElement('canvas'); recCanvas.width = glCanvas.width; recCanvas.height = glCanvas.height; recCtx = recCanvas.getContext('2d');
  const stream = recCanvas.captureStream(30);
  if (micStream && !micStream._wired) { AC.createMediaStreamSource(micStream).connect(recDest); micStream._wired = true; }
  recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((m) => window.MediaRecorder?.isTypeSupported(m));
  if (!mime) { toast('Recording is not supported in this browser'); return; }
  const chunks = []; rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
    rec = null; btn.setAttribute('aria-pressed', 'false'); btn.innerHTML = '<span>⏺</span>Record'; $('#rec-dot').classList.add('off'); toast('Saved your clip');
  };
  rec.start(500); btn.setAttribute('aria-pressed', 'true'); btn.innerHTML = '<span>⏹</span>Stop'; $('#rec-dot').classList.remove('off');
}

async function startCamera() {
  if (Q.has('video')) { video.src = Q.get('video'); video.loop = true; video.muted = true; await video.play(); return; }
  const v = { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
  try { const s = await navigator.mediaDevices.getUserMedia({ video: v, audio: true }); micStream = new MediaStream(s.getAudioTracks()); video.srcObject = new MediaStream(s.getVideoTracks()); }
  catch { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: v }); }
  await video.play();
}

// ---------- boot: wire the shared buttons, start camera + models, run the loop ----------
/**
 * app = { name, need:{hands,pose,face}, load?:async()=>void, start():void, update(dt, fresh):void, command?(c), hello? }
 */
export function boot(app) {
  let started = false, last = performance.now();
  const step = (dt, fresh) => {
    S.t += dt;
    app.update(dt, fresh);
    glitter.update(dt); dust.update(dt);
    if (toastT > 0 && (toastT -= dt) <= 0) $('#toast').classList.remove('on');
  };
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    let fresh = false;
    if (started) { fresh = track(now); matchLight(dt); if (DEBUG && fresh) drawDebug(); step(dt, fresh); }
    renderer.render(scene, cam);
    if (rec) composite();
    requestAnimationFrame(frame);
  }
  $('#start').addEventListener('click', async () => {
    const st = $('#status'); AC.resume();
    try {
      st.textContent = 'Starting camera…'; await startCamera();
      st.textContent = app.loading || 'Getting ready…'; await Promise.all([app.load?.(), initTracking(app.need)]);
    } catch (e) { console.error(e); st.textContent = 'Could not start: ' + (e.message || e) + '. Allow camera access and reload.'; return; }
    $('#intro').remove(); $('#bar').classList.remove('hidden');
    app.start(); started = true;
    window.__core = {
      T, S, app,
      tick(sec) { for (let t = 0; t < sec; t += 1 / 30) step(1 / 30, true); renderer.render(scene, cam); },
      fakeHands(list) { // [[x, y, open | 'point', size?]]
        T.hands.length = 0;
        for (let [x, y, open, sz = 70] of list) {
          const p = { x, y, ang: 0 }, L = Array.from({ length: 21 }, () => ({ x, y }));
          const point = open === 'point'; if (point) open = false;
          T.hands.push({ L, seat: p, raw: p, open, closed: !open && !point, point, tip8: { x, y: y - sz * 1.3 }, ext: open ? 4 : 0, tip: { x, y: y - sz * 1.3 }, wrist: { x, y: y + sz * 0.8 }, hup: { x: 0, y: -1 }, pw: sz, hl: sz * 1.1, size: { x: sz, y: sz * 1.1 }, ax: { x: sz, y: 0 }, ay: { x: 0, y: -sz * 1.1 }, above: { x, y: y - sz * 0.6 }, ang: 0, flat: 0.5 });
        }
      },
    };
  });
  const acts = $('#acts'); if (acts) acts.addEventListener('click', (e) => { const b = e.target.closest('button[data-cmd]'); if (b) { AC.resume(); app.command?.(b.dataset.cmd); } });
  $('#sound')?.addEventListener('click', (e) => {
    audio.on = !audio.on; AC.resume(); const b = e.currentTarget; b.setAttribute('aria-pressed', String(audio.on)); b.innerHTML = `<span>${audio.on ? '🔊' : '🔇'}</span>Sound ${audio.on ? 'on' : 'off'}`;
    app.onSound?.(audio.on);
  });
  $('#cinema')?.addEventListener('click', (e) => {
    const on = $('#bars').classList.toggle('off') === false, b = e.currentTarget; b.setAttribute('aria-pressed', String(on)); b.innerHTML = `<span>🎬</span>Cinema ${on ? 'on' : 'off'}`;
  });
  $('#record')?.addEventListener('click', () => toggleRecord(app.name));
  requestAnimationFrame(frame);
}
