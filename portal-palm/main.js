// Portal Palm: open your hand and a glowing hole opens in it, with real depth. Tiny creatures
// climb out one by one, then a hundred pour out and run up your arm onto your shoulders and head.
// Make a fist and the portal sucks every one of them back in.
import { THREE, GLOW_BLEND, Q, S, T, F, scene, boot, toast, clamp, lerp, rand, dist, smooth, hsl, glitter, burst, tone, noise, hum, loopNoise, onResize } from '../live-kit/core.js';
import { loadBuddy, Buddy, Rest, Hold, Crouch, Air, Land, Path, Call, bsfx } from '../live-kit/buddy.js';

const N = Math.min(150, +Q.get('n') || 100);
const PALETTES = [ // [deep, bright] portal colours, one per portal so two hands look different
  [new THREE.Color(0.25, 0.05, 0.55), new THREE.Color(0.35, 0.85, 1.0)],
  [new THREE.Color(0.45, 0.05, 0.2), new THREE.Color(1.0, 0.55, 0.25)],
];

// ---------- portal shader ----------
const VERT = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const NOISE = `float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}`;
const HOLE = `uniform float t,open;uniform vec3 c1,c2;varying vec2 vUv;${NOISE}
void main(){
  vec2 p=(vUv*2.-1.)*1.5; float r=length(p); float a=atan(p.y,p.x);
  float R=max(open,1e-3); float rr=r/R;
  float wob=(vn(vec2(a*2.5+t*.7,t*1.3))-.5)*.09;
  float m=1.-smoothstep(.97,1.01,rr+wob);
  if(m<=0.)discard;
  float z=.32/(rr+.03)+t*1.4;                     // depth into the tunnel
  float sw=a*1.+z*.9;
  float rings=.5+.5*sin(z*7.);
  float arms=pow(.5+.5*sin(sw*4.-t*2.),3.);
  float neb=vn(vec2(a*3.+z*.6,z*1.7));
  float st=step(.975,h21(floor(vec2(a*18.,z*6.))))*smoothstep(.15,.6,rr);
  vec3 col=mix(c1*.25,c2,pow(clamp(1.-rr,0.,1.),1.6));
  col+=c2*(arms*.55+rings*.18)*(1.-rr)*neb*1.6;
  col+=mix(c2,vec3(1.),.6)*pow(max(0.,1.-rr*2.4),2.5)*1.6;   // the far light
  col+=st*vec3(1.,.95,.9);
  col*=mix(.08,1.,smoothstep(1.,.62,rr));                    // inner wall falls into shadow
  gl_FragColor=vec4(col,m);
}`;
const RIM = `uniform float t,open;uniform vec3 c1,c2;varying vec2 vUv;${NOISE}
void main(){
  vec2 p=(vUv*2.-1.)*1.5; float r=length(p); float a=atan(p.y,p.x);
  float R=max(open,1e-3); float d=r-R;
  float wob=(vn(vec2(a*2.5+t*.7,t*1.3))-.5)*.09*R;
  d+=wob;
  float fl=.55+.9*vn(vec2(a*9.+t*5.,t*3.));
  float ring=exp(-pow(d/(.045*R+.004),2.))*fl;
  float halo=exp(-max(0.,d)/(.22*R+.01))*.45*step(0.,d)+exp(-pow(d/(.18*R+.01),2.))*.25;
  vec3 col=mix(c2,vec3(1.),.55)*ring*1.6+c2*halo;
  gl_FragColor=vec4(col*smoothstep(0.,.08,open),1.);
}`;

