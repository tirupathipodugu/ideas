// The Boring Company's Loop: walk or drive into a station, pick another one, and ride a Tesla
// through a lit tunnel under downtown Austin to it.
import { THREE, V3, scene, camera, G, $, hit, touch, look, bus, clamp, onUpdate } from './core.js';
import { places } from './world.js';
import { spawnVehicle, removeVehicle } from './vehicles.js';
import { player, playerBody } from './player.js';
import { sfx } from './audio.js';

const stations = places.loop;
const DEPTH = 14;

// The picker: one button per other station.
const pick = document.createElement('div');
pick.id = 'loopPick';
pick.hidden = true;
document.body.appendChild(pick);
const style = document.createElement('style');
style.textContent = `#loopPick{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(8,10,16,.88);border:1px solid rgba(143,216,255,.5);border-radius:14px;padding:16px 18px;min-width:280px;font-family:var(--ui);color:#fff;box-shadow:0 10px 40px rgba(0,0,0,.6);z-index:5}
#loopPick[hidden]{display:none}
#loopPick h3{margin:0 0 4px;font:400 1.6rem Pacifico,cursive;color:#8fd8ff}
#loopPick p{margin:0 0 10px;opacity:.75;font-size:.9rem}
#loopPick button{display:flex;align-items:center;gap:10px;width:100%;margin:6px 0;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);font-weight:700;font-size:1.05rem;text-align:left}
#loopPick button kbd{display:inline-block;min-width:24px;padding:1px 6px;border-radius:5px;background:rgba(143,216,255,.25);font:700 .8rem var(--ui);text-align:center}
#loopPick button small{margin-left:auto;opacity:.6;font-weight:500}
#loopPick button:hover{background:rgba(143,216,255,.2)}`;
document.head.appendChild(style);

let here = null, cool = 0, ride = null;
const open = st => {
  here = st;
  const others = stations.filter(s => s !== st);
  pick.innerHTML = `<h3>The Loop</h3><p>${st.name} station. Where to?</p>` +
    others.map((s, i) => `<button data-i="${stations.indexOf(s)}"><kbd>${i + 1}</kbd>${s.name}<small>${Math.round(s.at.distanceTo(st.at) / 10) * 10} m</small></button>`).join('') +
    `<button data-i="-1">Stay here <small>or walk away</small></button>`;
  pick.hidden = false;

  sfx.blip();
};
const close = () => {
  pick.hidden = true;
  here = null;
  cool = 3;
};
pick.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const i = +b.dataset.i;
  if (i < 0 || !here) return close();
  go(here, stations[i]);
});

// The tunnel for one trip: down a ramp, along under the city, up the far ramp.
const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x30333a, roughness: 0.9, envMapIntensity: 0.25, side: THREE.BackSide });
const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fd8ff).multiplyScalar(2.2), toneMapped: false });
const build = (a, b) => {
  const fa = new V3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), fb = new V3(Math.sin(b.yaw), 0, Math.cos(b.yaw));
  const pts = [
    a.out.clone().setY(0.6),
    a.at.clone().setY(0.6),
    a.at.clone().addScaledVector(fa, -14).setY(-4),
    a.at.clone().addScaledVector(fa, -34).setY(-DEPTH),
    b.at.clone().addScaledVector(fb, -34).setY(-DEPTH),
    b.at.clone().addScaledVector(fb, -14).setY(-4),
    b.at.clone().setY(0.6),
    b.out.clone().setY(0.6),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const len = curve.getLength();
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.ceil(len / 3), 3.6, 14, false), tunnelMat);
  g.add(tube);
  // Rings of light every 9 m, and a strip along the ceiling.
  const n = Math.floor(len / 9);
  const rings = new THREE.InstancedMesh(new THREE.TorusGeometry(3.45, 0.08, 6, 28), lightMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), z = new V3(0, 0, 1);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    q.setFromUnitVectors(z, curve.getTangentAt(t));
    m.compose(curve.getPointAt(t), q, new V3(1, 1, 1));
    rings.setMatrixAt(k, m);
  }
  g.add(rings);
  const lamp = new THREE.PointLight(0x9fdcff, 60, 30, 1.5);
  g.add(lamp);
  scene.add(g);
  return { curve, len, g, lamp };
};

