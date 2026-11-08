// Why Diwali?: one dark valley, six stories around a lake. Tap what glows; everything you light stays lit.
// The finale pulls back over the whole glowing valley and the sky fills with fireworks.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { postOnX } from '../../shared/share-x.js';
import { INTRO, CH, END } from './story.js';
import { Particles, TEX, updateDiyas, diyas } from './fx.js';
import { buildWorld } from './world.js';
import * as ST from './stations.js';

const $ = (id) => document.getElementById(id);
// #rec: the page renders one frame per __wd.step() call (for recording the demo video) and logs sound events.
const REC = location.hash === '#rec';
const ev = (name) => { if (REC) (window.__ev ||= []).push([performance.now() / 1000, name]); };
const V3 = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

// ---------- renderer ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#120c26', 0.0075);
const camera = new THREE.PerspectiveCamera(55, 1, 0.2, 1200);
scene.add(new THREE.HemisphereLight('#3a3f8a', '#120c18', 0.9));
const moonless = new THREE.DirectionalLight('#6a6ad0', 0.25); moonless.position.set(-30, 60, 20); scene.add(moonless);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.8);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- world ----------
const world = buildWorld(scene);
const P = new Particles(scene);

// warm point lights the stories switch on
const lightPool = [];
function light(pos) { const l = new THREE.PointLight('#ffb060', 0, 28, 1.7); l.position.copy(pos); scene.add(l); lightPool.push(l); return l; }

// ---------- sound ----------
let ac = null, soundOn = true, noiseBuf = null;
function unlock() { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); } if (ac?.state === 'suspended') ac.resume(); }
const live = () => soundOn && ac && ac.state === 'running';
function bell(f = 660, vol = 0.18, dur = 1.6) {
  ev(`bell:${f.toFixed(1)}:${vol}:${dur}`);
  if (!live()) return;
  const t = ac.currentTime;
  [[1, 1], [2.76, 0.35], [5.4, 0.15]].forEach(([m, v]) => {
    const o = ac.createOscillator(), gn = ac.createGain();
    o.frequency.value = f * m; gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol * v, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / m ** 0.3);
    o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + dur);
  });
}
function noise(dur, f = 1000, f2 = null, vol = 0.3, type = 'lowpass') {
  if (!live()) return;
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t = ac.currentTime, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), gn = ac.createGain();
  s.buffer = noiseBuf; s.loop = true; fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(vol, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(gn).connect(ac.destination); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
const whoosh = () => { ev('whoosh'); noise(0.45, 500, 3000, 0.2, 'bandpass'); };
const boom = () => { ev('boom'); noise(1.8, 900, 50, 0.45); noise(0.8, 3000, null, 0.05, 'highpass'); };
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];
const chime = (i) => bell(SCALE[i % SCALE.length] * (1 + Math.floor(i / SCALE.length)) / 2, 0.16);
const win = () => [0, 2, 4, 5].forEach((k, i) => setTimeout(() => bell(SCALE[k], 0.14, 2.2), i * 130));
const voice = new Audio(); voice.preload = 'auto';
function narrate(name) { voice.pause(); if (!soundOn || !name) return; voice.src = `vo/${name}.mp3`; voice.play().catch(() => {}); }
$('sound').addEventListener('click', () => {
  soundOn = !soundOn; unlock(); if (!soundOn) voice.pause();
  $('sound').textContent = soundOn ? '🔊' : '🔇'; $('sound').setAttribute('aria-pressed', String(soundOn)); $('sound').setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
});

