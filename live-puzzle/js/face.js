// Face: finds your face so the board can frame it, and brings it to life as the tiles come home.
// - Tracking is macro-mirror's MediaPipe Face Landmarker (vendored there), run on a small copy of
//   each camera frame.
// - Reactions bend the live picture itself: a blink pulls the upper eyelid down over the eye, and a
//   smile lifts the corners of the mouth. Both are thin vertical slices of the image, each squashed
//   or stretched either side of a curve (lid line or lip line), so there are no seams.

const DETECT_WIDTH = 320;

export const EYES = [
  { upper: [33, 246, 161, 160, 159, 158, 157, 173, 133], lower: [33, 7, 163, 144, 145, 153, 154, 155, 133] },
  { upper: [263, 466, 388, 387, 386, 385, 384, 398, 362], lower: [263, 249, 390, 373, 374, 380, 381, 382, 362] },
];
export const MOUTH = { left: 61, right: 291, top: 0, bottom: 17, upper: 13, lower: 14 };

export class FaceTracker {
  static async create() {
    const { FaceLandmarker, FilesetResolver } = await import('../../macro-mirror/vendor/mediapipe/vision_bundle.js');
    const wasm = new URL('../../macro-mirror/vendor/mediapipe/wasm', import.meta.url).href;
    const model = new URL('../../macro-mirror/assets/face_landmarker.task', import.meta.url).href;
    // MediaPipe prints routine start-up notes through console.error; they aren't errors.
    const error = console.error;
    console.error = (...args) => { if (!/^(INFO|W\d{4}|I\d{4})/.test(String(args[0]))) error(...args); };
    const files = await FilesetResolver.forVisionTasks(wasm);
    const options = delegate => ({ baseOptions: { modelAssetPath: model, delegate }, runningMode: 'VIDEO', numFaces: 1 });
    let landmarker;
    try {
      landmarker = await FaceLandmarker.createFromOptions(files, options('GPU'));
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(files, options('CPU'));
    }
    return new FaceTracker(landmarker);
  }

  constructor(landmarker) {
    this.landmarker = landmarker;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.lastStamp = 0;
    this.points = null;        // camera-normalised landmarks, or null when no face
  }

  detect(video, now) {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    const cw = DETECT_WIDTH, ch = Math.round(DETECT_WIDTH * h / w);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    this.ctx.drawImage(video, 0, 0, cw, ch);
    const stamp = Math.max(this.lastStamp + 1, Math.round(now));
    this.lastStamp = stamp;
    try {
      const result = this.landmarker.detectForVideo(this.canvas, stamp);
      this.points = (result.faceLandmarks && result.faceLandmarks[0]) || null;
    } catch {
      this.points = null;
    }
  }
}

const bump = (t, start, len) => (t < start || t > start + len ? 0 : Math.sin(Math.PI * (t - start) / len));

/** Linear interpolation through landmark points, as y at a given x. */
function curve(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x);
  return x => {
    if (x <= p[0].x) return p[0].y;
    for (let i = 1; i < p.length; i++) {
      if (x <= p[i].x) {
        const k = (x - p[i - 1].x) / Math.max(1e-6, p[i].x - p[i - 1].x);
        return p[i - 1].y + (p[i].y - p[i - 1].y) * k;
      }
    }
    return p[p.length - 1].y;
  };
}

export class Reactions {
  constructor() {
    this.list = [];
    this.tmp = document.createElement('canvas');
    this.tctx = this.tmp.getContext('2d');
  }

  /** A double blink of eye 0 or 1. */
  blink(eye) { this.list.push({ kind: 'blink', eye, t: 0, len: 0.8 }); }

  smile(big = false) { this.list.push({ kind: 'smile', t: 0, len: big ? 2.6 : 1.6, big }); }

