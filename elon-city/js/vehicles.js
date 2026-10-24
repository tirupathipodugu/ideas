// Every vehicle in town: the models, driving and flying, crashes, fire, and the traffic that keeps the streets busy.
import { THREE, V3, scene, G, clamp, lerp, rnd, pick, wrapA, collide, onUpdate, camera, damp } from './core.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isLand, nodes, nodeAt, nearestNode, LANE, N } from './world.js';
import { burning, explode, sparks, thrust, dust, splash, addShake } from './fx.js';
import { sfx } from './audio.js';

// Stats per kind. len/wid/h are the model's size in metres.
export const KINDS = {
  roadster: { file: 'roadster-glb.wasm', paint: /car_main_paint/, len: 4.3, wid: 2.0, h: 1.2, max: 64, acc: 26, turn: 2.5, grip: 9, mass: 1.2, canFly: true, name: 'Roadster' },
  cybertruck: { file: 'cybertruck-glb.wasm', paint: /^Body$/, len: 5.7, wid: 2.2, h: 1.9, max: 48, acc: 18, turn: 1.9, grip: 8, mass: 2.4, name: 'Cybertruck' },
  modely: { file: 'modely-glb.wasm', paint: /Pearl_White/, len: 4.75, wid: 2.0, h: 1.6, max: 42, acc: 15, turn: 2.1, grip: 8, mass: 1.6, name: 'Model Y' },
  semi: { file: 'semi-glb.wasm', paint: /^Material\.001$/, hide: /barrier|cone|wagon|^Wheels\d|RootNode\.?0*1$|^Plane\.001/i, len: 7.4, wid: 2.6, h: 4.0, max: 34, acc: 9, turn: 1.35, grip: 7, mass: 6, name: 'Semi' },
};
// Variants that reuse a model with their own paint and extras.
const VARIANTS = {
  police: { base: 'cybertruck', color: 0x15181f, lightbar: true, name: 'ElonPD Cruiser', max: 52, acc: 22 },
  cybercab: { base: 'modely', color: 0xffc935, name: 'Robotaxi' },
  rogue: { base: 'modely', color: 0xd01b2a, name: 'Rogue Robotaxi' },
  prototype: { base: 'cybertruck', color: 0x8a2be2, name: 'Prototype Cybertruck', max: 56 },
};
const TRAFFIC_PAINT = [0xf4f4f4, 0x111317, 0x9aa1aa, 0x1c3f8f, 0xb3121b, 0xe6e6e6, 0x2b2f36, 0x5a6b7d];

/* ---------------- models ---------------- */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const templates = {};
export const modelsReady = {};

// Merge a model's meshes by material so each car is a handful of draw calls.
const flatten = root => {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map();
  const m = new THREE.Matrix4();
  root.traverse(o => {
    if (!o.isMesh || !o.visible || Array.isArray(o.material)) return;
    let g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    // Quantized attributes become plain floats so they merge.
    for (const k of Object.keys(g.attributes)) {
      const a = g.getAttribute(k);
      const arr = new Float32Array(a.count * a.itemSize);
      const get = [a.getX, a.getY, a.getZ, a.getW];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = get[c].call(a, i);
      g.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize));
    }
    if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
    else g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
    m.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    if (m.determinant() < 0) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
    }
    const key = o.material.uuid + (g.getAttribute('uv') ? 'u' : '') + (g.getAttribute('normal') ? 'n' : '');
    if (!groups.has(key)) groups.set(key, { mat: o.material, list: [] });
    groups.get(key).list.push(g);
  });
  const out = new THREE.Group();
  for (const { mat, list } of groups.values()) {
    const geo = mergeGeometries(list, false);
    if (!geo) continue;
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = !mat.transparent;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
};

