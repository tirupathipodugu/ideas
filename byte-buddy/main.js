// Byte Buddy: a tiny rigged 3D buddy composited live over the selfie camera.
// MediaPipe Pose + Hands give the body anchors (shoulders, head, ears, arms, palms);
// Byte moves between them with baked Blender clips (walk, run, jump, slide, hang, catch...)
// while the root motion (arcs, paths, flips, squash) is driven here.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');
const N_CLONES = Math.min(200, +Q.get('n') || 100);
const MP = new URL('../get-ready-with-me/vendor/mediapipe/', import.meta.url).href;
const $ = (s) => document.querySelector(s);
const video = $('#cam'), glCanvas = $('#gl'), dbg = $('#overlay'), dctx = dbg.getContext('2d');
const MIRROR = Q.has('video') ? Q.get('mirror') === '1' : true;
if (!MIRROR) video.classList.add('nomirror');

// ---------- small helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const P = (x, y, ang = 0) => ({ x, y, ang });
const normAng = (a) => { while (a > Math.PI / 2) a -= Math.PI; while (a < -Math.PI / 2) a += Math.PI; return a; };
let toastT = 0;
function toast(msg, secs = 2.2) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); toastT = secs; }

class OneEuro { // smooths a 2D point, light on slow jitter, quick on fast moves
  constructor(minCut = 1.4, beta = 0.006) { this.mc = minCut; this.b = beta; this.x = null; }
  f(p, t) {
    if (!this.x || t - this.t > 0.5) { this.x = { ...p }; this.dx = { x: 0, y: 0 }; this.t = t; return { ...p }; }
    const dt = Math.max(1e-3, t - this.t); this.t = t;
    const a = (c) => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    const ad = a(1.0);
    const dx = { x: (p.x - this.x.x) / dt, y: (p.y - this.x.y) / dt };
    this.dx = { x: lerp(this.dx.x, dx.x, ad), y: lerp(this.dx.y, dx.y, ad) };
    const c = this.mc + this.b * Math.hypot(this.dx.x, this.dx.y), ax = a(c);
    this.x = { x: lerp(this.x.x, p.x, ax), y: lerp(this.x.y, p.y, ax) };
    return { ...this.x, ang: p.ang };
  }
}

// ---------- renderer / scene ----------
let W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(0, W, H, 0, -5000, 5000);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const hemi = new THREE.HemisphereLight(0xfff4e6, 0x6b6470, 1.1); scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1dd, 2.2); key.position.set(-0.6, 1, 1.1); scene.add(key);
const rim = new THREE.DirectionalLight(0xcfe4ff, 1.6); rim.position.set(0.8, 0.6, -1); scene.add(rim);
addEventListener('resize', () => {
  W = innerWidth; H = innerHeight; renderer.setSize(W, H, false);
  cam.right = W; cam.top = H; cam.updateProjectionMatrix();
  dbg.width = W; dbg.height = H;
});
dbg.width = W; dbg.height = H;

function radialTex(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function starTex() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d');
  g.translate(s / 2, s / 2); g.globalCompositeOperation = 'lighter';
  for (const [len, w, rot] of [[62, 5, 0], [62, 5, Math.PI / 2], [34, 3, Math.PI / 4], [34, 3, -Math.PI / 4]]) {
    g.save(); g.rotate(rot);
    const gr = g.createLinearGradient(-len, 0, len, 0);
    gr.addColorStop(0, 'rgba(255,240,200,0)'); gr.addColorStop(0.5, 'rgba(255,255,245,1)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, len, w, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {
  glow: radialTex([[0, 'rgba(255,250,230,1)'], [0.25, 'rgba(255,214,140,.55)'], [1, 'rgba(255,190,90,0)']]),
  shadow: radialTex([[0, 'rgba(0,0,0,.55)'], [0.55, 'rgba(0,0,0,.25)'], [1, 'rgba(0,0,0,0)']]),
  star: starTex(),
};

// ---------- particles (sparkle dust, landing puffs, bursts) ----------
class Particles {
  constructor(max, blending) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.c = new Float32Array(max * 4); this.s = new Float32Array(max);
    this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.L = new Float32Array(max);
    this.a0 = new Float32Array(max); this.s0 = new Float32Array(max); this.g = new Float32Array(max); this.grow = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('col', new THREE.BufferAttribute(this.c, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { pr: { value: renderer.getPixelRatio() } }, transparent: true, depthWrite: false, depthTest: false, blending,
      vertexShader: 'attribute vec4 col;attribute float size;uniform float pr;varying vec4 vc;void main(){vc=col;gl_PointSize=size*pr;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec4 vc;void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,d);gl_FragColor=vec4(vc.rgb,vc.a*a*a);}',
    });
    this.pts = new THREE.Points(geo, mat); this.pts.frustumCulled = false; this.pts.renderOrder = 20; scene.add(this.pts);
  }
  emit(x, y, vx, vy, life, size, r, g, b, a = 1, grav = 0, grow = 0) { // screen px coords, y down
    if (this.n >= this.max) return; const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = H - y; this.p[i * 3 + 2] = 900;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = -vy;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a;
    this.life[i] = 0; this.L[i] = life; this.a0[i] = a; this.s0[i] = size; this.s[i] = size; this.g[i] = grav; this.grow[i] = grow;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.L[i]) { this.kill(i); i--; continue; }
      const k = this.life[i] / this.L[i];
      this.v[i * 3 + 1] -= this.g[i] * dt; this.v[i * 3] *= 1 - 1.6 * dt; this.v[i * 3 + 1] *= 1 - 1.6 * dt;
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
    for (const arr of [this.s, this.life, this.L, this.a0, this.s0, this.g, this.grow]) arr[i] = arr[j];
  }
}
const glitter = new Particles(2500, THREE.AdditiveBlending);
const dust = new Particles(600, THREE.NormalBlending);
function puff(x, y, size, n = 14) {
  for (let i = 0; i < n; i++) {
    const a = rand(-0.4, Math.PI + 0.4), sp = rand(0.6, 1.6) * size;
    dust.emit(x + Math.cos(a) * size * 0.1, y, Math.cos(a) * sp, -Math.abs(Math.sin(a)) * sp * 0.35, rand(0.35, 0.7), size * rand(0.25, 0.45), 1, 0.98, 0.95, 0.45, 0, 1.6);
  }
}
function burst(x, y, size, n = 90, hue = null) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(1.5, 5) * size, c = hue == null ? [1, rand(0.8, 1), rand(0.5, 0.85)] : hsl(hue + rand(-30, 30), 0.9, 0.7);
    glitter.emit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.5, 1.1), size * rand(0.08, 0.2), ...c, 1, -size * 2.5);
  }
}
function hsl(h, s, l) { const c = new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l); return [c.r, c.g, c.b]; }

