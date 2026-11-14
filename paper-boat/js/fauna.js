// Life around the stream: leaves drifting on the current, butterflies over the banks, spray off the rocks
// in the rapids, and shafts of sunlight slanting through the mist.
import * as THREE from '../vendor/three/three.module.js';
import { flowAt, waterH, cx, halfW, terrain, rapid, chunkRocks, CHUNK } from './stream.js';
import { flyMat, sprayMat, shaftMat, shared } from './materials.js';
import { singleLeafGeo, leafMat } from './leaves.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Fauna {
  constructor(scene, q) {
    // drifting leaves
    this.NL = Math.round(40 * Math.max(0.5, q));
    // the same painted leaves as the trees: a yellowing lobed leaf and a nibbled heart-shaped one, flat on the water
    const lm = leafMat({ sway: 0, flutter: 0 });
    this.leafMeshes = [singleLeafGeo(1, 2), singleLeafGeo(3, 3), singleLeafGeo(0, 0)].map((g) => {
      const m = new THREE.InstancedMesh(g, lm, this.NL);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.NL * 3).fill(1), 3);
      m.frustumCulled = false; m.count = 0; scene.add(m); return m;
    });
    this.ls = [];
    for (let i = 0; i < this.NL; i++) {
      const v = 0.8 + Math.random() * 0.35;
      this.leafMeshes.forEach((m) => m.setColorAt(Math.floor(i / 3), new THREE.Color(v, v, v)));
      this.ls.push({ x: 0, z: -999, yaw: 0, spin: 0, s: 0.06 + Math.random() * 0.06 });
    }

    // butterflies
    this.NB = 6;
    const wing = new THREE.PlaneGeometry(2, 1.3, 2, 1); wing.rotateX(-Math.PI / 2);
    this.flies = new THREE.InstancedMesh(wing, flyMat(), this.NB);
    this.flies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.NB * 3), 3);
    for (let i = 0; i < this.NB; i++) this.flies.setColorAt(i, new THREE.Color(i % 3 === 2 ? 0 : 1, Math.random(), 0));
    this.flies.frustumCulled = false;
    this.bs = Array.from({ length: this.NB }, (_, i) => ({ ph: Math.random() * 100, side: i % 2 ? 1 : -1, ahead: 1.5 + i * 2.2, e: 0.3 + Math.random() * 1.5, h: 0.25 + Math.random() * 0.6 }));
    scene.add(this.flies);

    // spray: droplets thrown up where water breaks over rocks and in the rapids
    this.NS = Math.round(500 * Math.max(0.5, q));
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.NS * 3), 3));
    const seed = new Float32Array(this.NS * 4);
    for (let i = 0; i < this.NS * 4; i++) seed[i] = Math.random();
    sg.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.spray = new THREE.Points(sg, sprayMat());
    this.spray.frustumCulled = false;
    this.spray.renderOrder = 3;
    this.sprayK = null;
    scene.add(this.spray);

    // light shafts
    this.NH = 7;
    const pg = new THREE.PlaneGeometry(1, 1); pg.translate(0, 0.5, 0);
    this.shafts = new THREE.InstancedMesh(pg, shaftMat(), this.NH);
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 4;
    this.hs = Array.from({ length: this.NH }, (_, i) => ({ ahead: 3 + i * 4.3 + Math.random() * 2, off: (Math.random() - 0.5) * 6, w: 0.6 + Math.random() * 1.6 }));
    scene.add(this.shafts);
  }

  respawnLeaf(L, z0, far) {
    const z = z0 + (far ? 8 + Math.random() * 25 : Math.random() * 30);
    const w = halfW(z);
    L.x = cx(z) + (Math.random() * 2 - 1) * w * 0.85; L.z = z;
    L.yaw = Math.random() * 6.28; L.spin = (Math.random() - 0.5) * 0.8;
  }

  update(dt, t, boat, camPos) {
    // leaves
    for (let i = 0; i < this.NL; i++) {
      const L = this.ls[i];
      if (L.z < boat.z - 6 || L.z > boat.z + 40) this.respawnLeaf(L, boat.z, L.z !== -999);
      const [fx, fz] = flowAt(L.x, L.z, t, null);
      L.x += fx * dt; L.z += fz * dt;
      const w = halfW(L.z), c = cx(L.z);
      if (Math.abs(L.x - c) > w * 0.95) L.x = c + Math.sign(L.x - c) * w * 0.95;
      // bob around the boat
      const dx = L.x - boat.x, dz = L.z - boat.z, d = Math.hypot(dx, dz);
      if (d < 0.18 && d > 1e-4) { L.x = boat.x + dx / d * 0.18; L.z = boat.z + dz / d * 0.18; L.spin += 0.4; }
      L.yaw += L.spin * dt * (1 + rapid(L.z) * 3);
      const y = waterH(L.x, L.z, t, null) + 0.004;
      _e.set(0.05 * Math.sin(t * 2 + i), L.yaw, 0.05 * Math.cos(t * 1.7 + i));
      _q.setFromEuler(_e);
      _m.compose(_p.set(L.x, y, L.z), _q, _s.set(L.s, L.s, L.s));
      this.leafMeshes[i % 3].setMatrixAt(Math.floor(i / 3), _m);
    }
    for (const m of this.leafMeshes) { m.count = Math.ceil(this.NL / 3); m.instanceMatrix.needsUpdate = true; }

    // butterflies: lazy loops over the banks ahead of the boat
    for (let i = 0; i < this.NB; i++) {
      const b = this.bs[i];
      const z = boat.z + b.ahead + Math.sin(t * 0.21 + b.ph) * 1.2;
      const e = b.e + Math.sin(t * 0.37 + b.ph * 2) * 0.5;
      const x = cx(z) + b.side * (halfW(z) + e);
      const y = terrain(x, z) + b.h + Math.sin(t * 2.3 + b.ph) * 0.08;
      const yaw = Math.atan2(Math.cos(t * 0.37 + b.ph * 2) * b.side, 1) + Math.sin(t * 0.7 + b.ph);
      _e.set(-0.25, yaw, 0.15 * Math.sin(t * 3 + b.ph));
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s.set(0.028, 0.028, 0.028));
      this.flies.setMatrixAt(i, _m);
    }
    this.flies.instanceMatrix.needsUpdate = true;

    // spray emitters: in-stream rocks and the drop near the boat
    const k = Math.floor(boat.z / CHUNK);
    if (k !== this.sprayK) {
      this.sprayK = k;
      const em = [];
      for (let j = k; j <= k + 2; j++) for (const r of chunkRocks(j)) if (r.inStream && r.rw > 0) em.push([r.x, r.z, r.rw, rapid(r.z)]);
      const p = this.spray.geometry.attributes.position;
      for (let i = 0; i < this.NS; i++) {
        let x, z;
        if (em.length && Math.random() < 0.75) { const e = em[Math.floor(Math.random() * em.length)]; const a = (Math.random() - 0.5) * 2.4; x = e[0] + Math.sin(a) * e[2] * 1.05; z = e[1] - Math.cos(a) * e[2] * 1.05; }
        else { z = k * CHUNK + Math.random() * CHUNK * 3; const sz = Math.round(z / 16) * 16; z = sz + (Math.random() - 0.3) * 1.2; x = cx(z) + (Math.random() * 2 - 1) * halfW(z) * 0.9; }
        p.setXYZ(i, x, waterH(x, z, 0, null) + 0.01, z);
      }
      p.needsUpdate = true;
    }

    // sun shafts: tall slanted planes ahead, turned to face the camera around their own axis
    const sun = shared.uSun.value;
    for (let i = 0; i < this.NH; i++) {
      const h = this.hs[i];
      let z = boat.z + ((h.ahead - (t * 0.0)) % 30);
      const x = cx(z) + h.off;
      _p.set(x, terrain(x, z) - 0.2, z);
      const yA = new THREE.Vector3(sun.x, sun.y, sun.z).normalize();
      const toCam = new THREE.Vector3().subVectors(camPos, _p).normalize();
      const xA = new THREE.Vector3().crossVectors(yA, toCam).normalize();
      const zA = new THREE.Vector3().crossVectors(xA, yA);
      _m.makeBasis(xA.multiplyScalar(h.w), yA.multiplyScalar(11), zA);
      _m.setPosition(_p);
      this.shafts.setMatrixAt(i, _m);
    }
    this.shafts.instanceMatrix.needsUpdate = true;
  }
}
