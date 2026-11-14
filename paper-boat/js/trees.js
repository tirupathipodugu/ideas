// Trees, grown in code. A few templates per kind (giant old trunk by the water, furrowed old tree,
// smooth peeling-bark tree, sapling) are grown recursively: trunk -> limbs -> sub-limbs -> twigs, as
// curved tapering tubes with a flared base and flattened buttress roots that grip the bank. Leaf clusters
// sit at the twig tips and along the outer limbs. Each template is drawn instanced, turned and scaled per
// tree; distant forest is a few layers of cheap painted billboards fading into the mist.
import * as THREE from '../vendor/three/three.module.js';

function rng(seed) { let s = (Math.abs(seed) * 9301 + 49297) % 233280 || 3; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const V = THREE.Vector3;

class Mesh {
  constructor() { this.p = []; this.n = []; this.uv = []; this.f = []; this.b = []; this.i = []; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('flex', new THREE.Float32BufferAttribute(this.f, 1));
    g.setAttribute('btype', new THREE.Float32BufferAttribute(this.b, 1));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

// A tube along pts with radii; 'flat' squashes the cross-section sideways (buttress roots are tall and thin).
function tube(M, pts, rad, seg, flex, btype, flat = 1) {
  const base = M.p.length / 3;
  let N = null, len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const T = new V().subVectors(b, a).normalize();
    if (!N) {
      N = new V(0, 1, 0).addScaledVector(T, -T.y);
      if (N.lengthSq() < 1e-4) N.set(1, 0, 0).addScaledVector(T, -T.x);
      N.normalize();
    } else { N.addScaledVector(T, -N.dot(T)).normalize(); }
    const B = new V().crossVectors(T, N).normalize();
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    for (let k = 0; k <= seg; k++) {
      const ang = k / seg * Math.PI * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const dir = new V().addScaledVector(N, c).addScaledVector(B, s * flat);
      const nrm = new V().addScaledVector(N, c * flat).addScaledVector(B, s).normalize();
      const p = new V().copy(pts[i]).addScaledVector(dir, rad[i]);
      M.p.push(p.x, p.y, p.z); M.n.push(nrm.x, nrm.y, nrm.z);
      M.uv.push(ang * Math.max(rad[i], 0.04), len); M.f.push(flex[i]); M.b.push(btype);
    }
  }
  const ring = seg + 1;
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < seg; k++) {
    const a = base + i * ring + k, b = a + 1, c = a + ring, d = c + 1;
    M.i.push(a, c, b, b, c, d);
  }
}

// rotate v away from its own direction by angle, around a random perpendicular axis biased by 'bias'
function deflect(dir, angle, r, bias) {
  let ax = new V(r() - 0.5, r() - 0.5, r() - 0.5).cross(dir);
  if (bias) ax = new V().crossVectors(dir, bias).normalize().multiplyScalar(-1).lerp(ax.normalize(), 0.5);
  ax.normalize();
  return dir.clone().applyAxisAngle(ax, angle).normalize();
}

const KINDS = {
  giant: { H: 19, R: 0.62, btype: 0, roots: 7, limbs: 7, start: 0.3, depth: 3, reach: 2, spread: 0.55 },
  old: { H: 16, R: 0.42, btype: 0, roots: 5, limbs: 6, start: 0.35, depth: 3, reach: 1, spread: 0.5 },
  smooth: { H: 15, R: 0.3, btype: 1, roots: 4, limbs: 6, start: 0.4, depth: 3, reach: 1, spread: 0.45 },
  sapling: { H: 4.5, R: 0.07, btype: 1, roots: 0, limbs: 5, start: 0.3, depth: 2, reach: 0, spread: 0.5 },
};

// Grow one tree template. Local frame: +y up, +x toward the stream.
export function growTree(kind, seed) {
  const K = KINDS[kind], r = rng(seed);
  const M = new Mesh();
  const clusters = [];
  const H = K.H * (0.85 + r() * 0.3), R = K.R * (0.85 + r() * 0.3);
  const lean = new V((r() - 0.3) * 0.12, 1, (r() - 0.5) * 0.1).normalize();

  // branch: grows a curved tapering tube and recurses
  const branch = (o, dir, len, r0, level, flex0, opts = {}) => {
    const n = level === 0 ? 26 : level === 1 ? 9 : level === 2 ? 6 : 4;
    const pts = [o.clone()], rad = [], flex = [];
    let d = dir.clone(), p = o.clone();
    const seg = level === 0 ? 14 : level === 1 ? 9 : level === 2 ? 6 : 4;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let rr = r0 * Math.pow(1 - t * 0.82, level === 0 ? 0.9 : 1.15);
      if (level === 0) rr *= 1 + 0.75 * Math.exp(-t * H / 0.45); // flared base
      rad.push(Math.max(rr, 0.004));
      flex.push(Math.min(1, flex0 + (level === 0 ? 0.06 : 0.35) * t));
      if (i < n) {
        d.add(new V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(level === 0 ? 0.05 : 0.22));
        d.y += level === 0 ? 0.01 : opts.droop ? -0.05 + t * 0.06 : 0.07; // tropism: limbs turn upward, reaching limbs sag then lift
        d.normalize();
        p = p.clone().addScaledVector(d, len / n);
        pts.push(p);
      }
    }
    tube(M, pts, rad, seg, flex, K.btype);
    if (level >= K.depth) {
      // leaves: clusters at the tip and along the last stretch of every twig
      for (let j = 0; j < 3; j++) {
        const q = pts[Math.max(1, pts.length - 1 - j)];
        clusters.push([q.x, q.y, q.z, 0.85 + r() * 0.5, r() * 6.28, (r() - 0.5) * 0.8]);
      }
      return;
    }
    const kids = level === 0 ? K.limbs : level === 1 ? 4 : 3;
    const startT = level === 0 ? K.start : 0.3;
    for (let c = 0; c < kids; c++) {
      const t = startT + (1 - startT) * (c + r() * 0.6) / kids;
      const idx = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
      const at = pts[idx];
      const pd = new V().subVectors(pts[idx + 1], at).normalize();
      // whorl around the parent, opening outward and upward
      const az = c * 2.4 + r() * 0.8;
      let cd = new V(Math.cos(az), 0, Math.sin(az));
      cd = pd.clone().multiplyScalar(level === 0 ? 0.5 : 0.65).addScaledVector(cd, level === 0 ? 0.85 : 0.6).normalize();
      const clen = len * (level === 0 ? (0.32 + r() * 0.18) * (1.15 - t * 0.5) : 0.5 + r() * 0.2);
      branch(at, cd, clen, rad[idx] * (level === 0 ? 0.42 : 0.6), level + 1, flex[idx] + 0.1);
    }
    // the limbs that reach out over the water, low enough to frame the stream
    if (level === 0) for (let j = 0; j < K.reach; j++) {
      const hy = 2.4 + r() * 2.2 + j * 1.3;
      const idx = Math.min(pts.length - 2, Math.floor(hy / H * (pts.length - 1)));
      const cd = new V(1, 0.28 + r() * 0.2, (r() - 0.5) * 0.7).normalize();
      branch(pts[idx], cd, 3.6 + r() * 2.2, rad[idx] * 0.38, 1, 0.1, { droop: true });
    }
  };
  branch(new V(0, -0.3, 0), lean, H, R, 0, 0);

  // buttress roots: flattened, curving out and down the bank, the stream side ones longest
  for (let j = 0; j < K.roots; j++) {
    const az = j / K.roots * Math.PI * 2 + r() * 0.5;
    const out = new V(Math.cos(az), 0, Math.sin(az));
    const toWater = out.x > 0.35;
    const L = R * (toWater ? 2.4 + r() * 0.9 : 1.5 + r() * 0.7);
    const pts = [], rad = [], flex = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const reach = R * 0.55 + L * Math.pow(t, 0.85);
      const y = R * 1.1 * Math.pow(1 - t, 2.2) - (toWater ? 0.55 : 0.3) * t * t - 0.02;
      const wob = Math.sin(t * 4 + j * 1.7) * 0.12 * R * t;
      pts.push(new V(out.x * reach - out.z * wob, y, out.z * reach + out.x * wob));
      rad.push(R * (0.36 * Math.pow(1 - t, 1.6) + 0.035));
      flex.push(0);
    }
    tube(M, pts, rad, 10, flex, K.btype + 2, 0.62);
  }

  // darker leaves inside the crown, lighter on its outer skin
  if (clusters.length) {
    const c = clusters.reduce((a, q) => a.add(new V(q[0], q[1], q[2])), new V()).multiplyScalar(1 / clusters.length);
    let maxD = 0;
    for (const q of clusters) maxD = Math.max(maxD, Math.hypot(q[0] - c.x, (q[1] - c.y) * 1.4, q[2] - c.z));
    for (const q of clusters) q.push(0.45 + 0.55 * Math.min(1, Math.hypot(q[0] - c.x, (q[1] - c.y) * 1.4, q[2] - c.z) / (maxD || 1)) * (0.7 + 0.3 * Math.min(1, q[1] / H)));
  }
  return { geo: M.geo(), clusters, H, R, kind };
}