// ---------- sound (synthesised, no files) ----------
const AC = new (window.AudioContext || window.webkitAudioContext)();
const master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination);
const recDest = AC.createMediaStreamDestination(); master.connect(recDest);
let soundOn = true, lastPop = 0;
function tone(f0, f1, dur, type = 'sine', vol = 0.12, delay = 0) {
  if (!soundOn || AC.state !== 'running') return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, f0, f1, vol = 0.15) {
  if (!soundOn || AC.state !== 'running') return;
  const t = AC.currentTime, n = AC.sampleRate * dur, b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = b; f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t);
}
const sfx = {
  jump: () => tone(260, 720, 0.2, 'sine', 0.1),
  land: () => { noise(0.09, 700, 300, 0.22); tone(140, 90, 0.08, 'sine', 0.12); },
  chime: () => [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, f * 1.01, 0.5, 'triangle', 0.06, i * 0.06)),
  shimmer: () => [1568, 2093, 2637].forEach((f, i) => tone(f, f * 1.02, 0.7, 'sine', 0.03, i * 0.09)),
  swish: () => noise(0.7, 600, 3200, 0.1),
  step: () => noise(0.03, 2400, 1800, 0.04),
  flash: () => { tone(220, 1760, 0.6, 'sawtooth', 0.04); noise(0.5, 400, 4000, 0.08); },
  pop: () => { const n = performance.now(); if (n - lastPop < 35) return; lastPop = n; const f = rand(500, 1100); tone(f, f * 1.8, 0.07, 'sine', 0.05); },
  whoa: () => tone(500, 260, 0.35, 'triangle', 0.06),
};

// ---------- model ----------
let TEMPLATE = null, CLIPS = {}, BASE_MAT = null;
const CONTACT = { sit_idle: -0.37, ride: -0.37, slide: -0.37, hang: 0.15 }; // model-space y that touches the anchor
const LOOP = new Set(['sit_idle', 'stand_idle', 'walk', 'run', 'jump_air', 'cheer', 'slide', 'hang', 'peek', 'hide', 'ride']);

class Buddy {
  constructor({ main = false, hue = null, sizeMul = 1 } = {}) {
    this.main = main; this.sizeMul = sizeMul; this.hue = hue;
    this.root = new THREE.Group(); this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.model = skClone(TEMPLATE); this.pivot.add(this.model);
    const tint = hue == null ? new THREE.Color(1, 1, 1) : new THREE.Color().setHSL(hue / 360, 0.75, 0.6);
    this.model.traverse((o) => {
      if (!o.isMesh) return; o.frustumCulled = false;
      o.material = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
        if (m.name === 'Bulb') {
          const b = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: hue == null ? 0xffcc66 : new THREE.Color().setHSL(((hue + 180) % 360) / 360, 0.9, 0.6), emissiveIntensity: 1.2, roughness: 0.3 });
          this.bulb = b; return b;
        }
        const b = BASE_MAT.clone(); b.color = tint; this.body = b; return b;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    this.antenna = this.model.getObjectByName('antenna');
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: this.bulb ? this.bulb.emissive : 0xffcc66 }));
    this.glow.scale.setScalar(0.35); this.glow.position.set(0, 0.12, 0);
    if (this.antenna) this.antenna.add(this.glow);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TEX.shadow, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    this.shadow.scale.set(0.62, 0.16, 1); this.shadow.renderOrder = -1; this.root.add(this.shadow);
    this.mixer = new THREE.AnimationMixer(this.model); this.acts = {};
    for (const [n, c] of Object.entries(CLIPS)) {
      const a = this.mixer.clipAction(c); a.setLoop(LOOP.has(n) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; this.acts[n] = a;
    }
    this.pos = { x: W * 0.7, y: H * 0.85 }; this.ang = 0; this.yaw = 0; this.yawT = 0; this.spin = 0;
    this.sq = 1; this.sqV = 0; this.contact = -0.5; this.grounded = 0; this.groundT = 0;
    this.glowLv = 1; this.glowT = 1; this.pop = main ? 1 : 0; this.popT = 1; this.q = []; this.step = null; this.cur = null;
    this.at = 'floor'; this.dead = false; this.disco = 0;
    scene.add(this.root);
  }
  get bh() { return BH * this.sizeMul; }
  play(name, { fade = 0.22, speed = 1, from = 0, sync = false } = {}) {
    const a = this.acts[name]; if (!a) return;
    if (this.cur === a && !from) { a.timeScale = speed; return; }
    a.reset(); a.timeScale = speed; a.time = sync ? Math.random() * a.getClip().duration : from; a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, fade, false);
    this.cur = a; this.curName = name; this.contactT = CONTACT[name] ?? -0.5;
  }
  run(steps) { this.q = steps; this.step = null; }
  get busy() { return !!(this.step && !this.step.rest) || this.q.length > 0; }
  update(dt) {
    if (!this.step && this.q.length) { this.step = this.q.shift(); this.step.start?.(this); }
    if (this.step && this.step.update(this, dt)) this.step = null;
    this.mixer.update(dt);
    // spring squash
    this.sqV += (-(this.sq - 1) * 260 - this.sqV * 16) * dt; this.sq += this.sqV * dt;
    this.contact = lerp(this.contact, this.contactT ?? -0.5, Math.min(1, dt * 7));
    this.yaw = lerp(this.yaw, this.yawT, Math.min(1, dt * 7));
    this.pop = lerp(this.pop, this.popT, Math.min(1, dt * 9));
    this.groundT = this.grounded; this.shadow.material.opacity = lerp(this.shadow.material.opacity, this.noShadow ? 0 : this.grounded * 0.9, Math.min(1, dt * 10));
    this.glowLv = lerp(this.glowLv, this.glowT, Math.min(1, dt * 5)); this.glowT = lerp(this.glowT, 1, Math.min(1, dt * 0.8));
    if (this.disco > 0) { this.disco -= dt; this.bulb.emissive.setHSL((performance.now() / 600) % 1, 1, 0.6); this.glow.material.color.copy(this.bulb.emissive); }
    if (this.bulb) this.bulb.emissiveIntensity = 0.6 + this.glowLv * 0.9;
    this.glow.material.opacity = clamp(0.25 + this.glowLv * 0.18, 0, 1); this.glow.scale.setScalar(0.28 + this.glowLv * 0.05);
    const s = this.bh * this.pop, sy = this.sq, sx = 1 / Math.sqrt(Math.max(0.3, sy));
    this.root.position.set(this.pos.x, H - this.pos.y, (this.pos.y / H) * 400 + (this.main ? 8 : 0));
    this.root.scale.set(s * sx, s * sy, s);
    this.root.rotation.z = -this.ang;
    this.pivot.position.y = -this.contact;
    this.pivot.rotation.set(0, this.yaw, this.spin);
  }
  squash(v) { this.sqV += v; }
  dispose() {
    scene.remove(this.root); this.dead = true;
    this.model.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => m.dispose()); });
    this.glow.material.dispose(); this.shadow.material.dispose(); this.shadow.geometry.dispose();
  }
}

// ---------- tracking → body anchors ----------
let pose = null, hands = null, BH = 140;
const body = { ok: false, t: -9, seen: -9 }, handState = []; // handState: [{seat, open, closed, tip, ...}]
const filt = {};
const F = (k, p, t) => (filt[k] ??= new OneEuro()).f(p, t);
function toScreen(l) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720, s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  const x = ox + l.x * vw * s;
  return { x: MIRROR ? W - x : x, y: oy + l.y * vh * s, v: l.visibility ?? 1 };
}
function upOf(a, b) { // unit normal of the line a→b that points up the screen
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  let n = { x: dy / L, y: -dx / L }; if (n.y > 0) n = { x: -n.x, y: -n.y }; return n;
}
const add = (a, v, k) => ({ x: a.x + v.x * k, y: a.y + v.y * k });

