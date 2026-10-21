// Live try-on: draws the camera (or a photo) and the product on one canvas, every frame.
// The single canvas is what Snap and Record capture, so photos and clips look exactly like the screen.
//
// Glasses: two halves, each warped from its hinge to the bridge, so the far half narrows as the head turns.
//          The near temple arm fades in as the head turns; the far one stays hidden behind the head.
// Caps and hats: brim line set just below the top of the forehead, tilted with the head.
// Earrings: hang from the lobes with gravity and a damped swing; the far one hides behind the head.
// Watches and bracelets: follow the forearm from the wrist; the strap fades where it wraps round.

import { tracker, detect } from './tracker.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mid = (a, b) => lerp(a, b, 0.5);
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Face-mesh indices for the lip band (outer ring minus inner ring = the lips, not the teeth).
const OUTER_LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const INNER_LIPS = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
function hexToRgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

/** Affine transform taking three source points onto three destination points: [a, b, c, d, e, f]. */
function affine(s, d) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const ux = [(d[1][0] - d[0][0]), (d[2][0] - d[0][0])];
  const uy = [(d[1][1] - d[0][1]), (d[2][1] - d[0][1])];
  const a = (ux[0] * (y2 - y0) - ux[1] * (y1 - y0)) / det;
  const c = (ux[1] * (x1 - x0) - ux[0] * (x2 - x0)) / det;
  const b = (uy[0] * (y2 - y0) - uy[1] * (y1 - y0)) / det;
  const dd = (uy[1] * (x1 - x0) - uy[0] * (x2 - x0)) / det;
  return [a, b, c, dd, d[0][0] - a * x0 - c * y0, d[0][1] - b * x0 - dd * y0];
}

/** Velocity-adaptive smoothing: steady when still, quick when moving (no lag on a head turn). */
class Smoother {
  constructor() { this.v = new Map(); }
  get(key, p, scale) {
    const old = this.v.get(key);
    if (!old) { this.v.set(key, p); return p; }
    const speed = len(sub(p, old)) / Math.max(1, scale);
    const k = Math.min(0.92, Math.max(0.28, speed * 9));
    const out = lerp(old, p, k);
    this.v.set(key, out);
    return out;
  }
  num(key, x) {
    const old = this.v.get(key);
    const out = old === undefined ? x : old + (x - old) * 0.35;
    this.v.set(key, out);
    return out;
  }
  reset() { this.v.clear(); }
}

const DEBUG = new URLSearchParams(location.search).has('debug');

