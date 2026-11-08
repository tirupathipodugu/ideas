// The six stories, each built at its own spot in the valley. Every one is played the same way: tap what glows.
import * as THREE from 'three';
import { makeDiya, makeFigure, glowSprite, TEX } from './fx.js';
import { SPOTS, heightAt, WATER_Y } from './world.js';
import { DAYS } from './story.js';

const V3 = THREE.Vector3;
const C = (r, g, b) => new THREE.Color(r, g, b);
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

function spot(scene, key) {
  const [x, z] = SPOTS[key], g = new THREE.Group();
  g.position.set(x, 0, z); g.rotation.y = Math.atan2(-x, -z); scene.add(g); g.updateMatrixWorld();
  const W = (lx, ly, lz) => g.localToWorld(new V3(lx, ly, lz));
  return { g, W };
}
const lambert = (c) => new THREE.MeshLambertMaterial({ color: c });

// ---------- 1. Rama comes home ----------
export function rama(ctx) {
  const { g, W } = spot(ctx.scene, 'rama');
  const path = (u) => new V3(Math.sin(u * 4.6) * 3.4, 0, 14 - u * 25);
  // the path, a sandy ribbon
  const pts = [], idx = [];
  for (let i = 0; i <= 80; i++) {
    const u = i / 80, p = path(u), q = path(Math.min(1, u + 0.01)), d = q.sub(p).normalize(), n = new V3(-d.z, 0, d.x).multiplyScalar(1.3);
    pts.push(p.x + n.x, 0.04, p.z + n.z, p.x - n.x, 0.04, p.z - n.z);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); pg.setIndex(idx); pg.computeVertexNormals();
  g.add(new THREE.Mesh(pg, new THREE.MeshLambertMaterial({ color: '#6e5a42', side: THREE.DoubleSide })));
  // Ayodhya palace on a platform
  const pal = new THREE.Group(); pal.position.set(0, 0, -15); g.add(pal);
  const stone = lambert('#3b3047'), dome = lambert('#4a3a55');
  const box = (w, h, d, x, y, z, m = stone) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); pal.add(b); return b; };
  box(18, 1.2, 8, 0, 0.6, 0); box(11, 4.5, 5, 0, 3.45, -0.5);
  const dm = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), dome); dm.position.set(0, 5.7, -0.5); dm.scale.y = 1.3; pal.add(dm);
  [-7.5, 7.5].forEach((x) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 6.5, 12), stone); t.position.set(x, 4.4, -0.5); pal.add(t); const d = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), dome); d.position.set(x, 7.65, -0.5); d.scale.y = 1.4; pal.add(d);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.55), new THREE.MeshBasicMaterial({ color: '#ff7a1f', side: THREE.DoubleSide })); f.position.set(x + 0.5, 9.4, -0.5); pal.add(f); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6), stone); pole.position.set(x, 9.1, -0.5); pal.add(pole); });
  const winMat = new THREE.MeshBasicMaterial({ color: '#120b14' });
  for (let i = -4; i <= 4; i++) for (let j = 0; j < 2; j++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.9), winMat); w.position.set(i * 1.15, 2.6 + j * 1.7, 2.01); pal.add(w); }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.6), winMat); door.position.set(0, 2.5, 2.02); pal.add(door);
  const palLamps = []; for (let i = 0; i < 17; i++) palLamps.push(makeDiya(pal, new V3(-8 + i, 1.22, 3.7), 0.6, { pool: 2.5 }));
  const halo = glowSprite(C(1.4, 0.9, 0.4), 30); halo.position.set(0, 5, 0); halo.material.opacity = 0; pal.add(halo);
  // lamps along the path
  const ds = [];
  for (let i = 0; i < 12; i++) { const u = (i + 0.5) / 12, p = path(u), q = path(u + 0.01), d = q.sub(p).normalize(), side = i % 2 ? 1 : -1; ds.push(makeDiya(g, p.clone().add(new V3(-d.z, 0, d.x).multiplyScalar(2.1 * side)), 1.1)); }
  // Rama, Sita, Lakshmana, Hanuman
  const party = [[C(1.9, 1.5, 0.8), 'bow', 0], [C(1.9, 1.0, 1.3), '', -0.045], [C(1.0, 1.4, 1.9), 'bow', -0.09], [C(1.9, 1.2, 0.5), 'tail', -0.135]].map(([c, k, off]) => { const f = makeFigure(c, k, 1.2); g.add(f); const h = glowSprite(c, 3.5); h.position.y = 0.9; h.material.opacity = 0.45; f.add(h); return { f, off }; });
  const L1 = ctx.light(W(0, 2.5, 12)), L2 = ctx.light(W(0, 6, -11));
  let walk = 0, lit = 0, doneT = -1, crowd = [];
  for (let i = 0; i < 14; i++) { const f = makeFigure(C(1.2, 1.0, 0.9), '', 0.65); f.position.set(-6.5 + i, 1.2, 4.6 + (i % 2) * 0.5); f.visible = false; pal.add(f); crowd.push(f); }
  return {
    key: 'rama', cam: [W(10, 7, 23), W(0, 1.5, 1)], focus: () => [...ds.map((d) => d.world()), W(0, 8, -15), W(-8, 1, -12), W(8, 1, -12)], tip: 'Tap the glowing lamps to light their way home',
    complete: false, celebrate: 5,
    begin() { ds.forEach((d) => { const t = ctx.target(d.world, () => { t.remove(); d.light(); lit++; ctx.chime(lit); ctx.addLamp(); ctx.P.sparkle(d.world(), C(2, 1.4, 0.6), 18); ctx.say(`${lit} / 12`, d.world()); }); }); },
    update(dt, T) {
      let k = 0; while (k < 12 && ds[k].on) k++;
      walk += ((k === 12 ? 1.02 : k / 12) - walk) * Math.min(1, dt * 1.1);
      party.forEach(({ f, off }) => { const u = THREE.MathUtils.clamp(walk + off, 0, 1.02), p = path(Math.min(1, u)), q = path(Math.min(1, u + 0.01)); f.position.set(p.x, Math.abs(Math.sin(T * 7 + off * 40)) * 0.08, p.z); f.rotation.y = Math.atan2(q.x - p.x, q.z - p.z); });
      L1.position.copy(W(path(walk).x, 2.5, path(walk).z)); L1.intensity = 8 + lit * 1.5;
      if (lit === 12 && !this.complete) {
        this.complete = true; doneT = T; ctx.win();
        ctx.flyTo(W(7, 6, 5), W(0, 4, -15), 3.5, 1);
        palLamps.forEach((d, i) => setTimeout(() => d.light(), 900 + i * 70));
        setTimeout(() => { ctx.firework(W(-6, 18, -18)); }, 1800); setTimeout(() => ctx.firework(W(7, 20, -16)), 2500); setTimeout(() => ctx.firework(W(0, 22, -20)), 3200);
      }
      if (doneT >= 0) {
        const a = THREE.MathUtils.clamp((T - doneT - 0.8) / 1.5, 0, 1);
        winMat.color.setRGB(0.07 + 1.0 * a, 0.04 + 0.62 * a, 0.08 + 0.2 * a); halo.material.opacity = 0.25 * a; L2.intensity = 25 * a;
        crowd.forEach((f, i) => { f.visible = a > 0.2; f.rotation.y = Math.PI; f.position.y = 1.2 + Math.abs(Math.sin(T * 6 + i)) * 0.15 * a; });
      }
    },
  };
}

