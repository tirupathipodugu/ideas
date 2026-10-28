// Bubbles: the old Windows bubble screensaver, rebuilt with real bubble physics and your camera.
// Your camera fills the screen; bubbles drift in from the corner and every one reflects you from a moment in the past. Blow at the screen and bubbles come out of your mouth; wave
// and they gust away; they land on your head and shoulders; tap to pop, hold to freeze and shatter,
// drag to stretch a giant one, hold empty space to slow time, tilt or shake the phone, and "Bubble me"
// floats you off inside one.
//
// Gestures: tap a bubble = pop · hold a bubble = freeze, let go = shatter · tap empty = blow one ·
// drag empty = giant bubble · hold empty = slow motion.

import { openCamera, cameraProblem, PROBLEMS } from './camera.js';
import { createDemoFeed } from './demo-feed.js';
import { Renderer } from './render.js';
import { World } from './world.js';
import { Sea } from './sea.js';
import { Sound } from './sound.js';
import { Body, Face, Tilt } from './senses.js';

const SUBSTEPS = 3;
const HOLD_FREEZE_MS = 220;
const HOLD_SLOW_MS = 260;
const DRAG_PX = 14;
const SLOW = 0.05;

const $ = id => document.getElementById(id);
const canvas = $('view');
const video = $('cam');
const startScreen = $('start');
const statusLine = $('status');
const hint = $('hint');
const badge = $('badge');
const soundButton = $('sound');
const meButton = $('me');
const flipButton = $('flip');
const fullButton = $('full');
const waterButton = $('water');

const renderer = new Renderer(canvas);
const gl = renderer.gl;
if (!gl) statusLine.textContent = PROBLEMS.webgl;

let timeScale = 1;
const sound = new Sound();
const world = new World({
  pop: (b, big) => sound.pop(big, timeScale, world.water),
  blub: size => sound.blub(Math.min(1, size)),
  shatter: (b, big) => sound.shatter(big),
  crackle: () => sound.crackle(),
  whoosh: (len, level) => sound.whoosh(len, level),
  thud: () => sound.thud(),
});

let W = 0, H = 0;
const sea = new Sea();

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (gl) renderer.resize(W, H, dpr);
  world.resize(W, H);
  sea.resize(W, H);
}
window.addEventListener('resize', resize);
resize();
const unit = () => Math.min(W, H);

// ---------- Senses ----------

let source = null;          // the camera (or the demo feed)
let usingCamera = false;
let facing = 'user';
let body = null;            // body tracking, once loaded
let face = null;            // face tracking (lips, blowing), once loaded
let faceTurn = false;       // body and face take turns on camera frames
let blowCarry = 0;
const tilt = new Tilt(() => world.chainPop());
const hands = [{ seen: false }, { seen: false }];
let mouth = null;
let lastDetect = 0;

const mirrored = () => usingCamera && facing === 'user';

/** Camera-normalised point → screen px (the camera is cropped to fill the screen). */
function camToScreen(nx, ny) {
  const [cx, cy] = renderer.cover();
  let sx = (nx - 0.5) / cx + 0.5;
  const sy = (ny - 0.5) / cy + 0.5;
  if (mirrored()) sx = 1 - sx;
  return { x: sx * W, y: sy * H };
}

function maskAt(mask, x, y) {
  const [cx, cy] = renderer.cover();
  let sx = x / W;
  if (mirrored()) sx = 1 - sx;
  const nx = 0.5 + (sx - 0.5) * cx;
  const ny = 0.5 + (y / H - 0.5) * cy;
  if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return 0;
  const w = body.maskW;
  return mask[Math.floor(ny * body.maskH) * w + Math.floor(nx * w)] / 255;
}

const solid = (x, y) => maskAt(body.mask, x, y);
const moved = (x, y) => (body.prevMask ? Math.abs(maskAt(body.mask, x, y) - maskAt(body.prevMask, x, y)) : 0);

