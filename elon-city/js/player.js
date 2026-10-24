// You: walking, driving, flying, fighting; the camera; dying and starting again; pickups, tunnels, respray.
import { THREE, V3, scene, camera, G, keys, hit, touch, look, bus, clamp, lerp, rnd, wrapA, damp, collide, onUpdate, solids, IS_MOBILE } from './core.js';
import { places, isLand, followSun, HALF } from './world.js';
import { vehicles, nearestVehicle, hurtVehicle, fwdVec, rightVec, removeVehicle } from './vehicles.js';
import { makeHuman, animHuman, peds, hurtPed, setOnFire, panic, spawnPed } from './peds.js';
import { drones, hurtDrone } from './drones.js';
import { flame, bolt, beam, explode, sparks, splash, shake, addShake, dust, flareTrail } from './fx.js';
import { sfx, audioFrame, nextStation } from './audio.js';

export const WEAPONS = [
  { name: 'Fists', icon: '✊' },
  { name: 'Not-a-Flamethrower', icon: '🔥' },
  { name: 'Tesla Coil Gun', icon: '⚡' },
  { name: 'Starlink Strike', icon: '🛰' },
  { name: 'Flare Gun', icon: '🎇' },
];

const me = { pos: places.spawn.clone(), yaw: Math.PI, vy: 0, speed: 0, punch: 0, coolCoil: 0, coolStrike: 0, hurtT: 0, swim: 0, deadT: 0, portalCool: 0, lastHit: 0 };
const body = makeHuman({ kind: 'player' });
G.playerPos = me.pos;
G.me = me;
G.playerTarget = () => (G.mode === 'car' && G.car ? G.car.pos.clone().setY(G.car.pos.y + 1) : me.pos.clone().setY(1.2));

// The flamethrower in your hands: a short black tube.
const gun = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.35 });
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.75, 12), metal);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 0.25;
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xb02a2a, metalness: 0.4, roughness: 0.4 }));
  tank.position.set(0, -0.08, 0.05);
  gun.add(tube, tank);
  scene.add(gun);
}
// The flare gun: a chunky orange pistol with a wide barrel.
const flareGun = new THREE.Group();
{
  const orange = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.45 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 14), orange);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.14;
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
  grip.position.set(0, -0.1, 0);
  grip.rotation.x = -0.3;
  flareGun.add(barrel, grip);
  flareGun.visible = false;
  scene.add(flareGun);
}
const _hand = new V3();
// The gun sits in the right hand and points where you aim.
const placeGun = () => {
  if (!gun.visible && !flareGun.visible) return;
  if (body.hand) body.hand.getWorldPosition(_hand);
  else _hand.copy(me.pos).add(new V3(0.3, 1.1, 0.3));
  for (const g of [gun, flareGun]) {
    g.position.copy(_hand);
    g.rotation.set(0, me.yaw, 0);
  }
};

/* ---------------- damage and death ---------------- */
G.hurtPlayer = (amt, from) => {
  if (G.mode === 'dead' || G.mode === 'cutscene') return;
  if (G.mode === 'car' && G.car && amt < 20) amt *= 0.4;
  const a = Math.min(G.armor, amt * 0.7);
  G.armor -= a;
  G.health -= amt - a;
  me.hurtT = 0.4;
  me.lastHit = G.t;
  bus.hurt?.();
  if (G.health <= 0) die('wasted');
};

const die = why => {
  if (G.mode === 'dead') return;
  if (G.car) leaveCar(true);
  G.mode = 'dead';
  G.health = 0;
  me.deadT = 0;
  me.why = why;
  if (why === 'wasted') {
    sfx.wasted();
    bus.big('RAPID UNSCHEDULED DISASSEMBLY', 'You were wasted. The Gigafactory clinic put you back together.', '#ff3355', 4.5);
  } else {
    sfx.fail();
    bus.big('ACCOUNT SUSPENDED', 'ElonPD busted you. Bail and your ammo are gone.', '#4da3ff', 4.5);
  }
  G.mission?.fail?.(why === 'wasted' ? 'You were wasted.' : 'You were busted.');
};
G.busted = () => die('busted');

const respawn = () => {
  const busted = me.why === 'busted';
  const at = busted ? places.police : places.giga;
  me.pos.copy(at).add(new V3(rnd(-3, 3), 0, 4));
  me.vy = 0;
  me.yaw = 0;
  G.health = 100;
  G.armor = 0;
  G.money = Math.max(0, G.money - (busted ? 500 : 200));
  if (busted) G.ammo = G.ammo.map((a, i) => (i === 0 || i === 3 ? a : 0));
  G.clearWanted?.();
  G.mode = 'foot';
  body.root.visible = true;
  look.yaw = 0;
};

