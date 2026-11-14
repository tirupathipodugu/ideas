// Paper Boat Race: a folded notebook-paper boat on monsoon rain water in an old Indian courtyard (aangan).
// Blow into the mic (or hold Blow / Space) to push it; drag or tilt to steer round leaves and frogs to the drain.
import { compile, mesh, m4, norm, cross, sub } from './gl.js';
import { Geo, paperBoat, leaf, frog, lathe } from './geom.js';
import * as S from './shaders.js';
import { Sound } from './sound.js';
import { Mic } from './mic.js';

const { HALF, FIN, END } = S;
const params = new URLSearchParams(location.search);
const HIQ = params.has('q');

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl) {
  $('status').textContent = 'This browser cannot draw the water (WebGL2 is off). Try Chrome or Safari.';
  throw new Error('WebGL2 unavailable');
}

// ---------- programs ----------
const P = {
  world: compile(gl, S.WORLD_VS, S.WORLD_FS, 'world'),
  sky: compile(gl, S.SKY_VS, S.SKY_FS, 'sky'),
  water: compile(gl, S.WATER_VS, S.WATER_FS, 'water'),
  sim: compile(gl, S.SIM_VS, S.SIM_FS, 'sim'),
  rain: compile(gl, S.RAIN_VS, S.RAIN_FS, 'rain'),
};
const emptyVao = gl.createVertexArray();
gl.vertexAttrib3f(3, 1, 1, 1); // crease barycentrics default: no lines on meshes without them

// ---------- static courtyard ----------
const statics = [];
{
  const plinth = new Geo();
  for (const s of [1, -1]) {
    const a = HALF * s, b = 3.25 * s;
    plinth.box(Math.min(a, b), Math.max(a, b), -0.09, 0.10, -4.5, END, 'ny');
  }
  statics.push({ m: mesh(gl, plinth.data()), mat: 1 });

  const walls = new Geo(), pillars = new Geo();
  for (const s of [1, -1]) {
    const x0 = 3.2 * s, x1 = 3.4 * s;
    walls.box(Math.min(x0, x1), Math.max(x0, x1), 0.1, 3.1, -4.5, END + 0.3, 'ny');
    for (let z = -1.5; z < END; z += 3.6) {
      const c = 2.3 * s;
      pillars.box(c - 0.13, c + 0.13, 0.10, 2.78, z - 0.13, z + 0.13, 'ny');
      pillars.box(c - 0.17, c + 0.17, 0.10, 0.22, z - 0.17, z + 0.17, 'ny');
    }
    const bx0 = 2.0 * s, bx1 = 2.6 * s;
    walls.box(Math.min(bx0, bx1), Math.max(bx0, bx1), 2.78, 3.0, -4.5, END, '');
    const rx0 = 1.82 * s, rx1 = 3.3 * s;
    walls.box(Math.min(rx0, rx1), Math.max(rx0, rx1), 3.0, 3.1, -4.5, END, '');
  }
  walls.box(-3.4, 3.4, -0.09, 3.3, END, END + 0.25, 'ny');
  walls.box(-3.4, 3.4, -0.09, 3.3, -4.75, -4.5, 'ny');
  statics.push({ m: mesh(gl, walls.data()), mat: 0 });
  statics.push({ m: mesh(gl, pillars.data()), mat: 0, part: 1 });

  const posts = new Geo();
  for (const s of [1, -1]) {
    const c = (HALF + 0.07) * s;
    posts.box(c - 0.055, c + 0.055, 0.10, 0.175, FIN - 0.11, FIN + 0.11, 'ny');
    posts.box(c - 0.055, c + 0.055, 0.175, 0.25, FIN - 0.115, FIN + 0.105, 'ny');
    posts.box(c - 0.05, c + 0.06, 0.25, 0.325, FIN - 0.105, FIN + 0.115, 'ny');
  }
  statics.push({ m: mesh(gl, posts.data()), mat: 7 });

  const matka = mesh(gl, lathe([[0, 0], [0.08, 0.008], [0.15, 0.07], [0.175, 0.17], [0.15, 0.27], [0.08, 0.325], [0.062, 0.345], [0.078, 0.37], [0.066, 0.372], [0.05, 0.35]]));
  statics.push({ m: matka, mat: 8, model: m4.trs([-2.75, 0.10, 1.4], 0.3) });
  statics.push({ m: matka, mat: 8, model: m4.trs([2.8, 0.10, 8.2], 1.1, 0, 0, 0.85) });
  statics.push({ m: matka, mat: 8, model: m4.trs([-2.7, 0.10, 12.6], 2.0, 0, 0, 1.1) });
}
const ident = m4.ident();
for (const s of statics) if (!s.model) s.model = ident;

