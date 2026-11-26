// Head World: a tiny floating island lives on top of your head: trees, a windmill, a little house,
// a pond whose waterfall pours down past your face, and tiny people going about their day.
// Tilt your head and the water spills and the people slide and panic. Nod and they bounce.
// Smile for a rainbow. Close your eyes and night falls on the island.
import { THREE, S, T, scene, boot, toast, clamp, lerp, rand, damp, angLerp, glitter, Particles, burst, tone, noise, loopNoise, TEX } from '../live-kit/core.js';

// ---------- materials ----------
const night = { v: 0, goal: 0 };
const mats = [];
const M = (color, o = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...o }); m.userData.base = new THREE.Color(color); mats.push(m); return m; };
const MAT = {
  grass: M(0x6cc24a), grass2: M(0x4fa63a), dirt: M(0x8a5a3b), rock: M(0x6e625c), rock2: M(0x8c7d70),
  trunk: M(0x7a4b2a), leaf: M(0x2f8f3a), leaf2: M(0x5bbf4a), leaf3: M(0xf0a8c8), wall: M(0xfff1dc), roof: M(0xd8463b),
  door: M(0x6b3e22), win: new THREE.MeshStandardMaterial({ color: 0x334455, emissive: 0xffc86b, emissiveIntensity: 0, roughness: 0.4 }),
  water: new THREE.MeshStandardMaterial({ color: 0x4fb6ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88, emissive: 0x0a2a55, emissiveIntensity: 0.3 }),
  cloud: M(0xffffff, { roughness: 1, flatShading: false }), mill: M(0xf4e9d8), blade: M(0xe9d7b5), skin: M(0xffd2b0, { flatShading: false }),
};
mats.push(MAT.water);
MAT.water.userData.base = new THREE.Color(0x4fb6ff);

