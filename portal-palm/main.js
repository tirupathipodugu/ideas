// Portal Palm: open your hand and a glowing hole opens exactly in your palm, with real depth.
// One creature peeks out, then a hundred climb out and float in the air all over the screen,
// drifting with your body and swept around by your hands. Every time you open your hand, more come.
// A fist shuts the portal (they stay); two fists suck every one of them back in.
import { THREE, GLOW_BLEND, Q, S, T, scene, boot, toast, clamp, lerp, rand, dist, smooth, hsl, glitter, burst, tone, noise, hum, loopNoise, onResize } from '../live-kit/core.js';
import { loadBuddy, Buddy, Hold } from '../live-kit/buddy.js';

// No limit on how many come out. Past CAP on screen at once, the oldest pop into sparkles so the
// phone keeps its frame rate and it still looks endless. ?cap= raises or lowers it.
const CAP = Math.max(20, Math.min(400, +Q.get('cap') || 220));
let made = 0;
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
    this.hand = hand; this.pal = pal; this.t = 0; this.open = 0; this.state = 'opening'; this.v = 0;
    const h = hand >= 0 ? T.hands[hand] : null, d = T.scale * 0.55;
    this.ax = { x: d, y: 0 }; this.ay = { x: 0, y: -d }; this.center = { x: S.W / 2, y: S.H * 0.62 };
    if (h) this.track(h);
    const [c1, c2] = PALETTES[pal]; this.c2 = c2;
    const U = () => ({ t: { value: 0 }, open: { value: 0 }, c1: { value: c1 }, c2: { value: c2 } });
    const mat = (frag, extra) => new THREE.ShaderMaterial({ uniforms: U(), vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...extra });
    this.hole = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(HOLE));
    this.rim = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(RIM, GLOW_BLEND));
    this.g = new THREE.Group(); this.g.add(this.hole, this.rim); this.rim.position.z = 0.01; this.g.matrixAutoUpdate = false; scene.add(this.g);
    this.light = new THREE.PointLight(c2, 0, 0, 0); scene.add(this.light);
    this.spawned = 0;
    sfx.open(); burst(this.center.x, this.center.y, this.size * 0.5, 60, pal ? 25 : 195);
  }
  /** lock onto the palm: centre of the palm, axes taken straight from the knuckles and the wrist */
  track(h) {
    let ax = h.ax || { x: h.size.x, y: 0 }, ay = h.ay || { x: 0, y: -h.size.y };
    const la = Math.hypot(ax.x, ax.y) || 1, lb = Math.hypot(ay.x, ay.y) || 1, m = Math.max(la, lb) * 0.38;
    if (la < m) ax = { x: ax.x / la * m, y: ax.y / la * m }; // hand edge-on: keep a thin ellipse, never a line
    if (lb < m) ay = { x: ay.x / lb * m, y: ay.y / lb * m };
    this.ax = ax; this.ay = ay;
    // h.seat is the mean of wrist + three knuckles (~3/4 of the way up); the palm's middle is lower
    this.center = { x: h.seat.x - ay.x * 0.2, y: h.seat.y - ay.y * 0.2 };
  }
  get size() { return Math.max(40, Math.hypot(this.ax.x, this.ax.y)); }
  get R() { return this.size * 0.5 * this.open; }
  get rot() { let a = Math.atan2(this.ax.y, this.ax.x); if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI; return a; }
  /** a point around the rim, angle 0 = toward the fingers */
  rimPt(th, k = 1) {
    const r = Math.max(0.4, this.open) * k, a = Math.sin(th) * 0.475 * r, b = Math.cos(th) * 0.425 * r;
    return { x: this.center.x + this.ax.x * a + this.ay.x * b, y: this.center.y + this.ax.y * a + this.ay.y * b, ang: this.rot * 0.5 };
  }
  update(dt) {
    this.t += dt;
    const h = this.hand >= 0 && this.state !== 'closing' ? T.hands[this.hand] : null;
    if (h) this.track(h);
    // opening: overshoot then settle, like an iris snapping wide
    const goal = this.state === 'closing' ? 0 : this.state === 'sucking' ? 1.15 : 1, kk = this.state === 'opening' ? 7 : 10;
    this.v += ((goal - this.open) * kk * kk - this.v * kk * 0.9) * dt; this.open = Math.max(0, this.open + this.v * dt);
    if (this.state === 'opening' && this.t > 0.8) this.state = 'open';
    // the plane's x axis = across the knuckles, y axis = wrist → fingers (screen y down → world y up)
    const X = 1.5 * 0.95, Y = 1.5 * 0.85, c = this.center;
    this.g.matrix.set(this.ax.x * X, this.ay.x * Y, 0, c.x, -this.ax.y * X, -this.ay.y * Y, 0, S.H - c.y, 0, 0, 1, -300, 0, 0, 0, 1);
    this.g.matrixWorldNeedsUpdate = true;
    for (const m of [this.hole.material, this.rim.material]) { m.uniforms.t.value = this.t * (this.state === 'sucking' ? 3 : 1); m.uniforms.open.value = Math.min(1.2, this.open); }
    this.light.position.set(c.x, S.H - c.y + this.size * 0.4, 260); this.light.intensity = this.open * 2.2;
    const col = this.pal ? [1, 0.7, 0.4] : [0.6, 0.9, 1];
    if (this.open > 0.3 && Math.random() < 0.8) { // sparks flick off the rim
      const th = rand(0, Math.PI * 2), p = this.rimPt(th), sp = rand(0.6, 1.4) * this.size;
      glitter.emit(p.x, p.y, (p.x - c.x) / this.size * sp, -Math.abs(p.y - c.y) / this.size * sp - 20, rand(0.3, 0.7), rand(2.5, 5), ...col, 1, 140);
    }
    if (this.state === 'sucking') for (let i = 0; i < 3; i++) { // dust and light stream into the hole
      const a = rand(0, Math.PI * 2), r = rand(1.2, 2.6) * this.size;
      glitter.emit(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, -Math.cos(a) * r * 1.8, -Math.sin(a) * r * 1.8, 0.5, rand(2, 4), ...col, 0.9, 0, -0.6, 0);
    }
    if (this.state === 'closing' && this.open < 0.02 && this.t > 0.2) { this.dispose(); return true; }
    return false;
  }
  suck() {
    if (this.state === 'sucking' || this.state === 'closing') return;
    this.state = 'sucking'; this.suckT = 0; sfx.suck();
    for (const c of creatures) if (!c.dead && !c.sucked) { c.sucked = true; c.portal = this; c.run([Suck(this, rand(0, 0.9) * Math.min(1, creatures.length / 40))]); }
  }
  close() { if (this.state === 'closing') return; this.state = 'closing'; this.t = Math.min(this.t, 1); sfx.close(); burst(this.center.x, this.center.y, this.size * 0.6, 90, this.pal ? 25 : 195); }
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
  swarm: () => { noise(0.8, 400, 2600, 0.08, { attack: 0.3 }); [659, 784, 988].forEach((f, i) => tone(f, f, 0.4, 'triangle', 0.03, i * 0.06)); },
  zip: (() => { let last = 0; return () => { const n = performance.now(); if (n - last < 70) return; last = n; const f = rand(700, 1000); tone(f, f * 0.5, 0.18, 'sine', 0.03); }; })(),
  whee: (() => { let last = 0; return () => { const n = performance.now(); if (n - last < 140) return; last = n; const f = rand(500, 800); tone(f, f * 1.7, 0.16, 'sine', 0.035); }; })(),
};