// ---------- fireworks ----------
const FWC = [[2.4, 0.5, 0.4], [2.4, 1.4, 0.3], [2.4, 2.1, 0.8], [0.6, 2.4, 0.9], [0.6, 1.2, 2.4], [1.6, 0.7, 2.4], [2.4, 0.7, 1.6], [2.3, 2.2, 2.0]].map((c) => new THREE.Color(...c));
const rockets = [];
const flash = new THREE.PointLight('#ffffff', 0, 140, 1.2); scene.add(flash);
function firework(at) {
  const from = at.clone(); from.y = Math.max(0, at.y - 22);
  rockets.push({ p: from.clone(), from, to: at.clone(), t: 0, T: 1.1 + Math.random() * 0.4 }); ev('launch');
  noise(1.2, 2000, 5000, 0.07, 'bandpass');
}
function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i]; r.t += dt / r.T; const u = 1 - (1 - Math.min(1, r.t)) ** 2;
    r.p.lerpVectors(r.from, r.to, u);
    for (let k = 0; k < 3; k++) P.spawn(r.p, new V3(rand(-0.5, 0.5), rand(-2, -0.5), rand(-0.5, 0.5)), new THREE.Color(2, 1.4, 0.6), rand(0.3, 0.6), 1, 0.95, 0.7);
    if (r.t >= 1) {
      rockets.splice(i, 1);
      const c = pick(FWC), c2 = Math.random() < 0.5 ? pick(FWC) : new THREE.Color(2.3, 2.2, 2);
      P.burst(r.to, c, c2, mode === 'end' || mode === 'finale' ? 220 : 160, mode === 'end' || mode === 'finale' ? rand(12, 16) : rand(8, 11));
      flash.intensity = 50; flash.color.copy(c).multiplyScalar(0.4); flash.position.copy(r.to);
      boom();
    }
  }
}