// ---------- 2. Krishna and the shadows ----------
export function krishna(ctx) {
  const { g, W } = spot(ctx.scene, 'krishna');
  const houses = [];
  const wall = lambert('#2c2338'), roofM = lambert('#4a2430');
  for (let i = 0; i < 19; i++) {
    const a = i * 2.4, r = 2 + Math.sqrt(i) * 2.4, x = Math.cos(a) * r * 1.2, z = -3 + Math.sin(a) * r * 0.8;
    const hgt = 2.5 + (i * 37 % 10) / 4, w = 2.6 + (i % 3) * 0.4;
    const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = Math.atan2(-x, 18 - z) * 0.6; g.add(h);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 2.6), wall); b.position.y = hgt / 2; h.add(b);
    const rf = new THREE.Mesh(new THREE.ConeGeometry(w * 0.82, 1.4, 4).rotateY(Math.PI / 4), roofM); rf.position.y = hgt + 0.7; rf.scale.z = 0.75; h.add(rf);
    const wm = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (let k = 0; k < 2; k++) for (let j = 0; j < Math.floor(hgt / 1.4); j++) { const wn = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.65), wm); wn.position.set((k ? 0.55 : -0.55), 0.9 + j * 1.25, 1.31); h.add(wn); }
    const dy = makeDiya(h, new V3(0, hgt + 0.02, 1.2), 0.6, { pool: 2 }); dy.light();
    houses.push({ h, wm, on: true, a: 1, dy, top: hgt });
  }
  const L = ctx.light(W(0, 8, -3));
  const shades = [], disks = [];
  let cleared = 0, nextSpawn = 0, active = false, doneT = -1;
  const shadeGeo = new THREE.SphereGeometry(1, 16, 12), inner = new THREE.MeshBasicMaterial({ color: '#0b0012', transparent: true, opacity: 0.94 }), outer = new THREE.MeshBasicMaterial({ color: '#2a0838', transparent: true, opacity: 0.4, depthWrite: false });
  const eyeMat = new THREE.MeshBasicMaterial({ color: C(3, 0.3, 0.25) }), eyeGeo = new THREE.SphereGeometry(0.13, 8, 6);
  function spawn() {
    const s = new THREE.Group(), body = new THREE.Mesh(shadeGeo, inner); body.scale.setScalar(1.2); s.add(body);
    const o = new THREE.Mesh(shadeGeo, outer); o.scale.setScalar(1.9); s.add(o);
    [-0.4, 0.4].forEach((ex) => { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.set(ex, 0.2, 1.1); s.add(e); });
    const lit = houses.filter((h) => h.on), aim = (lit.length ? lit : houses)[(Math.random() * (lit.length || houses.length)) | 0];
    s.position.set(THREE.MathUtils.randFloat(-11, 11), 15 + Math.random() * 3, THREE.MathUtils.randFloat(-9, 2));
    g.add(s);
    const sh = { s, aim, v: 1.7 + cleared * 0.08, ph: Math.random() * 6, dead: false };
    sh.t = ctx.target(() => s.getWorldPosition(new V3()), () => throwAt(sh), 1.6);
    shades.push(sh);
  }
  const chakraGeo = new THREE.TorusGeometry(0.55, 0.09, 8, 24), spikeGeo = new THREE.ConeGeometry(0.1, 0.32, 5), chakraMat = new THREE.MeshBasicMaterial({ color: C(2.6, 1.8, 0.6) });
  function throwAt(sh) {
    sh.t.remove(); sh.v *= 0.2;
    const c = new THREE.Group(); c.add(new THREE.Mesh(chakraGeo, chakraMat));
    for (let i = 0; i < 12; i++) { const sp = new THREE.Mesh(spikeGeo, chakraMat), a = (i / 12) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.7, Math.sin(a) * 0.7, 0); sp.rotation.z = a - Math.PI / 2; c.add(sp); }
    const gl = glowSprite(C(2, 1.4, 0.5), 3); c.add(gl);
    ctx.scene.add(c);
    const from = ctx.camera.position.clone().add(new V3(0, -2, 0).add(ctx.camera.getWorldDirection(new V3()).multiplyScalar(5)));
    disks.push({ c, sh, from, t: 0 }); ctx.whoosh();
  }
  return {
    key: 'krishna', cam: [W(0, 10, 21), W(0, 4.5, -3)], focus: () => [W(-11, 0, -3), W(11, 0, -3), W(0, 17, -4), W(-11, 15, -4), W(11, 15, -4), W(0, 0, 4)], tip: 'Tap the shadows to throw Krishna’s chakra',
    complete: false, celebrate: 3.5,
    begin() { active = true; nextSpawn = 0; },
    update(dt, T) {
      if (active && !this.complete && T > nextSpawn && shades.length < 3) { spawn(); nextSpawn = T + 1 + Math.random() * 1.2; }
      for (let i = shades.length - 1; i >= 0; i--) {
        const sh = shades[i], s = sh.s, to = new V3(sh.aim.h.position.x, sh.aim.top + 1, sh.aim.h.position.z), d = to.sub(s.position);
        s.position.addScaledVector(d.normalize(), sh.v * dt); s.position.x += Math.sin(T * 1.4 + sh.ph) * dt * 0.8;
        s.lookAt(ctx.camera.position); s.children[1].scale.setScalar(1.9 + Math.sin(T * 4 + sh.ph) * 0.15);
        if (sh.dead) { g.remove(s); shades.splice(i, 1); continue; }
        if (s.position.y < sh.aim.top + 1.4) { // it reached the city: a light goes out
          sh.dead = true; sh.t.alive && sh.t.remove(); sh.aim.on = false; sh.aim.dy.on = false; sh.aim.dy.lit = 0; ctx.bell(150, 0.12, 0.9); ctx.say('A light went out', W(sh.aim.h.position.x, sh.aim.top + 2, sh.aim.h.position.z));
        }
      }
      for (let i = disks.length - 1; i >= 0; i--) {
        const d = disks[i]; d.t += dt / 0.45;
        const to = d.sh.s.getWorldPosition(new V3()), u = ease(Math.min(1, d.t));
        d.c.position.lerpVectors(d.from, to, u); d.c.position.y += Math.sin(u * Math.PI) * 2; d.c.rotation.z += dt * 25; d.c.lookAt(ctx.camera.position);
        if (d.t >= 1) {
          ctx.scene.remove(d.c); disks.splice(i, 1);
          if (!d.sh.dead) {
            d.sh.dead = true; cleared++; ctx.boom(); ctx.chime(cleared); ctx.addLamp();
            ctx.P.burst(to, C(2.2, 1.6, 0.6), C(2.4, 2.2, 1.6), 90, 6);
            ctx.say(cleared < 10 ? `${cleared} / 10` : 'The city is safe', to);
            const off = houses.find((h) => !h.on); if (off) { off.on = true; off.dy.light(); }
          }
        }
      }
      houses.forEach((h) => { h.a += ((h.on ? 1 : 0.05) - h.a) * Math.min(1, dt * 3); h.wm.color.setRGB(0.05 + 0.85 * h.a, 0.04 + 0.52 * h.a, 0.06 + 0.16 * h.a); });
      L.intensity = 4 + 10 * (houses.filter((h) => h.on).length / houses.length);
      if (cleared >= 10 && !this.complete) {
        this.complete = true; doneT = T; ctx.win(); active = false;
        shades.forEach((sh) => { if (!sh.dead) { sh.dead = true; sh.t.alive && sh.t.remove(); ctx.P.sparkle(sh.s.getWorldPosition(new V3()), C(2, 1.5, 0.6), 30, 4); } });
        houses.forEach((h) => { h.on = true; h.dy.light(); });
        [0, 600, 1200].forEach((ms, i) => setTimeout(() => ctx.firework(W(-8 + i * 8, 20 + i * 2, -8)), ms + 400));
      }
    },
  };
}