function readPose(lm, t) {
  const L = lm.map(toScreen);
  const v = (i) => L[i].v > 0.5;
  if (!v(11) || !v(12)) { body.ok = false; return; }
  // Byte lives on the shoulder that is on the right of the screen
  const rightIsLeft = L[11].x > L[12].x;
  const B = rightIsLeft ? { sh: 11, el: 13, wr: 15, ear: 7, eye: 2 } : { sh: 12, el: 14, wr: 16, ear: 8, eye: 5 };
  const O = rightIsLeft ? { sh: 12, el: 14, wr: 16, ear: 8, eye: 5 } : { sh: 11, el: 13, wr: 15, ear: 7, eye: 2 };
  const sR = L[B.sh], sL = L[O.sh], sw = dist(sR, sL);
  const dn = { x: (sR.x - sL.x) / sw, y: (sR.y - sL.y) / sw }, up = upOf(sL, sR), ang = Math.atan2(dn.y, dn.x);
  body.sw = sw; body.up = up; body.dn = dn; body.ang = ang;
  body.seatB = F('seatB', { ...add(add(sR, up, 0.12 * sw), dn, -0.08 * sw), ang }, t);
  body.seatO = F('seatO', { ...add(add(sL, up, 0.12 * sw), dn, 0.1 * sw), ang }, t);
  // head
  const eR = L[B.ear], eL = L[O.ear], earsOk = v(B.ear) && v(O.ear);
  const nose = L[0];
  let ed = earsOk ? dist(eR, eL) : 0.36 * sw, mid = earsOk ? { x: (eR.x + eL.x) / 2, y: (eR.y + eL.y) / 2 } : nose;
  const hUp = earsOk ? upOf(eL, eR) : up, hAng = earsOk ? Math.atan2(eR.y - eL.y, eR.x - eL.x) : ang;
  const hdn = earsOk ? { x: (eR.x - eL.x) / ed, y: (eR.y - eL.y) / ed } : dn;
  body.ed = ed; body.hUp = hUp; body.hdn = hdn;
  body.head = F('head', { ...add(mid, hUp, 0.92 * ed), ang: hAng }, t);
  body.earB = F('earB', { ...add(add(earsOk ? eR : add(mid, hdn, ed / 2), hdn, 0.12 * ed), hUp, -0.12 * ed), ang: 0 }, t);
  body.earSide = F('earSide', { ...add(add(mid, hdn, 0.58 * ed), hUp, 0.2 * ed), ang: hAng + 0.9 }, t);
  body.peek = F('peek', { ...add(add(sL, up, 0.13 * sw), dn, 0.22 * sw), ang }, t);
  // arms (surface points just above the joints)
  const arm = (S, key) => {
    if (!v(S.el) || !v(S.wr)) return null;
    const sh = L[S.sh], el = L[S.el], wr = L[S.wr];
    const u1 = upOf(sh, el), u2 = upOf(el, wr);
    return {
      el: F(key + 'el', { ...add(el, u1, 0.09 * sw), ang: 0 }, t),
      wr: F(key + 'wr', { ...add(wr, u2, 0.07 * sw), ang: 0 }, t),
      hand: F(key + 'hd', { ...add(add(wr, { x: (wr.x - el.x) / dist(wr, el), y: (wr.y - el.y) / dist(wr, el) }, 0.18 * sw), u2, 0.05 * sw), ang: normAng(Math.atan2(wr.y - el.y, wr.x - el.x)) }, t),
      rawWr: wr, rawSh: sh,
    };
  };
  body.armB = arm(B, 'aB'); body.armO = arm(O, 'aO');
  body.ok = true; body.seen = t;
  BH = lerp(BH, clamp(0.45 * sw, 70, H * 0.4), 0.2);
}
function readHands(res, t) {
  const out = [];
  (res.landmarks || []).forEach((lm, i) => {
    const L = lm.map(toScreen);
    const d = (a, b) => dist(L[a], L[b]);
    let ext = 0; for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (d(tip, 0) > d(pip, 0) * 1.12) ext++;
    const wrist = L[0], m9 = L[9];
    let side = { x: L[17].x - L[5].x, y: L[17].y - L[5].y }; if (side.x < 0) side = { x: -side.x, y: -side.y };
    const ang = Math.atan2(side.y, side.x);
    const hup = { x: (m9.x - wrist.x) / d(9, 0), y: (m9.y - wrist.y) / d(9, 0) };
    const raw = { x: lerp(wrist.x, m9.x, 0.55), y: lerp(wrist.y, m9.y, 0.55) };
    out.push({ raw, ext, hup, pw: d(5, 17), tip: L[12], wrist, ang });
  });
  // keep identity stable by matching to previous hands by position
  out.sort((a, b) => a.raw.x - b.raw.x);
  out.forEach((h, i) => {
    const k = 'hand' + i;
    h.seat = F(k, { ...h.raw, ang: h.ang }, t);
    h.open = h.ext >= 4; h.closed = h.ext <= 1;
    h.spark = F(k + 's', { ...add(h.tip, h.hup, 0.6 * BH), ang: 0 }, t);
  });
  handState.length = 0; handState.push(...out);
}

// anchors return a live point {x,y,ang} or null
let activeHand = null; // index into handState the main Byte cares about
const palmOf = (i) => () => {
  const h = handState[i ?? activeHand ?? 0];
  if (h) return h.seat;
  if (body.ok && body.armB?.hand) return body.armB.hand;
  return null;
};
const vis = (p) => (p && p.x > 20 && p.x < W - 20 && p.y > 30 && p.y < H - 70 ? p : null); // keep Byte inside the frame
const ANCHOR = {
  shoulder: () => (body.ok ? vis(body.seatB) : null),
  other: () => (body.ok ? vis(body.seatO) : null),
  head: () => (body.ok ? vis(body.head) : null),
  peek: () => (body.ok ? vis(body.peek) : null),
  hang: () => (body.ok ? vis(body.earB) : null),
  palm: () => palmOf()(),
  floor: () => P(W * (W > H ? 0.72 : 0.66), H * (W > H ? 0.86 : 0.78), 0),
};
const REST_CLIP = { shoulder: 'sit_idle', other: 'sit_idle', head: 'sit_idle', palm: 'ride', peek: 'peek', hang: 'hang', floor: 'stand_idle' };

