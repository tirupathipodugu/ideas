// Travel anywhere in Austin by Starship, or fly it yourself from Starbase: light the 33 Raptors, climb, separate, then fly the Super Heavy
// booster back and catch it in the tower's chopsticks (or set it down on the pad).
import { THREE, V3, scene, camera, G, keys, hit, touch, look, bus, clamp, rnd, onUpdate, insideSolid, IS_MOBILE } from './core.js';
import { places, starship, starbase, isLand } from './world.js';
import { PLACES } from './hud.js';
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

/* ---------------- travel by Starship: point to point across Austin ---------------- */
// Board it, pick a place: it launches, arcs over the city, belly-flops, flips and lands upright there.
const pickEl = document.createElement('div');
pickEl.id = 'rocketPick';
pickEl.hidden = true;
document.body.appendChild(pickEl);
{
  const st = document.createElement('style');
  st.textContent = `#rocketPick{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(8,10,16,.9);border:1px solid rgba(255,255,255,.3);border-radius:14px;padding:14px 16px;width:min(340px,92vw);max-height:86vh;overflow:auto;font-family:var(--ui);color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.6);z-index:5}
#rocketPick[hidden]{display:none}
#rocketPick h3{margin:0 0 2px;font:400 1.6rem Pacifico,cursive;color:#fff}
#rocketPick p{margin:0 0 8px;opacity:.75;font-size:.88rem}
#rocketPick button{display:flex;align-items:center;gap:9px;width:100%;margin:5px 0;padding:9px 11px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);font-weight:700;font-size:1rem;text-align:left}
#rocketPick button.main{background:rgba(255,79,163,.28);border-color:rgba(255,79,163,.6)}
#rocketPick button kbd{display:inline-block;min-width:22px;padding:1px 5px;border-radius:5px;background:rgba(255,255,255,.18);font:700 .78rem var(--ui);text-align:center}
#rocketPick button small{margin-left:auto;opacity:.6;font-weight:500}`;
  document.head.appendChild(st);
}
let picking = null;
const onPad = () => Math.hypot(starship.position.x - pad.x, starship.position.z - pad.z) < 3;
const rocketBase = () => new V3(starship.position.x, 0, starship.position.z);
const choices = () => {
  const here = rocketBase();
  const list = [];
  if (onPad()) list.push({ key: 'fly', label: '🕹️ Fly it yourself (catch the booster)' });
  else list.push({ key: 'go', label: '🚀 Back to Starbase', to: pad, name: 'Starbase' });
  for (const pl of PLACES) {
    if (pl.p === pad || Math.hypot(pl.p.x - here.x, pl.p.z - here.z) < 120) continue;
    list.push({ key: 'go', label: `${pl.icon} ${pl.name.replace(/:.*$/, '')}`, to: pl.p, name: pl.name.replace(/ \(.*\)$/, '') });
  }
  return list;
};
const openPick = () => {
  picking = choices();
  const here = rocketBase();
  pickEl.innerHTML = `<h3>Starship</h3><p>Where to? It lands upright, right next to it.</p>` +
    picking.map((c, i) => `<button data-i="${i}" class="${i === 0 ? 'main' : ''}"><kbd>${(i + 1) % 10}</kbd>${c.label}${c.to ? `<small>${(Math.hypot(c.to.x - here.x, c.to.z - here.z) / 1000).toFixed(1)} km</small>` : ''}</button>`).join('') +
    `<button data-i="-1">✖ Not now</button>`;
  pickEl.hidden = false;
  sfx.blip();
};
const closePick = () => {
  pickEl.hidden = true;
  picking = null;
  cool = 2;
};
const choose = i => {
  const c = picking?.[i];
  if (!c) return closePick();
  pickEl.hidden = true;
  picking = null;
  if (c.key === 'fly') board();
  else travel(c.to, c.name);
};
pickEl.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) choose(+b.dataset.i);
});

// Somewhere flat and clear to land near a place: no buildings within 10 m, not the lake.
const landingSpot = to => {
  if (to === pad) return new V3(pad.x, 10, pad.z);
  for (let r = 0; r < 260; r += 12)
    for (let k = 0; k < (r ? 12 : 1); k++) {
      const a = (k / 12) * Math.PI * 2, x = to.x + Math.cos(a) * r, z = to.z + Math.sin(a) * r;
      if (!isLand(x, z)) continue;
      let ok = true;
      for (let j = 0; j < 8 && ok; j++) if (insideSolid(x + Math.cos(j) * 10, z + Math.sin(j) * 10, 1)) ok = false;
      if (ok && !insideSolid(x, z, 1)) return new V3(x, 0, z);
    }
  return new V3(to.x, 0, to.z);
};

