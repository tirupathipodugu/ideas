// All sound is synthesised, plus the browser's voice to call out each stretch so nobody has to read
// the screen while their arms are in the air. Audio unlocks on the Start tap.

export class Sound {
  constructor() {
    this.on = true;
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 1 : 0;
      this.master.connect(this.ctx.destination);
      this.rumbleGain = this.ctx.createGain();
      this.rumbleGain.gain.value = 0;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 46;
      const low = this.ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 170;
      osc.connect(low).connect(this.rumbleGain).connect(this.master);
      osc.start();
    }
    this.ctx.resume?.();
  }

  setOn(on) {
    this.on = on;
    if (this.master) this.master.gain.value = on ? 1 : 0;
    if (!on) window.speechSynthesis?.cancel();
  }

  /** The wall's rumble: 0 (far away or silent) to 1 (right behind you). */
  rumble(amount) {
    if (this.ctx) this.rumbleGain.gain.setTargetAtTime(amount * 0.2, this.ctx.currentTime, 0.08);
  }

  tone(freq, length, volume = 0.16, type = 'sine', delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  noise(length, volume, filterType, fromHz, toHz, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const buffer = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * length), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(fromHz, t);
    filter.frequency.exponentialRampToValueAtTime(toHz, t + length);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t);
  }

  tick() { this.tone(880, 0.09, 0.1); }
  fit() { this.tone(660, 0.12, 0.09); this.tone(990, 0.16, 0.08, 'sine', 0.07); }
  strain() { this.tone(170, 0.14, 0.14, 'square'); }

  pass() {
    this.noise(0.55, 0.45, 'bandpass', 300, 2600);
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.28, 0.1, 'triangle', 0.05 + i * 0.07));
  }

  smash() {
    this.noise(0.75, 0.9, 'lowpass', 5200, 240);
    this.tone(62, 0.5, 0.45, 'sine');
    for (let i = 0; i < 9; i++) this.tone(1500 + Math.random() * 2800, 0.1, 0.04, 'triangle', 0.08 + Math.random() * 0.5);
  }

  over() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 0.12, 'triangle', i * 0.18)); }

  say(text) {
    const speech = window.speechSynthesis;
    if (!this.on || !speech || typeof SpeechSynthesisUtterance === 'undefined') return;
    speech.cancel();
    const line = new SpeechSynthesisUtterance(text);
    line.rate = 1.02;
    speech.speak(line);
  }
}
