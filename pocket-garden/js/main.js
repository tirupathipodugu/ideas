// Pocket Garden: a garden grows on your hands, face and neck.
// Camera -> MediaPipe Hand Landmarker (2 hands) + Face Landmarker -> smoothed points in screen pixels -> Garden shaders.

import * as THREE from '../vendor/three/three.module.js';
import { Garden, HAND, FACE, SEASONS, CANON } from './garden.js';
import { Butterflies } from './fauna.js';
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
const q0 = params.has('q') ? Math.max(0.05, +params.get('q') || 1) : lowEnd ? 0.6 : 1;   // ?q= for testing
const gardens = [new Garden(scene, HAND, 7, q0), new Garden(scene, HAND, 23, q0), new Garden(scene, FACE, 41, q0)];
let faceOn = params.get('face') !== '0';
const butterflies = new Butterflies(scene, 5);
const falling = new Falling(scene);
const touch = createTouch(gardens, falling, sound);
const seasonNames = Object.keys(SEASONS);
let season = 0;
gardens.forEach((g) => g.setSeason(SEASONS[seasonNames[season]]));

// ---------- source: camera, a test video (?video=), or the demo hand ----------
let mode = 'idle', facing = 'user', mirrored = true, stream = null, landmarker = null, facer = null;

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
  const makeFace = (delegate) => vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: BASE + 'face_landmarker.task', delegate },
    runningMode: 'VIDEO', numFaces: 1,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { facer = await makeFace('GPU'); } catch { try { facer = await makeFace('CPU'); } catch (e) { console.warn('face tracking unavailable', e); } }
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
    document.body.classList.add('live');
    setHint('Hold up your hands', true);
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
function toWorld(lm) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
  return lm.map((p) => [ox + (mirrored ? 1 - p.x : p.x) * dw, -(oy + p.y * dh), -p.z * dw, 1]);
}
function filter(i, pts) {
  const prev = smooth[i];
  if (!prev) return (smooth[i] = pts.map((p) => p.slice()));
  const [ra, rb] = pts.length === 21 ? [0, 9] : [0, 1];
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
  if (faceOn && facer) {
    const lm = facer.detectForVideo(video, ts + 0.5).faceLandmarks?.[0];
    // left cheek, right cheek, forehead top, chin, nose tip
    if (lm) {
      hands[2] = filter(2, toWorld([lm[234], lm[454], lm[10], lm[152], lm[1]]));
      // eyes and the open mouth stay clear
      gardens[2].setHoles(toWorld([33, 133, 159, 145, 263, 362, 386, 374, 78, 308, 13, 14].map((i) => lm[i])));
    } else { smooth[2] = null; gardens[2].setHoles(null); }
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

// ---------- loop ----------
let last = performance.now(), frames = 0, slowFrames = 0, quality = lowEnd ? 0.6 : 1, liveSince = 0, hintShownAt = 0;
let wasUp = [false, false];
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  if (mode === 'camera') detect();
  if (mode === 'demo') hands = [demoHand(t, 0), demoHand(t, 1), null];
  if (mode === 'idle') hands = [null, null, null];
  gardens.forEach((g, i) => {
    g.update(hands[i], t, dt);
    if (g.tracked && !wasUp[i] && g.u.uAge.value < 0.1) sound.bloom();
    wasUp[i] = g.tracked;
  });
  touch.update(t, dt);
  falling.update(dt, -H);
  butterflies.update(gardens, t, dt, { w: W, h: H });
  const anyUp = gardens.some((g) => g.tracked);
  sound.tick(Math.max(...gardens.map((g) => g.speed)), anyUp);
  if (mode === 'camera') {
    if (anyUp) { hintShownAt = 0; if (hint.classList.contains('show')) setHint(hint.textContent, false); }
    else if (!hintShownAt) hintShownAt = t;
    else if (t - hintShownAt > 1.5) setHint('Hold up your hands', true);
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
$('btn-face').addEventListener('click', tap(() => {
  faceOn = !faceOn;
  $('face-label').textContent = faceOn ? 'Face on' : 'Face off';
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
  g.fillText('Thanks to Tiago Canzian (@tgcnzn), it’s his idea', 16 * dpr, out.height - 40 * dpr);
  document.body.classList.add('flash'); setTimeout(() => document.body.classList.remove('flash'), 180);
  out.toBlob((b) => b && saveImage(b, 'pocket-garden.png', 'Pocket Garden'), 'image/png');
}));

// test hook for headless checks
window.garden = { gardens, butterflies, touch, falling, startDemo, get hands() { return hands; }, get mode() { return mode; } };
if (params.has('demo')) { intro.hidden = true; startDemo(); }
if (params.get('video')) { intro.hidden = true; startCamera(); }
