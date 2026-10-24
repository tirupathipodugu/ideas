// The screen: money, health, stars, weapon, radio, minimap, big messages, toasts, the full map, and touch controls.
import { THREE, scene, G, $, bus, touch, look, keys, press, clamp, IS_MOBILE } from './core.js';
import { HALF, LAND, places, MAP } from './world.js';
import { vehicles } from './vehicles.js';
import { drones } from './drones.js';
import { peds } from './peds.js';
import { WEAPONS, player } from './player.js';
import { STATIONS, sound } from './audio.js';

/* ---------------- messages ---------------- */
let bigT = 0;
bus.big = (title, sub = '', color = '#ff4fa3', secs = 3) => {
  const el = $('big');
  el.innerHTML = `<b style="color:${color}">${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
  el.classList.add('on');
  bigT = secs;
};
const toasts = [];
bus.toast = (text, secs = 2.6) => {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(bus.toast.t);
  bus.toast.t = setTimeout(() => el.classList.remove('on'), secs * 1000);
};
bus.objective = html => {
  const el = $('obj');
  el.innerHTML = html;
  el.classList.toggle('on', !!html);
};
bus.timer = s => {
  const el = $('timer');
  if (s == null) return el.classList.remove('on');
  el.classList.add('on');
  const t = Math.max(0, s);
  el.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  el.classList.toggle('low', t < 15);
};
bus.hurt = () => {
  const el = $('hurt');
  el.style.opacity = 0.6;
  setTimeout(() => (el.style.opacity = 0), 120);
};
bus.flash = (color, secs) => {
  const el = $('fade');
  el.style.background = color;
  el.style.transition = 'none';
  el.style.opacity = 1;
  requestAnimationFrame(() => {
    el.style.transition = `opacity ${secs}s`;
    el.style.opacity = 0;
  });
};
bus.weapon = () => {
  const w = WEAPONS[G.weapon];
  $('wIcon').textContent = w.icon;
  $('wName').textContent = w.name;
};
bus.vehicle = v => {
  $('veh').textContent = v ? v.name : '';
  document.body.classList.toggle('driving', !!v);
  document.body.classList.toggle('canfly', !!v?.spec.canFly || (!!v && G.ride === v));
  document.body.classList.toggle('roadster', !!v?.spec.canFly && G.ride !== v);
  // In a Robotaxi the FLY button takes the wheel instead.
  const fly = document.querySelector('.tbtn[data-k=fly]');
  if (fly) fly.textContent = v && G.ride === v ? 'DRIVE' : 'FLY';
};

/* ---------------- minimap ---------------- */
const mm = $('mini');
const mg = mm.getContext('2d');
// The city drawn once, then cut out around you each frame.
const MAP_PX = 2560;
const W = LAND.maxx - LAND.minx, Hh = LAND.maxz - LAND.minz;
const S = MAP_PX / Math.max(W, Hh);
const LANDMARKS = [[places.giga, '#e82127'], [places.boring, '#6b6f78'], [places.starlink, '#111111'], [places.service, '#e82127'], [places.police, '#1d4fa0'], [places.pad, '#222222'], ...places.loop.map(l => [l.at, '#2a7bff'])];
const NAMES = [[places.giga, 'Giga Texas'], [places.boring, 'Boring Co.'], [places.starlink, 'Starlink'], [places.service, 'Tesla Service'], [places.police, 'ElonPD'], [places.pad, 'Starbase'], [places.lot, 'Rival Motors'], [places.capitol, 'Texas Capitol'], ...places.loop.map(l => [l.at, 'Loop']), ...MAP.landmarks.filter(l => /Lady Bird Lake|6th Street|Congress Avenue Bridge|Rainey Street|Republic Square|Frost Bank|Convention Center$/.test(l.n)).map(l => [{ x: l.x, z: l.z }, l.n.replace(/ \(Dirty Sixth\)/, '').replace('Ann W. Richards ', '')])];
// Everything Elon in the city, with an icon each, for the maps and the GPS.
export const PLACES = [
  { icon: '🚀', name: 'Starbase: fly Starship', p: places.pad, col: '#ffffff' },
  { icon: '🛰️', name: 'Starlink (Frost Bank Tower)', p: places.starlink, col: '#9fe8ff' },
  { icon: '🏭', name: 'Giga Texas', p: places.giga, col: '#ff4040' },
  { icon: '🕳️', name: 'The Boring Company', p: places.boring, col: '#b0b4bc' },
  ...places.loop.map(l => ({ icon: '🚇', name: 'Loop: ' + l.name, p: l.at, col: '#5ab4ff' })),
  { icon: '🔧', name: 'Tesla Service (respray)', p: places.service, col: '#ff4040' },
  { icon: '🚓', name: 'ElonPD', p: places.police, col: '#4d8dff' },
  { icon: '🏁', name: 'Rival Motors', p: places.lot, col: '#ffd23c' },
  { icon: '🏛️', name: 'Texas State Capitol', p: places.capitol, col: '#f0d0c0' },
  { icon: '🌳', name: 'Republic Square (side jobs)', p: places.park, col: '#7ed957' },
];
// GPS: a waypoint you pick on the map; a beam of light marks it in the city.
G.gps = null;
const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23c).multiplyScalar(2), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });
const gpsBeam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 400, 16, 1, true), beamMat);
gpsBeam.visible = false;
scene.add(gpsBeam);
export const setGPS = (x, z, name, icon = '📍') => {
  G.gps = { x, z, name, icon };
  gpsBeam.position.set(x, 200, z);
  gpsBeam.visible = true;
  bus.toast(`GPS set: ${icon} ${name}`);
};
const clearGPS = () => {
  G.gps = null;
  gpsBeam.visible = false;
};
const base = document.createElement('canvas');
base.width = MAP_PX;
base.height = MAP_PX;
{
  // Downtown Austin from the map data: ground, parks, the lake, buildings, then the streets on top.
  const g = base.getContext('2d');
  const X = x => (x - LAND.minx) * S, Z = z => (z - LAND.minz) * S;
  g.fillStyle = '#ddd6c8';
  g.fillRect(0, 0, MAP_PX, MAP_PX);
  const ring = (p, h) => {
    g.moveTo(X(p[0]), Z(p[1]));
    for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Z(p[i + 1]));
    g.closePath();
    for (const r of h || []) {
      g.moveTo(X(r[0]), Z(r[1]));
      for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Z(r[i + 1]));
      g.closePath();
    }
  };
  const fill = (list, col) => {
    g.fillStyle = col;
    for (const it of list) {
      g.beginPath();
      ring(it.p, Array.isArray(it.h) ? it.h : null);
      g.fill('evenodd');
    }
  };
  fill(MAP.parks, '#93c47d');
  fill(MAP.water, '#3d8fb0');
  fill(MAP.buildings, '#bdb5c9');
  g.lineCap = g.lineJoin = 'round';
  for (const pass of [0, 1]) {
    for (const e of MAP.roads.edges) {
      g.strokeStyle = pass ? (e.c.startsWith('motorway') ? '#f2c94c' : e.c === 'service' ? '#6e6a78' : '#4a4656') : '#2e2b36';
      g.lineWidth = Math.max(1.5, e.w * S) + (pass ? 0 : 2);
      g.beginPath();
      g.moveTo(X(e.p[0]), Z(e.p[1]));
      for (let i = 2; i < e.p.length; i += 2) g.lineTo(X(e.p[i]), Z(e.p[i + 1]));
      g.stroke();
    }
  }
  g.fillStyle = '#bfc3c9';
  g.beginPath();
  g.arc(X(places.pad.x), Z(places.pad.z), 34 * S, 0, 7);
  g.fill();
  // Landmarks as coloured squares; their names are drawn upright on the full map.
  for (const [p, col] of LANDMARKS) {
    g.fillStyle = col;
    g.fillRect(X(p.x) - 7, Z(p.z) - 7, 14, 14);
  }
}
const toMap = (x, z) => [(x - LAND.minx) * S, (z - LAND.minz) * S];

const drawMini = () => {
  const size = mm.width;
  const me = G.playerTarget();
  const range = G.mode === 'car' ? 170 : 110;
  const scale = size / (range * 2 * S);
  mg.save();
  mg.clearRect(0, 0, size, size);
  mg.beginPath();
  mg.arc(size / 2, size / 2, size / 2, 0, 7);
  mg.clip();
  mg.fillStyle = '#1b6f8f';
  mg.fillRect(0, 0, size, size);
  // North stays up; the map scrolls under you.
  const [mx, mz] = toMap(me.x, me.z);
  mg.translate(size / 2, size / 2);
  mg.rotate(look.yaw - Math.PI);
  mg.scale(scale, scale);
  mg.translate(-mx, -mz);
  mg.drawImage(base, 0, 0);
  // Without Starlink the map fogs out past a short radius.
  const dot = (x, z, r, col, ring) => {
    const [px, py] = toMap(x, z);
    mg.beginPath();
    mg.arc(px, py, r / scale, 0, 7);
    mg.fillStyle = col;
    mg.fill();
    if (ring) {
      mg.lineWidth = 2 / scale;
      mg.strokeStyle = '#000';
      mg.stroke();
    }
  };
  for (const v of vehicles) if (v.driver === 'cop') dot(v.pos.x, v.pos.z, 4, Math.floor(G.t * 6) % 2 ? '#ff3040' : '#2a7bff', true);
  for (const d of drones) if (!d.dead) dot(d.pos.x, d.pos.z, 3, d.police ? '#4da3ff' : '#ff3a4a', true);
  for (const p of peds) if (p.kind === 'bot' && p.state !== 'dead') dot(p.pos.x, p.pos.z, 3, '#ff2a3a', true);
  mg.restore();
  // Blips: clamp to the edge when off the map.
  const rot = look.yaw - Math.PI;
  for (const b of G.blips) {
    if (b.color === 'transparent') continue;
    let dx = (b.x - me.x) * S * scale, dz = (b.z - me.z) * S * scale;
    const c = Math.cos(rot), s = Math.sin(rot);
    let x = dx * c - dz * s, y = dx * s + dz * c;
    const d = Math.hypot(x, y), lim = size / 2 - 7;
    if (d > lim) {
      x *= lim / d;
      y *= lim / d;
    }
    mg.beginPath();
    mg.arc(size / 2 + x, size / 2 + y, b.big ? 6 : 4.5, 0, 7);
    mg.fillStyle = b.color;
    mg.fill();
    mg.lineWidth = 2;
    mg.strokeStyle = '#000';
    mg.stroke();
  }
  const onMini = (wx, wz, clampToEdge) => {
    const dx = (wx - me.x) * S * scale, dz = (wz - me.z) * S * scale;
    const c = Math.cos(rot), s = Math.sin(rot);
    let x = dx * c - dz * s, y = dx * s + dz * c;
    const d = Math.hypot(x, y), lim = size / 2 - 10;
    if (d > lim) {
      if (!clampToEdge) return null;
      x *= lim / d;
      y *= lim / d;
    }
    return [size / 2 + x, size / 2 + y];
  };
  mg.textAlign = 'center';
  mg.textBaseline = 'middle';
  mg.font = '22px system-ui, sans-serif';
  for (const pl of PLACES) {
    const q = onMini(pl.p.x, pl.p.z, false);
    if (!q) continue;
    mg.beginPath();
    mg.arc(q[0], q[1], 14, 0, 7);
    mg.fillStyle = 'rgba(10,8,20,.75)';
    mg.fill();
    mg.lineWidth = 2;
    mg.strokeStyle = pl.col;
    mg.stroke();
    mg.fillText(pl.icon, q[0], q[1] + 1);
  }
  if (G.gps) {
    const q = onMini(G.gps.x, G.gps.z, true);
    mg.beginPath();
    mg.moveTo(q[0], q[1] - 11);
    mg.lineTo(q[0] + 9, q[1]);
    mg.lineTo(q[0], q[1] + 11);
    mg.lineTo(q[0] - 9, q[1]);
    mg.closePath();
    mg.fillStyle = '#ffd23c';
    mg.fill();
    mg.lineWidth = 2;
    mg.strokeStyle = '#000';
    mg.stroke();
  }
  // You, pointing where you face.
  const yaw = G.mode === 'car' && G.car ? G.car.yaw : player.yaw;
  mg.save();
  mg.translate(size / 2, size / 2);
  mg.rotate(-(yaw - look.yaw));
  mg.beginPath();
  mg.moveTo(0, -9);
  mg.lineTo(6, 7);
  mg.lineTo(0, 3);
  mg.lineTo(-6, 7);
  mg.closePath();
  mg.fillStyle = '#fff';
  mg.fill();
  mg.strokeStyle = '#000';
  mg.lineWidth = 2;
  mg.stroke();
  mg.restore();
  if (!G.uplink) {
    const grad = mg.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(10,8,20,0)');
    grad.addColorStop(1, 'rgba(10,8,20,0.75)');
    mg.fillStyle = grad;
    mg.fillRect(0, 0, size, size);
  }
};

// The full map (M).
const bigMap = $('bigmap');
const drawBig = () => {
  const c = $('bigCanvas');
  const g = c.getContext('2d');
  const s = Math.min(innerWidth, innerHeight) * 0.86;
  c.width = c.height = Math.round(s * devicePixelRatio);
  c.style.width = c.style.height = s + 'px';
  g.drawImage(base, 0, 0, c.width, c.height);
  const k = c.width / MAP_PX;
  if (!G.uplink) {
    g.fillStyle = 'rgba(10,8,20,0.55)';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.font = `${16 * devicePixelRatio}px Saira Condensed, sans-serif`;
    g.textAlign = 'center';
    g.fillText('Finish the Starlink Uplink mission for live map data', c.width / 2, c.height - 20 * devicePixelRatio);
  }
  for (const b of G.blips) {
    if (b.color === 'transparent') continue;
    const [x, y] = toMap(b.x, b.z);
    g.beginPath();
    g.arc(x * k, y * k, 7 * devicePixelRatio, 0, 7);
    g.fillStyle = b.color;
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 2 * devicePixelRatio;
    g.stroke();
    if (b.label) {
      g.fillStyle = '#fff';
      g.font = `bold ${14 * devicePixelRatio}px Saira Condensed, sans-serif`;
      g.textAlign = 'center';
      g.strokeText(b.label, x * k, y * k - 12 * devicePixelRatio);
      g.fillText(b.label, x * k, y * k - 12 * devicePixelRatio);
    }
  }
  g.textAlign = 'center';
  g.font = `bold ${13 * devicePixelRatio}px Saira Condensed, sans-serif`;
  g.lineWidth = 3 * devicePixelRatio;
  g.strokeStyle = 'rgba(0,0,0,.7)';
  for (const [p, name] of NAMES) {
    const [x, y] = toMap(p.x, p.z);
    g.fillStyle = '#fff';
    g.strokeText(name, x * k, y * k + 20 * devicePixelRatio);
    g.fillText(name, x * k, y * k + 20 * devicePixelRatio);
  }
  g.textBaseline = 'middle';
  for (const pl of PLACES) {
    const [px, py] = toMap(pl.p.x, pl.p.z);
    g.beginPath();
    g.arc(px * k, py * k, 13 * devicePixelRatio, 0, 7);
    g.fillStyle = 'rgba(10,8,20,.85)';
    g.fill();
    g.lineWidth = 2.5 * devicePixelRatio;
    g.strokeStyle = pl.col;
    g.stroke();
    g.font = `${15 * devicePixelRatio}px system-ui, sans-serif`;
    g.fillStyle = '#fff';
    g.fillText(pl.icon, px * k, py * k + devicePixelRatio);
  }
  if (G.gps) {
    const [px, py] = toMap(G.gps.x, G.gps.z);
    g.beginPath();
    g.moveTo(px * k, py * k - 14 * devicePixelRatio);
    g.lineTo(px * k + 11 * devicePixelRatio, py * k);
    g.lineTo(px * k, py * k + 14 * devicePixelRatio);
    g.lineTo(px * k - 11 * devicePixelRatio, py * k);
    g.closePath();
    g.fillStyle = '#ffd23c';
    g.fill();
    g.strokeStyle = '#000';
    g.stroke();
  }
  g.textBaseline = 'alphabetic';
  const me = G.playerTarget();
  const [x, y] = toMap(me.x, me.z);
  g.beginPath();
  g.arc(x * k, y * k, 8 * devicePixelRatio, 0, 7);
  g.fillStyle = '#fff';
  g.fill();
  g.strokeStyle = '#ff4fa3';
  g.lineWidth = 3 * devicePixelRatio;
  g.stroke();
};
// The list beside the big map: tap a place to set the GPS.
const legend = $('legend');
legend.innerHTML = '<h3>Places</h3><p>Tap one, or tap the map, to set your GPS.</p>' + PLACES.map((pl, i) => `<button data-i="${i}"><span>${pl.icon}</span>${pl.name}<small></small></button>`).join('') + '<button data-i="-1"><span>✖</span>Clear GPS</button><button data-close="1"><span>⬅</span>Close map</button>';
legend.addEventListener('click', e => {
  e.stopPropagation();
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.close) return toggleMap(false);
  const i = +b.dataset.i;
  if (i < 0) clearGPS();
  else setGPS(PLACES[i].p.x, PLACES[i].p.z, PLACES[i].name, PLACES[i].icon);
  drawBig();
});
$('bigCanvas').addEventListener('click', e => {
  e.stopPropagation();
  const c = $('bigCanvas'), rect = c.getBoundingClientRect();
  const mx = ((e.clientX - rect.left) / rect.width) * MAP_PX, my = ((e.clientY - rect.top) / rect.height) * MAP_PX;
  const wx = mx / S + LAND.minx, wz = my / S + LAND.minz;
  // Snap to a place if you tapped near its icon.
  let best = null, bd = (30 / rect.width) * (MAP_PX / S);
  for (const pl of PLACES) {
    const d = Math.hypot(pl.p.x - wx, pl.p.z - wz);
    if (d < bd) {
      bd = d;
      best = pl;
    }
  }
  if (best) setGPS(best.p.x, best.p.z, best.name, best.icon);
  else setGPS(wx, wz, 'Waypoint');
  drawBig();
});
const updateLegend = () => {
  const me = G.playerTarget();
  legend.querySelectorAll('button[data-i]').forEach(b => {
    const pl = PLACES[+b.dataset.i];
    if (pl) b.querySelector('small').textContent = `${(Math.hypot(pl.p.x - me.x, pl.p.z - me.z) / 1000).toFixed(1)} km`;
  });
};
export const toggleMap = on => {
  bigMap.hidden = !(on ?? bigMap.hidden);
  G.mapOpen = !bigMap.hidden;
  if (!bigMap.hidden) {
    drawBig();
    updateLegend();
    document.exitPointerLock?.();
  } else if (!IS_MOBILE && G.started && !G.paused) document.getElementById('stage').requestPointerLock?.();
};

/* ---------------- per-frame ---------------- */
let lastMoney = G.money, shownMoney = G.money;
/* ---------------- the controls panel on the left ---------------- */
const controlRows = () => {
  const v = G.car, m = IS_MOBILE;
  if (G.rocket)
    return [G.rocket.stage === 'stack' ? 'Starship' : 'Super Heavy', m ? [['FIRE', 'hold: engines'], ['Stick', 'tilt'], ['FLY', 'stage separation'], ['ENTER', 'get out (landed)']] : [['Space', 'hold: engines'], ['W A S D', 'tilt'], ['Mouse', 'look around'], ['G', 'stage separation'], ['F', 'get out (landed)']]];
  if (G.mode === 'car' && v && G.ride === v)
    return ['Robotaxi', m ? [['ENTER', 'stop & get out'], ['DRIVE', 'take the wheel'], ['FIRE', 'shoot from the window'], ['RADIO', 'change station']] : [['F', 'stop & get out'], ['T', 'take the wheel'], ['Mouse', 'look around'], ['Click', 'shoot'], ['R', 'radio']]];
  if (G.mode === 'car' && v) {
    const rows = m
      ? [['Stick', 'steer · gas · brake'], ['BOOST', 'boost'], ['JUMP', 'handbrake'], ['ENTER', 'get out']]
      : [['W S', 'gas · brake'], ['A D', 'steer'], ['Shift', 'boost'], ['Space', v.flying ? 'fly up' : 'handbrake'], ['F', 'get out'], ['H R', 'horn · radio']];
    if (v.spec.canFly) rows.push(...(m ? [['FLY', v.flying ? 'tap: dip · hold: come down' : 'take off'], ['UP DOWN', 'climb · descend'], ['ROLL', 'thruster hop + barrel roll']] : [['G', v.flying ? 'tap: dip · hold: come down' : 'take off'], ['Space C', 'climb · descend'], ['B', 'thruster hop + barrel roll']]));
    if (G.weapons[3] || G.weapons[4]) rows.push(m ? ['FIRE', 'Starlink / flare'] : ['Click', 'Starlink strike / flare']);
    return [v.name, rows];
  }
  if (G.mode === 'foot')
    return ['On foot', m ? [['Stick', 'walk / run'], ['ENTER', 'take a car · ride a Robotaxi'], ['FIRE', 'attack'], ['WEAPON', 'switch weapon'], ['JUMP', 'jump']] : [['WASD', 'move'], ['Shift', 'run'], ['F', 'take any car · ride a Robotaxi'], ['Click', 'fire'], ['Q 1-5', 'weapons'], ['Space', 'jump'], ['M', 'map'], ['J', 'job']]];
  return null;
};
let ctrlT = 0, ctrlHTML = '';
const ctrlFrame = dt => {
  ctrlT -= dt;
  if (ctrlT > 0) return;
  ctrlT = 0.2;
  const c = controlRows();
  const html = c ? `<h4>${c[0]}</h4>` + c[1].map(([k, t]) => `<div>${k.split(' ').map(x => `<kbd>${x}</kbd>`).join('')}<span>${t}</span></div>`).join('') : '';
  if (html !== ctrlHTML) $('ctrls').innerHTML = ctrlHTML = html;
};

const gpsEl = $('gps');
const gpsFrame = () => {
  if (!G.gps) {
    gpsEl.textContent = '';
    return;
  }
  const me = G.playerTarget();
  const d = Math.hypot(G.gps.x - me.x, G.gps.z - me.z);
  if (d < 18) {
    bus.toast(`Arrived: ${G.gps.icon} ${G.gps.name}`);
    clearGPS();
    return;
  }
  gpsEl.textContent = `${G.gps.icon} ${G.gps.name} · ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}`;
  beamMat.opacity = 0.25 + 0.12 * Math.sin(G.t * 3);
};

export const hudFrame = dt => {
  ctrlFrame(dt);
  gpsFrame();
  bigT -= dt;
  if (bigT <= 0) $('big').classList.remove('on');
  shownMoney += (G.money - shownMoney) * Math.min(1, dt * 6);
  if (Math.abs(G.money - shownMoney) < 1) shownMoney = G.money;
  $('money').textContent = '$' + Math.round(shownMoney).toLocaleString().padStart(8, '0');
  $('hp').style.width = clamp(G.health, 0, 100) + '%';
  $('ar').style.width = clamp(G.armor, 0, 100) + '%';
  $('ar').parentElement.style.display = G.armor > 0 ? '' : 'none';
  const stars = $('stars').children;
  const blink = G.stars > 0 && G.unseen?.() > 2 && Math.floor(G.t * 4) % 2;
  for (let i = 0; i < 5; i++) stars[i].classList.toggle('on', i < G.stars && !blink);
  const a = G.ammo[G.weapon];
  $('wAmmo').textContent = G.weapon === 1 ? `${Math.round(a)}%` : G.weapon === 2 ? a : G.weapon === 3 ? (player.coolStrike > 0 ? `${Math.ceil(player.coolStrike)}s` : 'READY') : '';
  if (G.car) {
    const v = G.car;
    $('speed').textContent = `${Math.round(v.vel.length() * 3.6)} km/h${v.flying ? `  ·  ${Math.round(v.pos.y)} m` : ''}`;
    $('vhp').style.width = clamp(v.hp, 0, 100) + '%';
  }
  $('radio').textContent = sound.station < 3 ? '♪ ' + STATIONS[sound.station] : '';
  drawMini();
  if (!bigMap.hidden) drawBig();
};

/* ---------------- touch ---------------- */
if (IS_MOBILE) document.body.classList.add('touch');
const stick = $('stick'), knob = $('knob');
let stickId = null, sx = 0, sy = 0, lookId = null, lx = 0, ly = 0;
const R = 54;
addEventListener('touchstart', e => {
  if (!G.started) return;
  for (const t of e.changedTouches) {
    if (t.target.closest('.tbtn, .menu, button')) continue;
    if (t.clientX < innerWidth * 0.42 && stickId === null) {
      stickId = t.identifier;
      sx = t.clientX;
      sy = t.clientY;
      stick.style.left = sx - 60 + 'px';
      stick.style.top = sy - 60 + 'px';
      stick.classList.add('on');
    } else if (lookId === null) {
      lookId = t.identifier;
      lx = t.clientX;
      ly = t.clientY;
    }
  }
}, { passive: true });
addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) {
      let dx = t.clientX - sx, dy = t.clientY - sy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx *= R / d;
        dy *= R / d;
      }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      touch.x = dx / R;
      touch.y = -dy / R;
    } else if (t.identifier === lookId) {
      look.yaw -= (t.clientX - lx) * 0.006;
      look.pitch = clamp(look.pitch + (t.clientY - ly) * 0.004, -0.2, 1.1);
      look.idle = 0;
      lx = t.clientX;
      ly = t.clientY;
    }
  }
}, { passive: true });
const endTouch = e => {
  for (const t of e.changedTouches) {
    if (t.identifier === stickId) {
      stickId = null;
      touch.x = touch.y = 0;
      knob.style.transform = '';
      stick.classList.remove('on');
      stick.style.left = stick.style.top = '';
    }
    if (t.identifier === lookId) lookId = null;
  }
};
addEventListener('touchend', endTouch);
addEventListener('touchcancel', endTouch);
// Buttons: held ones set a flag; tapped ones set a one-frame "pressed".
for (const b of document.querySelectorAll('.tbtn')) {
  const k = b.dataset.k;
  const on = e => {
    e.preventDefault();
    touch[k] = true;
    touch[k + 'Pressed'] = true;
    b.classList.add('held');
  };
  const off = e => {
    e.preventDefault();
    touch[k] = false;
    b.classList.remove('held');
  };
  b.addEventListener('touchstart', on);
  b.addEventListener('touchend', off);
  b.addEventListener('touchcancel', off);
  b.addEventListener('mousedown', on);
  b.addEventListener('mouseup', off);
}
export const clearTouchPresses = () => {
  for (const k of Object.keys(touch)) if (k.endsWith('Pressed')) touch[k] = false;
};