// ---------- steps (the little choreography engine) ----------
// Each step: { start(b), update(b, dt) → done? }
function Rest(where, clip) {
  const fn = typeof where === 'function' ? where : ANCHOR[where];
  return {
    rest: true, t: 0, look: rand(3, 6),
    start(b) { if (typeof where === 'string') b.at = where; b.play(clip || REST_CLIP[where] || 'stand_idle', { fade: 0.35, sync: !b.main }); b.yawT = 0; },
    update(b, dt) {
      this.t += dt; const p = fn(); b.grounded = (clip || REST_CLIP[where]) === 'hang' ? 0 : 1;
      if (p) { const k = Math.min(1, dt * 22); b.pos.x = lerp(b.pos.x, p.x, k); b.pos.y = lerp(b.pos.y, p.y, k); b.ang = lerp(b.ang, p.ang * 0.8, Math.min(1, dt * 8)); }
      if (b.main && where === 'shoulder') { // glance at you now and then
        this.look -= dt; if (this.look < -1.6) this.look = rand(3, 7);
        b.yawT = this.look < 0 ? -0.75 : -0.2;
      } else if (b.main && where === 'palm') b.yawT = Math.sin(this.t * 0.7) * 0.25;
      return false;
    },
  };
}
function Hold(fn, clip, dur, opts = {}) { // play a clip in place for dur seconds
  return {
    t: 0,
    start(b) { b.play(clip, { fade: opts.fade ?? 0.2, from: opts.from || 0 }); if (opts.glow) b.glowT = opts.glow; if (opts.disco) b.disco = dur; opts.onStart?.(b); },
    update(b, dt) {
      this.t += dt; const p = (typeof fn === 'function' ? fn : ANCHOR[fn])?.();
      if (p) { const k = Math.min(1, dt * 22); b.pos.x = lerp(b.pos.x, p.x, k); b.pos.y = lerp(b.pos.y, p.y, k); b.ang = lerp(b.ang, p.ang * 0.8, Math.min(1, dt * 8)); }
      if (opts.yaw != null) b.yawT = opts.yaw;
      b.grounded = opts.air ? 0 : 1;
      return this.t >= dur;
    },
  };
}
function Crouch(fn) { // anticipation: squat, arms back, launch
  return {
    t: 0,
    start(b) { b.play('jump_start', { fade: 0.12 }); },
    update(b, dt) {
      this.t += dt; const p = fn?.(); if (p) { b.pos.x = p.x; b.pos.y = p.y; }
      b.grounded = 1;
      if (this.t >= 0.42) { sfx.jump(); puff(b.pos.x, b.pos.y, b.bh * 0.35, 8); b.squash(-5); return true; }
      return false;
    },
  };
}
function Air(targetFn, o = {}) { // ballistic hop that homes onto a moving target
  return {
    t: 0,
    start(b) {
      this.s = { ...b.pos }; this.last = targetFn() || { ...b.pos };
      const d = dist(this.s, this.last); this.d = d;
      this.T = o.T ?? clamp(0.42 + 0.11 * Math.sqrt(d / b.bh), 0.45, 1.15);
      const rise = Math.max(0, this.s.y - this.last.y);
      this.h = o.h ?? (0.55 * b.bh + 0.22 * d + rise * 0.35);
      this.flip = o.flip ?? (d > 3.4 * b.bh && Math.random() < 0.7);
      this.dir = Math.sign(this.last.x - this.s.x) || 1;
      if (o.clip !== false) b.play(o.clip || 'jump_air', { fade: 0.12, from: o.from || 0 });
      b.yawT = o.yaw ?? this.dir * 0.65; b.grounded = 0;
      this.arrived = false;
    },
    update(b, dt) {
      this.t += dt; const u = clamp(this.t / this.T, 0, 1);
      const uw = u + 0.22 * Math.sin(2 * Math.PI * u) / (2 * Math.PI); // linger near the apex
      const ue = clamp(uw, 0, 1);
      const tg = targetFn() || this.last; this.last = tg;
      b.pos.x = lerp(this.s.x, tg.x, ue); b.pos.y = lerp(this.s.y, tg.y, ue) - this.h * 4 * ue * (1 - ue);
      b.ang = lerp(b.ang, 0, Math.min(1, dt * 6));
      b.spin = this.flip ? -this.dir * Math.PI * 2 * smooth(0.18, 0.82, u) : 0;
      b.sq = 1 + 0.16 * Math.abs(1 - 2 * u) - 0.02;
      if (o.shrink) b.popT = 1 - smooth(0.5, 1, u);
      if (o.trail && Math.random() < 0.7) glitter.emit(b.pos.x + rand(-6, 6), b.pos.y - b.bh * 0.4, 0, 0, 0.5, b.bh * 0.08, 1, 0.85, 0.5, 0.9);
      if (u >= 1) { b.spin = 0; b.pos.x = tg.x; b.pos.y = tg.y; o.onArrive?.(b); return true; }
      return false;
    },
  };
}
function Land(where) {
  const fn = typeof where === 'function' ? where : ANCHOR[where];
  return {
    t: 0,
    start(b) { b.play('jump_land', { fade: 0.06 }); sfx.land(); b.squash(-9); puff(b.pos.x, b.pos.y, b.bh * 0.5); b.grounded = 1; },
    update(b, dt) {
      this.t += dt; const p = fn?.(); if (p) { b.pos.x = p.x; b.pos.y = p.y; b.ang = lerp(b.ang, p.ang * 0.8, Math.min(1, dt * 10)); }
      b.yawT = lerp(b.yawT, 0, Math.min(1, dt * 4));
      return this.t >= 0.42;
    },
  };
}
function Path(fns, mode, o = {}) { // walk / run / slide along a live polyline (e.g. your arm)
  return {
    s: 0, v: 0, t: 0,
    start(b) {
      b.play(mode === 'slide' ? 'slide' : mode, { fade: 0.25 }); this.v = mode === 'slide' ? 0.4 * b.bh : 0;
      if (mode === 'slide') sfx.swish(); this.stepAcc = 0;
    },
    update(b, dt) {
      this.t += dt;
      const pts = fns.map((f) => f()).filter(Boolean); if (pts.length < 2) return true;
      const seg = []; let L = 0;
      for (let i = 1; i < pts.length; i++) { const l = dist(pts[i - 1], pts[i]); seg.push(l); L += l; }
      const vmax = mode === 'walk' ? 0.55 * b.bh : mode === 'run' ? 1.85 * b.bh : 4.5 * b.bh;
      if (mode === 'slide') this.v = Math.min(vmax, this.v + 4.2 * b.bh * dt); else this.v = Math.min(vmax, this.v + vmax * 3 * dt);
      this.s += this.v * dt;
      if (mode !== 'slide' && b.cur) b.cur.timeScale = this.v / vmax;
      let s = Math.min(this.s, L), i = 0; while (i < seg.length - 1 && s > seg[i]) { s -= seg[i]; i++; }
      const a = pts[i], c = pts[i + 1], k = seg[i] ? clamp(s / seg[i], 0, 1) : 1;
      b.pos.x = lerp(a.x, c.x, k); b.pos.y = lerp(a.y, c.y, k);
      const sa = normAng(Math.atan2(c.y - a.y, c.x - a.x));
      b.ang = lerp(b.ang, clamp(sa, mode === 'slide' ? -1.1 : -0.55, mode === 'slide' ? 1.1 : 0.55), Math.min(1, dt * 10));
      const dir = Math.sign(c.x - a.x) || 1;
      b.yawT = mode === 'slide' ? dir * 0.35 : dir * 1.3; b.grounded = 1;
      if (mode !== 'slide') { this.stepAcc += this.v * dt; if (this.stepAcc > 0.25 * b.bh) { this.stepAcc = 0; sfx.step(); dust.emit(b.pos.x, b.pos.y, -dir * 20, -10, 0.4, b.bh * 0.12, 1, 1, 1, 0.3, 0, 1); } }
      else if (Math.random() < 0.5) glitter.emit(b.pos.x, b.pos.y, rand(-20, 20), rand(-30, 0), 0.4, b.bh * 0.07, 1, 0.9, 0.6, 0.8);
      return this.s >= L;
    },
  };
}
const Call = (f) => ({ start(b) { f(b); }, update: () => true });

