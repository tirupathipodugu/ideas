// The paper boat and how it rides the stream. Fixed 1/120 s steps, so it behaves the same at 20 or 60 fps.
//  - The water carries it: drag toward the local flow is light along the hull and strong sideways (keel-like),
//    so it moves along where its nose points relative to the water.
//  - Heading has inertia: the current turns it to follow the flow, the shear across eddies spins it,
//    steering adds a gentle torque; a damped spring gives a little lag and overshoot before it settles.
//  - Heave, pitch and roll follow the actual water surface under bow, stern and both sides (the same
//    function the water shader draws), through springs, plus a bow dip when it speeds up, an outward lean
//    in turns, and soft knocks when it hits a rock or the bank.
import * as THREE from '../vendor/three/three.module.js';
import { paperBoat } from './geom.js';
import { paperMat, shared } from './materials.js';
import { flowAt, waterH, cx, dcx, halfW, level, rapid, chunkRocks, CHUNK } from './stream.js';

export const BOAT_SCALE = 1.75;
export const DT = 1 / 120;
const HL = 0.135 * BOAT_SCALE / 1.3; // half length used for sampling the surface
const HB = 0.06;                      // half beam at the waterline

export class Boat {
  constructor(scene) {
    const d = paperBoat();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(d.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    g.setAttribute('bar', new THREE.BufferAttribute(d.bar, 3));
    this.mat = paperMat();
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.scale.setScalar(BOAT_SCALE);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.bumps = [];
    this.reset(3);
  }

  reset(z) {
    this.x = cx(z); this.z = z;
    const a = Math.atan2(dcx(z), 1);
    this.vx = Math.sin(a) * 0.3; this.vz = Math.cos(a) * 0.3;
    this.yaw = a; this.r = 0;
    this.heave = level(z); this.hv = 0; this.pitch = 0; this.pv = 0; this.roll = 0; this.rv = 0;
    this.accF = 0; this.lastU = 0; this.age = 0;
    this.rk = null; this.rkK = null;
  }

  rocks() {
    const k = Math.floor(this.z / CHUNK);
    if (this.rkK !== k) { this.rkK = k; this.rk = [...chunkRocks(k - 1), ...chunkRocks(k), ...chunkRocks(k + 1)].filter((r) => r.inStream); }
    return this.rk;
  }

  step(t, steer) {
    const dt = DT, rocks = this.rocks();
    const fw = [Math.sin(this.yaw), Math.cos(this.yaw)];
    const rt = [-fw[1], fw[0]]; // starboard / screen-right when seen from behind
    const [fx, fz] = flowAt(this.x, this.z, t, rocks);
    const bow = flowAt(this.x + fw[0] * HL, this.z + fw[1] * HL, t, rocks);
    const stern = flowAt(this.x - fw[0] * HL, this.z - fw[1] * HL, t, rocks);

    // drag toward the water's velocity: light along the hull, strong across it
    const rvx = fx - this.vx, rvz = fz - this.vz;
    const rf = rvx * fw[0] + rvz * fw[1], rs = rvx * rt[0] + rvz * rt[1];
    let ax = fw[0] * rf * 1.3 + rt[0] * rs * 5.0;
    let az = fw[1] * rf * 1.3 + rt[1] * rs * 5.0;
    // steering is a gentle paddle: it turns the nose (below) and pushes along it, never sideways
    const pad = Math.abs(steer) * 0.32;
    ax += fw[0] * pad; az += fw[1] * pad;

    // heading: follow the flow, spin with the shear, a gentle torque from steering
    const fa = Math.atan2(fx, fz);
    let da = fa - this.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
    const fsp = Math.hypot(fx, fz);
    const shear = ((bow[0] - stern[0]) * fw[1] - (bow[1] - stern[1]) * fw[0]) / (2 * HL);
    let torque = 2.6 * Math.sin(da) * Math.min(1, fsp * 2.2) * (1 - 0.6 * Math.abs(steer)) + shear * 0.9 - steer * 0.95;
    torque += Math.sin(t * 0.9 + this.z) * 0.12 + Math.sin(t * 2.3) * 0.06;
    this.r += (torque - 2.7 * this.r) * dt;

    this.vx += ax * dt; this.vz += az * dt;
    // slip: angle between the nose and the boat's motion through the water (kept small by the keel drag)
    const wx = this.vx - fx, wz = this.vz - fz;
    if (Math.hypot(wx, wz) > 0.02) { let s = Math.atan2(wx, wz) - this.yaw; this.slipW = Math.atan2(Math.sin(s), Math.cos(s)); } else this.slipW = 0;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.yaw += this.r * dt;

    // rocks: two circles along the hull against each rock's waterline circle
    for (const k of rocks) {
      if (k.rw <= 0) continue;
      for (const s of [1, -1]) {
        const px = this.x + fw[0] * 0.1 * s, pz = this.z + fw[1] * 0.1 * s;
        const dx = px - k.x, dz = pz - k.z, d = Math.hypot(dx, dz), min = k.rw + 0.07;
        if (d < min && d > 1e-5) {
          const nx = dx / d, nz = dz / d, pen = min - d;
          this.x += nx * pen; this.z += nz * pen;
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            this.vx -= 1.3 * vn * nx; this.vz -= 1.3 * vn * nz;
            // the knock spins it: lever arm along the hull crossed with the impulse
            const lx = fw[0] * 0.1 * s, lz = fw[1] * 0.1 * s;
            this.r += (lz * nx - lx * nz) * -vn * 40;
            this.rv += (nx * fw[1] - nz * fw[0]) * -vn * 6;
            this.pv += s * -vn * 3;
            this.bumps.push(Math.min(1, -vn * 3));
          }
        }
      }
    }
    // banks: keep it in the water, a soft knock
    const w = halfW(this.z), c = cx(this.z), u = (this.x - c) / w, lim = 1 - 0.12 / w;
    if (Math.abs(u) > lim) {
      const s = Math.sign(u);
      this.x = c + s * lim * w;
      if (this.vx * s > 0) {
        this.bumps.push(Math.min(1, Math.abs(this.vx) * 3));
        this.vx = -this.vx * 0.3; this.r += -s * 0.8 * Math.abs(this.vx) - s * 0.15;
        this.rv += -s * 0.6;
      }
    }

    // ride the surface
    const H = (a, b) => waterH(this.x + fw[0] * a + rt[0] * b, this.z + fw[1] * a + rt[1] * b, t, rocks);
    const hb = H(HL, 0), hs = H(-HL, 0), hr = H(0, HB), hl = H(0, -HB);
    const uF = this.vx * fw[0] + this.vz * fw[1];
    const acc = (uF - this.lastU) / dt; this.lastU = uF;
    this.accF += (acc - this.accF) * Math.min(1, dt * 6);
    const sp = Math.hypot(this.vx, this.vz);
    const R = rapid(this.z);
    const heaveT = (hb + hs + hr + hl) * 0.25 - 0.002;
    let pitchT = Math.atan2(hs - hb, 2 * HL) * 1.4 + Math.max(-0.05, Math.min(0.09, this.accF * 0.07)) + R * 0.05;
    let rollT = Math.atan2(hl - hr, 2 * HB) * 0.8 + Math.max(-0.2, Math.min(0.2, this.r * sp * 0.55));
    this.hv += (90 * (heaveT - this.heave) - 13 * this.hv) * dt; this.heave += this.hv * dt;
    this.pv += (55 * (pitchT - this.pitch) - 8 * this.pv) * dt; this.pitch += this.pv * dt;
    this.rv += (55 * (rollT - this.roll) - 7 * this.rv) * dt; this.roll += this.rv * dt;
    this.age += dt;
  }

  sync() {
    const m = this.mesh;
    m.position.set(this.x, this.heave, this.z);
    m.rotation.set(this.pitch, this.yaw, this.roll);
    this.mat.uniforms.uSoak.value = Math.min(1, this.age / 90);
    this.mat.uniforms.uWaterY.value = this.heave;
    shared.uBoat.value.set(this.x, this.z, this.yaw, BOAT_SCALE * 0.84);
  }
}