/** After each body detection: where your hands and mouth are, and how fast your hands move. */
function readBody(now) {
  const dt = Math.max(0.016, (now - lastDetect) / 1000);
  lastDetect = now;
  const sides = [[15, 17, 19], [16, 18, 20]];   // wrist, pinky, index: left then right
  sides.forEach((ids, i) => {
    const pts = ids.map(id => body.point(id));
    const h = hands[i];
    if (pts.some(p => !p)) { h.seen = false; return; }
    const c = camToScreen((pts[0].x + pts[1].x + pts[2].x) / 3, (pts[0].y + pts[1].y + pts[2].y) / 3);
    const tip = camToScreen(pts[2].x, pts[2].y);
    if (h.seen) {
      h.vx += ((c.x - h.x) / dt - h.vx) * 0.5;
      h.vy += ((c.y - h.y) / dt - h.vy) * 0.5;
      h.tipSpeed = Math.hypot(tip.x - h.tipX, tip.y - h.tipY) / dt;
    } else {
      h.vx = 0; h.vy = 0; h.tipSpeed = 0;
    }
    h.x = c.x; h.y = c.y; h.tipX = tip.x; h.tipY = tip.y;
    h.seen = true;
  });
  const a = body.point(9), b = body.point(10);
  if (!(face && face.mouth)) mouth = a && b ? camToScreen((a.x + b.x) / 2, (a.y + b.y) / 2) : null;
}

// ---------- Gestures ----------

const gestures = new Map();
let slowHolds = 0;

canvas.addEventListener('pointerdown', e => {
  sound.unlock();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not a live pointer */ }
  const b = world.pick(e.clientX, e.clientY);
  const diver = !b && world.water && sea.hitDiver(e.clientX, e.clientY);
  if (diver) sea.callDiver(world);
  gestures.set(e.pointerId, {
    mode: b ? 'bubble' : diver ? 'none' : 'empty', bubble: b, wand: null,
    x0: e.clientX, y0: e.clientY, t0: performance.now(),
    x: e.clientX, y: e.clientY, vx: 0, vy: 0, t: performance.now(),
  });
});

canvas.addEventListener('pointermove', e => {
  const g = gestures.get(e.pointerId);
  if (!g) return;
  const now = performance.now();
  const dt = Math.max(1, now - g.t) / 1000;
  g.vx += ((e.clientX - g.x) / dt - g.vx) * 0.4;
  g.vy += ((e.clientY - g.y) / dt - g.vy) * 0.4;
  g.x = e.clientX; g.y = e.clientY; g.t = now;
  const far = Math.hypot(g.x - g.x0, g.y - g.y0);
  if (g.mode === 'empty' && far > DRAG_PX) {
    if (world.water) g.mode = 'stir';            // under water a swipe stirs the water instead
    else {
      g.wand = world.wandStart(g.x0, g.y0);
      g.mode = g.wand ? 'wand' : 'none';
    }
  }
  if (g.mode === 'stir') world.fluid.splat(g.x, g.y, g.vx, g.vy, unit() * 0.09);
  if (g.mode === 'wand') world.wandMove(g.wand, g.x, g.y);
  if (g.mode === 'bubble' && far > 24) g.mode = 'none';
});

function endGesture(e, cancelled) {
  const g = gestures.get(e.pointerId);
  if (!g) return;
  gestures.delete(e.pointerId);
  if (g.mode === 'bubble' && !cancelled && g.bubble.pop === 0) world.poke(g.bubble, g.x, g.y);
  else if (g.mode === 'freeze') world.endFreeze(g.bubble);
  else if (g.mode === 'empty' && !cancelled) world.tapBubble(g.x, g.y);
  else if (g.mode === 'wand') world.wandRelease(g.wand, g.vx, g.vy);
  else if (g.mode === 'slow') slowHolds--;
}
canvas.addEventListener('pointerup', e => endGesture(e, false));
canvas.addEventListener('pointercancel', e => endGesture(e, true));

/** Holds turn into freezing (on a bubble) or slow motion (on empty space). */
function checkHolds(now) {
  for (const g of gestures.values()) {
    if (g.mode === 'bubble' && now - g.t0 > HOLD_FREEZE_MS) {
      if (g.bubble.pop > 0) { g.mode = 'none'; continue; }
      world.startFreeze(g.bubble, g.x, g.y);
      g.mode = 'freeze';
    } else if (g.mode === 'empty' && now - g.t0 > HOLD_SLOW_MS) {
      g.mode = 'slow';
      slowHolds++;
    }
  }
}