let T = null;
const travel = (to, name) => {
  const from = starship.position.clone();
  const dest = landingSpot(to);
  const d = Math.hypot(dest.x - from.x, dest.z - from.z);
  const top = 700 + d * 0.5;
  T = {
    name, from, dest, t: 0, ign: 3, dur: 16 + d / 110,
    p1: from.clone().setY(from.y + top), p2: dest.clone().setY(dest.y + top),
    dir: new V3(dest.x - from.x, 0, dest.z - from.z).normalize(), lit: false,
  };
  G.mode = 'cutscene';
  G.rocket = T;
  T.stage = 'travel';
  G.noCops = true;
  G.clearWanted?.();
  playerBody.root.visible = false;
  look.yaw = Math.atan2(T.dir.x, T.dir.z);
  look.pitch = 0.3;
  bus.big('STARSHIP', `Next stop: ${name}`, '#ffffff', 3);
  bus.toast('Sit back. F to skip to landing', 3);
};
const bez = (a, b, c, d, u, out) => {
  const v = 1 - u;
  return out.set(0, 0, 0).addScaledVector(a, v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u);
};
const _p = new V3(), _q = new V3(), _tan = new V3(), _upv = new V3(), _quat = new THREE.Quaternion(), _y = new V3(0, 1, 0);
const travelStep = dt => {
  const r = T;
  r.t += dt;
  if (hit('KeyF') || hit('KeyE') || touch.enterPressed) r.t = Math.max(r.t, r.ign + r.dur * 0.97);
  const ft = r.t - r.ign;
  let u = 0, burn = 1;
  if (ft < 0) {
    // Engines spool up on the ground.
    burn = clamp(r.t / r.ign, 0, 1) * 0.8;
    if (!r.lit && r.t > r.ign - 1) {
      r.lit = true;
      sfx.launch();
    }
  } else {
    const k = clamp(ft / r.dur, 0, 1);
    // Slow off the pad, fast across, slow at the end.
    u = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  }
  bez(r.from, r.p1, r.p2, r.dest, u, _p);
  bez(r.from, r.p1, r.p2, r.dest, Math.min(1, u + 0.002), _q);
  _tan.copy(_q).sub(_p);
  if (_tan.lengthSq() < 1e-6) _tan.set(0, 1, 0);
  _tan.normalize();
  // Climb nose-first; belly-flop across the top; flip upright for the landing burn.
  if (u < 0.42) _upv.copy(_tan);
  else if (u < 0.8) _upv.copy(r.dir).lerp(_tan, 0.15).normalize();
  else {
    const f = clamp((u - 0.8) / 0.08, 0, 1);
    _upv.copy(r.dir).lerp(_y, f * f * (3 - 2 * f)).normalize();
  }
  if (_upv.y < 0 && u < 0.8) _upv.y = 0;
  _quat.setFromUnitVectors(_y, _upv.lengthSq() ? _upv.normalize() : _y);
  starship.quaternion.slerp(_quat, 1 - Math.exp(-dt * 3));
  starship.position.copy(_p);
  if (ft >= 0) burn = u < 0.42 ? 1 : u > 0.84 ? 0.9 : 0;
  plume.visible = burn > 0.05;
  plume.material.uniforms.uT.value = G.t;
  plume.material.uniforms.uK.value = burn;
  if (burn > 0.1) {
    const down = new V3(0, -1, 0).applyQuaternion(starship.quaternion);
    for (let k = 0; k < 3; k++) thrust(_p.clone().add(new V3(rnd(-2, 2), 0, rnd(-2, 2))), down, 3 * burn, 0xffa040);
    if (_p.y - r.dest.y < 120 || _p.y - r.from.y < 120) for (let k = 0; k < 4; k++) dust(new V3(_p.x + rnd(-14, 14), 1.5, _p.z + rnd(-14, 14)), 6);
    addShake(0.03 * burn + (ft < 3 && ft > -1 ? 0.06 : 0));
  }
  G.rocketJet = burn;
  G.loopSpeed = 0;
  player.pos.set(_p.x, 0, _p.z);
  // Chase camera.
  const fx = Math.sin(look.yaw), fz = Math.cos(look.yaw);
  const dist = 170 + Math.min(260, _p.y * 0.12);
  const cp = new V3(_p.x - fx * dist, _p.y + 40 + look.pitch * 140, _p.z - fz * dist);
  if (cp.y < 3) cp.y = 3;
  camera.position.lerp(cp, 1 - Math.exp(-dt * 3));
  camera.lookAt(_p.x, _p.y + 45, _p.z);
  bus.objective(`Starship to <b>${r.name}</b> · alt <b>${Math.round(_p.y)} m</b> · ${Math.round(Math.hypot(r.dest.x - _p.x, r.dest.z - _p.z))} m to go`);
  if (ft >= r.dur) {
    // Touchdown.
    starship.position.copy(r.dest);
    starship.quaternion.identity();
    plume.visible = false;
    for (let k = 0; k < 30; k++) dust(new V3(r.dest.x + rnd(-16, 16), 1.5, r.dest.z + rnd(-16, 16)), 8);
    sfx.crash(0.6);
    T = null;
    G.mode = 'foot';
    G.rocket = null;
    G.rocketJet = 0;
    G.noCops = false;
    playerBody.root.visible = true;
    const side = new V3(-fz, 0, fx);
    player.pos.copy(r.dest).setY(0).addScaledVector(side, 16);
    player.yaw = look.yaw;
    bus.objective('');
    bus.big('TOUCHDOWN', `${r.name}. Board it again to fly back.`, '#7fe0ff', 3);
    cool = 3;
  }
};

onUpdate(dt => {
  if (!G.started) return;
  cool -= dt;
  if (R) return step(dt);
  if (T) return travelStep(dt);
  G.rocketJet = 0;
  if (picking) {
    for (let i = 0; i < 10; i++) if (hit('Digit' + ((i + 1) % 10))) return choose(i);
    if (hit('Escape')) return closePick();
    const b = rocketBase();
    if (G.mode !== 'foot' || Math.hypot(player.pos.x - b.x, player.pos.z - b.z) > 50) closePick();
    return;
  }
  // Walk up to Starship to board it (when no mission is using it).
  if (G.mode !== 'foot' || G.mission || cool > 0 || !starship.visible) return;
  const b = rocketBase();
  if (Math.hypot(player.pos.x - b.x, player.pos.z - b.z) < 45) {
    hintT -= dt;
    if (hintT <= 0) {
      hintT = 6;
      bus.toast(IS_MOBILE ? 'Starship: tap ENTER to board' : 'Starship: press F to board', 3);
    }
    if (hit('KeyF') || hit('KeyE') || touch.enterPressed) openPick();
  }
}, 64);
