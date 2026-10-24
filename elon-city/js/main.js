// Boot: load the cars, open the start screen, run the loop.
import { THREE, V3, G, $, keys, hit, clearHits, press, look, renderer, composer, bloom, scene, camera, runUpdaters, bus, clamp, IS_MOBILE, canvas } from './core.js';
import { places } from './world.js';
import './fx.js';
import { initAudio, setSound, sound, nextStation } from './audio.js';
import { loadModels, spawnVehicle, fillTraffic } from './vehicles.js';
import { loadPeople } from './people.js';
import { skyReady } from './world.js';
import './peds.js';
import './drones.js';
import { player } from './player.js';
import './police.js';
import './loop.js';
import './rocket.js';
import { load, save, resetSave, jobNow, storyProgress } from './missions.js';
import { hudFrame, clearTouchPresses, toggleMap } from './hud.js';

/* ---------------- loading ---------------- */
const bar = $('loadBar');
Promise.all([
  loadModels(k => {
    bar.style.width = Math.round(k * 80) + '%';
  }),
  loadPeople(),
  skyReady,
]).then(() => {
  bar.style.width = '100%';
  $('loadText').textContent = 'Ready';
  $('play').disabled = false;
  $('play').textContent = hasSave ? 'Continue' : 'Play';
});
let hasSave = false;
try {
  hasSave = !!localStorage.getItem('elon-city-save');
} catch {}
if (hasSave) $('newGame').hidden = false;

/* ---------------- start ---------------- */
const begin = fresh => {
  if (fresh) resetSave();
  else load();
  initAudio();
  $('start').hidden = true;
  document.body.classList.add('playing');
  G.started = true;
  // Cars parked around the Gigafactory to get you going.
  const c = places.gigaCars, y = places.gigaYaw;
  spawnVehicle('roadster', c[2].x, c[2].z, y).keep = true;
  spawnVehicle('cybertruck', c[3].x, c[3].z, y).keep = true;
  spawnVehicle('semi', c[4].x, c[4].z, y).keep = true;
  spawnVehicle('modely', c[5].x, c[5].z, y);
  fillTraffic(player.pos);
  G.refreshJobs();
  G.weapon = 4;
  bus.weapon();
  look.yaw = places.spawnYaw;
  player.yaw = places.spawnYaw;
  try {
    if (localStorage.getItem('elon-city-night') === '1') {
      G.setNight(true);
      $('nightBtn').textContent = '☀️';
    }
  } catch {}
  look.pitch = 0.22;
  bus.big('GTA <s>Vice</s> Elon City', G.done.length ? `Welcome back. Story ${storyProgress()} · $${G.money.toLocaleString()}` : 'Walk into the yellow marker for your first job. Green, blue and pink markers are side jobs.', '#ff4fa3', 5);
  if (!IS_MOBILE) canvas.requestPointerLock?.();
};
$('play').addEventListener('click', () => begin(false));
$('newGame').addEventListener('click', () => begin(true));

/* ---------------- mouse ---------------- */
let dragging = false, mx = 0, my = 0;
canvas.addEventListener('mousedown', e => {
  if (!G.started) return;
  if (!IS_MOBILE && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
    dragging = true;
    mx = e.clientX;
    my = e.clientY;
    return;
  }
  const code = 'Mouse' + e.button;
  if (!keys.has(code)) press(code);
  keys.add(code);
});
addEventListener('mouseup', e => {
  keys.delete('Mouse' + e.button);
  dragging = false;
});
addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) {
    look.yaw -= e.movementX * 0.0026;
    look.pitch = clamp(look.pitch + e.movementY * 0.002, -0.25, 1.15);
    look.idle = 0;
  } else if (dragging) {
    look.yaw -= (e.clientX - mx) * 0.005;
    look.pitch = clamp(look.pitch + (e.clientY - my) * 0.004, -0.25, 1.15);
    look.idle = 0;
    mx = e.clientX;
    my = e.clientY;
  }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => G.started && G.switchWeapon(e.deltaY > 0 ? 1 : -1), { passive: true });

/* ---------------- menus ---------------- */
const pause = on => {
  G.paused = on;
  $('pause').hidden = !on;
  if (on) {
    document.exitPointerLock?.();
    $('pStory').textContent = `Story ${storyProgress()} · jobs done ${G.jobsDone || 0} · $${G.money.toLocaleString()}`;
  }
};
$('resume').addEventListener('click', () => {
  pause(false);
  if (!IS_MOBILE) canvas.requestPointerLock?.();
});
$('soundBtn').addEventListener('click', e => {
  setSound(!sound.on);
  e.currentTarget.textContent = 'Sound: ' + (sound.on ? 'on' : 'off');
});
$('radioBtn').addEventListener('click', e => (e.currentTarget.textContent = 'Radio: ' + nextStation()));
$('menuBtn').addEventListener('click', () => pause(true));
$('mapBtn').addEventListener('click', () => toggleMap());
const toggleNight = () => {
  G.setNight(!G.night);
  $('nightBtn').textContent = G.night ? '☀️' : '🌙';
  bus.toast(G.night ? 'Night in Austin' : 'Back to sunset');
};
$('nightBtn').addEventListener('click', toggleNight);
$('jobBtn').addEventListener('click', () => jobNow());
$('bigmap').addEventListener('click', e => {
  if (e.target.id === 'bigmap') {
    toggleMap(false);
    if (!IS_MOBILE) canvas.requestPointerLock?.();
  }
});
document.addEventListener('pointerlockchange', () => {
  if (G.started && !IS_MOBILE && document.pointerLockElement !== canvas && !G.paused && !dragging && !G.mapOpen) pause(true);
});

/* ---------------- quality ---------------- */
// Start sharp; step down if the frame rate can't keep up.
let slow = 0, tier = IS_MOBILE ? 1 : 0;
const applyTier = () => {
  renderer.setPixelRatio(Math.min(devicePixelRatio, [1.5, 1.15, 0.85][tier]));
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  bloom.enabled = tier < 2;
  renderer.shadowMap.enabled = tier < 2;
  scene.traverse(o => o.material && (o.material.needsUpdate = true));
};
applyTier();

/* ---------------- loop ---------------- */
let last = performance.now();
const frame = now => {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.started) {
    if (hit('Escape') || hit('KeyP')) pause(!G.paused);
    if (hit('KeyM')) toggleMap();
    if (hit('KeyN')) toggleNight();
    if (hit('KeyJ')) jobNow();
  }
  if (!G.paused) {
    G.t += dt;
    runUpdaters(dt);
  }
  if (G.started) hudFrame(dt);
  else {
    // Attract mode: a slow orbit over the city at sunset.
    const a = now * 0.00004;
    camera.position.set(Math.cos(a) * 420, 160, Math.sin(a) * 420);
    camera.lookAt(0, 20, 0);
    runUpdaters(0);
  }
  composer.render();
  clearHits();
  clearTouchPresses();
  if (dt > 1 / 38 && G.started) slow += dt;
  else slow = Math.max(0, slow - dt * 0.5);
  if (slow > 3 && tier < 2) {
    tier++;
    slow = 0;
    applyTier();
  }
};
requestAnimationFrame(frame);
window.G = G;
import * as V from './vehicles.js';
import * as W from './world.js';
import * as P from './player.js';
import * as M from './missions.js';
import * as PD from './peds.js';
window.__ec = { V, W, P, M, PD, camera };