// ---------- build the island (local units: top radius 1, y up) ----------
function jitter(geo, amt, keepTop = false) {
  const p = geo.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, [rand(-amt, amt), rand(-amt, amt), rand(-amt, amt)]);
    const d = seen.get(k); if (keepTop && p.getY(i) > 0) continue;
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1] * 0.6, p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals(); return geo;
}
const island = new THREE.Group(), tiltG = new THREE.Group(), yawG = new THREE.Group(), world = new THREE.Group();
island.add(yawG); yawG.add(tiltG); tiltG.add(world);
const add = (geo, mat, x = 0, y = 0, z = 0, parent = world) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
add(jitter(new THREE.CylinderGeometry(1, 0.97, 0.1, 22, 1), 0.025, true), MAT.grass, 0, 0.05, 0);
add(jitter(new THREE.CylinderGeometry(0.97, 0.9, 0.16, 22, 1), 0.03), MAT.dirt, 0, -0.08, 0);
add(jitter(new THREE.ConeGeometry(0.9, 1.25, 16, 4), 0.07), MAT.rock, 0, -0.78, 0).rotation.x = Math.PI;
for (let i = 0; i < 7; i++) { // floating rock crumbs
  const a = rand(0, Math.PI * 2), r = rand(0.75, 1.25);
  add(jitter(new THREE.IcosahedronGeometry(rand(0.05, 0.11), 0), 0.02), MAT.rock2, Math.cos(a) * r, rand(-0.9, -0.25), Math.sin(a) * r).userData.crumb = rand(0, 6);
}
for (let i = 0; i < 26; i++) { const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.92; add(new THREE.ConeGeometry(0.025, rand(0.05, 0.09), 4), MAT.grass2, Math.cos(a) * r, 0.12, Math.sin(a) * r); }
// pond + stream to the rim; the waterfall itself is particles in screen space so it always falls down
const POND = { x: -0.38, z: 0.3, r: 0.27 };
const pond = add(new THREE.CircleGeometry(POND.r, 24), MAT.water, POND.x, 0.105, POND.z); pond.rotation.x = -Math.PI / 2;
const lip = add(new THREE.TorusGeometry(POND.r, 0.03, 6, 24), MAT.rock2, POND.x, 0.1, POND.z); lip.rotation.x = Math.PI / 2;
const stream = add(new THREE.PlaneGeometry(0.12, 0.5), MAT.water, -0.55, 0.106, 0.62); stream.rotation.set(-Math.PI / 2, 0, -0.75);
const FALL_LOCAL = new THREE.Vector3(-0.7, 0.08, 0.72);
// trees
function tree(x, z, kind, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0.1, z); g.scale.setScalar(s); world.add(g);
  add(new THREE.CylinderGeometry(0.025, 0.035, 0.2, 6), MAT.trunk, 0, 0.1, 0, g);
  if (kind === 0) { add(new THREE.ConeGeometry(0.13, 0.22, 7), MAT.leaf, 0, 0.25, 0, g); add(new THREE.ConeGeometry(0.1, 0.18, 7), MAT.leaf, 0, 0.36, 0, g); }
  else add(jitter(new THREE.IcosahedronGeometry(0.14, 1), 0.015), kind === 1 ? MAT.leaf2 : MAT.leaf3, 0, 0.3, 0, g);
  g.userData.sway = rand(0, 6); return g;
}
const trees = [tree(0.55, 0.35, 0, 1.1), tree(0.7, -0.05, 1), tree(-0.05, -0.65, 0, 1.25), tree(-0.55, -0.4, 2), tree(0.15, 0.7, 1, 0.8), tree(-0.8, 0.05, 0, 0.9), tree(0.35, -0.72, 1, 0.9)];
// house
const house = new THREE.Group(); house.position.set(0.28, 0.1, -0.22); house.rotation.y = -0.4; world.add(house);
add(new THREE.BoxGeometry(0.3, 0.22, 0.26), MAT.wall, 0, 0.11, 0, house);
const roof = add(new THREE.ConeGeometry(0.25, 0.18, 4), MAT.roof, 0, 0.31, 0, house); roof.rotation.y = Math.PI / 4;
add(new THREE.BoxGeometry(0.07, 0.11, 0.01), MAT.door, 0.04, 0.055, 0.131, house);
add(new THREE.BoxGeometry(0.06, 0.05, 0.01), MAT.win, -0.08, 0.13, 0.131, house);
add(new THREE.BoxGeometry(0.01, 0.05, 0.06), MAT.win, 0.151, 0.13, 0, house);
const chimney = add(new THREE.BoxGeometry(0.04, 0.09, 0.04), MAT.rock2, -0.07, 0.36, -0.05, house);
const DOOR = new THREE.Vector3(0.04, 0, 0.2);
// windmill
const mill = new THREE.Group(); mill.position.set(-0.3, 0.1, -0.05); world.add(mill);
add(new THREE.CylinderGeometry(0.05, 0.08, 0.34, 8), MAT.mill, 0, 0.17, 0, mill);
add(new THREE.ConeGeometry(0.07, 0.08, 8), MAT.roof, 0, 0.38, 0, mill);
const blades = new THREE.Group(); blades.position.set(0, 0.32, 0.08); mill.add(blades);
for (let i = 0; i < 4; i++) { const b = add(new THREE.BoxGeometry(0.03, 0.2, 0.005), MAT.blade, 0, 0.1, 0, new THREE.Group()); const arm = b.parent; arm.rotation.z = (i * Math.PI) / 2; blades.add(arm); }
// clouds orbiting
const clouds = [];
for (let i = 0; i < 3; i++) {
  const c = new THREE.Group(); for (let j = 0; j < 4; j++) add(new THREE.SphereGeometry(rand(0.08, 0.13), 12, 8), MAT.cloud, j * 0.1 - 0.15, rand(-0.02, 0.03), rand(-0.03, 0.03), c);
  c.userData = { a: (i / 3) * Math.PI * 2, r: rand(1.25, 1.5), y: rand(0.25, 0.6), sp: rand(0.12, 0.2) }; world.add(c); clouds.push(c);
}
// rainbow (local, behind the island)
const rainbow = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.55, 64, 1, 0, Math.PI), new THREE.ShaderMaterial({
  uniforms: { a: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: 'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'uniform float a;varying vec3 p;vec3 hue(float h){return clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);}void main(){float r=(length(p.xy)-1.15)/.4;vec3 c=hue(.82*(1.-r));float e=smoothstep(0.,.15,r)*smoothstep(1.,.85,r);float f=smoothstep(0.,.25,p.y);gl_FragColor=vec4(c*e*f*a*.75,1.);}',
}));
rainbow.position.set(0, 0.1, -0.55); world.add(rainbow);
// soft shadow cast on your head
const shadow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.shadow, transparent: true, depthWrite: false, opacity: 0.5 }));
scene.add(shadow);
// warm glow of the house at night
const lamp = new THREE.PointLight(0xffb85c, 0, 0, 0); lamp.position.set(0, 0.25, 0.3); house.add(lamp);