const waterMesh = (() => {
  const x0 = -HALF, x1 = HALF, z0 = -4.5, z1 = END;
  const pos = new Float32Array([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1]);
  return mesh(gl, { pos, nrm: new Float32Array(18), uv: new Float32Array(12) });
})();

const boatMesh = mesh(gl, paperBoat());
const frogSit = frog(false), frogJump = frog(true);
const frogMeshes = {
  sit: { body: mesh(gl, frogSit.body), eyes: mesh(gl, frogSit.eyes) },
  jump: { body: mesh(gl, frogJump.body), eyes: mesh(gl, frogJump.eyes) },
};
const threadMesh = mesh(gl, { pos: new Float32Array(3 * 600), nrm: new Float32Array(3 * 600), uv: new Float32Array(2 * 600) }, true);

// ---------- seeded scene layout ----------
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const TINTS = [[0.05, 0.10, 0.022], [0.075, 0.12, 0.03], [0.30, 0.22, 0.035], [0.15, 0.075, 0.022], [0.22, 0.20, 0.04]];
const leaves = [];
{
  const r = rng(1411);
  for (let i = 0; i < 17; i++) {
    const kind = r() < 0.55 ? 'mango' : 'peepal';
    const len = kind === 'mango' ? 0.15 + r() * 0.07 : 0.11 + r() * 0.04;
    const wid = kind === 'mango' ? len * 0.22 : len * 0.42;
    const z = 1.1 + (i / 17) * 14.2 + (r() - 0.5) * 0.6;
    const x = (r() * 2 - 1) * (HALF - 0.2);
    leaves.push({ kind, len, wid, tint: TINTS[Math.floor(r() * TINTS.length)], m: mesh(gl, leaf(kind, len, wid, 0.6 + r() * 1.6, i)), x, z, rot: r() * 6.28, vx: 0, vz: 0, spin: (r() - 0.5) * 0.3, mass: 0.25, rad: Math.max(len * 0.42, wid), ph: r() * 6.28 });
  }
  for (const [x, z] of [[0.32, 5.3], [-0.38, 10.9]]) {
    leaves.push({ kind: 'taro', len: 0.30, wid: 0.13, tint: [0.03, 0.075, 0.025], m: mesh(gl, leaf('taro', 0.30, 0.13, 0.5, 9)), x, z, rot: 2.6, vx: 0, vz: 0, spin: 0.02, mass: 2.5, rad: 0.15, ph: 1.0, taro: true });
  }
}
leaves.forEach((l) => { l.x0 = l.x; l.z0 = l.z; l.rot0 = l.rot; });
const frogs = leaves.filter((l) => l.taro).map((l) => ({ leaf: l }));

// ---------- framebuffers ----------
function makeTarget(w, h, internal, format, type, depth) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb = null;
  if (depth) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, rb, w, h, ok };
}
function freeTarget(t) { if (!t) return; gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); if (t.rb) gl.deleteRenderbuffer(t.rb); }