// ---------- sparkle ----------
class Sparkle {
  constructor(posFn) {
    this.posFn = posFn; this.t = 0; this.held = null; this.dead = false; this.pos = posFn() || { x: W / 2, y: H / 2 };
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, blending: THREE.AdditiveBlending, depthTest: false, transparent: true }));
    this.star = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, blending: THREE.AdditiveBlending, depthTest: false, transparent: true, color: 0xfff2d0 }));
    this.core.renderOrder = this.star.renderOrder = 30; scene.add(this.core, this.star);
    burst(this.pos.x, this.pos.y, BH * 0.5, 40); sfx.shimmer();
  }
  update(dt) {
    this.t += dt;
    if (this.held) { // tucked against Byte's chest
      const b = this.held; this.pos = { x: b.pos.x, y: b.pos.y - b.bh * 0.55 }; this.scale = lerp(this.scale, 0, Math.min(1, dt * 2.5));
      if (this.scale < 0.03) return this.kill();
    } else {
      const p = this.posFn(); if (p) this.pos = { x: lerp(this.pos.x, p.x, Math.min(1, dt * 10)), y: lerp(this.pos.y, p.y + Math.sin(this.t * 3) * BH * 0.08, Math.min(1, dt * 10)) };
      this.scale = Math.min(1, this.t * 3);
    }
    const s = BH * 0.75 * this.scale * (1 + 0.12 * Math.sin(this.t * 9));
    this.core.position.set(this.pos.x, H - this.pos.y, 950); this.core.scale.setScalar(s);
    this.star.position.copy(this.core.position); this.star.scale.setScalar(s * 0.9); this.star.material.rotation = this.t * 1.4;
    if (Math.random() < 0.9) {
      const a = rand(0, Math.PI * 2), r = rand(0.2, 0.6) * BH * this.scale;
      glitter.emit(this.pos.x + Math.cos(a) * r, this.pos.y + Math.sin(a) * r, rand(-15, 15), rand(-25, 5), rand(0.4, 0.9), BH * rand(0.04, 0.1), 1, rand(0.85, 1), rand(0.55, 0.9), 1);
    }
  }
  catchBy(b) { this.held = b; burst(this.pos.x, this.pos.y, BH * 0.6, 110); sfx.chime(); b.glowT = 9; }
  kill() { scene.remove(this.core, this.star); this.core.material.dispose(); this.star.material.dispose(); this.dead = true; }
}
let sparkle = null;

// ---------- the main Byte: commands ----------
let byte = null;
function here() { return ANCHOR[byte.at]; }
function armPathTo(handIdx) { // live points from Byte's shoulder down the arm that owns this hand
  const h = handState[handIdx];
  const near = (arm) => arm && h ? dist(arm.rawWr, h.wrist) : 1e9;
  let arm = body.armB, cross = false;
  if (h && body.armO && near(body.armO) < near(body.armB)) { arm = body.armO; cross = true; }
  if (!arm || !vis(arm.el) || !vis(arm.wr)) return null;
  if (h && dist(arm.rawWr, h.wrist) > 0.6 * body.sw) return null; // that hand is not on this arm
  const key = arm === body.armB ? 'armB' : 'armO';
  const pts = [ANCHOR.shoulder];
  if (cross) pts.push(() => body.ok ? P(...[(body.seatB.x + body.seatO.x) / 2, (body.seatB.y + body.seatO.y) / 2 - 0.12 * body.sw]) : null, ANCHOR.other);
  pts.push(() => body[key]?.el, () => body[key]?.wr, h ? palmOf(handIdx) : () => body[key]?.hand);
  const sh = arm.rawSh, wr = arm.rawWr, dx = Math.abs(wr.x - sh.x), slope = (wr.y - sh.y) / Math.max(1, dx);
  const kind = dx > 0.75 * body.sw && Math.abs(slope) < 0.5 ? 'flat' : slope >= 0.5 && dist(wr, sh) > 0.8 * body.sw ? 'down' : 'none';
  return { pts, kind, cross };
}
function launchFrom() { const f = here(); return byte.at === 'hang' ? [] : [Crouch(f)]; }
function goTo(where, after = []) {
  if (!ANCHOR[where]()) return false;
  byte.run([...launchFrom(), Air(ANCHOR[where], { trail: where === 'palm' }), Land(where), ...after, Rest(where)]);
  return true;
}
function command(c, src = 'button') {
  if (!byte) return;
  if (AC.state !== 'running') AC.resume();
  const label = { shoulder: 'Back to the shoulder', hand: 'Coming to your hand', head: 'Climbing your head', peek: 'Peekaboo', hang: 'Hanging off your ear', walk: 'Walking your arm', slide: 'Wheee', sparkle: 'Sparkle!', multiply: '×100', dance: 'Dance!', wave: 'Hi!', hide: 'Hiding' }[c];
  if (label) toast((src === 'voice' ? '🎙️ ' : '') + label);
  const needBody = () => { if (!body.ok) { toast('Step into the frame so Byte can find your shoulders'); return false; } return true; };
  switch (c) {
    case 'shoulder':
      if (byte.at === 'palm' && activeHand != null) { const ap = armPathTo(activeHand); if (ap && ap.kind === 'flat') { byte.run([Hold('palm', 'stand_up', 0.7), Path([...ap.pts].reverse(), 'run'), Hold('shoulder', 'sit_down', 0.6), Rest('shoulder')]); return; } }
      if (!goTo(body.ok ? 'shoulder' : 'floor')) needBody(); return;
    case 'hand': {
      const i = pickHand(); if (i == null && !body.armB) { toast('Show me your open hand ✋'); return; }
      activeHand = i; const ap = i != null && body.ok ? armPathTo(i) : null;
      if (ap && ap.kind === 'flat' && byte.at === 'shoulder') byte.run([Hold('shoulder', 'stand_up', 0.7), Path(ap.pts, 'run'), Hold(palmOf(i), 'sit_down', 0.6), Rest('palm')]);
      else if (ap && ap.kind === 'down' && byte.at === 'shoulder') byte.run([Path(ap.pts, 'slide'), Land('palm'), Rest('palm')]);
      else goTo('palm');
      return;
    }
    case 'head': if (!needBody()) return;
      // climb: hop to the ear, hang a beat kicking, pull up onto the top of the head
      if (byte.at === 'shoulder') byte.run([Crouch(here()), Air(ANCHOR.hang, { h: 0.5 * BH, flip: false }), Hold('hang', 'hang', 0.7, { air: true }),
        Air(ANCHOR.head, { h: 0.45 * BH, flip: false }), Land('head'), Hold('head', 'cheer', 1.0, { glow: 4 }), Rest('head')]);
      else goTo('head');
      return;
    case 'peek': if (!needBody()) return; goTo('peek'); return;
    case 'hang': if (!needBody()) return; byte.run([...launchFrom(), Air(ANCHOR.hang, { flip: false }), Call(() => { sfx.whoa(); }), Rest('hang')]); return;
    case 'walk': {
      if (!needBody()) return; const i = pickHand(); const ap = armPathTo(i);
      if (!ap) { toast('Hold your arm out to the side'); return; }
      activeHand = i;
      if (byte.at !== 'shoulder') { goTo('shoulder'); return; }
      byte.run([Hold('shoulder', 'stand_up', 0.7), Path(ap.pts, ap.kind === 'flat' ? 'walk' : 'run'), Hold(ap.pts.at(-1), 'sit_down', 0.6), Rest('palm')]);
      return;
    }
    case 'slide': {
      if (!needBody()) return;
      const i = pickHand(), ap = armPathTo(i);
      const down = [ANCHOR.head, () => body.ok ? body.earSide : null, () => body.ok ? P(body.seatB.x + body.dn.x * 0.12 * body.sw, body.seatB.y - 0.05 * body.sw, body.ang) : null, ANCHOR.shoulder];
      if (byte.at === 'shoulder' && ap && ap.kind === 'down') { activeHand = i; byte.run([Path(ap.pts, 'slide'), Land('palm'), Rest('palm')]); return; }
      const up = byte.at === 'head' ? [] : [...launchFrom(), Air(ANCHOR.head), Land('head'), Hold('head', 'sit_idle', 0.35)];
      byte.run([...up, Path(down, 'slide'), Call((b) => { b.squash(-6); puff(b.pos.x, b.pos.y, b.bh * 0.4); sfx.land(); }), Hold('shoulder', 'cheer', 0.9, { glow: 4 }), Rest('shoulder')]);
      return;
    }
    case 'sparkle': {
      const i = pickHand();
      if (i != null && handState[i]) { activeHand = i; sparkleCatch(i); return; }
      // no hand: a sparkle appears in the air next to Byte, Byte jumps, catches it and lands back
      const home = byte.at; const off = { x: byte.pos.x - BH * rand(1.4, 2.2), y: byte.pos.y - BH * rand(1.3, 1.9) };
      sparkle = new Sparkle(() => off);
      byte.run([Hold(home, REST_CLIP[home] || 'stand_idle', 0.6, { yaw: -0.6 }), Crouch(here()),
        Air(() => sparkle && !sparkle.held ? sparkle.pos : off, { flip: false, onArrive: (b) => sparkle?.catchBy(b) }),
        hover(), Air(ANCHOR[home], { clip: 'catch', from: 0.9, h: 0.4 * BH, flip: false }), Land(home), Hold(home, 'cheer', 1.3, { glow: 6 }), Rest(home)]);
      return;
    }
    case 'multiply': swarmStart(); return;
    case 'dance': byte.run([Hold(here(), 'cheer', 3.2, { disco: 1 }), Rest(byte.at)]); sfx.chime(); return;
    case 'wave': byte.run([Hold(here(), 'wave', 1.3, { yaw: 0 }), Rest(byte.at)]); return;
    case 'hide': byte.run([Hold(here(), 'hide', 2.4, { yaw: 0 }), Hold(here(), 'wave', 1.2), Rest(byte.at)]); return;
  }
}
function hover() { // hang time after the mid-air catch
  return {
    t: 0,
    start(b) { b.play('catch', { fade: 0.08, from: 0.25 }); b.yawT = 0; b.grounded = 0; },
    update(b, dt) { this.t += dt; b.pos.y += b.bh * 0.25 * dt; b.sq = 1; return this.t >= 0.55; },
  };
}
function pickHand() {
  if (!handState.length) return null;
  let best = null, bs = -1e9;
  handState.forEach((h, i) => { const sc = (h.open ? 1000 : 0) - dist(h.seat, byte.pos); if (sc > bs) { bs = sc; best = i; } });
  return best;
}
function sparkleCatch(i) {
  activeHand = i; const pf = () => handState[i]?.spark || null;
  sparkle = new Sparkle(pf);
  const ap = body.ok && byte.at === 'shoulder' ? armPathTo(i) : null;
  const grab = [Air(() => (sparkle && !sparkle.held ? sparkle.pos : pf()), { flip: false, onArrive: (b) => sparkle?.catchBy(b), trail: true }), hover(),
    Air(palmOf(i), { clip: 'catch', from: 0.9, h: 0.35 * BH, flip: false }), Land('palm'), Hold('palm', 'cheer', 1.4, { glow: 6 }), Rest('palm')];
  const notice = Hold(here(), REST_CLIP[byte.at] || 'stand_idle', 0.55, { yaw: Math.sign((pf()?.x ?? byte.pos.x) - byte.pos.x) * 0.7 });
  if (ap && ap.kind === 'flat') byte.run([notice, Hold('shoulder', 'stand_up', 0.6), Path(ap.pts.slice(0, -1), 'run'), Crouch(), ...grab]);
  else if (ap && ap.kind === 'down') byte.run([notice, Path(ap.pts.slice(0, -1), 'slide'), Crouch(), ...grab]);
  else byte.run([notice, ...launchFrom(), ...grab]);
}