/* ---------------- getting in and out ---------------- */
const enterCar = v => {
  // Driverless Cybercab: hop in the back and it keeps driving wherever it was going.
  if (v.type === 'cybercab' && v.driver === 'ai' && v.ai && !v.mission) {
    G.ride = v;
    v.passenger = true;
    v.stopReq = false;
    v.rideFrom = v.pos.clone();
    v.rideDist = 0;
    G.car = v;
    G.mode = 'car';
    body.root.visible = false;
    sfx.door();
    look.idle = 99;
    bus.vehicle?.(v);
    bus.toast(IS_MOBILE ? 'Robotaxi: enjoy the ride. ENTER to stop, FLY to take the wheel' : 'Robotaxi: enjoy the ride. F to stop and get out, T to take the wheel', 4);
    return;
  }
  if (v.driver === 'ai') {
    // Carjacking: the driver is pulled out and runs.
    v.driver = null;
    v.ai = null;
    const p = G.bail(v);
    hurtPed(p, 0, v.pos);
    G.crime?.(3);
    bus.toast(`Took a ${v.name}`);
  } else if (v.driver === 'cop') {
    v.driver = null;
    v.ai = null;
    G.bail(v);
    G.crime?.(25);
  }
  v.driver = 'player';
  v.ai = null;
  v.siren = false;
  G.car = v;
  G.mode = 'car';
  body.root.visible = false;
  sfx.door();
  look.idle = 99;
  bus.vehicle?.(v);
  if (v.spec.canFly && !G.flyHint) {
    G.flyHint = true;
    bus.toast(IS_MOBILE ? 'Roadster: tap FLY to take off' : 'Roadster: press G to fly, Space up, C down');
  }
  G.onEnter?.(v);
};

const leaveCar = (force = false) => {
  const v = G.car;
  if (!v) return;
  if (G.ride === v) {
    // Pull over first unless we must jump out.
    if (!force && v.vel.length() > 1.2) {
      if (!v.stopReq) bus.toast('Robotaxi pulling over…');
      v.stopReq = true;
      return;
    }
    const fare = Math.min(G.money, 5 + Math.round(v.rideDist * 0.08));
    G.money -= fare;
    bus.toast(`Robotaxi fare $${fare}. Thanks for riding!`);
    v.passenger = false;
    v.stopReq = false;
    G.ride = null;
    const side = rightVec(v.yaw, new V3()).multiplyScalar(v.spec.wid / 2 + 0.9);
    me.pos.copy(v.pos).add(side).setY(0);
    me.yaw = v.yaw;
    G.car = null;
    G.mode = 'foot';
    body.root.visible = true;
    sfx.door();
    bus.vehicle?.(null);
    return;
  }
  if (!force && v.pos.y > 2.5) {
    bus.toast('Land first: hold C to come down');
    return;
  }
  const side = rightVec(v.yaw, new V3()).multiplyScalar(-(v.spec.wid / 2 + 0.9));
  me.pos.copy(v.pos).add(side).setY(0);
  me.yaw = v.yaw;
  v.driver = null;
  v.input.throttle = v.input.steer = 0;
  v.input.boost = false;
  v.input.up = 0;
  if (v.flying && v.pos.y < 2.5) v.flying = false;
  G.car = null;
  G.mode = 'foot';
  body.root.visible = true;
  sfx.door();
  bus.vehicle?.(null);
  G.onExit?.(v);
};
G.leaveCar = leaveCar;
G.enterCar = enterCar;

/* ---------------- explosions hurt everything nearby ---------------- */
G.onExplosion = (at, r, src) => {
  panic(at, 45);
  for (const p of peds) {
    const d = p.pos.distanceTo(at);
    if (d < r) hurtPed(p, 120 * (1 - d / r), at, src?.byPlayer ? 'player' : null, 12 * (1 - d / r));
  }
  for (const v of vehicles) {
    if (v === src) continue;
    const d = v.pos.distanceTo(at);
    if (d < r * 1.2) {
      hurtVehicle(v, 70 * (1 - d / (r * 1.2)), src?.byPlayer ? 'player' : null);
      v.vy += 6 * (1 - d / (r * 1.2));
      v.vel.add(v.pos.clone().sub(at).setY(0).normalize().multiplyScalar(10 * (1 - d / (r * 1.2))));
    }
  }
  for (const dr of drones) if (dr.pos.distanceTo(at) < r) hurtDrone(dr, 80, src?.byPlayer ? 'player' : null);
  const mine = G.playerTarget().distanceTo(at);
  if (mine < r) G.hurtPlayer(70 * (1 - mine / r), at);
};

/* ---------------- weapons ---------------- */
const aimDir = () => new V3(Math.sin(look.yaw), -0.08 + (0.28 - look.pitch) * 0.6, Math.cos(look.yaw)).normalize();
const handPos = () => me.pos.clone().add(new V3(0, 1.35, 0)).addScaledVector(fwdVec(me.yaw, new V3()), 0.7);