// Fit to length, nose to +z, wheels on the ground; tidy the materials.
const prepare = (kind, gltf) => {
  const spec = KINDS[kind];
  const model = gltf.scene;
  if (spec.hide) {
    const drop = [];
    model.traverse(o => spec.hide.test(o.name) && drop.push(o));
    drop.forEach(o => o.removeFromParent());
  }
  model.traverse(o => {
    if (!o.isMesh) return;
    const mat = o.material;
    const n = (mat.name || '').toLowerCase();
    if (mat.transmission > 0 || n.includes('glass')) {
      o.material = new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0, roughness: 0.05, clearcoat: 1, transparent: true, opacity: n.includes('clear') ? 0.25 : 0.82, envMapIntensity: 2 });
      if (/rear|amber|indicator/.test(n)) o.material = new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a0a, emissiveIntensity: 2.5 });
    } else if (/headlight|lights$|^lights/.test(n)) o.material = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xf0f5ff, emissiveIntensity: 3 });
    else if (mat.isMeshStandardMaterial) mat.envMapIntensity = 1.3;
    o.material.name = mat.name;
  });
  const holder = new THREE.Group();
  holder.add(model);
  let box = new THREE.Box3().setFromObject(model, true);
  let size = box.getSize(new V3());
  if (size.x > size.z) {
    model.rotation.y = Math.PI / 2;
    box = new THREE.Box3().setFromObject(model, true);
    size = box.getSize(new V3());
  }
  model.scale.multiplyScalar(spec.len / size.z);
  box = new THREE.Box3().setFromObject(model, true);
  const c = box.getCenter(new V3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= box.min.y;
  // Headlights tell us which way is forward.
  const hb = new THREE.Box3();
  holder.updateMatrixWorld(true);
  model.traverse(o => o.isMesh && /headlight|^lights$/i.test(o.material.name) && hb.expandByObject(o));
  if (!hb.isEmpty() && hb.getCenter(new V3()).z < 0) holder.rotation.y = Math.PI;
  if (kind === 'semi') holder.rotation.y += Math.PI;
  const flat = flatten(holder);
  const real = new THREE.Box3().setFromObject(flat).getSize(new V3());
  spec.wid = real.x;
  spec.h = real.y;
  return flat;
};

// Paint: a car's own copy of the paint material.
const paint = (model, kind, color) => {
  const re = KINDS[kind].paint;
  model.traverse(o => {
    if (o.isMesh && re.test(o.material.name)) {
      o.material = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5 });
      o.material.name = 'paint';
    }
  });
};

export const loadModels = onProgress => {
  let done = 0;
  const list = Object.keys(KINDS);
  return Promise.all(
    list.map(kind =>
      fetch(KINDS[kind].file)
        .then(r => {
          if (!r.ok) throw new Error(`${kind} ${r.status}`);
          return r.arrayBuffer();
        })
        .then(buf => new Promise((res, rej) => loader.parse(buf, '', res, rej)))
        .then(gltf => {
          templates[kind] = prepare(kind, gltf);
          modelsReady[kind] = true;
          for (const v of vehicles) if (v.base === kind && !v.model) attachModel(v);
        })
        .catch(err => console.warn('model', kind, err))
        .finally(() => onProgress?.(++done / list.length)),
    ),
  );
};

const attachModel = v => {
  const t = templates[v.base];
  if (!t) return;
  const model = t.clone();
  if (v.color != null) paint(model, v.base, v.color);
  v.root.remove(v.stand);
  v.body.add(model);
  v.model = model;
};

/* ---------------- vehicles ---------------- */
export const vehicles = [];
const _f = new V3(), _r = new V3();
const fwdOf = (yaw, out = _f) => out.set(Math.sin(yaw), 0, Math.cos(yaw));
const rightOf = (yaw, out = _r) => out.set(-Math.cos(yaw), 0, Math.sin(yaw));

export const spawnVehicle = (type, x, z, yaw = 0, opts = {}) => {
  const variant = VARIANTS[type];
  const base = variant ? variant.base : type;
  const spec = { ...KINDS[base], ...(variant || {}) };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const stand = new THREE.Mesh(new THREE.BoxGeometry(spec.wid, spec.h, spec.len), new THREE.MeshStandardMaterial({ color: variant?.color ?? 0xdddddd }));
  stand.position.y = spec.h / 2;
  root.add(stand);
  scene.add(root);
  const v = {
    type,
    base,
    spec,
    name: spec.name,
    root,
    body,
    stand,
    model: null,
    color: variant?.color ?? opts.color ?? (base === 'roadster' ? 0xc8101e : base === 'cybertruck' ? null : pick(TRAFFIC_PAINT)),
    pos: new V3(x, 0, z),
    vel: new V3(),
    yaw,
    yawRate: 0,
    vy: 0,
    hp: 100,
    fire: 0,
    dead: false,
    sink: 0,
    driver: opts.driver ?? null, // 'player' | 'ai' | 'cop' | null
    ai: null,
    input: { throttle: 0, steer: 0, brake: 0, handbrake: false, boost: false, up: 0 },
    flying: false,
    roll: 0,
    pitch: 0,
    siren: false,
    mission: opts.mission ?? null,
    born: G.t,
  };
  if (base === 'cybertruck' && v.color == null) v.color = null;
  if (spec.lightbar) addLightbar(v);
  if (spec.canFly) addJets(v);
  if (templates[base]) attachModel(v);
  root.position.copy(v.pos);
  root.rotation.y = yaw;
  vehicles.push(v);
  return v;
};

