// All sound is made in the browser: engines, fire, sirens, hits, and three radio stations.
import { G, clamp } from './core.js';

export let ac = null;
let master, sfxBus, radioBus, noiseBuf;
export const sound = { on: true, station: 0 };
export const STATIONS = ['ELON FM · synthwave', 'MARS RADIO · lo-fi', 'HYPERLOOP · techno', 'RADIO OFF'];

export const initAudio = () => {
  if (ac) return ac.resume();
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain();
  master.gain.value = 0.8;
  const comp = ac.createDynamicsCompressor();
  master.connect(comp).connect(ac.destination);
  sfxBus = ac.createGain();
  sfxBus.connect(master);
  radioBus = ac.createGain();
  radioBus.gain.value = 0.32;
  radioBus.connect(master);
  noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  makeLoops();
  radioTick();
};
export const setSound = on => {
  sound.on = on;
  if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ac.currentTime, 0.05);
};

const noise = () => {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  return s;
};

/* ------------- continuous: engine, fire, siren, thrusters ------------- */
let loops = null;
const makeLoops = () => {
  const o1 = ac.createOscillator(), o2 = ac.createOscillator();
  o1.type = 'sawtooth';
  o2.type = 'triangle';
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const eg = ac.createGain();
  eg.gain.value = 0;
  o1.connect(lp);
  o2.connect(lp);
  lp.connect(eg).connect(sfxBus);
  o1.start();
  o2.start();
  // Electric whine on top.
  const w = ac.createOscillator();
  w.type = 'sine';
  const wg = ac.createGain();
  wg.gain.value = 0;
  w.connect(wg).connect(sfxBus);
  w.start();
  const fire = noise(), fbp = ac.createBiquadFilter(), fg = ac.createGain();
  fbp.type = 'bandpass';
  fbp.frequency.value = 900;
  fbp.Q.value = 0.6;
  fg.gain.value = 0;
  fire.connect(fbp).connect(fg).connect(sfxBus);
  fire.start();
  const jet = noise(), jlp = ac.createBiquadFilter(), jg = ac.createGain();
  jlp.type = 'lowpass';
  jlp.frequency.value = 600;
  jg.gain.value = 0;
  jet.connect(jlp).connect(jg).connect(sfxBus);
  jet.start();
  const sir = ac.createOscillator(), sg = ac.createGain();
  sir.type = 'square';
  sg.gain.value = 0;
  const slp = ac.createBiquadFilter();
  slp.type = 'lowpass';
  slp.frequency.value = 1800;
  sir.connect(slp).connect(sg).connect(sfxBus);
  sir.start();
  loops = { o1, o2, eg, w, wg, fg, jg, jlp, sir, sg };
};

// Called every frame with what is going on.
export const audioFrame = ({ engine = 0, rpm = 0, fire = 0, jet = 0, siren = 0 }) => {
  if (!loops) return;
  const n = ac.currentTime;
  loops.o1.frequency.setTargetAtTime(40 + rpm * 70, n, 0.05);
  loops.o2.frequency.setTargetAtTime(80 + rpm * 140, n, 0.05);
  loops.eg.gain.setTargetAtTime(engine * (0.05 + rpm * 0.05), n, 0.08);
  loops.w.frequency.setTargetAtTime(300 + rpm * 900, n, 0.05);
  loops.wg.gain.setTargetAtTime(engine * 0.025 * clamp(rpm, 0, 1), n, 0.08);
  loops.fg.gain.setTargetAtTime(fire * 0.5, n, 0.05);
  loops.jg.gain.setTargetAtTime(jet * 0.7, n, 0.05);
  loops.jlp.frequency.setTargetAtTime(400 + jet * 900, n, 0.05);
  const wail = 700 + 350 * Math.sin(n * 5);
  loops.sir.frequency.setTargetAtTime(wail, n, 0.02);
  loops.sg.gain.setTargetAtTime(siren * 0.05, n, 0.1);
};

/* ------------- one-shots ------------- */
const burst = (freq, gain, dur, type = 'lowpass', q = 1) => {
  if (!ac || !sound.on) return;
  const s = noise(), f = ac.createBiquadFilter(), g = ac.createGain(), n = ac.currentTime;
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  g.gain.setValueAtTime(gain, n);
  g.gain.exponentialRampToValueAtTime(0.001, n + dur);
  s.connect(f).connect(g).connect(sfxBus);
  s.start(n, Math.random());
  s.stop(n + dur + 0.05);
};
const tone = (type, f0, f1, dur, gain, delay = 0) => {
  if (!ac || !sound.on) return;
  const o = ac.createOscillator(), g = ac.createGain(), n = ac.currentTime + delay;
  o.type = type;
  o.frequency.setValueAtTime(f0, n);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), n + dur);
  g.gain.setValueAtTime(0.0001, n);
  g.gain.exponentialRampToValueAtTime(gain, n + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
  o.connect(g).connect(sfxBus);
  o.start(n);
  o.stop(n + dur + 0.05);
};

