// Geometry builders: the folded paper boat, floating leaves, a frog made of ellipsoids, the courtyard boxes.
import { cross, sub, add, scale, norm, dot } from './gl.js';

export class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.b = []; }
  tri(a, b, c, ua = [0, 0], ub = [0, 0], uc = [0, 0], na, nb, nc, hide = -1) {
    if (!na) { na = nb = nc = norm(cross(sub(b, a), sub(c, a))); }
    // barycentrics for crease lines; the edge opposite vertex 'hide' (a quad diagonal) gets no line
    const bb = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (hide >= 0) for (const v of bb) v[hide] += 1;
    this.b.push(...bb[0], ...bb[1], ...bb[2]);
    this.p.push(...a, ...b, ...c);
    this.n.push(...na, ...nb, ...nc);
    this.uv.push(...ua, ...ub, ...uc);
  }
  // Quad with an explicit normal (boxes): winding fixed so the computed normal matches.
  quadN(a, b, c, d, n) {
    const fn = norm(cross(sub(b, a), sub(c, a)));
    if (dot(fn, n) < 0) { [b, d] = [d, b]; }
    this.tri(a, b, c, [0, 0], [1, 0], [1, 1], n, n, n);
    this.tri(a, c, d, [0, 0], [1, 1], [0, 1], n, n, n);
  }
  box(x0, x1, y0, y1, z0, z1, skip = '') {
    const P = (x, y, z) => [x, y, z];
    if (!skip.includes('px')) this.quadN(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), [1, 0, 0]);
    if (!skip.includes('nx')) this.quadN(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), [-1, 0, 0]);
    if (!skip.includes('py')) this.quadN(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), [0, 1, 0]);
    if (!skip.includes('ny')) this.quadN(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), [0, -1, 0]);
    if (!skip.includes('pz')) this.quadN(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), [0, 0, 1]);
    if (!skip.includes('nz')) this.quadN(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), [0, 0, -1]);
  }
  data() { return { pos: new Float32Array(this.p), nrm: new Float32Array(this.n), uv: new Float32Array(this.uv), bar: new Float32Array(this.b) }; }
}

// Per-face paper coordinates in metres, rotated by a fold-dependent angle so the notebook rules
// run straight across each flat panel and change direction at every crease, as on a real folded sheet.
function paperTri(g, a, b, c, ang, off, hide = -1) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  let t = norm(sub(b, a));
  const ca = Math.cos(ang), sa = Math.sin(ang);
  t = norm(add(scale(t, ca), scale(cross(n, t), sa)));
  const bt = cross(n, t);
  const uv = (p) => { const d = sub(p, a); return [dot(d, t) + off[0], dot(d, bt) + off[1]]; };
  g.tri(a, b, c, uv(a), uv(b), uv(c), undefined, undefined, undefined, hide);
}

