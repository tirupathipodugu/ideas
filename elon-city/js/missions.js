// The story (six missions) and endless jobs: Semi hauls, robotaxi fares, drone swarms, sky races, Starlink repairs, rocket cargo.
import { THREE, V3, scene, camera, G, keys, hit, touch, bus, clamp, rnd, pick, onUpdate, damp, IS_MOBILE } from './core.js';
import { places, terminals, starship, starbase, nodes, road, blockC, HALF, N } from './world.js';
import { vehicles, spawnVehicle, removeVehicle, startAI, fwdVec, blowUp } from './vehicles.js';
import { spawnDrone, drones, removeDrone } from './drones.js';
import { peds, spawnPed, removePed, animHuman } from './peds.js';
import { unlockFlameCrate, player, playerBody } from './player.js';
import { beam, explode, thrust, burning, flame, addShake, sparks, dust } from './fx.js';
import { sfx } from './audio.js';

/* ---------------- markers and blips ---------------- */
G.blips = [];
const markers = [];
// A tall glowing column you walk or drive into.
export const marker = (at, color = 0xffd23c, opts = {}) => {
  const g = new THREE.Group();
  const col = new THREE.Mesh(new THREE.CylinderGeometry(opts.r ?? 2.2, opts.r ?? 2.2, opts.h ?? 5, 32, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.9), transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  col.position.y = (opts.h ?? 5) / 2;
  g.add(col);
  const ring = new THREE.Mesh(new THREE.RingGeometry((opts.r ?? 2.2) - 0.25, opts.r ?? 2.2, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), side: THREE.DoubleSide, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), toneMapped: false }));
  arrow.rotation.x = Math.PI;
  arrow.position.y = (opts.h ?? 5) + 1.5;
  g.add(arrow);
  g.position.copy(at);
  if (opts.y) g.position.y = opts.y;
  scene.add(g);
  const m = { g, at: at.clone().setY(opts.y ?? 0), r: opts.r ?? 2.2, color, arrow, label: opts.label, blip: { x: at.x, z: at.z, color: '#' + new THREE.Color(color).getHexString(), big: true, label: opts.label } };
  G.blips.push(m.blip);
  markers.push(m);
  m.remove = () => {
    scene.remove(g);
    markers.splice(markers.indexOf(m), 1);
    G.blips.splice(G.blips.indexOf(m.blip), 1);
  };
  return m;
};
const inMarker = (m, extra = 0) => {
  const p = G.playerTarget();
  return Math.hypot(p.x - m.at.x, p.z - m.at.z) < m.r + extra && Math.abs(p.y - 1 - m.at.y) < 6;
};
onUpdate(dt => {
  for (const m of markers) {
    m.arrow.position.y = (m.arrow.userData.base ??= m.arrow.position.y) + Math.sin(G.t * 3) * 0.4;
    m.arrow.rotation.y += dt * 2;
  }
}, 60);

// A blip that follows something (a car, a drone, a passenger).
const follow = (obj, color) => {
  const b = { x: 0, z: 0, color, obj };
  G.blips.push(b);
  return { b, remove: () => G.blips.includes(b) && G.blips.splice(G.blips.indexOf(b), 1) };
};
onUpdate(() => {
  for (const b of G.blips) if (b.obj) {
    const p = b.obj.pos;
    b.x = p.x;
    b.z = p.z;
  }
}, 61);

/* ---------------- running a mission ---------------- */
// Each mission is steps; a step has an objective and a check. Helpers clean up after.
const runMission = def => {
  const ctx = { def, t: 0, step: 0, clean: [], time: def.time ?? null, data: {} };
  const m = {
    def,
    ctx,
    fail: why => end(false, why),
    pass: () => end(true),
  };
  const end = (ok, why) => {
    if (G.mission !== m) return;
    G.mission = null;
    for (const c of ctx.clean) c();
    def.cleanup?.(ctx, ok);
    bus.timer(null);
    bus.objective('');
    if (ok) {
      const pay = typeof def.reward === 'function' ? def.reward(ctx) : def.reward;
      G.money += pay;
      sfx.pass();
      bus.big(def.passTitle ?? 'MISSION PASSED', `${def.title}  ·  +$${pay.toLocaleString()}${def.passNote ? '  ·  ' + def.passNote(ctx) : ''}`, '#ffd23c', 4);
      if (def.story) G.done.push(def.id);
      if (def.job) G.jobsDone = (G.jobsDone || 0) + 1;
      save();
    } else {
      sfx.fail();
      bus.big('MISSION FAILED', why || '', '#ff3355', 3.5);
    }
    setTimeout(refreshGivers, 4200);
  };
  G.mission = m;
  clearGivers();
  bus.big(def.title, def.intro, def.color ?? '#ff4fa3', 4);
  def.start(ctx, m);
  return m;
};
onUpdate(dt => {
  const m = G.mission;
  if (!m || G.paused) return;
  const ctx = m.ctx;
  ctx.t += dt;
  if (ctx.time != null && G.mode !== 'cutscene') {
    ctx.time -= dt;
    bus.timer(ctx.time);
    if (ctx.time <= 0) return m.fail('Out of time.');
  }
  m.def.update(ctx, dt, m);
}, 55);