// Everything you can hit, for aiming and flames.
const targets = () => {
  const out = [];
  for (const p of peds) if (p.state !== 'dead') out.push({ kind: 'ped', o: p, at: p.pos.clone().setY(1.1) });
  for (const v of vehicles) if (!v.dead && v !== G.car) out.push({ kind: 'car', o: v, at: v.pos.clone().setY(v.pos.y + 1) });
  for (const d of drones) if (!d.dead) out.push({ kind: 'drone', o: d, at: d.pos.clone() });
  return out;
};

const autoAim = (from, dir, range, cone) => {
  let best = null, bs = -Infinity;
  for (const t of targets()) {
    const to = t.at.clone().sub(from);
    const d = to.length();
    if (d > range) continue;
    const c = to.normalize().dot(dir);
    if (c < Math.cos(cone)) continue;
    const score = c * 2 - d / range + (t.kind === 'drone' ? 0.6 : 0) + (t.o.mission ? 0.5 : 0);
    if (score > bs) {
      bs = score;
      best = t;
    }
  }
  return best;
};

const fireFlame = dt => {
  if (G.ammo[1] <= 0) {
    if (hit('Mouse0') || touch.firePressed) bus.toast('Out of fuel: find a Boring Co. crate');
    return false;
  }
  G.ammo[1] = Math.max(0, G.ammo[1] - dt * 7);
  const dir = aimDir();
  flame(handPos(), dir);
  for (const t of targets()) {
    const to = t.at.clone().sub(me.pos.clone().setY(1.2));
    const d = to.length();
    if (d > 12 || to.normalize().dot(dir) < 0.88) continue;
    if (t.kind === 'ped') {
      setOnFire(t.o, 'player');
      hurtPed(t.o, dt * 20, me.pos, 'player');
    } else if (t.kind === 'car') {
      hurtVehicle(t.o, dt * 22, 'player');
      if (t.o.driver === 'ai' && t.o.ai) t.o.ai.angry = 3;
    } else if (t.kind === 'drone') {
      t.o.fire = Math.max(t.o.fire, 0.01);
      t.o.firedBy = 'player';
      hurtDrone(t.o, dt * 30, 'player');
    }
  }
  if (Math.random() < dt * 4) panic(me.pos, 25);
  return true;
};

const fireCoil = () => {
  if (me.coolCoil > 0) return;
  if (G.ammo[2] <= 0) return bus.toast('Coil gun empty');
  me.coolCoil = 0.32;
  G.ammo[2]--;
  const from = handPos(), dir = aimDir();
  const t = autoAim(from, dir, 45, 0.45);
  const to = t ? t.at : from.clone().addScaledVector(dir, 40);
  bolt(from, to);
  sfx.zap();
  if (!t) return;
  if (t.kind === 'ped') hurtPed(t.o, 45, me.pos, 'player', 5);
  else if (t.kind === 'car') hurtVehicle(t.o, 18, 'player');
  else hurtDrone(t.o, 40, 'player');
  panic(to, 30);
};

// Flare gun: a burning flare arcs out, sticks, sets people alight and bursts. Rogue robots go down in two.
const flares = [];
const GRAV = 9;
const fireFlare = () => {
  if (me.coolFlare > 0) return;
  if (G.ammo[4] <= 0) return bus.toast('Out of flares: rogue robots drop them');
  me.coolFlare = 0.6;
  G.ammo[4]--;
  const from = G.mode === 'car' ? G.car.pos.clone().setY(G.car.pos.y + G.car.spec.h + 0.6) : handPos();
  const dir = G.mode === 'car' ? fwdVec(G.car.yaw, new V3()).setY(0.05).normalize() : aimDir();
  const speed = 42;
  const vel = dir.clone().multiplyScalar(speed);
  // Lob it onto whatever you are roughly pointing at.
  const t = autoAim(from, dir, 70, 0.3);
  if (t) {
    const to = t.at.clone().sub(from);
    const time = to.length() / speed;
    vel.copy(to).divideScalar(time);
    vel.y += 0.5 * GRAV * time;
  } else vel.y += 3;
  const light = new THREE.PointLight(0xff3050, 60, 22, 1.6);
  light.position.copy(from);
  scene.add(light);
  flares.push({ pos: from.clone(), vel, life: 4, light, by: G.mode === 'car' ? G.car : null });
  sfx.flare();
  panic(me.pos, 20);
};
const burstFlare = (f, direct) => {
  const at = f.pos.clone();
  scene.remove(f.light);
  f.light.dispose();
  explode(at, 0.4);
  sparks(at, 30, 0xff3050);
  sfx.boom(0.55);
  addShake(0.25);
  if (direct?.kind === 'ped') {
    hurtPed(direct.o, direct.o.kind === 'bot' ? 45 : 30, at, 'player', 6);
    setOnFire(direct.o, 'player');
  } else if (direct?.kind === 'car') hurtVehicle(direct.o, 30, 'player');
  else if (direct?.kind === 'drone') hurtDrone(direct.o, 60, 'player');
  for (const p of peds) if (p.state !== 'dead' && p.pos.distanceTo(at) < 4) setOnFire(p, 'player');
  G.onExplosion(at, 4.5, { byPlayer: true });
};
const stepFlares = dt => {
  for (let i = flares.length - 1; i >= 0; i--) {
    const f = flares[i];
    f.life -= dt;
    f.vel.y -= GRAV * dt;
    f.pos.addScaledVector(f.vel, dt);
    f.light.position.copy(f.pos);
    f.light.intensity = 50 + Math.random() * 30;
    flareTrail(f.pos);
    let direct = null;
    for (const t of targets()) {
      if (t.o === f.by) continue;
      const r = t.kind === 'car' ? 2.2 : t.kind === 'drone' ? 1.6 : 1.1;
      if (t.at.distanceTo(f.pos) < r) {
        direct = t;
        break;
      }
    }
    const wall = solids.some(s => s.h > f.pos.y && f.pos.x > s.minx && f.pos.x < s.maxx && f.pos.z > s.minz && f.pos.z < s.maxz);
    if (direct || wall || f.pos.y < 0.15 || f.life <= 0) {
      burstFlare(f, direct);
      flares.splice(i, 1);
    }
  }
};

