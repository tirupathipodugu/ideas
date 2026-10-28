// Doodle Alive: hold a drawing up to the camera and it peels off the paper and starts living in your room.
// The camera fills the screen (mirrored for the selfie camera). Body tracking gives a person mask and hand
// points: the mask is the terrain doodles climb on and the layer they hide behind, the hands swat them.

import { extractDoodle } from './extract.js';
import { Creature } from './creature.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d');
const video = $('cam');
const sound = new Sound();
const MAX_DOODLES = 6;

let W = 0, H = 0, dpr = 1;
let source = null;              // { el, w, h, mirror }
let stream = null;
let facing = 'user';
let pose = null;
let poseLoading = false;
let eyesOn = true;
let counting = 0;
const doodles = [];

// Person mask, as a canvas the size of the camera frame.
const maskCanvas = document.createElement('canvas'), maskCtx = maskCanvas.getContext('2d');
const personCanvas = document.createElement('canvas'), personCtx = personCanvas.getContext('2d');
let maskImage = null;
const BUCKETS = 72;
const bodyTop = new Float32Array(BUCKETS).fill(Infinity);
const hands = [{ x: 0, y: 0, vx: 0, vy: 0, seen: false }, { x: 0, y: 0, vx: 0, vy: 0, seen: false }];
let face = null;

const world = {
  W: 0, H: 0, floor: 0, person: false, personX: 0,
  ground(x0, x1, layer) {
    let g = this.floor;
    if (layer === 'front' && this.person) {
      const b0 = Math.max(0, Math.floor(x0 / W * BUCKETS)), b1 = Math.min(BUCKETS - 1, Math.floor(x1 / W * BUCKETS));
      for (let b = b0; b <= b1; b++) g = Math.min(g, bodyTop[b]);
    }
    return g;
  },
};

// ---------- layout ----------

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth;
  H = window.innerHeight;
  view.width = Math.round(W * dpr);
  view.height = Math.round(H * dpr);
  world.W = W;
  world.H = H;
  const bar = $('controls').getBoundingClientRect();
  world.floor = Math.min(H - 20, bar.top - 14);
}
window.addEventListener('resize', resize);

/** Cover-fit transform from source pixels to screen. */
function fit() {
  const k = Math.max(W / source.w, H / source.h);
  return { k, ox: (W - source.w * k) / 2, oy: (H - source.h * k) / 2, m: source.mirror };
}
function toScreen(t, vx, vy) {
  const x = t.ox + vx * t.k;
  return { x: t.m ? W - x : x, y: t.oy + vy * t.k };
}

/** The capture box: a big square in the middle of the screen, above the controls. */
function guideBox() {
  const top = 84, bottom = world.floor - 30;
  const s = Math.max(120, Math.min(W - 48, bottom - top, 520));
  return { x: (W - s) / 2, y: top + (bottom - top - s) / 2, w: s, h: s };
}

// ---------- camera ----------

async function startCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));
  source = { el: video, w: video.videoWidth, h: video.videoHeight, mirror: facing === 'user', live: true };
}

/** A pretend camera for trying it without one: a sheet of paper with a little monster on it. */
function demoSource() {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const g = c.getContext('2d');
  const paint = (t) => {
    const grad = g.createLinearGradient(0, 0, 0, 720);
    grad.addColorStop(0, '#5b6b7c');
    grad.addColorStop(1, '#2b3440');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1280, 720);
    g.save();
    g.translate(640 + Math.sin(t / 900) * 6, 360 + Math.cos(t / 700) * 4);
    g.rotate(-0.02);
    g.fillStyle = '#f4f1ea';
    g.fillRect(-250, -320, 500, 640);
    g.scale(0.42, 0.42);
    g.strokeStyle = '#1d2230';
    g.lineWidth = 7;
    g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    g.ellipse(0, -10, 120, 140, 0, 0, Math.PI * 2);             // body
    g.moveTo(-140, -60); g.quadraticCurveTo(-110, -150, -60, -150);   // horns
    g.moveTo(140, -60); g.quadraticCurveTo(110, -150, 60, -150);
    g.moveTo(-50, 125); g.lineTo(-60, 210); g.lineTo(-95, 215);    // legs
    g.moveTo(50, 125); g.lineTo(60, 210); g.lineTo(95, 215);
    g.moveTo(-118, 10); g.lineTo(-190, -30);                      // arms
    g.moveTo(118, 10); g.lineTo(190, -30);
    g.moveTo(-55, 40); g.quadraticCurveTo(0, 95, 55, 40);         // smile
    g.stroke();
    g.fillStyle = '#ff5a7a';
    g.beginPath();
    for (let i = -2; i <= 2; i++) g.arc(i * 40, -80, 9, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  paint(0);
  return { el: c, w: c.width, h: c.height, mirror: false, live: false, paint };
}

// ---------- body tracking ----------

async function loadPose() {
  if (pose || poseLoading) return;
  poseLoading = true;
  try {
    const { PoseTracker } = await import('../../body-mirror/js/pose.js');
    pose = await Promise.race([
      PoseTracker.create('lite'),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 30000)),
    ]);
  } catch (err) {
    console.warn('Body tracking unavailable:', err);
  }
  poseLoading = false;
}