// ---------- the swarm: Byte splits into 100 colourful clones ----------
const swarm = { on: false, t: 0, list: [], queue: 0, emptyT: 0, ending: false };
function slotFor(i) {
  const hs = handState.length;
  const r = Math.random();
  let group;
  if (hs >= 2) group = r < 0.42 ? 'h0' : r < 0.84 ? 'h1' : r < 0.92 ? 'head' : 'shoulders';
  else if (hs === 1) group = r < 0.7 ? 'h0' : r < 0.82 ? 'head' : 'shoulders';
  else group = body.ok ? (r < 0.25 ? 'head' : r < 0.6 ? 'shoulders' : 'floor') : 'floor';
  const k = (swarm.counts[group] = (swarm.counts[group] || 0) + 1);
  const sz = BH * 0.42;
  return () => {
    let g;
    if (group === 'h0' || group === 'h1') {
      const h = handState[group === 'h0' ? 0 : 1] || handState[0]; if (!h) return null;
      const rr = 0.42 * Math.sqrt(k) * sz, th = k * 2.39996;
      return P(h.seat.x + Math.cos(th) * rr, h.seat.y + Math.sin(th) * rr * 0.75 - 0.1 * sz, h.ang);
    }
    if (group === 'head') { g = ANCHOR.head(); if (!g) return null; return P(g.x + ((k % 7) - 3) * 0.33 * sz, g.y - Math.floor(k / 7) * 0.4 * sz, g.ang); }
    if (group === 'shoulders') {
      if (!body.ok) return null; const left = k % 2 === 0, a = left ? body.seatO : body.seatB, j = Math.floor(k / 2);
      return P(a.x + body.dn.x * (left ? -1 : 1) * j * 0.32 * sz, a.y + body.dn.y * (left ? -1 : 1) * j * 0.32 * sz + (j % 2) * 0.1 * sz, body.ang);
    }
    const f = ANCHOR.floor(); return P(clamp(W * 0.5 + ((k * 37) % 19 - 9) * 0.5 * sz, sz, W - sz), f.y + ((k * 13) % 5 - 2) * 0.18 * sz, 0);
  };
}
function swarmStart() {
  if (swarm.on || !byte) return;
  swarm.on = true; swarm.t = 0; swarm.queue = N_CLONES; swarm.emptyT = 0; swarm.ending = false; swarm.counts = {}; swarm.spawnAcc = 0;
  byte.run([Hold(here(), 'cheer', 1.6, { glow: 14, disco: 1 }), Rest(byte.at)]);
  sfx.flash(); burst(byte.pos.x, byte.pos.y - BH * 0.5, BH, 160, 50);
  toast('×' + N_CLONES);
}
function swarmUpdate(dt) {
  if (!swarm.on) return;
  swarm.t += dt;
  if (swarm.queue > 0 && swarm.t > 0.45) {
    swarm.spawnAcc += dt * N_CLONES / 1.4;
    while (swarm.spawnAcc >= 1 && swarm.queue > 0) {
      swarm.spawnAcc--; swarm.queue--;
      const i = N_CLONES - swarm.queue - 1, hue = (i * 137.5 + rand(-10, 10)) % 360;
      const c = new Buddy({ hue, sizeMul: rand(0.3, 0.5) }); c.noShadow = true;
      c.pos = { x: byte.pos.x, y: byte.pos.y - BH * 0.55 }; c.popT = 1; c.pop = 0.05; c.yaw = rand(-0.5, 0.5);
      const fly = P(byte.pos.x + rand(-3.2, 3.2) * BH, byte.pos.y - rand(1.2, 3.2) * BH, 0);
      const slot = slotFor(i), last = { v: null }; const sl = () => (last.v = slot() || last.v || fly);
      c.run([Air(() => fly, { T: rand(0.35, 0.55), h: rand(0.3, 0.9) * BH, clip: 'jump_air', flip: Math.random() < 0.35 }),
        Air(sl, { flip: Math.random() < 0.25 }), Land(sl), Rest(sl, ['stand_idle', 'stand_idle', 'cheer', 'wave', 'sit_idle', 'ride'][i % 6])]);
      c.mixer.timeScale = rand(0.85, 1.15);
      swarm.list.push(c); sfx.pop(); burst(c.pos.x, c.pos.y, BH * 0.3, 6, hue);
    }
  }
  for (const c of swarm.list) {
    c.update(dt);
    if (c.step?.rest && c.curName === 'wave' && !c.acts.wave.isRunning()) c.play('stand_idle');
  }
  swarm.list = swarm.list.filter((c) => !c.dead);
  if (swarm.ending && !swarm.list.length) { swarm.on = false; byte.glowT = 6; burst(byte.pos.x, byte.pos.y - BH * 0.5, BH * 0.8, 80); sfx.chime(); }
}
function swarmEnd() {
  if (!swarm.on || swarm.ending) return;
  swarm.ending = true; swarm.queue = 0;
  const home = () => ({ x: byte.pos.x, y: byte.pos.y - BH * 0.5 });
  swarm.list.forEach((c, i) => {
    const wait = rand(0, 0.9);
    c.run([Hold(() => null, 'stand_idle', wait), Crouch(), Air(home, { shrink: true, flip: Math.random() < 0.3 }),
      Call((b) => { sfx.pop(); burst(b.pos.x, b.pos.y, BH * 0.25, 8, b.hue); b.dispose(); })]);
  });
}