// ---------- tap targets: everything you can tap glows with a ring ----------
const targets = [];
const ringMat = new THREE.SpriteMaterial({ map: TEX.ring, color: new THREE.Color(1.25, 0.95, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
function target(getPos, onTap, size = 1) {
  const ring = new THREE.Sprite(ringMat); ring.renderOrder = 10; scene.add(ring);
  const t = { getPos, onTap, ring, size, alive: true, ph: Math.random() * 6, remove() { if (!t.alive) return; t.alive = false; scene.remove(ring); targets.splice(targets.indexOf(t), 1); } };
  targets.push(t);
  return t;
}
function project(p) {
  const v = p.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, on: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
}
canvas.addEventListener('pointerdown', (e) => {
  unlock();
  if (mode === 'end') {
    const dir = new V3((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    const at = camera.position.clone().addScaledVector(dir, 80); at.y = Math.max(at.y, 18); firework(at); return;
  }
  let best = null, bd = Infinity;
  for (const t of targets) {
    const p = project(t.getPos()); if (!p.on) continue;
    const d = Math.hypot(p.x - e.clientX, p.y - e.clientY);
    if (d < Math.max(52, 44 * t.size) && d < bd) { bd = d; best = t; }
  }
  if (best) { best.onTap(best); tapRipple(e.clientX, e.clientY, true); } else if (targets.length) tapRipple(e.clientX, e.clientY, false);
});
function tapRipple(x, y, hit) { const r = document.createElement('i'); r.className = 'ripple' + (hit ? ' hit' : ''); r.style.left = `${x}px`; r.style.top = `${y}px`; $('fx').append(r); setTimeout(() => r.remove(), 650); }

// floating words above things ("3 / 12", "A light went out")
const floats = [];
function say(text, at) { const el = document.createElement('div'); el.className = 'float'; el.textContent = text; $('fx').append(el); floats.push({ el, at: at.clone(), born: performance.now() }); }

// ---------- camera ----------
const camPos = new V3(70, 36, 70), camLook = new V3(0, 0, 0);
const fly = { from: null, to: null, t: 1, dur: 1, arc: 0 };
function flyTo(p, l, dur = 3, arc = 4) { fly.from = { p: camPos.clone(), l: camLook.clone() }; fly.to = { p: p.clone(), l: l.clone() }; fly.t = 0; fly.dur = dur; fly.arc = arc; }
const sstep = (u) => u * u * (3 - 2 * u);
// Pull the camera back along its view line until every point to tap fits on this screen (portrait phones are narrow),
// keeping clear of the top bar and the tip.
const probe = new THREE.PerspectiveCamera();
function fit(pos, look, pts, bottom = -0.9) {
  if (!pts.length) return [pos, look];
  probe.fov = camera.fov; probe.aspect = camera.aspect; probe.near = camera.near; probe.far = camera.far; probe.updateProjectionMatrix();
  const back = pos.clone().sub(look);
  let p = pos.clone();
  for (let k = 0; k < 60; k++) {
    probe.position.copy(p); probe.lookAt(look); probe.updateMatrixWorld();
    const ok = pts.every((q) => { const v = q.clone().project(probe); return v.z < 1 && Math.abs(v.x) < 0.8 && v.y < 0.62 && v.y > bottom; });
    if (ok) break;
    p = look.clone().add(back.multiplyScalar(1.06));
  }
  return [p, look];
}

// ---------- UI ----------
let lamps = 0, mode = 'title', ci = -1, playing = false, completeAt = -1, endT = 0, nextFw = 0;
function addLamp(n = 1) { lamps += n; $('lamps').textContent = lamps; if (n) $('lampBox').animate?.([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], 320); }
function setTip(t) { const el = $('tip'); el.querySelector('span').textContent = t; el.classList.toggle('show', !!t); }

// ---------- stories ----------
const ctx = { scene, camera, P, target, light, chime, bell, boom, whoosh, win, firework, flyTo, say, temple: world.temple,
  noise: (d, f, f2, v) => noise(d, f, f2, v, 'bandpass'), addLamp, setTip, isPlaying: () => playing };
const stations = [ST.rama(ctx), ST.krishna(ctx), ST.lakshmi(ctx), ST.bandi(ctx), ST.mahavira(ctx), ST.days(ctx, $('fx'))];

const prog = $('prog');
CH.forEach((c) => { const i = document.createElement('i'); i.title = c.title; prog.append(i); });
function card({ kicker, title, paras, vo, buttons }) {
  $('kicker').textContent = kicker; $('title').textContent = title;
  $('body').innerHTML = paras.map((p) => `<p>${p}</p>`).join('');
  const a = $('actions'); a.innerHTML = '';
  buttons.forEach(([label, fn, ghost]) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (ghost ? ' ghost' : ''); b.textContent = label; b.addEventListener('click', () => { unlock(); fn(); }); a.append(b); });
  $('card').classList.add('show');
  narrate(vo);
}
const hideCard = () => $('card').classList.remove('show');

$('go').addEventListener('click', () => {
  unlock();
  $('titleScreen').classList.add('gone'); $('hud').classList.add('show');
  mode = 'intro';
  flyTo(new V3(-14, 20, 50), new V3(-16, 0, 0), 4, 2);
  card({ ...INTRO, vo: 'intro', buttons: [['Begin the first story →', () => chapter(0)]] });
});
function chapter(i) {
  ci = i; mode = 'story'; playing = false; completeAt = -1; $('skip').hidden = false;
  const st = stations[i], ch = CH[i];
  st.active = true;
  [...prog.children].forEach((d, k) => { d.classList.toggle('on', k < i); d.classList.toggle('now', k === i); });
  $('where').textContent = ch.title;
  const [cp, cl] = fit(st.cam[0], st.cam[1], st.focus?.() || [], st.fitBottom);
  flyTo(cp, cl, 3.5, 6);
  setTip('');
  card({ kicker: ch.kicker, title: ch.title, paras: ch.story, vo: `${ch.key}-story`, buttons: [['✨ Play', () => { hideCard(); voice.pause(); playing = true; mode = 'play'; setTip(st.tip); st.begin(); }]] });
}
// Skip: leave this story (its lamps light in the finale anyway) and go straight to the next one.
$('skip').addEventListener('click', () => {
  if (ci < 0 || mode === 'finale' || mode === 'end') return;
  unlock(); voice.pause();
  const st = stations[ci];
  st.complete = true; st.active = false; st.hideLabels?.();
  [...targets].forEach((t) => t.remove());
  prog.children[ci].classList.add('on');
  playing = false; hideCard();
  if (ci === CH.length - 1) finale(); else chapter(ci + 1);
});
function storyDone() {
  playing = false; mode = 'fact'; setTip('');
  const ch = CH[ci], last = ci === CH.length - 1;
  prog.children[ci].classList.add('on');
  if (last) stations[ci].hideLabels?.();
  card({ kicker: ch.kicker, title: 'Why it matters', paras: ch.fact, vo: `${ch.key}-fact`, buttons: [[last ? '🎆 Light up the whole valley' : 'Next story →', () => (last ? finale() : chapter(ci + 1))]] });
}
function finale() {
  hideCard(); mode = 'finale'; voice.pause(); setTip(''); $('skip').hidden = true;
  $('where').textContent = 'Happy Diwali';
  flyTo(new V3(0, 46, 74), new V3(0, 4, -10), 7, 8);
  diyas.forEach((d) => { if (!d.on) setTimeout(() => d.light(), 1500 + Math.random() * 4500); });
  setTimeout(() => world.temple.setLit(1), 1200);
  setTimeout(() => {
    mode = 'end'; endT = T; nextFw = T;
    const total = diyas.length; $('lamps').textContent = total;
    card({ kicker: `${total} lamps lit · tap the sky for fireworks`, title: END.title, paras: END.paras, vo: 'end',
      buttons: [['Share on X', () => postOnX({ path: 'why-diwali/', text: 'I lit up a whole valley and found out why people celebrate Diwali 🪔' })], ['Play again', () => location.reload(), true]] });
  }, 7500);
}

// ---------- loop ----------
let T = 0, last = performance.now(), winA = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
  if (mode === 'title') { const a = T * 0.04 + 0.6; camPos.set(Math.sin(a) * 84, 34, Math.cos(a) * 84); camLook.set(0, 2, 0); }
  else if (fly.t < 1) {
    fly.t = Math.min(1, fly.t + dt / fly.dur); const u = sstep(fly.t);
    camPos.lerpVectors(fly.from.p, fly.to.p, u); camPos.y += Math.sin(u * Math.PI) * fly.arc; camLook.lerpVectors(fly.from.l, fly.to.l, u);
  }
  camera.position.copy(camPos).add(new V3(Math.sin(T * 0.31) * 0.25, Math.sin(T * 0.43) * 0.15, 0));
  camera.lookAt(camLook);

  stations.forEach((s) => s.update(dt, T, project));
  if (playing && stations[ci].complete) {
    if (completeAt < 0) completeAt = T;
    if (T - completeAt > stations[ci].celebrate) storyDone();
  }
  if (mode === 'finale' || mode === 'end') {
    winA = Math.min(1, winA + dt * 0.4);
    world.winMat.color.setRGB(0.1 + 1.0 * winA, 0.07 + 0.65 * winA, 0.05 + 0.22 * winA);
    lightPool.forEach((l) => { l.intensity = Math.max(l.intensity, 18 * winA); });
    if (mode === 'end' && T > nextFw) { const a = rand(0, Math.PI * 2), r = rand(0, 45); firework(new V3(Math.cos(a) * r, rand(24, 38), Math.sin(a) * r - 10)); nextFw = T + rand(0.4, 1.1); }
    if (mode === 'finale' && Math.random() < dt * 2.5) firework(new V3(rand(-40, 40), rand(26, 36), rand(-45, 15)));
  }
  updateDiyas(T, dt);
  updateRockets(dt);
  P.update(dt);
  flash.intensity *= Math.exp(-dt * 5);
  targets.forEach((t) => { t.ring.position.copy(t.getPos()); const s = t.size * (0.9 + 0.18 * Math.sin(T * 5 + t.ph)); t.ring.scale.set(s, s, 1); });
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i], age = (now - f.born) / 1000;
    if (age > 1.6) { f.el.remove(); floats.splice(i, 1); continue; }
    const p = project(f.at); f.el.style.transform = `translate(${p.x}px, ${p.y - 30 - age * 40}px) translate(-50%, -50%)`; f.el.style.opacity = String(Math.min(1, (1.6 - age) * 2));
  }
  composer.render();
  if (!REC) requestAnimationFrame(frame);
}
function resize() {
  const w = innerWidth, h = innerHeight, dpr = REC ? devicePixelRatio : Math.min(1.75, devicePixelRatio || 1);
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr); composer.setSize(w, h);
  bloom.resolution.set(w / 2, h / 2);
  camera.aspect = w / h; camera.fov = w < h ? 62 : 50; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
if (!REC) requestAnimationFrame(frame);
if (location.hash === '#test' || REC) window.__wd = { stations, get mode() { return mode; }, chapter, finale, targets, project, camera, step() { frame(performance.now()); }, skip() { if (fly.to) { camPos.copy(fly.to.p); camLook.copy(fly.to.l); fly.t = 1; } } };