let lastPose = 0;
function track(now) {
  world.person = false;
  face = null;
  if (!pose || !source.live || video.readyState < 2) return;
  if (now - lastPose < 30) { world.person = pose.found; return; }
  const dt = Math.max(0.016, (now - lastPose) / 1000);
  lastPose = now;
  if (!pose.detect(video, now)) { hands.forEach((h) => (h.seen = false)); return; }
  world.person = true;
  const t = fit();

  if (pose.maskFresh && pose.mask) {
    pose.maskFresh = false;
    const mw = pose.maskW, mh = pose.maskH;
    if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
      maskCanvas.width = personCanvas.width = mw;
      maskCanvas.height = personCanvas.height = mh;
      maskImage = maskCtx.createImageData(mw, mh);
      maskImage.data.fill(255);
    }
    const d = maskImage.data, m = pose.mask;
    for (let i = 0; i < m.length; i++) d[i * 4 + 3] = m[i];
    maskCtx.putImageData(maskImage, 0, 0);

    // Top of the body for each strip of the screen: what doodles stand on.
    const sx = source.w / mw, sy = source.h / mh;
    let sumX = 0, cnt = 0;
    for (let b = 0; b < BUCKETS; b++) {
      let screenX = (b + 0.5) / BUCKETS * W;
      if (t.m) screenX = W - screenX;
      const vx = (screenX - t.ox) / t.k / sx;
      bodyTop[b] = Infinity;
      if (vx < 0 || vx >= mw) continue;
      const col = Math.floor(vx);
      for (let y = 0; y < mh; y += 3) {
        if (m[y * mw + col] > 150) {
          const p = toScreen(t, 0, y * sy);
          bodyTop[b] = p.y;
          sumX += (b + 0.5) / BUCKETS * W;
          cnt++;
          break;
        }
      }
    }
    world.personX = cnt ? sumX / cnt : W / 2;
  }

  // Hands: index fingers (19, 20), falling back to wrists (15, 16). Nose (0) for the face.
  const P = pose.points;
  [[19, 15], [20, 16]].forEach(([fi, wi], i) => {
    const idx = P[fi * 3 + 2] > 0.5 ? fi : wi;
    const h = hands[i];
    if (P[idx * 3 + 2] < 0.5) { h.seen = false; return; }
    const p = toScreen(t, P[idx * 3] * source.w, P[idx * 3 + 1] * source.h);
    if (h.seen) { h.vx = (p.x - h.x) / dt; h.vy = (p.y - h.y) / dt; } else { h.vx = h.vy = 0; }
    h.x = p.x;
    h.y = p.y;
    h.seen = true;
  });
  if (P[2] > 0.5) face = toScreen(t, P[0] * source.w, P[1] * source.h);
}

// ---------- capture ----------

