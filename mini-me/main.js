// Mini Me: a tiny chibi you sits on your shoulder. Its face is your face, live, a beat late,
// and its arms copy yours a beat late too. Then it gets bored and does its own thing:
// replays your silliest face back at you, falls asleep, climbs onto your head, waves, does the
// opposite of what you do. Bring your hand close for a high five.
import { THREE, S, T, F, scene, boot, toast, clamp, lerp, rand, damp, dist, angLerp, video, videoRect, MIRROR, overlay, octx, fx2d, burst, puff, tone, noise } from '../live-kit/core.js';

// ---------- the face texture: a de-rolled crop of your face, delayed ----------
const SZ = 256, DELAY = 16; // frames (~0.5 s at 30 fps)
const mk = () => { const c = document.createElement('canvas'); c.width = c.height = SZ; return c; };
const ring = Array.from({ length: DELAY + 1 }, mk); let ringI = 0, ringN = 0;
const grab = mk(), gctx = grab.getContext('2d', { willReadFrequently: true });
const faceC = mk(), fctx = faceC.getContext('2d');
const funny = mk(), funnyCtx = funny.getContext('2d'); let funnyScore = 0, haveFunny = false;
const faceTex = new THREE.CanvasTexture(faceC); faceTex.colorSpace = THREE.SRGBColorSpace;
const col = { hair: new THREE.Color(0.18, 0.13, 0.1), shirt: new THREE.Color(0.3, 0.45, 0.8), skin: new THREE.Color(0.95, 0.75, 0.62) };
const rollQ = []; // delayed roll + arm angles travel with the frames