// ---------- Controls ----------

function showSound() {
  soundButton.setAttribute('aria-pressed', String(sound.on));
  soundButton.innerHTML = sound.on ? '<span aria-hidden="true">🔊</span> Sound on' : '<span aria-hidden="true">🔇</span> Sound off';
}
showSound();
soundButton.addEventListener('click', () => { sound.setOn(!sound.on); showSound(); });

meButton.addEventListener('click', () => {
  sound.unlock();
  const u = unit();
  let x = W / 2, y = H * 0.45, R = u * 0.4;
  const nose = body && body.point(0), l = body && body.point(11), r = body && body.point(12);
  if (nose && l && r) {
    const n = camToScreen(nose.x, nose.y), a = camToScreen(l.x, l.y), b = camToScreen(r.x, r.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    x = n.x + (mx - n.x) * 0.5;
    y = n.y + (my - n.y) * 0.5;
    R = Math.max(u * 0.28, Math.min(u * 0.46, Math.hypot(a.x - b.x, a.y - b.y) * 0.75));
  }
  world.startTrap(x, y, R);
});

flipButton.addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  if (!(await startCamera())) facing = facing === 'user' ? 'environment' : 'user';
});

function setWater(on) {
  world.water = on;
  sound.ambience(on);
  waterButton.setAttribute('aria-pressed', String(on));
  waterButton.innerHTML = on ? '<span aria-hidden="true">🌊</span> Underwater' : '<span aria-hidden="true">🌤️</span> In the air';
  try { localStorage.setItem('bubbles:water', on ? 'on' : 'off'); } catch { /* private mode */ }
}
let startWater = true;
try { startWater = localStorage.getItem('bubbles:water') !== 'off'; } catch { /* private mode */ }
setWater(startWater);
waterButton.addEventListener('click', () => { sound.unlock(); setWater(!world.water); });

fullButton.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
if (!document.documentElement.requestFullscreen) fullButton.hidden = true;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) sound.ctx?.suspend();
  else if (sound.on) sound.ctx?.resume();
});

const TIPS = [
  'Purse your lips and blow: bubbles come out of your mouth',
  'Wave your hand to push them',
  'Hold a bubble to freeze it, let go to shatter it',
  () => world.water ? 'Swipe to stir the water into whirlpools' : 'Drag across empty space for a giant bubble',
  'Hold empty space for slow motion',
  'Tap “Bubble me” to float away',
  'Tilt your phone, or shake it',
  () => world.water ? 'Tap the diver: that’s you in the mask' : 'Tap empty space to blow a bubble',
  () => world.water ? 'Tap a big bubble to split it' : 'Let bubbles touch to make double bubbles',
];
let tip = 0, tipTimer = 0;
function rotateTips(dt) {
  tipTimer += dt;
  if (tipTimer < 4.5) return;
  tipTimer = 0;
  do tip = (tip + 1) % TIPS.length;
  while (!usingCamera && (tip === 1 || tip === 5));
  hint.textContent = typeof TIPS[tip] === 'function' ? TIPS[tip]() : TIPS[tip];
}

let badgeNote = '';          // a lasting note ("Loading body tracking…"); slow motion shows over it
function showBadge() {
  const text = timeScale < 0.6 ? 'Slow motion' : badgeNote;
  badge.textContent = text;
  badge.hidden = !text;
}

// ---------- Camera, body, face ----------

async function startCamera() {
  try {
    const cam = await openCamera(video, facing);
    source?.stop();
    source = cam;
    usingCamera = true;
    return true;
  } catch (error) {
    statusLine.textContent = PROBLEMS[cameraProblem(error)];
    return false;
  }
}

const LOAD_TIMEOUT_MS = 25000;

/** Give up waiting on a model that never finishes loading (it can hang on some phones). */
function withTimeout(promise) {
  return Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error('timeout')), LOAD_TIMEOUT_MS))]);
}

function note(text, ms) {
  badgeNote = text;
  if (ms) setTimeout(() => { if (badgeNote === text) badgeNote = ''; }, ms);
}