// Starlink Strike: mark a spot, and a beam from orbit lands on it.
const reticle = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.2, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fe0ff).multiplyScalar(2), transparent: true, side: THREE.DoubleSide, toneMapped: false }));
reticle.rotation.x = -Math.PI / 2;
reticle.visible = false;
scene.add(reticle);
let strike = null;
const fireStrike = () => {
  if (me.coolStrike > 0) return bus.toast(`Starlink recharging: ${Math.ceil(me.coolStrike)} s`);
  me.coolStrike = 9;
  const from = G.mode === 'car' ? G.car.pos : me.pos;
  const dir = fwdVec(G.mode === 'car' ? G.car.yaw : look.yaw, new V3());
  const t = autoAim(from.clone().setY(1.2), dir, 70, 0.6);
  const at = t ? t.at.clone().setY(0) : from.clone().addScaledVector(dir, 32).setY(0);
  strike = { at, t: 1.4, target: t };
  reticle.visible = true;
  sfx.blip();
  bus.toast('Starlink: strike incoming');
};
const stepStrike = dt => {
  if (!strike) return;
  strike.t -= dt;
  if (strike.target && !strike.target.o.dead) strike.at.copy(strike.target.o.pos).setY(0);
  reticle.position.copy(strike.at).setY(0.15);
  reticle.scale.setScalar(0.6 + strike.t * 0.4);
  reticle.material.opacity = 0.5 + 0.5 * Math.sin(G.t * 20);
  if (strike.t <= 0) {
    beam(strike.at.clone().setY(600), strike.at.clone(), 0x9fe8ff, 2.4, 1.2);
    explode(strike.at.clone().setY(1), 1.6);
    sfx.beam();
    sfx.boom(1.3);
    addShake(1.4);
    G.onExplosion(strike.at, 13, { byPlayer: true });
    strike = null;
    reticle.visible = false;
  }
};

const punch = () => {
  me.punch = 0.3;
  const f = fwdVec(me.yaw, new V3());
  for (const t of targets()) {
    const to = t.at.clone().sub(me.pos).setY(0);
    if (to.length() > 2 || to.normalize().dot(f) < 0.5) continue;
    sfx.punch();
    if (t.kind === 'ped') hurtPed(t.o, 18, me.pos, 'player', 3);
    else if (t.kind === 'car') hurtVehicle(t.o, 2, 'player');
    else hurtDrone(t.o, 10, 'player');
  }
};

const switchWeapon = d => {
  let w = G.weapon;
  const n = WEAPONS.length;
  for (let k = 0; k < n; k++) {
    w = (w + d + n) % n;
    if (G.weapons[w]) break;
  }
  G.weapon = w;
  bus.weapon?.();
};
G.switchWeapon = switchWeapon;