const addLightbar = v => {
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.25), new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }));
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.25), new THREE.MeshBasicMaterial({ color: 0x2060ff, toneMapped: false }));
  red.position.set(-0.4, v.spec.h + 0.05, -0.4);
  blue.position.set(0.4, v.spec.h + 0.05, -0.4);
  v.body.add(red, blue);
  v.bar = { red, blue };
};

// The Roadster's SpaceX thrusters: four nozzles underneath and two at the back.
const nozzle = new THREE.MeshStandardMaterial({ color: 0x55595f, metalness: 0.95, roughness: 0.25 });
const addJets = v => {
  v.jets = [];
  for (const [x, z] of [[-0.75, 1.3], [0.75, 1.3], [-0.75, -1.3], [0.75, -1.3]]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.25, 12), nozzle);
    n.position.set(x, 0.18, z);
    v.body.add(n);
    v.jets.push(n);
  }
};

export const removeVehicle = v => {
  scene.remove(v.root);
  const i = vehicles.indexOf(v);
  if (i >= 0) vehicles.splice(i, 1);
};

export const nearestVehicle = (p, maxd, filter = () => true) => {
  let best = null, bd = maxd;
  for (const v of vehicles) {
    if (v.dead || !filter(v)) continue;
    const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z) - v.spec.len / 2;
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
};

// Hurt a vehicle; heavy damage sets it on fire and fire ends in an explosion.
export const hurtVehicle = (v, amt, by = null) => {
  if (v.dead) return;
  const was = v.hp;
  v.hp -= amt;
  if (by === 'player' && v.driver === 'cop') G.crime?.(amt * 0.4);
  if (v.hp <= 0 && v.fire <= 0) {
    v.fire = 0.01;
    if (by === 'player') G.crime?.(v.driver === 'cop' ? 30 : 9);
  }
};

export const blowUp = v => {
  if (v.dead) return;
  v.dead = true;
  v.fire = 0;
  explode(v.pos.clone().setY(1.2), v.base === 'semi' ? 1.6 : 1.1);
  sfx.boom(1);
  addShake(1.2);
  v.vel.y = 0;
  v.vy = 7;
  // Burnt shell: everything goes dark.
  v.root.traverse(o => {
    if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0x141214, roughness: 0.9 });
  });
  G.onExplosion?.(v.pos, 9, v);
};