class Portal {
  constructor(hand, pal) {
    this.hand = hand; this.pal = pal; this.t = 0; this.open = 0; this.openT = 1; this.state = 'opening';
    this.center = hand >= 0 && T.hands[hand] ? { ...T.hands[hand].seat } : { x: S.W / 2, y: S.H * 0.68 };
    this.size = Math.max(60, T.hands[hand]?.size.x * 1.05 || T.scale * 0.55); this.sy = 0.85; this.rot = 0;
    const [c1, c2] = PALETTES[pal]; this.c2 = c2;
    const U = () => ({ t: { value: 0 }, open: { value: 0 }, c1: { value: c1 }, c2: { value: c2 } });
    this.hole = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: U(), vertexShader: VERT, fragmentShader: HOLE, transparent: true, depthWrite: false }));
    this.rim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ uniforms: U(), vertexShader: VERT, fragmentShader: RIM, transparent: true, depthWrite: false, ...GLOW_BLEND }));
    this.g = new THREE.Group(); this.g.add(this.hole, this.rim); this.rim.position.z = 1; scene.add(this.g);
    this.light = new THREE.PointLight(c2, 0, 0, 0); scene.add(this.light);
    this.spawned = 0; this.lost = 0; this.shut = 0; this.creatures = [];
    sfx.open(); burst(this.center.x, this.center.y, this.size * 0.5, 60, pal ? 25 : 195);
  }
  get R() { return this.size * 0.5 * this.open; } // radius in px (x axis)
  /** a point on the hand around the rim, angle 0 = top of the portal */
  rimPt(th, k = 1.08) {
    const R = this.size * 0.5 * Math.max(0.4, this.open) * k, c = Math.cos(this.rot), s = Math.sin(this.rot);
    const lx = Math.sin(th) * R, ly = -Math.cos(th) * R * this.sy;
    return { x: this.center.x + lx * c - ly * s, y: this.center.y + lx * s + ly * c, ang: this.rot * 0.5 };
  }
  update(dt) {
    this.t += dt;
    const h = this.hand >= 0 ? T.hands[this.hand] : null;
    if (h) {
      const k = Math.min(1, dt * 20);
      this.center.x = lerp(this.center.x, h.seat.x, k); this.center.y = lerp(this.center.y, h.seat.y, k);
      this.size = lerp(this.size, Math.max(60, h.size.x * 1.15), Math.min(1, dt * 6));
      this.sy = lerp(this.sy, clamp(h.flat * 1.7, 0.5, 1), Math.min(1, dt * 6));
      this.rot = lerp(this.rot, clamp(h.ang, -0.8, 0.8), Math.min(1, dt * 8));
    }
    // opening: overshoot then settle, like an iris snapping wide
    const goal = this.state === 'closing' ? 0 : this.state === 'sucking' ? 1.15 : 1;
    const kk = this.state === 'opening' ? 7 : 10;
    this.v = (this.v || 0) + ((goal - this.open) * kk * kk - (this.v || 0) * kk * 0.9) * dt; this.open = Math.max(0, this.open + this.v * dt);
    if (this.state === 'opening' && this.t > 0.8) this.state = 'open';
    const sc = this.size * 1.5;
    this.g.position.set(this.center.x, S.H - this.center.y, -300); this.g.rotation.z = -this.rot; this.g.scale.set(sc, sc * this.sy, 1);
    for (const m of [this.hole.material, this.rim.material]) { m.uniforms.t.value = this.t * (this.state === 'sucking' ? 3 : 1); m.uniforms.open.value = Math.min(1.2, this.open); }
    this.light.position.set(this.center.x, S.H - this.center.y + this.size * 0.4, 260); this.light.intensity = this.open * 2.2;
    // sparks flick off the rim
    if (this.open > 0.3 && Math.random() < 0.8) {
      const th = rand(0, Math.PI * 2), p = this.rimPt(th, 1.0), tang = rand(0.6, 1.4) * this.size;
      glitter.emit(p.x, p.y, Math.cos(th) * tang * 0.6, -Math.abs(Math.sin(th)) * tang * 0.4 - 20, rand(0.3, 0.7), rand(2.5, 5), ...(this.pal ? [1, 0.7, 0.4] : [0.6, 0.9, 1]), 1, 140);
    }
    if (this.state === 'sucking') { // dust and light stream into the hole
      for (let i = 0; i < 3; i++) {
        const a = rand(0, Math.PI * 2), r = rand(1.2, 2.6) * this.size;
        glitter.emit(this.center.x + Math.cos(a) * r, this.center.y + Math.sin(a) * r, -Math.cos(a) * r * 1.8, -Math.sin(a) * r * 1.8, 0.5, rand(2, 4), ...(this.pal ? [1, 0.7, 0.4] : [0.6, 0.9, 1]), 0.9, 0, -0.6, 0);
      }
    }
    if (this.state === 'closing' && this.open < 0.02 && this.t > 0.2) { this.dispose(); return true; }
    return false;
  }
  suck() {
    if (this.state === 'sucking' || this.state === 'closing') return;
    this.state = 'sucking'; this.suckT = 0; sfx.suck();
    for (const c of creatures) if (!c.dead && !c.sucked && (c.portal === this || !portals.some((p) => p !== this && p.state !== 'sucking' && p.state !== 'closing'))) {
      c.sucked = true; c.portal = this; c.run([Suck(this, rand(0, 0.9) * Math.min(1, creatures.length / 40))]);
    }
  }
  close() { this.state = 'closing'; this.t = Math.min(this.t, 1); sfx.close(); burst(this.center.x, this.center.y, this.size * 0.6, 90, this.pal ? 25 : 195); }
  dispose() { scene.remove(this.g, this.light); this.hole.material.dispose(); this.rim.material.dispose(); this.dead = true; }
}