// ---------- 3. Welcome, Lakshmi ----------
export function lakshmi(ctx) {
  const { g, W } = spot(ctx.scene, 'lakshmi');
  const court = new THREE.Mesh(new THREE.CircleGeometry(8, 40).rotateX(-Math.PI / 2), lambert('#6f604f')); court.position.set(0, 0.03, 1); g.add(court);
  const house = new THREE.Group(); house.position.set(0, 0, -6); g.add(house);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(10, 4.6, 5), lambert('#5a3346')); walls.position.y = 2.3; house.add(walls);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(7.6, 2.6, 4).rotateY(Math.PI / 4), lambert('#6b2a24')); roof.scale.set(1, 1, 0.55); roof.position.y = 5.9; house.add(roof);
  const doorMat = new THREE.MeshBasicMaterial({ color: '#140a10' });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 3), doorMat); door.position.set(0, 1.5, 2.52); house.add(door);
  const frame = lambert('#7a4a28');
  [[-1.05, 1.6, 0.2, 3.3], [1.05, 1.6, 0.2, 3.3], [0, 3.2, 2.3, 0.22]].forEach(([x, y, w, h]) => { const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), frame); f.position.set(x, y, 2.55); house.add(f); });
  for (let i = 0; i <= 12; i++) { const x = -1.3 + (i / 12) * 2.6, y = 3.1 - Math.sin((i / 12) * Math.PI) * 0.35; const m = new THREE.Mesh(new THREE.SphereGeometry(i % 2 ? 0.13 : 0.1, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? C(1.6, 0.6, 0.05) : C(0.15, 0.6, 0.15) })); m.position.set(x, y, 2.7); m.scale.y = i % 2 ? 1 : 1.8; house.add(m); }
  const sideWin = new THREE.MeshBasicMaterial({ color: '#140a10' });
  [-3.4, 3.4].forEach((x) => { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), sideWin); w.position.set(x, 2.6, 2.52); house.add(w); });
  // rangoli: centre, inner ring of petals, outer ring of petals (three taps)
  const rg = new THREE.Group(); rg.position.set(0, 0.06, 2.4); g.add(rg);
  const outline = new THREE.MeshBasicMaterial({ color: '#cfc5b5', transparent: true, opacity: 0.35 });
  const parts = [
    { col: C(2, 0.35, 0.6), make: () => [new THREE.CircleGeometry(0.75, 24)].map((geo) => [geo, 0, 0, 0]) },
    { col: C(2, 1.1, 0.1), make: () => Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2; return [new THREE.CircleGeometry(0.42, 16).scale(1, 0.62, 1), Math.cos(a) * 1.45, Math.sin(a) * 1.45, a]; }) },
    { col: C(0.35, 1.6, 0.5), make: () => Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2 + 0.26; return [new THREE.CircleGeometry(0.5, 16).scale(1, 0.55, 1), Math.cos(a) * 2.6, Math.sin(a) * 2.6, a]; }) },
  ].map((pt, k) => {
    const mat = new THREE.MeshBasicMaterial({ color: '#cfc5b5', transparent: true, opacity: 0.35 });
    const ms = pt.make().map(([geo, x, z, a]) => { const m = new THREE.Mesh(geo.rotateX(-Math.PI / 2), mat); m.position.set(x, k * 0.005, z); m.rotation.y = -a; rg.add(m); return m; });
    return { mat, col: pt.col, f: 0, on: false, at: [0, 1.45, 2.6][k] };
  });
  const dots = new THREE.Mesh(new THREE.RingGeometry(3.35, 3.45, 64).rotateX(-Math.PI / 2), outline); dots.position.y = 0.01; rg.add(dots);
  const lamp = makeDiya(g, new V3(1.7, 0.05, -3.2), 1.25);
  const feet = [];
  const footMat = new THREE.MeshBasicMaterial({ map: TEX.foot, transparent: true, depthWrite: false, color: C(1.6, 1, 1) });
  for (let i = 0; i < 9; i++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2), footMat.clone()); f.position.set(i % 2 ? 0.28 : -0.28, 0.08, 6.6 - i * 1.05); f.material.opacity = 0; g.add(f); feet.push(f); }
  const L = ctx.light(W(0, 3, -1));
  let phase = 0, stepT = 0, filled = 0;
  return {
    key: 'lakshmi', cam: [W(0, 7.5, 14), W(0, 1.2, -1)], focus: () => [W(-3.5, 0, 2.4), W(3.5, 0, 2.4), W(0, 0, 6), W(0, 3.5, -3.5), W(1.7, 0, -3.2)], tip: 'Tap the rangoli to fill it with colour',
    complete: false, celebrate: 2,
    begin() {
      parts.forEach((p, k) => { const t = ctx.target(() => W([0, -1, 1][k] * p.at * 0.7, 0.3, 2.4 + p.at * 0.7), () => {
        t.remove(); p.on = true; filled++; ctx.chime(filled * 2); ctx.P.sparkle(W(0, 0.4, 2.4), p.col, 40, 3);
        if (filled === 3) { phase = 1; ctx.setTip('Now light the lamp at the door'); const t2 = ctx.target(lamp.world, () => { t2.remove(); lamp.light(); ctx.addLamp(); phase = 2; ctx.bell(523, 0.2, 2.5); ctx.setTip('Lakshmi is welcome here'); ctx.flyTo(W(4, 5, 9), W(0, 1.5, -4), 4, 0.5); }, 1.3); }
      }, 1.2 + k * 0.4); });
    },
    update(dt, T) {
      parts.forEach((p) => { if (p.on && p.f < 1) { p.f = Math.min(1, p.f + dt * 2); p.mat.color.copy(new THREE.Color('#cfc5b5').lerp(p.col, p.f)); p.mat.opacity = 0.35 + 0.65 * p.f; } });
      L.intensity = 8 + filled * 3;
      if (phase === 2) {
        stepT += dt;
        const a = THREE.MathUtils.clamp(stepT / 2.5, 0, 1); doorMat.color.setRGB(0.08 + 1.1 * a, 0.04 + 0.7 * a, 0.06 + 0.24 * a); sideWin.color.copy(doorMat.color);
        feet.forEach((f, i) => { f.material.opacity = THREE.MathUtils.clamp((stepT - 0.6 - i * 0.4) / 0.4, 0, 1); });
        if (stepT > 0.8 + 9 * 0.4 && !this.complete) { this.complete = true; ctx.win(); ctx.P.sparkle(W(0, 2, -3.4), C(2, 1.5, 0.7), 80, 4, 2); }
      }
    },
  };
}