/* ---------------- pickups ---------------- */
export const pickups = [];
const PICK = {
  health: { color: 0x37e07a, label: 'Battery pack +40 health', icon: '🔋' },
  armor: { color: 0x7fb7ff, label: 'Armour glass +50', icon: '🛡' },
  fuel: { color: 0xff7a2a, label: 'Not-a-Flamethrower fuel', icon: '🔥' },
  coil: { color: 0xbfe6ff, label: 'Tesla Coil Gun +20 charges', icon: '⚡' },
  flare: { color: 0xff3050, label: 'Flares +6', icon: '🎇' },
  cash: { color: 0xffd23c, label: '', icon: '$' },
};
export const addPickup = (kind, at, opts = {}) => {
  const k = PICK[kind];
  const g = new THREE.Group();
  const m = new THREE.Mesh(kind === 'cash' ? new THREE.BoxGeometry(0.6, 0.3, 0.35) : new THREE.OctahedronGeometry(0.55), new THREE.MeshStandardMaterial({ color: k.color, emissive: k.color, emissiveIntensity: 1.2, roughness: 0.3 }));
  g.add(m);
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(k.color).multiplyScalar(1.5), transparent: true, opacity: 0.6, side: THREE.DoubleSide, toneMapped: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.7;
  g.add(halo);
  g.position.copy(at).setY(1);
  scene.add(g);
  const p = { kind, g, at: at.clone(), amount: opts.amount ?? 0, respawn: opts.respawn ?? 0, gone: 0, temp: !!opts.temp };
  pickups.push(p);
  return p;
};
const take = p => {
  const k = p.kind;
  if (k === 'health') {
    if (G.health >= 100) return false;
    G.health = Math.min(100, G.health + 40);
    sfx.heal();
  } else if (k === 'armor') {
    if (G.armor >= 100) return false;
    G.armor = Math.min(100, G.armor + 50);
    sfx.heal();
  } else if (k === 'fuel') {
    G.weapons[1] = true;
    G.ammo[1] = 100;
    sfx.coin();
  } else if (k === 'flare') {
    G.weapons[4] = true;
    G.ammo[4] = Math.min(40, G.ammo[4] + 6);
    sfx.coin();
  } else if (k === 'coil') {
    G.weapons[2] = true;
    G.ammo[2] = Math.min(99, G.ammo[2] + 20);
    sfx.coin();
  } else if (k === 'cash') {
    G.money += p.amount;
    sfx.coin();
  }
  bus.toast(k === 'cash' ? `+$${p.amount}` : PICK[k].label);
  if (k === 'fuel' || k === 'coil') {
    if (G.weapon === 0) G.weapon = k === 'fuel' ? 1 : 2;
    bus.weapon?.();
  }
  return true;
};
G.onPedDown = (p, by) => {
  if (p.kind === 'bot') return void addPickup('flare', p.pos.clone().add(new V3(0.8, 0, 0)), { temp: true });
  if (Math.random() < 0.6) addPickup('cash', p.pos, { amount: Math.round(rnd(5, 60)), temp: true });
  G.onKill?.(p, by);
};
// Fixed pickups around town, back a minute after you take them.
const spots = [
  ['health', places.giga.clone().add(new V3(-12, 0, 0))],
  ['health', places.park.clone().add(new V3(8, 0, -8))],
  ['health', places.police.clone().add(new V3(10, 0, 0))],
  ['health', places.starbase.clone().add(new V3(0, 0, 14))],
  ['armor', places.service.clone().add(new V3(14, 0, 8))],
  ['armor', places.starlink.clone().add(new V3(-12, 0, 0))],
  ['coil', places.starlink.clone().add(new V3(12, 0, 0))],
  ['coil', places.lot.clone().add(new V3(0, 0, 10))],
  ['flare', places.giga.clone().add(new V3(12, 0, -6))],
  ['flare', places.park.clone().add(new V3(-8, 0, 8))],
  ['flare', places.police.clone().add(new V3(-10, 0, 0))],
];
for (const [k, at] of spots) addPickup(k, at, { respawn: 60 });
export const unlockFlameCrate = () => addPickup('fuel', places.boring.clone().add(new V3(4, 0, 0)), { respawn: 40 });

const stepPickups = dt => {
  const p0 = G.playerTarget();
  for (const p of [...pickups]) {
    if (p.gone > 0) {
      p.gone -= dt;
      if (p.gone <= 0) p.g.visible = true;
      continue;
    }
    p.g.rotation.y += dt * 2;
    p.g.position.y = 1 + Math.sin(G.t * 3 + p.at.x) * 0.15;
    if (G.mode === 'dead' || Math.hypot(p0.x - p.at.x, p0.z - p.at.z) > (G.mode === 'car' ? 3 : 1.6) || p0.y > 4) continue;
    if (!take(p)) continue;
    if (p.respawn) {
      p.gone = p.respawn;
      p.g.visible = false;
    } else {
      scene.remove(p.g);
      pickups.splice(pickups.indexOf(p), 1);
    }
  }
};