// ---------- sound ----------
let drone = null, wind = null;
const sfx = {
  open: () => { noise(0.9, 200, 3000, 0.16, { attack: 0.4 }); tone(90, 220, 0.9, 'sine', 0.12); [523, 659, 784].forEach((f, i) => tone(f, f * 1.01, 0.6, 'triangle', 0.035, 0.35 + i * 0.07)); },
  suck: () => { noise(1.4, 3500, 150, 0.2, { attack: 0.5 }); tone(600, 60, 1.4, 'sawtooth', 0.04); },
  close: () => { tone(140, 40, 0.35, 'sine', 0.3); noise(0.25, 900, 120, 0.25); [1568, 1319, 1047].forEach((f, i) => tone(f, f, 0.5, 'triangle', 0.03, 0.1 + i * 0.07)); },
  pop: (() => { let last = 0; return () => { const n = performance.now(); if (n - last < 30) return; last = n; const f = rand(600, 1300); tone(f, f * 1.9, 0.07, 'sine', 0.045); }; })(),
  peek: () => tone(900, 1400, 0.12, 'sine', 0.06),
};

// ---------- where creatures go ----------
const headPt = () => { // top of the head from the pose ears
  const B = T.body; if (!B.ok) return null; const L = B.raw, e1 = L[7], e2 = L[8];
  if (e1.v < 0.5 || e2.v < 0.5) return null;
  const ed = dist(e1, e2), mid = { x: (e1.x + e2.x) / 2, y: (e1.y + e2.y) / 2 };
  return F('head', { x: mid.x + B.up.x * 0.95 * ed, y: mid.y + B.up.y * 0.95 * ed, ang: B.ang }, S.t);
};
const onScreen = (p) => p && p.x > 10 && p.x < S.W - 10 && p.y > 20 && p.y < S.H - 30 ? p : null;
function armOf(portal) { // the arm (shoulder, elbow, wrist) holding this portal's hand
  const B = T.body, h = T.hands[portal.hand]; if (!B.ok || !h) return null;
  let best = null, bd = 0.7 * B.sw;
  for (const k of ['armR', 'armL']) if (B[k]) { const d = dist(B[k].wr, h.wrist); if (d < bd) { bd = d; best = k; } }
  return best;
}
function onArm(key, f) { // live point a fraction f from wrist (0) to shoulder (1), standing on top of the arm
  return () => {
    const B = T.body, arm = B.ok && B[key]; if (!arm) return null;
    const a = f < 0.5 ? arm.wr : arm.el, b = f < 0.5 ? arm.el : arm.sh, k = f < 0.5 ? f * 2 : (f - 0.5) * 2;
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; let n = { x: dy / L, y: -dx / L }; if (n.y > 0) n = { x: -n.x, y: -n.y };
    return onScreen({ x: lerp(a.x, b.x, k) + n.x * 0.06 * B.sw, y: lerp(a.y, b.y, k) + n.y * 0.06 * B.sw, ang: 0 });
  };
}
const counts = {};
function slot(portal, i) {
  const r = Math.random(), arm = armOf(portal), body = T.body.ok;
  let g = i < 7 ? 'rim' : r < 0.18 ? 'rim' : arm && r < 0.48 ? 'arm' : body && r < 0.66 ? 'shoulders' : body && r < 0.76 && headPt() ? 'head' : T.hands.length > 1 && r < 0.84 ? 'other' : 'floor';
  const k = (counts[g] = (counts[g] || 0) + 1), sz = T.scale * 0.42;
  if (g === 'rim') { const th = ((k % 9) - 4) * 0.36 + (k > 9 ? 0.18 : 0), ring = 1.08 + Math.floor(k / 9) * 0.22; return { g, fn: () => portal.rimPt(th, ring) }; }
  if (g === 'arm') return { g, arm, f: rand(0.15, 1.0), fn: null };
  if (g === 'shoulders') {
    const left = k % 2 === 0, j = Math.floor(k / 2);
    return { g, fn: () => { const B = T.body; if (!B.ok) return null; const a = left ? B.seatL : B.seatR, s = left ? -1 : 1; return onScreen({ x: a.x + B.dn.x * s * j * 0.3 * sz - B.dn.x * s * 0.1 * sz, y: a.y + B.dn.y * s * j * 0.3 * sz + (j % 3) * 0.05 * sz, ang: B.ang }); } };
  }
  if (g === 'head') return { g, fn: () => { const p = headPt(); return p && onScreen({ x: p.x + ((k % 7) - 3) * 0.3 * sz, y: p.y - Math.floor(k / 7) * 0.45 * sz - Math.abs((k % 7) - 3) * -0.06 * sz, ang: p.ang }); } };
  if (g === 'other') {
    const th = k * 2.39996, rr = 0.4 * Math.sqrt(k) * sz;
    return { g, fn: () => { const o = T.hands.find((h, j) => j !== portal.hand); return o && { x: o.seat.x + Math.cos(th) * rr, y: o.seat.y + Math.sin(th) * rr * 0.6, ang: 0 }; } };
  }
  const fx = rand(0.08, 0.92);
  return { g, fn: () => ({ x: S.W * fx, y: S.H * (S.W > S.H ? 0.9 : 0.84) + ((k * 13) % 5 - 2) * 0.12 * sz, ang: 0 }) };
}

