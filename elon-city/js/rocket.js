// Fly Starship yourself from Starbase: light the 33 Raptors, climb, separate, then fly the Super Heavy
// booster back and catch it in the tower's chopsticks (or set it down on the pad).
import { THREE, V3, scene, camera, G, keys, hit, touch, look, bus, clamp, rnd, onUpdate, insideSolid, IS_MOBILE } from './core.js';
import { places, starship, starbase } from './world.js';
import { thrust, dust, explode, sparks, addShake } from './fx.js';
import { sfx } from './audio.js';
import { player, playerBody } from './player.js';

const GRAV = 9.8;
const { booster, ship: upper, plume } = starship.userData;
const pad = places.pad;
const tw = starbase.tower;
// Where the booster's base sits when the chopsticks hold it.
const CATCH = { x: tw.x + 16, z: tw.z, y: 20 };
let R = null, hintT = 0, cool = 0;

const reset = () => {
  starship.add(upper);
  upper.position.set(0, 54, 0);
  upper.visible = true;
  starship.position.set(pad.x, 10, pad.z);
  starship.rotation.set(0, 0, 0);
  starbase.sticks.rotation.y = 0;
  plume.visible = false;
};

const board = () => {
  R = { pos: new V3(pad.x, 10, pad.z), vel: new V3(), tilt: new THREE.Vector2(), thr: 0, fuel: 100, stage: 'stack', lit: false, t: 0, landed: true, upperVel: 0 };
  G.mode = 'cutscene';
  G.rocket = R;
  G.noCops = true;
  G.clearWanted?.();
  playerBody.root.visible = false;
  document.body.classList.add('canfly', 'driving');
  look.pitch = 0.25;
  bus.big('STARSHIP', IS_MOBILE ? 'Hold FIRE to light the engines. Stick tilts the rocket.' : 'Hold SPACE to light the engines. W A S D tilt the rocket.', '#ffffff', 3.5);
  sfx.blip();
};

const leave = (msg, money = 0) => {
  G.mode = 'foot';
  G.rocket = null;
  G.rocketJet = 0;
  G.noCops = false;
  playerBody.root.visible = true;
  document.body.classList.remove('canfly', 'driving');
  player.pos.copy(places.starbase);
  player.yaw = look.yaw;
  if (money) G.money += money;
  if (msg) bus.big(msg[0], msg[1], msg[2] || '#ffffff', 3.5);
  bus.objective('');
  R = null;
  cool = 3;
};

const crash = why => {
  explode(R.pos.clone().setY(Math.max(2, R.pos.y)), 2.4);
  sfx.boom(1.6);
  addShake(1.5);
  G.onExplosion?.(R.pos.clone().setY(0), 20, {});
  starship.visible = false;
  R.dead = 3;
  bus.big('RAPID UNSCHEDULED DISASSEMBLY', why, '#ff5040', 3);
};

