// Real 3D plant models, built procedurally. Local space: y = up from the hand surface, a plant ~1 unit tall.
// Every vertex carries a colour and a height fraction (0 at the root, 1 at the tip) for depth shading.
// Triangles are flat-shaded; the shader lights both faces so thin leaves read from either side.

const GOLDEN = 2.399963;

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

class Builder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.h = []; }
  tri(a, b, c, ca, cb, cc, ha, hb, hc) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    for (const [p, col, h] of [[a, ca, ha], [b, cb, hb], [c, cc, hc]]) {
      this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.col.push(col[0], col[1], col[2]); this.h.push(h);
    }
  }
  /** A thin 3-sided tube through points; radius(t), color(t), height(t). */
  tube(pts, radius, color, height, sides = 3) {
    const rings = pts.map((p, i) => {
      const t = i / (pts.length - 1);
      const d = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
      const a = norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), b = cross(d, a);
      const r = radius(t);
      return Array.from({ length: sides }, (_, k) => {
        const ang = (k / sides) * Math.PI * 2;
        return add(add(p, a, Math.cos(ang) * r), b, Math.sin(ang) * r);
      });
    });
    for (let i = 0; i < rings.length - 1; i++) {
      const t0 = i / (rings.length - 1), t1 = (i + 1) / (rings.length - 1);
      const c0 = color(t0), c1 = color(t1), h0 = height(t0), h1 = height(t1);
      for (let k = 0; k < sides; k++) {
        const k2 = (k + 1) % sides;
        this.tri(rings[i][k], rings[i][k2], rings[i + 1][k], c0, c0, c1, h0, h0, h1);
        this.tri(rings[i][k2], rings[i + 1][k2], rings[i + 1][k], c0, c1, c1, h0, h1, h1);
      }
    }
  }
  /** A leaf from base along dir, folded along its midrib (4 triangles). side = the leaf's width axis. */
  leaf(base, dir, side, len, width, cBase, cTip, hBase, hTip, fold = 0.25) {
    const up = norm(cross(side, dir));
    const mid = add(base, dir, len * 0.45);
    const l = add(mid, side, -width), r = add(mid, side, width);
    const ridge = add(mid, up, width * fold);
    const tip = add(base, dir, len);
    const cm = mix(cBase, cTip, 0.5), hm = (hBase + hTip) / 2;
    this.tri(base, l, ridge, cBase, cm, cm, hBase, hm, hm);
    this.tri(base, ridge, r, cBase, cm, cm, hBase, hm, hm);
    this.tri(l, tip, ridge, cm, cTip, cm, hm, hTip, hm);
    this.tri(ridge, tip, r, cm, cTip, cm, hm, hTip, hm);
  }
  /** Low-poly ball (octahedron, split once). */
  ball(c, r, col, h) {
    const v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    for (const [a, b, d] of f) {
      const A = v[a], B = v[b], D = v[d];
      const ab = norm(add(A, B)), bd = norm(add(B, D)), da = norm(add(D, A));
      const P = (q) => add(c, q, r);
      const shade = (q) => mix(col, [1, 1, 1], Math.max(0, q[1]) * 0.25);
      for (const [x, y, z] of [[A, ab, da], [ab, B, bd], [da, bd, D], [ab, bd, da]]) this.tri(P(x), P(y), P(z), shade(x), shade(y), shade(z), h, h, h);
    }
  }
  build() { return { pos: this.pos, nrm: this.nrm, col: this.col, h: this.h }; }
}