// ---------- creature steps ----------
function Emerge(portal, hero) { // rise out of the depth: starts tiny at the far light, grows as it climbs up
  return {
    t: 0, T: hero ? 2.6 : rand(0.45, 0.7),
    start(b) { b.play(hero ? 'peek' : 'hang', { fade: 0.1 }); b.pop = b.popT = 0.05; b.zb = -150; if (hero) sfx.peek(); },
    update(b, dt) {
      this.t += dt; const u = clamp(this.t / this.T, 0, 1), c = portal.center;
      let grow = hero ? (u < 0.45 ? smooth(0, 0.45, u) * 0.55 : 0.55 + smooth(0.6, 1, u) * 0.45) : 1 - Math.pow(1 - u, 2.4);
      b.pop = b.popT = 0.05 + 0.95 * grow;
      b.pos.x = c.x; b.pos.y = c.y + portal.size * 0.1 * (1 - grow);
      b.ang = portal.rot * 0.4; b.spin = 0;
      if (hero) { // peek, look around, then pull itself up
        b.yawT = u < 0.62 ? Math.sin(this.t * 2.2) * 0.8 : 0;
        if (u > 0.62 && b.curName !== 'hang') b.play('hang', { fade: 0.2 });
      } else b.yawT = rand(-0.3, 0.3);
      if (Math.random() < 0.5) glitter.emit(c.x + rand(-1, 1) * portal.R * 0.5, c.y + rand(-1, 1) * portal.R * 0.3, 0, -rand(30, 90), 0.5, rand(2, 4), ...(portal.pal ? [1, 0.75, 0.5] : [0.7, 0.95, 1]), 0.9);
      if (u >= 1) { b.zb = 0; return true; }
      return false;
    },
  };
}
function Suck(portal, delay) { // spiral back down into the hole
  return {
    t: -delay,
    start(b) { b.play('jump_air', { fade: 0.15 }); b.yawT = 0; },
    update(b, dt) {
      this.t += dt;
      if (this.t < 0) { b.pos.x += rand(-1, 1) * b.bh * 0.03; return false; } // shiver before being pulled
      if (!this.s) { this.s = { x: b.pos.x - portal.center.x, y: b.pos.y - portal.center.y }; this.T = clamp(0.45 + Math.hypot(this.s.x, this.s.y) / (S.H * 1.2), 0.45, 1.2); }
      const u = clamp(this.t / this.T, 0, 1), e = u * u, th = e * Math.PI * 2.2 * (this.s.x > 0 ? 1 : -1), k = 1 - e;
      const x = this.s.x * k, y = this.s.y * k, c = Math.cos(th), s = Math.sin(th);
      b.pos.x = portal.center.x + x * c - y * s; b.pos.y = portal.center.y + x * s + y * c;
      b.pop = b.popT = Math.max(0.02, 1 - smooth(0.45, 1, u)); b.spin += dt * 14 * u; b.sq = 1 + 0.4 * u;
      if (Math.random() < 0.6) glitter.emit(b.pos.x, b.pos.y - b.bh * 0.3, 0, 0, 0.3, b.bh * 0.12, ...hsl(b.hue ?? 50, 0.9, 0.7), 0.9);
      if (u >= 1) { sfx.pop(); b.dispose(); return true; }
      return false;
    },
  };
}

