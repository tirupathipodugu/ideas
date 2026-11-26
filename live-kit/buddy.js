// Rigged tiny creature + the step choreography engine (rest, hold, crouch, ballistic air, land, paths).
// Shared by the live toys that need little animated characters. The GLB carries baked clips
// (sit_idle, stand_idle, walk, run, jump_*, catch, wave, cheer, slide, hang, peek, hide, ride, sit_down, stand_up).
import { THREE, scene, S, T, TEX, lerp, clamp, rand, smooth, dist, glitter, puff, tone, noise } from './core.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

let TEMPLATE = null, CLIPS = {}, BASE_MAT = null;
export async function loadBuddy(url) {
  const g = await new GLTFLoader().loadAsync(url);
  TEMPLATE = g.scene; for (const c of g.animations) CLIPS[c.name] = c;
  TEMPLATE.traverse((o) => {
    if (o.isMesh) for (const m of [].concat(o.material)) if (m.name !== 'Bulb' && !BASE_MAT)
      BASE_MAT = new THREE.MeshPhysicalMaterial({ map: m.map, roughness: 0.82, metalness: 0, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(1, 0.97, 0.92), envMapIntensity: 0.7 });
  });
}
const CONTACT = { sit_idle: -0.37, ride: -0.37, slide: -0.37, hang: 0.15 };
const LOOP = new Set(['sit_idle', 'stand_idle', 'walk', 'run', 'jump_air', 'cheer', 'slide', 'hang', 'peek', 'hide', 'ride']);
export const bsfx = {
  jump: () => tone(rand(240, 300), rand(650, 800), 0.18, 'sine', 0.06),
  land: () => { noise(0.07, 700, 300, 0.12); tone(140, 90, 0.07, 'sine', 0.07); },
  step: () => noise(0.03, 2400, 1800, 0.03),
};

export class Buddy {
  constructor({ hue = null, sizeMul = 1, sat = 0.75, light = 0.6 } = {}) {
    this.sizeMul = sizeMul; this.hue = hue;
    this.root = new THREE.Group(); this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.model = skClone(TEMPLATE); this.pivot.add(this.model);
    const tint = hue == null ? new THREE.Color(1, 1, 1) : new THREE.Color().setHSL(hue / 360, sat, light);
    this.model.traverse((o) => {
      if (!o.isMesh) return; o.frustumCulled = false;
      o.material = [].concat(o.material).map((m) => {
        if (m.name === 'Bulb') { const b = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: hue == null ? 0xffcc66 : new THREE.Color().setHSL(((hue + 180) % 360) / 360, 0.9, 0.6), emissiveIntensity: 1.2, roughness: 0.3 }); this.bulb = b; return b; }
        const b = BASE_MAT.clone(); b.color = tint; this.body = b; return b;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    this.antenna = this.model.getObjectByName('antenna');
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: this.bulb ? this.bulb.emissive : 0xffcc66 }));
    this.glow.scale.setScalar(0.3); this.glow.position.set(0, 0.12, 0); if (this.antenna) this.antenna.add(this.glow);
    this.mixer = new THREE.AnimationMixer(this.model); this.acts = {};
    for (const [n, c] of Object.entries(CLIPS)) { const a = this.mixer.clipAction(c); a.setLoop(LOOP.has(n) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = true; this.acts[n] = a; }
    this.pos = { x: S.W / 2, y: S.H / 2 }; this.ang = 0; this.yaw = 0; this.yawT = 0; this.spin = 0; this.tilt = 0;
    this.sq = 1; this.sqV = 0; this.contact = -0.5; this.pop = 0; this.popT = 1; this.q = []; this.step = null; this.cur = null; this.dead = false; this.zb = 0;
    scene.add(this.root);
  }
  get bh() { return T.scale * this.sizeMul; }
  play(name, { fade = 0.22, speed = 1, from = 0, sync = false } = {}) {
    const a = this.acts[name]; if (!a) return;
    if (this.cur === a && !from) { a.timeScale = speed; return; }
    a.reset(); a.timeScale = speed; a.time = sync ? Math.random() * a.getClip().duration : from; a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (this.cur && this.cur !== a) this.cur.crossFadeTo(a, fade, false);
    this.cur = a; this.curName = name; this.contactT = CONTACT[name] ?? -0.5;
  }
  run(steps) { this.q = steps; this.step = null; }
  get busy() { return !!(this.step && !this.step.rest) || this.q.length > 0; }
  update(dt) {
    if (!this.step && this.q.length) { this.step = this.q.shift(); this.step.start?.(this); }
    if (this.step && this.step.update(this, dt)) this.step = null;
    if (this.dead) return;
    this.mixer.update(dt);
    this.sqV += (-(this.sq - 1) * 260 - this.sqV * 16) * dt; this.sq += this.sqV * dt;
    this.contact = lerp(this.contact, this.contactT ?? -0.5, Math.min(1, dt * 7));
    this.yaw = lerp(this.yaw, this.yawT, Math.min(1, dt * 7));
    this.pop = lerp(this.pop, this.popT, Math.min(1, dt * 9));
    const s = this.bh * this.pop, sy = this.sq, sx = 1 / Math.sqrt(Math.max(0.3, sy));
    this.root.position.set(this.pos.x, S.H - this.pos.y, (this.pos.y / S.H) * 400 + this.zb);
    this.root.scale.set(s * sx, s * sy, s);
    this.root.rotation.z = -this.ang;
    this.pivot.position.y = -this.contact;
    this.pivot.rotation.set(this.tilt, this.yaw, this.spin);
  }
  squash(v) { this.sqV += v; }
  dispose() {
    scene.remove(this.root); this.dead = true;
    this.model.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => m.dispose()); });
    this.glow.material.dispose();
  }
}

