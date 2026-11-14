// Garden ambience, all synthesised: a soft breeze, leaves rustling when hands move, birdsong now and
// then, and a little shimmer when a garden starts to grow. Starts after the first tap (browser rule).

let ctx = null, noise = null, master = null, rustle = null, breeze = null, on = true, nextBird = 0;

function noiseBuffer(c) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 + w * 0.15; }
  return b;
}

export function unlock() {
  if (ctx) { ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = on ? 0.9 : 0;
  master.connect(ctx.destination);
  const buf = noiseBuffer(ctx);
  noise = buf;
  const loop = (freq, q, type) => {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(master); src.start();
    return g;
  };
  breeze = loop(500, 0.4, 'lowpass');
  rustle = loop(3200, 0.8, 'bandpass');
  breeze.gain.setTargetAtTime(0.12, ctx.currentTime, 1.5);
  nextBird = ctx.currentTime + 2;
}

export function setOn(v) {
  on = v;
  if (master) master.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.1);
}

function chirp(t0, f0, f1, dur, vol) {
  const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner?.();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.2);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (p) { p.pan.value = Math.random() * 1.6 - 0.8; o.connect(g).connect(p).connect(master); } else o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function birdsong(t0) {
  const base = 2200 + Math.random() * 1800, notes = 2 + Math.floor(Math.random() * 5);
  let t = t0;
  for (let i = 0; i < notes; i++) {
    const up = Math.random() < 0.5, d = 0.06 + Math.random() * 0.1;
    chirp(t, base * (up ? 0.8 : 1.25), base * (up ? 1.3 : 0.75), d, 0.035);
    t += d + 0.03 + Math.random() * 0.06;
  }
}

export function bloom() {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
  [1046, 1318, 1568, 2093].forEach((f, i) => chirp(t + i * 0.09, f, f * 1.01, 0.9, 0.025));
}

/** Call every frame with how fast the hands move (palm lengths per second) and whether any garden is up. */
export function tick(speed, gardenUp) {
  if (!ctx) return;
  const t = ctx.currentTime;
  rustle.gain.setTargetAtTime(Math.min(0.5, speed * 0.12), t, 0.08);
  if (t > nextBird) {
    if (gardenUp || Math.random() < 0.3) birdsong(t);
    nextBird = t + 3 + Math.random() * 6;
  }
}

/** A leafy rustle burst: a clap (1) or a rub (smaller). */
export function shake(amount = 1) {
  if (!ctx || !on || !noise) return;
  const t = ctx.currentTime, src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400 + Math.random() * 1500; f.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5 * amount, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + amount * 0.5);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random()); src.stop(t + 1);
}
