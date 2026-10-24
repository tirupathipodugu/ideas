// People: one low-poly body shared by pedestrians, police and the player; pedestrians walking the sidewalks.
import { THREE, V3, scene, G, clamp, rnd, pick, wrapA, collide, onUpdate, damp, bus, clearLine } from './core.js';
import { N, walkLoop, isLand } from './world.js';
import { vehicles, fwdVec } from './vehicles.js';
import { burning, sparks } from './fx.js';
import { sfx } from './audio.js';
import { makeHuman, animHuman, disposeHuman } from './people.js';

export { makeHuman, animHuman };

/* ---------------- pedestrians ---------------- */
export const peds = [];
const MAX_PEDS = 34;
const MAX_BOTS = 4;

export const spawnPed = (x, z, opts = {}) => {
  const h = makeHuman({ kind: opts.kind ?? 'civ' });
  const p = {
    h,
    pos: new V3(x, 0, z),
    vel: new V3(),
    yaw: rnd(0, 6.28),
    hp: opts.hp ?? 40,
    state: opts.state ?? 'walk', // walk | flee | down | dead | wait
    kind: opts.kind ?? 'civ',
    t: 0,
    fire: 0,
    loop: null,
    li: 0,
    dir: 1,
    speed: rnd(1.2, 1.6),
    from: null,
  };
  h.root.position.copy(p.pos);
  peds.push(p);
  return p;
};

export const removePed = p => {
  disposeHuman(p.h);
  const i = peds.indexOf(p);
  if (i >= 0) peds.splice(i, 1);
};

const joinLoop = p => {
  const i = clamp(Math.floor((p.pos.x + G.cityHALF) / (2 * G.cityHALF / N)), 0, N - 1);
  const j = clamp(Math.floor((p.pos.z + G.cityHALF) / (2 * G.cityHALF / N)), 0, N - 1);
  p.loop = walkLoop(i, j);
  let best = 0, bd = Infinity;
  p.loop.forEach((q, k) => {
    const d = q.distanceTo(p.pos);
    if (d < bd) {
      bd = d;
      best = k;
    }
  });
  p.li = best;
};

// Hurt a person: fall over, maybe die; the player's crimes raise the heat.
export const hurtPed = (p, amt, from, by = null, knock = 0) => {
  if (p.state === 'dead') return;
  p.hp -= amt;
  if (by === 'player' && p.kind !== 'bot') G.crime?.(p.kind === 'cop' ? 20 : 6);
  if (knock > 0 && from) {
    const d = p.pos.clone().sub(from).setY(0).normalize();
    p.vel.copy(d.multiplyScalar(knock)).setY(knock * 0.4);
    p.state = 'down';
    p.t = 0;
  }
  if (p.hp <= 0) {
    p.state = 'dead';
    p.t = 0;
    p.fire = 0;
    if (p.kind === 'bot') {
      sparks(p.pos.clone().setY(1.2), 40, 0xff3040);
      if (by === 'player') {
        G.money += 100;
        G.botsDown = (G.botsDown || 0) + 1;
        bus.toast(`Rogue Optimus down +$100 (${G.botsDown})`);
      }
    }
    G.onPedDown?.(p, by);
  } else if (p.state !== 'down' && p.kind === 'civ') {
    p.state = 'flee';
    p.t = 0;
    p.from = from?.clone();
  }
};

export const setOnFire = (p, by) => {
  if (p.state === 'dead') return;
  if (p.fire <= 0 && by === 'player' && p.kind !== 'bot') G.crime?.(p.kind === 'cop' ? 20 : 8);
  p.fire = Math.max(p.fire, 0.01);
  p.firedBy = by;
};

// Everyone near something scary runs.
export const panic = (at, r) => {
  for (const p of peds) if (p.kind === 'civ' && (p.state === 'walk' || p.state === 'wait') && p.pos.distanceTo(at) < r) {
    p.state = 'flee';
    p.t = 0;
    p.from = at.clone();
  }
};
G.panic = panic;

