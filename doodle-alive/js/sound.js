// Sound: all synthesised with WebAudio, nothing to download. Paper peeling, a pop when a doodle wakes up,
// tiny paper footsteps, boings, squeaks when you grab one and a little giggle when you poke it.

export class Sound {
  constructor() {
    this.on = true;
    this.ctx = null;
    this.noise = null;
    this.lastStep = 0;
  }

  ready() {
    if (!this.on) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 1.2;
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

  hiss(at, len, from, to, vol, q = 1.2) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise;
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + len);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    s.connect(f).connect(g).connect(ctx.destination);
    s.start(at, Math.random() * 0.4, len + 0.05);
  }

  beep(last) {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(last ? 1320 : 880, ctx.currentTime + 0.01, last ? 0.3 : 0.12, 'sine', 0.1);
  }

  /** Paper being peeled up, then a bright pop as it wakes. */
  peel() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    this.hiss(t, 0.7, 900, 4200, 0.22, 0.8);
    for (let i = 0; i < 14; i++) this.hiss(t + Math.random() * 0.6, 0.03, 2500, 3500, 0.12, 4);
    this.tone(523, t + 0.65, 0.18, 'triangle', 0.08, 1046);
    [1046, 1318, 1568].forEach((f, i) => this.tone(f, t + 0.7 + i * 0.05, 0.4, 'sine', 0.05));
  }

  fail() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    this.tone(330, t, 0.18, 'triangle', 0.08, 260);
    this.tone(260, t + 0.16, 0.3, 'triangle', 0.08, 200);
  }

  hop() {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(320 + Math.random() * 80, ctx.currentTime + 0.01, 0.22, 'sine', 0.1, 900);
  }

  land(power = 5) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01, v = Math.min(0.25, 0.05 + power * 0.012);
    this.hiss(t, 0.09, 700, 300, v, 1);
    this.tone(140, t, 0.1, 'sine', v * 0.8, 70);
  }

  boing(power = 8) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    this.tone(180, t, 0.35, 'sine', Math.min(0.16, 0.05 + power * 0.006), 420 + Math.random() * 120);
  }

  step() {
    const ctx = this.ready();
    if (!ctx || ctx.currentTime - this.lastStep < 0.09) return;
    this.lastStep = ctx.currentTime;
    this.hiss(ctx.currentTime + 0.005, 0.04, 2600 + Math.random() * 1200, 1800, 0.035, 3);
  }

  squeak() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    this.tone(900, t, 0.16, 'sine', 0.08, 1700 + Math.random() * 400);
  }

  whee() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    this.tone(700, t, 0.5, 'triangle', 0.07, 1800);
    this.tone(1400, t + 0.05, 0.45, 'sine', 0.03, 2600);
  }

  giggle() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01, base = 900 + Math.random() * 200;
    for (let i = 0; i < 5; i++) this.tone(base + i * 40 - (i % 2) * 120, t + i * 0.075, 0.07, 'triangle', 0.07, base * 1.25);
  }

  bonk() {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(220, ctx.currentTime + 0.005, 0.12, 'square', 0.04, 110);
  }

  sneak() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    [660, 590, 520].forEach((f, i) => this.tone(f, t + i * 0.12, 0.1, 'sine', 0.04));
  }

  peekaboo() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    this.tone(784, t, 0.12, 'triangle', 0.08);
    this.tone(1175, t + 0.12, 0.25, 'triangle', 0.08);
  }
}
