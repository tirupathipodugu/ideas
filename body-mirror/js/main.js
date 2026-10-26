// Body Mirror: wires the camera, body tracking, the plate and the timeline to the warp. Each new video
// frame is tracked and then drawn with the points and mask from that same frame, so the change never
// slides behind the body.

import { Warp } from './warp.js';
import { buildDeformers, poseToCanvas } from './rig.js';
import { bodyParams, smoothBody, ZERO_BODY, TRAINING, GAIN_CAP_KG, LEAN_CAP_KG } from './body.js';
import { Sound } from '../../macro-mirror/js/sound.js';
import {
  FOODS, DEFAULT_PLATE, ACTIVITY, AGE_BANDS, SEXES, STOPS,
  daysAt, kgAfter, maintenance, intake, betterPlate, formatKg,
} from '../../macro-mirror/js/model.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const PROBLEMS = {
  blocked: "Camera is blocked. Allow it in your browser's address bar, then try again.",
  missing: 'No camera found. Connect one and try again.',
  busy: 'Your camera is busy in another app. Close it there, then try again.',
  insecure: 'The camera only works on a secure (https) page. Open the https link and try again.',
  webgl: "This browser can't run WebGL2, which the mirror needs. Try a recent Chrome, Safari or Firefox.",
  tracking: "Body tracking couldn't start on this browser. Try a recent Chrome or Safari.",
};
function problemOf(error) {
  switch (error && error.name) {
    case 'NotAllowedError': case 'SecurityError': return 'blocked';
    case 'NotReadableError': case 'AbortError': return 'busy';
    case 'InsecureContext': return 'insecure';
    case 'WebGL': return 'webgl';
    case 'Tracking': return 'tracking';
    default: return 'missing';
  }
}

// ---- State -----------------------------------------------------------------------------------
const state = {
  plate: {},
  profile: { age: '30', sex: 'x', height: 170, weight: 72, activity: 'walk', training: 'none', smoking: false },
  pos: 0,
  future: 'this',
  hold: false,
  mirror: true,
  amount: 0,
  shown: null,
  model: params.get('model') === 'lite' ? 'lite' : 'full',
  stats: !params.has('nostats'),
};
if (params.has('t')) state.pos = Math.max(0, Math.min(6, parseFloat(params.get('t')) || 0));

const sound = new Sound();
let warp = null;
let tracker = null;
let trackerLoading = null;
const video = $('camera');
let stream = null;
let running = false;
let fresh = false;
let lastP = null;

// ---- Numbers -----------------------------------------------------------------------------------
function numbers() {
  const burn = maintenance(state.profile);
  const eat = intake(state.plate);
  const better = betterPlate(state.plate, burn);
  if (!eat) return { burn, eat, surplus: 0, better, betterSurplus: 0, empty: true };
  return { burn, eat, surplus: eat - burn, better, betterSurplus: better.kcal - burn };
}

function ageYears() { return (AGE_BANDS.find((a) => a.id === state.profile.age) || AGE_BANDS[1]).years; }

function futureBody(which, pos) {
  const n = numbers();
  const surplus = which === 'better' ? n.betterSurplus : n.surplus;
  const days = daysAt(pos);
  return bodyParams(kgAfter(surplus, days), days, state.profile, ageYears());
}

function kcalText(surplus) {
  const v = Math.round(Math.abs(surplus) / 10) * 10;
  if (v < 30) return 'About <strong>even</strong> with what you burn';
  return `About <strong>${surplus > 0 ? '+' : '−'}${v} kcal/day</strong> ${surplus > 0 ? 'over' : 'under'} what you burn`;
}

function timeLabel(days) {
  if (days < 45) return `${Math.max(1, Math.round(days / 7))} weeks`;
  if (days < 340) return `${Math.round(days / 30.4)} months`;
  const y = days / 365.25;
  return y < 1.5 ? '1 year' : `${y < 4 ? y.toFixed(1).replace('.0', '') : Math.round(y)} years`;
}

