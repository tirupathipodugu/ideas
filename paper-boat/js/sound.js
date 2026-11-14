// The forest stream, all synthesised with WebAudio: layered running water that swells in the rapids,
// wind moving through the canopy, birds calling from both banks, and soft knocks when the boat hits a rock.

export class Sound {
  constructor() { this.on = true; this.ctx = null; this.rapid = 0; }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = this.ctx = new AC();
      // louder overall, through a gentle compressor and a limiter so phone speakers never clip
      this.master = ctx.createGain();
      this.master.gain.value = this.on ? 1.9 : 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.3;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
      const post = ctx.createGain(); post.gain.value = 1.15;
      this.master.connect(comp).connect(lim).connect(post).connect(ctx.destination);
      const len = ctx.sampleRate * 3;
      this.noise = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = this.noise.getChannelData(ch); let b = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.985 * b + 0.015 * w; d[i] = w * 0.5 + b * 3; }
      }
      this.water = [this.bed('lowpass', 380, 0.7, 0.22), this.bed('bandpass', 1100, 0.9, 0.11), this.bed('bandpass', 3200, 1.2, 0.05), this.bed('highpass', 6500, 0.7, 0.014)];
      this.wind = this.bed('bandpass', 700, 0.5, 0.0);
      this.timer = setInterval(() => this.tick(), 120);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  setOn(on) { this.on = on; if (this.master) this.master.gain.setTargetAtTime(on ? 1.9 : 0, this.ctx.currentTime, 0.08); }

  bed(type, freq, q, gain) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(ctx.currentTime + Math.random());
    return { f, g, base: gain, freq };
  }

  setRapid(r) { this.rapid = r; }

  tick() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime, r = this.rapid;
    // the water gurgles: each band wanders, and everything grows in the rapids
    this.water.forEach((b, i) => {
      b.g.gain.setTargetAtTime(b.base * (0.7 + Math.random() * 0.6) * (1 + r * (1.5 + i * 0.6)), now, 0.15);
      b.f.frequency.setTargetAtTime(b.freq * (0.85 + Math.random() * 0.3), now, 0.2);
    });
    this.wind.g.gain.setTargetAtTime(0.012 + 0.03 * (0.5 + 0.5 * Math.sin(now * 0.13)) * Math.random(), now, 1.2);
    for (let i = 0; i < 2; i++) if (Math.random() < 0.35) this.drip(now + Math.random() * 0.12, r);
    if (Math.random() < 0.05) this.bird(now + Math.random() * 0.1);
  }

  // a bubble in the water: a short rising sine
  drip(at, r) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const f0 = 350 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f0 * (1.6 + Math.random()), at + 0.05);
    const v = 0.006 + Math.random() * 0.012 * (1 + r * 2);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(v, at + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    let n = o.connect(g);
    if (p) { p.pan.value = Math.random() * 1.6 - 0.8; n = n.connect(p); }
    n.connect(this.master); o.start(at); o.stop(at + 0.09);
  }

  // birdsong: a few species-like patterns built from fast sine sweeps and trills
  bird(at) {
    const ctx = this.ctx, kind = Math.floor(Math.random() * 3);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain(); out.gain.value = 0.09 + Math.random() * 0.08;
    if (pan) { pan.pan.value = Math.random() * 1.8 - 0.9; out.connect(pan).connect(this.master); } else out.connect(this.master);
    const note = (t, f0, f1, len, vol = 1) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.02);
    };
    const base = 2200 + Math.random() * 2200;
    if (kind === 0) { const n = 3 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) note(at + i * 0.13, base * 1.3, base * 0.8, 0.09); }
    else if (kind === 1) { note(at, base, base * 1.5, 0.12); note(at + 0.16, base * 1.5, base * 0.9, 0.18); note(at + 0.4, base * 1.2, base * 1.25, 0.25, 0.7); }
    else { for (let i = 0; i < 9; i++) note(at + i * 0.045, base * (1 + (i % 2) * 0.12), base * (1.05 + (i % 2) * 0.1), 0.035, 0.6); note(at + 0.45, base * 0.8, base * 1.4, 0.2); }
  }

  knock(v) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 400; f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.12 * v + 0.02, now + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    src.connect(f).connect(g).connect(this.master); src.start(now, Math.random()); src.stop(now + 0.14);
    this.drip(now + 0.02, 1);
  }
}
