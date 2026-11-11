// Animated 3D people: Mixamo-rigged characters (from the three.js examples) with idle, walk and run.
// Until they load, everyone is a simple block figure that gets swapped out.
import { THREE, V3, scene, clamp, rnd, pick, damp } from './core.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const lib = {};
const waiting = new Set();
const HEIGHT = 1.78;

// Soldier has its own clips; Xbot's clips also drive Michelle (same Mixamo skeleton, hips left alone).
export const loadPeople = () => {
  const loader = new GLTFLoader();
  const get = f => loader.loadAsync('assets/' + f);
  return Promise.all([get('Soldier.glb'), get('Xbot.glb'), get('Michelle.glb')])
    .then(([soldier, xbot, michelle]) => {
      const clip = (g, name) => g.animations.find(a => a.name.toLowerCase() === name.toLowerCase());
      const inPlace = (c, keepHips = true) => {
        if (!c) return c;
        c = c.clone();
        // Rotations only, plus the hips' height; without the hips at all when borrowed by another body.
        c.tracks = c.tracks.filter(t => {
          const hips = t.name.startsWith('mixamorig:Hips.');
          if (!keepHips && hips) return false;
          return t.name.endsWith('.quaternion') || (hips && t.name.endsWith('.position'));
        });
        // Walk in place: the hips keep their height but not their travel.
        for (const t of c.tracks)
          if (t.name === 'mixamorig:Hips.position') for (let i = 0; i < t.values.length; i += 3) {
            t.values[i] = t.values[0];
            t.values[i + 2] = t.values[2];
          }
        return c;
      };
      lib.soldier = { scene: soldier.scene, clips: { idle: inPlace(clip(soldier, 'Idle')), walk: inPlace(clip(soldier, 'Walk')), run: inPlace(clip(soldier, 'Run')) } };
      const xb = { idle: inPlace(clip(xbot, 'idle')), walk: inPlace(clip(xbot, 'walk')), run: inPlace(clip(xbot, 'run')) };
      lib.xbot = { scene: xbot.scene, clips: xb };
      lib.michelle = { scene: michelle.scene, clips: { idle: inPlace(clip(xbot, 'idle'), false), walk: inPlace(clip(xbot, 'walk'), false), run: inPlace(clip(xbot, 'run'), false) } };
      for (const h of waiting) dress(h);
      waiting.clear();
    })
    .catch(err => console.warn('people', err));
};

// Which model and colours for each kind of person.
const LOOKS = {
  player: { model: 'soldier', tint: 0x55595f },
  cop: { model: 'soldier', tint: 0x6f86c9 },
  // Lots of Optimus robots in every colour, among the people.
  civ: () => (Math.random() < 0.72 ? { model: 'xbot', optimus: true, shell: pick(SHELLS) } : pick([{ model: 'michelle' }, { model: 'michelle' }, { model: 'soldier', tint: pick([0xc9a27a, 0x9fb38a, 0xb5b5b5, 0xd99a8a]) }])),
  // Rogue Optimus: dark shell, glowing red joints.
  bot: { model: 'xbot', optimus: true, rogue: true },
};

// Optimus shell colours: Tesla white, black, silver, gold, and some bright ones.
const SHELLS = [0xf3f4f6, 0xf3f4f6, 0x1c1d21, 0xb9bec6, 0xd4af37, 0xc8102e, 0x1f5fd1, 0x17a589, 0xff6fae, 0xff8c1a, 0x7d3cff, 0x9be15d];
const shellMats = {};
const shellMat = c => (shellMats[c] ??= new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.22, metalness: c === 0xd4af37 || c === 0xb9bec6 ? 0.75 : 0.08, clearcoat: 1, clearcoatRoughness: 0.08 }));
const OPT = {
  shell: new THREE.MeshPhysicalMaterial({ color: 0xf3f4f6, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 }),
  joint: new THREE.MeshPhysicalMaterial({ color: 0x1a1b1f, roughness: 0.35, metalness: 0.75, clearcoat: 0.5 }),
  rogueShell: new THREE.MeshPhysicalMaterial({ color: 0x2c2f35, roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.15 }),
  rogueJoint: new THREE.MeshStandardMaterial({ color: 0x3a0508, emissive: 0xff1830, emissiveIntensity: 2.4, roughness: 0.4 }),
  visor: new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.05, metalness: 0.9, clearcoat: 1, clearcoatRoughness: 0.02 }),
  eyes: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2030).multiplyScalar(3), toneMapped: false }),
};
const visorGeo = new THREE.SphereGeometry(1, 24, 16);
const eyesGeo = new THREE.BoxGeometry(1, 1, 1);
// Optimus' glossy black face plate, on the head bone (in metres, whatever the bone's scale).
const addFace = (model, rogue) => {
  let head = null;
  model.traverse(o => o.isBone && /Head$/.test(o.name) && (head = o));
  if (!head) return;
  model.updateMatrixWorld(true);
  const k = 1 / head.getWorldScale(new THREE.Vector3()).x;
  const face = new THREE.Group();
  face.scale.setScalar(k);
  const visor = new THREE.Mesh(visorGeo, OPT.visor);
  visor.scale.set(0.085, 0.1, 0.05);
  visor.position.set(0, 0.095, 0.075);
  face.add(visor);
  if (rogue) {
    const eyes = new THREE.Mesh(eyesGeo, OPT.eyes);
    eyes.scale.set(0.11, 0.014, 0.01);
    eyes.position.set(0, 0.105, 0.122);
    face.add(eyes);
  }
  head.add(face);
};