// ---------- creature steps ----------
function Emerge(portal, hero) { // rise out of the depth: starts tiny at the far light, grows as it climbs up
  return {
    t: 0, T: hero ? 1.7 : rand(0.4, 0.65),
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
function Bridge(from, to) { // leap out of one portal, arc high over the gap, dive into the other
  return {
    t: 0,
    start(b) { b.play('jump_air', { fade: 0.15, speed: 0.8 }); this.T = rand(0.95, 1.35); this.h = rand(0.45, 0.75); this.sw = rand(-0.18, 0.18); this.dir = Math.sign(to.center.x - from.center.x) || 1; b.yawT = this.dir * 0.8; },
    update(b, dt) {
      this.t += dt; const u = clamp(this.t / this.T, 0, 1), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      const p0 = from.center, p2 = to.center, d = dist(p0, p2);
      const mx = (p0.x + p2.x) / 2 + this.sw * d, my = Math.min(p0.y, p2.y) - (d * this.h + U() * 1.2);
      const k = 1 - e;
      b.pos.x = k * k * p0.x + 2 * k * e * mx + e * e * p2.x; b.pos.y = k * k * p0.y + 2 * k * e * my + e * e * p2.y;
      b.spin = -this.dir * Math.PI * 2 * smooth(0.25, 0.75, u); b.ang = 0;
      b.popT = u < 0.12 ? 0.3 + u / 0.12 * 0.7 : u > 0.85 ? Math.max(0.02, 1 - (u - 0.85) / 0.15) : 1;
      if (Math.random() < 0.7) glitter.emit(b.pos.x, b.pos.y, 0, 0, 0.55, b.bh * 0.1, ...hsl(b.hue, 0.9, 0.72), 0.9);
      if (u >= 1) { to.v += 0.25; sfx.zip(); b.dispose(); return true; }
      return false;
    },
  };
}
function bridgeSpawn(from, to) {
  const i = total++, hue = (i * 137.5) % 360;
  const c = new Buddy({ hue, sizeMul: rand(0.22, 0.4) }); c.portal = from; c.hue = hue; c.sucked = true; // in transit: not part of the flock
  c.run([Emerge(from, false), Bridge(from, to)]); creatures.push(c);
}
function PopAway() { // shrink to nothing with a little sparkle burst
  return {
    t: 0,
    update(b, dt) {
      this.t += dt; b.popT = Math.max(0.01, 1 - this.t / 0.35); b.pos.y -= dt * U() * 0.6;
      if (this.t >= 0.35) { burst(b.pos.x, b.pos.y, b.bh * 0.5, 14, b.hue); sfx.pop(); b.dispose(); return true; }
      return false;
    },
  };
}
function Suck(portal, delay) { // spiral back down into the hole
  return {
    t: -delay,
    start(b) { b.play('jump_air', { fade: 0.15 }); b.yawT = 0; b.tilt = 0; b.zb = 0; },
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

// ---------- floating in the air ----------
// Every byte drifts on its own slow spring toward a home spot on screen. The whole flock is pinned to
// your body (move and it follows you, small ones lag behind like they are further away), and your
// hands, arms and head push the air around them, so a wave of the hand sweeps them aside.
const U = () => Math.min(S.W, S.H) * 0.1; // the drift unit in px, stable whatever the camera does
const FX = { A: null, winds: [], prev: {} };
function sense(dt) {
  const B = T.body, L = B.ok && B.raw;
  // the head from pose (nose + ears): no extra face model, so phones keep their frame rate
  const Fc = L && L[0].v > 0.5 && L[7].v > 0.3 && L[8].v > 0.3 ? { ok: true, center: { x: L[0].x, y: L[0].y }, w: dist(L[7], L[8]) * 1.15 } : { ok: false };
  FX.A = B.ok ? { x: B.neck.x, y: B.neck.y } : FX.A;
  const src = [];
  T.hands.forEach((h, i) => { if (!h.point) src.push(['h' + i, h.seat, Math.max(U() * 2.2, h.size.y * 1.8)]); });
  const ph = T.hands.find((h) => h.point);
  FX.ptT = ph ? (FX.ptT || 0) + dt : 0;
  const was = !!FX.tip;
  FX.tip = ph && FX.ptT > 0.25 ? { ...ph.tip8 } : null; if (FX.tip) FX.lastTip = FX.tip;
  if (FX.tip && !was) { sfx.swarm(); toast('Come here…', 1.4); }
  if (FX.tip && Math.random() < 0.7) glitter.emit(FX.tip.x + rand(-4, 4), FX.tip.y + rand(-4, 4), rand(-20, 20), rand(-30, 5), 0.5, rand(3, 6), 1, 0.95, 0.8, 1);
  if (B.ok && !FX.tip) for (const k of ['armR', 'armL']) if (B[k]) { src.push([k + 'w', B[k].wr, U() * 2]); src.push([k + 'e', B[k].el, U() * 1.6]); }
  if (Fc.ok && Fc.center) src.push(['face', Fc.center, Math.max(U() * 2.4, Fc.w * 1.3)]);
  if (FX.A) src.push(['body', FX.A, U() * 3]);
  const seen = {}; FX.winds = [];
  for (const [k, p, r] of src) {
    const o = FX.prev[k]; seen[k] = true;
    let vx = 0, vy = 0;
    if (o && Math.hypot(p.x - o.x, p.y - o.y) < S.W * 0.3) { vx = lerp(o.vx, (p.x - o.x) / dt, 0.35); vy = lerp(o.vy, (p.y - o.y) / dt, 0.35); }
    FX.prev[k] = { x: p.x, y: p.y, vx, vy };
    FX.winds.push({ x: p.x, y: p.y, vx, vy, r, solid: k === 'face' ? Fc.w * 0.62 : k[0] === 'h' ? r * 0.3 : 0 });
  }
  for (const k in FX.prev) if (!seen[k]) delete FX.prev[k];
  // keep a little personal space so the flock never clumps into one blob
  const fl = creatures.filter((c) => c.fl && !c.dead && !c.sucked);
  for (const c of fl) { c.fl.sx = 0; c.fl.sy = 0; }
  for (let i = 0; i < fl.length; i++) for (let j = i + 1; j < fl.length; j++) {
    const a = fl[i], b = fl[j], dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, m = (a.bh + b.bh) * 0.42, d2 = dx * dx + dy * dy;
    if (d2 > m * m || d2 < 1e-4) continue;
    const d = Math.sqrt(d2), f = (m - d) / m * U() * 9;
    a.fl.sx += dx / d * f; a.fl.sy += dy / d * f; b.fl.sx -= dx / d * f; b.fl.sy -= dy / d * f;
  }
}
const FLOAT_CLIPS = ['jump_air', 'jump_air', 'hang', 'cheer', 'wave', 'hang'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function Float(portal) {
  return {
    rest: true, t: 0,
    start(b) {
      const u = U(), up = Math.hypot(portal.ay.x, portal.ay.y) || 1;
      b.fl = {
        // shoot up out of the palm (toward the fingers, always a bit up the screen), then the spring takes over
        vx: portal.ay.x / up * u * 4 + rand(-1.6, 1.6) * u, vy: Math.min(-2.5 * u, portal.ay.y / up * u * 5) - rand(0.5, 2) * u,
        k: rand(1.3, 3.2), c: rand(1.5, 2.3), ph: rand(0, 100), fx: rand(0.12, 0.3), fy: rand(0.1, 0.26),
        hx: rand(0.06, 0.94), hy: rand(0.07, 0.8), A0: FX.A ? { ...FX.A, s: T.scale } : null,
        px: rand(0.5, 1.2), orb: 0.55 + 3.6 * Math.sqrt(Math.random()), spinDir: 1, flip: 0, dir: 1, sx: 0, sy: 0, clipT: rand(3, 8),
      };
      b.fl.fol = 0.45 + b.fl.px * 0.6; // big = near = follows you more, small ones lag like they are far away
      b.popT = 1; b.zb = (b.fl.px - 0.85) * 250;
      this.clip(b, pick(FLOAT_CLIPS));
    },
    clip(b, n) { b.play(n, { fade: 0.6, sync: true, speed: n === 'jump_air' ? rand(0.35, 0.55) : rand(0.6, 0.9) }); b.contactT = -0.1; },
    update(b, dt) {
      this.t += dt; const f = b.fl, u = U(), t = S.t;
      // in the air they are sized to the screen, not to you, so a close-up never turns them into giants
      b.sizeMul = lerp(b.sizeMul, f.px * u / Math.max(40, T.scale), Math.min(1, dt * 1.5));
      // where this one wants to be: its home, carried along by your body, plus a slow lazy wander
      let tx = f.hx * S.W, ty = f.hy * S.H;
      if (FX.A) {
        if (!f.A0) f.A0 = { ...FX.A, s: T.scale };
        const sc = Math.sqrt(clamp(T.scale / f.A0.s, 0.6, 1.8)) - 1;
        tx += (FX.A.x - f.A0.x) * f.fol + (tx - f.A0.x) * sc; ty += (FX.A.y - f.A0.y) * f.fol + (ty - f.A0.y) * sc;
      }
      tx += Math.sin(t * f.fx * 6.28 + f.ph) * 0.5 * u + Math.sin(t * f.fx * 2.3 + f.ph * 2) * 0.35 * u;
      ty += Math.cos(t * f.fy * 6.28 + f.ph) * 0.4 * u + Math.sin(t * 0.9 + f.ph) * 0.08 * u;
      tx = clamp(tx, S.W * 0.05, S.W * 0.95); ty = clamp(ty, S.H * 0.06, S.H * 0.84);
      // point a finger and they swarm it, circling the tip like a tiny galaxy (inner ones spin faster)
      f.pt = lerp(f.pt || 0, FX.tip ? 1 : 0, Math.min(1, dt * (FX.tip ? 1.2 + f.px : 0.8)));
      if (f.pt > 0.001 && (FX.tip || FX.lastTip)) {
        const c = FX.tip || FX.lastTip, r = f.orb * u, a = f.ph + t * (2.4 / Math.sqrt(f.orb)) * f.spinDir;
        const gx = c.x + Math.cos(a) * r, gy = c.y + Math.sin(a) * r * 0.42 - Math.cos(a) * r * 0.14;
        tx = lerp(tx, gx, f.pt); ty = lerp(ty, gy, f.pt);
      }
      const ramp = smooth(0.25, 1.8, this.t), k = f.k * ramp * (1 + f.pt * 2.2);
      let axx = k * (tx - b.pos.x) - f.c * f.vx + f.sx * ramp, ayy = k * (ty - b.pos.y) - f.c * f.vy + f.sy * ramp;
      // the air you move: anything near a moving hand / arm / head gets swept along and pushed out
      let gust = 0;
      for (const w of FX.winds) {
        const dx = b.pos.x - w.x, dy = b.pos.y - w.y, d = Math.hypot(dx, dy) || 1;
        if (d > w.r) continue;
        const q = (1 - d / w.r) ** 2, sp = Math.hypot(w.vx, w.vy);
        axx += (w.vx * 3 + dx / d * sp * 1.6) * q * ramp; ayy += (w.vy * 3 + dy / d * sp * 1.6) * q * ramp;
        if (w.solid && d < w.solid) { axx += dx / d * (w.solid - d) * 14 * ramp; ayy += dy / d * (w.solid - d) * 14 * ramp; }
        gust = Math.max(gust, sp * q);
      }
      // soft walls: nobody drifts off the edge of the screen for long
      const m = b.bh * 0.5, wx = b.pos.x < m ? m - b.pos.x : b.pos.x > S.W - m ? S.W - m - b.pos.x : 0, wy = b.pos.y < m ? m - b.pos.y : b.pos.y > S.H * 0.88 ? S.H * 0.88 - b.pos.y : 0;
      axx += wx * 18 * ramp; ayy += wy * 18 * ramp;
      f.vx += axx * dt; f.vy += ayy * dt;
      const v = Math.hypot(f.vx, f.vy), vmax = 9 * u; if (v > vmax) { f.vx *= vmax / v; f.vy *= vmax / v; }
      b.pos.x += f.vx * dt; b.pos.y += f.vy * dt;
      // body language: bank into the drift, face where it is going, a slow tumble, a somersault when flung
      b.ang = lerp(b.ang, clamp(f.vx / (5 * u), -0.55, 0.55), Math.min(1, dt * 3));
      b.yawT = clamp(f.vx / (3 * u), -1, 1) * 0.9 + Math.sin(t * 0.4 + f.ph) * 0.35;
      b.tilt = lerp(b.tilt, Math.sin(t * 0.7 + f.ph) * 0.22 + clamp(f.vy / (6 * u), -0.45, 0.45), Math.min(1, dt * 3));
      if (!f.flip && v > 4.2 * u && gust > 2 * u) { f.flip = 1; f.dir = Math.sign(f.vx) || 1; sfx.whee(); }
      if (f.flip) f.flip = Math.max(0, f.flip - dt / 0.85);
      b.spin = Math.sin(t * 0.5 + f.ph) * 0.25 - (f.flip ? f.dir * Math.PI * 2 * smooth(0, 1, 1 - f.flip) : 0);
      if (v > 2.2 * u && Math.random() < 0.25) glitter.emit(b.pos.x, b.pos.y, 0, 0, 0.5, b.bh * 0.08, ...hsl(b.hue, 0.9, 0.72), 0.8);
      if ((f.clipT -= dt) < 0) { f.clipT = rand(4, 9); this.clip(b, pick(FLOAT_CLIPS)); }
      return false;
    },
  };
}

// ---------- state ----------
const portals = [], creatures = [];
let total = 0;
const G = { open: [0, 0], shut: [0, 0], lost: [0, 0], hint: false };
const alive = () => creatures.filter((c) => !c.dead && !c.sucked).length;

function spawn(portal, hero = false) {
  const i = total++, hue = hero ? (portal.pal ? 30 : 190) : (i * 137.5 + rand(-12, 12)) % 360;
  const c = new Buddy({ hue, sizeMul: hero ? 0.6 : rand(0.22, 0.5) }); c.portal = portal; c.hue = hue;
  c.mixer.timeScale = rand(0.88, 1.15);
  const steps = [Emerge(portal, hero)];
  if (hero) steps.push(Hold(() => portal.rimPt(0, 0.2), 'wave', 0.9, { yaw: 0, onStart: () => tone(700, 1100, 0.15, 'sine', 0.06) }));
  steps.push(Float(portal));
  c.run(steps); creatures.push(c);
  if (!hero) sfx.pop();
  return c;
}

function openPortal(hand) {
  const used = new Set(portals.filter((p) => !p.dead).map((p) => p.pal)); const pal = used.has(0) ? 1 : 0;
  const p = new Portal(hand, pal); portals.push(p);
  if (!G.hint) { G.hint = true; toast('Something is coming out…', 2.5); }
  return p;
}

function brain(dt) {
  // per hand: hold it open → portal in the palm. Fist → that portal shuts (everyone out stays floating).
  // Hand gone → the portal shuts too.
  for (let i = 0; i < 2; i++) {
    const h = T.hands[i], has = portals.find((p) => p.hand === i && (p.state === 'open' || p.state === 'opening'));
    G.open[i] = h?.open ? G.open[i] + dt : 0;
    if (!has && G.open[i] > 0.3 && !portals.some((p) => p.hand === i && !p.dead)) openPortal(i);
    if (has) {
      G.shut[i] = h && !h.open ? G.shut[i] + dt : 0; // fist or pointing: the portal shuts
      G.lost[i] = !h ? G.lost[i] + dt : 0;
      if (G.shut[i] > 0.22 || G.lost[i] > 0.6) has.close();
    }
  }
  // two fists at once: every byte on screen is sucked back in
  G.both = T.hands.length === 2 && T.hands.every((h) => h.closed) ? (G.both || 0) + dt : 0;
  if (G.both > 0.3 && alive()) { G.both = -99; const p = openPortal(0); p.suck(); toast('Shhhlurp'); }
  for (const p of portals) if (p.state === 'sucking') {
    p.suckT += dt;
    const mine = creatures.some((c) => !c.dead && c.sucked && c.portal === p);
    if ((!mine && p.suckT > 0.8) || p.suckT > 4) p.close();
  }
  // over the cap: the oldest floaters pop into sparkles, so it can run forever
  let over = alive() - CAP;
  for (const c of creatures) { if (over <= 0) break; if (c.fl && !c.dead && !c.sucked) { c.sucked = true; c.run([PopAway()]); over--; } }

  const live = portals.filter((p) => p.state === 'open' || p.state === 'opening');
  // both palms open: a bridge. The portal that opened first pours into the other one.
  if (live.length === 2 && live.every((p) => p.t > 1.2)) {
    const [from, to] = live[0].t >= live[1].t ? live : [live[1], live[0]];
    if (!G.bridge) { G.bridge = true; sfx.open(); toast('Hand to hand ✋ ✋', 2); }
    G.bacc = (G.bacc || 0) + dt * 16;
    while (G.bacc >= 1) { G.bacc--; bridgeSpawn(from, to); }
    return;
  }
  G.bridge = false;
  // one palm: one peeks out first, then they keep climbing out for as long as the hand stays open
  for (const p of live) {
    if (p.spawned === 0 && p.t > 0.7) { p.first = alive() === 0; spawn(p, p.first); p.spawned++; }
    else if (p.spawned >= 1 && p.t > (p.first ? 2.2 : 0.9)) {
      if (!p.flood) { p.flood = true; sfx.open(); }
      p.acc = (p.acc || 0) + dt * (p.t < 6 ? 32 : 14) / live.length;
      while (p.acc >= 1) { p.acc--; spawn(p); p.spawned++; made++; if (made % 50 === 0) toast('×' + made); }
    }
  }
}

const app = {
  name: 'portal-palm', need: { hands: true, pose: true }, loading: 'Opening the other side…',
  async load() { await loadBuddy(new URL('../byte-buddy/byte.glb', import.meta.url).href); },
  start() { drone = hum(48); wind = loopNoise(500, 'bandpass'); toast('Open your hand ✋', 3); window.__portal = { portals, creatures, spawn, openPortal, FX }; },
  update(dt) {
    dt = Math.min(dt, 1 / 20);
    sense(dt); brain(dt);
    for (let i = portals.length - 1; i >= 0; i--) if (portals[i].update(dt)) portals.splice(i, 1);
    for (const c of creatures) c.update(dt);
    for (let i = creatures.length - 1; i >= 0; i--) if (creatures[i].dead) creatures.splice(i, 1);
    const o = portals.reduce((m, p) => Math.max(m, p.open), 0), sucking = portals.some((p) => p.state === 'sucking');
    const gust = clamp(FX.winds.reduce((m, w) => Math.max(m, Math.hypot(w.vx, w.vy)), 0) / (U() * 10), 0, 1);
    drone?.set(o * 0.05, sucking ? 90 : 48); wind?.set(sucking ? 0.18 : o * 0.03 + gust * 0.05 * Math.min(1, alive() / 20), sucking ? 1600 : 500 + gust * 400);
  },
  command(c) {
    const oi = T.hands.findIndex((h) => h.open), idx = oi >= 0 ? oi : T.hands.length ? 0 : -1;
    const live = () => portals.find((q) => q.state === 'open' || q.state === 'opening');
    if (c === 'open') { if (!live()) openPortal(idx); else toast('It is already open'); }
    if (c === 'close') { (live() || openPortal(idx)).suck(); toast('Shhhlurp'); }
    if (c === 'flood') { const p = live() || openPortal(idx); p.t = Math.max(p.t, 2.3); p.spawned = Math.max(p.spawned, 1); }
  },
};
onResize(() => {});
boot(app);
