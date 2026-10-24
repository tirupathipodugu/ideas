// The screen: money, health, stars, weapon, radio, minimap, big messages, toasts, the full map, and touch controls.
import { G, $, bus, touch, look, keys, press, clamp, IS_MOBILE } from './core.js';
import { HALF, LAND, road, blockC, N, places, PITCH, ROAD, BLOCK } from './world.js';
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
  // In a Robotaxi the FLY button takes the wheel instead.
  const fly = document.querySelector('.tbtn[data-k=fly]');
  if (fly) fly.textContent = v && G.ride === v ? 'DRIVE' : 'FLY';
};

/* ---------------- minimap ---------------- */
const mm = $('mini');
const mg = mm.getContext('2d');
// The city drawn once, then cut out around you each frame.
const MAP_PX = 1024;
const W = LAND.maxx - LAND.minx, Hh = LAND.maxz - LAND.minz;
const S = MAP_PX / Math.max(W, Hh);
const LANDMARKS = [[places.giga, '#e82127'], [places.boring, '#6b6f78'], [places.starlink, '#111111'], [places.service, '#e82127'], [places.police, '#1d4fa0'], [places.pad, '#222222'], [places.portalA.at, '#2a7bff'], [places.portalB.at, '#2a7bff']];
const NAMES = [[places.giga, 'Gigafactory'], [places.boring, 'Boring Co.'], [places.starlink, 'Starlink'], [places.service, 'Tesla Service'], [places.police, 'ElonPD'], [places.pad, 'Starbase'], [places.portalA.at, 'Tunnel'], [places.portalB.at, 'Tunnel'], [places.lot, 'Rival Motors']];
const base = document.createElement('canvas');
base.width = MAP_PX;
base.height = MAP_PX;
{
  const g = base.getContext('2d');
  g.fillStyle = '#1b6f8f';
  g.fillRect(0, 0, MAP_PX, MAP_PX);
  const X = x => (x - LAND.minx) * S, Z = z => (z - LAND.minz) * S;
  g.fillStyle = '#e9c99a';
  g.fillRect(X(LAND.minx), Z(LAND.minz), W * S, Hh * S);
  g.fillStyle = '#3a3646';
  g.fillRect(X(-HALF - ROAD / 2), Z(-HALF - ROAD / 2), (2 * HALF + ROAD) * S, (2 * HALF + ROAD) * S);
  g.fillRect(X(HALF), Z(-ROAD / 2), 160 * S, ROAD * S);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      g.fillStyle = '#c9c0d6';
      g.fillRect(X(blockC(i) - BLOCK / 2), Z(blockC(j) - BLOCK / 2), BLOCK * S, BLOCK * S);
    }
  g.fillStyle = '#5fae5a';
  for (const p of [places.park]) g.fillRect(X(p.x - 29), Z(p.z - 39), 58 * S, 58 * S);
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
export const toggleMap = on => {
  bigMap.hidden = !(on ?? bigMap.hidden);
  if (!bigMap.hidden) drawBig();
};

/* ---------------- per-frame ---------------- */
let lastMoney = G.money, shownMoney = G.money;
export const hudFrame = dt => {
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
