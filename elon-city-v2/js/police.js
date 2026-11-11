// Wanted level: ElonPD cruisers chase and ram, officers stun and arrest, drones join at four stars.
import { V3, G, clamp, rnd, pick, wrapA, onUpdate, bus, clearLine } from './core.js';
import { nodes } from './world.js';
import { vehicles, spawnVehicle, removeVehicle, startAI, fwdVec, nearestVehicle } from './vehicles.js';
import { peds, spawnPed, removePed } from './peds.js';
import { drones, spawnDrone, removeDrone } from './drones.js';
import { bolt } from './fx.js';
import { sfx } from './audio.js';

const STARS = [0, 8, 35, 80, 150, 240];
let unseen = 0;

G.crime = n => {
  if (G.mode === 'dead' || G.mode === 'cutscene' || G.noCops) return;
  const before = G.stars;
  G.heat = Math.min(320, G.heat + n);
  G.stars = STARS.reduce((s, t, i) => (G.heat >= t ? i : s), 0);
  unseen = 0;
  if (G.stars > before) {
    sfx.star();
    if (before === 0) bus.toast('ElonPD is on to you');
  }
};
G.setStars = n => {
  G.heat = Math.max(G.heat, STARS[n] + 1);
  G.stars = Math.max(G.stars, n);
  unseen = 0;
};
G.clearWanted = () => {
  G.heat = 0;
  G.stars = 0;
  unseen = 0;
  // Cops go back to patrolling or walk off.
  for (const v of vehicles) if (v.driver === 'cop') {
    v.siren = false;
    v.chase = false;
    v.driver = 'ai';
    startAI(v, nodes.reduce((b, n) => (Math.hypot(n.x - v.pos.x, n.z - v.pos.z) < Math.hypot(b.x - v.pos.x, b.z - v.pos.z) ? n : b)));
    v.mission = null;
  }
  for (const p of peds) if (p.kind === 'cop' && p.state !== 'dead') p.state = 'leave';
  for (const d of [...drones]) if (d.police) removeDrone(d);
};
G.unseen = () => unseen;

/* ---------------- officers on foot ---------------- */
let arrest = 0;
G.copStep = (p, dt) => {
  const me = G.playerTarget();
  const dx = me.x - p.pos.x, dz = me.z - p.pos.z, d = Math.hypot(dx, dz);
  if (p.state === 'leave') {
    p.yaw += wrapA(Math.atan2(-dx, -dz) - p.yaw) * Math.min(1, dt * 5);
    if (d > 90) removePed(p);
    return { speed: 2.5, pose: 'stand' };
  }
  p.state = 'chase';
  p.yaw += wrapA(Math.atan2(dx, dz) - p.yaw) * Math.min(1, dt * 6);
  p.cool = (p.cool ?? rnd(0.5, 1.5)) - dt;
  let speed = d > 2 ? 5.6 : 0;
  let pose = 'stand';
  // Stun from a distance once things are serious.
  if (G.stars >= 2 && d < 20 && d > 2.5 && G.mode !== 'dead' && clearLine(p.pos.x, p.pos.z, me.x, me.z)) {
    pose = 'aim';
    speed = d > 12 ? 4 : 0;
    if (p.cool <= 0) {
      p.cool = rnd(1.1, 1.8);
      const miss = Math.random() < 0.4;
      bolt(p.pos.clone().setY(1.4), me.clone().add(new V3(miss ? rnd(-2, 2) : 0, 0, miss ? rnd(-2, 2) : 0)), 0x9fd0ff);
      sfx.taser();
      if (!miss) G.hurtPlayer(6, p.pos);
    }
  }
  // Close enough to cuff you while you're on foot (or sitting still in a car) at low stars.
  const still = G.mode === 'foot' || (G.mode === 'car' && G.car && G.car.vel.length() < 1.5);
  if (d < 2.4 && still && G.stars <= 2) {
    arrest += dt;
    if (arrest > 1.4) {
      arrest = 0;
      G.busted();
    }
  }
  return { speed, pose };
};