const SIM_RES = 256, SIM_SIZE = 5.0, SIM_TEXEL = SIM_SIZE / SIM_RES;
let sim = null;
{
  const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  if (ext) {
    const a = makeTarget(SIM_RES, SIM_RES, gl.RG16F, gl.RG, gl.HALF_FLOAT, false);
    const b = makeTarget(SIM_RES, SIM_RES, gl.RG16F, gl.RG, gl.HALF_FLOAT, false);
    if (a.ok && b.ok) sim = { a, b, cx: 0, cz: 0, acc: 0, drops: [] };
  }
}
function clearSim() {
  if (!sim) return;
  for (const t of [sim.a, sim.b]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
clearSim();
let refl = null;

// ---------- game state ----------
const snd = new Sound();
const mic = new Mic();
const boat = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, yawV: 0, roll: 0, pitch: 0, y: 0, rollKick: 0 };
const input = { held: false, holdLevel: 0, key: 0, drag: 0, dragId: null, dragX: 0, tilt: 0, tiltAt: 0, dragAt: 0, override: null };
const game = { state: 'intro', time: 0, raceT: 0, blow: 0, steer: 0, started: false, finishedAt: 0, thread: 0, soak: 0, lastScrape: 0, hintUntil: 0, croakAt: 4 };
const cam = { pos: [0, 0.5, -1], look: [0, 0, 1], fov: 1 };
let best = null;
try { best = parseFloat(localStorage.getItem('paperboat.best')) || null; } catch { best = null; }

function resetRace() {
  input.tiltZero = null; // steer relative to how the phone is held when the race starts
  Object.assign(boat, { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, yawV: 0, roll: 0, pitch: 0, rollKick: 0 });
  for (const l of leaves) Object.assign(l, { x: l.x0, z: l.z0, rot: l.rot0, vx: 0, vz: 0 });
  for (const f of frogs) Object.assign(f, { state: 'sit', t: 0, x: f.leaf.x, z: f.leaf.z, y: 0.004, yaw: Math.PI + 0.5, vx: 0, vz: 0 });
  Object.assign(game, { raceT: 0, started: false, thread: 0, soak: 0 });
  clearSim();
  $('time').textContent = '0:00.0';
  $('togo').textContent = Math.round(FIN) + ' m to go';
}
resetRace();

// ---------- UI ----------
const hint = $('hint');
function setHint(text, secs = 0) { hint.textContent = text; game.hintUntil = secs ? game.time + secs : 0; }
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

async function begin(withMic) {
  const ctx = snd.unlock();
  askTilt();
  $('start').hidden = true;
  resetRace();
  if (withMic && ctx && navigator.mediaDevices?.getUserMedia) {
    try {
      $('status').textContent = 'Asking for the mic…';
      await mic.start(ctx);
      game.state = 'calib';
      setHint('Listening to the room for a second. Stay quiet…');
      return;
    } catch (e) {
      setHint('No mic, so hold Blow (or Space) to sail', 6);
    }
  } else {
    setHint('Hold Blow (or Space) to sail. Drag to steer', 6);
  }
  game.state = 'ready';
}
$('go').addEventListener('click', () => begin(true));
$('nomic').addEventListener('click', () => begin(false));
function again() {
  $('win').hidden = true;
  resetRace();
  game.state = mic.active && mic.calibrating ? 'calib' : 'ready';
  setHint(mic.active ? 'Blow to sail' : 'Hold Blow (or Space) to sail', 4);
}
$('again').addEventListener('click', () => { snd.unlock(); if ($('start').hidden) again(); });
$('again2').addEventListener('click', again);
const soundBtn = $('sound');
soundBtn.addEventListener('click', () => {
  snd.unlock();
  snd.setOn(!snd.on);
  soundBtn.setAttribute('aria-pressed', String(snd.on));
  soundBtn.querySelector('.ic').textContent = snd.on ? '🔊' : '🔇';
  soundBtn.querySelector('.lbl').textContent = snd.on ? 'Sound on' : 'Sound off';
});

const blowBtn = $('blow');
const holdOn = (e) => { e.preventDefault(); snd.unlock(); input.held = true; blowBtn.classList.add('held'); try { blowBtn.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
const holdOff = () => { input.held = false; blowBtn.classList.remove('held'); };
blowBtn.addEventListener('pointerdown', holdOn);
blowBtn.addEventListener('pointerup', holdOff);
blowBtn.addEventListener('pointercancel', holdOff);
blowBtn.addEventListener('lostpointercapture', holdOff);
blowBtn.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { if (!e.repeat && $('start').hidden) { snd.unlock(); input.held = true; blowBtn.classList.add('held'); } e.preventDefault(); }
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.key = -1;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.key = 1;
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') holdOff();
  if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && input.key < 0) input.key = 0;
  if ((e.code === 'ArrowRight' || e.code === 'KeyD') && input.key > 0) input.key = 0;
});
canvas.addEventListener('pointerdown', (e) => { snd.unlock(); input.dragId = e.pointerId; input.dragX = e.clientX; input.drag = 0; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== input.dragId) return;
  input.drag = Math.max(-1, Math.min(1, (e.clientX - input.dragX) / (innerWidth * 0.16)));
  input.dragAt = performance.now();
});
const dragEnd = (e) => { if (e.pointerId === input.dragId) { input.dragId = null; input.drag = 0; } };
canvas.addEventListener('pointerup', dragEnd);
canvas.addEventListener('pointercancel', dragEnd);

function askTilt() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  const listen = () => window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null) return;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let v = e.gamma;
    if (ang === 90) v = e.beta; else if (ang === -90 || ang === 270) v = -e.beta;
    if (input.tiltZero == null) input.tiltZero = v;
    input.tilt = Math.max(-1, Math.min(1, (v - input.tiltZero) / 18));
    input.tiltAt = performance.now();
  });
  if (typeof DOE.requestPermission === 'function') DOE.requestPermission().then((r) => { if (r === 'granted') listen(); }).catch(() => {});
  else listen();
}

// ---------- simulation ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth01 = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