function toVideo(p) { const r = videoRect(); const x = MIRROR ? S.W - p.x : p.x; return { x: (x - r.ox) / r.s, y: (p.y - r.oy) / r.s }; }
function sampleColor(p, rad = 3) {
  const v = toVideo(p), c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(video, v.x - rad, v.y - rad, rad * 2, rad * 2, 0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data;
  return new THREE.Color(d[0] / 255, d[1] / 255, d[2] / 255).convertSRGBToLinear();
}
function captureFace() {
  const Fc = T.face; if (!Fc.ok || video.readyState < 2) return false;
  const c = toVideo(Fc.center), r = videoRect(), size = (Fc.h * 1.55) / r.s, k = SZ / size;
  gctx.save(); gctx.clearRect(0, 0, SZ, SZ);
  gctx.translate(SZ / 2, SZ / 2 + SZ * 0.04); if (MIRROR) gctx.scale(-1, 1);
  gctx.rotate(MIRROR ? Fc.roll : -Fc.roll); gctx.scale(k, k); gctx.filter = 'saturate(1.15) contrast(1.08)';
  gctx.drawImage(video, -c.x, -c.y); gctx.restore();
  // feathered oval so it blends into the head like a bobble-head
  gctx.globalCompositeOperation = 'destination-in';
  gctx.save(); gctx.translate(SZ / 2, SZ * 0.5); gctx.scale(1, 1.28);
  const g = gctx.createRadialGradient(0, 0, SZ * 0.26, 0, 0, SZ * 0.37); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  gctx.fillStyle = g; gctx.fillRect(-SZ, -SZ, SZ * 2, SZ * 2); gctx.restore(); gctx.globalCompositeOperation = 'source-over';
  const dst = ring[ringI].getContext('2d'); dst.clearRect(0, 0, SZ, SZ); dst.drawImage(grab, 0, 0);
  ringI = (ringI + 1) % ring.length; ringN++;
  // remember the silliest face you pulled (mouth open, brows up, big grin)
  const b = Fc.bs, score = (b.jawOpen ?? 0) * 1.2 + (b.browInnerUp ?? 0) * 0.6 + ((b.eyeWideLeft ?? 0) + (b.eyeWideRight ?? 0)) * 0.3 + ((b.mouthSmileLeft ?? 0) + (b.mouthSmileRight ?? 0)) * 0.35 + (b.mouthPucker ?? 0) * 0.5;
  funnyScore *= 0.9995;
  if (score > 0.7 && score > funnyScore) { funnyScore = score; funnyCtx.clearRect(0, 0, SZ, SZ); funnyCtx.drawImage(grab, 0, 0); haveFunny = true; }
  return true;
}
function paintFace(src) { // hair-coloured ball with your face on the front
  fctx.fillStyle = '#' + col.hair.clone().convertLinearToSRGB().getHexString(); fctx.fillRect(0, 0, SZ, SZ);
  fctx.drawImage(src, 0, 0); faceTex.needsUpdate = true;
}

// ---------- the chibi body (local units, y up; 1 unit = u px) ----------
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o });
const shirtM = std(0x4466cc), pantsM = std(0x2b2f3a), skinM = std(0xf0c0a0), shoeM = std(0x222222, { roughness: 0.5 });
const mini = new THREE.Group(), bodyG = new THREE.Group(); mini.add(bodyG);
const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.32, 6, 16), shirtM); torso.position.y = 0.55; torso.scale.z = 0.8; bodyG.add(torso);
const headG = new THREE.Group(); headG.position.y = 1.12; bodyG.add(headG);
const headGeo = new THREE.SphereGeometry(0.62, 40, 28);
{ const p = headGeo.attributes.position, uv = headGeo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / 1.24 * 0.96, 0.5 + p.getY(i) / 1.24 * 0.96); }
const headM = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.62 });
const head = new THREE.Mesh(headGeo, headM); head.position.y = 0.55; head.scale.set(1, 1.04, 0.9); headG.add(head);
const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 10), skinM); neck.position.y = 0.0; headG.add(neck);
function limb(len, r, mat) { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.position.y = -len / 2; g.add(m); return g; }
const arms = [-1, 1].map((s) => {
  const sh = limb(0.3, 0.1, shirtM); sh.position.set(s * 0.4, 0.78, 0); bodyG.add(sh);
  const fo = limb(0.28, 0.085, skinM); fo.position.y = -0.36; sh.add(fo);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), skinM); hand.position.y = -0.36; fo.add(hand);
  return { s, sh, fo, up: 0, fa: 0 };
});
const legs = [-1, 1].map((s) => {
  const th = limb(0.22, 0.12, pantsM); th.position.set(s * 0.17, 0.2, 0); th.rotation.x = -Math.PI / 2 + 0.15; bodyG.add(th);
  const sh = limb(0.24, 0.11, pantsM); sh.position.y = -0.3; sh.rotation.x = Math.PI / 2 - 0.1; th.add(sh);
  const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), shoeM); shoe.scale.set(1, 0.7, 1.4); shoe.position.set(0, -0.32, 0.05); sh.add(shoe);
  return { s, th, sh };
});
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.22, depthWrite: false }));
shadow.scale.set(1.3, 0.3, 1); shadow.position.set(0, 0.02, -0.5); mini.add(shadow);

// ---------- speech bubbles (drawn on the overlay, and into recordings) ----------
const bubbles = [];
function say(text, secs = 1.8) { bubbles.length = 0; bubbles.push({ text, t: 0, life: secs }); }
function drawBubbles(dt) {
  octx.clearRect(0, 0, S.W, S.H);
  for (const b of bubbles) {
    b.t += dt; const a = Math.min(1, b.t * 6, (b.life - b.t) * 4); if (a <= 0) continue;
    const d = st.draw || st.pos, x = clamp(d.x + st.u * 0.9, 90, S.W - 90), y = Math.max(60, d.y - st.u * 2.6), fs = clamp(st.u * 0.36, 13, 22);
    octx.save(); octx.globalAlpha = a; octx.font = `700 ${fs}px system-ui, sans-serif`;
    const w = octx.measureText(b.text).width + fs * 1.2, h = fs * 1.9;
    octx.fillStyle = 'rgba(255,255,255,.95)'; octx.beginPath(); octx.roundRect(x - w / 2, y - h, w, h, h / 2); octx.fill();
    octx.beginPath(); octx.moveTo(x - fs * 0.6, y - 2); octx.lineTo(x - fs * 1.1, y + fs * 0.6); octx.lineTo(x - fs * 0.1, y - 2); octx.fill();
    octx.fillStyle = '#16121f'; octx.textAlign = 'center'; octx.textBaseline = 'middle'; octx.fillText(b.text, x, y - h / 2 + 1); octx.restore();
  }
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].t > bubbles[i].life) bubbles.splice(i, 1);
}
fx2d.push((x, w, h, layer) => { if (layer === 'over') x.drawImage(overlay, 0, 0, w, h); });