export class Stage {
  dots(points, colors) {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    points.forEach((p, i) => { ctx.fillStyle = colors[i]; ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 7); ctx.fill(); });
    ctx.restore();
  }

  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.source = null;
    this.mirrored = true;
    this.product = null;
    this.size = 1;
    this.lift = 0;
    this.smooth = new Smoother();
    this.swing = [{ a: 0, w: 0, prev: null, prev2: null }, { a: 0, w: 0, prev: null, prev2: null }];
    this.lastSeen = 0;
    this.onStatus = () => {};
    this.status = '';
    this.running = false;
    this.busy = false;
    this.cached = null;           // landmarks for a still photo
    this.makeup = null;           // { lips: colour|null, cheeks: colour|null } when makeup mode is on
  }

  setSource(el, mirrored) {
    this.source = el;
    this.mirrored = mirrored;
    this.cached = null;
    this.smooth.reset();
  }

  setProduct(cut) {
    this.product = cut;
    this.cached = null;
    this.smooth.reset();
    if (cut) tracker(cut.kind === 'wrist' ? 'pose' : 'face').catch(() => this.say('Tracking could not start in this browser.'));
  }

  say(text) {
    if (text !== this.status) { this.status = text; this.onStatus(text); }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.frame().catch((e) => console.error(e));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() { this.running = false; }

  fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  sourceSize() {
    const s = this.source;
    if (!s) return null;
    const w = s.videoWidth || s.naturalWidth || s.width, h = s.videoHeight || s.naturalHeight || s.height;
    return w && h ? [w, h] : null;
  }

  /**
   * Measure the user's face or hand once from the current source. Returns metrics normalised by the
   * frame diagonal (resolution-independent), plus a distance-invariant `ratio`, or null if not found.
   * Used by the one-time "Fit to me" onboarding so items are scaled to the user's real proportions.
   */
  async measure(kind) {
    const size = this.sourceSize();
    if (!size) return null;
    const [sw, sh] = size;
    const name = kind === 'hand' ? 'hand' : 'face';
    let task;
    try { task = await tracker(name); } catch { return null; }
    let marks = null;
    try { marks = detect(task, name, this.source); } catch { marks = null; }
    if (!marks) return null;
    const Q = (i) => [marks[i].x * sw, marks[i].y * sh];
    const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ref = Math.hypot(sw, sh) || 1;
    if (name === 'hand') {
      const wristW = D(Q(5), Q(17)), handLen = D(Q(0), Q(9));
      if (!(wristW > 0 && handLen > 0)) return null;
      return { kind: 'hand', wristW: wristW / ref, handLen: handLen / ref, ratio: wristW / handLen };
    }
    const faceW = D(Q(234), Q(454)), faceH = D(Q(10), Q(152));
    const eyeDist = D(mid(Q(33), Q(133)), mid(Q(362), Q(263)));
    if (!(faceW > 0 && eyeDist > 0)) return null;
    return { kind: 'face', faceW: faceW / ref, faceH: faceH / ref, eyeDist: eyeDist / ref, ratio: eyeDist / faceW };
  }

  async frame() {
    this.fit();
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, W, H);
    const size = this.sourceSize();
    if (!size) return;
    const [sw, sh] = size;
    const k = Math.max(W / sw, H / sh);
    const ox = (W - sw * k) / 2, oy = (H - sh * k) / 2;
    ctx.save();
    if (this.mirrored) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(this.source, ox, oy, sw * k, sh * k);
    ctx.restore();

    // Makeup mode: tint the lips / cheeks on the live face, independent of any product.
    if (this.makeup && (this.makeup.lips || this.makeup.cheeks)) {
      let task;
      try { task = await tracker('face'); } catch { return; }
      let marks = null;
      if (!this.busy) { this.busy = true; try { marks = detect(task, 'face', this.source); } catch { marks = null; } this.busy = false; }
      if (marks) {
        this.lastSeen = performance.now();
        this.say('');
        const P = (i) => { const mk = marks[i]; const x = ox + mk.x * sw * k, y = oy + mk.y * sh * k; return [this.mirrored ? W - x : x, y]; };
        this.drawMakeup(P);
      } else if (performance.now() - this.lastSeen > 600) {
        this.say('Look at the camera so it can find your face.');
      }
      return;
    }

    const cut = this.product;
    if (!cut) return;
    const name = cut.kind === 'wrist' ? 'pose' : 'face';
    let task;
    try { task = await tracker(name); } catch { return; }
    let marks = null;
    const still = !this.source.videoWidth;
    if (still && this.cached && this.cached.name === name) marks = this.cached.marks;
    else if (!this.busy) {
      this.busy = true;
      try { marks = detect(task, name, this.source); } catch { marks = null; }
      this.busy = false;
      if (still) this.cached = { name, marks };
    }
    const now = performance.now();
    if (!marks) {
      if (now - this.lastSeen > 600) {
        this.say(name === 'pose' ? 'Hold your arm up so the camera can see your forearm and elbow.' : 'Look at the camera so it can find your face.');
        this.smooth.reset();
      }
      return;
    }
    this.lastSeen = now;
    this.say('');
    const P = (i) => {
      const m = marks[i];
      const x = ox + m.x * sw * k, y = oy + m.y * sh * k;
      return [this.mirrored ? W - x : x, y];
    };
    if (cut.kind === 'glasses') this.drawGlasses(P, cut);
    else if (cut.kind === 'headwear') this.drawHeadwear(P, cut);
    else if (cut.kind === 'earrings') this.drawEarrings(P, cut);
    else this.drawWrist(P, cut, marks);
  }

  /** Shared face frame: eye line, up vector, face width/height, yaw (+ = far side is screen-left). */
  face(P) {
    const s = this.smooth;
    const a = P(234), b = P(454);
    const [fL, fR] = a[0] < b[0] ? [a, b] : [b, a];
    const faceW0 = len(sub(fR, fL));
    const S = (key, p) => s.get(key, p, faceW0);
    const e1 = mid(P(33), P(133)), e2 = mid(P(362), P(263));
    const [eL, eR] = e1[0] < e2[0] ? [e1, e2] : [e2, e1];
    const out = {
      fL: S('fL', fL), fR: S('fR', fR), eL: S('eL', eL), eR: S('eR', eR),
      top: S('top', P(10)), chin: S('chin', P(152)), nose: S('nose', P(1)), bridge: S('bridge', P(168)),
    };
    out.u = norm(sub(out.eR, out.eL));
    out.up = [out.u[1], -out.u[0]];
    out.faceW = len(sub(out.fR, out.fL));
    out.faceH = len(sub(out.chin, out.top));
    const r = dot(sub(out.nose, out.fL), out.u) / Math.max(1, dot(sub(out.fR, out.fL), out.u));
    out.yaw = s.num('yaw', (0.5 - r) * 2);
    out.roll = Math.atan2(out.u[1], out.u[0]);
    return out;
  }

  drawGlasses(P, cut) {
    const { ctx } = this;
    const f = this.face(P);
    const a = cut.anchors, pt = a.points;
    const onLine = (p) => add(f.eL, mul(f.u, dot(sub(p, f.eL), f.u)));
    const t1 = P(127), t2 = P(356);
    const [tL, tR] = t1[0] < t2[0] ? [t1, t2] : [t2, t1];
    const lift = mul(f.up, this.lift * f.faceW * 0.12);
    const SB = add(onLine(f.bridge), lift);
    let SL = add(onLine(this.smooth.get('tL', tL, f.faceW)), lift);
    let SR = add(onLine(this.smooth.get('tR', tR, f.faceW)), lift);
    const grow = this.size * 1.04;
    SL = add(SB, mul(sub(SL, SB), grow));
    SR = add(SB, mul(sub(SR, SB), grow));
    const sv = (len(sub(SR, SL)) / (pt.right[0] - pt.left[0])) * (1 - 0.15 * Math.abs(f.yaw));
    const upPt = (p) => [p[0], p[1] - 100];
    const halves = [
      { m: affine([pt.bridge, pt.left, upPt(pt.bridge)], [SB, SL, add(SB, mul(f.up, 100 * sv))]), clip: [0, 0, pt.bridge[0] + 0.75, cut.h] },
      { m: affine([pt.bridge, pt.right, upPt(pt.bridge)], [SB, SR, add(SB, mul(f.up, 100 * sv))]), clip: [pt.bridge[0] - 0.75, 0, cut.w, cut.h] },
    ];
    // Contact shadow on the face
    const drop = mul(f.up, -f.faceW * 0.03);
    ctx.save();
    ctx.globalAlpha = 0.22;
    for (const h of halves) {
      ctx.save();
      ctx.setTransform(h.m[0], h.m[1], h.m[2], h.m[3], h.m[4] + drop[0], h.m[5] + drop[1]);
      ctx.beginPath(); ctx.rect(...h.clip); ctx.clip();
      ctx.drawImage(cut.shadow, -cut.shadow.offset, -cut.shadow.offset);
      ctx.restore();
    }
    ctx.restore();
    // Near temple arm, from the hinge back to the ear, fading in as the head turns
    const nearLeft = f.yaw < 0;            // nose turned toward the right: the left side faces the camera
    const armAlpha = smoothstep(0.1, 0.32, Math.abs(f.yaw));
    if (armAlpha > 0.01) {
      const h = nearLeft ? halves[0] : halves[1];
      const hp = nearLeft ? pt.hingeL : pt.hingeR;
      const hinge = [h.m[0] * hp[0] + h.m[2] * hp[1] + h.m[4], h.m[1] * hp[0] + h.m[3] * hp[1] + h.m[5]];
      const edge = nearLeft ? f.fL : f.fR;
      const ear = add(add(onLine(edge), mul(f.up, f.faceW * 0.03)), mul(f.u, (nearLeft ? -1 : 1) * f.faceW * 0.04));
      const thick = Math.max(2.5, a.frameHeight * sv * 0.1);
      const dir = norm(sub(ear, hinge)), n = [-dir[1], dir[0]];
      ctx.save();
      ctx.globalAlpha = armAlpha;
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.moveTo(...add(hinge, mul(n, thick / 2)));
      ctx.lineTo(...add(ear, mul(n, thick * 0.32)));
      ctx.lineTo(...sub(ear, mul(n, thick * 0.32)));
      ctx.lineTo(...sub(hinge, mul(n, thick / 2)));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = armAlpha * 0.35;    // a thin highlight along the top edge
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(0.6, thick * 0.12);
      ctx.beginPath();
      ctx.moveTo(...add(hinge, mul(n, -thick * 0.3)));
      ctx.lineTo(...add(ear, mul(n, -thick * 0.2)));
      ctx.stroke();
      ctx.restore();
    }
    // The frame front
    for (const h of halves) {
      ctx.save();
      ctx.setTransform(...h.m);
      ctx.beginPath(); ctx.rect(...h.clip); ctx.clip();
      ctx.drawImage(cut.sprite, 0, 0);
      ctx.restore();
    }
    if (DEBUG) this.dots([f.eL, f.eR, SB, SL, SR, f.fL, f.fR, f.nose], ['#0f0', '#0f0', '#f0f', '#ff0', '#ff0', '#0ff', '#0ff', '#f00']);
  }

  drawHeadwear(P, cut) {
    const { ctx } = this;
    const f = this.face(P);
    const a = cut.anchors, pt = a.points;
    const itemW = a.box[2] - a.box[0];
    const width = f.faceW * (a.wide ? 1.95 : 1.42) * this.size * (1 - 0.15 * Math.abs(f.yaw));
    const scale = width / itemW;
    // The brim line sits about halfway between the top of the forehead and the eyebrows
    const brow = mid(P(105), P(334));
    const base = lerp(f.top, this.smooth.get('brow', brow, f.faceW), a.wide ? 0.32 : 0.42);
    const target = add(add(base, mul(f.up, this.lift * f.faceW * 0.15)), mul(f.u, -f.yaw * f.faceW * 0.08));
    const cos = Math.cos(f.roll), sin = Math.sin(f.roll);
    const m = [cos * scale, sin * scale, -sin * scale, cos * scale];
    const e = target[0] - (m[0] * pt.base[0] + m[2] * pt.base[1]);
    const g = target[1] - (m[1] * pt.base[0] + m[3] * pt.base[1]);
    const drop = mul(f.up, -f.faceW * 0.05);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.setTransform(m[0], m[1], m[2], m[3], e + drop[0], g + drop[1]);
    ctx.drawImage(cut.shadow, -cut.shadow.offset, -cut.shadow.offset);
    ctx.restore();
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], e, g);
    ctx.drawImage(cut.sprite, 0, 0);
    ctx.restore();
  }

  drawEarrings(P, cut) {
    const { ctx } = this;
    const f = this.face(P);
    const sides = [[234, 132], [454, 361]].map(([edge, jaw]) => [P(edge), P(jaw)]).sort((p, q) => p[0][0] - q[0][0]);
    const dt = 1 / 60;
    sides.forEach(([edge, jaw], s) => {
      const outward = s === 0 ? -1 : 1;
      let lobe = add(lerp(edge, jaw, 0.42), mul(f.u, outward * f.faceW * 0.015));
      lobe = add(lobe, mul(f.up, this.lift * f.faceH * 0.08));
      lobe = this.smooth.get('lobe' + s, lobe, f.faceW);
      // Far side hides behind the head as it turns
      const far = s === 0 ? f.yaw : -f.yaw;
      const alpha = 1 - smoothstep(0.12, 0.3, far);
      const piece = cut.pieces[Math.min(s, cut.pieces.length - 1)];
      if (!piece || alpha < 0.02) return;
      // Pendulum: gravity keeps it hanging down; head motion makes it swing
      const sw = this.swing[s];
      if (sw.prev && sw.prev2 && !piece.stud) {
        const acc = (lobe[0] - 2 * sw.prev[0] + sw.prev2[0]) / f.faceW;
        sw.w += (-26 * Math.sin(sw.a) - 3.2 * sw.w) * dt - acc * 9;
        sw.a = Math.max(-0.6, Math.min(0.6, sw.a + sw.w * dt));
      }
      sw.prev2 = sw.prev; sw.prev = lobe;
      const scale = (f.faceH * piece.share * this.size) / piece.length;
      const angle = piece.stud ? f.roll : sw.a + f.roll * 0.15;
      const mirror = cut.pieces.length === 1 && s === 1 ? -1 : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(lobe[0], lobe[1]);
      ctx.rotate(angle);
      ctx.scale(scale * mirror, scale);
      ctx.drawImage(piece.sprite, -piece.hook[0], -piece.hook[1]);
      ctx.restore();
    });
  }

  // Watches/bracelets ride the forearm. Pose gives the elbow and wrist, so the strap lines up with the
  // real forearm at any wrist angle (the hand tracker only saw the hand, which misaligned on a bent wrist).
  drawWrist(P, cut, marks) {
    const { ctx } = this;
    const sm = this.smooth;
    // Pick the more-visible arm (person's left = elbow 13 / wrist 15, right = 14 / 16).
    const vis = (i) => (marks && marks[i] && marks[i].visibility != null) ? marks[i].visibility : 0.5;
    const right = (vis(14) + vis(16)) >= (vis(13) + vis(15));
    const ei = right ? 14 : 13, wi = right ? 16 : 15;
    const scaleRef = len(sub(P(wi), P(ei))) || 1;
    const wrist = sm.get('w', P(wi), scaleRef);
    const elbow = sm.get('e', P(ei), scaleRef);
    const foreLen = len(sub(wrist, elbow)) || 1;
    const d = norm(sub(elbow, wrist));          // from the wrist down the forearm toward the elbow
    const a = cut.anchors;
    const c = add(wrist, mul(d, foreLen * ((a.isWatch ? 0.10 : 0.07) + this.lift * 0.18)));
    const spriteAxis = a.isWatch ? (a.axis ?? Math.PI / 2) : Math.PI / 2;   // watch: align its real strap axis
    const angle = Math.atan2(d[1], d[0]) - spriteAxis;
    const wristW = foreLen * 0.17;              // a wrist is roughly a sixth of the forearm length
    const sx = (wristW * (a.isWatch ? 1.0 : 1.22) * this.size) / a.span;
    const sy = a.isWatch ? sx : sx * 0.4;       // a bracelet is seen side-on round the wrist
    const pc = a.points.center;
    for (const pass of ['shadow', 'item']) {
      ctx.save();
      ctx.translate(c[0], c[1]);
      if (pass === 'shadow') { ctx.translate(-d[1] * wristW * 0.04, d[0] * wristW * 0.04); ctx.globalAlpha = 0.25; }
      ctx.rotate(angle);
      ctx.scale(sx, sy);
      if (pass === 'shadow') ctx.drawImage(cut.shadow, -pc[0] - cut.shadow.offset, -pc[1] - cut.shadow.offset);
      else ctx.drawImage(cut.sprite, -pc[0], -pc[1]);
      ctx.restore();
    }
  }

  // Tint lips (a band from the mesh) and cheeks (soft blush blobs) in the chosen colours.
  drawMakeup(P) {
    const { ctx } = this;
    const m = this.makeup;
    if (!m) return;
    if (m.lips) {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = m.lips;
      ctx.beginPath();
      OUTER_LIPS.forEach((i, k) => { const p = P(i); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      INNER_LIPS.forEach((i, k) => { const p = P(i); k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.fill('evenodd');
      ctx.restore();
    }
    if (m.cheeks) {
      const eyeD = len(sub(P(33), P(263))) || 60;
      for (const ci of [50, 280]) {
        const c = P(ci), r = eyeD * 0.3;
        const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], r);
        g.addColorStop(0, rgba(m.cheeks, 0.4));
        g.addColorStop(1, rgba(m.cheeks, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, 7); ctx.fill();
        ctx.restore();
      }
    }
  }
}
