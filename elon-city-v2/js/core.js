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

// Atmosphere. The stock fog is one flat colour that ignores height; this one thins as it rises and glows
// toward the sun, so distance reads as air. It replaces three.js's fog chunks, so every built-in material gets it.
// The three arrays are shared by reference with every material: write into them and the whole city follows.
export const atmo = {
  sun: new Float32Array([-0.8, 0.22, 0.4]),   // direction to the sun
  glow: new Float32Array([1.0, 0.72, 0.5]),   // colour of the haze round the sun
  p: new Float32Array([170, 0.6, 0, 0]),     // scale height in metres, glow strength
};
for (const k in THREE.ShaderLib) {
  const u = THREE.ShaderLib[k].uniforms;
  if (u && u.fogColor) Object.assign(u, { fogSun: { value: atmo.sun }, fogGlow: { value: atmo.glow }, fogP: { value: atmo.p } });
}
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSun;
  uniform vec3 fogGlow;
  uniform vec4 fogP;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogDist = length( vFogRay );
    vec3 fogDir = vFogRay / max( fogDist, 1e-3 );
    // Density falls off as exp(-height / scale); this is its integral along the ray, written so it cannot overflow.
    float fogY0 = max( cameraPosition.y, 0.0 ) / fogP.x;
    float fogY1 = max( cameraPosition.y + vFogRay.y, 0.0 ) / fogP.x;
    float fogDy = fogY1 - fogY0;
    float fogI = abs( fogDy ) > 1e-3 ? ( exp( - fogY0 ) - exp( - fogY1 ) ) / fogDy : exp( - fogY0 );
    float fogFactor = clamp( 1.0 - exp( - fogDensity * fogDist * fogI ), 0.0, 1.0 );
    float fogS = max( dot( fogDir, fogSun ), 0.0 );
    vec3 fogC = mix( fogColor, fogGlow, fogP.y * ( 0.3 * fogS * fogS + 0.7 * pow( fogS, 10.0 ) ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogFactor );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif`;

export const canvas = $('stage');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1.25 : 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.75;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 3000);
camera.position.set(0, 20, 30);

// Multisampled so edges stay smooth through the post effects.
export const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: IS_MOBILE ? 2 : 4, type: THREE.HalfFloatType }));
composer.addPass(new RenderPass(scene, camera));
export const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.2, 0.4, 1.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// The grade: a gentle film curve, cool shadows against warm highlights, a little sharpening, a vignette,
// and a dither so smooth skies never band.
export const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSharp: { value: 0.3 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSharp; varying vec2 vUv;
    void main(){
      vec2 px = 1.0 / vec2(textureSize(tDiffuse, 0));
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // Unsharp mask from four neighbours.
      vec3 blur = (texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
                 + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb) * 0.25;
      c = clamp(c + (c - blur) * uSharp, 0.0, 1.0);
      // Film curve: deeper shadows, a soft shoulder. No saturation boost: pushing saturation turned the deep-blue
      // night sky into a jagged black band on some GPUs (Windows/ANGLE).
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.42);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(vec3(0.95, 0.99, 1.06), vec3(1.05, 1.0, 0.94), smoothstep(0.08, 0.75, l));
      float v = 1.0 - smoothstep(0.38, 0.98, length(vUv - 0.5));
      c *= mix(0.74, 1.0, v);
      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      gl_FragColor = vec4(max(c + (n - 0.5) / 255.0, 0.0), 1.0);
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
  weapon: 4,       // the Flare Gun is always in your hand to start
  weapons: [true, false, false, false, true], // fists, flamethrower, coil gun, starlink strike, flare gun
  ammo: [Infinity, 0, 0, 0, Infinity],
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

// Physics-free collision: boxes and building footprints (polygons) and circles (props), on the ground plane.
export const solids = [];   // { minx, maxx, minz, maxz, h }
export const posts = [];    // { x, z, r }

// Building footprints live in a grid of cells so a test only looks at what's nearby.
const CELL = 24;
const cells = new Map();
const NONE = [];
const ck = (i, j) => (i + 4096) * 8192 + (j + 4096);
export const polys = [];
// pts: a flat [x0, z0, x1, z1, ...] ring; h: height of the roof.
export const addPoly = (pts, h) => {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minx = Math.min(minx, pts[i]);
    maxx = Math.max(maxx, pts[i]);
    minz = Math.min(minz, pts[i + 1]);
    maxz = Math.max(maxz, pts[i + 1]);
  }
  const s = { pts, h, minx, maxx, minz, maxz, mark: 0 };
  for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++)
    for (let j = Math.floor(minz / CELL); j <= Math.floor(maxz / CELL); j++) {
      const k = ck(i, j);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(s);
    }
  polys.push(s);
  return s;
};
let stamp = 0;
const nearPolys = (x, z, r, out) => {
  stamp++;
  out.length = 0;
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
    for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++)
      for (const s of cells.get(ck(i, j)) || NONE) {
        if (s.mark === stamp) continue;
        s.mark = stamp;
        if (x < s.minx - r || x > s.maxx + r || z < s.minz - r || z > s.maxz + r) continue;
        out.push(s);
      }
  return out;
};
export const inPoly = (pts, x, z) => {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], zi = pts[i + 1], xj = pts[j], zj = pts[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
// The closest point on a ring's outline.
const _q = { x: 0, z: 0, d: 0 };
const nearestOnRing = (pts, x, z) => {
  _q.d = Infinity;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const ax = pts[j], az = pts[j + 1], vx = pts[i] - ax, vz = pts[i + 1] - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1e-9), 0, 1);
    const qx = ax + vx * t, qz = az + vz * t, d = Math.hypot(x - qx, z - qz);
    if (d < _q.d) {
      _q.d = d;
      _q.x = qx;
      _q.z = qz;
    }
  }
  return _q;
};
const _near = [];
// The ground under (x, z) for something at height y: a roof you're above, or the street.
const _under = [];
export const groundAt = (x, z, y = 0) => {
  let g = 0;
  for (const s of solids) if (s.h <= y + 0.7 && s.h > g && x > s.minx && x < s.maxx && z > s.minz && z < s.maxz) g = s.h;
  for (const s of nearPolys(x, z, 0, _under)) if (s.h <= y + 0.7 && s.h > g && inPoly(s.pts, x, z)) g = s.h;
  return g;
};
// Is this point inside something solid at height y? (pad grows boxes a little.)
export const insideSolid = (x, z, y = 0, pad = 0) => {
  for (const s of solids) if (y < s.h && x > s.minx - pad && x < s.maxx + pad && z > s.minz - pad && z < s.maxz + pad) return true;
  for (const s of nearPolys(x, z, pad, _near)) if (y < s.h && inPoly(s.pts, x, z)) return true;
  return false;
};

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
  for (const s of nearPolys(p.x, p.z, r, _near)) {
    if (s.h < y) continue;
    const inside = inPoly(s.pts, p.x, p.z);
    const q = nearestOnRing(s.pts, p.x, p.z);
    if (!inside && q.d >= r) continue;
    let dx = p.x - q.x, dz = p.z - q.z;
    const d = q.d || 1e-4;
    dx /= d;
    dz /= d;
    if (inside) {
      dx = -dx;
      dz = -dz;
    }
    p.x = q.x + dx * r;
    p.z = q.z + dz * r;
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
    if (insideSolid(x, z, 3)) return false;
  }
  return true;
};