async function capture() {
  if (counting || !source) return;
  sound.ready();
  $('capture').disabled = true;
  const num = $('count');
  for (let i = 3; i >= 1; i--) {
    counting = i;
    num.textContent = i;
    num.hidden = false;
    num.classList.remove('pop');
    void num.offsetWidth;
    num.classList.add('pop');
    sound.beep(false);
    await new Promise((r) => setTimeout(r, 750));
  }
  num.hidden = true;
  counting = 0;
  $('capture').disabled = false;

  const box = guideBox(), t = fit();
  // Box corners back into camera pixels (un-mirroring for the selfie camera).
  const left = t.m ? W - (box.x + box.w) : box.x;
  const sx = (left - t.ox) / t.k, sy = (box.y - t.oy) / t.k, s = box.w / t.k;
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
  const res = extractDoodle(source.el, x0, y0, Math.min(source.w - x0, s), Math.min(source.h - y0, s));
  if (res.error) {
    sound.fail();
    say(res.error, 4200);
    flash('miss');
    return;
  }
  // The sticker starts exactly where the drawing was on screen.
  const c = res.crop;
  const a = toScreen(t, c.x, c.y), b = toScreen(t, c.x + c.w, c.y + c.h);
  const rect = { x: Math.min(a.x, b.x), y: a.y, w: Math.abs(b.x - a.x), h: b.y - a.y };
  const maxW = Math.min(W, H) * 0.5;
  let target = Math.max(96, Math.min(240, Math.min(W, H) * 0.27));
  target = Math.min(target, maxW / (res.sprite.width / res.sprite.height));
  const doodle = new Creature(res.sprite, res.eyes, rect, target);
  doodles.push(doodle);
  if (doodles.length > MAX_DOODLES) doodles.shift();
  flash('hit');
  sound.peel();
  say(doodles.length === 1
    ? 'It\'s alive! Grab it, throw it, or let it climb on you.'
    : `${doodles.length} doodles. Draw another one!`, 5000);
  $('clear').disabled = false;
}

function flash(kind) {
  const f = $('flash');
  f.className = 'flash ' + kind;
  void f.offsetWidth;
  f.classList.add('go');
}

let sayTimer = 0;
function say(text, ms = 0) {
  $('hint').textContent = text;
  clearTimeout(sayTimer);
  if (ms) sayTimer = setTimeout(() => { $('hint').textContent = defaultHint(); }, ms);
}
function defaultHint() {
  return doodles.length ? 'Hold up another drawing, or poke one.' : 'Draw something on paper and hold it inside the box.';
}

// ---------- touch ----------

let held = null;
view.addEventListener('pointerdown', (e) => {
  sound.ready();
  for (let i = doodles.length - 1; i >= 0; i--) {
    const d = doodles[i];
    if (d.state !== 'peel' && d.contains(e.clientX, e.clientY)) {
      held = { d, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, id: e.pointerId };
      d.pick(e.clientX, e.clientY);
      d.drag(e.clientX, e.clientY, performance.now());
      view.setPointerCapture(e.pointerId);
      doodles.splice(i, 1);
      doodles.push(d);   // on top
      return;
    }
  }
});
view.addEventListener('pointermove', (e) => {
  if (!held || e.pointerId !== held.id) return;
  if (Math.hypot(e.clientX - held.x, e.clientY - held.y) > 10) held.moved = true;
  held.d.drag(e.clientX, e.clientY, performance.now());
});
const release = (e) => {
  if (!held || e.pointerId !== held.id) return;
  const d = held.d, quickTap = !held.moved && performance.now() - held.t < 250;
  d.drop(performance.now());
  if (quickTap) { d.state = 'walk'; d.tickle(); d.events = d.events.filter((ev) => ev.type !== 'release'); }
  held = null;
};
view.addEventListener('pointerup', release);
view.addEventListener('pointercancel', release);

// ---------- frame ----------

function play(ev) {
  switch (ev.type) {
    case 'hop': sound.hop(); break;
    case 'land': sound.land(ev.power); break;
    case 'bounce': sound.boing(ev.power); break;
    case 'step': sound.step(); break;
    case 'grab': sound.squeak(); break;
    case 'throw': sound.whee(); break;
    case 'swat': sound.whee(); break;
    case 'giggle': sound.giggle(); break;
    case 'bonk': sound.bonk(); break;
    case 'sneak': sound.sneak(); break;
    case 'peekaboo': sound.peekaboo(); break;
  }
}

function drawCamera(t) {
  ctx.save();
  if (t.m) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source.el, t.ox, t.oy, source.w * t.k, source.h * t.k);
  ctx.restore();
}