function update(dt) {
  game.time += dt;
  const t = game.time;

  // blow strength: the mic, or the hold button / Space, ramped like a breath
  input.holdLevel += ((input.held ? 1 : 0) - input.holdLevel) * Math.min(1, dt * (input.held ? 7 : 5));
  const micLevel = mic.active ? mic.update(dt) : 0;
  let blow = Math.max(micLevel, input.holdLevel);
  if (input.override != null) blow = input.override;
  if (game.state === 'calib') {
    blow = 0;
    if (!mic.calibrating) { game.state = 'ready'; setHint('Blow into the mic to sail. Drag or tilt to steer', 6); }
  }
  if (game.state === 'intro' || game.state === 'done') blow = 0;
  game.blow += (blow - game.blow) * Math.min(1, dt * 10);
  $('meter').style.width = Math.round(game.blow * 100) + '%';

  // steering: drag wins, then keys, then tilt (only if it has been fresh lately)
  let steer = 0;
  if (input.dragId != null) steer = input.drag;
  else if (input.key) steer = input.key;
  else if (performance.now() - input.tiltAt < 1000) steer = Math.abs(input.tilt) > 0.08 ? input.tilt : 0;
  if (game.state === 'intro' || game.state === 'done') steer = 0;
  game.steer += (steer - game.steer) * Math.min(1, dt * 6);

  if (game.state === 'ready' && game.blow > 0.12) { game.state = 'race'; game.started = true; setHint('', 0); }
  if (game.state === 'race') {
    game.raceT += dt;
    game.soak = Math.min(1, game.raceT / 45);
  }
  if (game.hintUntil && t > game.hintUntil) { hint.textContent = ''; game.hintUntil = 0; }

  // boat dynamics: thrust from your breath along the course, quadratic water drag, gentle current
  const sp = Math.hypot(boat.vx, boat.vz);
  const thrust = game.blow * 1.15;
  const fwdx = Math.sin(boat.yaw), fwdz = Math.cos(boat.yaw);
  let ax = thrust * (0.25 * fwdx) - game.steer * 0.75 * (0.35 + Math.min(1, sp * 2));
  let az = thrust * (0.75 + 0.25 * fwdz);
  const drag = 1.0 + 1.3 * sp;
  ax -= boat.vx * drag; az -= boat.vz * drag;
  az += (0.05 - boat.vz) * 0.25;
  ax += Math.sin(t * 0.37 + boat.z) * 0.012;
  if (game.state === 'done') { az += (0.12 - boat.vz) * 0.8; ax += (0 - boat.x) * 0.3 - boat.vx * 0.5; }
  if (game.state === 'intro' || game.state === 'calib' || game.state === 'ready') { ax += -boat.x * 0.4; az += (0 - boat.z) * 0.6 - boat.vz * 1.5; }
  boat.vx += ax * dt; boat.vz += az * dt;
  boat.x += boat.vx * dt; boat.z += boat.vz * dt;

  // walls of the courtyard
  const lim = HALF - 0.075;
  if (Math.abs(boat.x) > lim) {
    const s = Math.sign(boat.x);
    boat.x = s * lim;
    if (boat.vx * s > 0) {
      if (Math.abs(boat.vx) > 0.06 && t - game.lastScrape > 0.4) { snd.scrape(Math.min(1, Math.abs(boat.vx) * 4)); game.lastScrape = t; }
      boat.rollKick += -s * Math.min(0.25, Math.abs(boat.vx) * 1.2);
      boat.vx = -boat.vx * 0.25; boat.vz *= 0.9;
      boat.yawV += -s * 0.6;
    }
  }
  boat.z = Math.min(boat.z, END - 0.6);

  // heading follows the motion like a weathervane, nudged by steering and the waves
  const sp2 = Math.hypot(boat.vx, boat.vz);
  if (sp2 > 0.03) {
    let target = Math.atan2(boat.vx, boat.vz);
    let d = target - boat.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    boat.yawV += d * Math.min(1, sp2 * 6) * 6 * dt;
  }
  boat.yawV += (Math.sin(t * 0.8) * 0.05 + Math.sin(t * 2.3 + 1) * 0.03) * dt;
  boat.yawV *= Math.exp(-dt * 3);
  boat.yaw = clamp(boat.yaw + boat.yawV * dt, -1.3, 1.3);
  boat.rollKick *= Math.exp(-dt * 2.5);
  boat.roll = 0.035 * Math.sin(t * 1.6) + 0.02 * Math.sin(t * 2.9 + 2) + game.steer * 0.1 + boat.rollKick * Math.cos(t * 9);
  boat.pitch = 0.022 * Math.sin(t * 1.9 + 0.5) + game.blow * 0.06 - Math.min(0.04, sp2 * 0.05);
  boat.y = 0.0016 * Math.sin(t * 2.3) + 0.001 * Math.sin(t * 3.7 + 1) - game.blow * 0.002;

  // floating leaves: drift with the current, bob, bump each other and the boat
  for (const l of leaves) {
    l.vz += (0.04 - l.vz) * dt * 0.25;
    l.vx += (Math.sin(t * 0.3 + l.ph) * 0.01 - l.vx) * dt * 0.4;
    l.vx *= Math.exp(-dt * 0.6); l.vz *= Math.exp(-dt * 0.2);
    l.x += l.vx * dt; l.z += l.vz * dt;
    l.rot += l.spin * dt;
    const ll = HALF - l.rad * 0.7;
    if (Math.abs(l.x) > ll) { l.x = Math.sign(l.x) * ll; l.vx *= -0.3; }
    if (l.z > END - 0.3) { l.z = END - 0.3; l.vz = 0; }
    l.spin *= Math.exp(-dt * 0.3);
    const dx = l.x - boat.x, dz = l.z - boat.z, dist = Math.hypot(dx, dz), min = l.rad + 0.085;
    if (dist < min && dist > 1e-4) {
      const nx = dx / dist, nz = dz / dist, pen = min - dist;
      const mb = 1, ml = l.mass, tot = mb + ml;
      boat.x -= nx * pen * ml / tot; boat.z -= nz * pen * ml / tot;
      l.x += nx * pen * mb / tot; l.z += nz * pen * mb / tot;
      const rel = (boat.vx - l.vx) * nx + (boat.vz - l.vz) * nz;
      if (rel > 0) {
        const j = (1.3 * rel) / (1 / mb + 1 / ml);
        boat.vx -= j * nx / mb; boat.vz -= j * nz / mb;
        l.vx += j * nx / ml; l.vz += j * nz / ml;
        l.spin += (Math.random() - 0.5) * rel * 6;
        boat.yawV += (nx > 0 ? -1 : 1) * rel * 3;
        boat.rollKick += (nx > 0 ? 1 : -1) * Math.min(0.12, rel * 0.4);
        if (rel > 0.12 && t - game.lastScrape > 0.3) { snd.scrape(Math.min(0.7, rel * 1.5)); game.lastScrape = t; }
        if (sim && rel > 0.1) sim.drops.push([l.x - nx * l.rad * 0.6, l.z - nz * l.rad * 0.6, 0.03, -0.008 * Math.min(1, rel * 3)]);
      }
    }
  }
  for (let i = 0; i < leaves.length; i++) for (let k = i + 1; k < leaves.length; k++) {
    const a = leaves[i], b = leaves[k];
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = (a.rad + b.rad) * 0.8;
    if (d < min && d > 1e-4) {
      const nx = dx / d, nz = dz / d, pen = (min - d) * 0.5;
      a.x -= nx * pen; a.z -= nz * pen; b.x += nx * pen; b.z += nz * pen;
    }
  }

  // frogs: sit on a taro leaf, croak now and then, leap off when the boat comes close
  let nearFrog = 99;
  for (const f of frogs) {
    const l = f.leaf;
    if (f.state === 'sit') {
      f.x = l.x + Math.sin(l.rot) * 0.02; f.z = l.z + Math.cos(l.rot) * 0.02; f.y = 0.006;
      const dx = f.x - boat.x, dz = f.z - boat.z, d = Math.hypot(dx, dz);
      nearFrog = Math.min(nearFrog, d);
      if (game.state === 'race' && d < 0.8) {
        f.state = 'jump'; f.t = 0;
        const side = f.x > boat.x ? 1 : -1;
        f.from = [f.x, f.z];
        f.to = [clamp(f.x + side * 0.42, -HALF + 0.12, HALF - 0.12), f.z + 0.32];
        f.yaw = Math.atan2(f.to[0] - f.x, f.to[1] - f.z);
        l.vx -= side * 0.08; l.vz -= 0.05; l.spin += side * 0.5;
      }
    } else if (f.state === 'jump') {
      f.t += dt / 0.5;
      const k = Math.min(1, f.t);
      f.x = f.from[0] + (f.to[0] - f.from[0]) * k;
      f.z = f.from[1] + (f.to[1] - f.from[1]) * k;
      f.y = 0.006 + Math.sin(k * Math.PI) * 0.13 - k * 0.02;
      if (f.t >= 1) {
        f.state = 'swim'; f.t = 0;
        f.vx = Math.sin(f.yaw) * 0.12; f.vz = Math.cos(f.yaw) * 0.12;
        snd.plop();
        if (sim) { sim.drops.push([f.x, f.z, 0.06, -0.05]); sim.drops.push([f.x, f.z, 0.025, 0.03]); }
      }
    } else {
      f.t += dt;
      const kick = 0.5 + 0.5 * Math.max(0, Math.sin(f.t * 5));
      f.vx *= Math.exp(-dt * 0.5); f.vz *= Math.exp(-dt * 0.5);
      f.x += f.vx * dt * kick; f.z += f.vz * dt * kick;
      f.x = clamp(f.x, -HALF + 0.05, HALF - 0.05);
      f.y = -0.03;
      if (sim && Math.random() < dt * 3 && Math.hypot(f.vx, f.vz) > 0.02) sim.drops.push([f.x, f.z, 0.02, -0.004]);
    }
  }
  if (game.state === 'race' && nearFrog < 4 && t > game.croakAt) { snd.croak(); game.croakAt = t + 4 + Math.random() * 5; }

  // finish: the thread snaps as the sail breaks through
  if (game.state === 'race' && boat.z > FIN - 0.05) {
    game.state = 'done';
    game.thread = 0.0001;
    snd.finish();
    const time = game.raceT;
    let msg;
    if (best == null || time < best) { msg = best == null ? 'Your first time on the board' : 'New best, by ' + (best - time).toFixed(1) + ' s'; best = time; try { localStorage.setItem('paperboat.best', String(time)); } catch { /* private mode */ } }
    else msg = 'Best ' + fmt(best);
    $('result').textContent = fmt(time);
    $('best').textContent = msg;
    setTimeout(() => { if (game.state === 'done') $('win').hidden = false; }, 1400);
  }
  if (game.thread > 0) game.thread = Math.min(1, game.thread + dt / 0.7);

  snd.setMotion(sp2, clamp(1 - (END - boat.z) / 4, 0, 1));
  if (game.state === 'race' || game.state === 'ready') {
    $('time').textContent = fmt(game.raceT);
    $('togo').textContent = Math.max(0, Math.ceil(FIN - boat.z)) + ' m to go';
  }
  if (game.state === 'done') $('togo').textContent = 'Home';

  followCam(1 - Math.exp(-dt * 4));
  stepSim(dt, sp2);
}

