// Pet Cloud: a tiny fluffy storm cloud that lives above your hand and copies your mood.
// Smile → it turns white and throws a rainbow. Frown → it rains on your palm. Scowl → thunderstorm.
// Clap → lightning strike. Squeeze your fist under it → you wring it out. Blow at it → it drifts away.
// Poke it with a finger → it giggles.
import { THREE, S, T, scene, boot, toast, clamp, lerp, rand, damp, dist, Particles, glitter, burst, tone, noise, loopNoise, canvasTex, TEX, renderer } from '../live-kit/core.js';

// ---------- textures ----------
const PUFF = canvasTex(128, (g, s) => { // soft, slightly lumpy cloud puff
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * s * 0.16, x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r, rad = s * (0.18 + Math.random() * 0.16);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
});
const FLAKE = canvasTex(32, (g, s) => { g.strokeStyle = '#fff'; g.lineWidth = 2; g.translate(s / 2, s / 2); for (let i = 0; i < 3; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-12, 0); g.lineTo(12, 0); g.stroke(); } });
void FLAKE;

// ---------- the cloud: ~44 lit puffs + a face ----------
const cloud = new THREE.Group(); scene.add(cloud);
const puffs = [];
for (let i = 0; i < 44; i++) {
  // dome: wide flat bottom, rounded heaped top
  const x = rand(-1, 1), top = 0.55 * Math.sqrt(Math.max(0, 1 - x * x)) + 0.12, y = rand(-0.18, top), z = rand(-0.25, 0.25);
  const m = new THREE.SpriteMaterial({ map: PUFF, transparent: true, depthWrite: false, color: 0xffffff });
  const s = new THREE.Sprite(m); s.renderOrder = 10 + Math.round((z + 0.3) * 10);
  const base = { x, y, z, size: rand(0.55, 0.85) * (1 - Math.abs(x) * 0.35), ph: rand(0, 6.28), sp: rand(0.4, 0.9) };
  puffs.push({ s, base }); cloud.add(s);
}
// the face
const faceCanvas = document.createElement('canvas'); faceCanvas.width = 256; faceCanvas.height = 128;
const faceTex = new THREE.CanvasTexture(faceCanvas); faceTex.colorSpace = THREE.SRGBColorSpace;
const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: faceTex, transparent: true, depthWrite: false })); face.renderOrder = 40; cloud.add(face);
let faceKey = '';
function drawFace(mood, blink, look) {
  const key = mood + blink.toFixed(1) + look.toFixed(1); if (key === faceKey) return; faceKey = key;
  const g = faceCanvas.getContext('2d'), W = 256, H = 128; g.clearRect(0, 0, W, H);
  g.fillStyle = '#2a2433'; g.strokeStyle = '#2a2433'; g.lineCap = 'round'; g.lineWidth = 7;
  const ex = [W / 2 - 46, W / 2 + 46], ey = 52, lx = look * 6;
  for (const x of ex) {
    if (mood === 'happy') { g.beginPath(); g.arc(x, ey + 8, 14, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); continue; }
    const h = Math.max(0.12, 1 - blink) * (mood === 'surprised' ? 1.25 : 1);
    g.beginPath(); g.ellipse(x + lx, ey, 11, 15 * h, 0, 0, Math.PI * 2); g.fill();
    if (h > 0.4) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x + lx + 4, ey - 5 * h, 4, 0, 7); g.fill(); g.fillStyle = '#2a2433'; }
    if (mood === 'sad') { g.beginPath(); g.moveTo(x - 16, ey - 22 + (x < W / 2 ? 6 : -6) * -1); g.lineTo(x + 16, ey - 22 + (x < W / 2 ? -6 : 6) * -1); g.lineWidth = 5; g.stroke(); g.lineWidth = 7; }
    if (mood === 'storm') { g.beginPath(); g.moveTo(x - 16, ey - 26 + (x < W / 2 ? -6 : 6)); g.lineTo(x + 16, ey - 26 + (x < W / 2 ? 6 : -6)); g.lineWidth = 6; g.stroke(); g.lineWidth = 7; }
  }
  // cheeks
  if (mood === 'happy' || mood === 'calm') { g.fillStyle = 'rgba(255,120,150,.45)'; for (const x of ex) { g.beginPath(); g.ellipse(x + (x < W / 2 ? -8 : 8), ey + 26, 14, 8, 0, 0, 7); g.fill(); } g.fillStyle = '#2a2433'; }
  g.beginPath();
  if (mood === 'happy') { g.arc(W / 2, 78, 18, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
  else if (mood === 'sad') { g.arc(W / 2, 102, 14, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke(); }
  else if (mood === 'storm') { g.moveTo(W / 2 - 16, 92); g.lineTo(W / 2 + 16, 88); g.stroke(); }
  else if (mood === 'surprised' || mood === 'blown') { g.ellipse(W / 2, 90, 9, 12, 0, 0, 7); g.fill(); }
  else { g.arc(W / 2, 80, 9, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke(); }
  faceTex.needsUpdate = true;
}

// rainbow arc behind the cloud
const rainbow = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 64, 1, 0, Math.PI), new THREE.ShaderMaterial({
  uniforms: { a: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  vertexShader: 'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'uniform float a;varying vec3 p;vec3 hue(float h){return clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);}void main(){float r=(length(p.xy)-1.1)/.4;vec3 c=hue(.82*(1.-r));float e=smoothstep(0.,.15,r)*smoothstep(1.,.85,r);float f=smoothstep(0.,.35,p.y+.05);gl_FragColor=vec4(c*e*f*a*.7,1.);}',
}));
rainbow.renderOrder = 5; scene.add(rainbow);
const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 })); sun.renderOrder = 4; scene.add(sun);