/* ---------------- the story ---------------- */
const keepCar = (type, at, yaw, ctx) => {
  const v = spawnVehicle(type, at.x, at.z, yaw, { mission: ctx.def.id });
  v.keep = true;
  ctx.clean.push(() => {
    v.mission = null;
    v.keep = false;
  });
  return v;
};
const waypoint = (ctx, at, color = 0xffd23c, opts) => {
  const m = marker(at, color, opts);
  ctx.clean.push(() => markers.includes(m) && m.remove());
  return m;
};
const needCar = (ctx, v, name) => {
  if (v.dead || v.sink > 0) return 'dead';
  return G.car === v;
};

const STORY = [
  {
    id: 'giga',
    story: true,
    title: 'Giga Delivery',
    giver: () => places.giga,
    intro: 'Three battery drops across town before the line stops. Take the Cybertruck.',
    reward: 5000,
    start(ctx) {
      ctx.truck = keepCar('cybertruck', places.giga.clone().add(new V3(8, 0, 13)), Math.PI / 2, ctx);
      ctx.drops = [new V3(road(6), 0, road(2)), new V3(road(2), 0, road(3)), new V3(road(5), 0, road(7))];
      ctx.f = follow(ctx.truck, '#3fd6ff');
      ctx.clean.push(ctx.f.remove);
      bus.objective('Get in the <b>Cybertruck</b>.');
    },
    update(ctx, dt, m) {
      const ok = needCar(ctx, ctx.truck);
      if (ok === 'dead') return m.fail('The Cybertruck was destroyed. (Somehow.)');
      if (ctx.step === 0 && ok) {
        ctx.step = 1;
        ctx.time = 120;
        ctx.f.remove();
        ctx.m = waypoint(ctx, ctx.drops[0], 0xffd23c, { r: 4, label: 'Drop 1' });
        bus.objective('Deliver battery packs: <b>drop 1 of 3</b>.');
      }
      if (ctx.step >= 1 && ctx.step <= 3) {
        if (!ok) return bus.objective('Get back in the <b>Cybertruck</b>.');
        bus.objective(`Deliver battery packs: <b>drop ${ctx.step} of 3</b>.`);
        if (inMarker(ctx.m, 1) && ctx.truck.vel.length() < 14) {
          ctx.m.remove();
          sfx.coin();
          ctx.step++;
          ctx.time += 15;
          if (ctx.step === 4) return m.pass();
          bus.toast('Delivered. +15 s');
          ctx.m = waypoint(ctx, ctx.drops[ctx.step - 1], 0xffd23c, { r: 4, label: 'Drop ' + ctx.step });
        }
      }
    },
  },
  {
    id: 'flame',
    story: true,
    title: 'Not-a-Flamethrower',
    giver: () => places.boring,
    intro: 'Rogue delivery drones are dropping parcels on people. The Boring Company lent you something warm.',
    reward: 8000,
    start(ctx) {
      G.weapons[1] = true;
      G.ammo[1] = 100;
      G.weapon = 1;
      bus.weapon();
      unlockFlameCrate();
      bus.toast('Got the Not-a-Flamethrower. Hold fire to use it.');
      const c = new V3(blockC(4), 0, blockC(4));
      ctx.drones = [];
      for (let k = 0; k < 8; k++) {
        const d = spawnDrone(c.x + rnd(-60, 60), c.z + rnd(-60, 60), { mission: 'flame', y: rnd(6, 12) });
        d.hp = 22;
        ctx.drones.push(d);
        const f = follow(d, '#ff3a4a');
        ctx.clean.push(f.remove);
      }
      ctx.clean.push(() => ctx.drones.forEach(d => !d.dead && removeDrone(d)));
    },
    update(ctx, dt, m) {
      const left = ctx.drones.filter(d => !d.dead && drones.includes(d)).length;
      for (const b of G.blips) if (b.obj && b.obj.dead) b.color = 'transparent';
      bus.objective(`Burn the rogue drones: <b>${8 - left} / 8</b>${G.mode === 'car' ? ' · get out to use the flamethrower' : ''}`);
      if (left === 0) m.pass();
    },
  },
  {
    id: 'starlink',
    story: true,
    title: 'Starlink Uplink',
    giver: () => places.starlink,
    intro: 'Four ground terminals went dark. Power each one up and hold your ground while it locks on.',
    reward: 12000,
    time: 260,
    passNote: () => 'Starlink Strike unlocked (weapon 4) · full city map',
    start(ctx) {
      ctx.left = [0, 1, 2, 3];
      ctx.ms = ctx.left.map(i => waypoint(ctx, places.terminals[i], 0x7fe0ff, { r: 3.5, label: 'Terminal' }));
      ctx.hold = 0;
    },
    update(ctx, dt, m) {
      bus.objective(`Power up the Starlink terminals: <b>${4 - ctx.left.length} / 4</b>${ctx.hold > 0 ? ` · locking on ${Math.round((ctx.hold / 3) * 100)}%` : ''}`);
      let inside = -1;
      for (const i of ctx.left) if (inMarker(ctx.ms[i])) inside = i;
      if (inside < 0) {
        ctx.hold = Math.max(0, ctx.hold - dt);
        return;
      }
      if (ctx.hold === 0) {
        for (let k = 0; k < 2; k++) {
          const at = places.terminals[inside];
          const d = spawnDrone(at.x + rnd(-40, 40), at.z + rnd(-40, 40), { mission: 'starlink' });
          ctx.clean.push(() => !d.dead && removeDrone(d));
        }
      }
      ctx.hold += dt;
      terminals[inside].children[1].rotation.z += dt * 2;
      if (ctx.hold >= 3) {
        const at = places.terminals[inside].clone().setY(1.6);
        beam(at, at.clone().add(new V3(80, 900, -60)), 0x7fe0ff, 0.35, 2.5);
        sfx.beam();
        ctx.ms[inside].remove();
        ctx.left = ctx.left.filter(i => i !== inside);
        ctx.hold = 0;
        if (!ctx.left.length) {
          G.uplink = true;
          G.weapons[3] = true;
          bus.weapon();
          m.pass();
        }
      }
    },
  },
  {
    id: 'robotaxi',
    story: true,
    title: 'Robotaxi Rumble',
    giver: () => places.park,
    intro: 'Three robotaxis got a bad update and are terrorising the streets. Take them off the road, any way you like.',
    reward: 15000,
    time: 240,
    start(ctx) {
      ctx.cars = [];
      for (let k = 0; k < 3; k++) {
        const n = pick(nodes.filter(n => Math.hypot(n.x - G.playerPos.x, n.z - G.playerPos.z) > 120));
        const v = spawnVehicle('rogue', n.x, n.z, 0, { driver: 'ai', mission: 'robotaxi' });
        v.keep = true;
        v.hp = 160;
        startAI(v, n);
        v.ai.cruise = 21;
        ctx.cars.push(v);
        const f = follow(v, '#ff3a4a');
        ctx.clean.push(f.remove);
      }
      ctx.clean.push(() => ctx.cars.forEach(v => (v.keep = false)));
      if (!G.car) {
        const v = keepCar('cybertruck', G.playerPos.clone().add(new V3(5, 0, 0)), 0, ctx);
        bus.toast('A Cybertruck for the job.');
      }
    },
    update(ctx, dt, m) {
      const left = ctx.cars.filter(v => !v.dead && v.fire <= 0 && v.hp > 0 && v.sink === 0);
      for (const v of left) if (v.ai) v.ai.cruise = G.playerTarget().distanceTo(v.pos) < 40 ? 26 : 21;
      for (const b of G.blips) if (b.obj && (b.obj.dead || b.obj.fire > 0)) b.color = 'transparent';
      bus.objective(`Wreck the rogue robotaxis: <b>${3 - left.length} / 3</b>`);
      if (!left.length) m.pass();
    },
  },
  {
    id: 'heist',
    story: true,
    title: 'Prototype Heist',
    giver: () => places.service,
    intro: 'Rival Motors stole a prototype Cybertruck. Take it back. Their alarm goes straight to ElonPD.',
    reward: 25000,
    start(ctx) {
      ctx.truck = keepCar('prototype', places.lot.clone(), 0, ctx);
      ctx.f = follow(ctx.truck, '#b36bff');
      ctx.clean.push(ctx.f.remove);
      bus.objective('Steal the <b>prototype</b> from Rival Motors.');
    },
    update(ctx, dt, m) {
      const ok = needCar(ctx, ctx.truck);
      if (ok === 'dead') return m.fail('The prototype was wrecked.');
      if (ctx.step === 0 && ok) {
        ctx.step = 1;
        G.setStars(3);
        bus.toast('Alarm! Three stars.');
      }
      if (ctx.step === 1) {
        if (!ok) return bus.objective('Get back in the <b>prototype</b>.');
        bus.objective(G.stars > 0 ? 'Lose ElonPD: break line of sight, take the <b>Boring tunnel</b>, or get a respray.' : 'Lost them.');
        if (G.stars === 0) {
          ctx.step = 2;
          ctx.m = waypoint(ctx, places.giga, 0xffd23c, { r: 5, label: 'Gigafactory' });
        }
      }
      if (ctx.step === 2) {
        if (!ok) return bus.objective('Get back in the <b>prototype</b>.');
        bus.objective('Bring the prototype to the <b>Gigafactory</b>.');
        if (inMarker(ctx.m, 1)) m.pass();
      }
    },
  },
  {
    id: 'starbase',
    story: true,
    title: 'Starbase',
    giver: () => places.giga,
    intro: 'The Roadster is going to orbit. Fly it to Starbase, then catch the booster when it comes home.',
    reward: 100000,
    passNote: ctx => (ctx.caught ? 'Booster caught by the tower!' : 'Booster lost in the sea'),
    start(ctx) {
      ctx.car = keepCar('roadster', places.giga.clone().add(new V3(-8, 0, 13)), Math.PI / 2, ctx);
      ctx.f = follow(ctx.car, '#ff4f6a');
      ctx.clean.push(ctx.f.remove);
      bus.objective('Get in the <b>Roadster</b>.');
    },
    update(ctx, dt, m) {
      if (ctx.step < 2) {
        const ok = needCar(ctx, ctx.car);
        if (ok === 'dead') return m.fail('The Roadster was destroyed.');
        if (ctx.step === 0 && ok) {
          ctx.step = 1;
          ctx.f.remove();
          ctx.m = waypoint(ctx, places.pad.clone().add(new V3(-30, 0, 0)), 0xffd23c, { r: 6, label: 'Starbase' });
          bus.toast(IS_MOBILE ? 'Tap FLY to fly the Roadster' : 'Press G to fly the Roadster');
        }
        if (ctx.step === 1) {
          bus.objective(ok ? 'Take the Roadster to the <b>launch pad</b> at Starbase.' : 'Get back in the <b>Roadster</b>.');
          if (ok && inMarker(ctx.m, 3) && ctx.car.vel.length() < 10) {
            ctx.m.remove();
            ctx.step = 2;
            launch(ctx, m);
          }
        }
        return;
      }
      ctx.scene?.(dt);
    },
  },
];