// ---------- steps: { start(b), update(b, dt) → done? } ----------
const follow = (b, p, dt, k = 22) => { if (!p) return; const a = Math.min(1, dt * k); b.pos.x = lerp(b.pos.x, p.x, a); b.pos.y = lerp(b.pos.y, p.y, a); b.ang = lerp(b.ang, (p.ang || 0) * 0.8, Math.min(1, dt * 8)); };
export function Rest(fn, clip = 'stand_idle', { yaw = 0, wander = 0 } = {}) {
  return {
    rest: true, t: 0,
    start(b) { b.play(clip, { fade: 0.35, sync: true }); b.yawT = yaw; },
    update(b, dt) { this.t += dt; follow(b, fn(), dt); if (wander) b.yawT = yaw + Math.sin(this.t * 0.7 + b.sizeMul * 40) * wander; return false; },
  };
}
export function Hold(fn, clip, dur, o = {}) {
  return {
    t: 0,
    start(b) { b.play(clip, { fade: o.fade ?? 0.2, from: o.from || 0 }); if (o.yaw != null) b.yawT = o.yaw; o.onStart?.(b); },
    update(b, dt) { this.t += dt; follow(b, fn?.(), dt); return this.t >= dur; },
  };
}
export function Crouch(fn, dur = 0.38) {
  return {
    t: 0,
    start(b) { b.play('jump_start', { fade: 0.12 }); },
    update(b, dt) {
      this.t += dt; const p = fn?.(); if (p) { b.pos.x = p.x; b.pos.y = p.y; }
      if (this.t >= dur) { if (b.sizeMul > 0.5 || Math.random() < 0.15) bsfx.jump(); puff(b.pos.x, b.pos.y, b.bh * 0.35, 5); b.squash(-5); return true; }
      return false;
    },
  };
}
export function Air(targetFn, o = {}) { // ballistic hop homing onto a moving target, lingers at the apex
  return {
    t: 0,
    start(b) {
      this.s = { ...b.pos }; this.last = targetFn() || { ...b.pos };
      const d = dist(this.s, this.last);
      this.T = o.T ?? clamp(0.42 + 0.11 * Math.sqrt(d / Math.max(20, b.bh)), 0.45, 1.15);
      const rise = Math.max(0, this.s.y - this.last.y);
      this.h = o.h ?? (0.55 * b.bh + 0.22 * d + rise * 0.35);
      this.flip = o.flip ?? (d > 3.4 * b.bh && Math.random() < 0.6);
      this.dir = Math.sign(this.last.x - this.s.x) || 1;
      if (o.clip !== false) b.play(o.clip || 'jump_air', { fade: 0.12, from: o.from || 0 });
      b.yawT = o.yaw ?? this.dir * 0.65;
    },
    update(b, dt) {
      this.t += dt; const u = clamp(this.t / this.T, 0, 1);
      const ue = clamp(u + 0.22 * Math.sin(2 * Math.PI * u) / (2 * Math.PI), 0, 1);
      const tg = targetFn() || this.last; this.last = tg;
      b.pos.x = lerp(this.s.x, tg.x, ue); b.pos.y = lerp(this.s.y, tg.y, ue) - this.h * 4 * ue * (1 - ue);
      b.ang = lerp(b.ang, 0, Math.min(1, dt * 6));
      b.spin = this.flip ? -this.dir * Math.PI * 2 * smooth(0.18, 0.82, u) : 0;
      b.sq = 1 + 0.16 * Math.abs(1 - 2 * u) - 0.02;
      if (o.shrink) b.popT = 1 - smooth(0.5, 1, u);
      if (o.trail && Math.random() < 0.6) glitter.emit(b.pos.x + rand(-4, 4), b.pos.y - b.bh * 0.4, 0, 0, 0.45, b.bh * 0.09, ...o.trail, 0.9);
      if (u >= 1) { b.spin = 0; b.pos.x = tg.x; b.pos.y = tg.y; o.onArrive?.(b); return true; }
      return false;
    },
  };
}
export function Land(fn, quiet = false) {
  return {
    t: 0,
    start(b) { b.play('jump_land', { fade: 0.06 }); if (!quiet) bsfx.land(); b.squash(-9); puff(b.pos.x, b.pos.y, b.bh * 0.45, 6); },
    update(b, dt) { this.t += dt; const p = fn?.(); if (p) { b.pos.x = p.x; b.pos.y = p.y; } b.yawT = lerp(b.yawT, 0, Math.min(1, dt * 4)); return this.t >= 0.42; },
  };
}
export function Path(fns, mode = 'run', o = {}) { // walk / run / slide along a live polyline
  return {
    s: 0, v: 0,
    start(b) { b.play(mode, { fade: 0.25 }); this.v = mode === 'slide' ? 0.4 * b.bh : 0; this.acc = 0; },
    update(b, dt) {
      const pts = fns.map((f) => f()).filter(Boolean); if (pts.length < 2) return true;
      const seg = []; let L = 0; for (let i = 1; i < pts.length; i++) { const l = dist(pts[i - 1], pts[i]); seg.push(l); L += l; }
      const vmax = (mode === 'walk' ? 0.55 : mode === 'run' ? 1.85 : 4.5) * b.bh * (o.speed || 1);
      this.v = Math.min(vmax, this.v + (mode === 'slide' ? 4.2 * b.bh : vmax * 3) * dt); this.s += this.v * dt;
      if (mode !== 'slide' && b.cur) b.cur.timeScale = this.v / vmax * (o.speed || 1);
      let s = Math.min(this.s, L), i = 0; while (i < seg.length - 1 && s > seg[i]) { s -= seg[i]; i++; }
      const a = pts[i], c = pts[i + 1], k = seg[i] ? clamp(s / seg[i], 0, 1) : 1;
      b.pos.x = lerp(a.x, c.x, k); b.pos.y = lerp(a.y, c.y, k);
      let sa = Math.atan2(c.y - a.y, c.x - a.x); if (sa > Math.PI / 2) sa -= Math.PI; if (sa < -Math.PI / 2) sa += Math.PI;
      b.ang = lerp(b.ang, clamp(sa, -0.6, 0.6), Math.min(1, dt * 10));
      const dir = Math.sign(c.x - a.x) || 1; b.yawT = dir * 1.3;
      this.acc += this.v * dt; if (this.acc > 0.3 * b.bh) { this.acc = 0; if (b.sizeMul > 0.5) bsfx.step(); }
      return this.s >= L;
    },
  };
}
export const Call = (f) => ({ start(b) { f(b); }, update: () => true });