// ---------- sound ----------
const sfx = {
  boing: () => tone(300, 700, 0.18, 'sine', 0.08),
  land: () => { noise(0.07, 700, 300, 0.12); tone(140, 90, 0.07, 'sine', 0.08); },
  blip: () => [880, 1320].forEach((f, i) => tone(f, f, 0.12, 'triangle', 0.05, i * 0.08)),
  snore: () => { noise(0.9, 300, 160, 0.06, { attack: 0.5, q: 3 }); },
  clap: () => { noise(0.08, 2400, 1200, 0.35); [1047, 1568].forEach((f, i) => tone(f, f, 0.3, 'triangle', 0.05, 0.05 + i * 0.06)); },
  giggle: () => [700, 900, 760, 980].forEach((f, i) => tone(f, f * 1.1, 0.07, 'sine', 0.05, i * 0.09)),
};

// ---------- state ----------
const st = { pos: { x: S.W * 0.7, y: S.H * 0.7 }, u: 40, ang: 0, mode: 'copy', modeT: 0, nextOwn: 9, at: 'shoulder', jump: null, seen: false, hi5: 0, zzz: 0, bob: 0, sq: 1, sqV: 0, yaw: 0 };
const OWN = ['replay', 'sleep', 'climb', 'wave', 'opposite', 'dance'];
const LINES = { replay: 'remember this face? 😂', sleep: 'zzz…', climb: 'better view up here', wave: 'hi everyone!', opposite: 'nah', dance: '♪ ♪', copy: ['copying you 😇', 'same', 'monkey see…'] };
let ownIdx = 0;

const seat = () => { const B = T.body; return B.ok ? B.seatR : null; };
const headTop = () => { const Fc = T.face; return Fc.ok ? { x: Fc.top.x, y: Fc.top.y + Fc.h * 0.12, ang: Fc.roll } : null; };
function anchor() { return st.at === 'head' ? headTop() : seat(); }
function jumpTo(where) {
  const p = where === 'head' ? headTop() : seat(); if (!p) return;
  st.jump = { s: { ...st.pos }, to: where, t: 0, T: 0.7 }; sfx.boing();
}
function setMode(m) {
  st.mode = m; st.modeT = 0;
  const l = LINES[m]; say(Array.isArray(l) ? l[Math.floor(rand(0, l.length))] : l, m === 'sleep' ? 3 : 2);
  if (m === 'climb') jumpTo(st.at === 'head' ? 'shoulder' : 'head');
  if (m === 'replay' && haveFunny) sfx.giggle();
  if (m === 'replay' && !haveFunny) { st.mode = 'wave'; say('pull a funny face for me 🤪'); }
}

function armAnglesFrom(arm, shoulderAng) {
  if (!arm) return null;
  const inside = (p) => p.x > 4 && p.x < S.W - 4 && p.y > 4 && p.y < S.H - 4; // pose guesses joints off-frame; ignore those
  if (!inside(arm.el) || !inside(arm.wr)) return null;
  const a1 = Math.atan2(arm.el.x - arm.sh.x, arm.el.y - arm.sh.y), a2 = Math.atan2(arm.wr.x - arm.el.x, arm.wr.y - arm.el.y);
  return { up: a1 + shoulderAng, fa: a2 - a1 };
}

