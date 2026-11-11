// Sound: real recordings (see assets/sfx/CREDITS.md) for the city, engines, tyres, sirens, guns and crashes,
// and three radio stations of real tracks that play while you drive, like in GTA.
import { G, clamp, rnd } from './core.js';

export let ac = null;
let master, sfxBus, loopBus, radioBus;
export const sound = { on: true, station: 0 };
export const STATIONS = ['ELON FM · Vice Police', 'MARS RADIO · Gang$tazz', 'HYPERLOOP FM · Maximum Overdrive', 'RADIO OFF'];
const TRACKS = ['radio1', 'radio2', 'radio3'];
const NAMES = ['city', 'engine', 'ev', 'skid', 'crash1', 'crash2', 'crash3', 'boom1', 'boom2', 'siren', 'horn', 'door', 'punch1', 'punch2', 'step', 'flare', 'zap', 'flame', 'jet', 'launch', 'splash', 'cash', 'passed', 'scream'];
const buf = {};

export const initAudio = () => {
  if (ac) return ac.resume();
  // On iPhone this lets the game play even with the silent switch on.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {}
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain();
  master.gain.value = sound.on ? 0.9 : 0;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 6;
  master.connect(comp).connect(ac.destination);
  sfxBus = ac.createGain();
  sfxBus.connect(master);
  loopBus = ac.createGain();
  loopBus.connect(master);
  radioBus = ac.createGain();
  radioBus.gain.value = 0;
  radioBus.connect(master);
  for (const n of NAMES)
    fetch(`assets/sfx/${n}.mp3`)
      .then(r => r.arrayBuffer())
      .then(a => ac.decodeAudioData(a))
      .then(b => {
        buf[n] = b;
        startLoop(n);
      })
      .catch(err => console.warn('sound', n, err));
  makeRadio();
};
export const setSound = on => {
  sound.on = on;
  if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.05);
  if (!on) radio?.pause();
};

/* ------------- loops: city, engine, tyres, fire, thrusters, siren, footsteps ------------- */
const loops = {};
const LOOPS = ['city', 'engine', 'ev', 'skid', 'flame', 'jet', 'siren', 'step'];
const startLoop = n => {
  if (!LOOPS.includes(n) || loops[n]) return;
  const s = ac.createBufferSource();
  s.buffer = buf[n];
  s.loop = true;
  // Skip MP3 padding at the seam.
  s.loopStart = 0.03;
  s.loopEnd = buf[n].duration - 0.03;
  const g = ac.createGain();
  g.gain.value = 0;
  s.connect(g).connect(loopBus);
  s.start(0, n === 'city' || n === 'siren' ? rnd(0, buf[n].duration - 1) : 0.03);
  loops[n] = { s, g };
};
const set = (n, gain, rate) => {
  const l = loops[n];
  if (!l) return;
  const t = ac.currentTime;
  l.g.gain.setTargetAtTime(gain, t, 0.08);
  if (rate) l.s.playbackRate.setTargetAtTime(rate, t, 0.05);
};

// Called every frame with what is going on.
// engine: 0/1 in a car; rpm 0..1.2; fire, jet 0..1; siren: loudness of the nearest siren; skid 0..1;
// walk: your speed on foot; inside: muffles the city (tunnels, cutscenes).
export const audioFrame = ({ engine = 0, rpm = 0, fire = 0, jet = 0, siren = 0, skid = 0, walk = 0, inside = 0, electric = 1 }) => {
  if (!ac) return;
  set('city', (engine ? 0.22 : 0.42) * (1 - inside * 0.85));
  // Teslas are electric: mostly motor whine and tyre roar, a little engine body for weight.
  set('engine', engine * (0.05 + rpm * 0.12) * (electric ? 0.5 : 1), 0.55 + rpm * 1.25);
  set('ev', engine * electric * (0.02 + rpm * 0.1), 0.45 + rpm * 1.1);
  set('skid', clamp(skid, 0, 1) * 0.5, 0.9 + skid * 0.2);
  set('flame', fire * 0.55);
  set('jet', jet * 0.5, 0.8 + jet * 0.4);
  set('siren', clamp(siren, 0, 1) * 0.45);
  set('step', walk > 0.3 ? clamp(walk / 4, 0.25, 0.6) * 0.5 : 0, clamp(walk / 1.6, 0.8, 2.1));
  // The radio plays while you drive, as in GTA.
  radioBus.gain.setTargetAtTime(engine && sound.station < 3 ? 0.55 : 0, ac.currentTime, 0.3);
  if (radio) {
    const want = engine && sound.station < 3 && sound.on && G.started;
    if (want && radio.paused) radio.play().catch(() => {});
    if (!want && !radio.paused && radioBus.gain.value < 0.02) radio.pause();
  }
};