function stepSim(dt, speed) {
  if (!sim) return;
  sim.acc = Math.min(sim.acc + dt, 4 / 60);
  const step = 1 / 60;
  while (sim.acc >= step) {
    sim.acc -= step;
    const ncx = Math.round(boat.x / SIM_TEXEL) * SIM_TEXEL, ncz = Math.round((boat.z + 0.6) / SIM_TEXEL) * SIM_TEXEL;
    const shift = [(ncx - sim.cx) / SIM_SIZE, (ncz - sim.cz) / SIM_SIZE];
    sim.cx = ncx; sim.cz = ncz;
    const drops = new Float32Array(32);
    const n = Math.min(8, sim.drops.length);
    for (let i = 0; i < n; i++) drops.set(sim.drops[i], i * 4);
    sim.drops.splice(0, n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sim.b.fb);
    gl.viewport(0, 0, SIM_RES, SIM_RES);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    P.sim.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sim.a.tex);
    P.sim.i('uPrev', 0).f('uShift', shift[0], shift[1]).f('uTx', 1 / SIM_RES)
      .f('uRect', sim.cx - SIM_SIZE / 2, sim.cz - SIM_SIZE / 2, SIM_SIZE, 0)
      .v4('uDrops', drops).i('uDropN', n)
      .f('uBoat', boat.x, boat.z, boat.yaw, 0.004 + Math.min(1, speed) * 0.03)
      .f('uK', 0.5).f('uDamp', 0.988);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    [sim.a, sim.b] = [sim.b, sim.a];
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// ---------- rendering ----------
let renderScale = 1, W = 0, H = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, HIQ ? 2 : 1.75);
  const w = Math.max(1, Math.round(innerWidth * dpr * renderScale)), h = Math.max(1, Math.round(innerHeight * dpr * renderScale));
  if (w === W && h === H && refl) return;
  W = canvas.width = w; H = canvas.height = h;
  freeTarget(refl);
  refl = makeTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, true);
}
window.addEventListener('resize', resize);
resize();