// Classic origami paper boat. Local frame: +z bow, +y up, waterline y=0. About 23 cm long.
export function paperBoat() {
  const g = new Geo();
  const L = 0.112, W = 0.031, KL = 0.06, KW = 0.011, KY = -0.014, RY = 0.04, TY = 0.047;
  let fi = 0;
  const angs = [0.0, 0.79, -0.79, 1.57, 0.35, -0.5];
  const face = (a, b, c, hide = -1) => { const k = fi++; paperTri(g, a, b, c, angs[k % angs.length], [k * 0.013, k * 0.007], hide); };
  const quad = (a, b, c, d) => { const k = fi; face(a, b, c, 1); fi = k; face(a, c, d, 2); };
  for (const sx of [1, -1]) {
    const X = (p) => [p[0] * sx, p[1], p[2]];
    const B = X([0, TY, L]), S = X([0, TY, -L]);
    const Mf = X([W, RY, 0.034]), Mb = X([W, RY, -0.034]);
    const K1 = X([KW, KY, KL]), K2 = X([KW, KY, -KL]);
    // hull side: bow triangle, mid quad, stern triangle (wound so normals face outward on the +x side)
    const tri = (a, b, c) => (sx > 0 ? face(a, b, c) : face(a, c, b));
    tri(B, Mf, K1);
    if (sx > 0) quad(K1, Mf, Mb, K2); else quad(K1, K2, Mb, Mf);
    tri(K2, Mb, S);
    // the folded brim flap lying on the outside of each side: a separate layer, slightly proud
    const o = 0.0012 * sx;
    const F1 = X([0.004, TY - 0.003, L - 0.03]), F2 = X([0.004, TY - 0.003, -L + 0.03]), F3 = X([W * 0.62, -0.004, 0]);
    const lift = (p, t) => [p[0] + o * t, p[1], p[2]];
    const Fa = lift(add(scale(Mf, 0.85), scale(F1, 0.15)), 1), Fb = lift(add(scale(Mb, 0.85), scale(F2, 0.15)), 1);
    const Fc = lift([F3[0] + (sx > 0 ? 0.008 : -0.008), F3[1], F3[2]], 1.3);
    tri(lift(F1, 1.5), Fa, Fc);
    tri(Fa, Fb, Fc);
    tri(Fb, lift(F2, 1.5), Fc);
    // the centre "sail": a double sheet, with a crease where the hat's brim was folded down
    const t0 = 0.0016 * sx, t1 = 0.0075 * sx;
    const kf = [t0, KY + 0.003, KL - 0.004], kb = [t0, KY + 0.003, -KL + 0.004];
    const rf = [t1, RY + 0.002, 0.082], rb = [t1, RY + 0.002, -0.082];
    const ap = [0.0012 * sx, 0.128, 0.0];
    if (sx > 0) { quad(kf, rf, rb, kb); face(rf, ap, rb); } else { quad(kf, kb, rb, rf); face(rf, rb, ap); }
  }
  // flat bottom strip and the pinched end caps
  const K1r = [KW, KY, KL], K1l = [-KW, KY, KL], K2r = [KW, KY, -KL], K2l = [-KW, KY, -KL];
  quad(K1l, K2l, K2r, K1r);
  face([0, TY, L], K1r, K1l);
  face([0, TY, -L], K2l, K2r);
  return g.data();
}

// A floating leaf. kind: 'mango' long and pointed, 'peepal' heart with a drip tip, 'taro' big heart.
export function leaf(kind, len, wid, curl, seed = 1) {
  const g = new Geo();
  const NT = 14, NS = 8;
  const width = (t) => {
    if (kind === 'mango') return wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.0)), 0.75) * (1 - 0.25 * t);
    if (kind === 'peepal') return wid * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.9) * (t > 0.82 ? Math.max(0.12, 1 - (t - 0.82) * 4.2) : 1);
    return wid * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.65); // taro: wide notched base
  };
  const pt = (t, s) => {
    const w = width(t);
    const x = s * w;
    const z = (t - 0.45) * len;
    const wob = Math.sin(seed * 7.1 + t * 9 + s * 3) * 0.0015;
    const y = curl * x * x / (wid * wid) * wid * 0.35 + Math.sin(t * Math.PI) * 0.002 + wob + 0.0025;
    return [x, y, z];
  };
  const P = [], U = [];
  for (let i = 0; i <= NT; i++) for (let j = 0; j <= NS; j++) {
    const t = i / NT, s = j / NS * 2 - 1;
    P.push(pt(t, s)); U.push([t, s]);
  }
  const N = P.map(() => [0, 0, 0]);
  const id = (i, j) => i * (NS + 1) + j;
  const tris = [];
  for (let i = 0; i < NT; i++) for (let j = 0; j < NS; j++) {
    tris.push([id(i, j), id(i, j + 1), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i + 1, j)]);
  }
  for (const [a, b, c] of tris) {
    const n = cross(sub(P[b], P[a]), sub(P[c], P[a]));
    for (const k of [a, b, c]) N[k] = add(N[k], n);
  }
  for (const [a, b, c] of tris) g.tri(P[a], P[b], P[c], U[a], U[b], U[c], norm(N[a]), norm(N[b]), norm(N[c]));
  return g.data();
}

