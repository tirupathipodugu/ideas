// All sound is synthesised with WebAudio: rain hiss and patter, drips off the roof, water swishing past
// the hull, a frog's croak and plop, wet paper scraping a wall, the drain gurgling, the thread snapping.

export class Sound {
  constructor() {
    this.on = true;
    this.ctx = null;
    this.master = null;
    this.timer = 0;
  }

  // Called from the first user gesture. Returns the AudioContext (also used by the mic analyser).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.on ? 1 : 0;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2.2; }
      this.beds();
      this.timer = setInterval(() => this.patter(), 60);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setOn(on) {
    this.on = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
  }

  loop(filterType, freq, q, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(ctx.currentTime + Math.random() * 0.5);
    return { f, g };
  }

  beds() {
    this.loop('lowpass', 900, 0.5, 0.05);           // soft roar of rain on the courtyard
    this.loop('bandpass', 5200, 0.6, 0.022);        // fine hiss of drops
    this.swish = this.loop('bandpass', 650, 1.1, 0); // water past the hull
    this.gurgle = this.loop('lowpass', 260, 4, 0);  // the drain
  }

  // Rain on water: many tiny high plinks, a few big drips off the roof with the rising "bloop" of a real drop.
  patter() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime;
    const n = Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.drop(now + Math.random() * 0.06, 1800 + Math.random() * 3200, 0.004 + Math.random() * 0.01, 0.012 + Math.random() * 0.02, 1.25);
    if (Math.random() < 0.06) this.drop(now + Math.random() * 0.06, 500 + Math.random() * 500, 0.02 + Math.random() * 0.025, 0.05, 2.2);
    if (this.gurgle) {
      const v = this.drainLevel || 0;
      this.gurgle.g.gain.setTargetAtTime(v * (0.12 + Math.random() * 0.16), now, 0.08);
      this.gurgle.f.frequency.setTargetAtTime(180 + Math.random() * 220, now, 0.05);
    }
  }

  drop(at, f0, vol, len, rise) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * rise, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(this.master);
    o.start(at); o.stop(at + len + 0.02);
  }

  burst(at, len, type, freq, q, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random() * 1.5); src.stop(at + len + 0.02);
  }

  setMotion(speed, drain) {
    if (!this.ctx) return;
    this.swish.g.gain.setTargetAtTime(Math.min(0.09, speed * 0.14), this.ctx.currentTime, 0.12);
    this.swish.f.frequency.setTargetAtTime(500 + speed * 600, this.ctx.currentTime, 0.2);
    this.drainLevel = drain;
  }

  // Wet paper brushing a wall or a leaf.
  scrape(v = 1) {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) this.burst(now + i * 0.022 + Math.random() * 0.01, 0.03, 'highpass', 2200 + Math.random() * 1500, 0.7, 0.05 * v);
    this.burst(now, 0.12, 'bandpass', 500, 1, 0.06 * v);
  }

  plop() {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    this.drop(now, 280, 0.22, 0.09, 4);
    this.burst(now, 0.16, 'lowpass', 700, 0.8, 0.16);
    this.burst(now + 0.05, 0.25, 'bandpass', 2400, 1.5, 0.03);
  }

  croak() {
    if (!this.ready()) return;
    const ctx = this.ctx, now = ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const at = now + k * 0.32;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95, at); o.frequency.linearRampToValueAtTime(80, at + 0.22);
      const am = ctx.createOscillator(); am.frequency.value = 28;
      const amg = ctx.createGain(); amg.gain.value = 0.5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.06, at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      const vca = ctx.createGain(); vca.gain.value = 0.5;
      am.connect(amg).connect(vca.gain);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 2.5;
      o.connect(vca).connect(f).connect(g).connect(this.master);
      o.start(at); am.start(at); o.stop(at + 0.26); am.stop(at + 0.26);
    }
  }

  finish() {
    if (!this.ready()) return;
    const ctx = this.ctx, now = ctx.currentTime;
    this.burst(now, 0.03, 'highpass', 3000, 0.7, 0.12);
    [[587, 0.05], [880, 0.2], [1175, 0.35]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + d); g.gain.exponentialRampToValueAtTime(0.05, now + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + d + 1.8);
      o.connect(g).connect(this.master); o.start(now + d); o.stop(now + d + 1.9);
    });
  }

  ready() { return this.ctx && this.ctx.state === 'running'; }
}
