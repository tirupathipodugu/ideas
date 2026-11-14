// The endless forest stream, built in 12 m chunks ahead of the boat and recycled behind it.
// Each chunk slot owns its terrain and water meshes and one instanced mesh per plant type, so a chunk
// is rebuilt by refilling buffers, and chunks behind the camera are culled by their bounding spheres.
import * as THREE from '../vendor/three/three.module.js';
import { CHUNK, cx, halfW, level, terrain, chunkRocks, vnoise } from './stream.js';
import * as M from './materials.js';
import * as G from './plants.js';
import { makeTemplates } from './trees.js';
import { sprayGeo, leafMat } from './leaves.js';

export const SLOTS = 6;

// per-chunk instance budgets at full quality; the low tier scales them
const BUDGET = { grass: 20000, fern: 760, daisy: 2600, blue: 2000, rosette: 260, ivy: 900, moss: 5000, shrub: 700, log: 2 };
// trees per chunk by kind, and leaf sprays per chunk (all species together)
const TREES = { giant: 1, old: 3, smooth: 3, sapling: 4 };

function rng(seed) { let s = (Math.abs(seed) * 9301 + 49297) % 233280 || 7; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + (vnoise(x * 1.7 + seed, z * 1.7 + y) - 0.5) * 0.35 + (vnoise(x * 4 + seed * 3, y * 4 + z) - 0.5) * 0.12;
    x *= n; y *= n; z *= n;
    if (y < -0.35) y = -0.35 + (y + 0.35) * 0.3; // flattened base
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  // the icosphere is unindexed, so average the normals of coincident vertices for a smooth, rounded stone
  const nrm = g.attributes.normal, acc = new Map();
  const key = (i) => p.getX(i).toFixed(4) + ',' + p.getY(i).toFixed(4) + ',' + p.getZ(i).toFixed(4);
  for (let i = 0; i < p.count; i++) { const k = key(i); const a = acc.get(k) || [0, 0, 0]; a[0] += nrm.getX(i); a[1] += nrm.getY(i); a[2] += nrm.getZ(i); acc.set(k, a); }
  for (let i = 0; i < p.count; i++) { const a = acc.get(key(i)); const l = Math.hypot(a[0], a[1], a[2]) || 1; nrm.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  return g;
}

function trunkGeo() {
  const g = new THREE.CylinderGeometry(0.7, 1, 1, 14, 6, true);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.06 * Math.sin(a * 5 + y * 3) + 0.04 * Math.sin(a * 11);
    const bend = 0.08 * Math.sin(y * 2.2);
    p.setXYZ(i, x * k + bend, y, z * k);
  }
  g.computeVertexNormals();
  return g;
}