/** Light, neutral captions. "Fuller" and "leaner", never worse words. */
function caption(idx, b, which) {
  if (idx === 0) return 'Today. This is you, right now.';
  const label = STOPS[idx].label;
  if (b.muscle > 1 && b.kg < 1) return `${label}: leaner, with more shape in your shoulders and arms.`;
  if (b.muscle > 1) return `${label}: fuller, and stronger with it.`;
  if (Math.abs(b.kg) < 1) return `${label}: your body holds steady.`;
  if (which === 'better') return b.kg < 0 ? `${label}: a little lighter, same you.` : `${label}: slower change on the better plate.`;
  if (b.kg > 0) {
    const c = ['', 'hardly anything shows yet.', 'your waist has noticed first.', 'your jeans have noticed.',
      'fuller around the middle, softer at the sides.', 'friends would notice now.', 'this is where this plate leads.'];
    return `${label}: ${c[idx]}`;
  }
  return `${label}: leaner, waist first.`;
}

function updateReadout() {
  const n = numbers();
  const which = state.future;
  const surplus = which === 'better' ? n.betterSurplus : n.surplus;
  const days = daysAt(state.pos);
  const b = futureBody(which, state.pos);
  $('kcal').innerHTML = n.empty ? 'Tap <strong>Your plate</strong> and add everything you eat in a day' : (which === 'better' ? 'Better plate: ' : '') + kcalText(surplus);
  $('sheet-kcal').innerHTML = `${Math.round(n.eat)} kcal eaten · ${Math.round(n.burn)} burned · ${kcalText(n.surplus).replace('About ', 'about ')}`;
  const idx = Math.round(state.pos);
  const near = Math.abs(state.pos - idx) < 0.08;
  if (days < 1) {
    $('caption').textContent = 'Today. This is you, right now.';
    $('numbers').innerHTML = 'Drag the timeline to see where this plate leads. <button type="button" data-info>Assumptions</button>';
    return;
  }
  const label = near ? STOPS[idx].label : timeLabel(days);
  $('caption').textContent = near ? caption(idx, b, which) : `${label} from now`;
  // A range, not a single number: the model is simple and bodies differ.
  const lo = b.kg * 0.7, hi = b.kg * 1.3;
  const range = Math.abs(b.kg) >= 1 ? ` (likely ${formatKg(Math.min(lo, hi)).replace(' kg', '')} to ${formatKg(Math.max(lo, hi))})` : '';
  const muscle = b.muscle >= 0.3 ? `, +${b.muscle.toFixed(1)} kg muscle from training` : '';
  const capped = b.floored ? ' Shown down to a healthy weight only.' : b.capped ? ` Shown up to +${GAIN_CAP_KG} kg.` : '';
  const swaps = which === 'better' && n.better.swaps.length
    ? ` Swapped: ${n.better.swaps.map((s) => `${s.from.toLowerCase()} → ${s.to.toLowerCase()}`).join(', ')}.` : '';
  $('numbers').innerHTML = `about ${formatKg(b.kg)}${range} after ${label}${muscle}.${capped}${swaps} <button type="button" data-info>(i) Not a prediction</button>`;
}

// ---- Camera ------------------------------------------------------------------------------------
async function openCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Camera needs https'), { name: 'InsecureContext' });
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
}

function watchFrames() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const cb = () => { fresh = true; video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  }
}
function takeFrame() {
  if (video.readyState < 2) return false;
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return true;
  const f = fresh;
  fresh = false;
  return f;
}

// ---- Layout ------------------------------------------------------------------------------------
const canvas = $('view');
function fitCanvas() {
  const r = canvas.getBoundingClientRect();
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  const maxPx = 2.2e6;
  if (r.width * r.height * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (r.width * r.height));
  warp?.resize(Math.max(2, Math.round(r.width * dpr)), Math.max(2, Math.round(r.height * dpr)));
}

/** Show the whole frame (contain), so head to knees stay on screen, centred. */
function viewMapping() {
  const W = canvas.width, H = canvas.height;
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const cover = Math.max(W / vw, H / vh), contain = Math.min(W / vw, H / vh);
  // Cover when it crops little; contain when cover would cut off a lot (e.g. landscape camera on a phone).
  const scale = cover / contain < 1.35 ? cover : contain;
  return { map: [(W - vw * scale) / 2, (H - vh * scale) / 2, vw * scale, vh * scale], mirror: state.mirror };
}