const go = (from, to) => {
  pick.hidden = true;
  here = null;
  const t = build(from, to);
  // Drive your own car through, or ride a Loop Model Y.
  let car = G.mode === 'car' ? G.car : null, own = !!car;
  if (!car) {
    car = spawnVehicle('modely', from.out.x, from.out.z, from.yaw + Math.PI, { color: 0xf4f4f4 });
    car.keep = true;
    playerBody.root.visible = false;
  }
  car.inLoop = true;
  car.vel.set(0, 0, 0);
  ride = { t, car, own, to, s: 0, speed: 0, prevMode: G.mode };
  G.mode = 'cutscene';
  G.hide = 30;
  bus.vehicle?.(car);
  bus.toast(`The Loop to ${to.name}. F to skip`, 3);
  sfx.whoosh();
};

const finish = () => {
  const { t, car, own, to } = ride;
  scene.remove(t.g);
  t.g.traverse(o => o.geometry?.dispose());
  car.inLoop = false;
  car.pos.copy(to.out).setY(0);
  car.yaw = to.yaw;
  car.vel.set(Math.sin(to.yaw), 0, Math.cos(to.yaw)).multiplyScalar(own ? 10 : 0);
  car.root.position.copy(car.pos);
  car.root.rotation.set(0, car.yaw, 0);
  if (own) {
    G.mode = 'car';
  } else {
    removeVehicle(car);
    player.pos.copy(to.out).setY(0);
    player.yaw = to.yaw;
    playerBody.root.visible = true;
    G.mode = 'foot';
    bus.vehicle?.(null);
  }
  look.yaw = to.yaw;
  G.hide = 8;
  ride = null;
  cool = 4;
  bus.big(to.name, 'The Boring Company Loop', '#8fd8ff', 2.4);
  G.onPortal?.();
};

const _p = new V3(), _t = new V3(), _c = new V3();
onUpdate(dt => {
  if (!G.started) return;
  cool -= dt;
  if (ride) {
    const r = ride;
    // Speed up to 150 km/h, slow down for the far station.
    const left = r.t.len - r.s;
    r.speed = Math.min(r.speed + dt * 14, 42, Math.max(6, left * 0.9));
    r.s += r.speed * dt;
    if (r.s >= r.t.len - 0.5 || hit('KeyF') || hit('KeyE') || touch.enterPressed) return finish();
    const u = clamp(r.s / r.t.len, 0, 1);
    r.t.curve.getPointAt(u, _p);
    r.t.curve.getTangentAt(u, _t);
    const car = r.car;
    car.pos.copy(_p).setY(_p.y - 0.6);
    car.yaw = Math.atan2(_t.x, _t.z);
    car.root.position.copy(car.pos);
    car.root.rotation.set(0, car.yaw, 0);
    car.body.rotation.set(-Math.asin(clamp(_t.y, -1, 1)), 0, 0);
    car.vel.set(0, 0, 0);
    player.pos.copy(car.pos);
    r.t.lamp.position.copy(_p).addScaledVector(_t, 6);
    // Chase camera inside the tube.
    r.t.curve.getPointAt(clamp(u - 9 / r.t.len, 0, 1), _c);
    camera.position.lerp(_c.setY(_c.y + 1.6), 1 - Math.exp(-dt * 10));
    camera.lookAt(_p.x + _t.x * 6, _p.y + _t.y * 6 + 0.6, _p.z + _t.z * 6);
    G.loopSpeed = r.speed;
    return;
  }
  G.loopSpeed = 0;
  if (here) {
    // Hold still while choosing; walk or drive off to cancel.
    for (let i = 0; i < 9; i++) if (hit('Digit' + (i + 1))) {
      const others = stations.filter(s => s !== here);
      if (others[i]) return go(here, others[i]);
    }
    if (hit('Escape')) return close();
    const me = G.playerTarget();
    if (Math.hypot(me.x - here.at.x, me.z - here.at.z) > 7) close();
    return;
  }
  if (cool > 0 || (G.mode !== 'foot' && G.mode !== 'car')) return;
  const me = G.playerTarget();
  if (me.y > 3) return;
  for (const st of stations)
    if (Math.hypot(me.x - st.at.x, me.z - st.at.z) < 3.8) {
      if (G.mode === 'car' && G.car) G.car.vel.multiplyScalar(0.2);
      open(st);
      break;
    }
}, 62);