export class World {
  constructor(scene, quality) {
    this.scene = scene;
    this.q = quality; // 1 = full, ~0.4 = phone tier
    this.slots = [];
    this.loaded = new Map();
    this.mats = {
      ground: M.groundMat(), water: M.waterMat(), rock: M.rockMat(), bark: M.barkMat(),
      grass: M.foliageMat({ bend: 0.9, geoH: 1, aoBase: 0.18, trans: 0.6, up: 0.45 }),
      fern: M.foliageMat({ bend: 0.25, geoH: 0.3, aoBase: 0.35, trans: 0.45, up: 0.3 }),
      daisy: M.foliageMat({ bend: 1.4, geoH: 0.2, aoBase: 0.45, trans: 0.35, up: 0.55 }),
      blue: M.foliageMat({ bend: 1.4, geoH: 0.16, aoBase: 0.45, trans: 0.35, up: 0.5 }),
      rosette: M.foliageMat({ bend: 0.3, geoH: 0.06, aoBase: 0.4, trans: 0.4, up: 0.3 }),
      ivy: M.foliageMat({ bend: 0.05, geoH: 1, aoBase: 0.8, trans: 0.35, up: 0.15, leaf: true }),
      moss: M.foliageMat({ bend: 0.0, geoH: 1, aoBase: 0.35, trans: 0.7, up: 0.6 }),
      tree: M.treeMat(), far: M.farMat(), leaf: leafMat({ sway: 0.06 }), shrub: leafMat({ sway: 0.025 }),
    };
    this.geos = {
      grass: G.grassClump(), leaf: G.leafGeo('ovate'), fern: G.fernFrond(), daisy: G.daisy(), blue: G.blueFlowers(), rosette: G.rosette(), ivy: G.leafGeo('heart'),
      rocks: [rockGeo(1), rockGeo(7), rockGeo(13)],
      sprays: [0, 1, 2, 3].map((sp) => sprayGeo(sp, 1, quality < 0.6 ? 8 : 11)),
      far: (() => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); return g; })(),
      log: (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 12, 4, false); g.rotateZ(Math.PI / 2); return g; })(),
    };
    this.templates = makeTemplates(quality);
    this.byKind = {};
    this.templates.forEach((t, i) => { (this.byKind[t.kind] ||= []).push(i); });
    const SPECIES = { giant: 0, old: 1, smooth: 2, sapling: 3 };
    this.species = this.templates.map((t) => SPECIES[t.kind]);
    // leaf sprays a chunk may need, per species, from the trees it can hold
    this.leafCap = [0, 0, 0, 0];
    for (const [kind, n] of Object.entries(TREES)) { const ids = this.byKind[kind]; const most = Math.max(...ids.map((i) => this.templates[i].clusters.length)); this.leafCap[SPECIES[kind]] += Math.ceil(n * most * (kind === 'giant' ? 2 : 1) * 1.1); }
    const TERR_X = 56, TERR_Z = 40, WAT_X = 22, WAT_Z = 60;
    this.tdim = [TERR_X, TERR_Z]; this.wdim = [WAT_X, WAT_Z];
    for (let s = 0; s < SLOTS; s++) {
      const slot = { k: null, inst: {} };
      slot.ground = new THREE.Mesh(this.grid(TERR_X, TERR_Z), this.mats.ground);
      slot.water = new THREE.Mesh(this.grid(WAT_X, WAT_Z), this.mats.water);
      slot.water.renderOrder = 2;
      slot.ground.frustumCulled = slot.water.frustumCulled = true;
      scene.add(slot.ground, slot.water);
      const mk = (name, geo, mat, cap, color = true) => {
        const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
        if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3).fill(1), 3);
        m.count = 0;
        scene.add(m);
        slot.inst[name] = m;
      };
      const c = (n) => Math.ceil(BUDGET[n] * (n === 'log' ? 1 : n === 'shrub' ? Math.max(0.55, this.q) : this.q));
      mk('grass', this.geos.grass, this.mats.grass, c('grass'));
      mk('fern', this.geos.fern, this.mats.fern, c('fern'));
      mk('daisy', this.geos.daisy, this.mats.daisy, c('daisy'));
      mk('blue', this.geos.blue, this.mats.blue, c('blue'));
      mk('rosette', this.geos.rosette, this.mats.rosette, c('rosette'));
      mk('ivy', this.geos.ivy, this.mats.ivy, c('ivy'));
      mk('moss', this.geos.grass, this.mats.moss, c('moss'));
      this.templates.forEach((t, i) => mk('tree' + i, t.geo, this.mats.tree, (TREES[t.kind] + (t.kind === 'giant' ? 1 : 0)) * 2));
      for (let sp = 0; sp < 4; sp++) mk('leaf' + sp, this.geos.sprays[sp], this.mats.leaf, this.leafCap[sp]);
      mk('shrubA', this.geos.sprays[0], this.mats.shrub, c('shrub'));
      mk('shrubB', this.geos.sprays[3], this.mats.shrub, c('shrub'));
      mk('far', this.geos.far, this.mats.far, 48);
      this.geos.rocks.forEach((g, i) => mk('rock' + i, g, this.mats.rock, 60));
      mk('log', this.geos.log, this.mats.bark, c('log'));
      this.slots.push(slot);
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }

  grid(nx, nz) {
    const g = new THREE.PlaneGeometry(1, 1, nx - 1, nz - 1);
    g.rotateX(-Math.PI / 2);
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    return g;
  }

  // keep chunks k0-1 .. k0+4 built around the boat
  update(z) {
    const k0 = Math.floor(z / CHUNK);
    for (let k = k0 - 1; k <= k0 + SLOTS - 2; k++) {
      const s = ((k % SLOTS) + SLOTS) % SLOTS;
      if (this.slots[s].k !== k) { this.build(this.slots[s], k); return true; } // one chunk per frame
    }
    return false;
  }
  buildAll(z) { while (this.update(z)) { /* fill all slots */ } }

  build(slot, k) {
    slot.k = k;
    const z0 = k * CHUNK, r = rng(k * 131 + 7);
    // ground
    {
      const [nx, nz] = this.tdim, p = slot.ground.geometry.attributes.position;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const z = z0 + j / (nz - 1) * CHUNK;
        const s = i / (nx - 1) * 2 - 1;
        const w = halfW(z);
        const a = Math.abs(s);
        // dense columns across the channel, coarser out in the forest
        const off = a < 0.5 ? (a / 0.5) * (w + 0.6) : (w + 0.6) + Math.pow((a - 0.5) / 0.5, 1.4) * 13;
        const x = cx(z) + Math.sign(s) * off;
        p.setXYZ(j * nx + i, x, terrain(x, z), z);
      }
      p.needsUpdate = true;
      slot.ground.geometry.computeVertexNormals();
      slot.ground.geometry.computeBoundingSphere();
    }
    // water ribbon
    {
      const [nx, nz] = this.wdim, p = slot.water.geometry.attributes.position;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const z = z0 + j / (nz - 1) * CHUNK, w = halfW(z) + 0.35;
        const x = cx(z) + (i / (nx - 1) * 2 - 1) * w;
        p.setXYZ(j * nx + i, x, level(z), z);
      }
      p.needsUpdate = true;
      slot.water.geometry.computeBoundingSphere();
      slot.water.geometry.boundingSphere.radius += 0.5;
    }
    const center = new THREE.Vector3(cx(z0 + CHUNK / 2), level(z0 + CHUNK / 2), z0 + CHUNK / 2);
    const sphere = new THREE.Sphere(center.clone().add(new THREE.Vector3(0, 6, 0)), 34); // tall trees and their crowns
    const I = slot.inst;
    const put = (mesh, idx, pos, rx, ry, rz, sx, sy, sz, col) => {
      this._e.set(rx, ry, rz, 'YXZ');
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(pos[0], pos[1], pos[2]), this._q, this._s.set(sx, sy, sz));
      mesh.setMatrixAt(idx, this._m);
      if (col) mesh.setColorAt(idx, this._c.setRGB(col[0], col[1], col[2]));
    };
    const finish = (mesh, n) => {
      mesh.count = Math.min(n, mesh.instanceMatrix.count);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.boundingSphere = sphere;
    };

    // rocks
    const rocks = chunkRocks(k);
    const rc = [0, 0, 0];
    for (const rk of rocks) {
      const v = rk.v, mesh = I['rock' + v];
      if (rc[v] >= mesh.instanceMatrix.count) continue;
      const g = 0.85 + r() * 0.3;
      put(mesh, rc[v]++, [rk.x, rk.y, rk.z], rk.tilt * 0.3, rk.rot, rk.tilt * 0.2, rk.r, rk.r * 0.8, rk.r * 1.05, [g, g * (0.97 + r() * 0.05), g * 0.95]);
    }
    for (let v = 0; v < 3; v++) finish(I['rock' + v], rc[v]);
    const bankRocks = rocks.filter((x) => !x.inStream);
    const inRock = (x, z) => bankRocks.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < (b.r * 0.85) ** 2);

    // a point on the bank, e metres from the water's edge
    const bank = (e) => {
      const z = z0 + r() * CHUNK, side = r() < 0.5 ? -1 : 1;
      const x = cx(z) + side * (halfW(z) + e);
      return [x, terrain(x, z), z, side];
    };

    // Trees: one huge old tree right at the water with roots running in, older trees and smooth-barked
    // ones behind it, saplings in the gaps, and more trees further back. Each is a grown template, turned
    // so its reaching limbs and longest roots face the stream.
    const trees = [];
    slot.trees = [];
    const tcount = this.templates.map(() => 0);
    const lcount = [0, 0, 0, 0];
    const Mt = new THREE.Matrix4(), Ml = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), P = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Vector3();
    const placeTree = (kind, e, sideWant) => {
      const ids = this.byKind[kind];
      const ti = ids[Math.floor(r() * ids.length)];
      const mesh = I['tree' + ti];
      if (tcount[ti] >= mesh.instanceMatrix.count) return;
      let x, y, z, side;
      for (let tries = 0; tries < 6; tries++) { [x, y, z, side] = bank(e); if (sideWant) { side = sideWant; x = cx(z) + side * (halfW(z) + e); y = terrain(x, z); } if (!inRock(x, z)) break; }
      const tpl = this.templates[ti];
      const yaw = (side > 0 ? Math.PI : 0) + (r() - 0.5) * 0.7;
      const sc = kind === 'sapling' ? 0.7 + r() * 0.6 : 0.85 + r() * 0.3;
      E.set(0, yaw, 0); Q.setFromEuler(E);
      Mt.compose(P.set(x, y - 0.05, z), Q, S.set(sc, sc, sc));
      mesh.setMatrixAt(tcount[ti], Mt);
      const tint = 0.8 + r() * 0.4;
      mesh.setColorAt(tcount[ti]++, this._c.setRGB(tint, tint * (0.95 + r() * 0.08), tint * (0.88 + r() * 0.1)));
      trees.push([x, y, z, tpl.R * sc, side]);
      // lowest leaves (on the reaching limbs) in world space, for close-up checks
      let low = null;
      for (const cl of tpl.clusters) if (!low || cl[1] < low[1]) low = cl;
      if (low) { const v = new THREE.Vector3(low[0], low[1], low[2]).applyMatrix4(Mt); slot.trees.push({ kind, x, y, z, R: tpl.R * sc, side, low: [v.x, v.y, v.z] }); }
      // leaf sprays at every cluster point, pointing out from the crown, a second layer on the big trees
      const sp = this.species[ti], lm = I['leaf' + sp];
      const layers = kind === 'giant' ? 2 : 1;
      for (const cl of tpl.clusters) for (let L = 0; L < layers; L++) {
        if (lcount[sp] >= lm.instanceMatrix.count) break;
        const out = Math.atan2(cl[0], cl[2]) + (r() - 0.5) * 1.2 + L * 2.2;
        E.set(-0.25 + (r() - 0.5) * 0.9, out, (r() - 0.5) * 0.6); Q.setFromEuler(E);
        const s = (1.0 + r() * 0.5) * cl[3];
        Ml.compose(C.set(cl[0], cl[1], cl[2]), Q, S.set(s, s, s));
        Ml.premultiply(Mt);
        lm.setMatrixAt(lcount[sp], Ml);
        const g = cl[6] * (0.85 + r() * 0.3);
        lm.setColorAt(lcount[sp]++, this._c.setRGB(g * (0.9 + r() * 0.2), g, g * (0.85 + r() * 0.2)));
      }
    };
    const near = k % 2 ? 1 : -1;
    placeTree('giant', 0.15 + r() * 0.45, near);
    for (let i = 0; i < TREES.old; i++) placeTree('old', i === 0 ? 0.3 + r() * 1.2 : 1.5 + r() * 8, i === 0 ? -near : 0);
    for (let i = 0; i < TREES.smooth; i++) placeTree('smooth', 0.6 + r() * 7, 0);
    for (let i = 0; i < TREES.sapling; i++) placeTree('sapling', 0.4 + r() * 4, 0);
    this.templates.forEach((t, i) => finish(I['tree' + i], tcount[i]));
    for (let sp = 0; sp < 4; sp++) finish(I['leaf' + sp], lcount[sp]);
    let ni = 0;

    // undergrowth: leafy shrubs of radiating sprays at knee and waist height
    for (const key of ['shrubA', 'shrubB']) {
      const m = I[key], cap = m.instanceMatrix.count; let n = 0;
      while (n < cap - 14) {
        const [x0, y0, z0s] = bank(0.3 + Math.pow(r(), 1.2) * 6);
        const nsp = 9 + Math.floor(r() * 6), h = 0.15 + r() * 0.5;
        const tint = 0.75 + r() * 0.4;
        for (let j = 0; j < nsp; j++) {
          E.set(-0.5 - r() * 0.7, r() * 6.28, (r() - 0.5) * 0.6); Q.setFromEuler(E);
          const s = 0.7 + r() * 0.6;
          Ml.compose(C.set(x0 + (r() - 0.5) * 0.15, y0 + h * r() * 0.6, z0s + (r() - 0.5) * 0.15), Q, S.set(s, s, s));
          m.setMatrixAt(n, Ml); m.setColorAt(n++, this._c.setRGB(tint * (0.85 + r() * 0.3), tint, tint * (0.8 + r() * 0.3)));
        }
      }
      finish(m, n);
    }

    // the forest beyond: painted trees in layers, receding into the mist
    {
      const m = I.far; let n = 0;
      while (n < m.instanceMatrix.count) {
        const e = 13 + Math.pow(r(), 0.8) * 30, [x, y, z] = bank(e);
        const h = 11 + r() * 9, wdt = h * (0.35 + r() * 0.2);
        Ml.compose(C.set(x, y - 0.3, z), Q.identity(), S.set(wdt, h, 1));
        m.setMatrixAt(n, Ml); m.setColorAt(n++, this._c.setRGB(1, 1, 1));
      }
      finish(m, n);
    }
    // ivy and leaves draped over the bank boulders
    for (const b of bankRocks) {
      for (let j = 0; j < 26 && ni < I.ivy.instanceMatrix.count; j++) {
        const th = r() * 6.28, ph = r() * 1.1;
        const nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
        const s = 0.025 + r() * 0.02;
        put(I.ivy, ni++, [b.x + nx * b.r * 1.02, b.y + ny * b.r * 0.82, b.z + nz * b.r * 1.07], -0.4 - ph * 0.8, -th + Math.PI / 2 + (r() - 0.5), (r() - 0.5) * 0.6, s, s, s, [0.05 + r() * 0.06, 0.11 + r() * 0.09, 0.02 + r() * 0.03]);
      }
    }
    finish(I.ivy, ni);

    // fallen logs
    let nl = 0;
    const logs = [];
    for (let j = 0; j < 2; j++) if (r() < 0.75) {
      const [x, y, z] = bank(0.6 + r() * 4);
      const len = 2 + r() * 3, rad = 0.14 + r() * 0.14, yaw = r() * 6.28;
      put(I.log, nl++, [x, y + rad * 0.6, z], 0, yaw, (r() - 0.5) * 0.1, len, rad, rad, [0.85, 0.8, 0.75]);
      logs.push([x, y + rad * 0.6, z, rad, len, yaw]);
    }
    finish(I.log, nl);

    // moss: a fuzz of tiny tufts over boulder tops, logs and the wet ground at the water's edge
    {
      const m = I.moss, cap = m.instanceMatrix.count; let n = 0;
      const tuft = (x, y, z, tilt) => { const h = 0.012 + r() * 0.022, wsc = 0.35 + r() * 0.3; put(m, n++, [x, y, z], (r() - 0.5) * tilt, r() * 6.28, (r() - 0.5) * tilt, wsc, h, wsc, [0.75 + r() * 0.5, 0.85 + r() * 0.4, 0.45 + r() * 0.3]); };
      for (const b of bankRocks) for (let j = 0; j < Math.min(260, b.r * 900) && n < cap * 0.45; j++) {
        const th = r() * 6.28, ph = Math.acos(1 - r() * 0.9);
        tuft(b.x + Math.sin(ph) * Math.cos(th) * b.r, b.y + Math.cos(ph) * b.r * 0.8, b.z + Math.sin(ph) * Math.sin(th) * b.r * 1.05, ph * 1.2);
      }
      for (const [x, y, z, rad, len, yaw] of logs) for (let j = 0; j < 260 && n < cap * 0.65; j++) {
        const t = (r() - 0.5) * len, a = (r() - 0.5) * 1.6;
        tuft(x + Math.cos(yaw) * t + Math.sin(a) * rad * Math.sin(yaw), y + Math.cos(a) * rad, z - Math.sin(yaw) * t + Math.sin(a) * rad * Math.cos(yaw), a);
      }
      while (n < cap) { const e = Math.pow(r(), 2) * 1.2 - 0.02; const [x, y, z] = bank(Math.max(0.01, e)); tuft(x, y, z, 0.3); }
      finish(m, n);
    }

    // grass: fine and dense right at the water's edge, giving way to ferns and leaf litter under the trees
    {
      const m = I.grass; let n = 0;
      const cap = m.instanceMatrix.count;
      for (let i = 0; i < cap * 1.3 && n < cap; i++) {
        const e = r() < 0.9 ? 0.02 + Math.pow(r(), 1.8) * 1.8 : 1.8 + r() * 2.2;
        const [x, y, z] = bank(e);
        if (inRock(x, z)) continue;
        const h = (0.09 + r() * 0.2) * (e < 0.25 ? 0.75 : 1);
        const tone = r();
        const col = tone < 0.1 ? [1.3, 1.1, 0.55] : tone < 0.35 ? [0.75, 0.98, 0.8] : tone < 0.5 ? [0.62, 0.78, 0.5] : [0.85 + r() * 0.3, 0.88 + r() * 0.3, 0.7 + r() * 0.25];
        const wsc = 0.7 + r() * 0.5;
        put(m, n++, [x, y - 0.01, z], (r() - 0.5) * 0.3, r() * 6.28, (r() - 0.5) * 0.3, wsc, h, wsc, col);
      }
      finish(m, n);
    }    // ferns: rosettes of fronds on the banks and at tree feet
    {
      const m = I.fern; let n = 0;
      while (n < m.instanceMatrix.count - 8) {
        let x, y, z;
        if (trees.length && r() < 0.35) { const t = trees[Math.floor(r() * trees.length)]; const a = r() * 6.28; x = t[0] + Math.cos(a) * (t[3] + 0.2); z = t[2] + Math.sin(a) * (t[3] + 0.2); y = terrain(x, z); }
        else [x, y, z] = bank(0.25 + Math.pow(r(), 1.3) * 5);
        const sc = 0.45 + r() * 0.55, yaw0 = r() * 6.28, fr = 6 + Math.floor(r() * 4);
        const tint = [0.8 + r() * 0.35, 0.9 + r() * 0.25, 0.7 + r() * 0.3];
        for (let f = 0; f < fr; f++) put(m, n++, [x, y, z], -0.35 + r() * 0.5, yaw0 + f / fr * 6.28 + (r() - 0.5) * 0.4, (r() - 0.5) * 0.3, sc * (0.8 + r() * 0.3), sc, sc * (0.8 + r() * 0.3), tint);
      }
      finish(m, n);
    }
    // wildflowers in drifts
    const drift = (mesh, clusterN, spread, emax, colFn, scl) => {
      let n = 0;
      const cap = mesh.instanceMatrix.count;
      const per = Math.ceil(cap / clusterN);
      for (let c = 0; c < clusterN && n < cap; c++) {
        const [x0, , z0c, side] = bank(0.05 + Math.pow(r(), 1.4) * emax);
        for (let j = 0; j < per && n < cap; j++) {
          const x = x0 + (r() - 0.5) * spread, z = z0c + (r() - 0.5) * spread * 1.6;
          const dx = (x - cx(z)) * side - halfW(z);
          if (dx < 0.04 || inRock(x, z)) continue;
          const sc = scl[0] + r() * scl[1];
          put(mesh, n++, [x, terrain(x, z) - 0.005, z], (r() - 0.5) * 0.35, r() * 6.28, (r() - 0.5) * 0.35, sc, sc, sc, colFn());
        }
      }
      finish(mesh, n);
    };
    drift(I.daisy, 60, 0.7, 1.8, () => { const v = 0.92 + r() * 0.12; return [v, v, v]; }, [0.42, 0.28]);
    drift(I.blue, 55, 0.6, 1.8, () => (r() < 0.3 ? [0.95, 0.75, 1.1] : [0.8 + r() * 0.2, 0.85 + r() * 0.2, 1]), [0.45, 0.3]);
    drift(I.rosette, 30, 1.2, 4, () => [0.8 + r() * 0.4, 0.9 + r() * 0.3, 0.7 + r() * 0.3], [0.7, 0.8]);
    for (const key of Object.keys(I)) if (I[key].count === 0) I[key].boundingSphere = sphere;
  }

  // nearest rocks in the stream for the water shader (foam, standing waves)
  rockUniforms(z, out) {
    const list = [];
    const k0 = Math.floor(z / CHUNK);
    for (let k = k0 - 1; k <= k0 + 3; k++) for (const rk of chunkRocks(k)) if (rk.inStream && rk.rw > 0) list.push(rk);
    list.sort((a, b) => Math.abs(a.z - z - 4) - Math.abs(b.z - z - 4));
    for (let i = 0; i < out.length; i++) {
      const rk = list[i];
      if (rk) out[i].set(rk.x, rk.z, rk.rw, 0); else out[i].set(0, 0, 0, 0);
    }
  }

  setDensity(d) { M.shared.uDensity.value = d; }
}