/* ---------------- the launch and the catch ---------------- */
const launch = (ctx, m) => {
  G.leaveCar(true);
  ctx.car.root.visible = false;
  ctx.car.pos.set(places.pad.x, -50, places.pad.z);
  G.mode = 'cutscene';
  G.noCops = true;
  G.clearWanted();
  const ship = starship;
  const { booster, ship: upper } = ship.userData;
  const pad = places.pad;
  let t = 0;
  bus.objective('');
  bus.big('T-10', 'The Roadster is loaded in the ship.', '#ffffff', 2);
  ctx.scene = dt => {
    t += dt;
    const count = 10 - Math.floor(t);
    if (t < 10) {
      if (Math.floor(t) !== Math.floor(t - dt)) {
        bus.big(count > 0 ? `T-${count}` : 'LIFTOFF', '', '#ffffff', 0.9);
        sfx.blip();
      }
      camera.position.set(pad.x - 140 + t * 4, 20 + t, pad.z + 110);
      camera.lookAt(pad.x, 50, pad.z);
      if (t > 8) {
        ship.userData.plume.visible = true;
        ship.userData.plume.material.uniforms.uT.value = t;
        ship.userData.plume.material.uniforms.uK.value = Math.min(1, (t - 8) / 2);
        for (let k = 0; k < 4; k++) dust(new V3(pad.x + rnd(-6, 6), 2, pad.z + rnd(-6, 6)), 6);
      }
      if (t > 9.9 && t - dt <= 9.9) sfx.launch();
      return;
    }
    // Climb, then stage separation at 1,200 m.
    const ft = t - 10;
    const y = 10 + 3 * ft * ft;
    if (!ctx.sep) {
      ship.position.y = y;
      ship.userData.plume.material.uniforms.uT.value = t;
      if (y < 80) for (let k = 0; k < 6; k++) dust(new V3(pad.x + rnd(-10, 10), 2, pad.z + rnd(-10, 10)), 8);
      for (let k = 0; k < 4; k++) thrust(new V3(pad.x + rnd(-3, 3), y - 30, pad.z + rnd(-3, 3)), new V3(0, -1, 0), 4, 0xffa040);
      addShake(0.05);
      camera.position.set(pad.x - 160, Math.max(20, y * 0.6), pad.z + 140);
      camera.lookAt(pad.x, y + 40, pad.z);
      if (y > 900) {
        ctx.sep = true;
        bus.big('STAGE SEPARATION', 'Ship to orbit with the Roadster. Now bring the booster home.', '#7fe0ff', 3);
        sfx.whoosh();
        // The ship flies on alone; the booster becomes yours.
        scene.attach(upper);
        ctx.upper = upper;
        ctx.boost = { pos: new V3(pad.x + 160, 520, pad.z + 60), vel: new V3(-6, -38, -2), fuel: 100 };
        booster.position.set(0, 0, 0);
        ship.position.copy(ctx.boost.pos);
        bus.objective(IS_MOBILE ? 'Catch the booster: stick to steer, FIRE to burn engines. Slow down at the chopsticks.' : 'Catch the booster: <b>W / Space</b> burn, <b>A D</b> and <b>↑ ↓</b> steer. Under 10 m/s at the chopsticks.');
      }
      return;
    }
    ctx.upper.position.y += dt * 200;
    catchStep(ctx, m, dt);
  };
  ctx.clean.push(() => {
    G.noCops = false;
    if (G.mode === 'cutscene') G.mode = 'foot';
    playerBody.root.visible = true;
    player.pos.copy(places.starbase).add(new V3(0, 0, 10));
    resetStarship(ctx);
    removeVehicle(ctx.car);
  });
};

