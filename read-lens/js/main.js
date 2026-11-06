// Read Lens: point the camera at a page and tap Snap. It keeps the sharpest frame, reads it on the
// phone (Tesseract OCR) and hands it to Snap: highlights on the photo, swipe up for the key lines,
// swipe left for word meanings.
import { initSnap } from './snap.js';
import { Sound } from './sound.js';
import { startDemo, startPhoto } from './sources.js';

const $ = (id) => document.getElementById(id);
const video = $('cam');
const sound = new Sound();
let stream = null, stopSource = null;

// ---------- OCR worker (loaded once, ~7 MB the first time) ----------
let workerP = null;
function ocrWorker() {
  if (!workerP) {
    const abs = (p) => new URL(p, location.href).href;
    workerP = Tesseract.createWorker('eng', 1, {
      workerPath: abs('vendor/worker.min.js'),
      corePath: abs('vendor/'),
      langPath: abs('vendor/'),
      workerBlobURL: false,
    });
  }
  return workerP;
}
async function ocr(canvas) { return (await (await ocrWorker()).recognize(canvas)).data; }

// ---------- camera ----------
async function startCamera() {
  stop();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  try {
    const track = stream.getVideoTracks()[0];
    if (track.getCapabilities?.().focusMode?.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch {}
  video.srcObject = stream;
  await video.play().catch(() => {});
}
async function useCanvasSource(start) {
  stop();
  const src = start();
  stopSource = src.stop;
  video.srcObject = src.stream;
  await video.play().catch(() => {});
}
function stop() {
  stopSource?.(); stopSource = null;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
}

// ---------- taking the picture: sharpest frame over a short window ----------
const probe = document.createElement('canvas');
const pg = probe.getContext('2d', { willReadFrequently: true });
function sharpness() {
  // Variance of a Laplacian over the centre: blurry (moving / unfocused) frames score low.
  const vw = video.videoWidth, vh = video.videoHeight, cw = 320, ch = 192;
  probe.width = cw; probe.height = ch;
  const sw = vw * 0.6, sh = sw * 0.6;
  pg.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, cw, ch);
  const d = pg.getImageData(0, 0, cw, ch).data;
  const gy = (x, y) => { const i = (y * cw + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < ch - 1; y += 2) for (let x = 1; x < cw - 1; x += 2) {
    const l = 4 * gy(x, y) - gy(x - 1, y) - gy(x + 1, y) - gy(x, y - 1) - gy(x, y + 1);
    s += l; s2 += l * l; n++;
  }
  return s2 / n - (s / n) ** 2;
}
async function capture(ms) {
  if (!video.videoWidth) return null;
  const best = document.createElement('canvas');
  let top = -1;
  const end = performance.now() + ms;
  do {
    const sh = sharpness();
    if (sh > top) {
      top = sh;
      const k = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight));
      best.width = Math.round(video.videoWidth * k); best.height = Math.round(video.videoHeight * k);
      best.getContext('2d').drawImage(video, 0, 0, best.width, best.height);
    }
    await new Promise((r) => setTimeout(r, 80));
  } while (performance.now() < end);
  return best;
}

function flash() {
  const f = $('flash');
  f.hidden = false;
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  setTimeout(() => { f.hidden = true; }, 450);
}

// ---------- wiring ----------
const snapper = initSnap({
  capture, ocr, sound, flash,
  onOpen: () => { $('shoot').disabled = true; },
  onClose: () => { $('shoot').disabled = false; },
});
$('shoot').addEventListener('click', () => snapper.snap());

$('upload').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  $('start').hidden = true;
  const img = new Image();
  img.src = URL.createObjectURL(f);
  await img.decode().catch(() => {});
  ocrWorker();
  await useCanvasSource(() => startPhoto(img));
  setTimeout(() => snapper.snap(), 300);
  e.target.value = '';
});

$('go').addEventListener('click', async () => {
  sound.ready();
  ocrWorker();
  $('startStatus').textContent = 'Asking for the camera…';
  try { await startCamera(); $('start').hidden = true; }
  catch { $('startStatus').textContent = 'Camera blocked or missing. Try the sample page or a photo.'; }
});
$('demo').addEventListener('click', () => { sound.ready(); ocrWorker(); $('start').hidden = true; useCanvasSource(startDemo); });
if (new URLSearchParams(location.search).has('demo')) { $('start').hidden = true; ocrWorker(); useCanvasSource(startDemo); }
