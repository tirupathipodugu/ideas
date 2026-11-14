// A garden that grows on one tracked hand.
// The hand is modelled as capsules between MediaPipe's 21 landmarks (plus a virtual wrist point).
// Every plant is an instance pinned to a capsule by (segment, s along it, theta around it); the vertex
// shader rebuilds its position from the live joint uniforms each frame, so tens of thousands of plants
// follow the fingers with no per-plant work on the CPU.

import * as THREE from '../vendor/three/three.module.js';

// Canonical open right hand, palm length (wrist -> middle knuckle) = 1. Used for the demo hand and for
// sizing how many plants each segment gets.
export const CANON = [
  [0, 0], [-0.30, -0.12], [-0.55, -0.35], [-0.72, -0.55], [-0.86, -0.72],
  [-0.28, -0.92], [-0.33, -1.30], [-0.36, -1.53], [-0.38, -1.73],
  [-0.02, -1.00], [-0.02, -1.43], [-0.02, -1.68], [-0.02, -1.90],
  [0.22, -0.93], [0.26, -1.31], [0.28, -1.54], [0.30, -1.73],
  [0.42, -0.80], [0.52, -1.06], [0.58, -1.23], [0.63, -1.40],
];

// [jointA, jointB, radius (x palm length), growth order, tip?]
const SEGS = [
  [21, 0, 0.17, 0, 2],               // 2 = rounded end at A (the wrist)
  [0, 1, 0.16, 0, 0], [0, 5, 0.14, 0, 0], [0, 9, 0.15, 0, 0], [0, 13, 0.15, 0, 0], [0, 17, 0.14, 0, 0],
  [1, 5, 0.14, 0, 0], [5, 9, 0.12, 1, 0], [9, 13, 0.12, 1, 0], [13, 17, 0.12, 1, 0],
  [1, 2, 0.13, 1, 0], [2, 3, 0.12, 2, 0], [3, 4, 0.11, 3, 1],
  [5, 6, 0.11, 1, 0], [6, 7, 0.10, 2, 0], [7, 8, 0.095, 3, 1],
  [9, 10, 0.115, 1, 0], [10, 11, 0.105, 2, 0], [11, 12, 0.10, 3, 1],
  [13, 14, 0.11, 1, 0], [14, 15, 0.10, 2, 0], [15, 16, 0.095, 3, 1],
  [17, 18, 0.10, 1, 0], [18, 19, 0.09, 2, 0], [19, 20, 0.085, 3, 1],
];

const canon3 = (i) => i === 21 ? [0.0, 0.22] : CANON[i];
const SEG_INFO = SEGS.map(([a, b, r, order, tip]) => {
  const A = canon3(a), B = canon3(b);
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const side = len * r * 2 * Math.PI;
  const cap = tip ? r * r * 2 * Math.PI : 0;
  return { a, b, r, order, tip, len, side, cap, w: side + cap };
});
const W_TOTAL = SEG_INFO.reduce((s, x) => s + x.w, 0);

// Seeded random so the garden looks the same every time it grows.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Instance attachments: n plants spread over the hand surface in proportion to area. */
function scatter(n, rand, opts = {}) {
  const seg = new Float32Array(n * 3), at = new Float32Array(n * 2), rnd = new Float32Array(n * 4), delay = new Float32Array(n);
  const pool = opts.segFilter ? SEG_INFO.filter(opts.segFilter) : SEG_INFO;
  const total = pool.reduce((s, x) => s + x.w, 0);
  for (let i = 0; i < n; i++) {
    let pick = rand() * total, S = pool[0];
    for (const x of pool) { if ((pick -= x.w) <= 0) { S = x; break; } }
    let s;
    if (S.tip && rand() < S.cap / S.w) s = S.tip === 2 ? -rand() * 0.92 : 1 + rand() * 0.92;   // fingertip / wrist cap
    else s = opts.sRange ? opts.sRange[0] + rand() * (opts.sRange[1] - opts.sRange[0]) : rand();
    seg.set([S.a, S.b, S.r], i * 3);
    at.set([s, rand() * Math.PI * 2], i * 2);
    rnd.set([rand(), rand(), rand(), rand()], i * 4);
    delay[i] = S.order * 0.22 + Math.min(s, 1) * 0.2 + rand() * 0.45;
  }
  return { seg, at, rnd, delay };
}

