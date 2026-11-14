// The face garden, on MediaPipe's real face mesh (478 points) instead of rough capsules.
// - The moss bed is the face mesh itself, its outline pushed out to the hairline and jaw so all visible skin is covered.
// - Plants are pinned to mesh triangles (triangle + barycentric point) and follow every expression.
// - Eyes and the open mouth are cut out along their exact landmark contours with a stencil, so the
//   edges follow the eyelids and lips instead of circles.
// Landmarks reach the GPU as a 478x1 float texture, read with texelFetch in the vertex shaders.

import * as THREE from '../vendor/three/three.module.js';
import { starMoss, pompom, buds, sprig } from './plants.js';
import { LIT_FS } from './garden.js';

const N = 478;
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const EYE_R = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
const MOUTH = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
const OVAL_SET = new Set(OVAL);

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Triangles of the face mesh, recovered from MediaPipe's tessellation edge list. */
function trianglesFrom(edges) {
  const adj = Array.from({ length: N }, () => new Set());
  for (const e of edges) { adj[e.start].add(e.end); adj[e.end].add(e.start); }
  const tris = [];
  for (let a = 0; a < N; a++) for (const b of adj[a]) {
    if (b <= a) continue;
    for (const c of adj[a]) if (c > b && adj[b].has(c)) tris.push([a, b, c]);
  }
  return tris;
}

const LM = /* glsl */`
uniform sampler2D uLm;
vec3 lm(float i) { return texelFetch(uLm, ivec2(int(i + 0.5), 0), 0).xyz; }
`;

const BED_VS = /* glsl */`
${LM}
attribute float aIdx; attribute vec3 aRest;
uniform float uGrow;
varying vec3 vRest; varying vec3 vW; varying float vG;
void main() {
  vec3 P = lm(aIdx);
  vRest = aRest; vW = P; vG = uGrow;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
}`;

const BED_FS = /* glsl */`
uniform vec3 uMossDark; uniform vec3 uMossLight; uniform float uWarm; uniform vec3 uGradeMul;
varying vec3 vRest; varying vec3 vW; varying float vG;
float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main() {
  float n = n3(vRest * 18.0) * 0.6 + n3(vRest * 47.0) * 0.4;
  if (n > vG * 1.25) discard;                       // spreads in patches while it grows
  vec3 nrm = normalize(cross(dFdx(vW), dFdy(vW)));
  if (nrm.z < 0.0) nrm = -nrm;
  float dif = 0.5 + 0.5 * max(dot(nrm, normalize(vec3(-0.45, 0.62, 0.65))), 0.0);
  vec3 c = mix(uMossDark, uMossLight, smoothstep(0.25, 0.85, n)) * dif;
  float lum = dot(c, vec3(0.3, 0.55, 0.15));
  c = mix(c, vec3(lum) * vec3(1.45, 0.82, 0.38), uWarm) * uGradeMul;
  gl_FragColor = vec4(c, 1.0);
}`;

