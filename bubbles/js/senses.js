// Senses: what the app knows about you, beyond taps.
// - Body: Body Mirror's PoseTracker (MediaPipe Pose, vendored there) run on a small copy of each camera
//   frame. One model gives the 33 body points (hands, mouth) and a person mask (your outline).
// - Face: macro-mirror's MediaPipe Face Landmarker, for where your lips are and whether they are
//   pursed into the small O of blowing (its mouthFunnel / mouthPucker / cheekPuff blendshapes).
// - Tilt: phone tilt becomes a gentle "gravity" for the bubbles, and a hard shake pops them all.

const DETECT_WIDTH = 256;
const FACE_WIDTH = 320;

export class Body {
  static async create() {
    const { PoseTracker } = await import('../../body-mirror/js/pose.js');
    const tracker = await PoseTracker.create('lite');
    return new Body(tracker);
  }

  constructor(tracker) {
    this.tracker = tracker;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    this.found = false;
    this.prevMask = null;
    this.maskVersion = 0;
  }

  /** Track one new camera frame. */
  detect(source, now) {
    const w = source.width, h = source.height;
    if (!w || !h) return;
    const cw = DETECT_WIDTH, ch = Math.round(DETECT_WIDTH * h / w);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    this.ctx.drawImage(source.element, 0, 0, cw, ch);
    const t = this.tracker;
    if (t.mask) {
      if (!this.prevMask || this.prevMask.length !== t.mask.length) this.prevMask = new Uint8Array(t.mask.length);
      this.prevMask.set(t.mask);
    }
    this.found = t.detect(this.canvas, now);
    if (!this.found && t.mask) t.mask.fill(0);
    this.maskVersion++;
  }

  get mask() { return this.tracker.mask; }
  get maskW() { return this.tracker.maskW; }
  get maskH() { return this.tracker.maskH; }

  /** Body point i in camera-normalised coords, or null when not seen well. */
  point(i, minVisibility = 0.5) {
    if (!this.found) return null;
    const p = this.tracker.points;
    if (p[i * 3 + 2] < minVisibility) return null;
    return { x: p[i * 3], y: p[i * 3 + 1] };
  }
}

export class Face {
  static async create() {
    const { FaceLandmarker, FilesetResolver } = await import('../../macro-mirror/vendor/mediapipe/vision_bundle.js');
    const wasm = new URL('../../macro-mirror/vendor/mediapipe/wasm', import.meta.url).href;
    const model = new URL('../../macro-mirror/assets/face_landmarker.task', import.meta.url).href;
    // MediaPipe prints routine start-up notes through console.error; they aren't errors.
    const error = console.error;
    console.error = (...args) => { if (!/^(INFO|W\d{4}|I\d{4})/.test(String(args[0]))) error(...args); };
    const files = await FilesetResolver.forVisionTasks(wasm);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
    let landmarker;
    try {
      landmarker = await FaceLandmarker.createFromOptions(files, options('GPU'));
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(files, options('CPU'));
    }
    return new Face(landmarker);
  }

  constructor(landmarker) {
    this.landmarker = landmarker;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.lastStamp = 0;
    this.mouth = null;          // camera-normalised centre of the lips
    this.pursed = 0;            // 0..1, how much the lips are pushed into an O
    this.held = 0;
    this.strength = 0;          // 0..1, smoothed
  }

  /** Track one camera frame: where your lips are and whether they are pursed to blow. */
  detect(source, now) {
    const w = source.width, h = source.height;
    if (!w || !h) return;
    const cw = FACE_WIDTH, ch = Math.round(FACE_WIDTH * h / w);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    this.ctx.drawImage(source.element, 0, 0, cw, ch);
    const stamp = Math.max(this.lastStamp + 1, Math.round(now));
    this.lastStamp = stamp;
    let result;
    try { result = this.landmarker.detectForVideo(this.canvas, stamp); } catch { return; }
    const face = result.faceLandmarks && result.faceLandmarks[0];
    const shapes = result.faceBlendshapes && result.faceBlendshapes[0];
    if (!face || !shapes) { this.mouth = null; this.pursed = 0; this.held = 0; return; }
    const top = face[13], bottom = face[14];   // inner upper and lower lip
    this.mouth = { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 };
    const score = {};
    for (const c of shapes.categories) score[c.categoryName] = c.score;
    // Blowing pushes the lips forward into a small O (funnel / pucker), often with puffed cheeks,
    // and the jaw stays mostly closed (a wide-open "oh" is not a blow).
    const o = Math.max(score.mouthFunnel || 0, (score.mouthPucker || 0) * 0.85) + (score.cheekPuff || 0) * 0.3;
    this.pursed = (score.jawOpen || 0) > 0.45 ? 0 : o;
    this.held = this.pursed > 0.38 ? this.held + 1 : 0;
  }

  /** Blow strength 0..1, smoothed. */
  update(dt) {
    const target = this.held >= 2 ? Math.min(1, (this.pursed - 0.3) / 0.45) : 0;
    const rate = target > this.strength ? 10 : 4;
    this.strength += (target - this.strength) * Math.min(1, dt * rate);
    if (this.strength < 0.02) this.strength = 0;
    return this.strength;
  }
}

export class Tilt {
  constructor(onShake) {
    this.x = 0;
    this.y = 0;
    this.base = null;
    this.onShake = onShake;
    this.lastShake = 0;
    this.prev = null;
    window.addEventListener('deviceorientation', e => this.orient(e));
    window.addEventListener('devicemotion', e => this.motion(e));
  }

  /** iOS asks before sharing motion; call from inside a tap, without awaiting anything first. */
  static ask() {
    const asks = [];
    for (const E of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) {
      if (E && typeof E.requestPermission === 'function') asks.push(E.requestPermission().catch(() => 'denied'));
    }
    return Promise.all(asks);
  }

  orient(e) {
    if (e.beta === null || e.gamma === null) return;
    if (this.base === null) this.base = e.beta;     // however you hold it at the start is "level"
    const rad = Math.PI / 180;
    let x = Math.sin(Math.max(-60, Math.min(60, e.gamma)) * rad);
    let y = Math.sin(Math.max(-60, Math.min(60, e.beta - this.base)) * rad);
    const angle = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * rad;
    const c = Math.cos(angle), s = Math.sin(angle);
    this.x = x * c + y * s;
    this.y = -x * s + y * c;
  }

  motion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    if (this.prev) {
      const jerk = Math.hypot(a.x - this.prev.x, a.y - this.prev.y, a.z - this.prev.z);
      const now = performance.now();
      if (jerk > 22 && now - this.lastShake > 1500) {
        this.lastShake = now;
        this.onShake();
      }
    }
    this.prev = { x: a.x, y: a.y, z: a.z };
  }
}