  /** Bend the picture on `ctx` for every running reaction. `pts` are landmarks in picture pixels. */
  apply(ctx, pts, dt) {
    for (const r of this.list) r.t += dt;
    this.list = this.list.filter(r => r.t < r.len);
    if (!pts) return;
    for (let e = 0; e < 2; e++) {
      let c = 0;
      for (const r of this.list) {
        if (r.kind === 'blink' && r.eye === e) c = Math.max(c, Math.min(1, 1.15 * Math.max(bump(r.t, 0, 0.24), bump(r.t, 0.42, 0.24))));
      }
      if (c > 0.01) this.blinkEye(ctx, pts, EYES[e], c);
    }
    let s = 0;
    for (const r of this.list) {
      if (r.kind !== 'smile') continue;
      const k = Math.min(1, r.t / 0.3, (r.len - r.t) / 0.45);
      s = Math.max(s, (r.big ? 1.25 : 1) * k * k * (3 - 2 * k));
    }
    if (s > 0.01) this.smileMouth(ctx, pts, s);
  }

  blinkEye(ctx, pts, eye, c) {
    const up = eye.upper.map(i => pts[i]), low = eye.lower.map(i => pts[i]);
    const upperY = curve(up), lowerY = curve(low);
    const xs = up.map(p => p.x);
    const xa = Math.min(...xs), xb = Math.max(...xs);
    const height = Math.max(2, Math.max(...low.map(p => p.y)) - Math.min(...up.map(p => p.y)));
    const y0 = Math.min(...up.map(p => p.y)) - height * 1.6;
    const y1 = Math.max(...low.map(p => p.y)) + height * 0.6;
    // Taper towards the corners so the lid meets the skin there without a step.
    this.warp(ctx, xa, xb, y0, y1, upperY, x => {
      if (x <= xa || x >= xb) return 0;
      return c * Math.sqrt(Math.sin(Math.PI * (x - xa) / (xb - xa))) * Math.max(0, lowerY(x) - upperY(x));
    });
  }

  smileMouth(ctx, pts, s) {
    const L = pts[MOUTH.left], R = pts[MOUTH.right];
    const cx = (L.x + R.x) / 2, half = Math.max(4, Math.abs(R.x - L.x) / 2);
    const mid = { x: (pts[MOUTH.upper].x + pts[MOUTH.lower].x) / 2, y: (pts[MOUTH.upper].y + pts[MOUTH.lower].y) / 2 };
    const lineY = curve([L, mid, R]);
    const top = Math.min(pts[MOUTH.top].y, L.y, R.y), bottom = Math.max(pts[MOUTH.bottom].y, L.y, R.y);
    const mh = Math.max(4, bottom - top);
    const y0 = top - mh * 1.1, y1 = bottom + mh * 0.9;
    const amp = Math.min(half * 0.2, (Math.min(L.y, R.y) - y0) * 0.6) * s;
    const reach = 1.45;
    this.warp(ctx, cx - half * reach, cx + half * reach, y0, y1, lineY, x => {
      const a = Math.abs(x - cx) / half;
      const f = a <= 1 ? a * a : Math.max(0, 1 - (a - 1) / (reach - 1));
      return -amp * f;
    });
  }

  /** Move the curve lineY(x) by shift(x) inside the box, stretching the image above and below it. */
  warp(ctx, xa, xb, ya, yb, lineY, shift) {
    const x0 = Math.floor(xa), y0 = Math.floor(ya);
    const w = Math.ceil(xb) - x0, h = Math.ceil(yb) - y0;
    if (w < 2 || h < 2) return;
    if (this.tmp.width < w || this.tmp.height < h) { this.tmp.width = Math.max(w, this.tmp.width); this.tmp.height = Math.max(h, this.tmp.height); }
    this.tctx.clearRect(0, 0, this.tmp.width, this.tmp.height);
    this.tctx.drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
    const step = 2;
    for (let x = 0; x < w; x += step) {
      const X = x0 + x + step / 2;
      const sh = shift(X);
      if (Math.abs(sh) < 0.25) continue;
      const line = Math.max(1, Math.min(h - 1, lineY(X) - y0));
      const moved = Math.max(1, Math.min(h - 1, line + sh));
      const sw = Math.min(step, w - x);
      ctx.drawImage(this.tmp, x, 0, sw, line, x0 + x, y0, sw + 0.5, moved);
      ctx.drawImage(this.tmp, x, line, sw, h - line, x0 + x, y0 + moved, sw + 0.5, h - moved);
    }
  }
}