/* ---------------- driving and flying ---------------- */
const physics = (v, dt) => {
  const s = v.spec, inp = v.input;
  const fwd = fwdOf(v.yaw, new V3()), right = rightOf(v.yaw, new V3());
  let fs = v.vel.dot(fwd), lat = v.vel.dot(right);
  const wrecked = v.dead || v.sink > 0;
  const throttle = wrecked || v.hp <= 0 ? 0 : inp.throttle;
  const air = v.pos.y > 0.4;
  const max = s.max * (inp.boost && s.canFly ? 1.45 : 1) * (v.hp < 25 ? 0.6 : 1);
  if (!air || v.flying) {
    if (throttle > 0) fs += throttle * s.acc * dt * clamp(1 - fs / max, 0, 1) * (fs < 0 ? 2.5 : 1);
    else if (throttle < 0) fs += fs > 1 ? throttle * 34 * dt : throttle * s.acc * 0.6 * dt * (fs > -14 ? 1 : 0);
    if (inp.boost && s.canFly && !wrecked) fs += 30 * dt * (fs < max ? 1 : 0);
    if (!throttle) fs -= Math.sign(fs) * Math.min(Math.abs(fs), (2 + Math.abs(fs) * 0.12) * dt);
    if (inp.handbrake) fs -= Math.sign(fs) * Math.min(Math.abs(fs), 9 * dt);
    const grip = v.flying ? 3 : inp.handbrake ? 1.4 : s.grip;
    lat *= Math.exp(-grip * dt);
    const turnK = clamp(fs / 7, -1, 1) / (1 + Math.abs(fs) / 45);
    const target = inp.steer * s.turn * turnK * (inp.handbrake ? 1.5 : 1) * (v.flying ? 0.8 : 1);
    v.yawRate = damp(v.yawRate, target, 10, dt);
  } else v.yawRate *= Math.exp(-dt);
  v.yaw += v.yawRate * dt;
  fwdOf(v.yaw, fwd);
  rightOf(v.yaw, right);
  v.vel.copy(fwd).multiplyScalar(fs).addScaledVector(right, lat);

  // Height: flying holds altitude on the thrusters; anything else falls.
  if (v.flying && !wrecked) {
    const lift = inp.up;
    v.vy = damp(v.vy, lift * 14, 3, dt);
    if (!lift) v.vy = damp(v.vy, 0, 2, dt);
    v.pos.y = Math.max(0, v.pos.y + v.vy * dt);
    if (v.pos.y > 220) v.pos.y = 220;
    if (Math.random() < 0.7) for (const j of v.jets) thrust(j.getWorldPosition(new V3()), new V3(0, -1, 0), 0.6 + Math.max(0, lift) * 0.5);
  } else if (v.pos.y > 0 || v.vy > 0) {
    v.vy -= 22 * dt;
    v.pos.y += v.vy * dt;
    if (v.pos.y <= 0) {
      if (v.vy < -14) {
        hurtVehicle(v, (-v.vy - 14) * 3);
        sfx.crash(1);
        addShake(0.5);
        dust(v.pos, 10);
      }
      v.pos.y = 0;
      v.vy = 0;
    }
  }
  if (inp.boost && s.canFly && !wrecked && v.jets) {
    const back = fwd.clone().multiplyScalar(-1);
    thrust(v.pos.clone().addScaledVector(fwd, -s.len / 2).setY(v.pos.y + 0.5), back, 1.2);
  }

  const before = v.vel.length();
  v.pos.addScaledVector(v.vel, dt);

  // Buildings and props: test the nose and the tail.
  {
    const r = s.wid / 2;
    const off = s.len / 2 - r;
    let hitN = null;
    for (const k of [off, -off, 0]) {
      const p = { x: v.pos.x + fwd.x * k, z: v.pos.z + fwd.z * k };
      const n = collide(p, r, v.pos.y);
      if (n.hit) {
        v.pos.x += p.x - (v.pos.x + fwd.x * k);
        v.pos.z += p.z - (v.pos.z + fwd.z * k);
        hitN = { x: n.x, z: n.z };
      }
    }
    if (hitN) {
      const vn = v.vel.x * hitN.x + v.vel.z * hitN.z;
      if (vn < 0) {
        v.vel.x -= 1.35 * vn * hitN.x;
        v.vel.z -= 1.35 * vn * hitN.z;
        const impact = -vn;
        if (impact > 6) {
          hurtVehicle(v, impact * 0.9);
          sfx.crash(clamp(impact / 25, 0.3, 1.4));
          sparks(v.pos.clone().setY(v.pos.y + 0.8), Math.floor(impact));
          if (v.driver === 'player') addShake(clamp(impact / 30, 0.1, 1));
        }
        v.yawRate += (Math.random() - 0.5) * impact * 0.04;
      }
    }
  }

  // The sea.
  if (!isLand(v.pos.x, v.pos.z) && v.pos.y < 1) {
    if (v.sink === 0) {
      splash(v.pos.clone());
      sfx.splash();
      v.sink = 0.01;
    }
    v.sink += dt;
    v.vel.multiplyScalar(Math.exp(-2.5 * dt));
    v.pos.y = -v.sink * 0.8;
  }

  // Lean into corners and dive under braking.
  const lateralG = v.yawRate * fs;
  v.roll = damp(v.roll, clamp(-lateralG * 0.006, -0.08, 0.08) + (v.flying ? -inp.steer * 0.25 : 0), 6, dt);
  v.pitch = damp(v.pitch, clamp((v.vel.length() - before) * 0.4, -0.06, 0.06) + (v.flying ? -inp.throttle * 0.08 : 0), 6, dt);
  v.root.position.copy(v.pos);
  v.root.rotation.set(0, v.yaw, 0);
  v.body.rotation.set(v.pitch, 0, v.roll, 'YXZ');
  if (v.flying) v.root.position.y += Math.sin(G.t * 3 + v.born) * 0.08;
};