function update(dt, fresh) {
  const Fc = T.face, B = T.body;
  const grabbed = fresh && captureFace();
  if (grabbed) rollQ.push({ roll: Fc.roll, yaw: Fc.yaw, armR: armAnglesFrom(B.armR, B.ang || 0), armL: armAnglesFrom(B.armL, B.ang || 0), jaw: Fc.bs.jawOpen ?? 0 });
  while (rollQ.length > DELAY + 1) rollQ.shift();
  const late = rollQ[0];
  // colours from you, refreshed now and then
  st.colT = (st.colT || 0) - dt;
  if (st.colT < 0 && B.ok && Fc.ok) {
    st.colT = 1.2;
    const chest = { x: B.neck.x - B.up.x * 0.35 * B.sw, y: B.neck.y - B.up.y * 0.35 * B.sw };
    col.shirt.lerp(sampleColor(chest, 6), st.seen ? 0.3 : 1); shirtM.color.copy(col.shirt);
    col.hair.lerp(sampleColor({ x: Fc.top.x, y: Fc.top.y + Fc.h * 0.18 }, 3), st.seen ? 0.3 : 1);
    col.skin.lerp(sampleColor(Fc.L[50], 3), st.seen ? 0.3 : 1); skinM.color.copy(col.skin);
    if (!st.seen) { st.seen = true; mini.visible = true; say('hi… me?', 2.2); sfx.blip(); }
  }
  if (!st.seen) return;
  // which face to wear
  const show = st.mode === 'replay' && haveFunny ? funny : ringN > DELAY ? ring[(ringI) % ring.length] : grab;
  if (grabbed || st.mode === 'replay') paintFace(st.mode === 'sleep' && st.sleepFace ? st.sleepFace : show);
  // size from your shoulders
  if (B.ok) st.u = lerp(st.u, B.sw * 0.17, Math.min(1, dt * 3));
  // movement: sit on the anchor, or hop between anchors
  if (st.jump) {
    const j = st.jump; j.t += dt; const u = clamp(j.t / j.T, 0, 1), tg = (j.to === 'head' ? headTop() : seat()) || j.s;
    st.pos.x = lerp(j.s.x, tg.x, u); st.pos.y = lerp(j.s.y, tg.y, u) - Math.sin(Math.PI * u) * st.u * 3;
    st.spin = (j.to === 'head' ? -1 : 1) * Math.PI * 2 * clamp((u - 0.15) / 0.7, 0, 1);
    if (u >= 1) { st.at = j.to; st.jump = null; st.spin = 0; st.sqV -= 7; sfx.land(); puff(st.pos.x, st.pos.y, st.u * 0.8, 8); }
  } else {
    const a = anchor();
    if (a) { const k = Math.min(1, dt * 20); st.pos.x = lerp(st.pos.x, a.x, k); st.pos.y = lerp(st.pos.y, a.y, k); st.ang = angLerp(st.ang, (a.ang || 0) * 0.7, Math.min(1, dt * 8)); }
    else if (st.at === 'head' && seat()) jumpTo('shoulder');
  }
  // own-mind timer
  st.modeT += dt;
  if (st.mode === 'copy') { st.nextOwn -= dt; if (st.nextOwn < 0) { setMode(OWN[ownIdx++ % OWN.length]); st.nextOwn = rand(7, 11); } }
  else if (st.modeT > (st.mode === 'sleep' ? 4.5 : st.mode === 'climb' ? 5 : 3.6)) { if (st.mode === 'sleep') { say('huh? 😳'); sfx.blip(); } st.sleepFace = null; st.mode = 'copy'; st.modeT = 0; }
  if (st.mode === 'sleep' && !st.sleepFace) { st.sleepFace = mk(); st.sleepFace.getContext('2d').drawImage(grab, 0, 0); }
  // high five: your hand comes close to it
  if (B.ok) for (const arm of [B.armL, B.armR]) if (arm && dist(arm.wr, { x: st.pos.x, y: st.pos.y - st.u * 1.2 }) < st.u * 1.6 && st.hi5 <= 0) {
    st.hi5 = 1.2; sfx.clap(); burst(arm.wr.x, arm.wr.y, st.u * 0.8, 60); say('✋ yesss'); st.hi5Side = arm.wr.x < st.pos.x ? -1 : 1;
    if (st.mode === 'sleep') { st.mode = 'copy'; st.sleepFace = null; }
  }
  st.hi5 -= dt;
  // ---- pose the body ----
  const t = S.t, u = st.u;
  st.sqV += (-(st.sq - 1) * 220 - st.sqV * 14) * dt; st.sq += st.sqV * dt;
  let headRoll = late ? -late.roll : 0, headYaw = late ? late.yaw * 0.6 : 0, bodyBob = 0, lean = 0;
  const target = { R: late?.armR, L: late?.armL };
  const rest = (s) => ({ up: s * 0.25, fa: s * 0.15 });
  let aim = { R: target.R || rest(1), L: target.L || rest(-1) };
  // mini's screen-right arm is arms[1]; it copies your screen-right arm (mirror-image copying)
  if (st.mode === 'opposite') aim = { R: target.L ? { up: -target.L.up, fa: -target.L.fa } : rest(1), L: target.R ? { up: -target.R.up, fa: -target.R.fa } : rest(-1) };
  if (st.mode === 'wave' || st.hi5 > 0) { const s = st.hi5 > 0 ? st.hi5Side : 1, w = { up: s > 0 ? 2.7 : -2.7, fa: Math.sin(t * 14) * 0.5 }; if (s > 0) aim.R = w; else aim.L = w; headRoll += Math.sin(t * 3) * 0.12; }
  if (st.mode === 'dance' || (st.mode === 'replay')) { aim.R = { up: 2.3 + Math.sin(t * 9) * 0.5, fa: Math.sin(t * 9 + 1) * 0.6 }; aim.L = { up: -2.3 - Math.sin(t * 9 + Math.PI) * 0.5, fa: Math.sin(t * 9) * 0.6 }; bodyBob = Math.abs(Math.sin(t * 9)) * 0.12; headRoll += Math.sin(t * 9) * 0.2; }
  if (st.mode === 'sleep') { aim = { R: rest(1), L: rest(-1) }; headRoll = 0.45 + Math.sin(t * 1.2) * 0.05; lean = 0.08; bodyBob = Math.sin(t * 1.6) * 0.015; st.zzz -= dt; if (st.zzz < 0) { st.zzz = 1.2; sfx.snore(); } }
  if (st.jump) { aim.R = { up: 2.6, fa: 0.3 }; aim.L = { up: -2.6, fa: -0.3 }; }
  for (const a of arms) { const g = a.s > 0 ? aim.R : aim.L; a.up = angLerp(a.up, g.up, Math.min(1, dt * 10)); a.fa = angLerp(a.fa, clamp(g.fa, -2.6, 2.6), Math.min(1, dt * 10)); a.sh.rotation.z = a.up; a.fo.rotation.z = a.fa; }
  for (const l of legs) { const sw = st.jump ? 0.6 : Math.sin(t * 3 + l.s * 1.4) * 0.35 * (st.mode === 'sleep' ? 0.2 : 1); l.sh.rotation.x = Math.PI / 2 - 0.1 + sw; }
  headG.rotation.z = lerp(headG.rotation.z, clamp(headRoll, -0.7, 0.7), Math.min(1, dt * 10));
  headG.rotation.y = lerp(headG.rotation.y, clamp(headYaw, -0.5, 0.5), Math.min(1, dt * 10));
  headG.rotation.x = lerp(headG.rotation.x, st.mode === 'sleep' ? 0.35 : 0, Math.min(1, dt * 4));
  bodyG.position.y = bodyBob; bodyG.rotation.z = lean;
  // sitting on the shoulder: hips at the anchor, legs dangle toward the camera
  // close-ups: keep the whole little body in the frame
  const px = clamp(st.pos.x, u * 1.3, S.W - u * 1.3), py = clamp(st.pos.y, u * 2.9, S.H - u * 0.4);
  st.draw = { x: px, y: py };
  mini.position.set(px, S.H - py, 300); mini.rotation.set(0, 0, -st.ang + (st.spin || 0));
  mini.scale.set(u / Math.sqrt(st.sq), u * st.sq, u);
  // zzz
  if (st.mode === 'sleep' && Math.random() < dt * 1.5) { const p = { x: st.pos.x + u * 0.6, y: st.pos.y - u * 2.1 }; burst(p.x, p.y, u * 0.15, 3, 220); }
  drawBubbles(dt);
}

const app = {
  name: 'mini-me', need: { face: true, pose: true }, loading: 'Shrinking you…',
  start() { mini.visible = false; scene.add(mini); toast('Step back so your shoulders are in view', 3.5); window.__mini = { st, setMode, jumpTo }; },
  update,
  command(c) {
    if (c === 'head') jumpTo(st.at === 'head' ? 'shoulder' : 'head');
    else if (OWN.includes(c)) setMode(c);
  },
};
boot(app);