// ---------- 4. Bandi Chhor Divas ----------
export function bandi(ctx) {
  const { g, W } = spot(ctx.scene, 'bandi');
  const stone = lambert('#5a4434');
  const wall = new THREE.Mesh(new THREE.BoxGeometry(30, 6.5, 2.4), stone); wall.position.set(0, 3.25, -8); g.add(wall);
  for (let x = -14.5; x <= 14.5; x += 1.6) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 2.4), stone); c.position.set(x, 6.95, -8); g.add(c); }
  [-15.5, 15.5].forEach((x) => { const t = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 9, 12), stone); t.position.set(x, 4.5, -8); g.add(t); });
  const gates = [], kings = [], N = [8, 9, 9, 9, 9, 8];
  const barMat = new THREE.MeshStandardMaterial({ color: '#8a8a96', metalness: 0.8, roughness: 0.4 });
  N.forEach((n, i) => {
    const x = -11 + i * 4.4;
    const hole = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.8, 0.3), new THREE.MeshBasicMaterial({ color: '#07040a' })); hole.position.set(x, 1.95, -6.72); g.add(hole);
    const bars = new THREE.Group(); bars.position.set(x, 1.95, -6.5);
    for (let b = 0; b < 7; b++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.8, 0.12), barMat); r.position.x = -1.2 + b * 0.4; bars.add(r); }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 0.14), barMat); cross.position.y = 0.6; bars.add(cross);
    g.add(bars);
    const torch = glowSprite(C(1.4, 0.75, 0.2), 1.2); torch.position.set(x + 1.8, 3.6, -6.6); g.add(torch);
    gates.push({ x, bars, open: 0, opened: false, n });
  });
  const cloak = new THREE.Group(); cloak.position.set(0, 0, 3); g.add(cloak);
  const cm = new THREE.MeshStandardMaterial({ color: '#d9a03a', metalness: 0.4, roughness: 0.5, emissive: '#ff9a2a', emissiveIntensity: 0.3, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.4, 26, 1, true), cm); cone.position.y = 2.1; cloak.add(cone);
  const tas = [];
  for (let i = 0; i < 52; i++) { const a = (i / 52) * Math.PI * 2, t = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.4, 5), new THREE.MeshBasicMaterial({ color: C(2, 1.5, 0.5) })); t.position.set(Math.cos(a) * 1.68, 0.2, Math.sin(a) * 1.68); cloak.add(t); tas.push(t); }
  const cg = glowSprite(C(1.6, 1.0, 0.4), 9); cg.position.y = 2; cloak.add(cg);
  const lineGeo = new THREE.BufferGeometry(), linePos = new Float32Array(52 * 6); lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: C(2, 1.6, 0.8), transparent: true, opacity: 0.7 })); g.add(lines); lineGeo.setDrawRange(0, 0);
  const L = ctx.light(W(0, 4, -2)); L.intensity = 12;
  let freed = 0, arrived = 0, phase = 0, walkT = 0, tT = 0;
  const temple = ctx.temple;
  return {
    key: 'bandi', cam: [W(0, 9, 21), W(0, 2.5, -3)], focus: () => [W(-11, 0.5, -6.5), W(11, 0.5, -6.5), W(-11, 4, -6.5), W(11, 4, -6.5), W(0, 0, 6)], tip: 'Tap the gates to free the 52 kings',
    complete: false, celebrate: 2,
    begin() {
      gates.forEach((gt) => { const t = ctx.target(() => W(gt.x, 2, -6.4), () => {
        t.remove(); gt.opened = true; ctx.chime(gates.filter((q) => q.opened).length * 2); ctx.addLamp(); ctx.noise(0.35, 2200, 500, 0.12);
        for (let k = 0; k < gt.n; k++) { const j = kings.length, f = makeFigure(C(1.5, 1.35, 1.15), 'crown', 0.62); f.position.set(gt.x + (k % 3 - 1) * 0.5, 0, -6.6); g.add(f);
          const row = Math.floor(j / 13), col = j % 13, a = Math.PI * (0.18 + 0.64 * (col / 12)), r = 2.6 + row * 0.8;
          kings.push({ f, from: f.position.clone(), to: new V3(Math.cos(a) * r, 0, 3 - Math.sin(a) * r), t: -k * 0.18, j }); }
        freed += gt.n; ctx.say(`${freed} free`, W(gt.x, 4.8, -6));
      }, 1.4); });
    },
    update(dt, T) {
      gates.forEach((gt) => { if (gt.opened && gt.open < 1) { gt.open = Math.min(1, gt.open + dt * 1.8); gt.bars.position.y = 1.95 + gt.open * 3.9; } });
      let n = 0;
      kings.forEach((k) => {
        if (k.t < 1) { k.t += dt * 0.55; if (k.t < 0) return; }
        const u = ease(Math.min(1, Math.max(0, k.t)));
        k.f.position.lerpVectors(k.from, k.to, u); k.f.position.y = Math.abs(Math.sin(T * 8 + k.j)) * 0.06 * (u < 1 ? 1 : 0);
        if (u < 1) k.f.lookAt(cloak.getWorldPosition(new V3()));
        if (k.t >= 1) {
          const tp = tas[k.j].getWorldPosition(new V3()), kp = k.f.getWorldPosition(new V3()).add(new V3(0, 0.55, 0));
          const a = g.worldToLocal(tp), b = g.worldToLocal(kp);
          linePos.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6); n++;
        }
      });
      lineGeo.setDrawRange(0, n * 2); lineGeo.attributes.position.needsUpdate = true;
      arrived = n;
      if (phase === 0 && freed === 52 && arrived === 52) { phase = 1; ctx.win(); ctx.setTip('Each king holds a tassel. They walk out free'); }
      if (phase === 1) {
        walkT += dt;
        const step = dt * 1.6 * Math.min(1, walkT);
        cloak.position.z += step; kings.forEach((k) => { k.f.position.z += step; k.from.z += step; k.to.z += step; k.f.position.y = Math.abs(Math.sin(T * 8 + k.j)) * 0.08; });
        if (walkT > 3) { phase = 2; tT = 0; ctx.setTip('Amritsar lights up for the Guru’s return'); ctx.flyTo(new V3(15, 5.5, -13), new V3(0, 2.5, 0), 3.5, 3); ctx.bell(392, 0.2, 3); }
      }
      if (phase === 2) {
        tT += dt;
        temple.setLit(THREE.MathUtils.clamp((tT - 2.5) / 2, 0, 1));
        temple.rim.forEach((d, i) => { if (!d.on && tT > 3 + Math.abs(((i + temple.rim.length * 0.12) % temple.rim.length) - temple.rim.length / 2) * 0.06) { d.light(); } });
        if (tT > 5 && tT - dt <= 5) { ctx.firework(new V3(-6, 22, -6)); setTimeout(() => ctx.firework(new V3(7, 24, -3)), 600); setTimeout(() => ctx.firework(new V3(0, 26, -9)), 1200); }
        if (tT > 7.5 && !this.complete) { this.complete = true; ctx.addLamp(temple.rim.length); }
      }
    },
  };
}