/** Star moss: a cushion of upright stems, each wrapped in tiny pointed leaves, pale at the tips. */
export function starMoss(seed) {
  const R = rng(seed), g = new Builder();
  const dark = hex(0x10200a), deep = hex(0x24420f), midA = hex(0x386418), midB = hex(0x4f8a22), light = hex(0x86b34a), pale = hex(0xcbe0a4);
  const stems = 7;
  for (let s = 0; s < stems; s++) {
    const a = s * GOLDEN + R() * 0.5, rr = s === 0 ? 0 : 0.42 * Math.sqrt(s / (stems - 1));
    const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr;
    const H = (0.8 + R() * 0.35) * (1 - 0.25 * rr * rr);
    const lx = bx * 0.35 + (R() - 0.5) * 0.25, lz = bz * 0.35 + (R() - 0.5) * 0.25;
    const at = (t) => [bx + lx * t * t, H * t, bz + lz * t * t];
    const stemCol = mix(midA, midB, R());
    g.tube([0, 0.5, 1].map(at), (t) => 0.035 * (1 - t * 0.6), (t) => mix(dark, stemCol, t), (t) => t, 3);
    const leaves = 11 + Math.floor(R() * 3);
    for (let k = 0; k < leaves; k++) {
      const t = 0.18 + 0.82 * k / (leaves - 1);
      const ang = k * GOLDEN + a + R() * 0.3;
      const radial = [Math.cos(ang), 0, Math.sin(ang)], tang = [-Math.sin(ang), 0, Math.cos(ang)];
      const elev = 0.35 + t * 0.75;                               // lower leaves spread, upper ones point up
      const dir = norm(add(radial, [0, 1, 0], Math.tan(Math.min(1.35, elev))));
      const len = (0.2 + R() * 0.09) * (0.7 + 0.3 * Math.sin(t * Math.PI));
      let tip = mix(stemCol, light, smooth(0.45, 1, t) * (0.35 + R() * 0.5));
      if (t > 0.78) tip = mix(tip, pale, (0.25 + R() * 0.4) * smooth(0.78, 1, t));
      const base = t < 0.35 ? mix(stemCol, dark, (1 - t / 0.35) * 0.6) : stemCol;
      g.leaf(at(t), dir, tang, len, len * 0.22, mix(base, dark, 0.25), tip, t, Math.min(1, t + 0.1), 0.5);
    }
  }
  return g.build();
}

/** Allium-like pompom: a violet ball of tiny star florets on a thin stem. */
export function pompom(seed) {
  const R = rng(seed), g = new Builder();
  const stemA = hex(0x2c3a14), stemB = hex(0x56703a), core = hex(0x3d3399), petal = hex(0x7a6ee8), tip = hex(0xd2ccff);
  const H = 0.85 + R() * 0.3, lean = (R() - 0.5) * 0.3;
  const top = [lean, H, (R() - 0.5) * 0.2];
  g.tube([0, 0.4, 0.75, 1].map((t) => [top[0] * t * t, top[1] * t, top[2] * t * t]), (t) => 0.03 * (1 - t * 0.4), (t) => mix(stemA, stemB, t), (t) => t * 0.8, 3);
  const r = 0.2 + R() * 0.06;
  const c = add(top, [0, r * 0.7, 0]);
  g.ball(c, r * 0.72, core, 0.9);
  const n = 90;
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * (i + 0.5) / n, rad = Math.sqrt(1 - y * y), th = i * GOLDEN + R() * 0.3;
    const d = [Math.cos(th) * rad, y, Math.sin(th) * rad];
    const side = norm(cross(d, [R() - 0.5, R() - 0.5, R() - 0.5]));
    const b = add(c, d, r * 0.6), e = add(c, d, r * (1.12 + R() * 0.2));
    const cc = mix(petal, tip, R() * 0.6), shade = 0.75 + 0.25 * y;
    g.tri(add(b, side, 0.03), add(b, side, -0.03), e, mix(petal, core, 0.4).map((v) => v * shade), mix(petal, core, 0.4).map((v) => v * shade), cc.map((v) => v * shade), 0.95, 0.95, 1);
  }
  return g.build();
}

/** A small spray of cream flower buds. */
export function buds(seed) {
  const R = rng(seed), g = new Builder();
  const stemA = hex(0x33451a), stemB = hex(0x8aa45a), cream = hex(0xf3f2c4), lime = hex(0xd9e79c);
  const H = 0.7 + R() * 0.3, top = [(R() - 0.5) * 0.25, H, (R() - 0.5) * 0.25];
  g.tube([0, 0.5, 1].map((t) => [top[0] * t * t, top[1] * t, top[2] * t * t]), (t) => 0.035 * (1 - t * 0.4), (t) => mix(stemA, stemB, t), (t) => t * 0.8, 3);
  const n = 6 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN + R(), d = 0.1 + R() * 0.2;
    const end = [top[0] + Math.cos(a) * d, H + 0.08 + R() * 0.25, top[2] + Math.sin(a) * d];
    const midp = mix(top, end, 0.5); midp[1] = end[1] * 0.94;
    g.tube([top, midp, end], () => 0.016, () => stemB, () => 0.9, 3);
    g.ball(end, 0.07 + R() * 0.05, mix(lime, cream, R()), 1);
  }
  return g.build();
}