// lightning: a jagged glowing strip + flash
const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xe8f0ff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
flash.renderOrder = 100; scene.add(flash);
const bolts = [];
function bolt(a, b, width, life = 0.35, branch = true) {
  const pts = [a], n = 12, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
  for (let i = 1; i < n; i++) { const t = i / n, off = rand(-1, 1) * L * 0.09 * Math.sin(Math.PI * t); pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off }); }
  pts.push(b);
  const pos = [], idx = [];
  pts.forEach((p, i) => {
    const q = pts[Math.min(i + 1, pts.length - 1)], r = pts[Math.max(i - 1, 0)], tx = q.x - r.x, ty = q.y - r.y, tl = Math.hypot(tx, ty) || 1, w = width * (1 - (i / pts.length) * 0.5);
    pos.push(p.x - (ty / tl) * w, S.H - (p.y + (tx / tl) * w), 950, p.x + (ty / tl) * w, S.H - (p.y - (tx / tl) * w), 950);
    if (i) idx.push(i * 2 - 2, i * 2 - 1, i * 2, i * 2 - 1, i * 2 + 1, i * 2);
  });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  const glowGeo = geo.clone(); const gp = glowGeo.attributes.position;
  for (let i = 0; i < gp.count; i += 2) { const cx = (gp.getX(i) + gp.getX(i + 1)) / 2, cy = (gp.getY(i) + gp.getY(i + 1)) / 2; for (const j of [i, i + 1]) { gp.setX(j, cx + (gp.getX(j) - cx) * 4); gp.setY(j, cy + (gp.getY(j) - cy) * 4); } }
  const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0x8fb4ff, transparent: true, opacity: 0.5, depthTest: false, blending: THREE.AdditiveBlending }));
  core.renderOrder = glow.renderOrder = 90; scene.add(glow, core);
  bolts.push({ core, glow, t: 0, life });
  if (branch) for (let k = 0; k < 2; k++) { const p = pts[Math.floor(rand(3, n - 2))]; bolt(p, { x: p.x + rand(-1, 1) * L * 0.3, y: p.y + rand(0.15, 0.35) * L }, width * 0.5, life * 0.8, false); }
}