export const sfx = {
  boom: (k = 1) => {
    burst(120, 1.6 * k, 1.8);
    burst(900, 0.6 * k, 0.4);
    tone('sine', 90, 30, 0.9, 0.8 * k);
  },
  crash: k => {
    burst(700, 0.7 * k, 0.25, 'bandpass', 0.8);
    burst(150, 0.9 * k, 0.4);
  },
  punch: () => {
    burst(300, 0.6, 0.12);
    tone('sine', 140, 60, 0.12, 0.4);
  },
  zap: () => {
    burst(3000, 0.4, 0.2, 'highpass');
    tone('sawtooth', 1800, 200, 0.18, 0.12);
  },
  taser: () => tone('square', 900, 1400, 0.15, 0.06),
  coin: () => {
    tone('square', 988, 988, 0.08, 0.08);
    tone('square', 1319, 1319, 0.25, 0.08, 0.08);
  },
  heal: () => [523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.25, 0.12, i * 0.07)),
  door: () => {
    burst(1600, 0.25, 0.08, 'bandpass', 2);
    burst(200, 0.3, 0.15);
  },
  splash: () => burst(1200, 0.8, 1.2, 'lowpass'),
  beam: () => {
    tone('sawtooth', 220, 1760, 1.2, 0.1);
    burst(2000, 0.6, 1.4, 'bandpass', 0.6);
  },
  whoosh: () => burst(800, 0.6, 0.8, 'bandpass', 0.5),
  star: () => tone('square', 440, 220, 0.3, 0.07),
  pass: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, f, i === 5 ? 0.6 : 0.16, 0.09, i * 0.14)),
  fail: () => [392, 349, 311, 262].forEach((f, i) => tone('square', f, f, 0.3, 0.09, i * 0.22)),
  wasted: () => {
    tone('sine', 200, 40, 2.5, 0.5);
    burst(200, 0.6, 2.5);
  },
  blip: () => tone('sine', 1200, 1200, 0.06, 0.08),
  launch: () => {
    burst(80, 2.4, 9);
    burst(400, 1, 7, 'bandpass', 0.4);
  },
};

/* ------------- radio: three original stations, sequenced live ------------- */
// Each station is a chord loop, a bass line, a lead pattern and drums.
const hz = m => 440 * 2 ** ((m - 69) / 12);
const SONGS = [
  // ELON FM: 80s synthwave, A minor, driving.
  { bpm: 104, chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], bass: [45, 41, 43, 40], lead: [76, 74, 72, 74, 76, 79, 76, 72], wave: 'sawtooth', drums: 'four' },
  // MARS RADIO: slow lo-fi, F major 7ths.
  { bpm: 78, chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]], bass: [41, 40, 38, 36], lead: [72, 0, 69, 72, 74, 0, 72, 69], wave: 'triangle', drums: 'lazy' },
  // HYPERLOOP: fast techno, D minor.
  { bpm: 128, chords: [[50, 53, 57], [50, 53, 57], [46, 50, 53], [48, 52, 55]], bass: [38, 38, 34, 36], lead: [74, 74, 77, 74, 81, 77, 74, 72], wave: 'square', drums: 'four' },
];
let nextNote = 0, step = 0;
const note = (type, f, t, dur, gain, dest = radioBus, cutoff = 2400) => {
  const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
  o.type = type;
  o.frequency.value = f;
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp).connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
};
const hitDrum = (kind, t) => {
  if (kind === 'kick') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(radioBus);
    o.start(t);
    o.stop(t + 0.35);
    return;
  }
  const s = noise(), f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = kind === 'hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hat' ? 7000 : 1800;
  const dur = kind === 'hat' ? 0.05 : 0.18;
  g.gain.setValueAtTime(kind === 'hat' ? 0.18 : 0.45, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(radioBus);
  s.start(t, Math.random());
  s.stop(t + dur + 0.02);
};
const radioTick = () => {
  setTimeout(radioTick, 50);
  if (!ac || sound.station > 2 || !sound.on || !G.started) {
    nextNote = ac ? ac.currentTime + 0.1 : 0;
    return;
  }
  const song = SONGS[sound.station];
  const s16 = 60 / song.bpm / 4;
  while (nextNote < ac.currentTime + 0.25) {
    const t = nextNote, bar = Math.floor(step / 16) % 4, s = step % 16;
    const chord = song.chords[bar];
    if (s === 0) chord.forEach(m => note(song.wave === 'square' ? 'sawtooth' : 'triangle', hz(m), t, s16 * 15, 0.035, radioBus, 1400));
    if (s % 4 === 0 || (song.drums === 'four' && s % 2 === 0)) note('sawtooth', hz(song.bass[bar] - 12 + (s % 8 === 6 ? 12 : 0)), t, s16 * 1.6, 0.12, radioBus, 500);
    if (s % 2 === 0) {
      const m = song.lead[(s / 2 + bar * 2) % 8];
      if (m && (song.drums !== 'lazy' || s % 4 === 0)) note(song.wave, hz(m), t, s16 * 1.8, 0.04, radioBus, 3000);
    }
    if (song.drums === 'four') {
      if (s % 4 === 0) hitDrum('kick', t);
      if (s % 8 === 4) hitDrum('snare', t);
      if (s % 2 === 1) hitDrum('hat', t);
    } else {
      if (s === 0 || s === 10) hitDrum('kick', t);
      if (s === 4 || s === 12) hitDrum('snare', t);
      if (s % 4 === 2) hitDrum('hat', t);
    }
    nextNote += s16;
    step++;
  }
};
export const nextStation = () => {
  sound.station = (sound.station + 1) % STATIONS.length;
  step = 0;
  return STATIONS[sound.station];
};
