// The mountain stream: one model shared by the boat physics (JS) and the water/bed shaders (GLSL, see STREAM_GLSL).
// It flows along +z forever. The centreline meanders, the water steps down in small drops every STEP metres,
// and each drop has a run of rapids. Rocks are generated per chunk from a seed, so the stream never ends.

export const CHUNK = 12;
export const STEP = 16;
export const DROP = 0.28;

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mod = (a, n) => a - n * Math.floor(a / n);

export const cx = (z) => 1.4 * Math.sin(z * 0.045) + 0.7 * Math.sin(z * 0.11 + 1.3);
export const dcx = (z) => 1.4 * 0.045 * Math.cos(z * 0.045) + 0.7 * 0.11 * Math.cos(z * 0.11 + 1.3);
export const halfW = (z) => 1.5 + 0.35 * Math.sin(z * 0.07 + 0.5) + 0.2 * Math.sin(z * 0.19) + 0.07 * Math.sin(z * 0.93 + 2) + 0.04 * Math.sin(z * 2.3);
export const level = (z) => -0.035 * z - DROP * (Math.floor(z / STEP) + ss(STEP - 1.1, STEP, mod(z, STEP)));
export function rapid(z) {
  const m = mod(z, STEP);
  return Math.max(ss(12.2, 15.3, m) * (1 - ss(15.85, 16, m)), 1 - ss(0, 3.2, m));
}
// depth of the bed below the water surface, across the channel
export function depth(z, u) {
  const d0 = 0.34 - 0.16 * rapid(z);
  return d0 * Math.pow(Math.max(0, 1 - u * u), 0.6);
}

// cheap value noise for terrain
function h2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ground height everywhere: the stream bed inside the channel, banks rising outside it, a forest floor beyond
export function terrain(x, z) {
  const dx = x - cx(z), w = halfW(z), L = level(z);
  const a = Math.abs(dx);
  if (a < w) return L - depth(z, dx / w) - (vnoise(x * 3, z * 3) - 0.5) * 0.03;
  const e = a - w;
  const bank = Math.min(e, 0.9) * 0.55 + Math.max(0, e - 0.9) * 0.16;
  return L + bank * (0.8 + 0.4 * vnoise(x * 0.4, z * 0.4)) + (vnoise(x * 1.3, z * 1.3) - 0.5) * 0.12 * Math.min(1, e * 2);
}

// ---------- rocks ----------
function rng(seed) { let s = (Math.abs(seed) * 9301 + 49297) % 233280 || 1; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
const rockCache = new Map();
export function chunkRocks(k) {
  if (rockCache.has(k)) return rockCache.get(k);
  const r = rng(k * 7919 + 13), list = [];
  const z0 = k * CHUNK;
  const add = (x, z, rad, sink, inStream) => {
    const L = level(z);
    const yc = inStream ? terrain(x, z) + rad * (1 - sink) : terrain(x, z) + rad * (0.35 - sink * 0.3);
    const top = yc + rad * 0.8;
    // radius at the waterline (for collisions and flow)
    const dy = L - yc;
    const rw = Math.abs(dy) < rad * 0.8 ? Math.sqrt(Math.max(0, rad * rad * 0.64 - dy * dy)) * 1.15 : 0;
    list.push({ x, z, r: rad, y: yc, top, rw, inStream, rot: r() * 6.28, tilt: r() * 0.5, v: Math.floor(r() * 3), sx: 0.85 + r() * 0.4, sy: 0.55 + r() * 0.3 });
  };
  if (k >= 0) {
    // scattered stones in the stream, more at the drops where the water tumbles over them
    const n = 4 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const z = z0 + r() * CHUNK;
      if (z < 3) continue;
      const w = halfW(z), u = (r() * 2 - 1) * 0.85;
      add(cx(z) + u * w, z, 0.1 + r() * 0.24, 0.35 + r() * 0.4, true);
    }
    for (let s = Math.ceil(z0 / STEP) * STEP; s < z0 + CHUNK; s += STEP) {
      const m = 3 + Math.floor(r() * 3);
      for (let i = 0; i < m; i++) {
        const z = s - 0.4 + r() * 0.9, w = halfW(z), u = (r() * 2 - 1) * 0.95;
        if (Math.abs(u) < 0.22 && r() < 0.7) continue; // keep a chute open in the middle
        add(cx(z) + u * w, z, 0.16 + r() * 0.26, 0.2 + r() * 0.3, true);
      }
    }
  }
  // boulders along the banks, half buried
  for (let i = 0; i < 14; i++) {
    const z = z0 + r() * CHUNK, w = halfW(z), side = r() < 0.5 ? -1 : 1;
    add(cx(z) + side * (w + 0.05 + Math.pow(r(), 1.5) * 3.5), z, 0.12 + Math.pow(r(), 2) * 0.55, 0.3 + r() * 0.3, false);
  }
  // small stones along the waterline, half in and half out of the water
  for (let i = 0; i < 22; i++) {
    const z = z0 + r() * CHUNK, w = halfW(z), side = r() < 0.5 ? -1 : 1;
    add(cx(z) + side * (w - 0.12 + r() * 0.35), z, 0.04 + Math.pow(r(), 2) * 0.12, 0.35 + r() * 0.3, false);
  }
  rockCache.set(k, list);
  if (rockCache.size > 40) rockCache.delete(rockCache.keys().next().value);
  return list;
}
export function rocksNear(z) {
  const k = Math.floor(z / CHUNK);
  return [...chunkRocks(k - 1), ...chunkRocks(k), ...chunkRocks(k + 1)];
}