// ---- The loop ----------------------------------------------------------------------------------
let lastTime = performance.now();
const perf = { frames: 0, since: performance.now(), fps: 0, track: 0, tracked: 0, trackFps: 0 };
function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  fitCanvas();
  const view = viewMapping();
  if (takeFrame()) {
    if (tracker) {
      const found = tracker.detect(video, now);
      perf.tracked++;
      perf.track = perf.track * 0.9 + tracker.ms * 0.1;
      if (tracker.maskFresh) { warp.uploadMask(tracker.mask, tracker.maskW, tracker.maskH); tracker.maskFresh = false; }
      lastP = found ? poseToCanvas(tracker.points, view) : null;
    }
    warp.upload(video);
  } else if (lastP && tracker?.found) {
    lastP = poseToCanvas(tracker.points, view);
  }

  const target = lastP ? 1 : 0;
  state.amount += (target - state.amount) * Math.min(1, dt * (target ? 5 : 10));
  const goal = state.hold ? ZERO_BODY : futureBody(state.future, state.pos);
  state.shown = smoothBody(state.shown, goal, Math.min(1, dt * 8));

  const rig = lastP && state.amount > 0.001 ? buildDeformers(lastP, tracker.world, state.shown, state.amount) : null;
  warp.draw(view, rig, state.shown);
  if (DEBUG) drawDebug();

  perf.frames++;
  if (now - perf.since > 1000) {
    const s = (now - perf.since) / 1000;
    perf.fps = perf.frames / s;
    perf.trackFps = perf.tracked / s;
    perf.frames = 0; perf.tracked = 0; perf.since = now;
    renderStats();
  }
  updateStatus();
}

function renderStats() {
  const el = $('stats');
  el.hidden = !state.stats;
  if (!state.stats) return;
  const t = tracker ? `${tracker.model} · ${tracker.delegate}` : 'loading';
  el.textContent = `${perf.fps.toFixed(0)} fps drawn · ${perf.trackFps.toFixed(0)} fps tracked\npose ${perf.track.toFixed(0)} ms · ${t}\n${video.videoWidth}×${video.videoHeight}`;
}

let statusShown = null;
function updateStatus() {
  let text = '';
  if (!tracker) text = 'Starting body tracking…';
  else if (!lastP) text = 'Step back so your body is in view';
  else {
    const hips = Math.min(lastP[23].v, lastP[24].v);
    if (hips < 0.5) text = 'Step back a little: your hips and waist change most';
  }
  if (text !== statusShown) {
    statusShown = text;
    $('status').textContent = text;
    $('status').hidden = !text;
  }
}

// ---- Debug overlay (?debug=1): points, axes and the mask ---------------------------------------
function drawDebug() {
  warp.debug = params.get('debug') === '2' ? 1 : 0;
  const c = $('debug');
  c.hidden = false;
  if (c.width !== canvas.width) { c.width = canvas.width; c.height = canvas.height; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!lastP) return;
  ctx.font = `${Math.round(c.width / 90)}px monospace`;
  lastP.forEach((p, i) => {
    ctx.fillStyle = p.v > 0.5 ? 'rgba(0,255,180,.95)' : 'rgba(255,90,90,.9)';
    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    ctx.fillText(i, p.x + 4, p.y - 4);
  });
  const rig = buildDeformers(lastP, tracker.world, state.shown, 1);
  ctx.strokeStyle = 'rgba(255,220,0,.8)';
  ctx.lineWidth = 2;
  for (const d of rig.deformers) { ctx.beginPath(); ctx.moveTo(d.a.x, d.a.y); ctx.lineTo(d.b.x, d.b.y); ctx.stroke(); }
}

// ---- Controls ----------------------------------------------------------------------------------
const slider = $('slider');
function syncSlider(fromCode) {
  slider.value = String(state.pos);
  slider.style.setProperty('--fill', `${(state.pos / 6) * 100}%`);
  const idx = Math.round(state.pos);
  slider.setAttribute('aria-valuetext', Math.abs(state.pos - idx) < 0.08 ? STOPS[idx].label : timeLabel(daysAt(state.pos)));
  document.querySelectorAll('#stops button').forEach((b, i) => b.classList.toggle('on', Math.abs(state.pos - i) < 0.08));
  if (fromCode) updateReadout();
}