// Vehicle against vehicle: push apart and trade momentum.
const bump = dt => {
  for (let i = 0; i < vehicles.length; i++)
    for (let j = i + 1; j < vehicles.length; j++) {
      const a = vehicles[i], b = vehicles[j];
      if (Math.abs(a.pos.y - b.pos.y) > 2) continue;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const r = (a.spec.len + b.spec.len) * 0.32 + (a.spec.wid + b.spec.wid) * 0.12;
      if (d >= r || d < 1e-3) continue;
      const nx = dx / d, nz = dz / d;
      const push = (r - d) / 2;
      const ma = a.spec.mass, mb = b.spec.mass;
      a.pos.x -= nx * push * (mb / (ma + mb)) * 2;
      a.pos.z -= nz * push * (mb / (ma + mb)) * 2;
      b.pos.x += nx * push * (ma / (ma + mb)) * 2;
      b.pos.z += nz * push * (ma / (ma + mb)) * 2;
      const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rel >= 0) continue;
      const jImp = (-1.3 * rel) / (1 / ma + 1 / mb);
      a.vel.x -= (jImp / ma) * nx;
      a.vel.z -= (jImp / ma) * nz;
      b.vel.x += (jImp / mb) * nx;
      b.vel.z += (jImp / mb) * nz;
      const impact = -rel;
      if (impact > 5) {
        hurtVehicle(a, impact * 0.7 * (mb / ma), b.driver === 'player' ? 'player' : null);
        hurtVehicle(b, impact * 0.7 * (ma / mb), a.driver === 'player' ? 'player' : null);
        sfx.crash(clamp(impact / 20, 0.3, 1.3));
        sparks(a.pos.clone().lerp(b.pos, 0.5).setY(0.8), 10);
        if (a.driver === 'player' || b.driver === 'player') {
          addShake(clamp(impact / 25, 0.1, 0.9));
          G.onRam?.(a.driver === 'player' ? b : a, impact);
        }
        a.ai && (a.ai.angry = 4);
        b.ai && (b.ai.angry = 4);
      }
    }
};

/* ---------------- traffic AI ---------------- */
// A car follows lanes between intersections, turning at random, and keeps its distance.
const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const startAI = (v, node) => {
  const options = dirs.filter(([di, dj]) => nodeAt(node.i + di, node.j + dj));
  const [di, dj] = pick(options);
  v.ai = { from: node, to: nodeAt(node.i + di, node.j + dj), di, dj, cruise: rnd(11, 16), angry: 0, wait: 0 };
  v.driver = v.driver || 'ai';
};

const laneTarget = (v, ahead) => {
  const a = v.ai;
  const dx = a.di, dz = a.dj;
  // Right-hand traffic: the lane is offset to the right of the direction of travel, (-dz, dx).
  const along = (v.pos.x - a.from.x) * dx + (v.pos.z - a.from.z) * dz;
  const t = along + ahead;
  return { x: a.from.x + dx * t - dz * LANE, z: a.from.z + dz * t + dx * LANE, along, len: Math.abs(a.to.x - a.from.x) + Math.abs(a.to.z - a.from.z) };
};

const driveAI = (v, dt) => {
  const a = v.ai;
  const lt = laneTarget(v, 9);
  // Next leg once we reach the intersection.
  if (lt.along > lt.len - 3) {
    const back = [-a.di, -a.dj];
    let options = dirs.filter(([di, dj]) => nodeAt(a.to.i + di, a.to.j + dj) && !(di === back[0] && dj === back[1]));
    if (!options.length) options = [back];
    const [di, dj] = pick(options);
    a.from = a.to;
    a.to = nodeAt(a.from.i + di, a.from.j + dj);
    a.di = di;
    a.dj = dj;
  }
  const want = Math.atan2(lt.x - v.pos.x, lt.z - v.pos.z);
  const err = wrapA(want - v.yaw);
  v.input.steer = clamp(err * 2.2, -1, 1);
  // Slow for turns and for anything ahead.
  let target = a.cruise * (Math.abs(err) > 0.4 ? 0.55 : 1);
  if (lt.len - lt.along < 14) target = Math.min(target, 9);
  const fwd = fwdOf(v.yaw, new V3());
  for (const o of vehicles) {
    if (o === v || o.dead) continue;
    const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
    const ahead = dx * fwd.x + dz * fwd.z, side = Math.abs(dx * fwd.z - dz * fwd.x);
    if (ahead > 0 && ahead < 14 && side < 2.6) target = Math.min(target, ahead < 7 ? 0 : 5);
  }
  if (G.blocking?.(v, fwd)) target = 0;
  const speed = v.vel.dot(fwd);
  v.input.throttle = clamp((target - speed) * 0.4, -1, 1);
  v.input.handbrake = false;
  // Stuck against something: reverse a moment.
  if (speed < 0.5 && target > 3) a.wait += dt;
  else a.wait = Math.max(0, a.wait - dt);
  if (a.wait > 2.5) {
    v.input.throttle = -1;
    v.input.steer = -v.input.steer;
    if (a.wait > 4) a.wait = 0;
  }
};