// ---------- 5. Mahavira: pass the flame up the hill ----------
export function mahavira(ctx) {
  const { g, W } = spot(ctx.scene, 'mahavira');
  const R = 9, Hh = 5, cz = -6;
  const mound = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#2a2540')); mound.scale.y = Hh / R; mound.position.z = cz; g.add(mound);
  const yAt = (x, z) => Hh * Math.sqrt(Math.max(0, 1 - (x * x + (z - cz) ** 2) / (R * R)));
  const marble = new THREE.MeshStandardMaterial({ color: '#e6ddd0', roughness: 0.6, emissive: '#fff2d8', emissiveIntensity: 0.02 });
  const tp = new THREE.Group(); tp.position.set(0, Hh - 0.1, cz); g.add(tp);
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2, 3.2), marble); b1.position.y = 1; tp.add(b1);
  const sh = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4, 4).rotateY(Math.PI / 4), marble); sh.position.y = 4; tp.add(sh);
  const kal = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: C(1.8, 1.3, 0.4) })); kal.position.y = 6.2; tp.add(kal);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshBasicMaterial({ color: '#d33', side: THREE.DoubleSide })); flag.position.set(0.5, 6.8, 0); tp.add(flag);
  const halo = glowSprite(C(1.6, 1.3, 0.9), 20); halo.position.y = 3; halo.material.opacity = 0; tp.add(halo);
  const ls = [];
  for (let i = 0; i < 9; i++) { const z = 4 - i * 1.2, x = (i % 2 ? 1 : -1) * 1.3; ls.push(makeDiya(g, new V3(x, yAt(x, z) + 0.02, z), 1.15)); }
  const L = ctx.light(W(0, 2.5, 5));
  const orbs = [];
  let n = 1, doneT = -1;
  function arm() {
    if (n >= ls.length) return;
    const d = ls[n], prev = ls[n - 1];
    const t = ctx.target(d.world, () => {
      t.remove();
      const o = glowSprite(C(2.4, 1.6, 0.6), 1.4); ctx.scene.add(o);
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.flame, color: C(2.4, 1.5, 0.7), blending: THREE.AdditiveBlending, depthWrite: false })); fl.scale.set(0.5, 0.9, 1); o.add(fl);
      orbs.push({ o, from: prev.world(), to: d.world(), t: 0, d });
      ctx.bell(880, 0.06, 0.6);
    }, 1.2);
  }
  return {
    key: 'mahavira', cam: [W(0, 5.5, 15), W(0, 2.6, -3)], focus: () => [...ls.map((d) => d.world()), W(0, Hh + 6.5, cz)], tip: 'Tap the next lamp to pass the flame up the hill',
    complete: false, celebrate: 3.5,
    begin() { ls[0].light(); arm(); },
    update(dt, T) {
      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i]; o.t += dt / 0.7; const u = ease(Math.min(1, o.t));
        o.o.position.lerpVectors(o.from, o.to, u); o.o.position.y += Math.sin(u * Math.PI) * 1;
        ctx.P.spawn(o.o.position, new V3((Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4), C(2, 1.3, 0.5), 0.5, -0.5, 0.97, 0.6);
        if (o.t >= 1) { ctx.scene.remove(o.o); orbs.splice(i, 1); o.d.light(); ctx.chime(n); ctx.addLamp(); ctx.P.sparkle(o.d.world(), C(2, 1.4, 0.6), 16); n++; arm(); }
      }
      L.intensity = 4 + ls.filter((d) => d.on).length * 2.5;
      if (n >= ls.length && !this.complete && doneT < 0) { doneT = T; ctx.win(); ctx.flyTo(W(0, 9, 12), W(0, 5, -6), 3, 1); }
      if (doneT >= 0) {
        const a = THREE.MathUtils.clamp((T - doneT) / 2, 0, 1); marble.emissiveIntensity = 0.02 + 0.35 * a; halo.material.opacity = 0.4 * a; L.intensity = 26 + 14 * a;
        if (T - doneT > 2.2 && !this.complete) { this.complete = true; ctx.P.sparkle(W(0, Hh + 4, cz), C(2.2, 2, 1.6), 120, 5, 2.5); }
      }
    },
  };
}

