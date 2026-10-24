// Particles (fire, smoke, sparks), explosions, beams and lightning.
import { THREE, V3, scene, rnd, onUpdate, G } from './core.js';

const VERT = `attribute float size; attribute vec4 col; varying vec4 vC;
  void main(){ vC = col; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (420.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const FRAG = `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.5, 0.0, d)); }`;

// A pool of point sprites; each particle fades from one colour and size to another.
const pool = (max, additive) => {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), size = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('col', new THREE.BufferAttribute(col, 4));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const P = [];
  for (let i = 0; i < max; i++) P.push({ on: false, p: new V3(), v: new V3(), life: 0, max: 1, s0: 1, s1: 1, c0: new THREE.Color(), c1: new THREE.Color(), a0: 1, a1: 0, g: 0, drag: 0 });
  let next = 0;
  const emit = (p, v, o) => {
    const q = P[next];
    next = (next + 1) % max;
    q.on = true;
    q.p.copy(p);
    q.v.copy(v);
    q.life = 0;
    q.max = o.life ?? 1;
    q.s0 = o.s0 ?? 1;
    q.s1 = o.s1 ?? q.s0;
    q.c0.set(o.c0 ?? 0xffffff);
    q.c1.set(o.c1 ?? o.c0 ?? 0xffffff);
    q.a0 = o.a0 ?? 1;
    q.a1 = o.a1 ?? 0;
    q.g = o.g ?? 0;
    q.drag = o.drag ?? 0;
  };
  const c = new THREE.Color();
  const step = dt => {
    for (let i = 0; i < max; i++) {
      const q = P[i];
      if (!q.on) {
        size[i] = 0;
        continue;
      }
      q.life += dt;
      if (q.life >= q.max) {
        q.on = false;
        size[i] = 0;
        continue;
      }
      const k = q.life / q.max;
      q.v.y += q.g * dt;
      q.v.multiplyScalar(Math.exp(-q.drag * dt));
      q.p.addScaledVector(q.v, dt);
      pos[i * 3] = q.p.x;
      pos[i * 3 + 1] = q.p.y;
      pos[i * 3 + 2] = q.p.z;
      c.copy(q.c0).lerp(q.c1, k);
      col[i * 4] = c.r;
      col[i * 4 + 1] = c.g;
      col[i * 4 + 2] = c.b;
      col[i * 4 + 3] = q.a0 + (q.a1 - q.a0) * k;
      size[i] = q.s0 + (q.s1 - q.s0) * k;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.col.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  };
  return { emit, step };
};

const glow = pool(2600, true);
const smoke = pool(1400, false);
onUpdate(dt => {
  glow.step(dt);
  smoke.step(dt);
}, 95);

const _v = new V3();
export const flame = (from, dir, spread = 0.18, speed = 22) => {
  for (let k = 0; k < 6; k++) {
    _v.copy(dir).multiplyScalar(speed * rnd(0.85, 1.2));
    _v.x += rnd(-1, 1) * speed * spread;
    _v.y += rnd(-0.3, 0.8) * speed * spread;
    _v.z += rnd(-1, 1) * speed * spread;
    const start = from.clone().addScaledVector(dir, rnd(0, 0.8));
    glow.emit(start, _v, { life: rnd(0.45, 0.7), s0: 0.25, s1: rnd(2.2, 3.4), c0: 0xfff6c0, c1: 0xff2a00, a0: 0.85, a1: 0, g: 5, drag: 1.5 });
  }
  if (Math.random() < 0.3) smoke.emit(from.clone().addScaledVector(dir, 6), _v.set(rnd(-1, 1), 2.5, rnd(-1, 1)), { life: 1.6, s0: 1.5, s1: 5, c0: 0x2a2228, a0: 0.35, a1: 0 });
};

export const thrust = (from, dir, power = 1, color = 0x7fd0ff) => {
  for (let k = 0; k < 2; k++) {
    _v.copy(dir).multiplyScalar(rnd(10, 18) * power);
    _v.x += rnd(-1, 1);
    _v.z += rnd(-1, 1);
    glow.emit(from, _v, { life: rnd(0.12, 0.25), s0: 1.2 * power, s1: 0.2, c0: 0xffffff, c1: color, a0: 0.9, a1: 0 });
  }
};

export const burning = (at, k = 1) => {
  if (Math.random() < 0.6 * k) glow.emit(_v.set(at.x + rnd(-1, 1), at.y + rnd(0, 0.6), at.z + rnd(-1, 1)), new V3(rnd(-0.5, 0.5), rnd(2, 4), rnd(-0.5, 0.5)), { life: rnd(0.4, 0.8), s0: 1.6, s1: 0.4, c0: 0xffd070, c1: 0xff2a00, a0: 0.9 });
  if (Math.random() < 0.35 * k) smoke.emit(_v.set(at.x, at.y + 1, at.z), new V3(rnd(-0.6, 0.6), rnd(3, 5), rnd(-0.6, 0.6)), { life: 2.5, s0: 2, s1: 7, c0: 0x1c1a1e, c1: 0x4a4448, a0: 0.5, a1: 0 });
};

export const sparks = (at, n = 12, color = 0xffd27a) => {
  for (let k = 0; k < n; k++) glow.emit(at, new V3(rnd(-8, 8), rnd(2, 10), rnd(-8, 8)), { life: rnd(0.3, 0.7), s0: 0.35, s1: 0.1, c0: 0xffffff, c1: color, g: -18 });
};

export const dust = (at, n = 3) => {
  for (let k = 0; k < n; k++) smoke.emit(at, new V3(rnd(-2, 2), rnd(0.5, 2), rnd(-2, 2)), { life: rnd(0.8, 1.4), s0: 1, s1: 4, c0: 0xc9b6a8, a0: 0.35, a1: 0 });
};

export const splash = at => {
  for (let k = 0; k < 40; k++) smoke.emit(at, new V3(rnd(-5, 5), rnd(4, 12), rnd(-5, 5)), { life: rnd(0.6, 1.2), s0: 0.8, s1: 2.4, c0: 0xffffff, c1: 0x9fe3ff, a0: 0.8, a1: 0, g: -16 });
};

// Explosions: a flash, a fireball, smoke and a short-lived light.
const flash = new THREE.PointLight(0xff9a40, 0, 60, 1.6);
scene.add(flash);
let flashT = 0;
export const explode = (at, big = 1) => {
  for (let k = 0; k < 60 * big; k++) glow.emit(at, new V3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(4, 16) * big), { life: rnd(0.4, 0.9), s0: 3 * big, s1: 6 * big, c0: 0xfff2b0, c1: 0xff3000, a0: 1, a1: 0, drag: 3 });
  for (let k = 0; k < 40 * big; k++) smoke.emit(at, new V3(rnd(-6, 6), rnd(2, 10), rnd(-6, 6)), { life: rnd(2, 4), s0: 3 * big, s1: 12 * big, c0: 0x221d20, c1: 0x5c5458, a0: 0.7, a1: 0, drag: 1.2 });
  sparks(at, 30 * big);
  flash.position.copy(at).y += 3;
  flash.intensity = 900 * big;
  flashT = 0.35;
};
onUpdate(dt => {
  if (flashT > 0) {
    flashT -= dt;
    flash.intensity = Math.max(0, flash.intensity * Math.exp(-dt * 9));
  } else flash.intensity = 0;
}, 96);

// Beams: a glowing line from a to b that fades (Starlink strike, terminals, tasers).
const beams = [];
export const beam = (a, b, color = 0x9fe8ff, width = 0.6, life = 0.6) => {
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, len, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  scene.add(m);
  beams.push({ m, life, max: life });
  return m;
};

// Lightning: a jagged line from a to b (the Tesla Coil gun).
export const bolt = (a, b, color = 0xbfe6ff) => {
  const pts = [];
  const n = 10;
  for (let k = 0; k <= n; k++) {
    const p = a.clone().lerp(b, k / n);
    if (k > 0 && k < n) p.add(new V3(rnd(-0.8, 0.8), rnd(-0.8, 0.8), rnd(-0.8, 0.8)));
    pts.push(p);
  }
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), transparent: true, toneMapped: false }));
  scene.add(line);
  beams.push({ m: line, life: 0.12, max: 0.12 });
  sparks(b, 8, color);
};

onUpdate(dt => {
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i];
    b.life -= dt;
    b.m.material.opacity = Math.max(0, b.life / b.max);
    if (b.life <= 0) {
      scene.remove(b.m);
      b.m.geometry.dispose();
      b.m.material.dispose();
      beams.splice(i, 1);
    }
  }
}, 97);

// Camera shake that any system can add to.
export const shake = { k: 0 };
export const addShake = k => (shake.k = Math.min(2, shake.k + k));
onUpdate(dt => (shake.k = Math.max(0, shake.k - dt * 2.5)), 98);
G.fx = { explode };