/* ---------------- streaming traffic around the player ---------------- */
const TRAFFIC = 16;
const traffic = () => vehicles.filter(v => v.driver === 'ai' && !v.mission);
const spawnTrafficNear = (p, minR, maxR) => {
  for (let tries = 0; tries < 20; tries++) {
    const n = pick(nodes);
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < minR || d > maxR) continue;
    const r = Math.random();
    const type = r < 0.6 ? 'modely' : r < 0.75 ? 'cybertruck' : r < 0.85 ? 'semi' : r < 0.95 ? 'cybercab' : 'roadster';
    const v = spawnVehicle(type, n.x, n.z, 0, { driver: 'ai' });
    startAI(v, n);
    const lt = laneTarget(v, 0);
    v.pos.set(lt.x + v.ai.di * 6, 0, lt.z + v.ai.dj * 6);
    v.yaw = Math.atan2(v.ai.di, v.ai.dj);
    v.vel.copy(fwdOf(v.yaw, new V3())).multiplyScalar(8);
    return v;
  }
};

export const fillTraffic = p => {
  for (let k = 0; k < TRAFFIC; k++) spawnTrafficNear(p, 20, 260);
};

let streamT = 0;
onUpdate(dt => {
  if (!G.started) return;
  const p = G.playerPos;
  streamT -= dt;
  if (streamT <= 0 && p) {
    streamT = 1;
    for (const v of traffic()) if (Math.hypot(v.pos.x - p.x, v.pos.z - p.z) > 340) removeVehicle(v);
    // Wrecks and abandoned cars far away go too.
    for (const v of [...vehicles])
      if ((v.dead || (v.driver === null && !v.mission && !v.keep)) && Math.hypot(v.pos.x - p.x, v.pos.z - p.z) > 300) removeVehicle(v);
    if (traffic().length < TRAFFIC) spawnTrafficNear(p, 160, 300);
  }
  for (const v of vehicles) {
    if (v.driver === 'ai' && v.ai && !v.dead && v.hp > 0) driveAI(v, dt);
    else if (v.driver === null || v.dead || v.hp <= 0) {
      v.input.throttle = 0;
      v.input.steer = 0;
      v.input.handbrake = true;
      v.input.boost = false;
      if (v.flying && v.driver === null) v.flying = false;
    }
    physics(v, dt);
    // Smoke when hurt, fire when wrecked, then the bang.
    if (!v.dead && v.hp < 35) burning(v.pos.clone().setY(v.pos.y + v.spec.h * 0.8), v.hp < 15 ? 0.6 : 0.2);
    if (v.fire > 0 && !v.dead) {
      v.fire += dt;
      burning(v.pos.clone().setY(v.pos.y + v.spec.h * 0.7), 1.5);
      if (v.driver === 'ai' && v.ai) {
        v.driver = null;
        G.bail?.(v);
      }
      if (v.fire > 4.5) blowUp(v);
    }
    if (v.dead) {
      v.deadT = (v.deadT || 0) + dt;
      if (v.deadT < 8) burning(v.pos.clone().setY(v.pos.y + 1), 0.8);
    }
    if (v.sink > 6 && v.driver !== 'player') removeVehicle(v);
    if (v.bar) {
      const on = Math.floor(G.t * 8) % 2 === 0 && v.siren;
      v.bar.red.visible = !v.siren || on;
      v.bar.blue.visible = !v.siren || !on;
    }
  }
  bump(dt);
}, 30);

export const fwdVec = fwdOf;
export const rightVec = rightOf;