const _up = new V3(), _e = new THREE.Euler();
const step = dt => {
  const r = R;
  r.t += dt;
  if (r.dead) {
    r.dead -= dt;
    plume.visible = false;
    if (r.dead <= 0) {
      starship.visible = true;
      reset();
      leave(null);
    }
    return;
  }
  // Engines: hold to burn. Tilt in the camera's frame, like a stick.
  const burn = (keys.has('Space') || touch.fire || touch.jump) && r.fuel > 0;
  r.thr = clamp(r.thr + (burn ? 1.6 : -2.5) * dt, 0, 1);
  if (burn && !r.lit) {
    r.lit = true;
    sfx.launch();
  }
  if (!burn && r.thr < 0.05) r.lit = false;
  const ix = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + touch.x;
  const iz = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + touch.y;
  const fx = Math.sin(look.yaw), fz = Math.cos(look.yaw);
  const MAXT = 0.6;
  const want = new THREE.Vector2(clamp(fx * iz - fz * ix, -1, 1) * MAXT, clamp(fz * iz + fx * ix, -1, 1) * MAXT);
  r.tilt.lerp(want, 1 - Math.exp(-dt * 1.8));
  _e.set(r.tilt.y, 0, -r.tilt.x, 'XYZ');
  starship.rotation.copy(_e);
  _up.set(0, 1, 0).applyEuler(_e);
  // Thrust to weight: the full stack is heavy; the booster alone is light.
  const twr = r.stage === 'stack' ? 1.55 : 2.6;
  const a = r.thr * twr * GRAV;
  r.vel.addScaledVector(_up, a * dt);
  r.vel.y -= GRAV * dt;
  // Air drag grows with speed (less up high).
  const rho = Math.exp(-r.pos.y / 3500);
  r.vel.multiplyScalar(1 / (1 + 0.0006 * rho * r.vel.length() * dt * 6));
  if (r.thr > 0.02) r.fuel = Math.max(0, r.fuel - r.thr * dt * (r.stage === 'stack' ? 1.4 : 2.2));
  r.pos.addScaledVector(r.vel, dt);
  // The ground and the pad.
  if (r.pos.y <= 10 && Math.hypot(r.pos.x - pad.x, r.pos.z - pad.z) < 30) {
    if (r.vel.y < -7 || r.tilt.length() > 0.2) return crash('Too fast or too tilted for the pad.');
    r.pos.y = 10;
    r.vel.set(0, 0, 0);
    if (!r.landed && r.t > 5) {
      r.landed = true;
      return leave(['LANDED', r.stage === 'booster' ? 'Super Heavy is back on the pad. +$25,000' : 'Back on the pad. +$5,000', '#7fe0ff'], r.stage === 'booster' ? 25000 : 5000);
    }
  } else if (r.pos.y <= 0.5) {
    if (r.vel.length() > 6 || r.tilt.length() > 0.25) return crash('It came down hard.');
    r.pos.y = 0.5;
    r.vel.set(0, 0, 0);
    if (!r.landed && r.t > 5) {
      r.landed = true;
      return leave(['TOUCHDOWN', 'Landed off-site. +$2,000', '#ffd23c'], 2000);
    }
  } else r.landed = false;
  // Towers in the way.
  if (r.pos.y > 1 && (insideSolid(r.pos.x, r.pos.z, r.pos.y + 4) || insideSolid(r.pos.x + _up.x * 40, r.pos.z + _up.z * 40, r.pos.y + _up.y * 40))) return crash('It hit a building.');
  // The catch: slow, upright and between the arms.
  const off = Math.hypot(r.pos.x - CATCH.x, r.pos.z - CATCH.z);
  if (r.stage === 'booster' && off < 5 && Math.abs(r.pos.y - CATCH.y) < 3 && Math.abs(r.vel.y) < 9 && r.tilt.length() < 0.18) {
    starbase.sticks.rotation.y = 0.05;
    starship.position.set(CATCH.x, CATCH.y, CATCH.z);
    starship.rotation.set(0, 0, 0);
    plume.visible = false;
    sfx.crash(1.3);
    sparks(new V3(CATCH.x, 70, CATCH.z), 50);
    addShake(0.8);
    R.caught = true;
    setTimeout(reset, 8000);
    return leave(['CAUGHT!', 'Mechazilla caught Super Heavy. +$50,000', '#7fe0ff'], 50000);
  }
  // Stage separation.
  if (hit('KeyG') || touch.flyPressed) {
    if (r.stage === 'stack' && r.pos.y > 250) {
      r.stage = 'booster';
      scene.attach(upper);
      r.upperVel = Math.max(40, r.vel.y);
      r.fuel = Math.max(r.fuel, 45);
      sfx.whoosh();
      addShake(0.6);
      bus.big('STAGE SEPARATION', 'The ship flies on to orbit. Bring the booster back to the tower.', '#7fe0ff', 3.5);
    } else if (r.stage === 'stack') bus.toast('Climb above 250 m to separate');
  }
  if (r.stage === 'booster' && upper.parent === scene) {
    r.upperVel += dt * 25;
    upper.position.y += r.upperVel * dt;
    if (upper.position.y > 9000) upper.visible = false;
  }
  // Out you get (on the ground only).
  if ((hit('KeyF') || hit('KeyE') || touch.enterPressed) && r.pos.y < 11 && r.vel.length() < 1) {
    reset();
    return leave(null);
  }
  starship.position.copy(r.pos);
  // Fire and smoke.
  plume.visible = r.thr > 0.03;
  plume.material.uniforms.uT.value = G.t;
  plume.material.uniforms.uK.value = r.thr;
  if (r.thr > 0.1) {
    const base = r.pos.clone();
    for (let k = 0; k < 3; k++) thrust(base.clone().add(new V3(rnd(-2, 2), -2, rnd(-2, 2))), _up.clone().negate(), 3 * r.thr, 0xffa040);
    if (r.pos.y < 120) for (let k = 0; k < 4; k++) dust(new V3(r.pos.x + rnd(-14, 14), 1.5, r.pos.z + rnd(-14, 14)), 6);
    addShake(0.04 * r.thr * clamp(1 - r.pos.y / 600, 0, 1) + 0.01);
  }
  G.rocketJet = r.thr;
  player.pos.set(r.pos.x, 0, r.pos.z);
  // Chase camera: orbit with the mouse or right thumb, further out as you climb.
  const dist = (r.stage === 'stack' ? 150 : 110) + Math.min(250, r.pos.y * 0.08);
  const h = 40 + look.pitch * 120;
  const cp = new V3(r.pos.x - fx * dist, r.pos.y + h, r.pos.z - fz * dist);
  if (cp.y < 3) cp.y = 3;
  camera.position.lerp(cp, 1 - Math.exp(-dt * 4));
  camera.lookAt(r.pos.x, r.pos.y + (r.stage === 'stack' ? 50 : 30), r.pos.z);
  const alt = Math.round(r.pos.y);
  bus.objective(`${r.stage === 'stack' ? 'Starship' : 'Super Heavy'} · alt <b>${alt} m</b> · speed <b>${Math.round(r.vel.length() * 3.6)} km/h</b> · fuel <b>${Math.round(r.fuel)}%</b>` +
    (r.stage === 'stack' ? (r.pos.y > 250 ? ` · <b>${IS_MOBILE ? 'FLY' : 'G'}</b> to separate` : '') : ` · tower <b>${Math.round(off)} m</b> away, catch under <b>9 m/s</b>`));
};

onUpdate(dt => {
  if (!G.started) return;
  cool -= dt;
  if (R) return step(dt);
  G.rocketJet = 0;
  // Walk up to the pad to fly it (when no mission is using it).
  if (G.mode !== 'foot' || G.mission || cool > 0) return;
  const d = Math.hypot(player.pos.x - pad.x, player.pos.z - pad.z);
  if (d < 45) {
    hintT -= dt;
    if (hintT <= 0) {
      hintT = 6;
      bus.toast(IS_MOBILE ? 'Starship: tap ENTER to fly it' : 'Starship: press F to fly it', 3);
    }
    if (hit('KeyF') || hit('KeyE') || touch.enterPressed) board();
  }
}, 64);
