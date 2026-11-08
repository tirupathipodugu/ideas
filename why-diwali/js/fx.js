// Shared look: textures drawn on canvases, diyas, glowing figures and one additive particle system.
import * as THREE from 'three';

const V3 = THREE.Vector3;
const ADD = THREE.AdditiveBlending;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const radial = (stops) => (x, w, h) => {
  const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  x.fillStyle = g; x.fillRect(0, 0, w, h);
};

export const TEX = {
  dot: canvasTex(64, 64, radial([[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,.85)'], [1, 'rgba(255,255,255,0)']])),
  pool: canvasTex(128, 128, radial([[0, 'rgba(255,175,80,.75)'], [0.35, 'rgba(255,140,50,.32)'], [1, 'rgba(255,120,40,0)']])),
  glow: canvasTex(128, 128, radial([[0, 'rgba(255,255,255,.9)'], [0.3, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']])),
  flame: canvasTex(64, 128, (x) => {
    const g0 = x.createRadialGradient(32, 88, 0, 32, 88, 44); g0.addColorStop(0, 'rgba(255,170,60,.45)'); g0.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = g0; x.fillRect(0, 0, 64, 128);
    x.beginPath(); x.moveTo(32, 14); x.quadraticCurveTo(54, 70, 32, 116); x.quadraticCurveTo(10, 70, 32, 14);
    const g = x.createRadialGradient(32, 92, 2, 32, 80, 40); g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, '#fff2b0'); g.addColorStop(0.6, '#ffb030'); g.addColorStop(1, 'rgba(255,90,20,.1)');
    x.fillStyle = g; x.fill();
  }),
  ring: canvasTex(128, 128, (x) => {
    x.strokeStyle = 'rgba(255,230,170,.95)'; x.lineWidth = 6; x.shadowColor = 'rgba(255,200,100,1)'; x.shadowBlur = 14;
    x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 2.5; x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.stroke();
  }),
  foot: canvasTex(64, 64, (x) => {
    x.fillStyle = '#ff3b3b'; x.shadowColor = '#ff6a3b'; x.shadowBlur = 8;
    x.beginPath(); x.ellipse(32, 40, 10, 17, 0, 0, Math.PI * 2); x.fill();
    [[22, 18, 4], [28, 14, 3.2], [33, 13, 3], [38, 14, 2.8], [42, 17, 2.5]].forEach(([a, b, r]) => { x.beginPath(); x.arc(a, b, r, 0, Math.PI * 2); x.fill(); });
  }),
};

// ---------- diyas ----------
const lathe = new THREE.LatheGeometry([[0, 0], [0.2, 0.02], [0.34, 0.09], [0.42, 0.2], [0.39, 0.23], [0.3, 0.16], [0, 0.15]].map(([a, b]) => new THREE.Vector2(a, b)), 16);
const bodyMat = new THREE.MeshStandardMaterial({ color: '#b5521f', roughness: 0.75, emissive: '#3a1204', emissiveIntensity: 0.6 });
const flameMat = new THREE.SpriteMaterial({ map: TEX.flame, color: new THREE.Color(1.5, 0.95, 0.42), blending: ADD, depthWrite: false, transparent: true });
const reflMat = new THREE.SpriteMaterial({ map: TEX.flame, color: new THREE.Color(0.6, 0.36, 0.16), blending: ADD, depthWrite: false, transparent: true });
const poolMat = new THREE.MeshBasicMaterial({ map: TEX.pool, blending: ADD, depthWrite: false, transparent: true, color: new THREE.Color(0.6, 0.5, 0.4) });
const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export const diyas = [];

/** A clay lamp at pos (in parent's space). light() fades the flame in; reflect = a world point on the water. */
export function makeDiya(parent, pos, s = 1, { reflect = null, pool = 5 } = {}) {
  const g = new THREE.Group(); g.position.copy(pos); g.scale.setScalar(s); parent.add(g);
  g.add(new THREE.Mesh(lathe, bodyMat));
  const flame = new THREE.Sprite(flameMat); flame.center.set(0.5, 0.08); flame.position.set(0.3, 0.2, 0); flame.visible = false; g.add(flame);
  const pl = new THREE.Mesh(poolGeo, poolMat); pl.position.y = 0.03; pl.visible = false; g.add(pl);
  let refl = null;
  if (reflect) { refl = new THREE.Sprite(reflMat); refl.center.set(0.5, 0.95); refl.position.copy(reflect); refl.visible = false; parent.parent ? parent.parent.add(refl) : parent.add(refl); }
  const d = {
    group: g, lit: 0, on: false, ph: Math.random() * 6,
    world: () => g.getWorldPosition(new V3()).add(new V3(0, 0.35 * s, 0)),
    light() { d.on = true; },
    update(t, dt) {
      if (d.on && d.lit < 1) d.lit = Math.min(1, d.lit + dt * 2.2);
      const L = d.lit;
      flame.visible = pl.visible = L > 0;
      if (L <= 0) return;
      const f = 1 + Math.sin(t * 13 + d.ph) * 0.08 + Math.sin(t * 7.3 + d.ph) * 0.05;
      flame.scale.set(0.3 * L, 0.56 * L * f, 1);
      pl.scale.setScalar(pool * L);
      if (refl) { refl.visible = true; refl.scale.set(0.3 * L * s, 0.9 * L * f * s, 1); }
    },
  };
  diyas.push(d);
  return d;
}
export const updateDiyas = (t, dt) => diyas.forEach((d) => d.update(t, dt));

/** A soft additive glow sprite (for windows, lanterns, the temple). */
export function glowSprite(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, color: color.clone().multiplyScalar(0.5), blending: ADD, depthWrite: false, transparent: true }));
  s.scale.set(size, size, 1);
  return s;
}

// ---------- glowing figures (no faces: spirits of the story) ----------
const coneGeo = new THREE.ConeGeometry(0.3, 1.1, 10).translate(0, 0.55, 0);
const headGeo = new THREE.SphereGeometry(0.19, 12, 8).translate(0, 1.3, 0);
const bowGeo = new THREE.TorusGeometry(0.5, 0.025, 5, 18, Math.PI * 0.85);
const crownGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.16, 8).translate(0, 1.55, 0);
const tailGeo = new THREE.TorusGeometry(0.45, 0.04, 5, 16, Math.PI * 1.1);
const goldMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.25, 0.35) });
export function makeFigure(color, kind = '', s = 1) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color });
  g.add(new THREE.Mesh(coneGeo, m), new THREE.Mesh(headGeo, m));
  if (kind === 'bow') { const b = new THREE.Mesh(bowGeo, m); b.position.set(0.32, 0.85, 0); b.rotation.set(0, Math.PI / 2, Math.PI * 0.57); g.add(b); }
  if (kind === 'crown') g.add(new THREE.Mesh(crownGeo, goldMat));
  if (kind === 'tail') { const t = new THREE.Mesh(tailGeo, m); t.position.set(0, 0.5, -0.4); t.rotation.set(0, Math.PI / 2, -0.3); g.add(t); }
  g.scale.setScalar(s);
  return g;
}

