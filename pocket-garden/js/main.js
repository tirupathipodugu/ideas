// Pocket Garden: hold up your hands and a garden grows on them.
// Camera -> MediaPipe Hand Landmarker (2 hands) -> smoothed joints in screen pixels -> HandGarden shaders.

import * as THREE from '../vendor/three/three.module.js';
import { Garden, HAND, BODY, SEASONS, CANON } from './garden.js';
import { Butterflies } from './fauna.js';
import { Silhouette } from './silhouette.js';
import { Falling } from './falling.js';
import { createTouch } from './touch.js';
import * as sound from './sound.js';
import { saveImage } from '../../shared/share-x.js';

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('stage'), intro = $('intro'), hint = $('hint'), bar = $('bar');
const params = new URLSearchParams(location.search);

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 0, -1, -6000, 6000);
camera.position.z = 3000;
let W = 1, H = 1;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = -H;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const lowEnd = /Android|iPhone|iPad/i.test(navigator.userAgent) && (navigator.hardwareConcurrency || 4) <= 4;
const q0 = lowEnd ? 0.6 : 1;
const gardens = [new Garden(scene, HAND, 7, q0), new Garden(scene, HAND, 23, q0), new Garden(scene, BODY, 41, q0)];
let bodyOn = params.get('body') !== '0';
const butterflies = new Butterflies(scene, 5);
const silhouette = new Silhouette(scene, gardens[2].u);
let rect = { ox: 0, oy: 0, dw: 1, dh: 1 };
const falling = new Falling(scene);
const touch = createTouch(gardens, falling, sound);
const seasonNames = Object.keys(SEASONS);
let season = 0;
gardens.forEach((g) => g.setSeason(SEASONS[seasonNames[season]]));

// ---------- source: camera, a test video (?video=), or the demo hand ----------
let mode = 'idle', facing = 'user', mirrored = true, stream = null, landmarker = null, poser = null;

async function loadLandmarker() {
  if (landmarker) return landmarker;
  const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;
  const vision = await import('../vendor/mediapipe/vision_bundle.js');
  const fileset = { wasmLoaderPath: BASE + 'wasm/vision_wasm_internal.js', wasmBinaryPath: BASE + 'wasm/vision_wasm_internal.wasm' };
  const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: BASE + 'hand_landmarker.task', delegate },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.55, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { landmarker = await make('GPU'); } catch { landmarker = await make('CPU'); }
  const makePose = (delegate) => vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: BASE + 'pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    outputSegmentationMasks: true,
  });
  try { poser = await makePose('GPU'); } catch { try { poser = await makePose('CPU'); } catch (e) { console.warn('pose unavailable', e); } }
  return landmarker;
}

async function startCamera() {
  setHint('Starting camera…', true);
  try {
    stream?.getTracks().forEach((t) => t.stop());
    if (params.get('video')) {
      video.srcObject = null; video.src = params.get('video'); video.loop = true; mirrored = false;
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      video.srcObject = stream;
      mirrored = facing === 'user';
    }
    video.classList.toggle('mirror', mirrored);
    await video.play();
    setHint('Loading the garden…', true);
    await loadLandmarker();
    mode = 'camera';
    $('camera-label').textContent = 'Flip';
    BODY.showHead = false;
    document.body.classList.add('live');
    setHint(bodyOn ? 'Step back so the camera sees you' : 'Hold up your hand', true);
  } catch (err) {
    console.error(err);
    setHint('Camera blocked. Allow camera access, or try the demo.', true);
    intro.hidden = false;
  }
}

function startDemo() {
  mode = 'demo';
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  document.body.classList.add('live', 'demo');
  $('camera-label').textContent = 'Camera';
  BODY.showHead = true;
  setHint('Demo · tap Start camera to use yours', true);
}

// ---------- hint toast ----------
let hintTimer = 0;
function setHint(text, show) {
  hint.textContent = text;
  hint.classList.toggle('show', show);
}

// ---------- landmarks -> world ----------
const smooth = [null, null, null];
function toWorld(lm, useVis = false) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
  rect = { ox, oy, dw, dh };
  return lm.map((p) => [ox + (mirrored ? 1 - p.x : p.x) * dw, -(oy + p.y * dh), -p.z * dw, useVis ? (p.visibility ?? 1) : 1]);
}
function filter(i, pts) {
  const prev = smooth[i];
  if (!prev) return (smooth[i] = pts.map((p) => p.slice()));
  const [ra, rb] = pts.length > 21 ? [11, 12] : [0, 9];
  const scale = Math.hypot(pts[rb][0] - pts[ra][0], pts[rb][1] - pts[ra][1]) || 100;
  for (let k = 0; k < pts.length; k++) {
    prev[k][3] = pts[k][3];
    const d = Math.hypot(pts[k][0] - prev[k][0], pts[k][1] - prev[k][1]) / scale;
    const a = Math.min(0.92, 0.35 + d * 4);           // smooth when still, snappy when moving
    for (let c = 0; c < 3; c++) prev[k][c] += (pts[k][c] - prev[k][c]) * a;
  }
  return prev;
}