const FOG = [0.33, 0.35, 0.355];
const EXPOSURE = 1.05;

function cameraMatrices() {
  const asp = W / H;
  const portrait = asp < 1;
  const back = portrait ? 0.5 : 0.48, up = portrait ? 0.4 : 0.34, ahead = portrait ? 0.55 : 0.5;
  cam.target = { back, up, ahead };
  if (!cam.init) followCam(1);
  const hfov = 58 * Math.PI / 180;
  let fovy = 2 * Math.atan(Math.tan(hfov / 2) / asp);
  fovy = clamp(fovy, 42 * Math.PI / 180, 72 * Math.PI / 180);
  cam.fov = fovy;
  const proj = m4.persp(fovy, asp, 0.04, 60);
  const view = cam.debug ? m4.lookAt(cam.debug.pos, cam.debug.look) : m4.lookAt(cam.pos, cam.look);
  return { proj, view, vp: m4.mul(proj, view) };
}

function followCam(k) {
  const c = cam.target || { back: 0.5, up: 0.2, ahead: 0.85 };
  const done = game.state === 'done';
  const back = done ? 1.7 : c.back, up = done ? 0.6 : c.up, ahead = done ? 0.2 : c.ahead;
  const side = (cam.target && cam.target.back === 0.5 ? 0.36 : 0.42) * (1 - 2 * smooth01((boat.x - 0.4) / 0.5));
  const tx = clamp(boat.x + side, -HALF + 0.1, HALF - 0.1), tz = boat.z - back;
  cam.pos[0] += (tx - cam.pos[0]) * k; cam.pos[1] += (up - cam.pos[1]) * k; cam.pos[2] += (tz - cam.pos[2]) * k;
  cam.look[0] += (boat.x * 0.9 - cam.look[0]) * k; cam.look[1] += (0.0 - cam.look[1]) * k; cam.look[2] += (boat.z + ahead - cam.look[2]) * k;
  cam.init = true;
}