const PLANT_VS = /* glsl */`
${LM}
attribute vec3 aTri; attribute vec2 aBary; attribute vec4 aRnd; attribute float aDelay;
attribute vec3 aCol; attribute float aH;
uniform float uSizeMin; uniform float uSizeMax; uniform float uScale; uniform float uAge; uniform float uFade;
uniform float uTime; uniform float uSink; uniform float uLean;
uniform float uSnapT; uniform float uIsShed; uniform float uRegrowK;
varying vec3 vCol; varying vec3 vN; varying vec3 vUp; varying vec3 vP; varying float vHt; varying vec4 vRnd;
void main() {
  vec3 A = lm(aTri.x), B = lm(aTri.y), C = lm(aTri.z);
  vec3 P = A + (B - A) * aBary.x + (C - A) * aBary.y;
  vec3 up = normalize(cross(B - A, C - A));
  if (up.z < 0.0) up = -up;
  vec3 surfN = up;
  vec3 T = normalize(cross(up, abs(up.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  float ang = aRnd.x * 6.2831;
  vec3 T2 = T * cos(ang) + cross(up, T) * sin(ang);
  up = normalize(up + T2 * (aRnd.y - 0.5) * 2.0 * uLean);
  T2 = normalize(T2 - up * dot(T2, up));
  vec3 B2 = cross(up, T2);
  float g = smoothstep(0.0, 1.0, clamp((uAge - aDelay) / 0.75, 0.0, 1.0)) * uFade;
  float since = (uTime - uSnapT) / uRegrowK;
  if (uIsShed < 0.5 && since > -0.5 && since < 6.0) g *= smoothstep(1.3 + aRnd.w * 1.3, 2.1 + aRnd.w * 1.6, max(since, 0.0));
  float size = mix(uSizeMin, uSizeMax, aRnd.y) * uScale * g;
  vec3 lp = position;
  vec3 nl = normal;
  vec3 fall = vec3(0.0);
  if (uIsShed > 0.5) {
    float ts = max(0.0, uTime - uSnapT - aRnd.z * 0.3);
    vec3 ax = normalize(vec3(aRnd.x - 0.5, aRnd.y - 0.5, aRnd.w - 0.5) + vec3(0.001));
    float ang = ts * (1.5 + aRnd.y * 3.5);
    lp = lp * cos(ang) + cross(ax, lp) * sin(ang) + ax * dot(ax, lp) * (1.0 - cos(ang));
    nl = nl * cos(ang) + cross(ax, nl) * sin(ang) + ax * dot(ax, nl) * (1.0 - cos(ang));
    float drop = 0.5 * 4.5 * mix(0.55, 1.0, aRnd.x) * ts * ts / (1.0 + 0.6 * ts);
    fall = vec3(sin(ts * 2.4 + aRnd.x * 20.0) * 0.3 * ts + (aRnd.y - 0.5) * 0.5 * ts, -drop, (aRnd.w - 0.5) * 0.3 * ts) * uScale;
    size *= 1.0 - smoothstep(1.9, 2.8, ts);
  }
  float h = clamp(lp.y, 0.0, 1.5);
  vec3 sway = vec3(sin(uTime * 1.7 + P.x * 0.02 + aRnd.z * 6.0), cos(uTime * 1.3 + P.y * 0.02), 0.0) * 0.05;
  vec3 world = P + fall + (T2 * lp.x + up * lp.y + B2 * lp.z - up * uSink) * size + sway * h * h * size;
  vN = T2 * nl.x + up * nl.y + B2 * nl.z; vUp = surfN; vCol = aCol; vHt = aH; vRnd = aRnd;
  vP = vec3(aBary * 3.0 + aTri.xy * 0.013, aTri.z * 0.011);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;

export class FaceGarden {
  constructor(scene, vision, gardenUniforms, quality = 1) {
    this.scene = scene;
    this.quality = quality;
    this.tris = trianglesFrom(vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION);
    this.data = new Float32Array(N * 4);
    this.tex = new THREE.DataTexture(this.data, N, 1, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const g = gardenUniforms;     // share season colours and grade with the hand gardens
    this.u = {
      uLm: { value: this.tex }, uScale: { value: 100 }, uAge: { value: 0 }, uFade: { value: 0 }, uTime: g.uTime,
      uGrow: { value: 0 }, uMossDark: g.uMossDark, uMossLight: g.uMossLight, uWarm: g.uWarm, uGradeMul: g.uGradeMul,
      uExposure: g.uExposure, uSnapT: { value: -100 }, uIsShed: { value: 0 }, uRegrowK: { value: 1 },
    };
    this.plants = [];
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.built = false;
    this.tracked = false;
    this.seenAt = 0;
    this.lostAt = -1e9;
    this.smooth = null;
    this.on = true;
  }

  /** Build meshes from the first face seen (its shape weighs how many plants each triangle gets). */
  build(P) {
    this.built = true;
    const rand = rng(77);
    const c = this.center(P), w = this.width(P);
    // stencil: eyes and open mouth write 1; everything on the face skips pixels where it is 1
    const holeIdx = [];
    const addPoly = (ring) => {
      // fan from the first point: eye and inner-lip contours are close to convex
      for (let i = 1; i < ring.length - 1; i++) holeIdx.push(ring[0], ring[i], ring[i + 1]);
    };
    addPoly(EYE_L); addPoly(EYE_R); addPoly(MOUTH);
    const holeGeo = new THREE.BufferGeometry();
    holeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    holeGeo.setAttribute('aIdx', new THREE.Float32BufferAttribute(Float32Array.from({ length: N }, (_, i) => i), 1));
    holeGeo.setAttribute('aRest', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    holeGeo.setIndex(holeIdx);
    const holeMat = new THREE.ShaderMaterial({
      vertexShader: BED_VS, fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }', uniforms: this.u,
      colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    });
    const holes = new THREE.Mesh(holeGeo, holeMat);
    holes.renderOrder = -100; holes.frustumCulled = false;
    this.group.add(holes);
    const masked = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.KeepStencilOp, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp };

    // moss bed on the mesh
    const rest = new Float32Array(N * 3);
    P.forEach((p, i) => rest.set([(p[0] - c[0]) / w, (p[1] - c[1]) / w, (p[2] - c[2]) / w], i * 3));
    const bedGeo = new THREE.BufferGeometry();
    bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    bedGeo.setAttribute('aIdx', new THREE.Float32BufferAttribute(Float32Array.from({ length: N }, (_, i) => i), 1));
    bedGeo.setAttribute('aRest', new THREE.Float32BufferAttribute(rest, 3));
    bedGeo.setIndex(this.tris.flat());
    const bed = new THREE.Mesh(bedGeo, new THREE.ShaderMaterial({
      vertexShader: BED_VS, fragmentShader: BED_FS, uniforms: this.u, side: THREE.DoubleSide, ...masked,
    }));
    bed.frustumCulled = false; bed.renderOrder = 1;
    this.group.add(bed);

    // plants, weighted by triangle area
    const area = this.tris.map(([a, b, d]) => {
      const ab = [P[b][0] - P[a][0], P[b][1] - P[a][1]], ad = [P[d][0] - P[a][0], P[d][1] - P[a][1]];
      return Math.abs(ab[0] * ad[1] - ab[1] * ad[0]) / 2;
    });
    const total = area.reduce((s, x) => s + x, 0);
    const cdf = []; let acc = 0;
    for (const x of area) cdf.push((acc += x) / total);
    const pick = () => { const r = rand(); let lo = 0, hi = cdf.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < r) lo = m + 1; else hi = m; } return lo; };
    const scatter = (n) => {
      const tri = new Float32Array(n * 3), bary = new Float32Array(n * 2), rnd = new Float32Array(n * 4), delay = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = this.tris[pick()];
        let u = rand(), v = rand();
        if (u + v > 1) { u = 1 - u; v = 1 - v; }
        tri.set(t, i * 3); bary.set([u, v], i * 2);
        rnd.set([rand(), rand(), rand(), rand()], i * 4);
        // grow from the outline inward
        const p = P[t[0]], dist = Math.hypot(p[0] - c[0], p[1] - c[1]) / w;
        delay[i] = (0.7 - Math.min(0.7, dist)) * 1.2 + rand() * 0.5;
      }
      return { tri, bary, rnd, delay };
    };
    const q = (n) => Math.max(1, Math.round(n * this.quality));
    const add = (geo, n, s0, s1, o = {}) => {
      const inst = scatter(q(n));
      const gg = new THREE.InstancedBufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(geo.pos, 3));
      gg.setAttribute('normal', new THREE.Float32BufferAttribute(geo.nrm, 3));
      gg.setAttribute('aCol', new THREE.Float32BufferAttribute(geo.col, 3));
      gg.setAttribute('aH', new THREE.Float32BufferAttribute(geo.h, 1));
      gg.setAttribute('aTri', new THREE.InstancedBufferAttribute(inst.tri, 3));
      gg.setAttribute('aBary', new THREE.InstancedBufferAttribute(inst.bary, 2));
      gg.setAttribute('aRnd', new THREE.InstancedBufferAttribute(inst.rnd, 4));
      gg.setAttribute('aDelay', new THREE.InstancedBufferAttribute(inst.delay, 1));
      gg.instanceCount = inst.delay.length;
      const m = new THREE.Mesh(gg, new THREE.ShaderMaterial({
        vertexShader: PLANT_VS, fragmentShader: LIT_FS, side: THREE.DoubleSide, ...masked,
        uniforms: {
          ...this.u, uSizeMin: { value: s0 }, uSizeMax: { value: s1 }, uSink: { value: 0.12 }, uLean: { value: 0.25 },
          uCushion: { value: 0.5 }, uFloor: { value: 0.12 }, uThrough: { value: 0.9 }, uDrift: { value: 1 }, ...o,
        },
      }));
      m.frustumCulled = false; m.renderOrder = 2;
      this.group.add(m);
      this.plants.push(m);
    };
    for (let v = 0; v < 4; v++) add(starMoss(700 + v * 19), 750, 0.06, 0.1);
    for (let v = 0; v < 2; v++) {
      add(pompom(150 + v * 29), 22, 0.09, 0.14, { uCushion: { value: 0.15 }, uLean: { value: 0.45 }, uSink: { value: 0.05 } });
      add(buds(350 + v * 21), 18, 0.08, 0.12, { uCushion: { value: 0.15 }, uLean: { value: 0.4 }, uSink: { value: 0.05 } });
      add(sprig(1400 + v * 9), 10, 0.13, 0.2, { uCushion: { value: 0.15 }, uLean: { value: 0.5 }, uSink: { value: 0.02 } });
    }
  }

  /** Clap: every plant on the face lets go and falls; the face regrows, slow = how much slower. */
  shed(t, slow = 1) {
    if (!this.tracked || !this.built) return false;
    if (!this.shedGroup) {
      this.snapData = new Float32Array(N * 4);
      this.snapTex = new THREE.DataTexture(this.snapData, N, 1, THREE.RGBAFormat, THREE.FloatType);
      this.snapTex.minFilter = this.snapTex.magFilter = THREE.NearestFilter;
      this.shedGroup = new THREE.Group();
      this.scene.add(this.shedGroup);
      for (const m0 of this.plants) {
        const mat = m0.material;
        const m = new THREE.Mesh(m0.geometry, new THREE.ShaderMaterial({
          vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader, side: mat.side,
          uniforms: { ...mat.uniforms, uLm: { value: this.snapTex }, uIsShed: { value: 1 }, uFade: { value: 1 }, uAge: { value: 99 }, uScale: { value: 1 } },
        }));
        m.frustumCulled = false; m.renderOrder = 3;
        this.shedGroup.add(m);
      }
    }
    this.snapData.set(this.data);
    this.snapTex.needsUpdate = true;
    for (const m of this.shedGroup.children) m.material.uniforms.uScale.value = this.u.uScale.value;
    this.u.uSnapT.value = t;
    this.u.uRegrowK.value = slow;
    this.shedGroup.visible = true;
    this.shedUntil = t + 3.5;
    return true;
  }

  center(P) { return [(P[234][0] + P[454][0]) / 2, (P[10][1] + P[152][1]) / 2, P[1][2]]; }
  width(P) { return Math.max(1, Math.hypot(P[454][0] - P[234][0], P[454][1] - P[234][1])); }

  /** pts: 478 face points in world px, or null. */
  update(pts, t, dt) {
    const u = this.u;
    if (this.shedGroup && t > this.shedUntil) this.shedGroup.visible = false;
    if (pts && this.on) {
      if (!this.smooth) this.smooth = pts.map((p) => p.slice());
      else for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) this.smooth[i][k] += (pts[i][k] - this.smooth[i][k]) * 0.6;
      const P = this.smooth;
      // push the outline out to the hairline and jaw edge so all visible skin is covered
      const c = this.center(P), w = this.width(P);
      const upx = P[10][0] - P[152][0], upy = P[10][1] - P[152][1], ul = Math.hypot(upx, upy) || 1;
      for (let i = 0; i < N; i++) {
        let [x, y, z] = P[i];
        if (OVAL_SET.has(i)) {
          const dx = x - c[0], dy = y - c[1], dl = Math.hypot(dx, dy) || 1;
          const upness = Math.max(0, (dx * upx + dy * upy) / (dl * ul));
          const push = 0.05 + 0.22 * upness * upness;            // forehead up to the hairline
          x += dx / dl * w * push; y += dy / dl * w * push;
        }
        this.data.set([x, y, z, 1], i * 4);
      }
      this.tex.needsUpdate = true;
      if (!this.built) this.build(Array.from({ length: N }, (_, i) => [this.data[i * 4], this.data[i * 4 + 1], this.data[i * 4 + 2]]));
      u.uScale.value = w * 0.55;
      if (!this.tracked) { if (t - this.lostAt > 0.6) this.seenAt = t; this.tracked = true; }
      u.uAge.value = t - this.seenAt;
      u.uFade.value = Math.min(1, u.uFade.value + dt * 6);
      const since = (t - u.uSnapT.value) / u.uRegrowK.value;
      const regrow = since > -0.5 && since < 6 ? Math.min(1, Math.max(0, (since - 0.9) / 0.9)) : 1;
      u.uGrow.value = Math.min(1, u.uAge.value / 1.2) * u.uFade.value * regrow;
      this.group.visible = true;
    } else {
      if (this.tracked) { this.tracked = false; this.lostAt = t; this.smooth = null; }
      u.uFade.value = Math.max(0, u.uFade.value - dt * 4);
      u.uGrow.value = u.uFade.value * Math.min(1, u.uAge.value / 1.2);
      if (u.uFade.value <= 0) this.group.visible = false;
    }
  }
}