// ---------- state ----------
const portals = [], creatures = [];
let spawnAcc = 0, total = 0;
const G = { open: [0, 0], shut: [0, 0], lost: [0, 0], hint: false };

function spawn(portal, hero = false) {
  const i = total++, hue = hero ? (portal.pal ? 30 : 190) : (i * 137.5 + rand(-12, 12)) % 360;
  const c = new Buddy({ hue, sizeMul: hero ? 0.62 : rand(0.28, 0.46) }); c.portal = portal; c.hue = hue;
  c.mixer.timeScale = rand(0.88, 1.15);
  const s = slot(portal, i), trail = hsl(hue, 0.9, 0.7);
  const steps = [Emerge(portal, hero)];
  if (hero) steps.push(Hold(() => portal.center, 'wave', 1.2, { yaw: 0, onStart: () => tone(700, 1100, 0.15, 'sine', 0.06) }));
  if (s.g === 'arm') {
    steps.push(Crouch(() => portal.center, 0.25), Air(() => portal.rimPt(-0.9, 1.1), { flip: false, trail }), Land(() => portal.rimPt(-0.9, 1.1), true),
      Path([() => portal.rimPt(-0.9, 1.1), onArm(s.arm, 0.02), ...(s.f > 0.5 ? [onArm(s.arm, 0.5)] : []), onArm(s.arm, s.f)], 'run', { speed: rand(0.9, 1.3) }),
      Rest(onArm(s.arm, s.f), ['stand_idle', 'cheer', 'wave', 'sit_idle'][i % 4], { yaw: 0, wander: 0.4 }));
  } else {
    steps.push(Crouch(() => portal.center, hero ? 0.4 : 0.22), Air(() => s.fn() || portal.rimPt(0), { trail, flip: hero ? true : undefined }), Land(() => s.fn() || portal.rimPt(0), !hero && Math.random() < 0.7));
    if (hero) steps.push(Hold(s.fn, 'cheer', 1.1));
    steps.push(Rest(() => s.fn() || portal.rimPt(0), ['stand_idle', 'stand_idle', 'cheer', 'wave', 'sit_idle', 'ride'][i % 6], { yaw: rand(-0.3, 0.3), wander: 0.5 }));
  }
  c.run(steps); creatures.push(c);
  if (!hero) sfx.pop();
  return c;
}