const resetStarship = ctx => {
  const { booster, ship: upper } = starship.userData;
  starship.add(upper);
  upper.position.set(0, 54, 0);
  starship.position.set(places.pad.x, 10, places.pad.z);
  starship.rotation.set(0, 0, 0);
  starbase.sticks.rotation.y = 0;
  starship.userData.plume.visible = false;
};

const catchStep = (ctx, m, dt) => {
  const b = ctx.boost;
  const burn = keys.has('KeyW') || keys.has('Space') || touch.fire ? 1 : 0;
  const ax = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + touch.x;
  const az = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0) - touch.y;
  const thrustOn = burn && b.fuel > 0;
  if (thrustOn) b.fuel -= dt * 9;
  b.vel.y += (-14 + (thrustOn ? 34 : 0)) * dt;
  b.vel.x += clamp(ax, -1, 1) * 10 * dt;
  b.vel.z += clamp(az, -1, 1) * 10 * dt;
  b.vel.x *= Math.exp(-0.3 * dt);
  b.vel.z *= Math.exp(-0.3 * dt);
  b.pos.addScaledVector(b.vel, dt);
  starship.position.copy(b.pos);
  starship.rotation.z = -b.vel.x * 0.01;
  starship.rotation.x = b.vel.z * 0.01;
  const plume = starship.userData.plume;
  plume.visible = thrustOn;
  plume.material.uniforms.uT.value = G.t;
  plume.material.uniforms.uK.value = 0.8;
  if (thrustOn) for (let k = 0; k < 3; k++) thrust(b.pos.clone().add(new V3(rnd(-2, 2), -24, rnd(-2, 2))), new V3(0, -1, 0), 3, 0xffa040);
  // The catch point sits between the chopsticks.
  const tw = starbase.tower;
  const cx = tw.x + 5 + 11, cz = tw.z;
  const gripY = 70 - 50;
  const dx = b.pos.x - cx, dz = b.pos.z - cz;
  const off = Math.hypot(dx, dz);
  camera.position.lerp(new V3(b.pos.x - 90, Math.max(30, b.pos.y * 0.7 + 20), b.pos.z + 90), 1 - Math.exp(-dt * 2));
  camera.lookAt(b.pos.x, b.pos.y, b.pos.z);
  bus.objective(`Catch the booster · alt <b>${Math.max(0, Math.round(b.pos.y - gripY))} m</b> · speed <b>${Math.round(-b.vel.y)} m/s</b> · off by <b>${Math.round(off)} m</b> · fuel <b>${Math.max(0, Math.round(b.fuel))}%</b>`);
  if (b.pos.y <= gripY + 1.5 && b.pos.y >= gripY - 6 && off < 4 && Math.abs(b.vel.y) < 10) {
    ctx.caught = true;
    starbase.sticks.rotation.y = 0.05;
    starship.position.set(cx, gripY, cz);
    starship.rotation.set(0, 0, 0);
    sfx.crash(1.2);
    sparks(new V3(cx, 70, cz), 40);
    G.mode = 'foot';
    return m.pass();
  }
  if (b.pos.y < 2) {
    ctx.caught = false;
    explode(b.pos.clone().setY(2), 2.2);
    sfx.boom(1.5);
    G.mode = 'foot';
    return m.pass();
  }
};

