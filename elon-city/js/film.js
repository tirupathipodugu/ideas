// ====================== FILM: deterministic offline cinematic director ======================
// Activated by ?film=1 (plus &auto=1 to render). Takes over the camera and stages hero beats of
// every feature, renders frames at a fixed timestep, and POSTs JPEGs to the save-server (:8794).
// Encode with film/_tools/encode.sh. Nothing here runs unless ?film is present.
import { THREE, V3, scene, camera, G, renderer, composer, bloom, runUpdaters, groundAt, clamp, lerp, $, canvas, bus, solids, look } from './core.js';
import { places, starbase, starship, sun, followSun, nightU, nodes, edges, edgePoint, laneOffset, walkOffset } from './world.js';
import { player, playerBody, fireFlare } from './player.js';
import { spawnPed, removePed, peds } from './peds.js';
import { filmTunnel } from './loop.js';
import { spawnVehicle, vehicles, removeVehicle, fillTraffic } from './vehicles.js';
import { spawnDrone, drones, removeDrone } from './drones.js';
import { explode, beam, bolt, flame, sparks, addShake, thrust, muzzle, dust, splash } from './fx.js';

const Q = new URLSearchParams(location.search);
if (!Q.get('film')) { /* inert */ } else {

const FPS = +Q.get('fps') || 30;
const film = window.__film = { W: 1920, H: 1080, frame: 0, running: false, err: null, times: [], done: false, simT: 0, shot: '', log: [] };
window.__scene = scene;
film.dumpSky = () => scene.children.map((o, i) => ({ i, type: o.type, name: o.name || '', vis: o.visible, count: o.count || (o.geometry?.attributes?.position?.count) || 0, y: +(o.position?.y || 0).toFixed(0) })).filter(o => o.count > 200 || /Points|Instanced/.test(o.type));
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---- camera control ----
const cam = { p: new V3(0, 10, 60), t: new V3(0, 0, 0), fov: 50, roll: 0 };
const V = (x, y, z) => new V3(x, y, z);
const mix3 = (a, b, k) => new V3().lerpVectors(a, b, k);
const easeIO = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeOut = x => { x = clamp(x, 0, 1); return 1 - (1 - x) * (1 - x); };
const setCam = (p, t, fov = 45) => { cam.p.copy(p); cam.t.copy(t); cam.fov = fov; };
const dolly = (k, p0, p1, t0, t1, f0, f1 = f0) => setCam(mix3(p0, p1, k), mix3(t0, t1, k), lerp(f0, f1, k));
function applyCam() {
  camera.position.copy(cam.p);
  camera.lookAt(cam.t);
  if (Math.abs(camera.fov - cam.fov) > 1e-6) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
}

// ---- staged actors (spawned fresh each reset) ----
let stage = [];
const clearStage = () => { for (const v of stage) { try { v.dispose?.(); } catch {} try { removeVehicle(v); } catch {} try { removeDrone(v); } catch {} } stage = []; };
function car(type, x, z, yaw, opts = {}) { const v = spawnVehicle(type, x, z, yaw, opts); v.keep = true; v.inLoop = true; /* inLoop freezes its own AI/physics so the director owns it */ stage.push(v); return v; }
function placeCar(v, p, yaw, opts = {}) {
  v.pos.copy(p); v.yaw = yaw; v.root.position.copy(p); v.root.rotation.set(opts.pitch || 0, yaw, opts.roll || 0);
  if (v.body && (opts.pitch || opts.roll)) { /* body tilt handled by root */ }
  if (opts.wheel != null && v.wheelAngle != null) v.wheelAngle = opts.wheel;
  v.vel?.set?.(0, 0, 0);
  v.flying = !!opts.flying;
}

// ---- starship cinematic (bypasses the gameplay rocket controller) ----
const ssPlume = starship.userData.plume;
function stageStarship(y = 10, plume = 0, tilt = 0) {
  starship.position.set(places.pad.x, y, places.pad.z);
  starship.rotation.set(0, 0, tilt);
  starship.visible = true;
  ssPlume.visible = plume > 0.02;
  if (ssPlume.material.uniforms) { ssPlume.material.uniforms.uT.value = G.t; ssPlume.material.uniforms.uK.value = plume; }
}

// ===================== choreography helpers =====================
const DT = { x: -24, z: 18 };   // downtown centre (dense glass skyline)
const SCZ = edges[13];          // South Congress Avenue, a long straight run for the chase
const _ep = {};
function roadPoint(e, s) { edgePoint(e, clamp(s, 0, e.len), _ep); return { p: V(_ep.x, 0, _ep.z), yaw: Math.atan2(_ep.dx, _ep.dz) }; }
function flyArc(t, dur, a, b, apex) { const k = easeIO(t / dur); const p = mix3(a, b, k); p.y += apex * Math.sin(Math.PI * k); return p; }

// ===================== SHOTS =====================
// One movie, every feature. Each shot: dur, caption (shown in the lower letterbox bar), enter/update/exit.
const P = {};   // filled in reset() from live places
let hero = null, cop = null, flyer = null, swarm = [], taxi = null, tunnel = null, loopCar = null;
const CONG = edges[318];        // Congress Avenue downtown: wide, straight, busy
const SIXTH = edges[1615];      // West 6th Street
const FROST = { x: -23, z: 101 };   // a flat-roofed 201 m tower in the middle of downtown
// Lady Bird Lake: the river runs south-west of downtown, west to east.
const RIV = (() => {
  const a = V(-640, 0, 470), b = V(-150, 0, 690), f = b.clone().sub(a).normalize();
  return { a, b, f, r: V(f.z, 0, -f.x), yaw: Math.atan2(f.x, f.z) };
})();
// Fill the streets around a spot and let the city run a while, so the shot opens mid-life.
function warm(x, z, sec) {
  player.pos.set(x, 0, z);
  fillTraffic(player.pos);
  for (let i = 0; i < sec * 30; i++) { G.t += 1 / 30; runUpdaters(1 / 30); }
}
// Robots walking both sidewalks of a street, in every shell colour.
function crowd(e, n) {
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1, s = 4 + Math.random() * (e.len - 8);
    edgePoint(e, s, _ep);
    const off = walkOffset(e) * side + (Math.random() - 0.5) * 1.6;
    const p = spawnPed(_ep.x + _ep.dz * off, _ep.z - _ep.dx * off);
    p.route = { e, dir: Math.random() < 0.5 ? 1 : -1, s, side };
    p.yaw = Math.atan2(_ep.dx, _ep.dz) + (p.route.dir < 0 ? Math.PI : 0);
  }
}
const clearNear = (x, z, r) => { for (const v of [...vehicles]) if (!stage.includes(v) && Math.hypot(v.pos.x - x, v.pos.z - z) < r) removeVehicle(v); };
const camS = { on: false };