// ---------- water surface and flow ----------
// waves: standing waves in rapids, a pillow upstream of each rock and a dip in its lee, plus a gentle wobble
export function waterH(x, z, t, rocks) {
  const R = rapid(z);
  let h = level(z);
  h += R * 0.018 * Math.sin(x * 9 + z * 4) * Math.sin(z * 7.3 - t * 0.6);
  h += 0.004 * Math.sin(x * 3.1 + z * 2.3 + t * 1.7) + 0.003 * Math.sin(x * -2.3 + z * 4.1 - t * 2.3);
  if (rocks) for (const k of rocks) {
    if (!k.inStream || k.rw <= 0) continue;
    const dx = x - k.x, dz = z - k.z, d2 = dx * dx + dz * dz, R2 = k.rw * k.rw * 4;
    if (d2 > R2 * 4) continue;
    h += 0.03 * Math.exp(-((dz + k.rw * 0.9) ** 2 + dx * dx) / (k.rw * k.rw)) - 0.02 * Math.exp(-((dz - k.rw * 1.8) ** 2 + dx * dx * 1.5) / (k.rw * k.rw * 1.5));
  }
  return h;
}

export function flowAt(x, z, t, rocks) {
  const dz = 1, dxz = dcx(z);
  const inv = 1 / Math.hypot(dxz, dz);
  const ex = dxz * inv, ez = dz * inv;
  const w = halfW(z), u = Math.max(-1, Math.min(1, (x - cx(z)) / w));
  const sp = (0.42 + 0.95 * rapid(z)) * (1 - 0.6 * u * u);
  let vx = ex * sp + (-ez) * 0.07 * Math.sin(z * 0.6 + t * 0.4) * (1 - u * u);
  let vz = ez * sp + ex * 0.07 * Math.sin(z * 0.6 + t * 0.4) * (1 - u * u);
  // banks push the water back toward the middle
  vx += -u * Math.max(0, Math.abs(u) - 0.8) * 0.8 * Math.sign(1);
  if (rocks) for (const k of rocks) {
    if (!k.inStream || k.rw <= 0) continue;
    const px = x - k.x, pz = z - k.z;
    const d2 = px * px + pz * pz, Rr = k.rw + 0.04;
    if (d2 > Rr * Rr * 25) continue;
    // potential flow round a cylinder, in the frame of the local flow direction
    const a = px * ex + pz * ez, b = px * -ez + pz * ex; // along, across
    const r2 = Math.max(d2, Rr * Rr * 0.8), R2 = Rr * Rr;
    const ua = sp * (1 - R2 * (a * a - b * b) / (r2 * r2)) - sp;
    const ub = -sp * 2 * R2 * a * b / (r2 * r2);
    let fa = ua, fb = ub;
    // eddy in the lee: the water curls back and turns
    if (a > 0 && a < Rr * 4 && Math.abs(b) < Rr * 1.3) {
      const f = (1 - a / (Rr * 4)) * (1 - Math.abs(b) / (Rr * 1.3));
      fa += -sp * 1.25 * f;
      fb += Math.sign(b || 1) * sp * 0.6 * f * Math.sin(a / Rr * 2);
    }
    vx += fa * ex + fb * -ez;
    vz += fa * ez + fb * ex;
  }
  return [vx, vz];
}

// the same model in GLSL, for the water and the bed
export const STREAM_GLSL = `
const float STEP=${STEP.toFixed(2)}; const float DROP=${DROP.toFixed(3)};
float sm(float a,float b,float x){float t=clamp((x-a)/(b-a),0.,1.);return t*t*(3.-2.*t);}
float cxF(float z){return 1.4*sin(z*.045)+.7*sin(z*.11+1.3);}
float dcxF(float z){return 1.4*.045*cos(z*.045)+.7*.11*cos(z*.11+1.3);}
float halfWF(float z){return 1.5+.35*sin(z*.07+.5)+.2*sin(z*.19)+.07*sin(z*.93+2.)+.04*sin(z*2.3);}
float levelF(float z){float m=mod(z,STEP);return -.035*z-DROP*(floor(z/STEP)+sm(STEP-1.1,STEP,m));}
float rapidF(float z){float m=mod(z,STEP);return max(sm(12.2,15.3,m)*(1.-sm(15.85,16.,m)),1.-sm(0.,3.2,m));}
`;