let lastVideoTime = -1, lastTs = 0, hands = [null, null, null], frameNo = 0;
function detect() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const ts = Math.max(performance.now(), lastTs + 1); lastTs = ts;
  const res = landmarker.detectForVideo(video, ts);
  const next = [null, null];
  (res.landmarks || []).forEach((lm, k) => {
    // keep each physical hand on the same garden: MediaPipe's label is mirrored, but consistent
    let slot = res.handedness?.[k]?.[0]?.categoryName === 'Left' ? 0 : 1;
    if (next[slot]) slot = 1 - slot;
    next[slot] = toWorld(lm);
  });
  hands = next.map((p, i) => (p ? filter(i, p) : ((smooth[i] = null), null)));
  hands[2] = null;
  if (bodyOn && poser) {
    const pr = poser.detectForVideo(video, ts + 0.5);
    const lm = pr.landmarks?.[0];
    const masks = pr.segmentationMasks || [];
    if (lm && masks[0] && frameNo++ % (lowEnd ? 2 : 1) === 0) silhouette.setMask(masks[0]);
    for (const m of masks) m.close();
    // need at least the shoulders to dress a body
    if (lm && (lm[11].visibility ?? 1) > 0.5 && (lm[12].visibility ?? 1) > 0.5) hands[2] = filter(2, toWorld(lm, true));
    else smooth[2] = null;
  }
}

// ---------- the demo hand: a scripted pair of hands that open, close and wave ----------
function demoHand(t, side) {
  const scale = Math.min(W, H) * (W < H ? 0.26 : 0.3);
  // every 7 s the two hands come together for a clap
  const ph = t % 7, together = ph < 4.6 ? 0 : ph < 5.0 ? (ph - 4.6) / 0.4 : ph < 5.15 ? 1 : ph < 6.2 ? 1 - (ph - 5.15) / 1.05 : 0;
  const k = together * together * (3 - 2 * together);
  const cx = W * ((side ? 0.68 : 0.32) * (1 - k) + (side ? 0.53 : 0.47) * k) + Math.sin(t * 0.6 + side * 2) * W * 0.05 * (1 - k);
  const cy = H * 0.78 + Math.cos(t * 0.5 + side) * H * 0.03;
  const rot = Math.sin(t * 0.7 + side * 1.3) * 0.35 + (side ? 0.15 : -0.15);
  const curl = Math.max(0, Math.sin(t * 0.9 + side * 2.5)) * 0.9;
  const pts = CANON.map(([x, y]) => [x, y, 0]);
  const chains = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  chains.forEach((ch, f) => {
    const c = curl * (f === 0 ? 0.5 : 1);
    for (let k = 1; k < ch.length; k++) {
      const a = CANON[ch[k - 1]], b = CANON[ch[k]];
      const dx = b[0] - a[0], dy = b[1] - a[1], phi = c * k * 0.75;
      const p = pts[ch[k - 1]];
      pts[ch[k]] = [p[0] + dx * Math.cos(phi), p[1] + dy * Math.cos(phi), p[2] + Math.hypot(dx, dy) * Math.sin(phi)];
    }
  });
  const cr = Math.cos(rot), sr = Math.sin(rot), m = side ? 1 : -1;
  return pts.map(([x, y, z]) => {
    const X = x * m, rx = X * cr - y * sr, ry = X * sr + y * cr;
    return [cx + rx * scale, -(cy + ry * scale), z * scale];
  });
}

// ---------- the demo body: a figure that sways and waves ----------
function demoBody(t) {
  const scale = Math.min(W * 0.32, H * 0.2);
  const cx = W / 2 + Math.sin(t * 0.5) * W * 0.03, cy = H * 0.5;
  const pts = [];
  for (let i = 0; i < 33; i++) {
    const [x, y] = BODY.canon(i);
    pts.push([x, y]);
  }
  // wave: rotate each arm around its shoulder, elbows bending
  const arm = (sh, el, wr, hand, sign, phase) => {
    const up = 0.9 + Math.sin(t * 1.3 + phase) * 0.9;
    const S = pts[sh], ang1 = sign * up, ang2 = sign * (up * 0.6 + Math.sin(t * 2.6 + phase) * 0.4);
    const rot = (p, o, a) => { const dx = p[0] - o[0], dy = p[1] - o[1]; return [o[0] + dx * Math.cos(a) - dy * Math.sin(a), o[1] + dx * Math.sin(a) + dy * Math.cos(a)]; };
    pts[el] = rot(pts[el], S, ang1);
    for (const h of [wr, ...hand]) pts[h] = rot(rot(pts[h], S, ang1), pts[el], ang2 - ang1 * 0.2);
  };
  arm(11, 13, 15, [17, 19, 21], 1, 0);
  arm(12, 14, 16, [18, 20, 22], -1, 1.7);
  return pts.map(([x, y]) => [cx + x * scale, -(cy + y * scale), 0, 1]);
}