/* ---------------- endless jobs ---------------- */
const randomNodeNear = (p, min, max) => pick(nodes.filter(n => { const d = Math.hypot(n.x - p.x, n.z - p.z); return d > min && d < max; })) || pick(nodes);

const JOBS = [
  {
    kind: 'haul',
    title: 'Semi Haul',
    label: 'Semi haul',
    color: 0x3fd6ff,
    intro: 'Megacharger-to-door freight. Two drops, one Tesla Semi, no excuses.',
    make(at) {
      return {
        start(ctx) {
          ctx.truck = keepCar('semi', at.clone().add(new V3(6, 0, 0)), 0, ctx);
          ctx.drops = [randomNodeNear(at, 150, 320), randomNodeNear(at, 150, 320)].map(n => new V3(n.x, 0, n.z));
          ctx.f = follow(ctx.truck, '#3fd6ff');
          ctx.clean.push(ctx.f.remove);
          bus.objective('Get in the <b>Semi</b>.');
        },
        update(ctx, dt, m) {
          const ok = needCar(ctx, ctx.truck);
          if (ok === 'dead') return m.fail('The Semi is wrecked.');
          if (ctx.step === 0 && ok) {
            ctx.step = 1;
            ctx.time = 95;
            ctx.f.remove();
            ctx.m = waypoint(ctx, ctx.drops[0], 0x3fd6ff, { r: 5 });
          }
          if (ctx.step >= 1) {
            if (!ok) return bus.objective('Get back in the <b>Semi</b>.');
            bus.objective(`Deliver the freight: <b>${ctx.step} / 2</b>. Cargo damage costs you.`);
            if (inMarker(ctx.m, 2) && ctx.truck.vel.length() < 10) {
              ctx.m.remove();
              sfx.coin();
              if (++ctx.step > 2) return m.pass();
              ctx.time += 50;
              ctx.m = waypoint(ctx, ctx.drops[1], 0x3fd6ff, { r: 5 });
            }
          }
        },
        reward: ctx => Math.round(3000 + Math.max(0, ctx.truck.hp) * 30),
      };
    },
  },
  {
    kind: 'taxi',
    title: 'Robotaxi Fares',
    label: 'Robotaxi',
    color: 0xffc935,
    intro: 'The Cybercab fleet is short a driver. Pick people up, get them there fast. Keep the streak going.',
    make(at) {
      return {
        start(ctx) {
          ctx.cab = keepCar('cybercab', at.clone().add(new V3(6, 0, 0)), 0, ctx);
          ctx.fares = 0;
          ctx.pay = 0;
          ctx.f = follow(ctx.cab, '#ffc935');
          ctx.clean.push(ctx.f.remove);
          bus.objective('Get in the <b>Cybercab</b>.');
        },
        update(ctx, dt, m) {
          const ok = needCar(ctx, ctx.cab);
          if (ok === 'dead') return ctx.fares ? m.pass() : m.fail('The Cybercab is wrecked.');
          if (ctx.step === 0 && ok) {
            ctx.f.remove();
            ctx.step = 1;
            newFare(ctx);
          }
          if (ctx.step === 0) return;
          if (!ok) {
            if (ctx.t - (ctx.leftT ??= ctx.t) > 1 && ctx.fares) return m.pass();
            return bus.objective('Get back in the <b>Cybercab</b>.');
          }
          ctx.leftT = null;
          if (ctx.step === 1) {
            bus.objective(`Pick up the passenger · fares <b>${ctx.fares}</b> · $${ctx.pay}`);
            if (inMarker(ctx.m, 2) && ctx.cab.vel.length() < 4) {
              ctx.m.remove();
              removePed(ctx.rider);
              ctx.step = 2;
              const n = randomNodeNear(ctx.cab.pos, 120, 300);
              ctx.m = waypoint(ctx, new V3(n.x, 0, n.z), 0xffc935, { r: 4 });
              ctx.time = 20 + ctx.cab.pos.distanceTo(ctx.m.at) / 9;
              sfx.door();
            }
          } else if (ctx.step === 2) {
            bus.objective(`Drop the passenger off · fares <b>${ctx.fares}</b> · $${ctx.pay} · leave the cab to stop`);
            if (inMarker(ctx.m, 2) && ctx.cab.vel.length() < 4) {
              ctx.m.remove();
              ctx.fares++;
              const fare = 150 + ctx.fares * 100 + Math.round(Math.max(0, ctx.time) * 10);
              ctx.pay += fare;
              G.money += fare;
              sfx.coin();
              bus.toast(`Fare +$${fare}`);
              ctx.time = null;
              bus.timer(null);
              ctx.step = 1;
              newFare(ctx);
            }
          }
        },
        reward: ctx => ctx.fares * 250,
      };
    },
  },
  {
    kind: 'swarm',
    title: 'Drone Swarm',
    label: 'Drone swarm',
    color: 0xff3a4a,
    intro: 'A swarm of rogue drones is circling the block. Clear the sky.',
    make(at) {
      return {
        start(ctx) {
          ctx.drones = [];
          const n = 5 + Math.min(7, G.jobsDone || 0);
          for (let k = 0; k < n; k++) {
            const d = spawnDrone(at.x + rnd(-50, 50), at.z + rnd(-50, 50), { mission: 'swarm', y: rnd(8, 16) });
            ctx.drones.push(d);
            const f = follow(d, '#ff3a4a');
            ctx.clean.push(f.remove);
          }
          ctx.n = n;
          ctx.clean.push(() => ctx.drones.forEach(d => !d.dead && removeDrone(d)));
          if (!G.weapons[1] && !G.weapons[2]) {
            G.weapons[2] = true;
            G.ammo[2] = 30;
            G.weapon = 2;
            bus.weapon();
            bus.toast('Loaned: Tesla Coil Gun');
          }
        },
        update(ctx, dt, m) {
          const left = ctx.drones.filter(d => !d.dead && drones.includes(d)).length;
          for (const b of G.blips) if (b.obj && b.obj.dead) b.color = 'transparent';
          bus.objective(`Take down the drones: <b>${ctx.n - left} / ${ctx.n}</b>`);
          if (!left) m.pass();
        },
        reward: ctx => 400 * ctx.n,
      };
    },
  },
  {
    kind: 'skyrace',
    title: 'Sky Race',
    label: 'Sky race',
    color: 0xff4fa3,
    intro: 'The flying Roadster against the clock. Through every ring, over the rooftops.',
    make(at) {
      return {
        start(ctx) {
          ctx.car = keepCar('roadster', at.clone().add(new V3(6, 0, 0)), 0, ctx);
          ctx.rings = [];
          let p = at.clone();
          for (let k = 0; k < 8; k++) {
            const a = rnd(0, Math.PI * 2);
            p = new V3(clamp(p.x + Math.cos(a) * rnd(70, 110), -HALF + 20, HALF - 20), rnd(25, 80), clamp(p.z + Math.sin(a) * rnd(70, 110), -HALF + 20, HALF - 20));
            ctx.rings.push(p.clone());
          }
          ctx.f = follow(ctx.car, '#ff4fa3');
          ctx.clean.push(ctx.f.remove);
          bus.objective(IS_MOBILE ? 'Get in the <b>Roadster</b>, then tap FLY.' : 'Get in the <b>Roadster</b>, then press <b>G</b> to fly.');
        },
        update(ctx, dt, m) {
          const ok = needCar(ctx, ctx.car);
          if (ok === 'dead') return m.fail('The Roadster is wrecked.');
          if (ctx.step === 0 && ok) {
            ctx.f.remove();
            ctx.step = 1;
            ctx.time = 70;
            ctx.ring = ring(ctx, ctx.rings[0]);
          }
          if (ctx.step === 0) return;
          bus.objective(`Fly through the rings: <b>${ctx.step - 1} / ${ctx.rings.length}</b>${ctx.car.flying ? '' : ' · press G to fly'}`);
          if (ctx.car.pos.distanceTo(ctx.rings[ctx.step - 1]) < 9) {
            ctx.ring.remove();
            sfx.coin();
            ctx.time += 4;
            if (ctx.step++ >= ctx.rings.length) return m.pass();
            ctx.ring = ring(ctx, ctx.rings[ctx.step - 1]);
          }
        },
        reward: ctx => 2500 + Math.round(ctx.time * 80),
      };
    },
  },
  {
    kind: 'outage',
    title: 'Starlink Outage',
    label: 'Starlink repair',
    color: 0x7fe0ff,
    intro: 'Two terminals dropped off the network. Get there, power them up, keep the internet on.',
    make(at) {
      return {
        start(ctx) {
          ctx.left = [...places.terminals.keys()].sort(() => Math.random() - 0.5).slice(0, 2);
          ctx.ms = {};
          for (const i of ctx.left) ctx.ms[i] = waypoint(ctx, places.terminals[i], 0x7fe0ff, { r: 3.5 });
          ctx.time = 150;
          ctx.hold = 0;
        },
        update(ctx, dt, m) {
          bus.objective(`Repair the terminals: <b>${2 - ctx.left.length} / 2</b>${ctx.hold > 0 ? ` · ${Math.round((ctx.hold / 2.5) * 100)}%` : ''}`);
          const inside = ctx.left.find(i => inMarker(ctx.ms[i]));
          if (inside == null) return void (ctx.hold = 0);
          ctx.hold += dt;
          if (ctx.hold > 2.5) {
            const p = places.terminals[inside].clone().setY(1.6);
            beam(p, p.clone().add(new V3(60, 900, 40)), 0x7fe0ff, 0.35, 2);
            sfx.beam();
            ctx.ms[inside].remove();
            ctx.left = ctx.left.filter(i => i !== inside);
            ctx.hold = 0;
            if (!ctx.left.length) m.pass();
          }
        },
        reward: ctx => 2000 + Math.round(ctx.time * 20),
      };
    },
  },
  {
    kind: 'frenzy',
    title: 'Flame Frenzy',
    label: 'Flame frenzy',
    color: 0xff7a2a,
    intro: 'Not-a-Flamethrower, full tank, sixty seconds: torch six cars. ElonPD will have opinions.',
    make(at) {
      return {
        start(ctx) {
          G.weapons[1] = true;
          G.ammo[1] = 100;
          G.weapon = 1;
          bus.weapon();
          ctx.time = 60;
          ctx.burned = new Set();
          ctx.count = 0;
        },
        update(ctx, dt, m) {
          for (const v of vehicles) if (v.fire > 0 && !ctx.burned.has(v) && v.driver !== 'player') {
            ctx.burned.add(v);
            ctx.count++;
          }
          if (G.ammo[1] < 20) G.ammo[1] = 20;
          bus.objective(`Cars on fire: <b>${ctx.count} / 6</b>`);
          if (ctx.count >= 6) m.pass();
        },
        reward: () => 3000,
      };
    },
  },
];

