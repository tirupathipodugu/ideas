// Paper Boat: a folded notebook-paper boat drifting down an endless mountain stream through a dense forest.
// No score and no finish: the current carries it; tilt, drag or hold Left / Right to nudge it.
import * as THREE from '../vendor/three/three.module.js';
import { shared, skyMat } from './materials.js';
import { World } from './world.js';
import { Boat, DT } from './boat.js';
import { Fauna } from './fauna.js';
import { Sound } from './sound.js';
import { cx, dcx, halfW, level, rapid } from './stream.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const forced = params.get('q');
const phoneish = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 820;
const tier = forced === 'high' ? 'high' : forced === 'low' ? 'low' : phoneish ? 'low' : 'high';
const Q = tier === 'high' ? 1 : 0.42;

const canvas = $('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: tier === 'high', powerPreference: 'high-performance' });
} catch (e) {
  $('status').textContent = 'This browser cannot draw the forest (WebGL2 is off). Try Chrome or Safari.';
  throw e;
}
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders tonemap and gamma-encode themselves
const baseDpr = Math.min(window.devicePixelRatio || 1, tier === 'high' ? 2 : 1.5);
let dprScale = 1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 90);
const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 12), skyMat());
sky.frustumCulled = false; sky.renderOrder = -1;
scene.add(sky);

const world = new World(scene, Q);
const boat = new Boat(scene);
const fauna = new Fauna(scene, Q);
const snd = new Sound();
world.buildAll(boat.z);

// ---------- input ----------
const input = { left: false, right: false, key: 0, dragId: null, dragX: 0, drag: 0, tiltOn: false, tilt: 0, tiltZero: null, tiltAt: 0, override: null };
const hint = $('hint');
let hintUntil = 0;
function setHint(t, secs) { hint.textContent = t; hintUntil = performance.now() + secs * 1000; }

function hold(btn, key) {
  const on = (e) => { e.preventDefault(); snd.unlock(); input[key] = true; btn.classList.add('held'); try { btn.setPointerCapture(e.pointerId); } catch { /* ok */ } };
  const off = () => { input[key] = false; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('lostpointercapture', off);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
hold($('left'), 'left');
hold($('right'), 'right');
window.addEventListener('keydown', (e) => {
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.key = -1;
  if (e.code === 'ArrowRight' || e.code === 'KeyD') input.key = 1;
});
window.addEventListener('keyup', (e) => {
  if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && input.key < 0) input.key = 0;
  if ((e.code === 'ArrowRight' || e.code === 'KeyD') && input.key > 0) input.key = 0;
});
canvas.addEventListener('pointerdown', (e) => { snd.unlock(); input.dragId = e.pointerId; input.dragX = e.clientX; input.drag = 0; try { canvas.setPointerCapture(e.pointerId); } catch { /* ok */ } });
canvas.addEventListener('pointermove', (e) => { if (e.pointerId === input.dragId) input.drag = Math.max(-1, Math.min(1, (e.clientX - input.dragX) / (innerWidth * 0.18))); });
const dragEnd = (e) => { if (e.pointerId === input.dragId) { input.dragId = null; input.drag = 0; } };
canvas.addEventListener('pointerup', dragEnd);
canvas.addEventListener('pointercancel', dragEnd);

const tiltBtn = $('tilt');
function showTilt() {
  tiltBtn.setAttribute('aria-pressed', String(input.tiltOn));
  tiltBtn.querySelector('.lbl').textContent = input.tiltOn ? 'Tilt on' : 'Tilt off';
}
let tiltListening = false;
function onOrient(e) {
  if (e.gamma == null) return;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let v = e.gamma;
  if (ang === 90) v = e.beta; else if (ang === -90 || ang === 270) v = -e.beta;
  if (input.tiltZero == null) input.tiltZero = v;
  input.tilt = Math.max(-1, Math.min(1, (v - input.tiltZero) / 16));
  if (!input.tiltAt && !input.tiltOn) { input.tiltOn = true; showTilt(); }
  input.tiltAt = performance.now();
}
function askTilt() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) { setHint('No motion sensor here: hold Left / Right or use the arrow keys', 5); return; }
  const listen = () => { if (!tiltListening) { window.addEventListener('deviceorientation', onOrient); tiltListening = true; } };
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((r) => { if (r === 'granted') listen(); else setHint('Motion access was declined: hold Left / Right to steer', 5); }).catch(() => {});
  } else listen();
}
tiltBtn.addEventListener('click', () => {
  snd.unlock();
  if (!tiltListening) { askTilt(); input.tiltOn = true; }
  else input.tiltOn = !input.tiltOn;
  input.tiltZero = null;
  showTilt();
});

const soundBtn = $('sound');
soundBtn.addEventListener('click', () => {
  snd.unlock();
  snd.setOn(!snd.on);
  soundBtn.setAttribute('aria-pressed', String(snd.on));
  soundBtn.querySelector('.ic').textContent = snd.on ? '🔊' : '🔇';
  soundBtn.querySelector('.lbl').textContent = snd.on ? 'Sound on' : 'Sound off';
});

$('go').addEventListener('click', () => {
  snd.unlock();
  askTilt();
  $('start').hidden = true;
  setHint('Tilt, or hold Left / Right, to nudge the boat', 6);
});

// ---------- loop ----------
let simT = 0, acc = 0, steerS = 0, rockT = -1;
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };

