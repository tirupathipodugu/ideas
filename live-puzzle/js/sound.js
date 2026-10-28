// Sound: all synthesised with WebAudio, nothing to download. Wooden slides, a small bell when a tile
// lands home, a rattle for the shuffle and a chime when you're solved.

export class Sound {
  constructor() {
    this.on = true;
    this.ctx = null;
    this.noise = null;
  }

  ready() {
    if (!this.on) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 0.25;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  tone(freq, at, len, type = 'sine', vol = 0.12, glide = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(ctx.destination);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  tick(at, vol = 0.22, freq = 1900) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 3;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(at, Math.random() * 0.15, 0.06);
  }

  /** A tile (or a line of them) sliding over wood. */
  slide(count = 1) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < count; i++) this.tick(t + i * 0.03, 0.2, 1500 + Math.random() * 600);
    this.tone(150, t + 0.02, 0.08, 'sine', 0.14, 90);
  }

  /** A tile clicked into its home square. */
  place() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    this.tone(1318, t, 0.35, 'sine', 0.06);
    this.tone(1976, t + 0.04, 0.3, 'sine', 0.03);
  }

  /** An eye tile home: two soft pips, one per blink. */
  blink() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.04;
    this.tone(1760, t, 0.12, 'sine', 0.07, 2400);
    this.tone(1760, t + 0.42, 0.12, 'sine', 0.07, 2400);
  }

  /** The mouth tile home: a bright rising "ta-da". */
  smile() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.04;
    this.tone(784, t, 0.25, 'triangle', 0.08);
    this.tone(1175, t + 0.12, 0.5, 'triangle', 0.09);
    this.tone(1568, t + 0.12, 0.5, 'sine', 0.04);
  }

  shuffle() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 18; i++) this.tick(t + i * 0.045 + Math.random() * 0.02, 0.16, 1300 + Math.random() * 1200);
  }

  win() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    [523, 659, 784, 1046, 1318, 1568].forEach((f, i) => this.tone(f, t + i * 0.08, 0.9, 'triangle', 0.09));
    for (let i = 0; i < 10; i++) this.tone(2400 + Math.random() * 2400, t + 0.5 + i * 0.06, 0.25, 'sine', 0.025);
  }
}