// ---------- brain: gestures → actions ----------
const G = { one: 0, both: 0, none: 0, closed: 0, cover: 0, lostBody: 0 };
function brain(dt) {
  if (!byte) return;
  const open = handState.filter((h) => h.open);
  G.both = open.length >= 2 ? G.both + dt : 0;
  G.one = open.length === 1 ? G.one + dt : 0;
  G.none = handState.length === 0 ? G.none + dt : 0;
  // two open hands → 100 Bytes
  if (G.both > 0.35 && !swarm.on && !byte.busy) { swarmStart(); G.both = -99; }
  if (swarm.on && !swarm.ending && swarm.t > 4 && (open.length === 0 ? (swarm.emptyT += dt) : (swarm.emptyT = 0)) > 1.3) swarmEnd();
  if (swarm.on && !swarm.ending && swarm.t > 18) swarmEnd();
  // one open hand → sparkle appears, Byte goes for it
  if (G.one > 0.35 && G.both === 0 && !swarm.on && !byte.busy && byte.at !== 'palm' && (!sparkle || sparkle.dead)) {
    const i = handState.indexOf(open[0]); sparkleCatch(i); G.one = -99;
  }
  // on the palm: fist or hand gone → back to the shoulder
  if (byte.at === 'palm' && !byte.busy) {
    const h = handState[activeHand ?? 0];
    G.closed = h && h.closed ? G.closed + dt : 0;
    if (G.closed > 0.4 || G.none > 0.8) { G.closed = 0; if (G.none > 0.8) sfx.whoa(); command('shoulder', 'gesture'); }
  }
  // hand over Byte on the shoulder → hide, then peek out with a wave
  if (byte.at === 'shoulder' && !byte.busy && handState.some((h) => !h.open && dist(h.seat, byte.pos) < BH * 0.7)) { G.cover += dt; if (G.cover > 0.3) { command('hide', 'gesture'); G.cover = -99; } }
  else if (G.cover < 0) G.cover = Math.min(0, G.cover + dt * 40);
  else G.cover = 0;
  // lost / found the body
  const restingOnBody = byte.step?.rest && byte.at !== 'floor' && byte.at !== 'palm';
  if (!ANCHOR[byte.at]?.() && restingOnBody) { G.lostBody += dt; if (G.lostBody > 1.2) { G.lostBody = 0; goTo('floor'); } }
  else G.lostBody = 0;
  if (ANCHOR.shoulder() && byte.at === 'floor' && byte.step?.rest && byte.step.t > 0.8) goTo('shoulder');
}

// ---------- detection loop ----------
let vision = null, lastVT = -1, frameN = 0;
async function initTracking() {
  vision = await import(MP + 'vision_bundle.js');
  const fs = { wasmLoaderPath: MP + 'wasm/vision_wasm_internal.js', wasmBinaryPath: MP + 'wasm/vision_wasm_internal.wasm' };
  const mk = async (Cls, file, extra) => {
    try { return await Cls.createFromOptions(fs, { baseOptions: { modelAssetPath: MP + file, delegate: 'GPU' }, runningMode: 'VIDEO', ...extra }); }
    catch { return Cls.createFromOptions(fs, { baseOptions: { modelAssetPath: MP + file, delegate: 'CPU' }, runningMode: 'VIDEO', ...extra }); }
  };
  [pose, hands] = await Promise.all([
    mk(vision.PoseLandmarker, 'pose_landmarker.task', { numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }),
    mk(vision.HandLandmarker, 'hand_landmarker.task', { numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5 }),
  ]);
}
let lastTs = 0;
function track(now) {
  if (window.__freeze || !pose || video.readyState < 2 || video.currentTime === lastVT) return;
  lastVT = video.currentTime; frameN++;
  const ts = Math.max(lastTs + 1, now); lastTs = ts; const t = now / 1000;
  try {
    readHands(hands.detectForVideo(video, ts), t);
    if (frameN % 2 === 0) { const r = pose.detectForVideo(video, ts); if (r.landmarks?.[0]) readPose(r.landmarks[0], t); else body.ok = false; }
  } catch (e) { console.warn(e); }
  if (DEBUG) drawDebug();
}
function drawDebug() {
  dctx.clearRect(0, 0, W, H); dctx.lineWidth = 2;
  const dot = (p, c, r = 6) => { if (!p) return; dctx.fillStyle = c; dctx.beginPath(); dctx.arc(p.x, p.y, r, 0, 7); dctx.fill(); };
  if (body.ok) {
    for (const k of ['seatB', 'seatO', 'head', 'earB', 'earSide', 'peek']) dot(body[k], '#0f0');
    for (const a of [body.armB, body.armO]) if (a) { dot(a.el, '#0ff'); dot(a.wr, '#0ff'); dot(a.hand, '#08f'); }
  }
  for (const h of handState) { dot(h.seat, h.open ? '#ff0' : h.closed ? '#f00' : '#fa0', 9); dot(h.spark, '#fff', 4); }
}

// ---------- light matching: tint the lights to the room ----------
const probe = document.createElement('canvas'); probe.width = probe.height = 16; const pctx = probe.getContext('2d', { willReadFrequently: true });
let probeT = 0;
function matchLight(dt) {
  probeT -= dt; if (probeT > 0 || video.readyState < 2) return; probeT = 0.5;
  pctx.drawImage(video, 0, 0, 16, 16); const d = pctx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4; r /= n * 255; g /= n * 255; b /= n * 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b, m = Math.max(r, g, b, 1e-3);
  const tint = new THREE.Color(lerp(1, r / m, 0.45), lerp(1, g / m, 0.45), lerp(1, b / m, 0.45));
  hemi.color.copy(tint); key.color.copy(tint).lerp(new THREE.Color(1, 0.96, 0.9), 0.5);
  const k = clamp(0.55 + lum * 1.3, 0.6, 1.5); hemi.intensity = 1.1 * k; key.intensity = 2.2 * k; renderer.toneMappingExposure = clamp(0.85 + lum * 0.5, 0.85, 1.2);
}