// Night as a film look: a touch darker than the game, so lit windows read as windows, not white boxes.
const nightLook = () => { renderer.toneMappingExposure = 0.6; bloom.strength = 0.45; bloom.threshold = 1.0; };
const shots = [
  // 1) AUSTIN — crane up over Starbase, Starship on the pad, the real Austin skyline behind.
  { name: 'establish', dur: 5.0, cap: 'Austin, Texas', sub: 'Real streets · 2,476 real buildings', enter() { stageStarship(10, 0); setAmbient(false); },
    update(t) { const k = easeIO(t / 5), pad = P.pad;
      dolly(k, V(pad.x + 120, 8, pad.z + 150), V(pad.x + 60, 95, pad.z + 95),
               V(pad.x, 55, pad.z), V(pad.x, 70, pad.z), 50, 40); } },

  // 2) OPTIMUS — street level on Congress Avenue, robots in a dozen shell colours on the sidewalks.
  { name: 'crowd', dur: 6.0, cap: 'Optimus robots on every sidewalk',
    enter() { setAmbient(true); edgePoint(CONG, CONG.len / 2, _ep); warm(_ep.x, _ep.z, 4); crowd(CONG, 44); for (let i = 0; i < 30; i++) { G.t += 1 / 30; runUpdaters(1 / 30); } },
    update(t) {
      const side = walkOffset(CONG) - 0.6;
      edgePoint(CONG, 18 + t * 2.2, _ep); const a = V(_ep.x + _ep.dz * side, 1.55, _ep.z - _ep.dx * side);
      edgePoint(CONG, 40 + t * 2.2, _ep); const b = V(_ep.x + _ep.dz * (side + 1.5), 1.6, _ep.z - _ep.dx * (side + 1.5));
      setCam(a, b, 46);
    } },

  // 3) ROBOTAXI — a yellow Robotaxi cruising Congress, camera tracking alongside.
  { name: 'robotaxi', dur: 6.0, cap: 'Hail a Robotaxi', sub: 'No driver. Hop in, it takes you anywhere',
    enter() {
      taxi = car('cybercab', 0, 0, 0);
      // Clear anything parked or stopped in the Robotaxi's lane.
      const lo = laneOffset(CONG);
      for (const v of [...vehicles]) { if (stage.includes(v)) continue;
        for (let s = 0; s < CONG.len; s += 4) { const h = roadPoint(CONG, s); const q = h.p.clone().add(V(Math.cos(h.yaw) * lo, 0, -Math.sin(h.yaw) * lo)); if (Math.hypot(v.pos.x - q.x, v.pos.z - q.z) < 7) { removeVehicle(v); break; } } }
    },
    update(t, dt) {
      const s = 6 + t * 14, h = roadPoint(CONG, s), lo = laneOffset(CONG);
      const p = h.p.clone().add(V(Math.cos(h.yaw) * lo, 0, -Math.sin(h.yaw) * lo));
      placeCar(taxi, p, h.yaw, { wheel: t * 40 });
      const f = V(Math.sin(h.yaw), 0, Math.cos(h.yaw)), r = V(Math.cos(h.yaw), 0, -Math.sin(h.yaw));
      const sw = lerp(-1, 1, easeIO(t / 6));
      setCam(p.clone().addScaledVector(r, -5.5).addScaledVector(f, 4 + sw * 3).setY(1.3), p.clone().addScaledVector(f, -sw * 1.5).setY(0.9), 44);
    } },

  // 4) ELONPD CHASE — tear down South Congress with an ElonPD cruiser on your tail.
  { name: 'chase', dur: 7.0, cap: 'Take any car. Outrun ElonPD.',
    enter() { hero = car('roadster', 0, 0, 0, { color: 0xffffff }); cop = car('police', 0, 0, 0); cop.siren = true; },
    update(t, dt) {
      const s0 = 30 + (SCZ.len - 60) * easeIO(t / 7);
      const h = roadPoint(SCZ, s0), c = roadPoint(SCZ, s0 - 16);
      const wob = Math.sin(t * 3.1) * 1.4;
      const hp = h.p.clone().add(V(Math.cos(h.yaw) * wob, 0.4, -Math.sin(h.yaw) * wob));
      const cp = c.p.clone().add(V(Math.cos(c.yaw) * -wob, 0.4, -Math.sin(c.yaw) * -wob));
      placeCar(hero, hp, h.yaw, { wheel: t * 60 });
      placeCar(cop, cp, c.yaw, { wheel: t * 60 });
      const back = V(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(-11), sd = V(Math.cos(h.yaw), 0, -Math.sin(h.yaw)).multiplyScalar(2.5);
      setCam(hp.clone().add(back).add(sd).add(V(0, 2.4, 0)), hp.clone().add(V(0, 1.0, 0)).add(V(Math.sin(h.yaw), 0, Math.cos(h.yaw)).multiplyScalar(10)), 52);
    } },

  // 5) FLARE GUN — on foot on West 6th, two rogue robots charge; flares drop them in flames.
  { name: 'flare', dur: 6.5, cap: 'Flare gun vs rogue robots',
    enter() {
      edgePoint(SIXTH, SIXTH.len * 0.45, _ep);
      const yaw = Math.atan2(_ep.dx, _ep.dz), at = V(_ep.x, 0, _ep.z);
      warm(at.x, at.z, 2); clearNear(at.x, at.z, 90);
      for (const p of [...peds]) if (Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < 30) removePed(p);
      this.yaw = yaw;
      player.pos.copy(at); player.yaw = yaw; look.yaw = yaw; look.pitch = 0.16;
      playerBody.root.visible = true; G.mode = 'foot'; G.weapon = 4; G.health = 1e6;
      const f = V(Math.sin(yaw), 0, Math.cos(yaw)), r = V(Math.cos(yaw), 0, -Math.sin(yaw));
      this.bots = [[22, 1.6], [27, -2]].map(([d, o]) => { const q = at.clone().addScaledVector(f, d).addScaledVector(r, o); const b = spawnPed(q.x, q.z, { kind: 'bot', hp: 70 }); b.yaw = yaw + Math.PI; return b; });
      this.n = 0;
    },
    update(t, dt) {
      const yaw = this.yaw, f = V(Math.sin(yaw), 0, Math.cos(yaw)), r = V(Math.cos(yaw), 0, -Math.sin(yaw));
      const tgt = this.bots.find(b => b.state !== 'dead' && b.state !== 'down' && b.hp > 0);
      if (tgt) { const d = tgt.pos.clone().sub(player.pos); look.yaw = Math.atan2(d.x, d.z); }
      const times = [1.1, 2.0, 2.9, 3.8];
      if (this.n < times.length && t >= times[this.n]) { if (tgt) fireFlare(); this.n++; }
      const k = easeIO(t / 6.5);
      const p = player.pos.clone().addScaledVector(f, lerp(-3.6, -2.6, k)).addScaledVector(r, 1.2).setY(1.85);
      setCam(p, player.pos.clone().addScaledVector(f, 14).setY(1.2), 50);
    },
    exit() { G.mode = 'cutscene'; playerBody.root.visible = false; } },

  // 6) THE LOOP — a Tesla flies through the Boring Company tunnel under downtown.
  { name: 'loop', dur: 6.0, cap: 'The Loop', sub: 'Boring Company tunnels under downtown',
    enter() { tunnel = filmTunnel(3, 1); loopCar = car('modely', 0, 0, 0, { color: 0xf4f4f4 }); },
    update(t, dt) {
      const L = tunnel.len, s = 60 + t * 34, u = clamp(s / L, 0, 1);
      const p = tunnel.curve.getPointAt(u), tan = tunnel.curve.getTangentAt(u);
      placeCar(loopCar, p.clone().setY(p.y - 0.6), Math.atan2(tan.x, tan.z));
      tunnel.lamp.position.copy(p).addScaledVector(tan, 6);
      const ahead = tunnel.curve.getPointAt(clamp((s + lerp(11, 7, easeIO(t / 6))) / L, 0, 1));
      setCam(ahead.clone().add(V(0.9, 1.0, 0)), p.clone().add(V(0, 0.2, 0)), 58);
    },
    exit() { scene.remove(tunnel.g); tunnel = null; } },

  // 7) LAUNCH — ignite the 33 Raptors, lift off the pad on a pillar of fire, climb into the sunset.
  { name: 'launch', dur: 6.0, cap: 'Starship lifts off from Starbase', enter() { stageStarship(10, 0); setAmbient(false); },
    update(t, dt) {
      const pad = P.pad, tau = Math.max(0, t - 0.8);
      const climb = 7 * tau * tau;
      const thr = clamp(tau / 0.35, 0, 1);
      stageStarship(10 + climb, thr);
      if (thr > 0.1) { addShake(0.06 * clamp(1 - climb / 400, 0, 1)); if (climb < 140) for (let k = 0; k < 4; k++) thrust(V(pad.x + (Math.random() * 2 - 1) * 6, 2, pad.z + (Math.random() * 2 - 1) * 6), V(0, -1, 0), 3, 0xffa040); }
      const k = easeIO(t / 6);
      setCam(mix3(V(pad.x + 165, 16, pad.z + 140), V(pad.x + 205, 95, pad.z + 180), k),
             V(pad.x, Math.min(30 + climb * 0.5, 150), pad.z), 44);
    } },

  // 8) CATCH — Super Heavy drops back between Mechazilla's chopsticks.
  { name: 'catch', dur: 6.0, cap: 'Caught by the chopsticks', enter() { starbase.sticks && (starbase.sticks.rotation.y = 0.18); },
    update(t, dt) {
      const tw = starbase.tower, k = easeIO(t / 4.2);
      const y = lerp(150, 22, k);
      starship.position.set(tw.x + 16, y, tw.z); starship.rotation.set(0, 0, 0); starship.visible = true;
      ssPlume.visible = t < 4.4; if (ssPlume.material.uniforms) { ssPlume.material.uniforms.uT.value = G.t; ssPlume.material.uniforms.uK.value = t < 4.4 ? clamp((4.4 - t), 0, 1) * 0.9 : 0; }
      if (starbase.sticks) starbase.sticks.rotation.y = lerp(0.18, 0.04, clamp((t - 3.4) / 1.2, 0, 1));
      if (t > 4.3 && t < 4.5) { sparks(V(tw.x + 16, 40, tw.z), 70); addShake(0.9); }
      setCam(mix3(V(tw.x + 150, 34, tw.z + 128), V(tw.x + 108, 78, tw.z + 92), k), V(tw.x + 16, lerp(95, 52, k), tw.z), 44);
    },
    exit() { stageStarship(10, 0); } },

  // 9) EVERY CAR FLIES — the Roadster banks through the downtown glass towers.
  { name: 'flight', dur: 7.0, cap: 'Every car flies',
    enter() { setAmbient(true); flyer = car('roadster', DT.x - 240, DT.z + 180, 0, { color: 0xc8101e }); },
    update(t, dt) {
      const a = V(DT.x - 240, 78, DT.z + 180), b = V(DT.x + 240, 92, DT.z - 150);
      const p = flyArc(t, 7, a, b, 26);
      const nx = flyArc(t + 0.1, 7, a, b, 26); const dir = nx.clone().sub(p);
      const yaw = Math.atan2(dir.x, dir.z), roll = clamp(-dir.x * 0.02, -0.5, 0.5);
      placeCar(flyer, p, yaw, { flying: true, pitch: -0.06, roll, wheel: t * 40 });
      const side = V(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(22);
      setCam(p.clone().add(side).add(V(0, 5, 0)), p.clone().add(V(0, 1, 0)), 46);
    } },

  // 9b) RIVER — a formation of flying cars skimming Lady Bird Lake at sunset, downtown towers along the bank.
  { name: 'river', dur: 7.0, cap: 'Skim Lady Bird Lake',
    enter() {
      this.cars = [['roadster', 0xc8101e, 0, 0], ['cybertruck', 0xb9bec6, -9, 4.5], ['modely', 0xf4f4f4, -11, -5], ['roadster', 0x15171c, -20, 0.5]]
        .map(([k, c, back, side]) => ({ v: car(k, RIV.a.x, RIV.a.z, 0, { color: c }), back, side }));
    },
    update(t) {
      const k = t / 7, f = RIV.f, r = RIV.r;
      const lead = mix3(RIV.a, RIV.b, 0.05 + k * 0.42);
      for (const [i, c] of this.cars.entries()) {
        const p = lead.clone().addScaledVector(f, c.back).addScaledVector(r, c.side);
        p.y = 4.5 + Math.sin(t * 1.7 + i) * 0.5 + i * 0.6;
        placeCar(c.v, p, RIV.yaw, { flying: true, pitch: -0.04, roll: 0.06 * Math.sin(t * 1.3 + i) });
        if (i < 2 && Math.random() < 0.6) splash(p.clone().setY(0.3).addScaledVector(f, -3));
      }
      const e = easeIO(k);
      setCam(lead.clone().addScaledVector(r, -lerp(24, 15, e)).addScaledVector(f, lerp(-14, 6, e)).setY(lerp(2.2, 6.5, e)), lead.clone().addScaledVector(f, -6).setY(4), lerp(46, 40, e));
    } },
  // 9c) RIVER, head-on — low over the water as they rip past the camera into the sun.
  { name: 'river2', dur: 4.5, cap: '',
    update(t) {
      const k = t / 4.5, f = RIV.f, r = RIV.r;
      const lead = mix3(RIV.a, RIV.b, 0.55 + k * 0.3);
      for (const [i, c] of shots[shots.findIndex(s => s.name === 'river')].cars.entries()) {
        const p = lead.clone().addScaledVector(f, c.back).addScaledVector(r, c.side);
        p.y = 3.5 + Math.sin(t * 1.7 + i) * 0.4 + i * 0.5;
        placeCar(c.v, p, RIV.yaw, { flying: true, pitch: -0.05, roll: 0.05 * Math.sin(t * 1.3 + i) });
        if (Math.random() < 0.7) splash(p.clone().setY(0.3).addScaledVector(f, -3));
      }
      const camAt = mix3(RIV.a, RIV.b, 0.82).addScaledVector(r, -4).setY(1.6);
      setCam(camAt, lead.clone().setY(3.5), lerp(38, 54, easeIO(k)));
    } },

  // 10) ROOFTOP — a Cybertruck drops out of the sky and touches down on top of Frost Bank Tower.
  { name: 'roof', dur: 6.5, cap: 'Land on any rooftop',
    enter() { setAmbient(false); flyer = car('cybertruck', FROST.x, FROST.z, 0, { color: 0xb9bec6 }); this.y0 = groundAt(FROST.x, FROST.z, 400); this.landed = false; },
    update(t, dt) {
      const R = this.y0, k = easeOut(clamp(t / 4.2, 0, 1));
      const from = V(FROST.x - 120, R + 70, FROST.z + 90), to = V(FROST.x, R, FROST.z);
      const p = mix3(from, to, k); p.y = lerp(from.y, to.y, k * k * (3 - 2 * k));
      const yaw = Math.atan2(to.x - from.x, to.z - from.z);
      placeCar(flyer, p, yaw, { flying: t < 4.2, pitch: lerp(-0.12, 0, k), roll: 0.18 * (1 - k) });
      if (t > 4.2 && !this.landed) { this.landed = true; for (let i = 0; i < 26; i++) dust(V(FROST.x + (Math.random() - 0.5) * 8, R + 0.5, FROST.z + (Math.random() - 0.5) * 8), 4); addShake(0.4); }
      const a = 0.9 + t * 0.07;
      setCam(V(FROST.x + Math.sin(a) * 34, R + 9 + 4 * (1 - k), FROST.z + Math.cos(a) * 34), p.clone().add(V(0, 1, 0)), 50);
    } },

  // 11) SKY HIGHWAYS — 8,400 flying cars on stacked lanes and 3,000 drones over Austin.
  { name: 'sky', dur: 7.0, cap: '8,400 flying cars · 3,000 drones', sub: 'Sky highways up to 1 km',
    enter() {
      setAmbient(true);
      const kinds = ['roadster', 'cybertruck', 'modely', 'semi', 'roadster', 'cybercab', 'cybertruck', 'roadster', 'modely', 'roadster', 'semi', 'cybertruck'];
      const paint = [0xc8101e, 0xb9bec6, 0xf4f4f4, 0xf4f4f4, 0x15171c, 0xffc935, 0x9aa1aa, 0x1f5fd1, 0x15171c, 0xffffff, 0xc8101e, 0xb9bec6];
      this.fleet = kinds.map((k, i) => ({ v: car(k, 0, 0, 0, { color: paint[i] }), lane: i % 3, ph: i * 37 + (i % 3) * 13 }));
    },
    update(t) {
      const C = V(DT.x + 180, 210, DT.z + 160), d = V(1, 0, -0.35).normalize(), r = V(d.z, 0, -d.x);
      const lanes = [[r.clone().multiplyScalar(-14), 0, 1, 46], [r.clone().multiplyScalar(-26), 7, -1, 40], [r.clone().multiplyScalar(-44), -9, 1, 52]];
      for (const c of this.fleet) {
        const [off, dy, dir, sp] = lanes[c.lane];
        const along = ((c.ph + t * sp) % 440) - 220;
        const p = C.clone().add(off).addScaledVector(d, along * dir).add(V(0, dy + Math.sin(t + c.ph) * 0.6, 0));
        placeCar(c.v, p, Math.atan2(d.x * dir, d.z * dir), { flying: true, pitch: -0.03, roll: 0.04 * Math.sin(t * 1.5 + c.ph) });
      }
      const k = easeIO(t / 7);
      setCam(C.clone().addScaledVector(d, lerp(-6, 10, k)).add(V(0, lerp(3, 8, k), 0)), C.clone().addScaledVector(r, -60).addScaledVector(d, lerp(-30, 40, k)).add(V(0, lerp(-6, 4, k), 0)), lerp(60, 54, k));
    } },

  // 12) NOT-A-FLAMETHROWER — the Roadster hovers and torches a swarm of rogue drones.
  { name: 'flame', dur: 5.5, cap: 'Not a flamethrower',
    enter() {
      setAmbient(false);
      flyer = car('roadster', DT.x - 36, DT.z - 26, Math.PI * 0.5, { color: 0xc8101e });
      swarm = []; const C = V(DT.x + 42, 90, DT.z + 2);
      for (let i = 0; i < 9; i++) swarm.push(spawnDrone(C.x + (i % 3 - 1) * 12, C.z + (Math.floor(i / 3) - 1) * 10, { y: C.y + (i % 3 - 1) * 6, mission: 'film' }));
    },
    update(t, dt) {
      const S = V(DT.x - 30, 88, DT.z - 24);
      placeCar(flyer, S, Math.atan2(1, 0.2) + 0.1 * Math.sin(t), { flying: true, pitch: -0.05, roll: 0.05 * Math.sin(t * 1.3) });
      const live = swarm.filter(d => !d.dead);
      const aim = (live[0]?.pos || V(DT.x + 42, 90, DT.z + 2)).clone();
      const muzzlePt = S.clone().add(V(Math.cos(flyer.yaw) * 2.2, 0.2, -Math.sin(flyer.yaw) * 2.2));
      const dir = aim.clone().sub(muzzlePt).normalize();
      if (t > 0.3) for (let k = 0; k < 8; k++) flame(muzzlePt.clone(), dir.clone().add(V((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.2)), 0.2, 30);
      swarm.forEach((d, i) => { if (!d.dead && t > 0.8 + i * 0.45) { explode(d.pos.clone(), 1.2); sparks(d.pos.clone(), 28); d.g.visible = false; d.dead = true; addShake(0.3); } });
      const k = easeIO(t / 5.5);
      setCam(mix3(V(DT.x - 72, 92, DT.z - 44), V(DT.x - 58, 96, DT.z - 30), k), mix3(S, aim, 0.55).add(V(0, 2, 0)), 52);
    } },

  // 13) STARLINK STRIKE — bolts rain down from orbit across the block.
  { name: 'starlink', dur: 5.5, cap: 'Call down a Starlink strike', enter() { this.done = new Set(); this.hits = []; },
    update(t, dt) {
      const fire = (gx, gz) => { for (let k = 0; k < 2; k++) bolt(V(gx + (Math.random() - 0.5) * 6, 440, gz + (Math.random() - 0.5) * 6), V(gx, 2, gz), 0x9fe8ff); explode(V(gx, 2, gz), 1.5); sparks(V(gx, 3, gz), 20); addShake(0.6); this.hits.push({ gx, gz, t }); };
      if (t > 0.5) { const n = Math.floor((t - 0.5) / 0.6); if (!this.done.has(n) && n < 6) { this.done.add(n); fire(DT.x + (Math.random() * 2 - 1) * 85, DT.z + (Math.random() * 2 - 1) * 85); } }
      if (t > 4.2 && !this.done.has('barrage')) { this.done.add('barrage'); for (let b = 0; b < 5; b++) fire(DT.x + (Math.random() * 2 - 1) * 70, DT.z + (Math.random() * 2 - 1) * 70); }
      for (const h of this.hits) if (t - h.t < 0.18) bolt(V(h.gx, 440, h.gz), V(h.gx, 2, h.gz), 0x9fe8ff);
      const k = easeIO(t / 5.5);
      setCam(mix3(V(DT.x + 150, 8, DT.z + 150), V(DT.x + 108, 22, DT.z + 118), k), V(DT.x, 55, DT.z), lerp(54, 46, k));
    } },

  // 14) NIGHT — the city lights up: windows, street lamps, sky traffic and Starlink trains overhead.
  { name: 'night', dur: 8.0, cap: 'Night in Elon City', sub: 'Press N anytime',
    enter() { G.setNight(true); nightLook(); setAmbient(true); edgePoint(CONG, CONG.len / 2, _ep); warm(_ep.x, _ep.z, 1); },
    update(t) {
      const k = easeIO(t / 8);
      dolly(k, V(DT.x + 520, 60, DT.z + 520), V(DT.x + 380, 150, DT.z + 380), V(DT.x, 70, DT.z), V(DT.x - 40, 110, DT.z - 40), 50, 46);
    } },

  // 15) FINALE — crane up over night downtown into the stars; the title lands.
  { name: 'finale', dur: 8.0, title: true,
    enter() { flyer = car('roadster', DT.x - 300, DT.z - 40, 0, { color: 0xc8101e }); },
    update(t, dt) {
      const a = V(DT.x - 320, 120, DT.z - 40), b = V(DT.x + 320, 150, DT.z - 10);
      const p = flyArc(t, 8, a, b, 14); const nx = flyArc(t + 0.1, 8, a, b, 14); const dir = nx.clone().sub(p);
      placeCar(flyer, p, Math.atan2(dir.x, dir.z), { flying: true, pitch: -0.04, roll: 0.12 });
      const k = easeIO(t / 8);
      dolly(k, V(DT.x + 420, 90, DT.z + 440), V(DT.x + 260, 260, DT.z + 300),
               V(DT.x, 45, DT.z), V(DT.x, 150, DT.z), 52, 44);
      nightLook();
    } },
];

// ===================== DIRECTOR =====================
const director = { idx: -1, t: 0,
  tick(dt) {
    if (film.done) return;
    let cur = shots[this.idx];
    if (!cur || this.t >= cur.dur - 1e-6) {
      cur?.exit?.();
      this.idx++; this.t = 0; cur = shots[this.idx];
      if (!cur) { film.done = true; return; }
      film.log.push({ shot: cur.name, simT: +film.simT.toFixed(2) });
      cur.enter?.();
    }
    film.shot = cur.name; film.cur = cur; film.shotT = this.t;
    cur.update(this.t, dt);
    this.t += dt; film.simT += dt;
  },
};

// ===================== DRIVER =====================
film.totalDur = () => shots.reduce((s, x) => s + x.dur, 0);
film.reset = () => {
  Math.random = mulberry(20261024);
  clearStage();
  for (const v of [...vehicles]) { try { removeVehicle(v); } catch {} }   // wipe ambient AI traffic: only staged actors appear
  for (const d of [...drones]) { try { removeDrone(d); } catch {} } drones.length = 0;
  hero = cop = flyer = taxi = loopCar = null; swarm = [];
  P.pad = places.pad.clone(); P.starbase = places.starbase.clone(); P.giga = places.giga.clone();
  P.boring = places.boring.clone(); P.capitol = places.capitol.clone(); P.lot = places.lot.clone();
  director.idx = -1; director.t = 0; film.simT = 0; film.done = false; film.log.length = 0;
  G.mode = 'cutscene'; G.mission = null; G.film = true;
  bus.objective?.(''); bus.big?.('', '', '#fff', 0);
  // Clean cinematic sky: hide ambient flying fleets (satellites, sky-traffic, drone swarm, their lights).
  // fx particle pools keep col+size attributes and stay; ambient flocks use ctr/orb/lane and set frustumCulled=false.
  if (!ambient.length) for (const o of scene.children) {
    if (o.type === 'Points') { const a = o.geometry?.attributes || {}; if (!(a.col && a.size)) ambient.push(o); }
    else if (o.isInstancedMesh && o.frustumCulled === false) ambient.push(o);
  }
  setAmbient(false);
  if (G.night) G.setNight(false);
  for (const p of [...peds]) if (p.kind === 'civ' || p.kind === 'bot') removePed(p);
  if (tunnel) { scene.remove(tunnel.g); tunnel = null; }
  playerBody.root.visible = false;
};
const ambient = [];
function setAmbient(on) { for (const o of ambient) o.visible = on; }
film.scout = () => {
  const mid = s => ({ x: (s.minx + s.maxx) / 2, z: (s.minz + s.maxz) / 2, h: s.h });
  const top = solids.map(mid).sort((a, b) => b.h - a.h);
  const c = top.slice(0, 40).reduce((a, o) => ({ x: a.x + o.x, z: a.z + o.z }), { x: 0, z: 0 });
  c.x /= 40; c.z /= 40;
  let best = null;
  for (const e of edges) {
    if (!e.drive || e.len < 120) continue;
    const a = nodes[e.a], b = nodes[e.b], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const d = Math.hypot(mx - c.x, mz - c.z); if (d > 900) continue;
    const straight = Math.hypot(b.x - a.x, b.z - a.z) / e.len;   // 1 = straight
    const score = e.len * straight - d * 0.15;
    if (!best || score > best.score) best = { score, id: e.id, len: +e.len.toFixed(0), w: e.w, straight: +straight.toFixed(2), a: [+a.x.toFixed(0), +a.z.toFixed(0)], b: [+b.x.toFixed(0), +b.z.toFixed(0)], name: e.name };
  }
  return { downtown: { x: +c.x.toFixed(0), z: +c.z.toFixed(0) }, tall: top.slice(0, 10).map(o => ({ x: +o.x.toFixed(0), z: +o.z.toFixed(0), h: +o.h.toFixed(0) })), road: best };
};
film.step = dt => { G.t += dt; runUpdaters(dt); director.tick(dt); applyCam(); };
film.setSize = (W, H) => {
  film.W = W; film.H = H;
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  composer.setPixelRatio?.(1); composer.setSize(W, H);
  bloom?.resolution?.set?.(W, H);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  renderer.shadowMap.enabled = true;
};
const out = document.createElement('canvas');
const ease = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
function overlay(g, W, H) {
  const cur = film.cur, t = film.shotT || 0, u = H / 1080;
  const bar = Math.round((H - W / 2.39) / 2);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, bar); g.fillRect(0, H - bar, W, bar);
  // Fade up from black at the start, down to black at the very end.
  const total = film.totalDur(), T = film.simT;
  const black = Math.max(1 - ease(T / 1.2), ease((T - (total - 1.0)) / 1.0));
  if (cur && cur.cap) {
    const a = Math.min(ease((t - 0.35) / 0.5), ease((cur.dur - 0.3 - t) / 0.45));
    if (a > 0) {
      g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.textBaseline = 'middle';
      const y = H - bar / 2 - (cur.sub ? 14 * u : 0);
      g.font = `700 ${Math.round(46 * u)}px "Saira Condensed"`; g.fillStyle = '#fff';
      g.letterSpacing = `${Math.round(6 * u)}px`;
      g.fillText(cur.cap.toUpperCase(), W / 2, y);
      if (cur.sub) { g.font = `500 ${Math.round(24 * u)}px "Saira Condensed"`; g.fillStyle = 'rgba(63,227,240,.95)'; g.letterSpacing = `${Math.round(3 * u)}px`; g.fillText(cur.sub, W / 2, y + 36 * u); }
      g.restore();
    }
  }
  if (cur && cur.title) {
    const a = ease((t - 1.6) / 1.2);
    if (a > 0) {
      g.save();
      g.fillStyle = `rgba(0,0,0,${0.35 * a})`; g.fillRect(0, bar, W, H - 2 * bar);
      g.globalAlpha = a; g.textAlign = 'center'; g.textBaseline = 'middle';
      const cx = W / 2, cy = H / 2 - 40 * u;
      g.save(); g.translate(cx, cy - 120 * u); g.rotate(0.06);
      g.font = `900 ${Math.round(120 * u)}px "Saira Condensed"`; g.letterSpacing = `${Math.round(8 * u)}px`;
      g.lineWidth = 6 * u; g.strokeStyle = '#000'; g.strokeText('GTA', 0, 0); g.fillStyle = '#fff'; g.fillText('GTA', 0, 0); g.restore();
      g.font = `400 ${Math.round(64 * u)}px Pacifico`; g.letterSpacing = '0px';
      g.shadowColor = 'rgba(63,227,240,.7)'; g.shadowBlur = 16 * u; g.fillStyle = 'rgba(63,227,240,.8)';
      const vy = cy - 30 * u; g.fillText('Vice', cx, vy);
      const vw = g.measureText('Vice').width; g.shadowBlur = 0; g.strokeStyle = '#ff2d55'; g.lineWidth = 9 * u;
      g.beginPath(); g.moveTo(cx - vw / 2 - 8 * u, vy + 6 * u); g.lineTo(cx + vw / 2 + 8 * u, vy - 2 * u); g.stroke();
      g.save(); g.translate(cx, cy + 80 * u); g.rotate(-0.06);
      g.font = `400 ${Math.round(150 * u)}px Pacifico`; g.shadowColor = 'rgba(255,79,163,.85)'; g.shadowBlur = 30 * u;
      g.lineWidth = 8 * u; g.strokeStyle = '#2a0a24'; g.strokeText('Elon City', 0, 0); g.fillStyle = '#ff4fa3'; g.fillText('Elon City', 0, 0); g.restore();
      g.shadowBlur = 0;
      const b = ease((t - 3.0) / 1.0);
      g.globalAlpha = b; g.font = `700 ${Math.round(30 * u)}px "Saira Condensed"`; g.letterSpacing = `${Math.round(10 * u)}px`; g.fillStyle = '#3fe3f0';
      g.fillText('AUSTIN · OPEN WORLD · FREE IN YOUR BROWSER', cx, H - bar - 70 * u);
      g.restore();
    }
  }
  if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, W, H); }
}
film.renderFrame = async () => {
  if (canvas.width !== film.W || canvas.height !== film.H) film.setSize(film.W, film.H);
  composer.render();
  if (out.width !== film.W) { out.width = film.W; out.height = film.H; }
  const g = out.getContext('2d');
  g.drawImage(canvas, 0, 0, film.W, film.H);
  overlay(g, film.W, film.H);
  return await new Promise(r => out.toBlob(r, 'image/jpeg', 0.95));
};
// dry run: count frames + shot log, no rendering
film.dry = () => { film.reset(); let n = 0; const total = Math.round(film.totalDur() * FPS); while (!film.done && n < total + 5) { film.step(1 / FPS); n++; } return { frames: n, seconds: +(n / FPS).toFixed(2), shots: shots.map(s => s.name), log: film.log.slice() }; };
// sample one frame at time tsec (or frame f) and save as a still to the film folder
film.sample = async (tsec, name = 'sample.jpg') => {
  film.reset();
  const target = Math.round(tsec * FPS);
  for (let i = 0; i < target && !film.done; i++) film.step(1 / FPS);
  const b = await film.renderFrame();
  const r = await fetch('http://127.0.0.1:8794/file/' + name, { method: 'POST', body: b });
  return { ok: r.ok, shot: film.shot, simT: +film.simT.toFixed(2), size: b.size, cam: cam.p.toArray().map(v => +v.toFixed(1)) };
};
// a still with a custom camera, for finding framings live: {p:[x,y,z], t:[x,y,z], fov}
film.still = async (tsec, c, name = 'still.jpg') => {
  film.reset();
  const target = Math.round(tsec * FPS);
  for (let i = 0; i < target && !film.done; i++) film.step(1 / FPS);
  if (c) { setCam(V(...c.p), V(...c.t), c.fov || 45); applyCam(); }
  const b = await film.renderFrame();
  const r = await fetch('http://127.0.0.1:8794/file/' + name, { method: 'POST', body: b });
  return { ok: r.ok, shot: film.shot, size: b.size };
};
film.probe = () => ({
  pad: places.pad.toArray().map(v => +v.toFixed(1)),
  starbase: places.starbase.toArray().map(v => +v.toFixed(1)),
  giga: places.giga.toArray().map(v => +v.toFixed(1)),
  boring: places.boring.toArray().map(v => +v.toFixed(1)),
  capitol: places.capitol.toArray().map(v => +v.toFixed(1)),
  lot: places.lot.toArray().map(v => +v.toFixed(1)),
  tower: starbase.tower ? [+starbase.tower.x.toFixed(1), +starbase.tower.z.toFixed(1)] : null,
  spawnYaw: +places.spawnYaw?.toFixed(3),
  kinds: Object.keys((window.__KINDS || {})),
});
film.run = async (from = 0, to = 1e9) => {
  if (film.running) return 'already running';
  film.running = true; film.err = null; film.times = []; film.frame = from;
  try {
    film.reset();
    for (let f = 0; f < from && !film.done; f++) film.step(1 / FPS);
    for (let f = from; f < to && !film.done && film.running; f++) {
      const t0 = performance.now();
      film.step(1 / FPS);
      const blob = await film.renderFrame();
      const r = await fetch('http://127.0.0.1:8794/frame/' + (f + 1), { method: 'POST', body: blob });
      if (!r.ok) throw new Error('save failed ' + r.status);
      film.frame = f + 1; film.times.push(performance.now() - t0);
    }
  } catch (e) { film.err = String(e && e.stack || e); }
  film.running = false; return 'stopped at ' + film.frame;
};
film.stop = () => { film.running = false; };
film.status = () => { const ts = film.times.slice(-30); return { frame: film.frame, running: film.running, done: film.done, err: film.err, shot: film.shot, avgMs: ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length) : null, W: film.W, H: film.H }; };

// Wait until the world is loaded (play button enabled), start the game headlessly, then arm film.
film.ready = () => $('play') && !$('play').disabled;
film.boot = () => new Promise(res => {
  const wait = () => {
    if (!film.ready()) return setTimeout(wait, 200);
    const st = document.createElement('style');
    st.textContent = 'body.film .hud,body.film #hurt,body.film #fade,body.film #toast{display:none!important}';
    document.head.appendChild(st);
    $('play').click();                    // runs begin(): spawns base cars, traffic, sets G.started
    document.body.classList.add('film');  // hide HUD
    G.film = true; G.mode = 'cutscene';
    setTimeout(res, 300);
  };
  wait();
});

(async () => {
  await film.boot();
  try { await Promise.all(['700 40px "Saira Condensed"', '500 24px "Saira Condensed"', '900 120px "Saira Condensed"', '64px Pacifico'].map(f => document.fonts.load(f))); } catch {}
  const W = +Q.get('w') || 1920, H = +Q.get('h') || 1080;
  film.setSize(W, H);
  if (Q.get('auto')) film.run(+Q.get('from') || 0, +Q.get('to') || 1e9);
  else { film.reset(); applyCam(); composer.render(); }   // idle on first shot for live sampling
})();

}