/* ------------- one-shots ------------- */
const play = (n, gain = 1, rate = 1, at = 0, dur) => {
  if (!ac || !sound.on || !buf[n]) return;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = buf[n];
  s.playbackRate.value = rate;
  g.gain.value = gain;
  s.connect(g).connect(sfxBus);
  s.start(0, at, dur);
  if (dur) {
    g.gain.setValueAtTime(gain, ac.currentTime + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, ac.currentTime + dur);
  }
};
// Small synthesised UI chimes, kept short and quiet.
const tone = (f0, f1, dur, gain, delay = 0, type = 'triangle') => {
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
let lastScream = -99;
export const sfx = {
  boom: (k = 1) => play(k >= 1.1 ? 'boom1' : 'boom2', clamp(0.55 + k * 0.4, 0.4, 1.2), rnd(0.92, 1.05)),
  crash: (k = 1) => play(['crash1', 'crash2', 'crash3'][Math.floor(rnd(0, 3))], clamp(0.25 + k * 0.6, 0.2, 1), rnd(0.9, 1.1)),
  punch: () => play(Math.random() < 0.5 ? 'punch1' : 'punch2', 0.8, rnd(0.9, 1.1)),
  zap: () => play('zap', 0.7, rnd(0.95, 1.1)),
  taser: () => play('zap', 0.35, 1.6),
  horn: () => play('horn', 0.7),
  coin: () => play('cash', 0.55, 1.1),
  heal: () => [523, 659, 784].forEach((f, i) => tone(f, f, 0.22, 0.06, i * 0.07)),
  door: () => play('door', 0.7, rnd(0.95, 1.05)),
  splash: () => play('splash', 0.8),
  beam: () => {
    play('zap', 0.8, 0.55);
    play('jet', 0.6, 1.3, 0, 1.4);
  },
  whoosh: () => play('jet', 0.45, 1.4, rnd(0, 4), 0.9),
  flare: () => play('flare', 0.8, rnd(0.95, 1.05)),
  scream: () => {
    if (!ac || ac.currentTime - lastScream < 6) return;
    lastScream = ac.currentTime;
    play('scream', 0.45, rnd(0.95, 1.08));
  },
  star: () => tone(660, 440, 0.18, 0.05, 0, 'square'),
  pass: () => play('passed', 0.8),
  fail: () => [392, 349, 311, 262].forEach((f, i) => tone(f, f, 0.3, 0.06, i * 0.22, 'square')),
  wasted: () => {
    play('boom2', 0.6, 0.5);
    tone(200, 40, 2.2, 0.15, 0, 'sine');
  },
  blip: () => tone(1200, 1200, 0.06, 0.05, 0, 'sine'),
  launch: () => play('launch', 1.1),
};

/* ------------- radio: three stations of real tracks ------------- */
let radio = null;
const makeRadio = () => {
  radio = new Audio();
  radio.loop = true;
  radio.preload = 'auto';
  radio.src = `assets/sfx/${TRACKS[sound.station % 3]}.mp3`;
  try {
    ac.createMediaElementSource(radio).connect(radioBus);
  } catch {
    radio.volume = 0.5;
  }
};
export const nextStation = () => {
  sound.station = (sound.station + 1) % STATIONS.length;
  if (radio && sound.station < 3) {
    radio.src = `assets/sfx/${TRACKS[sound.station]}.mp3`;
    radio.currentTime = 0;
  }
  return STATIONS[sound.station];
};