// ---------- loop ----------
let last = performance.now(), frames = 0, slowFrames = 0, quality = lowEnd ? 0.6 : 1, liveSince = 0, hintShownAt = 0;
let wasUp = [false, false];
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  if (mode === 'camera') detect();
  if (mode === 'demo') hands = bodyOn ? [null, null, demoBody(t)] : [demoHand(t, 0), demoHand(t, 1), null];
  if (mode === 'idle') hands = [null, null, null];
  gardens.forEach((g, i) => {
    g.update(hands[i], t, dt);
    if (g.tracked && !wasUp[i] && g.u.uAge.value < 0.1) sound.bloom();
    wasUp[i] = g.tracked;
  });
  touch.update(t, dt);
  falling.update(dt, -H);
  butterflies.update(gardens, t, dt, { w: W, h: H });
  silhouette.update(rect, mirrored, gardens[2], mode === 'camera' && bodyOn, t);
  const anyUp = gardens.some((g) => g.tracked);
  sound.tick(Math.max(...gardens.map((g) => g.speed)), anyUp);
  if (mode === 'camera') {
    if (anyUp) { hintShownAt = 0; if (hint.classList.contains('show')) setHint(hint.textContent, false); }
    else if (!hintShownAt) hintShownAt = t;
    else if (t - hintShownAt > 1.5) setHint(bodyOn ? 'Step back so the camera sees you' : 'Hold up your hand', true);
  }
  // adapt plant density to the device once, after a few seconds of real work
  if (mode !== 'idle') {
    if (!liveSince) liveSince = t;
    frames++; if (dt > 1 / 38) slowFrames++;
    if (t - liveSince > 4 && frames > 120) {
      if (slowFrames / frames > 0.4 && quality > 0.35) { quality *= 0.65; gardens.forEach((g) => g.setQuality(quality)); }
      frames = 0; slowFrames = 0; liveSince = t;
    }
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------- controls ----------
function tap(fn) { return (e) => { sound.unlock(); fn(e); }; }
$('start').addEventListener('click', tap(() => { intro.hidden = true; startCamera(); }));
$('demo').addEventListener('click', tap(() => { intro.hidden = true; startDemo(); }));
$('btn-camera').addEventListener('click', tap(() => {
  if (mode === 'demo') { document.body.classList.remove('demo'); startCamera(); return; }
  facing = facing === 'user' ? 'environment' : 'user';
  startCamera();
}));
$('btn-body').addEventListener('click', tap(() => {
  bodyOn = !bodyOn;
  $('body-label').textContent = bodyOn ? 'Body' : 'Hands';
  $('body-icon').textContent = bodyOn ? '🧍' : '✋';
}));
$('btn-season').addEventListener('click', tap(() => {
  season = (season + 1) % seasonNames.length;
  const name = seasonNames[season];
  gardens.forEach((g) => g.setSeason(SEASONS[name]));
  $('season-label').textContent = name;
}));
let soundOn = true;
$('btn-sound').addEventListener('click', tap(() => {
  soundOn = !soundOn;
  sound.setOn(soundOn);
  $('sound-label').textContent = soundOn ? 'Sound on' : 'Sound off';
  $('btn-sound').setAttribute('aria-pressed', String(soundOn));
  $('sound-icon').textContent = soundOn ? '🔊' : '🔇';
}));
$('btn-snap').addEventListener('click', tap(async () => {
  const out = document.createElement('canvas');
  const dpr = Math.min(devicePixelRatio, 2);
  out.width = W * dpr; out.height = H * dpr;
  const g = out.getContext('2d');
  if (mode === 'demo') {
    const grd = g.createLinearGradient(0, 0, 0, out.height); grd.addColorStop(0, '#1d2b24'); grd.addColorStop(1, '#0b100d');
    g.fillStyle = grd; g.fillRect(0, 0, out.width, out.height);
  } else if (video.videoWidth) {
    const s = Math.max(out.width / video.videoWidth, out.height / video.videoHeight);
    const dw = video.videoWidth * s, dh = video.videoHeight * s;
    g.save();
    if (mirrored) { g.translate(out.width, 0); g.scale(-1, 1); }
    g.drawImage(video, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh);
    g.restore();
  }
  renderer.render(scene, camera);
  g.drawImage(canvas, 0, 0, out.width, out.height);
  g.font = `600 ${15 * dpr}px system-ui, sans-serif`; g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillText('Pocket Garden · tirupathipodugu.github.io/ideas/pocket-garden', 16 * dpr, out.height - 18 * dpr);
  document.body.classList.add('flash'); setTimeout(() => document.body.classList.remove('flash'), 180);
  out.toBlob((b) => b && saveImage(b, 'pocket-garden.png', 'Pocket Garden'), 'image/png');
}));

// test hook for headless checks
window.garden = { gardens, butterflies, silhouette, touch, falling, startDemo, get hands() { return hands; }, get mode() { return mode; } };
if (params.has('demo')) { intro.hidden = true; startDemo(); }
if (params.get('video')) { intro.hidden = true; startCamera(); }
