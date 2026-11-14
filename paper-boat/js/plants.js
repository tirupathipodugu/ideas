// Plant geometry, all built in code: grass clumps, fern fronds, daisies, blue flower clusters,
// leafy rosettes and a generic leaf (ivy, canopy, drifting leaves). Each carries vertex colours;
// every instance then gets its own tint, size, lean and wind phase.
import * as THREE from '../vendor/three/three.module.js';

class Builder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  v(p, n, uv, c) { this.p.push(...p); this.n.push(...n); this.uv.push(...uv); this.c.push(...c); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    g.boundingSphere.radius += 1;
    return g;
  }
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rot = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];

// A strip that follows a path: path(t) -> [x,y,z], width(t), side vector fixed per strip.
function strip(B, N, path, width, side, colA, colB, normal = [0, 0, 1]) {
  let prev = null;
  for (let s = 0; s <= N; s++) {
    const t = s / N, p = path(t), w = width(t), col = lerp3(colA, colB, t);
    const a = B.v([p[0] - side[0] * w, p[1] - side[1] * w, p[2] - side[2] * w], normal, [0, t], col);
    const b = B.v([p[0] + side[0] * w, p[1] + side[1] * w, p[2] + side[2] * w], normal, [1, t], col);
    if (prev) B.quad(prev[0], prev[1], b, a);
    prev = [a, b];
  }
}

// Three blades from one root, each tapered and curving over. Height is normalised to 1 (instance scales y).
export function grassClump() {
  const B = new Builder();
  const blades = [[0, 1, 0.07], [0.9, 0.72, 0.11], [2.1, 0.86, 0.09], [3.0, 0.6, 0.13], [4.2, 0.94, 0.05], [5.1, 0.7, 0.1], [5.8, 0.8, 0.08]];
  for (const [ang, h, lean] of blades) {
    const dir = [Math.sin(ang), 0, Math.cos(ang)];
    const side = [Math.cos(ang), 0, -Math.sin(ang)];
    const off = [Math.sin(ang * 3) * 0.009, 0, Math.cos(ang * 3) * 0.009];
    strip(B, 5, (t) => [off[0] + dir[0] * lean * t * t, h * (t - 0.08 * t * t), off[2] + dir[2] * lean * t * t],
      (t) => 0.0028 * (1 - t * 0.9), side, [0.04, 0.08, 0.02], [0.34, 0.58, 0.13], dir);
  }
  return B.geo();
}

// A fern frond: an arching stalk with paired leaflets that shrink toward the tip. Length 1 along +z.
export function fernFrond() {
  const B = new Builder();
  const path = (t) => [0, 0.62 * t * (1.05 - t), t];
  const stalkSide = [1, 0, 0];
  strip(B, 10, path, () => 0.004, stalkSide, [0.12, 0.16, 0.04], [0.2, 0.32, 0.07], [0, 1, 0]);
  const NP = 24;
  for (let i = 2; i < NP; i++) {
    const t = i / NP;
    const base = path(t);
    const len = 0.17 * Math.sin(Math.PI * (0.08 + 0.92 * t)) * (1 - 0.35 * t);
    for (const s of [-1, 1]) {
      const fwd = 0.35, droop = -0.25;
      const d = [s * Math.cos(fwd), droop, Math.sin(fwd)];
      const L = Math.hypot(...d); d[0] /= L; d[1] /= L; d[2] /= L;
      const side = [0, 0, 1];
      strip(B, 3, (u) => [base[0] + d[0] * len * u, base[1] + d[1] * len * u - 0.02 * u * u, base[2] + d[2] * len * u],
        (u) => 0.011 * Math.sin(Math.PI * Math.min(1, 0.15 + u)) * (1 - 0.3 * t), side,
        [0.08, 0.17, 0.035], lerp3([0.2, 0.36, 0.07], [0.3, 0.48, 0.1], t), [0, 1, 0]);
    }
  }
  return B.geo();
}

// Common daisy: thin stem, a ring of white petals, a domed yellow centre. About 20 cm tall, uniform scale.
export function daisy() {
  const B = new Builder();
  const H = 0.2, tilt = 0.45;
  strip(B, 6, (t) => [0.012 * Math.sin(t * 2.5), H * t, 0.02 * t * t], () => 0.0012, [1, 0, 0], [0.08, 0.16, 0.04], [0.18, 0.3, 0.08], [0, 0, 1]);
  const top = [0.012 * Math.sin(2.5), H, 0.02];
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const orient = (p) => { const y = p[1] * ct - p[2] * st, z = p[1] * st + p[2] * ct; return [top[0] + p[0], top[1] + y, top[2] + z]; };
  const up = orient([0, 1, 0]).map((v, i) => v - top[i]);
  const NPET = 14;
  for (let k = 0; k < NPET; k++) {
    const a = k / NPET * Math.PI * 2 + (k % 2) * 0.1;
    const r0 = 0.004, r1 = 0.016 + (k % 3) * 0.001;
    const dirx = Math.cos(a), dirz = Math.sin(a), sx = -dirz, sz = dirx;
    const w = 0.0028;
    const P = (r, ww, y) => orient([dirx * r + sx * ww, y, dirz * r + sz * ww]);
    const white = [0.95, 0.95, 0.9], tip = k % 4 === 0 ? [0.95, 0.82, 0.86] : white;
    const v0 = B.v(P(r0, -w * 0.6, 0.001), up, [0, 0], white), v1 = B.v(P(r0, w * 0.6, 0.001), up, [1, 0], white);
    const v2 = B.v(P(r1, w, 0.0035 * Math.sin(a * 3)), up, [1, 1], tip), v3 = B.v(P(r1, -w, 0.0035 * Math.sin(a * 3)), up, [0, 1], tip);
    const v4 = B.v(P(r1 + 0.0025, 0, 0.003), up, [0.5, 1], tip);
    B.quad(v0, v1, v2, v3); B.tri(v3, v2, v4);
  }
  // domed centre
  const NC = 10, rc = 0.0055;
  const c0 = B.v(orient([0, 0.0035, 0]), up, [0.5, 0.5], [1, 0.72, 0.08]);
  const ring = [];
  for (let k = 0; k < NC; k++) { const a = k / NC * Math.PI * 2; ring.push(B.v(orient([Math.cos(a) * rc, 0.0012, Math.sin(a) * rc]), up, [0, 0], [0.9, 0.55, 0.05])); }
  for (let k = 0; k < NC; k++) B.tri(c0, ring[(k + 1) % NC], ring[k]);
  // two small basal leaves
  for (const a of [0.6, 3.4]) strip(B, 3, (t) => rot([0, 0.03 * t * (1.2 - t), 0.05 * t], a), (t) => 0.007 * Math.sin(Math.PI * t), rot([1, 0, 0], a), [0.08, 0.17, 0.04], [0.16, 0.3, 0.07], [0, 1, 0]);
  return B.geo();
}