// Ellipsoid with radii r, rotated by yaw/pitch and placed at t; normals are exact.
export function ellipsoid(g, r, t, yaw = 0, pitch = 0, nu = 16, nv = 10) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const rot = (v) => { const y1 = v[1] * cp - v[2] * sp, z1 = v[1] * sp + v[2] * cp; return [v[0] * cy + z1 * sy, y1, -v[0] * sy + z1 * cy]; };
  const pos = (u, v) => {
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const s = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
    return { p: add(rot([s[0] * r[0], s[1] * r[1], s[2] * r[2]]), t), n: norm(rot([s[0] / r[0], s[1] / r[1], s[2] / r[2]])), uv: [u, v] };
  };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = pos(i / nu, j / nv), b = pos((i + 1) / nu, j / nv), c = pos((i + 1) / nu, (j + 1) / nv), d = pos(i / nu, (j + 1) / nv);
    g.tri(a.p, c.p, b.p, a.uv, c.uv, b.uv, a.n, c.n, b.n);
    g.tri(a.p, d.p, c.p, a.uv, d.uv, c.uv, a.n, d.n, c.n);
  }
}

// Frog body (sitting pose) and eyes are separate meshes so the shader can colour the eyes.
export function frog(legsOut = false) {
  const body = new Geo(), eyes = new Geo();
  ellipsoid(body, [0.021, 0.015, 0.031], [0, 0.017, -0.004], 0, -0.32);
  ellipsoid(body, [0.019, 0.012, 0.017], [0, 0.026, 0.026], 0, -0.1);
  for (const s of [1, -1]) {
    ellipsoid(eyes, [0.0068, 0.0068, 0.0068], [0.0115 * s, 0.035, 0.03]);
    if (!legsOut) {
      ellipsoid(body, [0.008, 0.0075, 0.022], [0.021 * s, 0.01, -0.016], 0.45 * s, 0.1);
      ellipsoid(body, [0.0055, 0.005, 0.02], [0.028 * s, 0.006, 0.004], -0.25 * s, 0.05);
      ellipsoid(body, [0.008, 0.003, 0.012], [0.026 * s, 0.002, 0.022], 0.3 * s, 0);
      ellipsoid(body, [0.0045, 0.0045, 0.013], [0.014 * s, 0.009, 0.03], 0.15 * s, 0.9);
    } else {
      ellipsoid(body, [0.008, 0.0075, 0.024], [0.016 * s, 0.012, -0.045], 0.15 * s, -0.2);
      ellipsoid(body, [0.005, 0.005, 0.024], [0.02 * s, 0.01, -0.085], 0.1 * s, -0.1);
      ellipsoid(body, [0.0045, 0.0045, 0.015], [0.014 * s, 0.006, 0.042], 0.1 * s, -0.4);
    }
  }
  return { body: body.data(), eyes: eyes.data() };
}

// Lathe (for a clay matka): profile of [radius, y] points.
export function lathe(profile, seg = 28) {
  const g = new Geo();
  for (let i = 0; i < seg; i++) for (let k = 0; k < profile.length - 1; k++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
    const P = (r, y, a) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const n0 = norm([y1 - y0, -(r1 - r0), 0]);
    const N = (a) => norm([Math.cos(a) * n0[0], n0[1], Math.sin(a) * n0[0]]);
    const A = P(r0, y0, a0), B = P(r0, y0, a1), C = P(r1, y1, a1), D = P(r1, y1, a0);
    g.tri(A, C, B, [i / seg, k], [(i + 1) / seg, k + 1], [(i + 1) / seg, k], N(a0), N(a1), N(a1));
    g.tri(A, D, C, [i / seg, k], [i / seg, k + 1], [(i + 1) / seg, k + 1], N(a0), N(a0), N(a1));
  }
  return g.data();
}