function buildStops() {
  const wrap = $('stops');
  STOPS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    b.style.left = `${(i / 6) * 100}%`;
    b.innerHTML = `<span class="short">${s.short}</span><span class="long">${s.label}</span>`;
    b.addEventListener('click', () => moveTo(i, true));
    wrap.append(b);
  });
}

let lastSliderPos = 0, lastSliderTime = 0, settleTimer = 0;
function moveTo(pos, animate) {
  if (!animate) { setPos(pos); return; }
  const from = state.pos, start = performance.now();
  const step = (now) => {
    const f = Math.min(1, (now - start) / 450);
    setPos(from + (pos - from) * (1 - Math.pow(1 - f, 3)));
    if (f < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setPos(pos) {
  const before = state.pos;
  state.pos = Math.max(0, Math.min(6, pos));
  const now = performance.now();
  sound.whoosh((state.pos - lastSliderPos) / Math.max(0.016, (now - lastSliderTime) / 1000));
  lastSliderPos = state.pos; lastSliderTime = now;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => sound.whoosh(0), 120);
  const a = Math.min(before, state.pos), b = Math.max(before, state.pos);
  for (let i = 1; i < STOPS.length; i++) if (a < i && b >= i && before !== state.pos && b - a < 3) sound.chime(i);
  syncSlider(true);
}
slider.addEventListener('input', () => setPos(parseFloat(slider.value)));
slider.addEventListener('change', () => {
  const idx = Math.round(state.pos);
  if (Math.abs(state.pos - idx) < 0.15) moveTo(idx, true);
});

function setFuture(which) {
  state.future = which;
  $('fut-this').setAttribute('aria-checked', String(which === 'this'));
  $('fut-better').setAttribute('aria-checked', String(which === 'better'));
  updateReadout();
}
$('fut-this').addEventListener('click', () => setFuture('this'));
$('fut-better').addEventListener('click', () => setFuture('better'));

const hold = $('hold');
const holdOn = (e) => { e.preventDefault(); state.hold = true; hold.classList.add('held'); };
const holdOff = () => { state.hold = false; hold.classList.remove('held'); };
hold.addEventListener('pointerdown', holdOn);
for (const t of ['pointerup', 'pointercancel', 'pointerleave']) hold.addEventListener(t, holdOff);
hold.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') holdOn(e); });
hold.addEventListener('keyup', holdOff);
hold.addEventListener('contextmenu', (e) => e.preventDefault());

function renderSound() {
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('sound-label').textContent = sound.enabled ? 'Sound on' : 'Sound off';
}
$('sound').addEventListener('click', () => { sound.setEnabled(!sound.enabled); renderSound(); });
renderSound();

$('info').addEventListener('click', () => $('info-dialog').showModal());
document.addEventListener('click', (e) => { if (e.target.closest('[data-info]')) $('info-dialog').showModal(); });

// ---- The plate sheet ---------------------------------------------------------------------------
const foodRenders = [];
function buildPlate() {
  const foods = $('foods');
  for (const f of FOODS) {
    const card = document.createElement('div');
    card.className = 'food';
    card.innerHTML = `<span class="label"><span class="name">${f.name}</span><span class="meta">${f.portion} · ${f.kcal} kcal</span></span>
      <span class="stepper"><button type="button" aria-label="One less ${f.name.toLowerCase()}">−</button><output aria-live="polite">0</output><button type="button" aria-label="One more ${f.name.toLowerCase()}">+</button></span>`;
    const [minus, plus] = card.querySelectorAll('button');
    const out = card.querySelector('output');
    const render = () => {
      const n = state.plate[f.id] || 0;
      out.textContent = n;
      minus.disabled = n === 0;
      card.classList.toggle('has', n > 0);
    };
    minus.addEventListener('click', () => { state.plate[f.id] = Math.max(0, (state.plate[f.id] || 0) - 1); render(); updateReadout(); });
    plus.addEventListener('click', () => { state.plate[f.id] = Math.min(12, (state.plate[f.id] || 0) + 1); render(); updateReadout(); });
    card.querySelector('.label').addEventListener('click', () => plus.click());
    render();
    foodRenders.push(render);
    foods.append(card);
  }
  chips('activity', ACTIVITY, () => state.profile.activity, (v) => { state.profile.activity = v; });
  chips('training', TRAINING, () => state.profile.training, (v) => { state.profile.training = v; });
  chips('sex', SEXES, () => state.profile.sex, (v) => { state.profile.sex = v; });
  chips('age', AGE_BANDS, () => state.profile.age, (v) => { state.profile.age = v; });
  for (const key of ['height', 'weight']) {
    const input = $(key);
    input.value = state.profile[key];
    const sync = () => {
      state.profile[key] = +input.value;
      $(`${key}-out`).textContent = `${input.value} ${key === 'height' ? 'cm' : 'kg'}`;
      updateReadout();
    };
    input.addEventListener('input', sync);
    sync();
  }
  $('trueview').addEventListener('change', (e) => { state.mirror = !e.target.checked; });
  $('showstats').checked = state.stats;
  $('showstats').addEventListener('change', (e) => { state.stats = e.target.checked; renderStats(); });
  $('lite').checked = state.model === 'lite';
  $('lite').addEventListener('change', (e) => { state.model = e.target.checked ? 'lite' : 'full'; loadTracker(true); });
}

function chips(id, options, get, set) {
  const wrap = $(id);
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.textContent = o.label;
    b.dataset.id = o.id;
    b.addEventListener('click', () => { set(o.id); renderChips(wrap, get()); updateReadout(); });
    wrap.append(b);
  }
  renderChips(wrap, get());
}
function renderChips(wrap, value) {
  wrap.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === value)));
}