// ---------- particles: sparkles, fireworks, embers ----------
export class Particles {
  constructor(scene, max = 7000) {
    this.max = max; this.n = 0;
    const f = (k) => new Float32Array(max * k);
    this.pos = f(3); this.col = f(3); this.vel = f(3); this.base = f(3); this.age = f(1); this.life = f(1); this.grav = f(1); this.drag = f(1); this.twk = f(1);
    const geo = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.ca = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.pa); geo.setAttribute('color', this.ca);
    this.geo = geo;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.75, map: TEX.dot, vertexColors: true, transparent: true, depthWrite: false, blending: ADD, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  spawn(p, v, c, life, grav = 3, drag = 0.97, twinkle = 0) {
    if (this.n >= this.max) return;
    const i = this.n++, i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = v.x; this.vel[i3 + 1] = v.y; this.vel[i3 + 2] = v.z;
    this.base[i3] = c.r; this.base[i3 + 1] = c.g; this.base[i3 + 2] = c.b;
    this.age[i] = 0; this.life[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.twk[i] = twinkle;
  }
  sparkle(p, c, n = 24, speed = 2.5, life = 1) {
    const v = new V3();
    for (let i = 0; i < n; i++) { v.randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7)); v.y += speed * 0.4; this.spawn(p, v, c, life * (0.5 + Math.random() * 0.6), 2, 0.95, 0.5); }
  }
  burst(p, c, c2, n = 140, speed = 9) {
    const v = new V3();
    for (let i = 0; i < n; i++) { v.randomDirection().multiplyScalar(speed * (0.92 + Math.random() * 0.08)); this.spawn(p, v, i % 3 ? c : c2, 1.6 + Math.random() * 0.7, 2.6, 0.965, 0.25); }
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      const i3 = i * 3, k = Math.pow(this.drag[i], dt * 60);
      this.vel[i3] *= k; this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.grav[i] * dt; this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      let a = 1 - this.age[i] / this.life[i];
      if (this.twk[i]) a *= 1 - this.twk[i] * Math.random();
      this.col[i3] = this.base[i3] * a; this.col[i3 + 1] = this.base[i3 + 1] * a; this.col[i3 + 2] = this.base[i3 + 2] * a;
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.pa.needsUpdate = true; this.ca.needsUpdate = true;
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    for (const [arr, k] of [[this.pos, 3], [this.vel, 3], [this.base, 3], [this.col, 3]]) for (let q = 0; q < k; q++) arr[i * k + q] = arr[j * k + q];
    for (const arr of [this.age, this.life, this.grav, this.drag, this.twk]) arr[i] = arr[j];
  }
}