/* ---------------- tunnels, respray, superchargers ---------------- */
const stepPlaces = dt => {
  me.portalCool -= dt;
  const at = G.playerTarget();
  if (me.portalCool <= 0 && at.y < 3)
    for (const [a, b] of [['portalA', 'portalB'], ['portalB', 'portalA']]) {
      const pa = places[a], pb = places[b];
      if (Math.hypot(at.x - pa.at.x, at.z - pa.at.z) > 3.6) continue;
      me.portalCool = 3;
      bus.flash?.('#000', 0.5);
      sfx.whoosh();
      const out = pb.out.clone();
      if (G.mode === 'car') {
        const v = G.car;
        const sp = Math.max(12, v.vel.length());
        v.pos.copy(out);
        v.yaw = pb.yaw;
        v.vel.copy(fwdVec(v.yaw, new V3())).multiplyScalar(sp);
        look.yaw = v.yaw;
      } else {
        me.pos.copy(out);
        me.yaw = pb.yaw;
        look.yaw = pb.yaw;
      }
      G.hide = 8;
      bus.toast('The Boring Company tunnel');
      G.onPortal?.();
      break;
    }
  if (G.mode === 'car' && G.car) {
    const v = G.car;
    if (v.pos.distanceTo(places.service) < 8 && v.pos.y < 2) {
      if (G.stars > 0 && !me.sprayed) {
        if (G.money >= 100) {
          G.money -= 100;
          G.clearWanted?.();
          const c = new THREE.Color().setHSL(Math.random(), 0.7, 0.45).getHex();
          v.root.traverse(o => o.isMesh && o.material.name === 'paint' && o.material.color.setHex(c));
          bus.big('FRESH PAINT', 'Tesla Service: $100. ElonPD lost track of you.', '#e82127', 2.5);
          sfx.coin();
        } else bus.toast('Respray is $100');
        me.sprayed = true;
      }
    } else me.sprayed = false;
    if (v.pos.distanceTo(places.chargers) < 12 && v.vel.length() < 2 && v.hp < 100 && !v.dead) {
      v.hp = Math.min(100, v.hp + dt * 25);
      v.fire = 0;
      bus.toast('Supercharging…', 0.5);
    }
  }
};

/* ---------------- controls ---------------- */
const axis = () => {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touch.x;
  const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + touch.y;
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
};
const firing = () => keys.has('Mouse0') || keys.has('KeyX') || touch.fire;
const firePressed = () => hit('Mouse0') || hit('KeyX') || touch.firePressed;

const footStep = dt => {
  const a = axis();
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.boost;
  const speed = run ? 7.5 : 4.2;
  const f = fwdVec(look.yaw, new V3()), r = rightVec(look.yaw, new V3());
  // Movement is relative to the camera, as in GTA.
  const mv = new V3().addScaledVector(f, a.y).addScaledVector(r, a.x);
  const k = Math.min(1, mv.length());
  const aiming = firing() && G.weapon > 0;
  if (k > 0.05) {
    mv.normalize();
    if (!aiming) me.yaw = me.yaw + wrapA(Math.atan2(mv.x, mv.z) - me.yaw) * Math.min(1, dt * 12);
    me.pos.addScaledVector(mv, speed * k * dt);
  }
  if (aiming || (firing() && G.weapon === 0)) me.yaw = me.yaw + wrapA(look.yaw - me.yaw) * Math.min(1, dt * 14);
  me.speed = speed * k;
  // Jump.
  if ((hit('Space') || touch.jumpPressed) && me.pos.y <= 0.01) me.vy = 6.5;
  me.vy -= 20 * dt;
  me.pos.y = Math.max(0, me.pos.y + me.vy * dt);
  if (me.pos.y === 0) me.vy = 0;
  collide(me.pos, 0.4, me.pos.y);
  // Standing on a car roof? Push off instead.
  for (const v of vehicles) {
    const dx = me.pos.x - v.pos.x, dz = me.pos.z - v.pos.z;
    const f2 = fwdVec(v.yaw, new V3());
    const along = dx * f2.x + dz * f2.z, side = dx * f2.z - dz * f2.x;
    const hl = v.spec.len / 2 + 0.35, hw = v.spec.wid / 2 + 0.35;
    if (Math.abs(along) < hl && Math.abs(side) < hw && Math.abs(v.pos.y - me.pos.y) < 1.5) {
      const pushA = hl - Math.abs(along), pushS = hw - Math.abs(side);
      if (pushA < pushS) me.pos.addScaledVector(f2, Math.sign(along) * pushA);
      else me.pos.add(new V3(f2.z, 0, -f2.x).multiplyScalar(Math.sign(side) * pushS));
    }
  }
  // The sea: you can't swim here.
  if (!isLand(me.pos.x, me.pos.z)) {
    if (me.swim === 0) {
      splash(me.pos.clone());
      sfx.splash();
    }
    me.swim += dt;
    me.pos.y = -1.1;
    if (me.swim > 1.2) G.hurtPlayer(dt * 25);
    if (me.swim > 1 && Math.floor(me.swim) !== Math.floor(me.swim - dt)) bus.toast('You can\'t swim in Elon City. Get back on land!');
  } else me.swim = 0;

  // Weapons.
  if (hit('KeyQ') || touch.swapPressed) switchWeapon(1);
  for (let i = 0; i < WEAPONS.length; i++) if (hit('Digit' + (i + 1)) && G.weapons[i]) (G.weapon = i), bus.weapon?.();
  let flaming = false;
  if (G.weapon === 0 && firePressed()) punch();
  if (G.weapon === 1 && firing()) flaming = fireFlame(dt);
  if (G.weapon === 2 && firing()) fireCoil();
  if (G.weapon === 3 && firePressed()) fireStrike();
  if (G.weapon === 4 && firePressed()) fireFlare();
  me.flaming = flaming;
  gun.visible = G.mode === 'foot' && (G.weapon === 1 || G.weapon === 2);
  flareGun.visible = G.mode === 'foot' && G.weapon === 4;
  me.punch -= dt;

  // Get in.
  const near = nearestVehicle(me.pos, 2.6, v => v.sink === 0 && v.pos.y < 2 && !v.dead);
  if (near && near !== me.hintCar && G.t - (me.hintT || -9) > 3) {
    me.hintCar = near;
    me.hintT = G.t;
    const key = IS_MOBILE ? 'ENTER' : 'F';
    bus.toast(near.type === 'cybercab' && near.driver === 'ai' && !near.mission ? `${key}: ride the Robotaxi` : `${key}: take the ${near.name}`, 1.8);
  }
  if (hit('KeyE') || hit('KeyF') || touch.enterPressed) {
    const v = nearestVehicle(me.pos, 2.6, v => v.sink === 0 && v.pos.y < 2);
    if (v) enterCar(v);
  }
  body.root.position.copy(me.pos);
  body.root.rotation.y = me.yaw;
  animHuman(body, me.speed, dt, me.punch > 0 ? 'punch' : (G.weapon > 0 && firing()) || (G.weapon === 4 && me.coolFlare > 0.2) ? 'aim' : 'stand');
  placeGun();
};