// Traffic stops for people in front of it.
G.blocking = (v, fwd) => {
  const check = q => {
    const dx = q.x - v.pos.x, dz = q.z - v.pos.z;
    const ahead = dx * fwd.x + dz * fwd.z;
    return ahead > 0 && ahead < 9 && Math.abs(dx * fwd.z - dz * fwd.x) < 1.8;
  };
  if (v.ai?.angry > 0) return false;
  if (G.mode === 'foot' && G.playerPos && check(G.playerPos)) return true;
  for (const p of peds) if (p.state !== 'dead' && p.state !== 'down' && check(p.pos)) return true;
  return false;
};

// A driver thrown out or bailing from a burning car.
G.bail = v => {
  const side = new V3(-Math.cos(v.yaw), 0, Math.sin(v.yaw));
  const p = spawnPed(v.pos.x + side.x * 2, v.pos.z + side.z * 2, { state: 'flee' });
  p.from = v.pos.clone();
  return p;
};

// Rogue robots wander like everyone else until they spot you, then come for you.
const botStep = (p, dt) => {
  const me = G.playerTarget();
  const dx = me.x - p.pos.x, dz = me.z - p.pos.z, d = Math.hypot(dx, dz);
  if (p.state === 'walk' && G.mode === 'foot' && d < 36 && clearLine(p.pos.x, p.pos.z, me.x, me.z)) {
    p.state = 'hunt';
    p.t = 0;
    sfx.taser();
    if (!G.botWarned) {
      G.botWarned = true;
      bus.toast('Rogue Optimus coming for you! Flare Gun: press 5', 4);
    }
  }
  if (p.state !== 'hunt') return null;
  if (d > 60 || G.mode === 'dead' || G.mode === 'cutscene') {
    p.state = 'walk';
    p.loop = null;
    return null;
  }
  p.yaw += wrapA(Math.atan2(dx, dz) - p.yaw) * Math.min(1, dt * 6);
  p.cool = (p.cool ?? 0) - dt;
  if (d < 1.7) {
    if (p.cool <= 0 && G.mode === 'foot') {
      p.cool = 0.9;
      G.hurtPlayer(9, p.pos);
      sfx.punch();
    }
    return { speed: 0, pose: 'punch' };
  }
  return { speed: 4.6, pose: 'stand' };
};