// A cluster of small blue-violet flowers (like forget-me-nots / speedwell) on a stem.
export function blueFlowers() {
  const B = new Builder();
  const H = 0.15;
  strip(B, 5, (t) => [0, H * t, 0.012 * t * t], () => 0.001, [1, 0, 0], [0.08, 0.16, 0.04], [0.16, 0.28, 0.07], [0, 0, 1]);
  const florets = [[0, H + 0.004, 0.012], [0.012, H - 0.012, 0.006], [-0.011, H - 0.02, 0.015], [0.006, H - 0.032, -0.008], [-0.004, H + 0.012, 0.0], [0.014, H + 0.002, 0.018]];
  florets.forEach((f, idx) => {
    const NPE = 5, r = 0.0068 + (idx % 2) * 0.0014;
    const up = [0.2, 1, 0.3];
    const ctr = B.v([f[0], f[1] + 0.0008, f[2]], up, [0.5, 0.5], [0.95, 0.9, 0.6]);
    for (let k = 0; k < NPE; k++) {
      const a = k / NPE * Math.PI * 2 + idx;
      const a0 = a - 0.62, a1 = a + 0.62;
      const p0 = B.v([f[0] + Math.cos(a0) * r * 0.62, f[1] + 0.0004, f[2] + Math.sin(a0) * r * 0.62], up, [0, 1], [0.32, 0.36, 0.95]);
      const p1 = B.v([f[0] + Math.cos(a) * r, f[1] - 0.001, f[2] + Math.sin(a) * r], up, [0.5, 1], [0.42, 0.42, 1.0]);
      const p2 = B.v([f[0] + Math.cos(a1) * r * 0.62, f[1] + 0.0004, f[2] + Math.sin(a1) * r * 0.62], up, [1, 1], [0.32, 0.36, 0.95]);
      B.tri(ctr, p0, p1); B.tri(ctr, p1, p2);
    }
  });
  for (const a of [0.3, 2.4, 4.4]) strip(B, 3, (t) => rot([0, 0.02 * t * (1.3 - t) + 0.02, 0.035 * t], a), (t) => 0.005 * Math.sin(Math.PI * t), rot([1, 0, 0], a), [0.08, 0.17, 0.04], [0.16, 0.3, 0.07], [0, 1, 0]);
  return B.geo();
}

// A leaf, 1 long (along +y in uv, +z in space), folded slightly along the midrib. uLeaf shading adds veins.
export function leafGeo(shape = 'ovate') {
  const B = new Builder();
  const N = 8;
  let prev = null;
  for (let s = 0; s <= N; s++) {
    const t = s / N;
    let w = shape === 'heart' ? 0.42 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * t)), 0.8) : 0.3 * Math.pow(Math.sin(Math.PI * t), 0.75);
    if (t === 1) w = 0;
    const y = 0.12 * Math.sin(Math.PI * t) - 0.08 * t * t;
    // cupped along the midrib, edges curling up, tip drooping
    const a = B.v([-w, y + w * 0.7, t], [-0.4, 1, 0], [0, t], [0.8, 0.8, 0.8]);
    const m = B.v([0, y, t], [0, 1, 0], [0.5, t], [1, 1, 1]);
    const b = B.v([w, y + w * 0.7, t], [0.4, 1, 0], [1, t], [0.8, 0.8, 0.8]);
    if (prev) { B.quad(prev[0], prev[1], m, a); B.quad(prev[1], prev[2], b, m); }
    prev = [a, m, b];
  }
  return B.geo();
}

// A low leafy rosette (wild strawberry / plantain-like ground plant).
export function rosette() {
  const B = new Builder();
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2 + k * 0.3, len = 0.07 + (k % 3) * 0.015;
    const lift = 0.35 + (k % 2) * 0.2;
    const side = rot([1, 0, 0], a);
    strip(B, 5, (t) => rot([0, Math.sin(lift) * len * t - 0.02 * t * t, Math.cos(lift) * len * t], a),
      (t) => 0.024 * Math.pow(Math.sin(Math.PI * t), 0.8), side, [0.07, 0.15, 0.03], [0.16, 0.32, 0.06], [0, 1, 0]);
  }
  return B.geo();
}