const COMMON = /* glsl */`
uniform vec3 uJ[22];
uniform float uScale;
uniform vec3 uPalmN;
uniform float uTime;
uniform float uAge;
uniform float uFade;
uniform vec2 uVel;
const vec3 LIGHT = normalize(vec3(-0.45, 0.7, 0.75));

void frameOf(vec3 seg, float s, float th, out vec3 P, out vec3 N, out vec3 D, out vec3 U, out vec3 V) {
  vec3 A = uJ[int(seg.x + 0.5)], B = uJ[int(seg.y + 0.5)];
  vec3 d = B - A; float L = max(length(d), 1e-3); D = d / L;
  vec3 u = uPalmN - D * dot(uPalmN, D); float ul = length(u);
  U = ul > 1e-3 ? u / ul : normalize(cross(D, vec3(0.0, 0.0, 1.0)) + 1e-4);
  V = cross(D, U);
  vec3 n = cos(th) * U + sin(th) * V;
  float r = seg.z * uScale;
  if (s < 0.0) { float ph = -s * 1.5708; N = normalize(n * cos(ph) - D * sin(ph)); P = A + N * r; }
  else if (s > 1.0) { float ph = (s - 1.0) * 1.5708; N = normalize(n * cos(ph) + D * sin(ph)); P = B + N * r; }
  else { N = n; P = A + d * s + n * r; }
}

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float grow(float delay) { return smoothstep(0.0, 1.0, clamp((uAge - delay) / 0.75, 0.0, 1.0)) * uFade; }
`;

