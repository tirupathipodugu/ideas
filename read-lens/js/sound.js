// Soft synthesised sounds (WebAudio, nothing to download): a paper tick per line, a blip when a page
// is found, a two-note chime when a page is finished, a shutter click when the page photo is
// taken, a soft ping when a Live note arrives.
export class Sound {
  constructor() { this.on = true; this.ctx = null; }
  ready() {
    if (!this.on) return null;
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  tone(freq, delay, len, vol = 0.08, type = 'sine') {
    const ctx = this.ready(); if (!ctx) return;
    const at = ctx.currentTime + delay;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    gn.gain.setValueAtTime(0.0001, at);
    gn.gain.exponentialRampToValueAtTime(vol, at + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(gn).connect(ctx.destination);
    o.start(at); o.stop(at + len + 0.03);
  }
  tick() { this.tone(1800, 0, 0.04, 0.035, 'triangle'); }
  start() { this.tone(660, 0, 0.12, 0.07); this.tone(990, 0.07, 0.16, 0.06); }
  found() { this.tone(520, 0, 0.1, 0.06); this.tone(780, 0.08, 0.14, 0.05); }
  // Camera shutter: a short filtered noise click.
  shutter() {
    const ctx = this.ready(); if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
    src.buffer = buf; f.type = 'highpass'; f.frequency.value = 1200; gn.gain.value = 0.25;
    src.connect(f).connect(gn).connect(ctx.destination);
    src.start();
  }
  note() { this.tone(1175, 0, 0.18, 0.035); this.tone(1568, 0.06, 0.22, 0.03); }
  done() { this.tone(784, 0, 0.3, 0.08); this.tone(1047, 0.12, 0.4, 0.08); this.tone(1319, 0.24, 0.5, 0.06); }
}