// ---------- tiny people ----------
const PEOPLE_COLORS = [0xff5a5f, 0x3fa7ff, 0xffd23f, 0x8a5cff, 0x2ec27e, 0xff8c42];
class Person {
  constructor(i, atDoor = false) {
    this.g = new THREE.Group(); world.add(this.g);
    const col = M(PEOPLE_COLORS[i % PEOPLE_COLORS.length], { flatShading: false });
    this.body = add(new THREE.CapsuleGeometry(0.028, 0.045, 4, 8), col, 0, 0.055, 0, this.g);
    this.head = add(new THREE.SphereGeometry(0.03, 10, 8), MAT.skin, 0, 0.12, 0, this.g);
    this.armL = add(new THREE.CapsuleGeometry(0.009, 0.04, 2, 4), col, -0.034, 0.07, 0, this.g);
    this.armR = add(new THREE.CapsuleGeometry(0.009, 0.04, 2, 4), col, 0.034, 0.07, 0, this.g);
    for (const a of [this.armL, this.armR]) a.geometry.translate(0, -0.02, 0);
    this.armL.position.y = this.armR.position.y = 0.09;
    const p = atDoor ? house.position.clone().add(DOOR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), house.rotation.y)) : null;
    this.x = p ? p.x : rand(-0.6, 0.6); this.z = p ? p.z : rand(-0.6, 0.6); this.y = 0;
    this.vx = 0; this.vz = 0; this.vy = 0; this.state = 'walk'; this.goal = this.newGoal(); this.t = rand(0, 5); this.face = 0; this.panic = 0;
    this.scale = atDoor ? 0.01 : 1; this.inside = false;
  }
  newGoal() { for (;;) { const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * 0.78, x = Math.cos(a) * r, z = Math.sin(a) * r; if (Math.hypot(x - POND.x, z - POND.z) > POND.r + 0.06) return { x, z }; } }
  update(dt, acc) {
    this.t += dt; this.scale = Math.min(1, this.scale + dt * 3);
    if (this.state === 'fall') return this.fall(dt);
    const goHome = night.v > 0.6, door = house.position.clone().add(DOOR.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), house.rotation.y));
    const steep = Math.hypot(acc.x, acc.z);
    this.panic = damp(this.panic, steep > 0.9 ? 1 : 0, 6, dt);
    // walk toward the goal (or the door at night)
    const tgt = goHome ? { x: door.x, z: door.z } : this.goal;
    const dx = tgt.x - this.x, dz = tgt.z - this.z, d = Math.hypot(dx, dz);
    if (d < 0.04) { if (goHome) { this.inside = true; this.scale = 0; } else this.goal = this.newGoal(); }
    if (!goHome) this.inside = false;
    const walk = this.panic > 0.5 ? 0 : (goHome ? 0.28 : 0.12);
    let ax = (d > 0.01 ? (dx / d) * walk : 0) * 6 - this.vx * 6, az = (d > 0.01 ? (dz / d) * walk : 0) * 6 - this.vz * 6;
    // the slope: gravity along the tilted ground (they slide when it is steep)
    const slip = Math.max(0, steep - 0.25) * 2.2;
    ax += acc.x * slip; az += acc.z * slip;
    this.vx += ax * dt; this.vz += az * dt; this.x += this.vx * dt; this.z += this.vz * dt;
    // bounce (nod)
    this.vy -= 6 * dt; this.y = Math.max(0, this.y + this.vy * dt); if (this.y === 0 && this.vy < 0) { if (this.vy < -0.6) puffLocal(this); this.vy = 0; }
    // keep out of the pond
    const pd = Math.hypot(this.x - POND.x, this.z - POND.z);
    if (pd < POND.r + 0.03 && this.y < 0.05) { const k = (POND.r + 0.03) / pd; this.x = POND.x + (this.x - POND.x) * k; this.z = POND.z + (this.z - POND.z) * k; }
    // off the edge
    if (Math.hypot(this.x, this.z) > 1.0) { this.startFall(); return; }
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.02) this.face = angLerp(this.face, Math.atan2(this.vx, this.vz), Math.min(1, dt * 8));
    const bob = Math.abs(Math.sin(this.t * 14)) * 0.012 * Math.min(1, sp * 10);
    this.g.position.set(this.x, 0.1 + this.y + bob, this.z); this.g.rotation.set(0, this.face, 0);
    this.g.scale.setScalar(this.inside ? 0.001 : this.scale * 1.4);
    // arms: swing when walking, straight up when panicking or cheering
    const up = Math.max(this.panic, cheer.v);
    const sw = Math.sin(this.t * 14) * 0.7 * Math.min(1, sp * 8);
    this.armL.rotation.z = lerp(sw * 0.2, 2.8 + Math.sin(this.t * 20) * 0.3, up); this.armR.rotation.z = lerp(-sw * 0.2, -2.8 - Math.sin(this.t * 20 + 1) * 0.3, up);
    this.armL.rotation.x = sw * (1 - up); this.armR.rotation.x = -sw * (1 - up);
    this.g.rotation.z = -acc.x * 0.4 * this.panic; this.g.rotation.x = acc.z * 0.4 * this.panic;
  }
  startFall() { // leave the island: continue in screen space so they drop straight down past your face
    this.state = 'fall'; island.updateMatrixWorld(true);
    const w = this.g.getWorldPosition(new THREE.Vector3()), s = new THREE.Vector3(); this.g.getWorldScale(s);
    world.remove(this.g); scene.add(this.g); this.g.position.copy(w); this.g.scale.copy(s); this.ws = s.x;
    this.fvx = rand(-0.3, 0.3) * s.x + Math.sign(this.x) * s.x * 0.9; this.fvy = s.x * 1.2; this.spin = rand(-8, 8); this.ft = 0;
    sfx.scream(); falls.n++;
  }
  fall(dt) {
    this.ft += dt; this.fvy -= this.ws * 9 * dt; this.g.position.x += this.fvx * dt; this.g.position.y += this.fvy * dt;
    this.g.rotation.z += this.spin * dt; this.g.rotation.x += this.spin * 0.6 * dt;
    this.armL.rotation.z = 2.8 + Math.sin(this.ft * 30) * 0.5; this.armR.rotation.z = -2.8 - Math.sin(this.ft * 30) * 0.5;
    if (this.g.position.y < -50 || this.ft > 2.5) { this.dispose(); return 'gone'; }
  }
  dispose() { this.g.parent?.remove(this.g); this.dead = true; }
}
function puffLocal(p) { const w = p.g.getWorldPosition(new THREE.Vector3()); burst(w.x, S.H - w.y, 8, 4, 40); }