const ring = (ctx, at) => {
  const g = new THREE.Mesh(new THREE.TorusGeometry(7, 0.6, 10, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4fa3).multiplyScalar(2.5), toneMapped: false }));
  g.position.copy(at);
  g.rotation.y = rnd(0, Math.PI);
  scene.add(g);
  const blip = { x: at.x, z: at.z, color: '#ff4fa3', big: true };
  G.blips.push(blip);
  const r = { remove: () => { scene.remove(g); G.blips.includes(blip) && G.blips.splice(G.blips.indexOf(blip), 1); } };
  ctx.clean.push(r.remove);
  return r;
};

const newFare = ctx => {
  const n = randomNodeNear(ctx.cab.pos, 60, 200);
  const at = new V3(n.x + 11, 0, n.z + 11);
  ctx.rider = spawnPed(at.x, at.z, { state: 'wait' });
  ctx.rider.wave = true;
  ctx.clean.push(() => peds.includes(ctx.rider) && removePed(ctx.rider));
  ctx.m = waypoint(ctx, at, 0xffc935, { r: 4 });
  ctx.time = null;
};

const startJob = (job, at) => {
  const body = job.make(at);
  runMission({ id: job.kind, job: true, title: job.title, intro: job.intro, color: '#' + new THREE.Color(job.color).getHexString(), reward: body.reward, start: body.start, update: body.update, passTitle: 'JOB DONE' });
};