function drawPerson(t) {
  if (!world.person || !maskImage) return;
  personCtx.globalCompositeOperation = 'copy';
  personCtx.drawImage(source.el, 0, 0, personCanvas.width, personCanvas.height);
  personCtx.globalCompositeOperation = 'destination-in';
  personCtx.drawImage(maskCanvas, 0, 0);
  ctx.save();
  if (t.m) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(personCanvas, t.ox, t.oy, source.w * t.k, source.h * t.k);
  ctx.restore();
}

function drawGuide(now) {
  const b = guideBox();
  const r = 22;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 12]);
  ctx.lineDashOffset = -now / 40;
  ctx.strokeStyle = counting ? '#ffd166' : 'rgba(255, 255, 255, 0.9)';
  ctx.stroke();
  ctx.restore();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (source) {
    if (source.paint) source.paint(now);
    track(now);
    const t = fit();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCamera(t);

    // Hands swat doodles they sweep through quickly; eyes follow the nearest hand, else your face.
    for (const d of doodles) {
      d.look = face;
      let best = Infinity;
      for (const h of hands) {
        if (!h.seen) continue;
        const dx = h.x - d.x, dy = h.y - (d.y - d.h / 2), dist = Math.hypot(dx, dy);
        if (dist < d.h * 2.5 && dist < best) { best = dist; d.look = h; }
        const speed = Math.hypot(h.vx, h.vy);
        if (d.layer === 'front' && dist < d.h * 0.7 && speed > d.h * 6 && d.state !== 'air') d.swat(h.vx, h.vy);
      }
      d.eyesOn = eyesOn;
      d.update(dt, world);
      for (const ev of d.events) play(ev);
      d.events.length = 0;
    }

    const back = doodles.filter((d) => d.layer === 'back');
    const front = doodles.filter((d) => d.layer === 'front');
    for (const d of back) { d.drawShadow(ctx, world); d.draw(ctx); }
    if (back.length) drawPerson(t);
    for (const d of front) d.drawShadow(ctx, world);
    for (const d of front) d.draw(ctx);
    if (doodles.length < 1 || counting) drawGuide(now);
    else if (doodles.length) drawGuideFaint(now);
  }
  requestAnimationFrame(frame);
}

function drawGuideFaint() {
  const b = guideBox();
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 22);
  ctx.stroke();
  ctx.restore();
}

// ---------- controls ----------

function setSound(on) {
  sound.on = on;
  const b = $('sound');
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = `<span aria-hidden="true">${on ? '🔊' : '🔇'}</span> ${on ? 'Sound on' : 'Sound off'}`;
  if (on) sound.ready();
}
$('sound').addEventListener('click', () => setSound(!sound.on));
$('capture').addEventListener('click', capture);
$('eyes').addEventListener('click', () => {
  eyesOn = !eyesOn;
  $('eyes').setAttribute('aria-pressed', String(eyesOn));
  $('eyes').innerHTML = `<span aria-hidden="true">👀</span> ${eyesOn ? 'Eyes on' : 'Eyes off'}`;
});
$('clear').addEventListener('click', () => {
  doodles.length = 0;
  $('clear').disabled = true;
  say(defaultHint());
});
$('flip').addEventListener('click', async () => {
  if (!source || !source.live) return;
  facing = facing === 'user' ? 'environment' : 'user';
  try { await startCamera(); } catch { facing = facing === 'user' ? 'environment' : 'user'; await startCamera(); }
});

async function begin(useCamera) {
  sound.ready();
  $('status').textContent = useCamera ? 'Opening the camera…' : '';
  try {
    if (useCamera) await startCamera();
    else source = demoSource();
  } catch (err) {
    $('status').textContent = 'Couldn\'t open the camera. Allow it in your browser, or try the sample drawing.';
    return;
  }
  $('start').hidden = true;
  resize();
  say(useCamera ? defaultHint() : 'Sample paper loaded. Tap “Bring to life”.');
  if (source.live) loadPose();
}
$('go').addEventListener('click', () => begin(true));
$('nocam').addEventListener('click', () => begin(false));

resize();
setSound(true);
requestAnimationFrame(frame);
window.doodle = { capture, doodles, world };