const stepPed = (p, dt) => {
  p.t += dt;
  let speed = 0;
  let pose = 'stand';
  if (p.fire > 0 && p.state !== 'dead') {
    p.fire += dt;
    burning(p.pos.clone().setY(1), 0.8);
    p.hp -= dt * 9;
    pose = 'flail';
    if (p.hp <= 0) hurtPed(p, 1, p.pos, p.firedBy);
    if (p.fire > 6) p.fire = 0;
  }
  if (p.state === 'walk') {
    if (!p.loop) joinLoop(p);
    const tgt = p.loop[p.li];
    const dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z;
    if (Math.hypot(dx, dz) < 0.8) p.li = (p.li + p.dir + 4) % 4;
    p.yaw = damp(p.yaw, p.yaw + wrapA(Math.atan2(dx, dz) - p.yaw), 6, dt);
    speed = p.speed;
    if (Math.random() < 0.0008) {
      p.state = 'wait';
      p.t = 0;
    }
  } else if (p.state === 'wait') {
    if (p.t > rnd(2, 5)) p.state = 'walk';
  } else if (p.state === 'flee') {
    const from = p.from || p.pos;
    const away = Math.atan2(p.pos.x - from.x, p.pos.z - from.z);
    p.yaw = damp(p.yaw, p.yaw + wrapA(away + Math.sin(p.t * 2) * 0.4 - p.yaw), 5, dt);
    speed = 6;
    if (p.fire <= 0) pose = 'flail';
    if (p.t > 7) {
      p.state = 'walk';
      p.loop = null;
    }
  } else if (p.state === 'down') {
    pose = 'down';
    p.vel.y -= 20 * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.multiplyScalar(Math.exp(-6 * dt));
    }
    if (p.t > 2.5 && p.hp > 0) {
      p.state = p.kind === 'civ' ? 'flee' : p.kind === 'bot' ? 'hunt' : 'chase';
      p.t = 0;
      p.vel.set(0, 0, 0);
    }
  } else if (p.state === 'dead') {
    pose = 'down';
    p.vel.y -= 20 * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.multiplyScalar(Math.exp(-6 * dt));
    }
  }
  if (p.kind === 'cop' && p.state !== 'dead' && p.state !== 'down') ({ speed, pose } = G.copStep?.(p, dt) ?? { speed, pose });
  if (p.kind === 'bot' && (p.state === 'walk' || p.state === 'hunt' || p.state === 'wait')) {
    const r = botStep(p, dt);
    if (r) ({ speed, pose } = r);
  }

  if (speed > 0 && p.state !== 'down' && p.state !== 'dead') {
    p.pos.x += Math.sin(p.yaw) * speed * dt;
    p.pos.z += Math.cos(p.yaw) * speed * dt;
  }
  collide(p.pos, 0.35);
  if (!isLand(p.pos.x, p.pos.z)) p.pos.y = Math.max(-1.4, p.pos.y - dt);

  // Cars hit people.
  if (p.state !== 'dead')
    for (const v of vehicles) {
      const sp = v.vel.length();
      if (sp < 4 || Math.abs(v.pos.y - p.pos.y) > 1.5) continue;
      const f = fwdVec(v.yaw, new V3());
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
      const along = dx * f.x + dz * f.z, side = Math.abs(dx * f.z - dz * f.x);
      if (Math.abs(along) < v.spec.len / 2 + 0.3 && side < v.spec.wid / 2 + 0.3) {
        hurtPed(p, sp * 3.2, v.pos, v.driver === 'player' ? 'player' : null, sp * 0.9);
        sfx.punch();
        sparks(p.pos.clone().setY(1), 4, 0xff4040);
        v.vel.multiplyScalar(0.92);
        panic(p.pos, 18);
      }
    }

  p.h.root.position.copy(p.pos);
  p.h.root.rotation.y = p.yaw;
  animHuman(p.h, speed, dt, pose);
};

/* ---------------- streaming pedestrians around the player ---------------- */
let streamT = 0;
onUpdate(dt => {
  if (!G.started) return;
  const me = G.playerPos;
  streamT -= dt;
  if (streamT <= 0 && me) {
    streamT = 0.5;
    for (const p of [...peds]) {
      const d = p.pos.distanceTo(me);
      if ((p.kind === 'civ' || p.kind === 'bot') && (d > 170 || (p.state === 'dead' && p.t > 25 && d > 40))) removePed(p);
    }
    const civ = peds.filter(p => p.kind === 'civ').length;
    const bots = peds.filter(p => p.kind === 'bot' && p.state !== 'dead').length;
    const wantBot = bots < MAX_BOTS && G.t > 25;
    if (civ < MAX_PEDS || wantBot) {
      const i = clamp(Math.floor((me.x + G.cityHALF) / (2 * G.cityHALF / N)) + Math.floor(rnd(-2, 3)), 0, N - 1);
      const j = clamp(Math.floor((me.z + G.cityHALF) / (2 * G.cityHALF / N)) + Math.floor(rnd(-2, 3)), 0, N - 1);
      const loop = walkLoop(i, j);
      const a = Math.floor(rnd(0, 4)), t = Math.random();
      const q = loop[a].clone().lerp(loop[(a + 1) % 4], t);
      if (q.distanceTo(me) > 35 || !G.started) {
        const bot = wantBot && (civ >= MAX_PEDS || Math.random() < 0.3) && q.distanceTo(me) > 50;
        const p = spawnPed(q.x, q.z, bot ? { kind: 'bot', hp: 70 } : {});
        p.loop = loop;
        p.li = (a + 1) % 4;
        p.dir = 1;
      }
    }
  }
  for (const p of [...peds]) stepPed(p, dt);
}, 40);
