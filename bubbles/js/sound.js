// Sound: all synthesised with WebAudio, on by default (it starts on the first tap, as browsers
// require). A pop is a tiny noise burst plus a falling blip; freezing is a dry crackle; a frozen bubble
// shattering is a glassy tinkle; a giant bubble or "Bubble me" lifting off is a soft airy swell; and
// you landing back is a low thud. Under water there is a soft deep rumble, pops turn into gloops and
// every bubble you breathe out goes "bloop".

const STORAGE_KEY = 'bubbles:sound';

export class Sound {
  constructor() {
    this.ctx = null;
    this.noise = null;
    try { this.on = localStorage.getItem(STORAGE_KEY) !== 'off'; } catch { this.on = true; }
    this.lastCrackle = 0;
    this.lastBlub = 0;
    this.deep = null;           // the under-water rumble's gain, once started
    this.wantDeep = false;
  }

  /** Create or resume the audio context. Call from inside a tap or click. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.ambience(this.wantDeep);
    return this.ctx;
  }

  /** The deep, slowly breathing rumble you hear under water. */
  ambience(on) {
    this.wantDeep = on;
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.deep) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 320;
      f.Q.value = 0.6;
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.12;
      depth.gain.value = 140;
      lfo.connect(depth).connect(f.frequency);
      this.deep = ctx.createGain();
      this.deep.gain.value = 0;
      src.connect(f).connect(this.deep).connect(ctx.destination);
      src.start();
      lfo.start();
    }
    this.deep.gain.setTargetAtTime(on && this.on ? 0.07 : 0, ctx.currentTime, 0.6);
  }

  setOn(on) {
    this.on = on;
    this.unlock();
    this.ambience(this.wantDeep);
    try { localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  }

  ready() {
    return this.on && this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  burst(t, length, type, freq, q, level) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.02);
  }

  tone(t, from, to, length, level, type = 'sine') {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  /** A bubble popping. `big` 0..1; `slow` stretches it when time is slowed down. */
  pop(big, slow = 1, water = false) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    if (water) {                      // under water a pop is a low, muffled gloop
      this.burst(t, 0.07 * (slow < 0.5 ? 3 : 1), 'lowpass', 700, 0.9, 0.12 + 0.2 * big);
      const f = (520 - 250 * big) * (0.9 + Math.random() * 0.2);
      this.tone(t, f, f * 1.7, 0.12 + 0.1 * big, 0.12 + 0.15 * big);
      return;
    }
    const level = 0.1 + 0.25 * big;
    const stretch = slow < 0.5 ? 3 : 1;
    this.burst(t, 0.045 * stretch, 'bandpass', (2600 - 1300 * big + Math.random() * 500) / stretch, 1.4, level);
    const f = (1100 - 500 * big + Math.random() * 200) / stretch;
    this.tone(t, f, f * 0.35, 0.06 * stretch, level * 0.8);
  }

  /** An air bubble let go under water: a quick rising "bloop" (smaller bubbles ring higher). */
  blub(size = 0.5) {
    const ctx = this.ready();
    if (!ctx || ctx.currentTime - this.lastBlub < 0.03) return;
    this.lastBlub = ctx.currentTime;
    const t = ctx.currentTime;
    const f = (1500 - 1100 * size) * (0.85 + Math.random() * 0.3);
    this.tone(t, f, f * 1.9, 0.05 + 0.08 * size, 0.05 + 0.1 * size);
  }

  /** Frost spreading: sparse dry ticks. Call every frame while freezing; it paces itself. */
  crackle() {
    const ctx = this.ready();
    if (!ctx || ctx.currentTime - this.lastCrackle < 0.035) return;
    this.lastCrackle = ctx.currentTime;
    this.burst(ctx.currentTime, 0.008 + Math.random() * 0.01, 'highpass', 3500 + Math.random() * 4000, 0.7, 0.03 + Math.random() * 0.05);
  }

  /** A frozen bubble shattering into ice. */
  shatter(big) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.burst(t, 0.05, 'highpass', 2200, 0.8, 0.25 + 0.2 * big);
    for (let i = 0; i < 16; i++) {
      const at = t + Math.pow(Math.random(), 1.6) * 0.5;
      this.tone(at, 4200 + Math.random() * 5000, 3800 + Math.random() * 4000, 0.12 + Math.random() * 0.25, 0.015 + Math.random() * 0.02);
    }
  }

  /** A soft airy swell: a giant bubble or you lifting off. */
  whoosh(length = 1.2, level = 0.12) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + length * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + length + 0.05);
    this.tone(t, 320, 640, length, level * 0.25, 'triangle');
  }

  /** Landing back on the ground after "Bubble me". */
  thud() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 140, 45, 0.25, 0.4);
    this.burst(t, 0.08, 'lowpass', 400, 0.7, 0.25);
  }
}