function steerTarget() {
  if (input.override != null) return input.override;
  if (input.left || input.right) return (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (input.dragId != null) return input.drag;
  if (input.key) return input.key;
  if (input.tiltOn && performance.now() - input.tiltAt < 1000 && Math.abs(input.tilt) > 0.06) return input.tilt;
  return 0;
}

function tick(dt) {
  dt = Math.min(dt, 0.1);
  acc += dt;
  while (acc >= DT) {
    acc -= DT;
    simT += DT;
    // steering eases in and out, so it feels weighty rather than twitchy
    steerS += (steerTarget() - steerS) * (1 - Math.exp(-DT * 4));
    boat.step(simT, steerS);
  }
  boat.sync();
  shared.uTime.value = simT;
  for (const b of boat.bumps.splice(0)) if (b > 0.08) snd.knock(b);
  snd.setRapid(Math.max(rapid(boat.z), rapid(boat.z + 3) * 0.7));
  world.update(boat.z);
  if (simT - rockT > 0.25 || simT < rockT) { rockT = simT; world.rockUniforms(boat.z, world.mats.water.uniforms.uRocks.value); }
  followCam(dt);
  fauna.update(dt, simT, boat, camera.position);
}

function followCam(dt) {
  if (cam.debug) { camera.position.copy(cam.pos); camera.lookAt(cam.look); return; }
  const asp = innerWidth / innerHeight, portrait = asp < 1;
  const dz = 1, dx = dcx(boat.z), l = Math.hypot(dx, dz);
  const fx = dx / l, fz = dz / l;
  const rx = -fz, rz = fx; // screen-right of the flow
  // a 3/4 view from over the water: the camera sits to the side of the boat nearer the middle of the stream
  // switch sides only when the boat is well over toward one bank, so the view does not swing about mid-stream
  const off = boat.x - cx(boat.z), wHalf = halfW(boat.z);
  if (cam.want == null) cam.want = 1;
  if (off > wHalf * 0.45) cam.want = -1; else if (off < -wHalf * 0.45) cam.want = 1;
  cam.side = cam.side == null ? cam.want : cam.side + (cam.want - cam.side) * (1 - Math.exp(-dt * 0.7));
  const back = portrait ? 0.95 : 0.9, lat = portrait ? 0.7 : 0.85, up = portrait ? 0.72 : 0.6;
  const s = lat * cam.side * Math.sign(rx || -1); // world offset rx*s points toward the middle
  const tp = new THREE.Vector3(boat.x - fx * back + rx * s, boat.heave + up, boat.z - fz * back + rz * s);
  const tl = new THREE.Vector3(boat.x + fx * 0.8, boat.heave + 0.02, boat.z + fz * 0.8);
  const k = cam.init ? 1 - Math.exp(-dt * 2.2) : 1;
  cam.pos.lerp(tp, k); cam.look.lerp(tl, k); cam.init = true;
  const minY = level(cam.pos.z) + 0.25;
  if (cam.pos.y < minY) cam.pos.y = minY;
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  const hfov = (portrait ? 64 : 66) * Math.PI / 180;
  let vfov = 2 * Math.atan(Math.tan(hfov / 2) / asp);
  vfov = Math.min(Math.max(vfov, 38 * Math.PI / 180), 76 * Math.PI / 180);
  if (Math.abs(camera.fov - vfov * 180 / Math.PI) > 0.01 || camera.aspect !== asp) { camera.fov = vfov * 180 / Math.PI; camera.aspect = asp; camera.updateProjectionMatrix(); }
}

function resize() {
  renderer.setPixelRatio(baseDpr * dprScale);
  renderer.setSize(innerWidth, innerHeight, false);
}
window.addEventListener('resize', resize);
resize();

// automatic quality: first fewer pixels, then thinner plants
let last = performance.now(), fAcc = 0, fN = 0, slow = 0, fast = 0;
function adapt(dt) {
  if (forced) return;
  fAcc += dt; fN++;
  if (fAcc < 1) return;
  const avg = fAcc / fN; fAcc = 0; fN = 0;
  if (avg > 1 / 40) { slow++; fast = 0; } else if (avg < 1 / 57) { fast++; slow = 0; } else { slow = fast = 0; }
  if (slow >= 2) {
    slow = 0;
    if (dprScale > 0.6) { dprScale = Math.max(0.6, dprScale * 0.85); resize(); }
    else if (shared.uDensity.value > 0.5) shared.uDensity.value = Math.max(0.5, shared.uDensity.value - 0.15);
  }
  if (fast >= 5) {
    fast = 0;
    if (shared.uDensity.value < 1) shared.uDensity.value = Math.min(1, shared.uDensity.value + 0.1);
    else if (dprScale < 1) { dprScale = Math.min(1, dprScale / 0.9); resize(); }
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tick(dt);
  if (hintUntil && performance.now() > hintUntil) { hint.textContent = ''; hintUntil = 0; }
  renderer.render(scene, camera);
  adapt(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame((t) => { last = t; frame(t); });

// Test hook: lets an automated check step the simulation at a chosen frame rate on a slow software GPU.
window.__pb = {
  get boat() { return { slipW: boat.slipW || 0, x: boat.x, z: boat.z, yaw: boat.yaw, r: boat.r, vx: boat.vx, vz: boat.vz, pitch: boat.pitch, roll: boat.roll, heave: boat.heave }; },
  get tier() { return tier; },
  get cam() { return [camera.position.x, camera.position.y, camera.position.z, cam.side]; },
  setSteer(v) { input.override = v; },
  advance(sec, fps = 60) { const n = Math.round(sec * fps); for (let i = 0; i < n; i++) tick(1 / fps); },
  teleport(z) { boat.reset(z); simT = 0; acc = 0; steerS = 0; cam.init = false; cam.side = null; cam.want = null; world.buildAll(z); tick(0); },
  setCam(pos, look) { cam.debug = !!pos; if (pos) { cam.pos.set(...pos); cam.look.set(...look); camera.position.set(...pos); camera.lookAt(...look); } },
  render() { renderer.render(scene, camera); },
  trees() { return world.slots.flatMap((s) => s.trees || []); },
};
