// Drones: rogue delivery drones (missions, jobs) and ElonPD drones (four stars and up).
import { THREE, V3, scene, G, clamp, rnd, onUpdate, damp, clearLine } from './core.js';
import { explode, burning, bolt, sparks } from './fx.js';
import { sfx } from './audio.js';

export const drones = [];
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x24262c, metalness: 0.6, roughness: 0.35 });
const armMat = new THREE.MeshStandardMaterial({ color: 0x3a3d45, metalness: 0.5, roughness: 0.4 });
const rotorMat = new THREE.MeshBasicMaterial({ color: 0x99a0aa, transparent: true, opacity: 0.35 });

export const spawnDrone = (x, z, opts = {}) => {
  const g = new THREE.Group();
  const police = opts.police;
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 0.35, 1), bodyMat);
  b.castShadow = true;
  g.add(b);
  const eyeCol = police ? 0x3a8bff : 0xff2a3a;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(eyeCol).multiplyScalar(3), toneMapped: false }));
  eye.position.set(0, -0.1, 0.5);
  g.add(eye);
  // A parcel under the delivery ones.
  if (!police) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), new THREE.MeshStandardMaterial({ color: 0xc89a5a }));
    box.position.y = -0.45;
    g.add(box);
  }
  const rotors = [];
  for (const [ax, az] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.1), armMat);
    arm.position.set(ax * 0.45, 0.1, az * 0.45);
    arm.rotation.y = Math.atan2(ax, az);
    g.add(arm);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 16), rotorMat);
    r.position.set(ax * 0.8, 0.2, az * 0.8);
    g.add(r);
    rotors.push(r);
  }
  g.position.set(x, opts.y ?? 12, z);
  scene.add(g);
  const d = { g, pos: g.position, vel: new V3(), hp: police ? 40 : 30, police, fire: 0, dead: false, cool: rnd(1, 3), t: 0, mission: opts.mission ?? null, home: new V3(x, 0, z), seed: rnd(0, 6) };
  drones.push(d);
  return d;
};

export const removeDrone = d => {
  scene.remove(d.g);
  const i = drones.indexOf(d);
  if (i >= 0) drones.splice(i, 1);
};

export const hurtDrone = (d, amt, by) => {
  if (d.dead) return;
  d.hp -= amt;
  sparks(d.pos, 4);
  if (by === 'player' && d.police) G.crime?.(10);
  if (d.hp <= 0) {
    d.dead = true;
    d.vel.set(rnd(-3, 3), 2, rnd(-3, 3));
    G.onDroneDown?.(d, by);
  }
};

onUpdate(dt => {
  if (!G.started) return;
  const me = G.playerPos;
  for (const d of [...drones]) {
    d.t += dt;
    for (const [i, r] of d.g.children.entries()) if (r.material === rotorMat) r.rotation.y += dt * 40;
    if (d.dead) {
      // Spin and fall, then blow up on the ground.
      d.vel.y -= 20 * dt;
      d.pos.addScaledVector(d.vel, dt);
      d.g.rotation.x += dt * 4;
      d.g.rotation.z += dt * 3;
      burning(d.pos, 1);
      if (d.pos.y <= 0.3) {
        explode(d.pos.clone(), 0.5);
        sfx.boom(0.5);
        G.onExplosion?.(d.pos, 4, d);
        removeDrone(d);
      }
      continue;
    }
    if (d.fire > 0) {
      d.fire += dt;
      burning(d.pos, 1);
      d.hp -= dt * 14;
      if (d.hp <= 0) hurtDrone(d, 0.1, d.firedBy);
    }
    if (!me) continue;
    const target = G.playerTarget();
    const dist = d.pos.distanceTo(target);
    // Circle the player at a distance, bob, and fire when there's a clear shot.
    const a = d.t * 0.6 + d.seed;
    const want = target.clone().add(new V3(Math.cos(a) * 9, (d.police ? 7 : 5) + Math.sin(d.t * 1.7) * 1.2, Math.sin(a) * 9));
    if (dist > 70) want.copy(target).setY(14);
    const acc = want.sub(d.pos).multiplyScalar(1.4);
    d.vel.addScaledVector(acc, dt);
    d.vel.multiplyScalar(Math.exp(-1.6 * dt));
    const max = d.police ? 26 : 20;
    if (d.vel.length() > max) d.vel.setLength(max);
    d.pos.addScaledVector(d.vel, dt);
    d.pos.y = Math.max(3, d.pos.y);
    d.g.rotation.y = Math.atan2(target.x - d.pos.x, target.z - d.pos.z);
    d.g.rotation.x = damp(d.g.rotation.x, clamp(d.vel.length() * 0.02, 0, 0.3), 4, dt);
    d.cool -= dt;
    if (d.cool <= 0 && dist < 30 && G.mode !== 'dead' && clearLine(d.pos.x, d.pos.z, target.x, target.z)) {
      d.cool = d.police ? rnd(1.2, 2) : rnd(1.8, 3);
      const miss = Math.random() < 0.35;
      const at = target.clone().add(new V3(miss ? rnd(-3, 3) : 0, miss ? 0 : 0.6, miss ? rnd(-3, 3) : 0));
      bolt(d.pos.clone(), at, d.police ? 0x7fb2ff : 0xff6a6a);
      sfx.zap();
      if (!miss) G.hurtPlayer?.(d.police ? 7 : 5, d.pos);
    }
  }
}, 45);