// ---------- 6. Five days: a sky lantern for each ----------
export function days(ctx, labels) {
  const { g, W } = spot(ctx.scene, 'days');
  const ls = [];
  // A fixed panel at the bottom (not floating labels): the day you're on, and a strip of all five.
  const panel = document.createElement('div'); panel.className = 'dayspanel';
  panel.innerHTML = '<div class="daynow"><b></b><span></span><small></small></div><div class="daystrip"></div>';
  document.body.append(panel);
  const now = panel.querySelector('.daynow'), strip = panel.querySelector('.daystrip');
  let shown = -1;
  const paper = [C(1.4, 0.7, 0.2), C(1.4, 0.4, 0.6), C(0.6, 1.2, 0.4), C(0.55, 0.75, 1.4), C(1.4, 1.1, 0.25)];
  DAYS.forEach(([e, name, line], i) => {
    const x = -6 + i * 3, grp = new THREE.Group(); grp.position.set(x, 0, 0); g.add(grp);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3), lambert('#4a3a2a')); stand.position.y = 0.65; grp.add(stand);
    const lan = new THREE.Group(); lan.position.y = 1.85; grp.add(lan);
    const mat = new THREE.MeshBasicMaterial({ color: paper[i].clone().multiplyScalar(0.25) });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.95, 16, 1, true), mat); lan.add(body);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), mat); top.position.y = 0.475; lan.add(top);
    const gl = glowSprite(paper[i], 3.4); gl.material.opacity = 0; lan.add(gl);
    const el = document.createElement('div'); el.className = 'chip'; el.innerHTML = `<i>${e}</i><b>Day ${i + 1}</b>`; strip.append(el);
    ls.push({ grp, lan, mat, gl, col: paper[i], el, up: false, vy: 0, a: 0, upT: 0, i });
  });
  let next = 0;
  function arm() {
    if (next >= ls.length) return;
    const l = ls[next];
    const t = ctx.target(() => l.lan.getWorldPosition(new V3()), () => {
      t.remove(); l.up = true; l.upT = 0; ctx.chime(next * 2 + 2); ctx.addLamp(); ctx.whoosh(); next++; arm();
      if (next === ls.length) setTimeout(() => { this_.complete = true; }, 3500);
    }, 1.3);
  }
  const this_ = {
    key: 'days', cam: [W(0, 3.4, 10), W(0, 1.2, -4)], fitBottom: -0.25, focus: () => [W(-6.5, 1.4, 0), W(6.5, 1.4, 0), W(-6.5, 3.4, 0), W(6.5, 3.4, 0)], tip: 'Release a lantern for each day, in order',
    complete: false, celebrate: 0.5, labels: ls,
    begin() { arm(); },
    update(dt, T, project) {
      ls.forEach((l, i) => {
        const glowA = l.up ? 1 : i === next ? 0.6 + 0.3 * Math.sin(T * 4) : 0.3;
        l.a += (glowA - l.a) * Math.min(1, dt * 4);
        l.mat.color.copy(l.col).multiplyScalar(0.5 + 0.5 * l.a); l.gl.material.opacity = 0.4 * l.a;
        if (l.up) { l.upT += dt; l.vy = Math.min(1.6, l.vy + dt * 0.8); l.lan.position.y += l.vy * dt; l.lan.position.x += Math.sin(T * 0.7 + i) * dt * 0.3; l.lan.rotation.y += dt * 0.4; }
        l.el.classList.toggle('next', i === next && !l.up); l.el.classList.toggle('done', l.up);
      });
      panel.classList.toggle('show', !!this_.active && !this_.complete && ctx.isPlaying());
      const k = Math.min(next, ls.length - 1);
      if (k !== shown) { shown = k; const [e, name, line] = DAYS[k]; now.querySelector('b').textContent = `Day ${k + 1} of 5`; now.querySelector('span').textContent = `${e} ${name}`; now.querySelector('small').textContent = line; now.animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 350); }
    },
    hideLabels() { this_.active = false; panel.classList.remove('show'); },
  };
  return this_;
}