const BOAT_SCALE = 1.2;
function boatModel() { return m4.trs([boat.x, boat.y, boat.z], boat.yaw, boat.pitch, boat.roll, BOAT_SCALE); }

function drawObjects(vp, camPos, mirror) {
  const w = P.world.use();
  w.m4('uVP', vp).f('uCam', ...camPos).f('uTime', game.time).f('uFog', ...FOG).f('uExposure', EXPOSURE)
    .f('uClip', mirror ? 1 : 0).f('uFlip', mirror ? 1 : 0).f('uMirror', mirror ? 1 : 0).f('uSoak', game.soak);
  const draw = (m, mat, model, two = 0, tint = [0.5, 0.5, 0.5], part = 0) => {
    w.m4('uModel', model).i('uMat', mat).f('uTwoSided', two).f('uTint', ...tint).i('uPart', part);
    m.draw();
  };
  for (const s of statics) draw(s.m, s.mat, s.model, 0, [0.5, 0.5, 0.5], s.part || 0);
  draw(boatMesh, 3, boatModel(), 1);
  const t = game.time;
  for (const l of leaves) {
    const bob = 0.0012 * Math.sin(t * 2.1 + l.ph);
    draw(l.m, 4, m4.trs([l.x, bob, l.z], l.rot, 0.03 * Math.sin(t * 1.7 + l.ph), 0.03 * Math.sin(t * 1.3 + l.ph * 2)), 1, l.tint);
  }
  for (const f of frogs) {
    const set = f.state === 'sit' ? frogMeshes.sit : frogMeshes.jump;
    const pitch = f.state === 'jump' ? -0.6 + f.t * 1.0 : f.state === 'swim' ? -0.15 : 0;
    const breathe = f.state === 'sit' ? 1 + 0.03 * Math.sin(t * 6) : 1;
    const model = m4.trs([f.x, f.y, f.z], f.yaw, pitch, 0, breathe);
    draw(set.body, 5, model, 0, [0, 0, 0], 0);
    draw(set.eyes, 5, model, 0, [0, 0, 0], 1);
  }
  updateThread(camPos);
  draw(threadMesh, 6, ident, 1);
}

// The finish thread: a red cotton thread sagging between two brick posts; it snaps and falls on the water.
function updateThread(camPos) {
  const lines = [];
  const xL = -(HALF + 0.07), xR = HALF + 0.07, yT = 0.31, NP = 30;
  const b = game.thread;
  if (b === 0) {
    const pts = [];
    for (let i = 0; i <= NP; i++) {
      const u = i / NP, x = xL + (xR - xL) * u, s = (2 * u - 1);
      pts.push([x, yT - 0.2 * (1 - s * s) + 0.004 * Math.sin(game.time * 3 + u * 9), FIN]);
    }
    lines.push(pts);
  } else {
    const e = 1 - Math.pow(1 - b, 3);
    for (const side of [-1, 1]) {
      const pts = [];
      const x0 = side < 0 ? xL : xR;
      for (let i = 0; i <= NP / 2; i++) {
        const u = i / (NP / 2);
        const x = x0 + (0 - x0) * u * (1 - 0.15 * e);
        const s = (x - (xL + xR) / 2) / ((xR - xL) / 2);
        const yTight = yT - 0.2 * (1 - s * s);
        const yFall = u < 0.08 ? yT - (yT - 0.1) * (u / 0.08) : 0.002;
        pts.push([x, yTight + (yFall - yTight) * e, FIN + e * u * u * 0.25]);
      }
      lines.push(pts);
    }
  }
  const pos = [], nrm = [], uv = [];
  const pxWorld = 2 * Math.tan(cam.fov / 2) / H;
  for (const pts of lines) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], c = pts[i + 1];
      const tan = norm(sub(c, a));
      const toCam = norm(sub(camPos, a));
      const side = norm(cross(tan, toCam));
      const dist = Math.hypot(...sub(camPos, a));
      const hw = Math.max(0.0012, dist * pxWorld * 0.9);
      const A0 = [a[0] - side[0] * hw, a[1] - side[1] * hw, a[2] - side[2] * hw], A1 = [a[0] + side[0] * hw, a[1] + side[1] * hw, a[2] + side[2] * hw];
      const C0 = [c[0] - side[0] * hw, c[1] - side[1] * hw, c[2] - side[2] * hw], C1 = [c[0] + side[0] * hw, c[1] + side[1] * hw, c[2] + side[2] * hw];
      pos.push(...A0, ...A1, ...C1, ...A0, ...C1, ...C0);
      for (let k = 0; k < 6; k++) { nrm.push(0, 1, 0); uv.push(i / pts.length, k / 6); }
    }
  }
  const fill = new Float32Array(3 * 600);
  fill.set(pos);
  const nf = new Float32Array(3 * 600); nf.set(nrm);
  const uf = new Float32Array(2 * 600); uf.set(uv);
  threadMesh.update({ pos: fill, nrm: nf, uv: uf });
  threadMesh.count = pos.length / 3;
}

