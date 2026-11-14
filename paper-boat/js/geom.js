// The folded paper boat geometry (flat origami panels, per-face paper coordinates, crease barycentrics).
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

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