// precipitation
const rain = new Particles(2500, THREE.NormalBlending, { order: 30 });
rain.pts.material.fragmentShader = 'uniform float soft;varying vec4 vc;void main(){vec2 q=gl_PointCoord-.5;float a=smoothstep(.09,0.,abs(q.x))*smoothstep(.5,.1,abs(q.y));gl_FragColor=vec4(vc.rgb,vc.a*a);}';
const splash = new Particles(1200, THREE.NormalBlending, { order: 31 });
const snow = new Particles(800, THREE.NormalBlending, { order: 31 });
rain.onDie = (x, y) => { if (Math.random() < 0.6) for (let i = 0; i < 2; i++) splash.emit(x, y, rand(-50, 50), -rand(30, 90), 0.3, rand(2, 4), 0.75, 0.88, 1, 0.7, 500, 0, 0.5); };

// ---------- sound ----------
let rainBed = null, windBed = null;
const sfx = {
  thunder: (d = 0) => { noise(2.2, 160, 40, 0.5, { type: 'lowpass', q: 0.7, delay: d }); noise(0.25, 3000, 600, 0.35, { delay: d * 0.2 }); },
  chime: () => [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, f * 1.01, 0.6, 'triangle', 0.045, i * 0.07)),
  giggle: () => [800, 1000, 850, 1100, 900].forEach((f, i) => tone(f, f * 1.15, 0.07, 'sine', 0.06, i * 0.08)),
  whoosh: () => noise(0.9, 300, 2500, 0.18, { attack: 0.3 }),
  squish: () => { tone(300, 120, 0.3, 'sine', 0.12); noise(0.4, 1200, 300, 0.12); },
  pop: () => tone(500, 900, 0.1, 'sine', 0.06),
};

// ---------- pet state ----------
const P = { x: S.W / 2, y: S.H * 0.35, vx: 0, vy: 0, size: 180, mood: 'calm', moodT: 0, forced: null, forcedT: 0, rain: 0, snow: 0, happy: 0, dark: 0, squeeze: 0, puffUp: 0, blink: 0, blinkT: 2, wind: 0, windX: 0, giggle: 0, stretch: 0, seen: false };
const G = { clapCD: 0, prevGap: null, fist: 0, strikeT: 3, hintSad: false };