// Per-plant vertex shader: attach, build a tangent frame around the surface normal, then sway.
const PLANT_VS = /* glsl */`
${COMMON}
attribute vec3 aSeg; attribute vec2 aAt; attribute vec4 aRnd; attribute float aDelay;
uniform float uSizeMin; uniform float uSizeMax; uniform float uDroop; uniform float uFaceCam; uniform float uCrawl;
varying vec2 vUv; varying float vH; varying vec4 vRnd; varying float vLight; varying float vFacing;
void main() {
  float s = aAt.x, th = aAt.y;
  vec3 P, N, D, U, V;
  if (uCrawl > 0.5) {
    // ladybugs walk up and down a finger on the side that faces the camera
    s = 0.15 + 0.7 * (0.5 + 0.5 * sin(uTime * (0.25 + aRnd.z * 0.25) + aRnd.w * 6.28));
    frameOf(aSeg, 0.0, 0.0, P, N, D, U, V);
    th = atan(V.z, U.z) + sin(uTime * 0.7 + aRnd.x * 9.0) * 0.5;
  }
  frameOf(aSeg, s, th, P, N, D, U, V);
  vec3 up = normalize(mix(N, vec3(0.0, 0.0, 1.0), uFaceCam));
  vec3 T = normalize(cross(up, abs(up.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  float ang = aRnd.x * 6.2831;
  if (uCrawl > 0.5) { T = normalize(D - up * dot(D, up)); ang = cos(uTime * (0.25 + aRnd.z * 0.25) + aRnd.w * 6.28) > 0.0 ? 0.0 : 3.1416; }
  vec3 T2 = T * cos(ang) + cross(up, T) * sin(ang);
  vec3 B2 = cross(up, T2);
  float g = grow(aDelay);
  float size = mix(uSizeMin, uSizeMax, aRnd.y) * uScale * g;
  vec3 lp = position;
  float h = clamp(lp.y, 0.0, 1.5);
  vec3 world = P + (T2 * lp.x + up * lp.y + B2 * lp.z) * size;
  // wind, plus the plants lagging behind when the hand moves
  vec3 sway = vec3(sin(uTime * 1.7 + P.x * 0.02 + aRnd.z * 6.0), cos(uTime * 1.3 + P.y * 0.02), 0.0) * 0.06;
  sway += vec3(-uVel, 0.0) * 0.05;
  world += (sway + vec3(0.0, -uDroop, 0.0)) * h * h * size;
  vUv = uv; vH = h; vRnd = aRnd;
  vLight = 0.68 + 0.4 * max(dot(up, LIGHT), 0.0);
  vFacing = up.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;

// The moss body: capsules drawn opaque so no skin shows under the plants.
const BODY_VS = /* glsl */`
${COMMON}
attribute vec3 aSeg; attribute float aDelay;
varying vec3 vN; varying vec3 vSurf; varying float vG;
void main() {
  vec3 P, N, D, U, V;
  float s = position.x, th = position.y;
  frameOf(aSeg, s, th, P, N, D, U, V);
  vec3 sp = vec3(s * 3.0 + aSeg.x * 1.7, cos(th) * 1.2, sin(th) * 1.2 + aSeg.y);
  float g = grow(aDelay * 0.6);
  float lump = (vnoise(sp * 3.0) - 0.5) * 0.35 + 0.1;
  float r = aSeg.z * uScale;
  // grow outward from the skin: the moss swells into place
  P += N * r * (lump * g - (1.0 - g) * 0.95);
  vN = N; vSurf = sp; vG = g;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
}`;
const BODY_FS = /* glsl */`
${COMMON}
uniform vec3 uMossDark; uniform vec3 uMossLight;
varying vec3 vN; varying vec3 vSurf; varying float vG;
void main() {
  if (vG < 0.02) discard;
  float n = vnoise(vSurf * 9.0) * 0.6 + vnoise(vSurf * 23.0) * 0.4;
  vec3 c = mix(uMossDark, uMossLight, smoothstep(0.25, 0.85, n));
  float dif = 0.45 + 0.55 * max(dot(normalize(vN), LIGHT), 0.0);
  float rim = smoothstep(0.0, 0.6, vN.z);
  c *= dif * mix(0.55, 1.0, rim) * (0.75 + 0.25 * n);
  gl_FragColor = vec4(c, 1.0);
}`;

const GRASS_FS = /* glsl */`
uniform vec3 uGrassBase; uniform vec3 uGrassTip;
varying vec2 vUv; varying float vH; varying vec4 vRnd; varying float vLight; varying float vFacing;
void main() {
  vec3 c = mix(uGrassBase, uGrassTip, smoothstep(0.0, 1.0, vH));
  c *= 0.82 + 0.36 * vRnd.z;
  c *= vLight * mix(0.62, 1.05, smoothstep(0.0, 0.6, vH));
  gl_FragColor = vec4(c, 1.0);
}`;

const LEAF_FS = /* glsl */`
uniform vec3 uLeaf; uniform vec3 uGrassTip;
varying vec2 vUv; varying float vH; varying vec4 vRnd; varying float vLight; varying float vFacing;
void main() {
  // vUv.x across (-1..1), vUv.y along (0..1): a rounded leaf with a pale midrib
  float y = vUv.y, x = vUv.x;
  float w = sin(3.1416 * pow(y, 0.8)) * 0.95;
  if (abs(x) > w) discard;
  vec3 c = mix(uLeaf * 0.7, mix(uLeaf, uGrassTip, 0.35), y);
  c *= 0.8 + 0.4 * vRnd.z;
  c = mix(c, uGrassTip * 1.1, smoothstep(0.08, 0.0, abs(x)) * 0.35 * y);
  c *= vLight * mix(0.6, 1.0, y);
  gl_FragColor = vec4(c, 1.0);
}`;

const FLOWER_FS = /* glsl */`
uniform vec3 uF0; uniform vec3 uF1; uniform vec3 uF2; uniform vec3 uLeaf;
varying vec2 vUv; varying float vH; varying vec4 vRnd; varying float vLight; varying float vFacing;
void main() {
  if (vUv.y < -1.5) {                         // stem
    gl_FragColor = vec4(uLeaf * 0.75 * vLight, 1.0); return;
  }
  vec2 p = vUv;
  float r = length(p), a = atan(p.y, p.x) + vRnd.w * 6.28;
  float kind = floor(vRnd.z * 3.0);
  vec3 petal; vec3 center; float shape; float cr;
  if (kind < 0.5) {            // daisy
    shape = 0.55 + 0.45 * pow(abs(cos(a * 7.0)), 0.6); petal = uF0; center = vec3(0.98, 0.78, 0.16); cr = 0.24;
  } else if (kind < 1.5) {     // cornflower: ragged, toothed petals
    shape = 0.62 + 0.38 * pow(abs(cos(a * 4.0)), 0.4) - 0.12 * abs(sin(a * 22.0)); petal = uF1; center = uF1 * 0.45; cr = 0.18;
  } else {                     // five-petal buttercup
    shape = 0.45 + 0.55 * pow(abs(cos(a * 2.5)), 0.8); petal = uF2; center = vec3(0.85, 0.6, 0.1); cr = 0.2;
  }
  if (r > shape) discard;
  vec3 c = mix(petal * 0.82, petal, smoothstep(cr, shape, r));
  c = mix(c, center, smoothstep(cr + 0.04, cr - 0.02, r));
  c *= 0.7 + 0.3 * vLight + 0.1 * (1.0 - r);
  gl_FragColor = vec4(c, 1.0);
}`;

const FERN_FS = /* glsl */`
uniform vec3 uFern; uniform vec3 uGrassTip;
varying vec2 vUv; varying float vH; varying vec4 vRnd; varying float vLight; varying float vFacing;
void main() {
  float y = vUv.y, x = vUv.x, ax = abs(x);
  float env = sin(3.1416 * min(y * 1.08, 1.0)) * (1.0 - y * 0.35);
  if (ax > env) discard;
  float spine = smoothstep(0.05, 0.02, ax);
  // pinnae: leaflets angled toward the tip
  float k = fract(y * 15.0 + ax * 0.9);
  float leaflet = smoothstep(0.92, 0.7, k) * smoothstep(0.0, 0.12, k);
  if (spine < 0.5 && leaflet < 0.5) discard;
  vec3 c = mix(uFern * 0.65, mix(uFern, uGrassTip, 0.3), y);
  c *= 0.85 + 0.3 * vRnd.z;
  c = mix(c, uFern * 0.5, spine * 0.7);
  c *= 0.8 + 0.35 * vLight;
  gl_FragColor = vec4(c, 1.0);
}`;

const BUG_FS = /* glsl */`
varying vec2 vUv; varying float vH; varying vec4 vRnd; varying float vLight; varying float vFacing;
void main() {
  vec2 p = vec2(vUv.y, vUv.x);                // x across, y along the body (head at y > 0.62)
  float r = length(p * vec2(1.0, 0.85));
  if (r > 1.0) discard;
  vec3 c;
  if (p.y > 0.62) c = vec3(0.05);
  else {
    c = vec3(0.86, 0.08, 0.05);
    vec2 q = vec2(abs(p.x), p.y);
    float spot = min(min(length(q - vec2(0.45, 0.2)), length(q - vec2(0.38, -0.35))), length(q - vec2(0.0, -0.05)) + 0.1);
    c = mix(c, vec3(0.04), smoothstep(0.2, 0.16, spot));
    c = mix(c, vec3(0.04), smoothstep(0.035, 0.0, abs(p.x)));
    c *= 0.65 + 0.55 * (1.0 - r) + 0.25 * smoothstep(0.4, 0.0, length(p - vec2(-0.3, 0.3)));
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// ---------- geometry builders (local space: y = up from the hand surface, size 1) ----------

function tuftGeometry(rand, blades = 5) {
  const pos = [], uv = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rand() * Math.PI * 2, tilt = 0.15 + rand() * 0.55, h = 0.55 + rand() * 0.45, w = 0.05 + rand() * 0.035;
    const ca = Math.cos(a), sa = Math.sin(a), base = pos.length / 3;
    const off = [ca * 0.12 * rand(), sa * 0.12 * rand()];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4, y = t * h, out = Math.sin(tilt) * y + 0.25 * t * t * h, hw = w * (1 - t * 0.95);
      for (const side of [-1, 1]) {
        const x = off[0] + ca * out - sa * hw * side, z = off[1] + sa * out + ca * hw * side;
        pos.push(x, y, z); uv.push(side, t);
      }
    }
    for (let s = 0; s < 4; s++) {
      const i = base + s * 2;
      idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  return { pos, uv, idx };
}

function leafGeometry(rand) {
  const pos = [], uv = [], idx = [];
  const n = 3;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand() * 0.6, tilt = 0.45 + rand() * 0.35, L = 0.8 + rand() * 0.3, w = 0.42;
    const ca = Math.cos(a), sa = Math.sin(a), base = pos.length / 3;
    for (let s = 0; s <= 3; s++) {
      const t = s / 3, out = Math.cos(tilt) * t * L, y = 0.12 + Math.sin(tilt) * t * L - 0.25 * t * t * L;
      for (const side of [-1, 1]) {
        pos.push(ca * out - sa * w * side * L, y, sa * out + ca * w * side * L); uv.push(side, t);
      }
    }
    for (let s = 0; s < 3; s++) { const i = base + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  }
  return { pos, uv, idx };
}

function flowerGeometry() {
  const pos = [], uv = [], idx = [];
  // stem: thin crossed strip, uv.y = -2 marks it as stem
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const b = pos.length / 3, w = 0.035;
    pos.push(-dx * w, 0, -dz * w, dx * w, 0, dz * w, -dx * w, 0.62, -dz * w, dx * w, 0.62, dz * w);
    uv.push(0, -2, 0, -2, 0, -2, 0, -2);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  // head: a disc lying flat, uv in -1..1
  const b = pos.length / 3;
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { pos.push(x * 0.42, 0.66, z * 0.42); uv.push(x, z); }
  idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  return { pos, uv, idx };
}

function fernGeometry() {
  const pos = [], uv = [], idx = [], N = 14;
  for (let s = 0; s <= N; s++) {
    const t = s / N;
    for (const side of [-1, 1]) { pos.push(side * 0.3, t, 0); uv.push(side, t); }
  }
  for (let s = 0; s < N; s++) { const i = s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  return { pos, uv, idx };
}

function bugGeometry() {
  const pos = [], uv = [], idx = [], R = 8, C = 12;
  for (let i = 0; i <= R; i++) {
    const v = i / R;
    for (let j = 0; j <= C; j++) {
      const a = (j / C) * Math.PI * 2, rr = v;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      pos.push(x * 0.6, Math.sqrt(Math.max(0, 1 - rr * rr)) * 0.35 + 0.02, z * 0.5);
      uv.push(x, z);
    }
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const a = i * (C + 1) + j, b = a + C + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { pos, uv, idx };
}

function bodyGeometry() {
  // capsule in (s, theta): s from -1 (cap at A) through 0..1 (side) to 2 (cap at B)
  const pos = [], idx = [], rows = [], C = 14;
  for (let i = 0; i <= 4; i++) rows.push(-1 + i / 4);
  for (let i = 1; i < 8; i++) rows.push(i / 8);
  for (let i = 0; i <= 4; i++) rows.push(1 + i / 4);
  rows.forEach((s) => { for (let j = 0; j <= C; j++) pos.push(s, (j / C) * Math.PI * 2, 0); });
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < C; j++) {
    const a = i * (C + 1) + j, b = a + C + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { pos, uv: new Array((pos.length / 3) * 2).fill(0), idx };
}

function instanced(geo, inst) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(geo.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(geo.uv, 2));
  g.setIndex(geo.idx);
  g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(inst.seg, 3));
  if (inst.at) g.setAttribute('aAt', new THREE.InstancedBufferAttribute(inst.at, 2));
  if (inst.rnd) g.setAttribute('aRnd', new THREE.InstancedBufferAttribute(inst.rnd, 4));
  g.setAttribute('aDelay', new THREE.InstancedBufferAttribute(inst.delay, 1));
  g.instanceCount = inst.delay.length;
  return g;
}

export const SEASONS = {
  Meadow: {
    mossDark: 0x386a1c, mossLight: 0x86bd48, grassBase: 0x447a26, grassTip: 0xcfeb82, leaf: 0x72b63e,
    fern: 0x6cbd3a, f0: 0xf7f5ea, f1: 0x7464f0, f2: 0xf1eec4,
  },
  Blossom: {
    mossDark: 0x24501a, mossLight: 0x6aa83a, grassBase: 0x2a5a1e, grassTip: 0xb4dc6a, leaf: 0x5aa83a,
    fern: 0x4a9a30, f0: 0xffd0e0, f1: 0xff8fbf, f2: 0xffffff,
  },
  Autumn: {
    mossDark: 0x3e3212, mossLight: 0x9c7a26, grassBase: 0x4d3a14, grassTip: 0xe2b24a, leaf: 0xc4602a,
    fern: 0xa8581c, f0: 0xff7a1a, f1: 0xb8321e, f2: 0xffd23f,
  },
};

export class HandGarden {
  constructor(scene, seed = 1, quality = 1) {
    const rand = rng(seed);
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.joints = Array.from({ length: 22 }, () => new THREE.Vector3());
    this.u = {
      uJ: { value: this.joints }, uScale: { value: 100 }, uPalmN: { value: new THREE.Vector3(0, 0, 1) },
      uTime: { value: 0 }, uAge: { value: 0 }, uFade: { value: 0 }, uVel: { value: new THREE.Vector2() },
      uMossDark: { value: new THREE.Color() }, uMossLight: { value: new THREE.Color() },
      uGrassBase: { value: new THREE.Color() }, uGrassTip: { value: new THREE.Color() }, uLeaf: { value: new THREE.Color() },
      uFern: { value: new THREE.Color() }, uF0: { value: new THREE.Color() }, uF1: { value: new THREE.Color() }, uF2: { value: new THREE.Color() },
    };
    this.meshes = [];
    const add = (geo, vs, fs, own = {}, opts = {}) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: vs, fragmentShader: fs, side: opts.side ?? THREE.DoubleSide,
        uniforms: { ...this.u, uSizeMin: { value: 0.1 }, uSizeMax: { value: 0.2 }, uDroop: { value: 0 }, uFaceCam: { value: 0 }, uCrawl: { value: 0 }, ...own },
      });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = opts.order ?? 0;
      this.group.add(m);
      this.meshes.push({ mesh: m, full: geo.instanceCount });
      return m;
    };
    const q = (n) => Math.round(n * quality);

    // moss body: one capsule per segment
    const body = {
      seg: new Float32Array(SEGS.flatMap((s) => [s[0], s[1], s[2]])),
      delay: new Float32Array(SEGS.map((s) => s[3] * 0.22)),
    };
    add(instanced(bodyGeometry(), body), BODY_VS, BODY_FS, {}, { side: THREE.FrontSide });

    // grass tufts: several geometry variants so the clumps don't look stamped
    for (let v = 0; v < 3; v++) {
      add(instanced(tuftGeometry(rand, 6), scatter(q(1500), rand)), PLANT_VS, GRASS_FS,
        { uSizeMin: { value: 0.05 }, uSizeMax: { value: 0.11 }, uDroop: { value: 0.15 } });
    }
    for (let v = 0; v < 2; v++) {
      add(instanced(leafGeometry(rand), scatter(q(900), rand)), PLANT_VS, LEAF_FS,
        { uSizeMin: { value: 0.045 }, uSizeMax: { value: 0.085 }, uDroop: { value: 0.1 } });
    }
    add(instanced(flowerGeometry(), scatter(q(240), rand)), PLANT_VS, FLOWER_FS,
      { uSizeMin: { value: 0.045 }, uSizeMax: { value: 0.08 }, uFaceCam: { value: 0.45 } });
    // ferns spill off the palm edges and wrist and hang with gravity
    add(instanced(fernGeometry(), scatter(q(14), rand, { segFilter: (s) => s.order === 0 })), PLANT_VS, FERN_FS,
      { uSizeMin: { value: 0.35 }, uSizeMax: { value: 0.6 }, uDroop: { value: 0.6 } });
    add(instanced(bugGeometry(), scatter(3, rand, { segFilter: (s) => s.order >= 1 && s.order <= 2 })), PLANT_VS, BUG_FS,
      { uSizeMin: { value: 0.09 }, uSizeMax: { value: 0.11 }, uCrawl: { value: 1 } }, { side: THREE.FrontSide });

    this.tracked = false;
    this.lostAt = -1e9;
    this.seenAt = 0;
    this.prevPalm = null;
    this.vel = new THREE.Vector2();
  }

  setSeason(p) {
    const set = (k, hex) => this.u[k].value.setHex(hex);
    set('uMossDark', p.mossDark); set('uMossLight', p.mossLight); set('uGrassBase', p.grassBase); set('uGrassTip', p.grassTip);
    set('uLeaf', p.leaf); set('uFern', p.fern); set('uF0', p.f0); set('uF1', p.f1); set('uF2', p.f2);
  }

  setQuality(f) {
    for (const m of this.meshes) if (m.full > 50) m.mesh.geometry.instanceCount = Math.round(m.full * f);
  }

  /** pts: 21 points in world px (x right, y up, z toward camera), or null when the hand is gone. */
  update(pts, t, dt) {
    const u = this.u;
    u.uTime.value = t;
    if (pts) {
      if (!this.tracked) {
        if (t - this.lostAt > 0.6) this.seenAt = t;      // a real return regrows; a blip keeps the garden
        this.tracked = true;
        this.prevPalm = null;
      }
      for (let i = 0; i < 21; i++) this.joints[i].set(pts[i][0], pts[i][1], pts[i][2]);
      const J = this.joints;
      J[21].copy(J[0]).sub(J[9]).multiplyScalar(0.22).add(J[0]);
      const scale = J[0].distanceTo(J[9]);
      u.uScale.value = scale;
      const a = new THREE.Vector3().subVectors(J[5], J[0]), b = new THREE.Vector3().subVectors(J[17], J[0]);
      u.uPalmN.value.crossVectors(a, b).normalize();
      if (this.prevPalm && dt > 0) {
        const vx = (J[9].x - this.prevPalm.x) / dt / scale, vy = (J[9].y - this.prevPalm.y) / dt / scale;
        this.vel.lerp(new THREE.Vector2(vx, vy), 0.2);
        this.vel.clampLength(0, 4);
      }
      this.prevPalm = J[9].clone();
      u.uAge.value = t - this.seenAt;
      u.uFade.value = Math.min(1, u.uFade.value + dt * 6);
      this.group.visible = true;
    } else {
      if (this.tracked) { this.tracked = false; this.lostAt = t; }
      u.uFade.value = Math.max(0, u.uFade.value - dt * 4);
      this.vel.multiplyScalar(0.9);
      if (u.uFade.value <= 0) this.group.visible = false;
    }
    u.uVel.value.copy(this.vel);
  }

  get speed() { return this.tracked ? this.vel.length() : 0; }
  get scale() { return this.u.uScale.value; }
}
