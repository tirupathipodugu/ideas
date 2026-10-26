// Body tracking: MediaPipe Pose Landmarker (33 points + 3D world points + a person mask), vendored so
// nothing loads from a CDN. One person. Points are smoothed with a One Euro filter scaled by shoulder
// width; the mask is eased over two frames so its edge doesn't flicker.

import { PoseLandmarker, FilesetResolver } from '../../macro-mirror/vendor/mediapipe/vision_bundle.js';

const WASM = new URL('../../macro-mirror/vendor/mediapipe/wasm', import.meta.url).href;
const MODELS = {
  lite: new URL('../assets/pose_landmarker_lite.task', import.meta.url).href,
  full: new URL('../assets/pose_landmarker_full.task', import.meta.url).href,
};

class OneEuro {
  constructor(minCutoff, beta) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.x = null;
    this.dx = 0;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, dt, scale) {
    if (this.x === null) { this.x = value; return value; }
    const d = (value - this.x) / dt / scale;
    this.dx += OneEuro.alpha(1, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class PoseTracker {
  static async create(model = 'full') {
    // MediaPipe prints routine start-up notes through console.error; they aren't errors.
    const error = console.error;
    console.error = (...args) => { if (!/^(INFO|W\d{4}|I\d{4})/.test(String(args[0]))) error(...args); };
    const files = await FilesetResolver.forVisionTasks(WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODELS[model] || MODELS.full, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: true,
    });
    let landmarker, delegate = 'GPU';
    try {
      landmarker = await PoseLandmarker.createFromOptions(files, options('GPU'));
    } catch {
      delegate = 'CPU';
      landmarker = await PoseLandmarker.createFromOptions(files, options('CPU'));
    }
    return new PoseTracker(landmarker, model, delegate);
  }

  constructor(landmarker, model, delegate) {
    this.landmarker = landmarker;
    this.model = model;
    this.delegate = delegate;
    this.filters = null;
    this.points = new Float32Array(33 * 3);   // x, y (video-normalised), visibility
    this.world = new Float32Array(33 * 3);    // metres, hip-centred
    this.mask = null;                          // Uint8Array, video-sized, eased
    this.maskW = 0;
    this.maskH = 0;
    this.maskFresh = false;
    this.found = false;
    this.lastTime = 0;
    this.lastStamp = 0;
    this.ms = 0;
  }

  /** Track one frame. Returns true when a person was found. */
  detect(video, now) {
    const stamp = Math.max(this.lastStamp + 1, Math.round(now));
    this.lastStamp = stamp;
    const t0 = performance.now();
    let result;
    try {
      result = this.landmarker.detectForVideo(video, stamp);
    } catch {
      return this.found;
    }
    const pose = result.landmarks && result.landmarks[0];
    const masks = result.segmentationMasks || [];
    if (pose && masks[0]) this.takeMask(masks[0]);
    for (const m of masks) m.close();
    this.ms = performance.now() - t0;
    if (!pose) {
      this.found = false;
      this.filters = null;
      return false;
    }
    const dt = this.filters ? Math.max(1 / 120, Math.min(0.2, (now - this.lastTime) / 1000)) : 1 / 30;
    this.lastTime = now;
    if (!this.filters) {
      this.filters = [];
      for (let i = 0; i < 33 * 2; i++) this.filters.push(new OneEuro(1.6, 1.2));
    }
    const a = pose[11], b = pose[12];
    const width = Math.hypot(a.x - b.x, a.y - b.y) || 0.2;
    for (let i = 0; i < 33; i++) {
      const p = pose[i];
      this.points[i * 3] = this.filters[i * 2].filter(p.x, dt, width);
      this.points[i * 3 + 1] = this.filters[i * 2 + 1].filter(p.y, dt, width);
      this.points[i * 3 + 2] = p.visibility ?? 1;
    }
    const w = result.worldLandmarks && result.worldLandmarks[0];
    if (w) for (let i = 0; i < 33; i++) { this.world[i * 3] = w[i].x; this.world[i * 3 + 1] = w[i].y; this.world[i * 3 + 2] = w[i].z; }
    this.found = true;
    return true;
  }

  takeMask(mpMask) {
    const f = mpMask.getAsFloat32Array();
    const w = mpMask.width, h = mpMask.height;
    if (!this.mask || this.maskW !== w || this.maskH !== h) {
      this.mask = new Uint8Array(w * h);
      this.maskW = w;
      this.maskH = h;
      for (let i = 0; i < f.length; i++) this.mask[i] = f[i] * 255;
    } else {
      const m = this.mask;
      for (let i = 0; i < f.length; i++) m[i] = (m[i] + f[i] * 255) * 0.5;
    }
    this.maskFresh = true;
  }
}