// ---------- water: the waterfall and spills, screen-space so it always falls down ----------
const water = new Particles(2500, THREE.NormalBlending, { order: 15 });
const spray = new Particles(600, THREE.AdditiveBlending, { order: 16 });
function emitWater(local, n, sz, out) {
  island.updateMatrixWorld(true);
  const w = world.localToWorld(local.clone()), sx = w.x, sy = S.H - w.y;
  const c = world.localToWorld(new THREE.Vector3(local.x * 0.8, local.y, local.z * 0.8)), dx = w.x - c.x, dy = -(w.y - c.y), dl = Math.hypot(dx, dy) || 1;
  for (let i = 0; i < n; i++) {
    const v = rand(0.6, 1.2) * out;
    water.emit(sx + rand(-1, 1) * sz * 0.08, sy + rand(-1, 1) * sz * 0.03, (dx / dl) * v + rand(-8, 8), (dy / dl) * v * 0.4 + rand(0, 20), rand(1.0, 1.5), rand(0.035, 0.06) * sz, rand(0.55, 0.75), rand(0.82, 0.92), 1, rand(0.55, 0.85), sz * 9, 0.6, 0.4);
    if (Math.random() < 0.15) spray.emit(sx, sy, rand(-20, 20), rand(-10, 30), 0.8, rand(0.02, 0.05) * sz, 0.8, 0.9, 1, 0.6, sz * 7, 0, 0.5);
  }
}