const dress = h => {
  const look = typeof LOOKS[h.kind] === 'function' ? LOOKS[h.kind]() : LOOKS[h.kind] || LOOKS.civ();
  const L = lib[look.model];
  if (!L) return;
  const model = SkeletonUtils.clone(L.scene);
  // Stand them up at a real height, feet on the ground.
  // Mixamo characters come in at real size (centimetres scaled by 0.01).
  model.scale.multiplyScalar(look.model === 'xbot' ? rnd(1.0, 1.04) : rnd(0.95, 1.05));
  // The Soldier is modelled facing -Z; everyone else faces +Z, the way they walk.
  model.rotation.order = 'YXZ';
  if (look.model === 'soldier') model.rotation.y = Math.PI;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    o.material = o.material.clone();
    if (look.tint) o.material.color = new THREE.Color(look.tint);
    if (look.optimus) {
      // Tesla bot: glossy white shell over satin black joints; rogue ones are gunmetal with red-hot joints.
      const joint = /joint/i.test(o.material.name);
      o.material = joint ? OPT.joint : look.rogue ? OPT.rogueShell : look.shell ? shellMat(look.shell) : OPT.shell;
      if (joint && look.rogue) o.material = OPT.rogueJoint;
    }
    if (o.material.map) o.material.map.anisotropy = 4;
  });
  for (const c of [...h.root.children]) h.root.remove(c);
  h.root.add(model);
  if (look.optimus) addFace(model, look.rogue);
  h.model = model;
  h.look = look.model;
  h.mixer = new THREE.AnimationMixer(model);
  h.actions = {};
  for (const [k, c] of Object.entries(L.clips)) {
    if (!c) continue;
    const a = h.mixer.clipAction(c);
    a.play();
    a.setEffectiveWeight(k === 'idle' ? 1 : 0);
    a.time = rnd(0, c.duration);
    h.actions[k] = a;
  }
  h.w = { idle: 1, walk: 0, run: 0 };
  model.traverse(o => {
    if (o.isBone && /RightHand$/.test(o.name)) h.hand = o;
    if (o.isBone && /Spine1$/.test(o.name)) h.spine = o;
    if (o.isBone && /RightArm$/.test(o.name)) h.rightArm = o;
  });
  h.dressed = true;
};

/* ---------------- the stand-in block figure ---------------- */
const box = (w, hgt, d, mat, y = 0) => {
  const g = new THREE.BoxGeometry(w, hgt, d);
  g.translate(0, y, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
};
const grey = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.8 });
const standIn = root => {
  root.add(box(0.5, 0.7, 0.3, grey, 1.3), box(0.26, 0.28, 0.26, grey, 1.82), box(0.4, 0.9, 0.25, grey, 0.45));
};

export const makeHuman = (o = {}) => {
  const root = new THREE.Group();
  scene.add(root);
  const h = { root, kind: o.kind || 'civ', phase: rnd(0, 6), lie: 0 };
  if (lib.soldier) dress(h);
  else {
    standIn(root);
    waiting.add(h);
  }
  return h;
};

// Blend idle, walk and run from speed; lie flat when knocked down.
export const animHuman = (h, speed, dt, pose = 'stand') => {
  const down = pose === 'down';
  h.lie = damp(h.lie, down ? 1 : 0, 8, dt);
  if (h.model) {
    h.model.rotation.x = -h.lie * Math.PI / 2;
    h.model.position.z = -h.lie * 0.9;
  }
  if (!h.mixer) return;
  const run = pose === 'flail' ? 1 : clamp((speed - 3) / 2.5, 0, 1);
  const move = down ? 0 : clamp(speed / 1.2, 0, 1);
  const want = { idle: 1 - move, walk: move * (1 - run), run: move * run };
  for (const k of ['idle', 'walk', 'run']) {
    h.w[k] = damp(h.w[k], want[k], 10, dt);
    h.actions[k]?.setEffectiveWeight(h.w[k]);
  }
  if (h.actions.walk) h.actions.walk.timeScale = clamp(speed / 1.5, 0.6, 1.6);
  if (h.actions.run) h.actions.run.timeScale = pose === 'flail' ? 1.4 : clamp(speed / 6, 0.7, 1.4);
  h.mixer.update(down ? 0 : dt);
  // Aim: the right arm comes up level.
  if ((pose === 'aim' || pose === 'punch') && h.rightArm) {
    h.aimK = damp(h.aimK || 0, 1, 14, dt);
  } else h.aimK = damp(h.aimK || 0, 0, 10, dt);
  if (h.aimK > 0.01 && h.rightArm) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -1.25 * h.aimK));
    h.rightArm.quaternion.multiply(q);
  }
};

export const disposeHuman = h => {
  waiting.delete(h);
  scene.remove(h.root);
  h.mixer?.stopAllAction();
};