function home() { // where the cloud wants to be
  const hs = T.hands, open = hs.find((h) => h.open) || hs.find((h) => !h.closed) || hs[0];
  if (open) { const s = open.size.x; return { x: open.seat.x + open.hup.x * open.hl * 1.9, y: open.seat.y + open.hup.y * open.hl * 1.9 - s * 0.3, size: clamp(s * 3.0, 110, S.W * 0.7), hand: open }; }
  const Fc = T.face; if (Fc.ok) { const side = Fc.center.x < S.W / 2 ? 1 : -1; return { x: clamp(Fc.center.x + side * Fc.w * 1.05, 80, S.W - 80), y: Fc.top.y + Fc.h * 0.05, size: clamp(Fc.w * 1.4, 110, S.W * 0.6), hand: null }; }
  return { x: S.W / 2, y: S.H * 0.32, size: Math.min(S.W, S.H) * 0.4, hand: null };
}
function readMood(dt) {
  const b = T.face.ok ? T.face.bs : {};
  const smile = ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) / 2;
  const frown = ((b.mouthFrownLeft ?? 0) + (b.mouthFrownRight ?? 0)) / 2 + (b.mouthShrugLower ?? 0) * 0.3 + (b.browInnerUp ?? 0) * 0.25 * (smile < 0.2 ? 1 : 0);
  const angry = ((b.browDownLeft ?? 0) + (b.browDownRight ?? 0)) / 2;
  const blow = Math.max(b.mouthPucker ?? 0, b.mouthFunnel ?? 0) * (1 - (b.jawOpen ?? 0) * 0.5);
  const wow = (b.jawOpen ?? 0) > 0.55 && blow < 0.4;
  let m = 'calm';
  if (smile > 0.45) m = 'happy'; else if (angry > 0.45) m = 'storm'; else if (frown > 0.32) m = 'sad'; else if (wow) m = 'surprised';
  if (blow > 0.45) { m = 'blown'; P.wind = Math.min(1, P.wind + dt * 3); } else P.wind = Math.max(0, P.wind - dt * 1.2);
  if (P.forced && (P.forcedT -= dt) > 0) m = P.forced; else P.forced = null;
  // moods need a beat before they switch so the pet does not flicker
  if (m !== P.mood) { P.moodT += dt; if (P.moodT > (m === 'blown' ? 0.1 : 0.35)) { const prev = P.mood; P.mood = m; P.moodT = 0; onMood(m, prev); } } else P.moodT = 0;
}
function onMood(m, prev) {
  if (m === 'happy') { sfx.chime(); burst(P.x, P.y, P.size * 0.3, 50); }
  if (m === 'storm' && prev !== 'storm') { G.strikeT = 0.6; toast('⛈️'); }
  if (m === 'sad' && !G.hintSad) { G.hintSad = true; toast('aww… 🌧️'); }
  if (m === 'blown') sfx.whoosh();
  if (m === 'surprised') { P.puffUp = 1; sfx.pop(); }
}
function strike(target) {
  const from = { x: P.x + rand(-0.25, 0.25) * P.size, y: P.y + P.size * 0.12 };
  const to = target || { x: from.x + rand(-0.4, 0.4) * P.size, y: Math.min(S.H - 20, from.y + P.size * rand(1.4, 2.2)) };
  bolt(from, to, Math.max(2, P.size * 0.012)); flash.material.opacity = 0.55; P.lit = 1;
  burst(to.x, to.y, P.size * 0.25, 40, 210); sfx.thunder(); const st = document.getElementById('stage'); st.style.transform = `translate(${rand(-6, 6)}px,${rand(-4, 4)}px)`; setTimeout(() => (st.style.transform = ''), 90);
}
function gestures(dt) {
  const hs = T.hands;
  // clap: two hands rushing together
  G.clapCD -= dt;
  if (hs.length === 2) {
    const gap = dist(hs[0].seat, hs[1].seat) / Math.max(40, hs[0].size.x);
    if (G.prevGap != null && G.prevGap - gap > 0.25 && gap < 1.4 && G.clapCD < 0) { G.clapCD = 0.6; strike({ x: (hs[0].seat.x + hs[1].seat.x) / 2, y: (hs[0].seat.y + hs[1].seat.y) / 2 }); P.forced = 'storm'; P.forcedT = 2.5; }
    G.prevGap = gap;
  } else G.prevGap = null;
  // squeeze: a fist right under the cloud wrings it out
  const fist = hs.find((h) => h.closed && Math.abs(h.seat.x - P.x) < P.size * 0.6 && h.seat.y > P.y);
  G.fist = fist ? G.fist + dt : 0;
  if (G.fist > 0.25 && P.squeeze < 0.5) { sfx.squish(); toast('squeeeeze 💦'); }
  P.squeeze = damp(P.squeeze, fist && G.fist > 0.25 ? 1 : 0, 6, dt);
  // poke: a fingertip inside the cloud
  for (const h of hs) {
    const tip = h.L[8]; if (!tip) continue;
    if (Math.abs(tip.x - P.x) < P.size * 0.45 && tip.y > P.y - P.size * 0.35 && tip.y < P.y + P.size * 0.12 && h !== P.hand) {
      if (P.giggle <= 0) { sfx.giggle(); burst(tip.x, tip.y, P.size * 0.15, 25, 330); P.forced = 'happy'; P.forcedT = 1.5; }
      P.giggle = 0.8;
    }
  }
  P.giggle -= dt;
}