/* ---------------- givers: the next story mission and job offers ---------------- */
let givers = [];
const clearGivers = () => {
  for (const g of givers) g.m.remove();
  givers = [];
};
const refreshGivers = () => {
  if (G.mission) return;
  clearGivers();
  const next = STORY.find(s => !G.done.includes(s.id));
  if (next) {
    const m = marker(next.giver(), 0xffd23c, { label: next.title, r: 1.8, h: 3 });
    givers.push({ m, story: next });
  }
  // Two job offers near you, always.
  const p = G.playerPos;
  const kinds = [...JOBS].sort(() => Math.random() - 0.5).slice(0, 2);
  for (const job of kinds) {
    const n = randomNodeNear(p, 40, 180);
    const at = new V3(n.x + 11 * (Math.random() < 0.5 ? 1 : -1), 0, n.z + 11 * (Math.random() < 0.5 ? 1 : -1));
    const m = marker(at, job.color, { label: job.label, r: 1.8, h: 3 });
    givers.push({ m, job });
  }
};
G.refreshJobs = refreshGivers;
export const jobNow = () => {
  if (G.mission || G.mode === 'dead') return bus.toast('Finish what you\'re doing first');
  const job = pick(JOBS);
  startJob(job, G.playerPos.clone());
};

let giverT = 0;
onUpdate(dt => {
  if (!G.started || G.mission || G.mode !== 'foot' && G.mode !== 'car') return;
  for (const g of givers) {
    if (!inMarker(g.m)) continue;
    if (g.story) {
      if (g.story.id === 'starbase' && G.mode === 'car') return bus.toast('Walk into the marker to start');
      runMission(g.story);
    } else startJob(g.job, g.m.at.clone());
    return;
  }
  // Offers drift with you around town.
  giverT += dt;
  if (giverT > 45) {
    giverT = 0;
    if (givers.filter(g => g.job).some(g => g.m.at.distanceTo(G.playerPos) > 260)) refreshGivers();
  }
}, 56);

/* ---------------- save ---------------- */
const KEY = 'elon-city-save';
export const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ money: G.money, done: G.done, weapons: G.weapons, ammo: G.ammo.map(a => (a === Infinity ? -1 : a)), uplink: G.uplink, jobs: G.jobsDone || 0 }));
  } catch {}
};
export const load = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s) return false;
    G.money = s.money;
    G.done = s.done;
    G.weapons = s.weapons;
    G.ammo = s.ammo.map(a => (a === -1 ? Infinity : a));
    if (G.weapons.length < 5) {
      G.weapons[4] = true;
      G.ammo[4] = 16;
    }
    G.uplink = s.uplink;
    G.jobsDone = s.jobs;
    if (G.done.includes('flame')) unlockFlameCrate();
    return true;
  } catch {
    return false;
  }
};
export const resetSave = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {}
};
setInterval(() => G.started && !G.mission && save(), 15000);
export const storyProgress = () => `${G.done.length} / ${STORY.length}`;