const rideStep = dt => {
  const v = G.car;
  v.rideDist += v.vel.length() * dt;
  if (hit('KeyE') || hit('KeyF') || touch.enterPressed) leaveCar();
  if (v.stopReq && v.vel.length() < 1.2) leaveCar();
  if ((hit('KeyT') || touch.flyPressed) && G.ride === v) {
    // Take over: the cab is yours to drive now.
    G.ride = null;
    v.passenger = false;
    v.stopReq = false;
    v.driver = 'player';
    v.ai = null;
    bus.toast('You took the wheel');
    bus.vehicle?.(v);
    return;
  }
  if (G.weapon === 4 && firePressed()) fireFlare();
  if (G.weapon === 3 && firePressed()) fireStrike();
  if (hit('KeyQ') || touch.swapPressed) switchWeapon(1);
  if (v.dead || v.fire > 0) {
    leaveCar(true);
    if (v.dead) G.hurtPlayer(60);
    return;
  }
  me.pos.copy(v.pos);
};

const carStep = dt => {
  if (G.ride === G.car) return rideStep(dt);
  const v = G.car;
  const a = axis();
  const inp = v.input;
  inp.throttle = a.y;
  inp.steer = -a.x;
  inp.boost = keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.boost;
  inp.handbrake = !v.flying && (keys.has('Space') || touch.jump);
  inp.up = v.flying ? (keys.has('Space') || touch.up ? 1 : 0) - (keys.has('KeyC') || keys.has('ControlLeft') || touch.down ? 1 : 0) : 0;
  if ((hit('KeyG') || touch.flyPressed) && v.spec.canFly && !v.dead) {
    v.flying = !v.flying;
    if (v.flying) {
      v.vy = 6;
      sfx.whoosh();
      bus.toast('Flight mode: Space up, C down, G to land');
      G.onFly?.(v);
    } else bus.toast('Thrusters off');
  }
  if (hit('KeyH')) {
    sfx.taser();
    panic(v.pos, 12);
  }
  if (G.weapon === 3 && firePressed()) fireStrike();
  if (G.weapon === 4 && firePressed()) fireFlare();
  if (hit('KeyQ') || touch.swapPressed) switchWeapon(1);
  if (hit('KeyE') || hit('KeyF') || touch.enterPressed) leaveCar();
  if (v.dead) {
    G.hurtPlayer(200);
    return;
  }
  if (v.fire > 0 && Math.floor(v.fire * 2) !== Math.floor((v.fire - dt) * 2)) bus.toast('Your car is on fire. Get out!');
  if (v.sink > 1.5) {
    leaveCar(true);
    me.pos.copy(v.pos).setY(-1.1);
  }
  me.pos.copy(v.pos);
};

