// Sea: the life in the water, drawn with Canvas 2D into a layer that the renderer puts *into* the
// water (so caustics and the deep-water colour fall on it, and bubbles magnify it).
// - A little scuba diver with your face behind the glass of its mask (the camera, cropped to your
//   face). It wanders, kicks its fins, breathes out bubbles, and swims up close and waves when tapped.
// - A school of small silver fish (boids: keep apart, line up, stay together) that shimmers as it
//   turns, scatters from your fingers and hands, gets carried by the water you stir, and comes to look
//   when you blow bubbles.
// - A few reef fish, a glowing jellyfish that pulses its way up, and now and then a manta ray gliding
//   past in the deep.

const SCHOOL = 34;
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

const REEF = [
  { body: ['#ff8a2a', '#ff5a00'], belly: '#ffd0a0', stripes: '#ffffff', h: 0.52, len: 0.11 },   // clownfish
  { body: ['#2f6bff', '#1336b8'], belly: '#6aa0ff', stripes: null, tail: '#ffd23a', h: 0.62, len: 0.13 },   // blue tang
  { body: ['#ffe14a', '#f5b800'], belly: '#fff3a8', stripes: null, h: 0.78, len: 0.1 },        // yellow tang
];

export class Sea {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.W = 1;
    this.H = 1;
    this.time = 0;
    this.school = [];
    this.reef = [];
    this.jelly = null;
    this.manta = null;
    this.nextManta = 12;
    this.diver = null;
    this.schoolGoal = { x: 0, y: 0 };
  }

  get u() { return Math.min(this.W, this.H); }

  resize(W, H) {
    const first = this.W === 1;
    this.W = W;
    this.H = H;
    this.canvas.width = Math.max(1, Math.round(W));
    this.canvas.height = Math.max(1, Math.round(H));
    if (first) this.populate();
  }

  populate() {
    const { W, H, u } = this;
    const cx = W * 0.6, cy = H * 0.45;
    for (let i = 0; i < SCHOOL; i++) {
      const a = rand(0, TAU);
      this.school.push({ x: cx + rand(-1, 1) * u * 0.12, y: cy + rand(-1, 1) * u * 0.08, vx: Math.cos(a) * u * 0.1, vy: Math.sin(a) * u * 0.05, phase: rand(0, TAU), size: rand(0.85, 1.15) });
    }
    for (const kind of REEF) {
      this.reef.push({ kind, x: rand(0.1, 0.9) * W, y: rand(0.3, 0.85) * H, vx: 0, vy: 0, tx: rand(0.1, 0.9) * W, ty: rand(0.3, 0.85) * H, phase: rand(0, TAU), flee: 0 });
    }
    this.jelly = this.makeJelly();
    this.diver = { x: W * 0.3, y: H * 0.55, vx: 0, vy: 0, dir: 1, tx: W * 0.7, ty: H * 0.5, phase: 0, close: 0, closeT: 0, closeAmt: 0, nextBreath: 2, wave: 0, spin: 0 };
  }

  makeJelly() {
    const { W, H, u } = this;
    const x = rand(0.15, 0.85) * W, y = H + u * 0.1;
    const tentacles = [];
    for (let k = 0; k < 7; k++) {
      const pts = [];
      for (let i = 0; i < 12; i++) pts.push({ x, y: y + i * u * 0.02, px: x, py: y + i * u * 0.02 });
      tentacles.push(pts);
    }
    return { x, y, vx: 0, vy: -u * 0.05, phase: rand(0, TAU), size: u * rand(0.07, 0.1), tentacles, hue: rand(280, 330) };
  }

  /** True when (x, y) is on the diver (for taps). */
  hitDiver(x, y) {
    const d = this.diver;
    if (!d) return false;
    const s = this.diverSize();
    return Math.hypot(x - d.x, y - d.y) < s * 0.55;
  }

  /** Tapped: swim up close to the glass, wave, and blow a burst of bubbles. */
  callDiver(world) {
    const d = this.diver;
    d.close = 1;
    d.closeT = 4.5;
    d.wave = 4.5;
    d.spin = 1;
    this.diverBreath(world, 10);
  }

  diverSize() { return this.u * 0.34 * (1 + this.diver.closeAmt * 1.3); }

  diverBreath(world, n) {
    const d = this.diver;
    const s = this.diverSize();
    const mx = d.x + d.dir * s * 0.36, my = d.y - s * 0.08;
    for (let i = 0; i < n; i++) {
      const b = world.add(mx + rand(-3, 3), my + rand(-3, 3), rand(-0.05, 0.05) * this.u, -this.u * rand(0.1, 0.25),
        this.u * 0.004, this.u * rand(0.008, 0.022), { age: 0.5 });
      if (b && i === 0) world.events.blub(0.2);
    }
  }

  /**
   * env: { fluid, touches: [{x, y}], hands: [{x, y, vx, vy}], mouth, blowing, world }
   */
  update(dt, env) {
    const { W, H, u } = this;
    if (!this.diver) return;
    this.time += dt;
    const t = this.time;
    const threats = [...env.touches, ...env.hands];

    // School: boids.
    const g = this.schoolGoal;
    if (env.blowing && env.mouth) { g.x = env.mouth.x; g.y = env.mouth.y + u * 0.08; }
    else { g.x = W * (0.5 + 0.32 * Math.sin(t * 0.07)); g.y = H * (0.5 + 0.25 * Math.sin(t * 0.11 + 1)); }
    const fish = this.school;
    const near = u * 0.05, view = u * 0.16;
    for (const f of fish) {
      let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0;
      for (const o of fish) {
        if (o === f) continue;
        const dx = o.x - f.x, dy = o.y - f.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > view * view) continue;
        n++;
        ax += o.vx; ay += o.vy; cx += o.x; cy += o.y;
        if (d2 < near * near) { const d = Math.sqrt(d2) || 1; sx -= dx / d * (near - d); sy -= dy / d * (near - d); }
      }
      let fx = 0, fy = 0;
      if (n) {
        fx += (ax / n - f.vx) * 1.2 + (cx / n - f.x) * 0.8 + sx * 6;
        fy += (ay / n - f.vy) * 1.2 + (cy / n - f.y) * 0.8 + sy * 6;
      }
      fx += (g.x - f.x) * 0.25;
      fy += (g.y - f.y) * 0.25;
      for (const p of threats) {
        const dx = f.x - p.x, dy = f.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const R = u * 0.25;
        if (d < R) { const k = (1 - d / R) * u * 14; fx += dx / d * k; fy += dy / d * k; }
      }
      const m = u * 0.08;
      if (f.x < m) fx += (m - f.x) * 4; if (f.x > W - m) fx -= (f.x - W + m) * 4;
      if (f.y < m * 1.5) fy += (m * 1.5 - f.y) * 4; if (f.y > H - m * 2) fy -= (f.y - H + m * 2) * 4;
      f.vx += fx * dt; f.vy += fy * dt;
      const sp = Math.hypot(f.vx, f.vy) || 1;
      const lo = u * 0.12, hi = u * 0.75;
      const k = sp < lo ? lo / sp : sp > hi ? hi / sp : 1;
      f.vx *= k; f.vy *= k;
      const w = env.fluid.sample(f.x, f.y);
      f.x += (f.vx + w.vx * 0.8) * dt;
      f.y += (f.vy + w.vy * 0.8) * dt;
      f.phase += dt * (8 + sp / u * 20);
    }

    // Reef fish: wander between spots, dart away from fingers.
    for (const r of this.reef) {
      if (Math.hypot(r.tx - r.x, r.ty - r.y) < u * 0.05 || Math.random() < dt * 0.05) {
        r.tx = rand(0.08, 0.92) * W; r.ty = rand(0.25, 0.9) * H;
      }
      let fx = (r.tx - r.x), fy = (r.ty - r.y);
      const d0 = Math.hypot(fx, fy) || 1;
      fx = fx / d0 * u * 0.12; fy = fy / d0 * u * 0.12;
      for (const p of threats) {
        const dx = r.x - p.x, dy = r.y - p.y, d = Math.hypot(dx, dy) || 1;
        if (d < u * 0.22) { fx = dx / d * u * 0.9; fy = dy / d * u * 0.9; r.flee = 1; r.tx = r.x + dx / d * u * 0.5; r.ty = r.y + dy / d * u * 0.3; }
      }
      r.vx += (fx - r.vx) * Math.min(1, dt * (r.flee > 0.1 ? 6 : 1.2));
      r.vy += (fy - r.vy) * Math.min(1, dt * (r.flee > 0.1 ? 6 : 1.2));
      r.flee *= Math.exp(-dt * 2);
      const w = env.fluid.sample(r.x, r.y);
      r.x += (r.vx + w.vx * 0.6) * dt;
      r.y += (r.vy + w.vy * 0.6) * dt;
      r.x = Math.min(W + u * 0.1, Math.max(-u * 0.1, r.x));
      r.y = Math.min(H, Math.max(u * 0.05, r.y));
      r.phase += dt * (6 + Math.hypot(r.vx, r.vy) / u * 25);
    }

    // Jellyfish: pulse (squeeze → push up), drift with the water, trail its tentacles.
    const j = this.jelly;
    const before = Math.sin(j.phase);
    j.phase += dt * 1.6;
    if (before < 0 && Math.sin(j.phase) >= 0) j.vy -= u * 0.12;      // the squeeze
    j.vy += u * 0.03 * dt;
    j.vx *= Math.exp(-0.5 * dt); j.vy *= Math.exp(-0.5 * dt);
    const jw = env.fluid.sample(j.x, j.y);
    j.x += (j.vx + jw.vx * 0.9) * dt + Math.sin(t * 0.3) * u * 0.01 * dt;
    j.y += (j.vy + jw.vy * 0.9) * dt;
    for (const p of threats) {
      const dx = j.x - p.x, dy = j.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < u * 0.2) { j.vx += dx / d * u * 0.6 * dt; j.vy += dy / d * u * 0.6 * dt; }
    }
    if (j.y < -u * 0.3 || j.x < -u * 0.3 || j.x > W + u * 0.3) this.jelly = this.makeJelly();
    for (let k = 0; k < j.tentacles.length; k++) {
      const pts = j.tentacles[k];
      const spread = (k / (j.tentacles.length - 1) - 0.5) * j.size * 1.3;
      pts[0].x = j.x + spread; pts[0].y = j.y + j.size * 0.15;
      const seg = j.size * 0.22;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.94, vy = (p.y - p.py) * 0.94;
        p.px = p.x; p.py = p.y;
        p.x += vx + Math.sin(t * 2 + i * 0.6 + k) * 0.15; p.y += vy + u * 0.002;
        const q = pts[i - 1];
        const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1;
        p.x = q.x + dx / d * seg; p.y = q.y + dy / d * seg;
      }
    }

    // Manta: now and then glides across far away.
    this.nextManta -= dt;
    if (!this.manta && this.nextManta <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.manta = { x: dir > 0 ? -u * 0.6 : W + u * 0.6, y: H * rand(0.55, 0.85), dir, phase: 0, span: u * rand(0.7, 0.95) };
    }
    if (this.manta) {
      const mt = this.manta;
      mt.x += mt.dir * u * 0.07 * dt;
      mt.y -= u * 0.012 * dt;
      mt.phase += dt * 1.1;
      if (mt.x < -u * 0.8 || mt.x > W + u * 0.8) { this.manta = null; this.nextManta = rand(25, 45); }
    }

    // Diver.
    const d = this.diver;
    d.closeT -= dt;
    if (d.closeT <= 0) d.close = 0;
    d.closeAmt += (d.close - d.closeAmt) * Math.min(1, dt * 2.2);
    d.wave = Math.max(0, d.wave - dt);
    d.spin = Math.max(0, d.spin - dt * 0.8);
    if (d.close) { d.tx = W * 0.5; d.ty = H * 0.42; }
    else if (Math.hypot(d.tx - d.x, d.ty - d.y) < u * 0.08) { d.tx = rand(0.15, 0.85) * W; d.ty = rand(0.25, 0.8) * H; }
    const dx = d.tx - d.x, dy = d.ty - d.y, dd = Math.hypot(dx, dy) || 1;
    const speed = u * (d.close ? 0.35 : 0.09);
    d.vx += (dx / dd * speed * Math.min(1, dd / (u * 0.1)) - d.vx) * Math.min(1, dt * 1.5);
    d.vy += (dy / dd * speed * Math.min(1, dd / (u * 0.1)) - d.vy) * Math.min(1, dt * 1.5);
    const dw = env.fluid.sample(d.x, d.y);
    d.x += (d.vx + dw.vx * 0.5) * dt;
    d.y += (d.vy + dw.vy * 0.5) * dt + Math.sin(t * 1.3) * u * 0.01 * dt;
    if (Math.abs(d.vx) > u * 0.02) d.dir += ((d.vx > 0 ? 1 : -1) - d.dir) * Math.min(1, dt * 3);
    d.phase += dt * (3 + Math.hypot(d.vx, d.vy) / u * 18);
    d.nextBreath -= dt;
    if (d.nextBreath <= 0 && env.world) { this.diverBreath(env.world, 6); d.nextBreath = rand(3, 4.5); }
  }

  // ---------- Drawing ----------

  /** Draw everything into the layer; `face` = { element, box, mirrored } for the diver's mask. */
  draw(face) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.diver) return;
    if (this.manta) this.drawManta(ctx, this.manta);
    this.drawJelly(ctx, this.jelly);
    for (const f of this.school) this.drawSilver(ctx, f);
    for (const r of this.reef) this.drawReef(ctx, r);
    this.drawDiver(ctx, this.diver, face);
  }

  drawManta(ctx, m) {
    const s = m.span;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.scale(m.dir, 1);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#0a2032';
    const flap = Math.sin(m.phase) * s * 0.12;
    ctx.beginPath();
    ctx.moveTo(s * 0.18, 0);
    ctx.bezierCurveTo(s * 0.1, -s * 0.05 - flap * 0.3, s * 0.0, -s * 0.2 - flap, -s * 0.12, -s * 0.5 - flap);
    ctx.bezierCurveTo(-s * 0.15, -s * 0.25 - flap, -s * 0.22, -s * 0.06, -s * 0.3, 0);
    ctx.bezierCurveTo(-s * 0.22, s * 0.06, -s * 0.15, s * 0.25 + flap, -s * 0.12, s * 0.5 + flap);
    ctx.bezierCurveTo(s * 0.0, s * 0.2 + flap, s * 0.1, s * 0.05 + flap * 0.3, s * 0.18, 0);
    ctx.fill();
    ctx.lineWidth = s * 0.008;
    ctx.strokeStyle = '#0a2032';
    ctx.beginPath();
    ctx.moveTo(-s * 0.28, 0);
    ctx.quadraticCurveTo(-s * 0.45, Math.sin(m.phase * 1.3) * s * 0.03, -s * 0.6, 0);
    ctx.stroke();
    ctx.restore();
  }

  drawJelly(ctx, j) {
    const s = j.size;
    const pulse = Math.sin(j.phase);
    const wBell = s * (1 - 0.14 * pulse), hBell = s * 0.75 * (1 + 0.12 * pulse);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const pts of j.tentacles) {
      ctx.strokeStyle = `hsla(${j.hue}, 90%, 75%, 0.35)`;
      ctx.lineWidth = Math.max(1, s * 0.03);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    const glow = ctx.createRadialGradient(j.x, j.y, 0, j.x, j.y, s * 2);
    glow.addColorStop(0, `hsla(${j.hue}, 100%, 70%, 0.35)`);
    glow.addColorStop(1, `hsla(${j.hue}, 100%, 60%, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(j.x - s * 2, j.y - s * 2, s * 4, s * 4);
    const bell = ctx.createRadialGradient(j.x, j.y - hBell * 0.3, s * 0.1, j.x, j.y, wBell);
    bell.addColorStop(0, `hsla(${j.hue}, 100%, 92%, 0.75)`);
    bell.addColorStop(0.7, `hsla(${j.hue}, 90%, 70%, 0.4)`);
    bell.addColorStop(1, `hsla(${j.hue}, 90%, 60%, 0.15)`);
    ctx.fillStyle = bell;
    ctx.beginPath();
    ctx.moveTo(j.x - wBell, j.y);
    ctx.bezierCurveTo(j.x - wBell, j.y - hBell * 1.3, j.x + wBell, j.y - hBell * 1.3, j.x + wBell, j.y);
    for (let i = 6; i >= 0; i--) {
      const x = j.x - wBell + (i / 6) * 2 * wBell;
      ctx.quadraticCurveTo(x + wBell / 6, j.y + s * 0.12, x, j.y);
    }
    ctx.fill();
    ctx.restore();
  }

  drawSilver(ctx, f) {
    const L = this.u * 0.035 * f.size;
    const a = Math.atan2(f.vy, f.vx);
    const shine = 0.55 + 0.45 * Math.sin(a * 2 + this.time * 0.8 + f.phase * 0.1);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(a);
    const wag = Math.sin(f.phase) * L * 0.12;
    ctx.fillStyle = `rgba(${150 + 100 * shine | 0}, ${175 + 75 * shine | 0}, ${190 + 65 * shine | 0}, 0.92)`;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.quadraticCurveTo(0, -L * 0.2, -L * 0.35, wag * 0.5);
    ctx.quadraticCurveTo(0, L * 0.2, L * 0.5, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-L * 0.3, wag * 0.5);
    ctx.lineTo(-L * 0.55, -L * 0.15 + wag);
    ctx.lineTo(-L * 0.55, L * 0.15 + wag);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(20, 40, 60, 0.6)';
    ctx.fillRect(-L * 0.25, -L * 0.02, L * 0.6, L * 0.03);
    ctx.restore();
  }

  drawReef(ctx, r) {
    const k = r.kind;
    const L = this.u * k.len, Hh = L * k.h;
    const a = Math.atan2(r.vy, r.vx);
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(a);
    if (Math.cos(a) < 0) ctx.scale(1, -1);
    const wag = Math.sin(r.phase) * 0.3;
    ctx.fillStyle = k.tail || k.body[1];
    ctx.beginPath();
    ctx.moveTo(-L * 0.38, 0);
    ctx.lineTo(-L * 0.62, -Hh * 0.5 + wag * Hh);
    ctx.quadraticCurveTo(-L * 0.52, wag * Hh * 0.6, -L * 0.62, Hh * 0.5 + wag * Hh);
    ctx.closePath();
    ctx.fill();
    const grad = ctx.createLinearGradient(0, -Hh / 2, 0, Hh / 2);
    grad.addColorStop(0, k.body[1]);
    grad.addColorStop(0.5, k.body[0]);
    grad.addColorStop(1, k.belly);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.bezierCurveTo(L * 0.4, -Hh * 0.62, -L * 0.2, -Hh * 0.62, -L * 0.42, 0);
    ctx.bezierCurveTo(-L * 0.2, Hh * 0.62, L * 0.4, Hh * 0.62, L * 0.5, 0);
    ctx.fill();
    if (k.stripes) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = k.stripes;
      for (const x of [0.22, -0.05, -0.3]) {
        ctx.beginPath();
        ctx.ellipse(L * x, 0, L * 0.05, Hh * 0.7, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(L * 0.08, -Hh * 0.2, L * 0.25, Hh * 0.08, -0.1, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(L * 0.3, -Hh * 0.08, Hh * 0.11, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(L * 0.32, -Hh * 0.08, Hh * 0.065, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawDiver(ctx, d, face) {
    const S = this.diverSize();
    const kick = Math.sin(d.phase);
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(Math.sin(this.time * 0.9) * 0.06 + (d.spin > 0 ? (1 - d.spin) * TAU : 0));   // a somersault when called
    ctx.scale(d.dir, 1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Legs and fins (behind), kicking in turn.
    for (const side of [-1, 1]) {
      const swing = kick * side * 0.35;
      const hipX = -S * 0.12, hipY = S * 0.06;
      const footX = hipX - S * 0.3, footY = hipY + Math.sin(swing) * S * 0.18 + side * S * 0.02;
      ctx.strokeStyle = side < 0 ? '#16243a' : '#1d2f4a';
      ctx.lineWidth = S * 0.1;
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.quadraticCurveTo(hipX - S * 0.15, hipY + Math.sin(swing) * S * 0.05, footX, footY); ctx.stroke();
      ctx.fillStyle = side < 0 ? '#e0b400' : '#ffd400';
      ctx.beginPath();
      ctx.moveTo(footX, footY - S * 0.05);
      ctx.quadraticCurveTo(footX - S * 0.18, footY - S * 0.1 + swing * S * 0.2, footX - S * 0.28, footY - S * 0.06 + swing * S * 0.35);
      ctx.lineTo(footX - S * 0.28, footY + S * 0.06 + swing * S * 0.35);
      ctx.quadraticCurveTo(footX - S * 0.18, footY + S * 0.1 + swing * S * 0.2, footX, footY + S * 0.05);
      ctx.closePath();
      ctx.fill();
    }

    // Tank on the back.
    ctx.fillStyle = '#f2c200';
    roundRect(ctx, -S * 0.2, -S * 0.2, S * 0.34, S * 0.11, S * 0.05);
    ctx.fill();
    ctx.fillStyle = '#9aa4ad';
    ctx.fillRect(S * 0.12, -S * 0.185, S * 0.04, S * 0.08);

    // Body (wetsuit) with a yellow stripe.
    ctx.fillStyle = '#1b2c45';
    roundRect(ctx, -S * 0.2, -S * 0.1, S * 0.36, S * 0.22, S * 0.1);
    ctx.fill();
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(-S * 0.18, S * 0.0, S * 0.32, S * 0.025);

    // Arm: tucked, or waving when called.
    const waving = d.wave > 0;
    const armA = waving ? -1.2 + Math.sin(this.time * 9) * 0.5 : 0.5 + kick * 0.1;
    ctx.strokeStyle = '#1b2c45';
    ctx.lineWidth = S * 0.075;
    ctx.beginPath();
    ctx.moveTo(S * 0.08, S * 0.0);
    const ex = S * 0.08 + Math.cos(armA) * S * 0.22, ey = Math.sin(armA) * S * 0.22;
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = '#16243a';
    ctx.beginPath(); ctx.arc(ex, ey, S * 0.045, 0, TAU); ctx.fill();

    // Head: hood, mask with your face behind the glass, regulator.
    const hx = S * 0.25, hy = -S * 0.06, hr = S * 0.17;
    ctx.fillStyle = '#16243a';
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
    const mx = hx + hr * 0.25, my = hy - hr * 0.05, mrx = hr * 0.78, mry = hr * 0.72;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(mx, my, mrx, mry, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = '#7fb8d0';
    ctx.fillRect(mx - mrx, my - mry, mrx * 2, mry * 2);
    if (face && face.element) drawFace(ctx, face, mx, my, mrx, mry, d.dir);
    const tint = ctx.createLinearGradient(mx, my - mry, mx, my + mry);
    tint.addColorStop(0, 'rgba(120, 200, 255, 0.25)');
    tint.addColorStop(1, 'rgba(0, 60, 100, 0.25)');
    ctx.fillStyle = tint;
    ctx.fillRect(mx - mrx, my - mry, mrx * 2, mry * 2);
    ctx.restore();
    ctx.strokeStyle = '#0d0f12';
    ctx.lineWidth = S * 0.035;
    ctx.beginPath(); ctx.ellipse(mx, my, mrx, mry, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = S * 0.014;
    ctx.beginPath(); ctx.ellipse(mx, my, mrx * 0.82, mry * 0.82, 0, -2.6, -1.7); ctx.stroke();
    ctx.fillStyle = '#ffd400';
    ctx.beginPath(); ctx.arc(mx + mrx * 0.35, my + mry * 1.05, S * 0.035, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a2f36';
    ctx.lineWidth = S * 0.02;
    ctx.beginPath(); ctx.moveTo(mx + mrx * 0.35, my + mry * 1.05); ctx.quadraticCurveTo(hx - hr * 0.6, hy + hr * 1.5, -S * 0.05, -S * 0.15); ctx.stroke();
    ctx.restore();
  }
}

/** Your face from the camera, cropped and filling the mask's glass (un-flipped for the diver's facing). */
function drawFace(ctx, face, mx, my, rx, ry, dir) {
  const el = face.element;
  const vw = el.videoWidth || el.width, vh = el.videoHeight || el.height;
  if (!vw || !vh) return;
  let bx, by, bw, bh;
  if (face.box) {
    const b = face.box;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const side = Math.max((b.x1 - b.x0) * vw, (b.y1 - b.y0) * vh) * 1.05;
    bw = side; bh = side * ry / rx;
    bx = cx * vw - bw / 2; by = cy * vh - bh / 2;
  } else {
    bh = vh * 0.45; bw = bh * rx / ry;
    bx = (vw - bw) / 2; by = vh * 0.12;
  }
  ctx.save();
  ctx.translate(mx, my);
  ctx.scale((face.mirrored ? -1 : 1) * (dir < 0 ? -1 : 1), 1);
  ctx.drawImage(el, bx, by, bw, bh, -rx, -ry, rx * 2, ry * 2);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
