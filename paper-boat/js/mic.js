// Blow detection. Blowing on a mic is loud, broadband, low-frequency noise (wind rumble), while speech
// is tonal (harmonic peaks, low spectral flatness). We measure 0-1 kHz energy against a noise floor
// calibrated over the first second, and weight it by spectral flatness so talking barely moves the boat.

export class Mic {
  constructor() {
    this.level = 0;
    this.active = false;
    this.calibrating = false;
    this.floor = -70;
  }

  async start(ctx) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const an = this.an = ctx.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.15;
    src.connect(an); // analyser only, never to the speakers
    this.buf = new Float32Array(an.frequencyBinCount);
    this.binHz = ctx.sampleRate / an.fftSize;
    this.active = true;
    this.calibrate();
  }

  calibrate() {
    this.calibrating = true;
    this.samples = [];
    this.calStart = performance.now();
  }

  read() {
    const an = this.an, b = this.buf;
    an.getFloatFrequencyData(b);
    const hiLow = Math.max(2, Math.round(1000 / this.binHz));
    const hiMid = Math.min(b.length - 1, Math.round(4000 / this.binHz));
    let pLow = 0, sum = 0, logSum = 0, n = 0;
    for (let i = 1; i <= hiMid; i++) {
      const p = Math.pow(10, Math.max(b[i], -140) / 10);
      if (i <= hiLow) pLow += p;
      sum += p; logSum += Math.log(p + 1e-20); n++;
    }
    const lowDb = 10 * Math.log10(pLow / hiLow + 1e-20);
    const flat = Math.exp(logSum / n) / (sum / n + 1e-20);
    return { lowDb, flat };
  }

  update(dt) {
    if (!this.active) return 0;
    const { lowDb, flat } = this.read();
    this.last = { lowDb, flat, floor: this.floor };
    if (this.calibrating) {
      this.samples.push(lowDb);
      if (performance.now() - this.calStart > 1000) {
        const m = this.samples.reduce((a, c) => a + c, 0) / this.samples.length;
        const sd = Math.sqrt(this.samples.reduce((a, c) => a + (c - m) ** 2, 0) / this.samples.length);
        this.floor = Math.max(-95, m + 1.5 * sd);
        this.calibrating = false;
      }
      return 0;
    }
    // let the floor drift down if the room gets quieter, and very slowly up if it gets noisier
    if (lowDb < this.floor) this.floor += (lowDb - this.floor) * Math.min(1, dt * 0.5);
    else if (this.level < 0.05) this.floor += (lowDb - this.floor) * Math.min(1, dt * 0.02);
    const over = (lowDb - this.floor - 7) / 24;
    // measured: breath noise sits at flatness 0.27-0.55, a loud voiced buzz at 0.00-0.15
    this.flatS = (this.flatS ?? flat) + (flat - (this.flatS ?? flat)) * Math.min(1, dt * 8);
    const tonalPenalty = 0.06 + 0.94 * smooth(0.13, 0.24, this.flatS);
    const target = Math.max(0, Math.min(1, over)) * tonalPenalty;
    const k = target > this.level ? 18 : 4; // fast attack, gentle release
    this.level += (target - this.level) * Math.min(1, dt * k);
    return this.level;
  }

  stop() {
    this.active = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
  }
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