// The two models load one after the other: MediaPipe can stall when two tasks start at once.
async function startTracking() {
  note('Loading body tracking…');
  try {
    body = await withTimeout(Body.create());
    note('');
  } catch {
    note('Body tracking unavailable', 3000);
  }
  try {
    face = await withTimeout(Face.create());   // lips, for blowing bubbles
  } catch {
    face = null;              // no face tracking: tapping still makes bubbles
    note('Blowing unavailable, tap to make bubbles', 4000);
  }
}

// ---------- Frame ----------

let last = 0;
function frame(nowMs) {
  const t = nowMs / 1000;
  const dt = Math.min(0.05, last ? t - last : 0.016);
  last = t;

  if (source && source.takeFrame()) {
    renderer.uploadFrame(source, t);
    faceTurn = !faceTurn;
    if (face && usingCamera && (faceTurn || !body)) {
      face.detect(source, nowMs);
      if (face.mouth) mouth = camToScreen(face.mouth.x, face.mouth.y);
    } else if (body && usingCamera) {
      body.detect(source, nowMs);
      if (body.mask) renderer.uploadMask(body.mask, body.maskW, body.maskH);
      readBody(nowMs);
    }
  }
  const tracking = !!(body && usingCamera && body.found && body.mask);

  // Blowing: bubbles stream out of your mouth (or the bottom of the screen), more and bigger the harder you blow.
  const blow = face && usingCamera ? face.update(dt) : 0;
  if (blow > 0) {
    blowCarry += dt * (world.water ? 10 + 45 * blow : 5 + 22 * blow);
    const from = mouth || { x: W / 2, y: H * 0.88 };
    while (blowCarry >= 1) { blowCarry--; world.blowFrom(from.x, from.y, blow); }
  }

  checkHolds(nowMs);
  const target = slowHolds > 0 ? SLOW : 1;
  timeScale += (target - timeScale) * Math.min(1, dt * 8);
  showBadge();

  const env = {
    solid: tracking && !world.trap ? solid : null,
    moved,
    hands: tracking ? hands.filter(h => h.seen) : [],
    mouth: blow > 0 ? mouth : null,
    breath: blow,
    tilt: Math.abs(tilt.x) + Math.abs(tilt.y) > 0.05 ? tilt : null,
  };
  if (world.water) {
    for (const h of env.hands) {
      if (Math.hypot(h.vx, h.vy) > unit() * 0.3) world.fluid.splat(h.x, h.y, h.vx, h.vy, unit() * 0.12, 0.5);
    }
    if (blow > 0 && mouth) world.fluid.splat(mouth.x, mouth.y - unit() * 0.04, 0, -unit() * 0.9 * blow, unit() * 0.05, 0.4);
    world.fluid.step(dt * timeScale, world.bubbles);
    renderer.uploadFlow(world.fluid);
    const touches = [...gestures.values()].filter(g => g.mode !== 'none').map(g => ({ x: g.x, y: g.y }));
    sea.update(dt * timeScale, { fluid: world.fluid, touches, hands: env.hands, mouth, blowing: blow > 0, world });
    sea.draw(source && { element: source.element, box: face && usingCamera ? face.box : null, mirrored: mirrored() });
    renderer.uploadSea(sea.canvas);
  }
  const sdt = dt * timeScale / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i++) world.step(sdt, env);

  meButton.disabled = !!world.trap;
  rotateTips(dt);
  renderer.draw({ time: t, dt, world, mirror: mirrored(), personOn: tracking });
  requestAnimationFrame(frame);
}

// ---------- Start ----------

function begin() {
  startScreen.hidden = true;
  hint.textContent = TIPS[0];
}

if (gl) {
  world.seed(10);
  requestAnimationFrame(frame);

  $('go').addEventListener('click', async () => {
    sound.unlock();
    Tilt.ask();
    statusLine.textContent = 'Opening camera…';
    if (!(await startCamera())) return;
    begin();
    startTracking();
  });
  $('nocam').addEventListener('click', () => {
    sound.unlock();
    Tilt.ask();
    source = createDemoFeed();
    usingCamera = false;
    flipButton.hidden = true;
    meButton.hidden = true;
    begin();
  });
}

// For poking at it from the console.
window.bubbles = { world, get timeScale() { return timeScale; } };
