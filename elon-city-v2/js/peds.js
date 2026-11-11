// People: one low-poly body shared by pedestrians, police and the player; pedestrians walking the sidewalks.
import { THREE, V3, scene, camera, G, IS_MOBILE, clamp, rnd, pick, wrapA, collide, onUpdate, damp, bus, clearLine } from './core.js';
import { isLand, nodes, edges, edgePoint, nearestEdge, randomEdgeNear, walkOffset } from './world.js';
import { vehicles, fwdVec } from './vehicles.js';
import { burning, sparks } from './fx.js';
import { sfx } from './audio.js';
import { makeHuman, animHuman, disposeHuman } from './people.js';

export { makeHuman, animHuman };

/* ---------------- pedestrians ---------------- */
export const peds = [];
const MAX_PEDS = IS_MOBILE ? 64 : 110;
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

// People walk the sidewalks: along a street on one side, then on round the corner onto another.
const _w = {};
const walkAt = (p, out = _w) => {
  const r = p.route;
  edgePoint(r.e, r.dir > 0 ? r.s : r.e.len - r.s, out);
  const fx = out.dx * r.dir, fz = out.dz * r.dir, o = walkOffset(r.e) * r.side;
  out.x += -fz * o;
  out.z += fx * o;
  out.dx = fx;
  out.dz = fz;
  return out;
};
const joinRoute = p => {
  const q = nearestEdge(p.pos.x, p.pos.z, () => true, 4);
  if (!q) return false;
  edgePoint(q.e, q.s, _w);
  const dir = _w.dx * Math.sin(p.yaw) + _w.dz * Math.cos(p.yaw) >= 0 ? 1 : -1;
  const side = (p.pos.x - _w.x) * -_w.dz * dir + (p.pos.z - _w.z) * _w.dx * dir >= 0 ? 1 : -1;
  p.route = { e: q.e, dir, s: dir > 0 ? q.s : q.e.len - q.s, side };
  return true;
};
const turnCorner = r => {
  const nd = nodes[r.dir > 0 ? r.e.b : r.e.a];
  let opts = nd.all.filter(o => o.e !== r.e && !o.e.c.startsWith('motorway'));
  if (!opts.length) opts = [{ e: r.e, dir: -r.dir }];
  const o = opts[Math.floor(Math.random() * opts.length)];
  r.e = o.e;
  r.dir = o.dir;
  r.s = Math.min(walkOffset(o.e), o.e.len / 2);
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
  if (r >= 25) sfx.scream();
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
    p.route = null;
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
    if (!p.route) joinRoute(p);
    if (p.route) {
      const r = p.route;
      r.s += p.speed * dt;
      if (r.s > r.e.len - Math.min(walkOffset(r.e), r.e.len / 2)) turnCorner(r);
      const tgt = walkAt(p);
      const dx = tgt.x - p.pos.x, dz = tgt.z - p.pos.z;
      // Ease onto the sidewalk line, then follow it exactly.
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const k = Math.min(1, (p.speed * 1.6 * dt) / d);
        p.pos.x += dx * k;
        p.pos.z += dz * k;
      }
      p.yaw = damp(p.yaw, p.yaw + wrapA(Math.atan2(tgt.dx, tgt.dz) - p.yaw), 6, dt);
    }
    speed = p.speed;
    p.glide = true;
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
      p.route = null;
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

  if (speed > 0 && p.state !== 'down' && p.state !== 'dead' && !p.glide) {
    p.pos.x += Math.sin(p.yaw) * speed * dt;
    p.pos.z += Math.cos(p.yaw) * speed * dt;
  }
  p.glide = false;
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
  // Far away, animate less often (it's a busy city).
  const d2 = p.pos.distanceToSquared(camera.position), far = d2 > 70 * 70;
  // Only people near you cast shadows.
  const shade = d2 < 45 * 45;
  if (p.h.model && p.shade !== shade) {
    p.shade = shade;
    p.h.model.traverse(o => o.isMesh && (o.castShadow = shade));
  }
  p.animDt = (p.animDt || 0) + dt;
  if (!far || (p.frame = (p.frame || 0) + 1) % 3 === 0 || pose === 'down') {
    animHuman(p.h, speed, p.animDt, pose);
    p.animDt = 0;
  }
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
    for (let k = 0; k < 6 && (peds.filter(p => p.kind === 'civ').length < MAX_PEDS || wantBot); k++) {
      const e = randomEdgeNear(me, 15, 120, e => !e.c.startsWith('motorway') && !e.bridge && e.len > 12);
      if (e) {
        const route = { e, dir: Math.random() < 0.5 ? 1 : -1, s: rnd(2, e.len - 2), side: Math.random() < 0.5 ? 1 : -1 };
        const q = walkAt({ route }, {});
        if (Math.hypot(q.x - me.x, q.z - me.z) > 20 && isLand(q.x, q.z)) {
          const bot = wantBot && (civ >= MAX_PEDS || Math.random() < 0.3) && Math.hypot(q.x - me.x, q.z - me.z) > 50;
          const p = spawnPed(q.x, q.z, bot ? { kind: 'bot', hp: 70 } : {});
          p.route = route;
          p.yaw = Math.atan2(q.dx, q.dz);
        }
      }
    }
  }
  for (const p of [...peds]) stepPed(p, dt);
}, 40);