function openPortal(hand) {
  const used = new Set(portals.map((p) => p.pal)); const pal = used.has(0) ? 1 : 0;
  const p = new Portal(hand, pal); portals.push(p);
  if (!G.hint) { G.hint = true; toast('Something is coming out…', 2.5); }
  return p;
}

function brain(dt) {
  // per hand: hold open → portal; fist or lost → suck everything back in
  for (let i = 0; i < 2; i++) {
    const h = T.hands[i], has = portals.find((p) => p.hand === i && p.state !== 'closing' && p.state !== 'sucking');
    G.open[i] = h?.open ? G.open[i] + dt : 0;
    if (!has && G.open[i] > 0.3 && !portals.some((p) => p.hand === i && !p.dead)) openPortal(i);
    if (has) {
      G.shut[i] = h && h.closed ? G.shut[i] + dt : 0;
      G.lost[i] = !h ? G.lost[i] + dt : 0;
      if (G.shut[i] > 0.22 || G.lost[i] > 1.0) { has.suck(); if (G.shut[i] > 0.22) toast('Shhhlurp'); }
    }
  }
  // the pour: the hero first, two scouts, then the flood
  const live = portals.filter((p) => p.state === 'open' || p.state === 'opening');
  for (const p of live) {
    if (p.spawned === 0 && p.t > 0.9) { spawn(p, total === 0 || creatures.length === 0); p.spawned++; }
    else if (p.spawned >= 1 && p.spawned < 3 && p.t > 4.4 + p.spawned * 0.45) { spawn(p); p.spawned++; }
    else if (p.spawned >= 3 && p.t > 5.6 && creatures.filter((c) => !c.dead).length < N) {
      if (!p.flood) { p.flood = true; sfx.open(); toast('×' + N); }
      p.acc = (p.acc || 0) + dt * 38 / live.length;
      while (p.acc >= 1 && creatures.filter((c) => !c.dead).length < N) { p.acc--; spawn(p); p.spawned++; }
    }
  }
  // a portal finishes sucking once its creatures are gone (or after a beat)
  for (const p of portals) if (p.state === 'sucking') {
    p.suckT += dt;
    const mine = creatures.some((c) => !c.dead && c.sucked && c.portal === p);
    if ((!mine && p.suckT > 0.8) || p.suckT > 4) p.close();
  }
}

const app = {
  name: 'portal-palm', need: { hands: true, pose: true }, loading: 'Opening the other side…',
  async load() { await loadBuddy(new URL('../byte-buddy/byte.glb', import.meta.url).href); },
  start() { drone = hum(48); wind = loopNoise(500, 'bandpass'); toast('Open your hand ✋', 3); window.__portal = { portals, creatures, spawn, openPortal }; },
  update(dt) {
    brain(dt);
    for (let i = portals.length - 1; i >= 0; i--) if (portals[i].update(dt)) portals.splice(i, 1);
    for (const c of creatures) c.update(dt);
    for (let i = creatures.length - 1; i >= 0; i--) if (creatures[i].dead) creatures.splice(i, 1);
    const o = portals.reduce((m, p) => Math.max(m, p.open), 0), sucking = portals.some((p) => p.state === 'sucking');
    drone?.set(o * 0.05, sucking ? 90 : 48); wind?.set(sucking ? 0.18 : o * 0.03, sucking ? 1600 : 500);
  },
  command(c) {
    if (c === 'open') {
      const i = T.hands.findIndex((h) => h.open); const idx = i >= 0 ? i : T.hands.length ? 0 : -1;
      if (!portals.some((p) => p.hand === idx && !p.dead && p.state !== 'closing')) openPortal(idx); else toast('It is already open');
    }
    if (c === 'close') { portals.forEach((p) => p.suck()); toast('Shhhlurp'); }
    if (c === 'flood') { const p = portals.find((q) => q.state === 'open' || q.state === 'opening') || openPortal(T.hands.length ? 0 : -1); p.t = Math.max(p.t, 5.7); p.spawned = Math.max(p.spawned, 3); }
  },
};
onResize(() => {});
boot(app);