// ---------- recording ----------
let rec = null, recCtx = null, recCanvas = null, micStream = null;
function composite() {
  const c = recCanvas, x = recCtx, cw = c.width, ch = c.height;
  const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(cw / vw, ch / vh);
  x.save(); x.filter = 'contrast(1.06) saturate(1.08)';
  if (MIRROR) { x.translate(cw, 0); x.scale(-1, 1); }
  x.drawImage(video, (cw - vw * s) / 2, (ch - vh * s) / 2, vw * s, vh * s); x.restore();
  x.drawImage(glCanvas, 0, 0, cw, ch);
  const g = x.createRadialGradient(cw / 2, ch * 0.45, Math.min(cw, ch) * 0.35, cw / 2, ch * 0.45, Math.max(cw, ch) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); x.fillStyle = g; x.fillRect(0, 0, cw, ch);
  if (!$('#bars').classList.contains('off')) { x.fillStyle = '#000'; x.fillRect(0, 0, cw, ch * 0.11); x.fillRect(0, ch * 0.89, cw, ch * 0.11); }
}
function toggleRecord() {
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
    a.href = URL.createObjectURL(blob); a.download = `byte-${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
    rec = null; btn.setAttribute('aria-pressed', 'false'); btn.innerHTML = '<span>⏺</span>Record'; $('#rec-dot').classList.add('off'); toast('Saved your clip');
  };
  rec.start(500); btn.setAttribute('aria-pressed', 'true'); btn.innerHTML = '<span>⏹</span>Stop'; $('#rec-dot').classList.remove('off');
}

// ---------- voice ----------
const VOICE = [
  [/multipl|clone|hundred|\b100\b|army|copies|split/, 'multiply'],
  [/sparkle|magic|star|catch/, 'sparkle'],
  [/peek|hide and seek|where are you/, 'peek'],
  [/hide|scared|\bboo\b/, 'hide'],
  [/hang|\bear\b/, 'hang'],
  [/slide|whee/, 'slide'],
  [/walk|my arm/, 'walk'],
  [/climb|head|on top/, 'head'],
  [/come here|come to|my hand|\bhand\b|jump/, 'hand'],
  [/go back|shoulder|sit down|come back|stop/, 'shoulder'],
  [/dance|party|celebrate|cheer/, 'dance'],
  [/wave|hello|\bhi\b|\bbye\b|hey/, 'wave'],
];
let recog = null, voiceOn = false, lastVoice = { c: '', t: 0 };
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition, btn = $('#mic');
  if (!SR) { toast('Voice commands need Chrome or Safari'); return; }
  voiceOn = !voiceOn; btn.setAttribute('aria-pressed', String(voiceOn)); btn.innerHTML = `<span>🎙️</span>Voice ${voiceOn ? 'on' : 'off'}`;
  if (!voiceOn) { recog?.stop(); return; }
  recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
  recog.onresult = (e) => {
    const r = e.results[e.results.length - 1], text = r[0].transcript.toLowerCase();
    for (const [re, c] of VOICE) if (re.test(text)) {
      const now = performance.now(); if (c === lastVoice.c && now - lastVoice.t < 2500) return;
      lastVoice = { c, t: now }; command(c, 'voice'); return;
    }
  };
  recog.onend = () => { if (voiceOn) try { recog.start(); } catch {} };
  recog.start(); toast('Say "come here", "climb", "slide", "multiply"…', 3);
}

// ---------- boot ----------
async function loadByte() {
  const g = await new GLTFLoader().loadAsync('byte.glb');
  TEMPLATE = g.scene;
  for (const c of g.animations) CLIPS[c.name] = c;
  TEMPLATE.traverse((o) => {
    if (o.isMesh) for (const m of [].concat(o.material)) if (m.name !== 'Bulb' && !BASE_MAT) {
      BASE_MAT = new THREE.MeshPhysicalMaterial({ map: m.map, roughness: 0.82, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(1, 0.97, 0.92), envMapIntensity: 0.7 });
    }
  });
}
async function startCamera() {
  if (Q.has('video')) { video.src = Q.get('video'); video.loop = true; video.muted = true; await video.play(); return; }
  try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true }); micStream = new MediaStream(s.getAudioTracks()); video.srcObject = new MediaStream(s.getVideoTracks()); }
  catch { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }); }
  await video.play();
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  track(now); matchLight(dt); brain(dt);
  if (byte) byte.update(dt);
  swarmUpdate(dt);
  if (sparkle && !sparkle.dead) sparkle.update(dt);
  glitter.update(dt); dust.update(dt);
  if (toastT > 0 && (toastT -= dt) <= 0) $('#toast').classList.remove('on');
  renderer.render(scene, cam);
  if (rec) composite();
  requestAnimationFrame(frame);
}
$('#start').addEventListener('click', async () => {
  const st = $('#status'); AC.resume();
  try {
    st.textContent = 'Starting camera…'; await startCamera();
    st.textContent = 'Waking Byte up…'; await Promise.all([loadByte(), initTracking()]);
  } catch (e) { st.textContent = 'Could not start: ' + (e.message || e) + '. Allow camera access and reload.'; return; }
  byte = new Buddy({ main: true });
  byte.pos = { ...ANCHOR.floor() }; byte.run([Hold('floor', 'wave', 1.3), Rest('floor')]);
  $('#intro').remove(); $('#bar').classList.remove('hidden');
  toast('Open your hand ✋', 3);
  window.__byte = { byte, body, handState, command, swarm, G,
    tick(sec) { for (let t = 0; t < sec; t += 1 / 30) { brain(1 / 30); byte.update(1 / 30); swarmUpdate(1 / 30); if (sparkle && !sparkle.dead) sparkle.update(1 / 30); glitter.update(1 / 30); dust.update(1 / 30); } renderer.render(scene, cam); },
    fakeHands(list) { handState.length = 0; for (const [x, y, open] of list) { const p = { x, y, ang: 0 }; handState.push({ seat: p, raw: p, open, closed: !open, ext: open ? 4 : 0, tip: { x, y: y - 80 }, wrist: { x, y: y + 60 }, hup: { x: 0, y: -1 }, spark: { x, y: y - 80 - 0.6 * BH, ang: 0 }, ang: 0 }); } },
    get sparkle() { return sparkle; } };
});
$('#acts').addEventListener('click', (e) => { const b = e.target.closest('button[data-cmd]'); if (b) command(b.dataset.cmd); });
$('#sound').addEventListener('click', (e) => {
  soundOn = !soundOn; AC.resume(); const b = e.currentTarget; b.setAttribute('aria-pressed', String(soundOn)); b.innerHTML = `<span>${soundOn ? '🔊' : '🔇'}</span>Sound ${soundOn ? 'on' : 'off'}`;
});
$('#mic').addEventListener('click', toggleVoice);
$('#cinema').addEventListener('click', (e) => {
  const on = $('#bars').classList.toggle('off') === false, b = e.currentTarget; b.setAttribute('aria-pressed', String(on)); b.innerHTML = `<span>🎬</span>Cinema ${on ? 'on' : 'off'}`;
});
$('#record').addEventListener('click', toggleRecord);
requestAnimationFrame(frame);