// ---------- sound ----------
let fallSound = null, wind = null;
const sfx = {
  scream: () => { const f = rand(900, 1300); tone(f, f * 0.45, 0.9, 'triangle', 0.05); tone(f * 1.5, f * 0.6, 0.9, 'sine', 0.025); },
  boing: () => tone(220, 520, 0.18, 'sine', 0.08),
  chime: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, f, 0.6, 'triangle', 0.04, i * 0.08)),
  owl: () => { tone(420, 380, 0.35, 'sine', 0.05); tone(400, 360, 0.5, 'sine', 0.05, 0.45); },
};

// ---------- the head ----------
const H = { x: 0, y: 0, w: 160, roll: 0, rollV: 0, yaw: 0, pitch0: null, pitch: 0, pv: 0, seen: false, lost: 0, eyes: 0, nodCD: 0 };
const cheer = { v: 0 };
const people = [], falls = { n: 0 };
let spawnT = 0, slosh = { x: 0, z: 0, vx: 0, vz: 0 }, hint = 0;

function updateHead(dt, fresh) {
  const Fc = T.face;
  if (Fc.ok) {
    H.lost = 0;
    const k = Math.min(1, dt * 14);
    const target = { x: Fc.top.x, y: Fc.top.y };
    if (!H.seen) { H.x = target.x; H.y = target.y; H.w = Fc.w; H.seen = true; island.visible = true; }
    H.x = lerp(H.x, target.x, k); H.y = lerp(H.y, target.y, k); H.w = lerp(H.w, Fc.w, Math.min(1, dt * 4));
    const prevRoll = H.roll; H.roll = angLerp(H.roll, Fc.roll, Math.min(1, dt * 12)); H.rollV = lerp(H.rollV, (H.roll - prevRoll) / Math.max(dt, 1e-3), 0.3);
    H.yaw = lerp(H.yaw, clamp(Fc.yaw, -1, 1), Math.min(1, dt * 8));
    if (H.pitch0 == null) H.pitch0 = Fc.pitch;
    H.pitch0 = lerp(H.pitch0, Fc.pitch, dt * 0.15); // slow baseline = your neutral
    const p = Fc.pitch - H.pitch0, pv = (p - H.pitch) / Math.max(dt, 1e-3); H.pitch = p; H.pv = lerp(H.pv, pv, 0.5);
    const bs = Fc.bs;
    H.eyes = Math.min(bs.eyeBlinkLeft ?? 0, bs.eyeBlinkRight ?? 0);
    H.smile = ((bs.mouthSmileLeft ?? 0) + (bs.mouthSmileRight ?? 0)) / 2;
  } else H.lost += dt;
}