// A leaf cluster: ~20 ovate leaves fanned over a dome, each with its own tilt; inner leaves darker.
export function clusterGeo(nLeaves = 20) {
  const r = rng(77);
  const P = [], N = [], U = [], C = [], I = [];
  for (let l = 0; l < nLeaves; l++) {
    const th = r() * 6.28, ph = Math.acos(1 - r() * 1.4);
    const outward = new V(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const pos = outward.clone().multiplyScalar(0.12 + r() * 0.14);
    const fwd = new V().copy(outward).add(new V(r() - 0.5, -0.4, r() - 0.5)).normalize();
    const side = new V().crossVectors(fwd, new V(0, 1, 0)).normalize();
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const up = new V().crossVectors(side, fwd).normalize();
    const L = 0.085 + r() * 0.05, W = L * 0.42;
    const shade = 0.6 + 0.4 * (outward.y * 0.5 + 0.5);
    const base = P.length / 3;
    const pt = (a, w, lift) => { const v = pos.clone().addScaledVector(fwd, a * L).addScaledVector(side, w * W).addScaledVector(up, lift * L); P.push(v.x, v.y, v.z); N.push(up.x, up.y, up.z); };
    // 7 vertices: stalk, two shoulders, midrib, two hips, tip
    pt(0, 0, 0); U.push(0.5, 0); C.push(shade, shade, shade);
    pt(0.3, -0.85, 0.12); U.push(0, 0.3); C.push(shade * 0.9, shade * 0.9, shade * 0.9);
    pt(0.3, 0.85, 0.12); U.push(1, 0.3); C.push(shade * 0.9, shade * 0.9, shade * 0.9);
    pt(0.4, 0, 0.02); U.push(0.5, 0.4); C.push(shade, shade, shade);
    pt(0.7, -0.6, 0.06); U.push(0.1, 0.7); C.push(shade * 0.95, shade * 0.95, shade * 0.95);
    pt(0.7, 0.6, 0.06); U.push(0.9, 0.7); C.push(shade * 0.95, shade * 0.95, shade * 0.95);
    pt(1, 0, -0.08); U.push(0.5, 1); C.push(shade, shade, shade);
    I.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 1, base + 4, base + 3, base + 3, base + 5, base + 2, base + 4, base + 6, base + 3, base + 3, base + 6, base + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

// The template set. Phone tier gets fewer, simpler trees (the instancing and LOD are in world.js).
export function makeTemplates(q) {
  const list = [];
  const add = (kind, n) => { for (let i = 0; i < n; i++) list.push(growTree(kind, kind.length * 101 + i * 17 + 5)); };
  add('giant', q < 0.6 ? 1 : 2);
  add('old', q < 0.6 ? 2 : 3);
  add('smooth', 2);
  add('sapling', 2);
  return list;
}
