// Senses: what the app knows about you, beyond taps.
// - Body: Body Mirror's PoseTracker (MediaPipe Pose, vendored there) run on a small copy of each camera
//   frame. One model gives the 33 body points (hands, mouth) and a person mask (your outline).
// - Breath: the microphone, listening for blowing. Blowing is loud, broadband noise (flat spectrum),
//   unlike speech or music, so it is told apart by level plus spectral flatness, held for a few frames.
// - Tilt: phone tilt becomes a gentle "gravity" for the bubbles, and a hard shake pops them all.

const DETECT_WIDTH = 256;

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

export class Breath {
  constructor(ctx, stream) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.2;
    ctx.createMediaStreamSource(stream).connect(this.analyser);   // never connected to the speakers
    this.time = new Float32Array(this.analyser.fftSize);
    this.freq = new Float32Array(this.analyser.frequencyBinCount);
    this.held = 0;
    this.strength = 0;          // 0..1, smoothed
  }

  update(dt) {
    this.analyser.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    const rms = Math.sqrt(sum / this.time.length);

    this.analyser.getFloatFrequencyData(this.freq);
    let logSum = 0, linSum = 0, n = 0;
    for (let i = 12; i < 200; i++) {            // roughly 0.5 to 9 kHz
      const m = Math.pow(10, this.freq[i] / 20) + 1e-9;
      logSum += Math.log(m);
      linSum += m;
      n++;
    }
    const flatness = Math.exp(logSum / n) / (linSum / n);

    const blowing = rms > 0.025 && flatness > 0.22;
    this.held = blowing ? this.held + 1 : 0;
    const target = this.held >= 3 ? Math.min(1, (rms - 0.02) / 0.12) : 0;
    const rate = target > this.strength ? 12 : 5;
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
