// Shared pieces: renderer, scene, camera, game state, input and the update loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export { THREE };
export const V3 = THREE.Vector3;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = list => list[Math.floor(Math.random() * list.length)];
export const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const $ = id => document.getElementById(id);
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const IS_MOBILE = matchMedia('(pointer:coarse)').matches;

export const canvas = $('stage');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 3000);
camera.position.set(0, 20, 30);

// Multisampled so edges stay smooth through the post effects.
export const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: IS_MOBILE ? 2 : 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.45, 0.45, 0.93);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// A light grade: a touch more contrast and warmth, and a vignette.
export const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.12);
      c = (c - 0.5) * 1.06 + 0.5;
      c *= vec3(1.03, 1.0, 0.97);
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5));
      gl_FragColor = vec4(c * mix(0.78, 1.0, v), 1.0);
    }`,
});
composer.addPass(grade);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
});

// Everything the systems share.
export const G = {
  t: 0,
  started: false,
  paused: false,
  money: 420,
  health: 100,
  armor: 0,
  heat: 0,          // wanted heat; stars = thresholds of it
  stars: 0,
  mode: 'foot',     // 'foot' | 'car' | 'cutscene' | 'dead'
  car: null,        // the vehicle the player drives
  weapon: 0,
  weapons: [true, false, false, false, true], // fists, flamethrower, coil gun, starlink strike, flare gun
  ammo: [Infinity, 0, 0, 0, 16],
  uplink: false,    // Starlink mission done: full minimap
  mission: null,
  done: [],         // finished mission ids
  cityHALF: 0,
};

// Systems register here; lower order runs first.
const updaters = [];
export const onUpdate = (fn, order = 50) => {
  updaters.push({ fn, order });
  updaters.sort((a, b) => a.order - b.order);
};
export const runUpdaters = dt => {
  for (const u of updaters) u.fn(dt);
};

// Keyboard: held keys and keys pressed this frame.
export const keys = new Set();
const pressed = new Set();
export const hit = code => pressed.has(code);
export const clearHits = () => pressed.clear();
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Touch: a stick on the left, buttons on the right (set by hud.js).
export const touch = { x: 0, y: 0, fire: false, boost: false, jump: false };
export const press = code => pressed.add(code);

// Camera orbit from mouse drag or touch drag on the right half.
export const look = { yaw: 0, pitch: 0.28, dragging: false, idle: 0 };

// Fades and messages are hud.js's; systems call through these.
export const bus = {
  big: () => {},
  toast: () => {},
  objective: () => {},
};

// Shared materials and textures.
export const canvasTex = (w, h, draw, srgb = true) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

// Physics-free collision: boxes (buildings) and circles (props), on the ground plane.
export const solids = [];   // { minx, maxx, minz, maxz, h }
export const posts = [];    // { x, z, r }

// Pushes a circle out of every solid; returns the push normal if it hit.
const _n = { x: 0, z: 0, hit: false };
export const collide = (p, r, y = 0) => {
  _n.hit = false;
  _n.x = 0;
  _n.z = 0;
  for (const s of solids) {
    if (s.h < y) continue;
    if (p.x < s.minx - r || p.x > s.maxx + r || p.z < s.minz - r || p.z > s.maxz + r) continue;
    const cx = clamp(p.x, s.minx, s.maxx), cz = clamp(p.z, s.minz, s.maxz);
    let dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d < 1e-4) {
      // centre inside the box: out along the shortest side
      const o = [p.x - s.minx, s.maxx - p.x, p.z - s.minz, s.maxz - p.z];
      const i = o.indexOf(Math.min(...o));
      dx = [-1, 1, 0, 0][i];
      dz = [0, 0, -1, 1][i];
      d = 0;
      p.x += dx * (o[i] + r);
      p.z += dz * (o[i] + r);
    } else {
      dx /= d;
      dz /= d;
      p.x += dx * (r - d);
      p.z += dz * (r - d);
    }
    _n.x = dx;
    _n.z = dz;
    _n.hit = true;
  }
  for (const s of posts) {
    if (y > 9) break;
    const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz), m = r + s.r;
    if (d >= m || d < 1e-4) continue;
    p.x += (dx / d) * (m - d);
    p.z += (dz / d) * (m - d);
    _n.x = dx / d;
    _n.z = dz / d;
    _n.hit = true;
  }
  return _n;
};

// Line of sight on the ground plane against the buildings.
export const clearLine = (ax, az, bx, bz) => {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 4);
  for (let i = 1; i < steps; i++) {
    const x = lerp(ax, bx, i / steps), z = lerp(az, bz, i / steps);
    for (const s of solids) if (s.h > 3 && x > s.minx && x < s.maxx && z > s.minz && z < s.maxz) return false;
  }
  return true;
};