/** A fern frond: an arching stalk with paired leaflets that shrink toward the tip. */
export function fern(seed) {
  const R = rng(seed), g = new Builder();
  const stalkA = hex(0x2f2a14), stalkB = hex(0x5d7a26), leafA = hex(0x2f5a17), leafB = hex(0x4d8222), leafTip = hex(0x8fba50);
  const segs = 18, a0 = 0.15 + R() * 0.2, bend = 1.0 + R() * 0.5;
  const pts = [], dirs = [];
  let p = [0, 0, 0];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, ang = a0 + bend * t * t;
    const d = [Math.sin(ang), Math.cos(ang), 0];
    pts.push(p); dirs.push(d);
    p = add(p, d, 1 / segs);
  }
  g.tube(pts, (t) => 0.02 * (1 - t * 0.8), (t) => mix(stalkA, stalkB, smooth(0, 0.5, t)), (t) => t, 3);
  const pairs = 20;
  for (let i = 0; i < pairs; i++) {
    const t = 0.13 + 0.85 * i / (pairs - 1), k = Math.min(segs - 1, Math.floor(t * segs));
    const d = dirs[k], env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.9);
    const len = 0.26 * env * (0.9 + R() * 0.2) + 0.03;
    const col = mix(mix(leafA, leafB, R()), leafTip, smooth(0.55, 1, t) * 0.7);
    for (const s of [-1, 1]) {
      const sweep = 0.4 + t * 0.35 + (R() - 0.5) * 0.12;
      const dir = norm(add([0, 0, s * Math.cos(sweep)], d, Math.sin(sweep)));
      const side = norm(cross(dir, [0, 0, 1]).map((v) => v * -s));
      g.leaf(pts[k], dir, side.some(Number.isNaN) ? [1, 0, 0] : side, len, len * 0.16, mix(col, leafA, 0.3), mix(col, leafTip, 0.25), t, t, 0.3);
    }
  }
  return g.build();
}

/** A leafy sprig: a soft stem with small oval leaves in a spiral. */
export function sprig(seed) {
  const R = rng(seed), g = new Builder();
  const stemA = hex(0x241d10), stemB = hex(0x4e5a26), leafA = hex(0x588538), leafB = hex(0x74a552), leafTip = hex(0xa6cb84);
  const segs = 10, a0 = 0.1 + R() * 0.2, bend = 0.5 + R() * 0.5, pts = [], dirs = [];
  let p = [0, 0, 0];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, ang = a0 + bend * t * t;
    const d = norm([Math.sin(ang), Math.cos(ang), Math.sin(t * 3 + seed) * 0.12]);
    pts.push(p); dirs.push(d);
    p = add(p, d, 0.75 / segs);
  }
  g.tube(pts, (t) => 0.018 * (1 - t * 0.7), (t) => mix(stemA, stemB, smooth(0.3, 1, t)), (t) => t, 3);
  const n = 9 + Math.floor(R() * 4);
  for (let i = 0; i < n; i++) {
    const t = 0.22 + 0.78 * i / (n - 1), k = Math.min(segs, Math.round(t * segs)), S = dirs[k];
    const w = i * GOLDEN + R() * 0.5;
    let out = [Math.cos(w), 0, Math.sin(w)];
    out = norm(add(out, S, -(out[0] * S[0] + out[1] * S[1] + out[2] * S[2])));
    const dir = norm(add(out, S, 0.9));
    const side = norm(cross(dir, S));
    const len = 0.16 + R() * 0.06;
    g.leaf(pts[k], dir, side, len, len * 0.32, leafA, mix(leafB, leafTip, t), t, t, 0.35);
  }
  return g.build();
}