$('plate-open').addEventListener('click', () => { $('plate').hidden = false; $('plate-done').focus(); });
$('plate-done').addEventListener('click', () => { $('plate').hidden = true; $('plate-open').focus(); });
$('plate-typical').addEventListener('click', () => { state.plate = { ...DEFAULT_PLATE }; foodRenders.forEach((r) => r()); updateReadout(); });

// ---- Start / stop ------------------------------------------------------------------------------
async function loadTracker(swap) {
  if (trackerLoading) return trackerLoading;
  if (swap && tracker) { tracker = null; lastP = null; warp?.clearMask(); }
  trackerLoading = (async () => {
    try {
      const { PoseTracker } = await import('./pose.js');
      tracker = await PoseTracker.create(state.model);
    } catch (error) {
      console.warn('Body tracking failed to start', error);
      showError('tracking');
    } finally {
      trackerLoading = null;
    }
  })();
  return trackerLoading;
}

async function start() {
  sound.unlock();
  $('landing').hidden = true;
  $('error').hidden = true;
  $('stage').hidden = false;
  try {
    if (!warp) warp = new Warp(canvas);
    await openCamera();
  } catch (error) {
    showError(problemOf(error));
    return;
  }
  watchFrames();
  running = true;
  requestAnimationFrame(frame);
  if (!tracker) loadTracker(false);
}

function stop() {
  running = false;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
}

function showError(key) {
  stop();
  $('stage').hidden = true;
  $('error').hidden = false;
  $('error-text').textContent = PROBLEMS[key] || PROBLEMS.missing;
}

$('open').addEventListener('click', () => { start(); if (!intake(state.plate)) $('plate').hidden = false; });
$('retry').addEventListener('click', () => start());
$('close').addEventListener('click', () => {
  stop();
  $('stage').hidden = true;
  $('landing').hidden = false;
  $('plate').hidden = true;
});

document.addEventListener('visibilitychange', () => { if (document.hidden) sound.suspend(); else sound.resume(); });
window.addEventListener('pointerdown', () => sound.unlock(), { once: true, capture: true });

buildStops();
buildPlate();
setFuture(state.future);
syncSlider(true);
if (params.has('autostart')) start();

// Hooks for quick headless checks.
window.__bm = {
  state,
  setPos: (p) => { state.pos = p; syncSlider(true); },
  fill: () => { state.plate = { ...DEFAULT_PLATE }; foodRenders.forEach((r) => r()); updateReadout(); },
  ready: () => Boolean(tracker && lastP),
  stats: () => ({ fps: perf.fps, trackFps: perf.trackFps, poseMs: perf.track, found: Boolean(lastP), body: state.shown }),
  limits: { GAIN_CAP_KG, LEAN_CAP_KG },
};
