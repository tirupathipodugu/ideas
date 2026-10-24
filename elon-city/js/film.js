// ====================== FILM: deterministic offline cinematic director ======================
// Activated by ?film=1 (plus &auto=1 to render). Takes over the camera and stages hero beats of
// every feature, renders frames at a fixed timestep, and POSTs JPEGs to the save-server (:8794).
// Encode with film/_tools/encode.sh. Nothing here runs unless ?film is present.
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { grade } from './core.js';
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
const _fwd = new V3();
function applyCam() {
  camera.position.copy(cam.p);
  camera.lookAt(cam.t);
  if (Math.abs(camera.fov - cam.fov) > 1e-6) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  // The film's shadow box sits on what the camera is looking at, not on the player.
  if (hq.on) { _fwd.copy(cam.t).sub(cam.p).setY(0); const d = Math.min(hq.box * 0.6, _fwd.length()); _fwd.normalize().multiplyScalar(d).add(cam.p); followSun(_fwd); }
}
// ---- film-quality rendering: skyline-wide shadows, ambient occlusion, supersampling, a film grade ----
const hq = { on: false, box: 420, ss: 1.5, ao: null, grade: null };
function enableHQ() {
  if (hq.on) return; hq.on = true;
  hq.ss = +Q.get('ss') || 1.5;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  Object.assign(sun.shadow.camera, { left: -hq.box, right: hq.box, top: hq.box, bottom: -hq.box, near: 10, far: 2400 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  const ao = hq.ao = new GTAOPass(scene, camera, 16, 16);
  ao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.4, thickness: 3, scale: 1.25, samples: 16, distanceFallOff: 1 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  ao.blendIntensity = 0.9;
  // Shader-animated crowds (sky cars, drones, satellites, particles) would draw at the origin in the AO's
  // own normal/depth pass, so they sit that pass out.
  const aoRender = ao.render.bind(ao);
  ao.render = (...a) => {
    const off = [];
    scene.traverse(o => { if (o.visible && (o.isPoints || (o.isInstancedMesh && o.frustumCulled === false) || o.isSprite || (o.material && o.material.blending === THREE.AdditiveBlending))) { off.push(o); o.visible = false; } });
    const sb = scene.background; scene.background = null;
    aoRender(...a);
    scene.background = sb;
    for (const o of off) o.visible = true;
  };
  composer.insertPass(ao, 1);
  hq.grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uT: { value: 0 }, uNight: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uT; uniform float uNight; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // Teal shadows, warm highlights; a gentle S-curve.
        vec3 sh = mix(vec3(0.86, 0.97, 1.06), vec3(0.9, 0.95, 1.12), uNight), hi = vec3(1.07, 1.0, 0.9);
        c *= mix(sh, hi, smoothstep(0.15, 0.75, l));
        c = mix(c, c * c * (3.0 - 2.0 * c), 0.3 * (1.0 - uNight));
        // Lift the blacks a touch so the night sky stays deep blue instead of crushing to black.
        c = c * 0.97 + vec3(0.012, 0.016, 0.03) * (0.4 + 0.6 * uNight);
        c = max(c, 0.0);
        float v = (1.0 - smoothstep(0.3, 1.05, length((vUv - 0.5) * vec2(1.25, 1.0))));
        c *= mix(0.7, 1.0, v);
        c += (h(vUv * 1931.0 + uT) - 0.5) * 0.035;
        gl_FragColor = vec4(max(c, 0.0), 1.0);
      }`,
  });
  composer.addPass(hq.grade);
  grade.enabled = false;   // the film grade replaces the game's (two stacked contrast curves crushed the night sky)
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
// The trailer: cut on the bar of "Vice Police" (100 BPM, so a bar is 2.4 s). River at sunset, through the
// towers, down into the Loop, then night and Starlink, then the title.
const BAR = 2.4;
// The run through downtown: north off the river, threading the gaps between the towers, then up into the sky.
const TOWERS = new THREE.CatmullRomCurve3([
  V(-70, 14, 600), V(-40, 40, 470), V(-5, 56, 400), V(40, 62, 320), V(48, 64, 230), V(42, 66, 150),
  V(30, 70, 60), V(12, 74, -30), V(6, 84, -120), V(30, 140, -260),
], false, 'centripetal');
const _tan = new V3();
const along = (curve, u) => { const p = curve.getPointAt(clamp(u, 0, 1)); curve.getTangentAt(clamp(u, 0, 1), _tan); return { p, yaw: Math.atan2(_tan.x, _tan.z), pitch: -Math.asin(clamp(_tan.y, -1, 1)), t: _tan.clone() }; };
// Cars that fly the same path in a loose convoy.
const convoy = (list, curve, u, gap, bob, t) => list.forEach((c, i) => {
  const a = along(curve, u - i * gap), r = V(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
  const p = a.p.clone().addScaledVector(r, c.side).add(V(0, c.up + Math.sin(t * 1.6 + i * 1.3) * bob, 0));
  placeCar(c.v, p, a.yaw, { flying: true, pitch: a.pitch * 0.6 - 0.03, roll: clamp(-a.t.x * 0.0, -0.4, 0.4) + 0.05 * Math.sin(t * 1.3 + i) });
});
let fleet = [];
const makeFleet = () => {
  fleet = [['roadster', 0xc8101e, 0, 0], ['cybertruck', 0xb9bec6, 4.5, 1.2], ['modely', 0xf4f4f4, -5, 2.0], ['roadster', 0x15171c, 1, 3.5]]
    .map(([k, c, side, up]) => ({ v: car(k, RIV.a.x, RIV.a.z, 0, { color: c }), side, up }));
};
const sparkle = Points => Points;   // (kept for symmetry)
const starPx = () => { for (const o of scene.children) if (o.isPoints && o.material?.uniforms?.uCam) o.material.uniforms.uPx.value = 3.2; };   // Starlink only

const shots = [
  // 1) Dawn on the water: skim Lady Bird Lake into the sun, the skyline sliding in on the left.
  { name: 'open', dur: BAR * 2, cap: 'Austin, Texas', sub: 'GTA Elon City',
    enter() { setAmbient(false); makeFleet(); for (const c of fleet) c.v.root.visible = false; },
    update(t) {
      const k = t / (BAR * 2), f = RIV.f, r = RIV.r;
      const p = mix3(RIV.a, RIV.b, 0.12 + k * 0.16).addScaledVector(r, -30).setY(lerp(1.6, 4.5, easeIO(k)));
      setCam(p, p.clone().addScaledVector(f, 100).addScaledVector(r, 18).setY(lerp(4, 14, k)), lerp(50, 44, k));
    } },
  // 2) The convoy roars in low over the camera.
  { name: 'overhead', dur: BAR,
    enter() { for (const c of fleet) c.v.root.visible = true; },
    update(t) {
      const k = t / BAR, f = RIV.f, r = RIV.r, u = 0.24 + k * 0.08;
      fleet.forEach((c, i) => {
        const p = mix3(RIV.a, RIV.b, u - i * 0.02).addScaledVector(r, c.side * 0.8 - 6).setY(5 + c.up);
        placeCar(c.v, p, RIV.yaw, { flying: true, pitch: -0.04, roll: 0.05 * Math.sin(t * 2 + i) });
        if (Math.random() < 0.8) splash(p.clone().setY(0.3).addScaledVector(f, -2.5));
      });
      const cp = mix3(RIV.a, RIV.b, 0.3).addScaledVector(r, -6).setY(1.2);
      setCam(cp, fleet[0].v.pos.clone().lerp(cp.clone().addScaledVector(f, -30).setY(10), 0.35), 62);
    } },
  // 3) Tracking alongside the convoy, the towers on the far bank.
  { name: 'alongside', dur: BAR * 2,
    update(t) {
      const k = t / (BAR * 2), f = RIV.f, r = RIV.r;
      const lead = mix3(RIV.a, RIV.b, 0.34 + k * 0.3);
      fleet.forEach((c, i) => {
        const p = lead.clone().addScaledVector(f, -i * 7).addScaledVector(r, c.side).setY(4.2 + c.up + Math.sin(t * 1.7 + i) * 0.4);
        placeCar(c.v, p, RIV.yaw, { flying: true, pitch: -0.04, roll: 0.06 * Math.sin(t * 1.3 + i) });
        if (i < 3 && Math.random() < 0.7) splash(p.clone().setY(0.3).addScaledVector(f, -3));
      });
      const e = easeIO(k);
      setCam(lead.clone().addScaledVector(r, -lerp(15, 10, e)).addScaledVector(f, lerp(-12, 4, e)).setY(lerp(2.0, 5.0, e)), lead.clone().addScaledVector(f, -8).setY(4.5), lerp(46, 40, e));
    } },
  // 4) Close on the Roadster's nose, spray off the water, the sun behind.
  { name: 'closeup', dur: BAR,
    update(t) {
      const k = t / BAR, f = RIV.f, r = RIV.r;
      const lead = mix3(RIV.a, RIV.b, 0.66 + k * 0.1);
      fleet.forEach((c, i) => {
        const p = lead.clone().addScaledVector(f, -i * 7).addScaledVector(r, c.side).setY(3.6 + c.up * 0.6 + Math.sin(t * 2 + i) * 0.3);
        placeCar(c.v, p, RIV.yaw, { flying: true, pitch: -0.05, roll: 0.05 * Math.sin(t * 1.6 + i) });
        if (Math.random() < 0.9) splash(p.clone().setY(0.3).addScaledVector(f, -2.2).addScaledVector(r, (Math.random() - 0.5) * 2));
      });
      const hp = fleet[0].v.pos;
      setCam(hp.clone().addScaledVector(f, lerp(6.5, 5.5, k)).addScaledVector(r, lerp(-3.4, -2.2, k)).setY(hp.y + 0.6), hp.clone().addScaledVector(f, -1).setY(hp.y + 0.4), 50);
    } },
  // 5) Head-on, low over the water: they rip past the camera.
  { name: 'headon', dur: BAR,
    update(t) {
      const k = t / BAR, f = RIV.f, r = RIV.r;
      const lead = mix3(RIV.a, RIV.b, 0.88 + k * 0.13);
      fleet.forEach((c, i) => {
        const p = lead.clone().addScaledVector(f, -i * 7).addScaledVector(r, c.side).setY(3.2 + c.up * 0.6);
        placeCar(c.v, p, RIV.yaw, { flying: true, pitch: -0.05, roll: 0.05 * Math.sin(t * 1.3 + i) });
        if (Math.random() < 0.8) splash(p.clone().setY(0.3).addScaledVector(f, -3));
      });
      const camAt = mix3(RIV.a, RIV.b, 0.98).addScaledVector(r, -3).setY(1.5);
      setCam(camAt, fleet[0].v.pos.clone().setY(3.4), lerp(40, 58, easeIO(k)));
    } },
  // 6) Off the river and up into downtown: chase camera on the Roadster as the towers rise around it.
  { name: 'climb', dur: BAR * 2,
    update(t, dt) {
      const k = t / (BAR * 2), u = lerp(0.0, 0.36, easeIO(k) * 0.4 + k * 0.6);
      convoy(fleet, TOWERS, u, -0.012, 0.5, t);
      const a = along(TOWERS, u), hp = fleet[0].v.pos;
      const back = a.t.clone().setY(0).normalize();
      const want = hp.clone().addScaledVector(back, -13).add(V(0, 3.2, 0)).addScaledVector(V(back.z, 0, -back.x), 2.5);
      if (!camS.on || t === 0) { camS.p = want.clone(); camS.on = true; }
      camS.p.lerp(want, 1 - Math.exp(-dt * 6));
      setCam(camS.p, hp.clone().addScaledVector(back, 12).add(V(0, 1.5, 0)), 56);
    } },
  // 7) Threading the gap between two towers, seen from a ledge as they scream past.
  { name: 'gap', dur: BAR,
    update(t) {
      const k = t / BAR, u = lerp(0.42, 0.52, k);
      convoy(fleet, TOWERS, u, 0.016, 0.4, t);
      const a = along(TOWERS, 0.5), side = V(Math.cos(a.yaw), 0, -Math.sin(a.yaw));
      const cp = a.p.clone().addScaledVector(side, 9).addScaledVector(a.t.clone().setY(0).normalize(), 12).add(V(0, -2, 0));
      setCam(cp, fleet[0].v.pos.clone().lerp(fleet[2].v.pos, 0.4), 54);
    } },
  // 8) The Roadster hangs between the towers in the evening sun; the camera circles it.
  { name: 'orbit', dur: BAR,
    update(t) {
      const k = t / BAR, a = along(TOWERS, 0.6 + k * 0.012);
      placeCar(fleet[0].v, a.p.clone().add(V(0, Math.sin(t * 2) * 0.3, 0)), a.yaw, { flying: true, pitch: -0.03, roll: 0.06 });
      for (const c of fleet.slice(1)) c.v.root.visible = false;
      const ang = a.yaw + lerp(2.2, 3.4, easeIO(k));
      setCam(a.p.clone().add(V(Math.sin(ang) * 9, 1.6, Math.cos(ang) * 9)), a.p.clone().add(V(0, 0.6, 0)), 44);
    } },
  // 9) Out the top of downtown, banking up into the evening sky with the 8,400 on their highways.
  { name: 'rise', dur: BAR * 2,
    enter() { for (const c of fleet) c.v.root.visible = true; setAmbient(true); },
    update(t, dt) {
      const k = t / (BAR * 2), u = lerp(0.72, 1.0, k);
      convoy(fleet, TOWERS, u, 0.012, 0.6, t);
      const hp = fleet[0].v.pos, a = along(TOWERS, u);
      const back = a.t.clone().setY(0).normalize(), sd = V(back.z, 0, -back.x);
      setCam(hp.clone().addScaledVector(back, lerp(-14, 10, easeIO(k))).addScaledVector(sd, lerp(6, 22, easeIO(k))).add(V(0, lerp(2, -4, k), 0)), hp.clone().add(V(0, 1, 0)), lerp(54, 46, k));
    } },
  // 10) The Loop: down the ramp and under the city at 150 km/h, rings of light rushing past.
  { name: 'loopIn', dur: BAR * 2, cap: 'The Loop',
    enter() { for (const c of fleet) c.v.root.visible = false; tunnel = filmTunnel(3, 1); loopCar = car('modely', 0, 0, 0, { color: 0xf4f4f4 }); },
    update(t) {
      const L = tunnel.len, s = 60 + t * 30, u = clamp(s / L, 0, 1);
      const p = tunnel.curve.getPointAt(u), tan = tunnel.curve.getTangentAt(u);
      placeCar(loopCar, p.clone().setY(p.y - 0.6), Math.atan2(tan.x, tan.z));
      tunnel.lamp.position.copy(p).addScaledVector(tan, 6);
      const ahead = tunnel.curve.getPointAt(clamp((s + lerp(12, 7, easeIO(t / (BAR * 2)))) / L, 0, 1));
      setCam(ahead.clone().add(V(0.9, 1.0, 0)), p.clone().add(V(0, 0.2, 0)), 58);
    } },
  { name: 'loopRush', dur: BAR,
    update(t) {
      const L = tunnel.len, s = 60 + (BAR * 2) * 30 + t * 42, u = clamp(s / L, 0, 1);
      const p = tunnel.curve.getPointAt(u), tan = tunnel.curve.getTangentAt(u);
      placeCar(loopCar, p.clone().setY(p.y - 0.6), Math.atan2(tan.x, tan.z));
      tunnel.lamp.position.copy(p).addScaledVector(tan, 6);
      const behind = tunnel.curve.getPointAt(clamp((s - 7) / L, 0, 1));
      setCam(behind.clone().add(V(0, 1.7, 0)), p.clone().addScaledVector(tan, 14).add(V(0, 0.6, 0)), 70);
    },
    exit() { scene.remove(tunnel.g); tunnel = null; loopCar.root.visible = false; } },
  // 11) Night: the skyline lit up, rivers of headlights and tail-lights on the sky highways.
  { name: 'night', dur: BAR * 2, cap: 'Night in Elon City',
    enter() { G.setNight(true); nightLook(); setAmbient(true); starPx(); },
    update(t) {
      const k = easeIO(t / (BAR * 2));
      dolly(k, V(DT.x + 560, 90, DT.z + 520), V(DT.x + 430, 130, DT.z + 400), V(DT.x, 90, DT.z), V(DT.x - 30, 120, DT.z - 30), 46, 42);
      starPx();
    } },
  // 12) Look up from a rooftop: Starlink trains and thousands of satellites crossing the stars.
  { name: 'starlink', dur: BAR * 2, cap: 'Thousands of Starlink satellites',
    update(t) {
      const k = easeIO(t / (BAR * 2)), R = groundAt(FROST.x, FROST.z, 400);
      setCam(V(FROST.x + 14, R + 4, FROST.z + 12), V(FROST.x - 260, R + lerp(110, 150, k), FROST.z - lerp(260, 200, k)), 62);
      starPx();
    } },
  // 13) Up among the sky highways at night: rivers of headlights and tail-lights over the skyline.
  { name: 'nightRun', dur: BAR,
    update(t) {
      const k = easeIO(t / BAR);
      setCam(V(DT.x + 260, 150, DT.z + 260), V(DT.x - lerp(40, 120, k), 175, DT.z - lerp(120, 40, k)), 58);
      starPx();
    } },
  // 14) Title over the night skyline.
  { name: 'finale', dur: BAR * 2 + 1.6, title: true,
    enter() { for (const c of fleet) c.v.root.visible = false; },
    update(t) {
      const k = easeIO(t / (BAR * 2 + 1.6));
      dolly(k, V(DT.x + 420, 90, DT.z + 440), V(DT.x + 300, 210, DT.z + 320), V(DT.x, 60, DT.z), V(DT.x, 160, DT.z), 50, 44);
      nightLook(); starPx();
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
  const rw = Math.round(W * hq.ss), rh = Math.round(H * hq.ss);
  renderer.setPixelRatio(1); renderer.setSize(rw, rh, false);
  composer.setPixelRatio?.(1); composer.setSize(rw, rh);
  bloom?.resolution?.set?.(rw, rh);
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
      g.font = `400 ${Math.round(84 * u)}px Pacifico`; g.letterSpacing = '0px';
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
  if (canvas.width !== Math.round(film.W * hq.ss)) film.setSize(film.W, film.H);
  if (hq.grade) { hq.grade.uniforms.uT.value = (film.simT * 37.0) % 100; hq.grade.uniforms.uNight.value = G.night ? 1 : 0; }
  composer.render();
  if (out.width !== film.W) { out.width = film.W; out.height = film.H; }
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
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
  if (Q.get('hq') !== '0') enableHQ();
  const W = +Q.get('w') || 1920, H = +Q.get('h') || 1080;
  film.setSize(W, H);
  if (Q.get('auto')) film.run(+Q.get('from') || 0, +Q.get('to') || 1e9);
  else { film.reset(); applyCam(); composer.render(); }   // idle on first shot for live sampling
})();

}