const shadowBuf = new Float32Array(48);
function render() {
  resize();
  const { proj, view, vp } = cameraMatrices();
  const camPos = cam.pos;

  // 1. planar reflection, half resolution: the scene mirrored in the water plane
  const mview = m4.mul(view, new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  const mvp = m4.mul(proj, mview);
  gl.bindFramebuffer(gl.FRAMEBUFFER, refl.fb);
  gl.viewport(0, 0, refl.w, refl.h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
  drawObjects(mvp, [camPos[0], -camPos[1], camPos[2]], true);

  // 2. main view
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  P.sky.use().m4('uInvVP', m4.invert(vp)).f('uCam', ...camPos).f('uTime', game.time).f('uFog', ...FOG).f('uExposure', EXPOSURE);
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
  drawObjects(vp, camPos, false);

  // 3. water
  shadowBuf.fill(0);
  const fw = [Math.sin(boat.yaw), Math.cos(boat.yaw)];
  shadowBuf.set([boat.x + fw[0] * 0.045, boat.z + fw[1] * 0.045, 0.06, 0.4, boat.x - fw[0] * 0.045, boat.z - fw[1] * 0.045, 0.06, 0.4], 0);
  const near = leaves.map((l) => [Math.hypot(l.x - boat.x, l.z - boat.z), l]).sort((a, b) => a[0] - b[0]).slice(0, 8);
  near.forEach(([, l], i) => shadowBuf.set([l.x, l.z, l.rad * 0.75, l.taro ? 0.45 : 0.3], 8 + i * 4));
  frogs.forEach((f, i) => shadowBuf.set([f.x, f.z, 0.03, f.state === 'jump' ? 0.15 : 0.3], 40 + i * 4));
  const w = P.water.use();
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, refl.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sim ? sim.a.tex : refl.tex);
  w.m4('uVP', vp).f('uCam', ...camPos).f('uTime', game.time).f('uFog', ...FOG).f('uExposure', EXPOSURE)
    .i('uRefl', 0).i('uSim', 1).f('uSimOn', sim ? 1 : 0).f('uSimGain', 10.0)
    .f('uSimRect', sim ? sim.cx - SIM_SIZE / 2 : 0, sim ? sim.cz - SIM_SIZE / 2 : 0, SIM_SIZE, 1 / SIM_RES)
    .f('uRes', W, H).v4('uSh', shadowBuf).f('uGust', boat.x, boat.z, game.blow, boat.yaw).f('uHull', boat.x, boat.z, boat.yaw, BOAT_SCALE * 0.93);
  waterMesh.draw();
  gl.activeTexture(gl.TEXTURE0);

  // 4. rain streaks
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  const fwd = norm(sub(cam.look, camPos));
  P.rain.use().m4('uVP', vp).f('uCam', ...camPos).f('uFwd', ...fwd).f('uTime', game.time).f('uRes', W, H).f('uPx', Math.max(0.7, H / 900));
  gl.bindVertexArray(emptyVao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1600);
  gl.disable(gl.BLEND); gl.depthMask(true);
}

// ---------- loop ----------
let last = performance.now(), slowT = 0, fastT = 0, frames = 0, acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  if (!HIQ) {
    // adaptive resolution: keep ~60 fps on mid-range phones
    acc += dt; frames++;
    if (acc > 1) {
      const avg = acc / frames;
      if (avg > 1 / 45) { slowT++; fastT = 0; } else if (avg < 1 / 58) { fastT++; slowT = 0; } else { slowT = fastT = 0; }
      if (slowT >= 2 && renderScale > 0.55) { renderScale = Math.max(0.55, renderScale * 0.85); slowT = 0; }
      if (fastT >= 4 && renderScale < 1) { renderScale = Math.min(1, renderScale / 0.9); fastT = 0; }
      acc = 0; frames = 0;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame((t) => { last = t; frame(t); });

// Test hook: lets an automated check advance the simulation on slow software GPUs.
window.__pb = {
  get state() { return game.state; },
  get boat() { return { ...boat }; },
  get raceT() { return game.raceT; },
  setBlow(v) { input.override = v; },
  setCam(pos, look) { cam.debug = pos ? { pos, look } : null; if (pos) { cam.pos = pos; } },
  get mic() { return mic.last; },
  setSteer(v) { input.key = v; },
  advance(sec) { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) update(1 / 60); },
};