/* ---------------- camera ---------------- */
let camDist = 1;
const camPos = new V3(), camLook = new V3();
const placeCamera = dt => {
  if (hit('KeyV')) camDist = camDist === 1 ? 1.6 : camDist === 1.6 ? 0.65 : 1;
  look.idle += dt;
  let target, dist, height;
  if (G.mode === 'car' && G.car) {
    const v = G.car;
    target = v.pos.clone().setY(v.pos.y + v.spec.h * 0.8);
    dist = (v.spec.len * 1.35 + 5) * camDist + (v.flying ? 4 : 0);
    height = 2.2 + v.spec.h * 0.6;
    const speed = v.vel.length();
    // Swing behind the car unless you have looked around in the last moment.
    if (look.idle > 1.2 && speed > 2) {
      const behind = Math.atan2(v.vel.x, v.vel.z);
      const goal = v.vel.dot(fwdVec(v.yaw, new V3())) < -2 ? v.yaw : behind;
      look.yaw += wrapA(goal - look.yaw) * Math.min(1, dt * 3);
      look.pitch = damp(look.pitch, v.flying ? 0.32 : 0.2, 2, dt);
    }
    camera.fov = damp(camera.fov, 62 + clamp(speed - 20, 0, 40) * 0.35, 3, dt);
  } else {
    target = me.pos.clone().setY(me.pos.y + 1.6);
    dist = 5.2 * camDist;
    height = 0.6;
    if (look.idle > 2.5 && me.speed > 1) look.yaw += wrapA(me.yaw - look.yaw) * Math.min(1, dt * 1.2);
    camera.fov = damp(camera.fov, 60, 3, dt);
  }
  camera.updateProjectionMatrix();
  const back = new V3(-Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), -Math.cos(look.yaw) * Math.cos(look.pitch));
  const want = target.clone().addScaledVector(back, dist).add(new V3(0, height, 0));
  // Over the right shoulder on foot, as in GTA.
  if (G.mode === 'foot') {
    const side = rightVec(look.yaw, new V3()).multiplyScalar(0.75);
    want.add(side);
    target.add(side);
  }
  // Pull in front of buildings that would hide you.
  for (let k = 1; k <= 12; k++) {
    const p = target.clone().lerp(want, k / 12);
    let blocked = false;
    for (const s of solids) if (p.y < s.h && p.x > s.minx - 0.4 && p.x < s.maxx + 0.4 && p.z > s.minz - 0.4 && p.z < s.maxz + 0.4) {
      blocked = true;
      break;
    }
    if (blocked) {
      want.copy(target.clone().lerp(want, (k - 1) / 12));
      break;
    }
  }
  want.y = Math.max(want.y, 0.6);
  if (camPos.lengthSq() === 0) camPos.copy(want);
  camPos.lerp(want, 1 - Math.exp(-dt * (G.mode === 'car' ? 9 : 14)));
  camLook.lerp(target, 1 - Math.exp(-dt * 16));
  if (camLook.lengthSq() === 0) camLook.copy(target);
  camera.position.copy(camPos);
  if (shake.k > 0) camera.position.add(new V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(shake.k * 0.25));
  camera.lookAt(camLook);
};

/* ---------------- the frame ---------------- */
onUpdate(dt => {
  if (!G.started) return;
  me.coolCoil -= dt;
  me.coolFlare = (me.coolFlare || 0) - dt;
  me.coolStrike = Math.max(0, me.coolStrike - dt);
  me.hurtT -= dt;
  G.hide = Math.max(0, (G.hide || 0) - dt);
  if (hit('KeyR') || touch.radioPressed) bus.toast(nextStation());
  if (G.mode !== 'foot') gun.visible = flareGun.visible = false;
  if (G.mode === 'foot') footStep(dt);
  else if (G.mode === 'car' && G.car) carStep(dt);
  else if (G.mode === 'dead') {
    me.deadT += dt;
    animHuman(body, 0, dt, 'down');
    if (me.deadT > 4.5) respawn();
  }
  // Health comes back slowly when nothing has hurt you for a while.
  if (G.mode !== 'dead' && G.t - me.lastHit > 8 && G.health < 50) G.health = Math.min(50, G.health + dt * 2);
  stepStrike(dt);
  stepFlares(dt);
  stepPickups(dt);
  if (G.mode !== 'dead' && G.mode !== 'cutscene') stepPlaces(dt);
  if (G.mode !== 'cutscene') placeCamera(dt);
  followSun(G.playerTarget());
  const v = G.car;
  audioFrame({
    engine: v ? 1 : 0,
    rpm: v ? clamp(v.vel.length() / v.spec.max, 0, 1.2) + Math.abs(v.input.throttle) * 0.2 : 0,
    fire: me.flaming ? 1 : 0,
    jet: v && (v.flying || v.input.boost) && v.spec.canFly ? 0.5 + (v.input.boost ? 0.4 : 0) : 0,
    siren: G.stars > 0 ? clamp(G.stars / 3, 0.3, 1) : 0,
  });
}, 20);

export const player = me;
export { body as playerBody };