function update(dt) {
  const t = S.t;
  readMood(dt); gestures(dt);
  const h = home(); P.hand = h.hand;
  if (!P.seen) { P.x = h.x; P.y = h.y; P.size = h.size; P.seen = true; }
  // soft spring follow with a little lag so it feels like it floats
  const wx = P.wind * (P.x < S.W / 2 ? -1 : 1) * S.W * 0.35;
  P.vx += ((h.x + wx - P.x) * 16 - P.vx * 6) * dt; P.vy += ((h.y - P.y + Math.sin(t * 1.6) * P.size * 0.03) * 16 - P.vy * 6) * dt;
  P.x += P.vx * dt; P.y += P.vy * dt; P.size = lerp(P.size, h.size * (1 + P.puffUp * 0.25), Math.min(1, dt * 3));
  P.puffUp = Math.max(0, P.puffUp - dt * 0.8);
  P.stretch = damp(P.stretch, clamp(P.vx / (P.size * 3), -0.5, 0.5) + P.wind * 0.25 * Math.sign(wx || 1), 5, dt);
  // mood → look
  const m = P.mood, raining = m === 'sad' || m === 'storm' || P.squeeze > 0.3;
  P.rain = damp(P.rain, m === 'storm' ? 1 : m === 'sad' ? 0.45 : 0, 2, dt);
  P.happy = damp(P.happy, m === 'happy' ? 1 : 0, 3, dt);
  P.dark = damp(P.dark, m === 'storm' ? 1 : m === 'sad' ? 0.55 : 0, 2.5, dt);
  P.snow = damp(P.snow, P.forced === 'snow' ? 1 : 0, 2, dt);
  P.lit = Math.max(0, (P.lit || 0) - dt * 4);
  const top = new THREE.Color().setRGB(1, 1, 1).lerp(new THREE.Color(0.42, 0.45, 0.55), P.dark), bot = new THREE.Color(0.78, 0.82, 0.92).lerp(new THREE.Color(0.2, 0.22, 0.3), P.dark);
  if (P.happy > 0.01) { top.lerp(new THREE.Color(1, 0.98, 0.95), P.happy); bot.lerp(new THREE.Color(1, 0.86, 0.9), P.happy * 0.6); }
  const s = P.size, sq = 1 - P.squeeze * 0.35;
  for (const p of puffs) {
    const b = p.base, br = 1 + Math.sin(t * b.sp + b.ph) * 0.06 + P.happy * Math.abs(Math.sin(t * 6 + b.ph)) * 0.05 + (P.giggle > 0 ? Math.sin(t * 30 + b.ph) * 0.06 : 0);
    const x = b.x + Math.sin(t * 0.5 * b.sp + b.ph) * 0.03 + b.y * P.stretch * 0.6, y = b.y * sq + Math.cos(t * 0.6 * b.sp + b.ph) * 0.02;
    p.s.position.set(x * s * 0.5 * (1 + P.squeeze * 0.15), y * s * 0.5, b.z * 100);
    p.s.scale.setScalar(b.size * s * 0.5 * br);
    const k = clamp((b.y + 0.2) / 0.85, 0, 1); p.s.material.color.copy(bot).lerp(top, k).lerp(new THREE.Color(0.85, 0.9, 1.2), P.lit * 0.8);
    p.s.material.opacity = 0.95;
  }
  cloud.position.set(P.x, S.H - P.y, 500); cloud.rotation.z = -P.stretch * 0.3;
  // face
  P.blinkT -= dt; if (P.blinkT < 0) { P.blink = 1; P.blinkT = rand(2, 5); } P.blink = Math.max(0, P.blink - dt * 7);
  const look = T.face.ok ? clamp((T.face.center.x - P.x) / (S.W * 0.3), -1, 1) : 0;
  drawFace(P.giggle > 0 ? 'happy' : m, P.blink > 0.5 ? 1 : 0, look);
  face.position.set(look * s * 0.03, s * 0.04, 120); face.scale.set(s * 0.42, s * 0.21, 1);
  // sun + rainbow when happy
  rainbow.position.set(P.x, S.H - P.y - s * 0.05, 400); rainbow.scale.setScalar(s * 0.62); rainbow.material.uniforms.a.value = P.happy;
  sun.position.set(P.x + s * 0.35, S.H - P.y + s * 0.3, 450); sun.scale.setScalar(s * 0.9 * (0.9 + Math.sin(t * 2) * 0.05)); sun.material.opacity = P.happy * 0.8;
  if (P.happy > 0.5 && Math.random() < 0.5) glitter.emit(P.x + rand(-0.5, 0.5) * s, P.y + rand(-0.3, 0.2) * s, 0, -rand(10, 30), rand(0.6, 1.2), rand(3, 6), 1, rand(0.8, 1), rand(0.6, 0.9), 1);
  // rain: drops die at your palm (or the bottom of the screen) and splash there
  const floorY = h.hand ? h.hand.seat.y - h.hand.size.x * 0.1 : S.H - 10;
  const rate = (P.rain + P.squeeze * 1.6) * 160 * (s / 200);
  for (let i = 0; i < rate * dt + (Math.random() < (rate * dt) % 1 ? 1 : 0); i++) {
    const x = P.x + rand(-0.42, 0.42) * s * (1 + P.squeeze * 0.2), y = P.y + s * 0.08, v = s * rand(3.2, 4) + 200;
    const handHit = h.hand && Math.abs(x - h.hand.seat.x) < h.hand.size.x * 0.9;
    const yEnd = handHit ? floorY + rand(-0.2, 0.2) * h.hand.size.x : S.H + 20;
    rain.emit(x, y, P.vx * 0.2, v, Math.max(0.05, (yEnd - y) / v), rand(7, 12) * (s / 200) + 4, 0.7, 0.82, 1, 0.75, 0, 0, 0);
  }
  if (P.snow > 0.1 && Math.random() < P.snow) snow.emit(P.x + rand(-0.45, 0.45) * s, P.y + s * 0.1, rand(-20, 20), rand(30, 60), rand(2, 3.5), rand(3, 6), 1, 1, 1, 0.95, 0, 0, 0.2);
  rainBed?.set(Math.min(0.22, (P.rain + P.squeeze) * 0.2), 1400 + P.rain * 1800); windBed?.set(P.wind * 0.2, 900);
  // thunderstorm: strikes now and then
  if (m === 'storm') { G.strikeT -= dt; if (G.strikeT < 0) { G.strikeT = rand(1.6, 3.2); strike(h.hand ? { x: h.hand.seat.x + rand(-0.3, 0.3) * h.hand.size.x, y: h.hand.seat.y } : null); } }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i]; b.t += dt; const a = Math.max(0, 1 - b.t / b.life) * (Math.random() < 0.3 ? 0.4 : 1);
    b.core.material.opacity = a; b.glow.material.opacity = a * 0.5;
    if (b.t > b.life) { scene.remove(b.core, b.glow); b.core.geometry.dispose(); b.glow.geometry.dispose(); b.core.material.dispose(); b.glow.material.dispose(); bolts.splice(i, 1); }
  }
  flash.position.set(S.W / 2, S.H / 2, 990); flash.scale.set(S.W, S.H, 1); flash.material.opacity = Math.max(0, flash.material.opacity - dt * 3);
  rain.update(dt); splash.update(dt); snow.update(dt);
}

const app = {
  name: 'pet-cloud', need: { hands: true, face: true }, loading: 'Catching a cloud…',
  start() { rainBed = loopNoise(2000, 'bandpass'); windBed = loopNoise(900, 'bandpass'); toast('Open your hand ✋ then smile or frown', 3.5); window.__cloud = { P, strike }; },
  update,
  command(c) {
    const force = { sun: 'happy', rain: 'sad', storm: 'storm', snow: 'snow' }[c];
    if (force) { P.forced = force; P.forcedT = 6; if (c === 'storm') G.strikeT = 0.2; if (c === 'sun') { sfx.chime(); } }
    if (c === 'zap') strike();
  },
};
void renderer;
boot(app);