const deployOfficers = v => {
  if (v.deployed) return;
  v.deployed = true;
  for (let k = 0; k < (G.stars >= 3 ? 2 : 1); k++) {
    const side = k ? 1 : -1;
    const p = spawnPed(v.pos.x - Math.cos(v.yaw) * 2 * side, v.pos.z + Math.sin(v.yaw) * 2 * side, { kind: 'cop', state: 'chase', hp: 60 });
    p.kind = 'cop';
  }
  v.driver = null;
  v.chase = false;
};

/* ---------------- cruisers ---------------- */
const chase = (v, dt) => {
  const me = G.playerTarget();
  const tv = G.mode === 'car' && G.car ? G.car.vel : new V3();
  // Aim a little ahead of where you're going.
  const lead = me.clone().addScaledVector(tv, 0.6);
  const dx = lead.x - v.pos.x, dz = lead.z - v.pos.z, d = Math.hypot(dx, dz);
  const err = wrapA(Math.atan2(dx, dz) - v.yaw);
  const fwd = v.vel.dot(fwdVec(v.yaw, new V3()));
  v.input.steer = clamp(err * 2.5, -1, 1);
  v.input.throttle = Math.abs(err) > 2 && fwd < 4 ? -1 : d < 9 && G.mode === 'foot' ? -0.6 : 1;
  v.input.handbrake = Math.abs(err) > 1 && fwd > 12;
  v.input.boost = false;
  // Stuck: back off and swing round.
  v.stuck = fwd < 1 && v.input.throttle > 0 ? (v.stuck || 0) + dt : 0;
  if (v.stuck > 1.5) {
    v.input.throttle = -1;
    v.input.steer = -v.input.steer;
    if (v.stuck > 3) v.stuck = 0;
  }
  if (G.mode === 'foot' && d < 14 && fwd < 6) deployOfficers(v);
};

let spawnT = 0;
onUpdate(dt => {
  if (!G.started || G.mode === 'cutscene') return;
  const me = G.playerTarget();
  const cops = vehicles.filter(v => v.driver === 'cop' && !v.dead);
  for (const v of cops) chase(v, dt);

  if (G.stars === 0) {
    arrest = 0;
    return;
  }
  // Can any of them see you?
  let seen = false;
  for (const v of cops) if (v.pos.distanceTo(me) < 90 && clearLine(v.pos.x, v.pos.z, me.x, me.z)) seen = true;
  for (const p of peds) if (p.kind === 'cop' && p.state === 'chase' && p.pos.distanceTo(me) < 60 && clearLine(p.pos.x, p.pos.z, me.x, me.z)) seen = true;
  for (const d of drones) if (d.police && !d.dead && d.pos.distanceTo(me) < 80) seen = true;
  if (G.hide > 0) seen = false;
  unseen = seen ? 0 : unseen + dt * (G.hide > 0 ? 3 : 1);
  if (unseen > 7 + G.stars * 3) {
    G.clearWanted();
    bus.toast('You lost ElonPD');
    sfx.coin();
    return;
  }
  if (!seen) arrest = 0;

  // Keep enough of them on you.
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = 2.5;
    const want = [0, 1, 2, 3, 4, 5][G.stars];
    if (cops.length < want) {
      const far = nodes.filter(n => {
        const d = Math.hypot(n.x - me.x, n.z - me.z);
        return d > 70 && d < 170;
      });
      if (far.length) {
        const n = pick(far);
        const v = spawnVehicle('police', n.x, n.z, Math.atan2(me.x - n.x, me.z - n.z), { driver: 'cop' });
        v.siren = true;
        v.chase = true;
      }
    }
    const wantDrones = G.stars >= 4 || (G.car?.flying && G.stars >= 2) ? (G.stars - 2) * 2 : 0;
    const have = drones.filter(d => d.police && !d.dead).length;
    if (have < wantDrones) spawnDrone(me.x + rnd(-60, 60), me.z + rnd(-60, 60), { police: true, y: 30 });
  }
  for (const v of cops) if (v.pos.distanceTo(me) > 320) removeVehicle(v);
}, 35);