const app = {
  name: 'head-world', need: { face: true }, loading: 'Growing your island…',
  start() {
    scene.add(island); island.visible = false;
    for (let i = 0; i < 6; i++) people.push(new Person(i));
    wind = loopNoise(400, 'lowpass'); fallSound = loopNoise(1800, 'bandpass');
    toast('Look at the camera 🙂', 3);
    window.__world = { H, people, night, cheer, island };
  },
  update(dt, fresh) {
    updateHead(dt, fresh);
    if (!H.seen) return;
    const t = S.t;
    island.visible = H.lost < 1.5;
    // pose the island: float above the head, roll with it, turn a little with your yaw
    const R = H.w * 0.62, lift = H.w * 0.42 + Math.sin(t * 1.3) * H.w * 0.025;
    const up = { x: Math.sin(H.roll), y: -Math.cos(H.roll) };
    const cx = H.x + up.x * lift, cy = H.y + up.y * lift;
    island.position.set(cx, S.H - cy, 0); island.scale.setScalar(R);
    island.rotation.z = -H.roll + Math.sin(t * 0.9) * 0.02;
    yawG.rotation.y = H.yaw * 0.9 + Math.sin(t * 0.4) * 0.05;
    tiltG.rotation.x = 0.42 + clamp(H.pitch * 1.5, -0.25, 0.35);
    shadow.position.set(H.x, S.H - H.y - H.w * 0.08, -10); shadow.scale.set(H.w * 1.1, H.w * 0.3, 1); shadow.material.rotation = -H.roll;
    shadow.material.opacity = 0.35 * (island.visible ? 1 : 0);
    // gravity along the island: roll tips it sideways, a nod tips it toward you
    const acc = { x: Math.sin(H.roll) * 3.2, z: clamp(H.pitch * 6, -2, 2) };
    // nod → everyone bounces
    H.nodCD -= dt;
    if (Math.abs(H.pv) > 1.6 && H.nodCD < 0) {
      H.nodCD = 0.45; sfx.boing();
      for (const p of people) if (p.state !== 'fall' && !p.inside) p.vy = rand(1.0, 1.6) * clamp(Math.abs(H.pv) / 2, 0.8, 1.6);
      if (++hint === 1) toast('Boing!');
    }
    // smile → rainbow + cheering; long blink → night
    cheer.v = damp(cheer.v, (H.smile ?? 0) > 0.55 ? 1 : 0, 4, dt);
    rainbow.material.uniforms.a.value = cheer.v;
    if (cheer.v > 0.7 && Math.random() < dt * 6) for (const p of people) if (p.y === 0 && p.state !== 'fall' && Math.random() < 0.4) p.vy = rand(0.7, 1.1);
    H.closedT = H.eyes > 0.55 ? (H.closedT || 0) + dt : 0;
    if (H.closedT > 0.7 && night.goal === 0) { night.goal = 1; sfx.owl(); toast('Goodnight, island 🌙'); }
    if (H.eyes < 0.3 && night.goal === 1 && H.closedT === 0) { night.goal = 0; sfx.chime(); toast('Good morning ☀️'); }
    night.v = damp(night.v, night.goal, 1.6, dt);
    const dim = new THREE.Color(0.3, 0.36, 0.62);
    for (const m of mats) if (m.userData.base) m.color.copy(m.userData.base).lerp(m.userData.base.clone().multiply(dim), night.v);
    MAT.win.emissiveIntensity = night.v * 2.4; lamp.intensity = night.v * 1.2;
    if (night.v > 0.4 && Math.random() < dt * 14) { // fireflies
      island.updateMatrixWorld(true); const a = rand(0, Math.PI * 2), r = rand(0.2, 1.2), w = world.localToWorld(new THREE.Vector3(Math.cos(a) * r, rand(0.15, 0.6), Math.sin(a) * r));
      glitter.emit(w.x, S.H - w.y, rand(-10, 10), rand(-10, 10), rand(1, 2), rand(3, 6), 1, 0.9, 0.4, night.v);
    }
    if (night.v > 0.3 && Math.random() < dt * 3) { // chimney smoke
      island.updateMatrixWorld(true); const w = chimney.getWorldPosition(new THREE.Vector3());
      glitter.emit(w.x, S.H - w.y - 4, rand(-4, 4), -rand(10, 20), 2.2, R * 0.1, 0.5, 0.5, 0.6, 0.35, -2, 2);
    }
    // life on the island
    blades.rotation.z -= dt * (1.5 + Math.abs(H.rollV) * 2 + cheer.v * 4);
    for (const tr of trees) tr.rotation.z = Math.sin(t * 1.7 + tr.userData.sway) * 0.04 - acc.x * 0.05;
    for (const c of clouds) { const u = c.userData; u.a += u.sp * dt; c.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(t + u.a) * 0.03, Math.sin(u.a) * u.r * 0.7); }
    world.children.forEach((m) => { if (m.userData.crumb != null) m.position.y += Math.sin(t * 1.5 + m.userData.crumb) * 0.0008; });
    // the pond sloshes against the tilt
    slosh.vx += (-acc.x * 0.09 - slosh.x) * 30 * dt - slosh.vx * 3 * dt; slosh.x += slosh.vx * dt;
    slosh.vz += (acc.z * 0.09 - slosh.z) * 30 * dt - slosh.vz * 3 * dt; slosh.z += slosh.vz * dt;
    pond.rotation.set(-Math.PI / 2 + slosh.z, slosh.x, 0);
    // waterfall (always) + spills off the low edge when you tilt
    emitWater(FALL_LOCAL, Math.random() < 0.6 ? 2 : 1, R, R * 0.4);
    const tiltAmt = Math.max(0, Math.abs(H.roll) - 0.18);
    if (tiltAmt > 0) {
      const side = Math.sign(H.roll), n = Math.min(14, Math.ceil(tiltAmt * 50));
      for (let i = 0; i < n; i++) { const z = rand(-0.5, 0.6); emitWater(new THREE.Vector3(side * Math.sqrt(1 - z * z) * 0.98, 0.1, z), 1, R, R * 0.9); }
      if (!H.spillHint) { H.spillHint = true; toast('Careful! 😱'); }
    }
    if (Math.abs(H.pitch) > 0.12) for (let i = 0; i < Math.min(8, Math.abs(H.pitch) * 30); i++) { const x = rand(-0.6, 0.6); emitWater(new THREE.Vector3(x, 0.1, Math.sign(H.pitch) * Math.sqrt(1 - x * x) * 0.98), 1, R, R * 0.6); }
    water.update(dt); spray.update(dt);
    // people
    for (const p of people) p.update(dt, acc);
    for (let i = people.length - 1; i >= 0; i--) if (people[i].dead) people.splice(i, 1);
    const onIsland = people.filter((p) => p.state !== 'fall').length;
    spawnT -= dt;
    if (onIsland < 6 && spawnT < 0 && Math.abs(H.roll) < 0.2) { spawnT = 1.4; people.push(new Person(Math.floor(rand(0, 99)), true)); }
    const falling = people.some((p) => p.state === 'fall');
    fallSound?.set(Math.min(0.12, tiltAmt * 0.4) + 0.015, 1400 + tiltAmt * 2000);
    wind?.set(falling ? 0.06 : 0.01, 500);
  },
  command(c) {
    if (c === 'night') { night.goal = night.goal ? 0 : 1; c = null; (night.goal ? sfx.owl : sfx.chime)(); }
    if (c === 'party') { cheer.v = 1; sfx.chime(); for (const p of people) p.vy = 1.4; burst(H.x, H.y - H.w, H.w * 0.4, 80); }
    if (c === 'people') for (let i = 0; i < 3; i++) people.push(new Person(Math.floor(rand(0, 99)), true));
  },
};
boot(app);
