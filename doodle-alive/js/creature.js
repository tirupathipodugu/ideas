// One living doodle. It wakes up on the paper, hops off, then wanders: it walks with its bottom half split
// into two stepping "legs", sways, climbs onto whatever is under it (the floor, your shoulders, your head),
// sometimes sneaks behind you, watches your face and hands with googly eyes, and can be grabbed and thrown.

const STRIPS = 14;
const LEG_START = 0.62;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class Creature {
  /**
   * @param sprite canvas with the cut-out drawing
   * @param eyes [{x, y, r}] in sprite pixels
   * @param rect where the drawing was on screen {x, y, w, h}
   * @param targetH height it settles at once it's walking around
   */
  constructor(sprite, eyes, rect, targetH) {
    this.sprite = sprite;
    this.eyes = eyes.map((e) => ({ ...e, px: 0, py: 0, vx: 0, vy: 0 }));
    this.aspect = sprite.width / sprite.height;
    this.h = rect.h;
    this.targetH = targetH;
    this.x = rect.x + rect.w / 2;
    this.y = rect.y + rect.h;
    this.vx = 0;
    this.vy = 0;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.speed = rand(0.55, 0.85);       // body heights per second
    this.state = 'peel';
    this.t = 0;                          // time in state
    this.age = 0;
    this.step = 0;
    this.sway = Math.random() * 6;
    this.angle = 0;
    this.spin = 0;
    this.squash = 0;
    this.lift = 0;
    this.layer = 'front';
    this.nextHide = rand(9, 16);
    this.hideFor = 0;
    this.nextIdle = rand(3, 7);
    this.blink = 1;                      // starts with eyes shut, they open when it wakes
    this.nextBlink = rand(1.5, 4);
    this.excite = 0;
    this.grab = null;
    this.look = null;
    this.events = [];
  }

  get w() { return this.h * this.aspect; }

  emit(type, extra) { this.events.push({ type, ...extra }); }

  contains(px, py) {
    const w = this.w, pad = this.h * 0.12;
    return px > this.x - w / 2 - pad && px < this.x + w / 2 + pad && py > this.y - this.h - pad && py < this.y + pad;
  }

  pick(px, py) {
    this.state = 'held';
    this.layer = 'front';
    this.hideFor = 0;
    this.grab = { dx: this.x - px, dy: this.y - py, tx: px, ty: py, hist: [] };
    this.excite = 1;
    this.emit('grab');
  }

  drag(px, py, now) {
    if (!this.grab) return;
    this.grab.tx = px;
    this.grab.ty = py;
    const hist = this.grab.hist;
    hist.push({ x: px, y: py, t: now });
    while (hist.length > 1 && now - hist[0].t > 110) hist.shift();
  }

  drop(now) {
    if (!this.grab) return;
    const hist = this.grab.hist;
    let vx = 0, vy = 0;
    if (hist.length > 1) {
      const a = hist[0], b = hist[hist.length - 1], dt = Math.max(16, b.t - a.t) / 1000;
      if (now - b.t < 120) { vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt; }
    }
    this.grab = null;
    this.toAir(vx, vy);
    this.spin = clamp(vx / this.h, -14, 14);
    this.emit(Math.hypot(vx, vy) > this.h * 4 ? 'throw' : 'release');
  }

  tickle() {
    if (this.state !== 'walk' && this.state !== 'idle') return;
    this.excite = 1;
    this.toAir(rand(-0.4, 0.4) * this.h, -this.h * 4.2);
    this.spin = this.dir * 9;
    this.emit('giggle');
  }

  swat(vx, vy) {
    if (this.state === 'held' || this.state === 'peel') return;
    this.toAir(vx * 0.9, Math.min(vy * 0.6, -this.h * 3.5));
    this.spin = clamp(vx / this.h, -16, 16);
    this.excite = 1;
    this.emit('swat');
  }

  toAir(vx, vy) {
    this.state = 'air';
    this.t = 0;
    this.vx = vx;
    this.vy = vy;
  }

  update(dt, world) {
    this.age += dt;
    this.t += dt;
    this.sway += dt * (this.state === 'walk' ? 5 : 2.2);
    this.excite = Math.max(0, this.excite - dt * 0.6);
    this.squash *= Math.pow(0.002, dt);
    this.updateEyes(dt, world);

    if (this.state === 'peel') {
      // Wake up on the paper: a shiver, the eyes open, then a hop off the page.
      this.lift = clamp(this.t / 0.5, 0, 1);
      this.angle = Math.sin(this.t * 34) * 0.05 * clamp((this.t - 0.25) * 3, 0, 1);
      if (this.t > 0.55) this.blink = Math.max(0, 1 - (this.t - 0.55) * 5);
      if (this.t > 1.25) {
        const side = this.x < world.W / 2 ? 1 : -1;
        this.dir = side;
        this.toAir(side * this.targetH * rand(1.2, 2), -this.targetH * 5.5);
        this.spin = side * 3;
        this.emit('hop');
      }
      return;
    }

    // Grow (or shrink) to walking size after leaving the page.
    this.h += (this.targetH * (this.layer === 'back' ? 0.86 : 1) - this.h) * Math.min(1, dt * 4);
    this.lift = Math.max(0, this.lift - dt * 2);

    if (this.state === 'held') {
      const g = this.grab;
      const tx = g.tx + g.dx, ty = g.ty + g.dy;
      const nx = this.x + (tx - this.x) * Math.min(1, dt * 18);
      const ny = this.y + (ty - this.y) * Math.min(1, dt * 18);
      this.angle = clamp((nx - this.x) / Math.max(dt, 1e-3) / this.h * 0.03, -0.6, 0.6);
      this.x = nx;
      this.y = ny;
      this.step += dt * 26;
      return;
    }

    const G = this.h * 22;
    if (this.state === 'air') {
      this.vy += G * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.angle += this.spin * dt;
      this.spin *= Math.pow(0.5, dt);
      const half = this.w / 2;
      if (this.x < half) { this.x = half; this.vx = Math.abs(this.vx) * 0.6; this.emit('bonk'); }
      if (this.x > world.W - half) { this.x = world.W - half; this.vx = -Math.abs(this.vx) * 0.6; this.emit('bonk'); }
      if (this.y - this.h < 0 && this.vy < 0) { this.vy = Math.abs(this.vy) * 0.4; }
      const ground = world.ground(this.x - half * 0.5, this.x + half * 0.5, this.layer);
      if (this.vy > 0 && this.y >= ground) {
        this.y = ground;
        const impact = this.vy / this.h;
        this.squash = clamp(impact / 9, 0.15, 0.7);
        if (impact > 7) {
          this.vy = -this.vy * 0.36;
          this.vx *= 0.6;
          this.emit('bounce', { power: impact });
        } else {
          this.state = 'walk';
          this.t = 0;
          this.vx = 0;
          this.vy = 0;
          this.angle = 0;
          this.spin = 0;
          this.emit('land', { power: impact });
        }
      }
      return;
    }

    // Upright: settle the tilt.
    this.angle *= Math.pow(0.001, dt);

    if (this.state === 'idle') {
      if (this.t > this.idleFor) { this.state = 'walk'; this.t = 0; }
    } else {
      const v = this.speed * this.h * (1 + this.excite);
      this.x += this.dir * v * dt;
      this.step += dt * (6.5 + this.excite * 6);
      if (Math.sin(this.step) * Math.sin(this.step - dt * 6.5) < 0) this.emit('step');
      this.nextIdle -= dt;
      if (this.nextIdle < 0) {
        this.state = 'idle';
        this.t = 0;
        this.idleFor = rand(1.2, 2.6);
        this.nextIdle = rand(4, 9);
        if (Math.random() < 0.35) this.dir *= -1;
      }
    }

    const half = this.w / 2;
    if (this.x < half + 4) { this.x = half + 4; this.dir = 1; }
    if (this.x > world.W - half - 4) { this.x = world.W - half - 4; this.dir = -1; }

    // Hide-and-seek behind you, only from the floor and only when you're in the picture.
    if (this.layer === 'front') {
      this.nextHide -= dt;
      if (this.nextHide < 0 && world.person && this.y >= world.floor - 2) {
        this.layer = 'back';
        this.hideFor = rand(4, 8);
        this.dir = world.personX > this.x ? 1 : -1;
        this.emit('sneak');
      }
    } else {
      this.hideFor -= dt;
      if (this.hideFor < 0 || !world.person) {
        this.layer = 'front';
        this.nextHide = rand(10, 18);
        this.toAir(this.dir * this.h, -this.h * 3.5);
        this.emit('peekaboo');
        return;
      }
    }

    // Ground under its feet: step up small rises, jump onto big ones, fall off edges.
    const ahead = this.x + this.dir * half * 0.35;
    const ground = world.ground(ahead - half * 0.5, ahead + half * 0.5, this.layer);
    const rise = this.y - ground;
    if (rise > this.h * 0.18) {
      if (rise > world.H * 0.6) { this.dir *= -1; return; }
      this.toAir(this.dir * this.h * 1.2, -Math.sqrt(2 * G * (rise + this.h * 0.35)));
      this.emit('hop');
    } else if (rise > 0) {
      this.y = ground;
    } else if (rise < -this.h * 0.12) {
      this.toAir(this.dir * this.h * 0.6, 0);
    } else {
      this.y = ground;
    }
  }

  updateEyes(dt, world) {
    this.nextBlink -= dt;
    if (this.state !== 'peel') {
      if (this.nextBlink < 0) { this.blink = 1; this.nextBlink = rand(2, 5); }
      this.blink = Math.max(0, this.blink - dt * 7);
    }
    // Pupils chase whatever is interesting, with googly wobble.
    const cx = this.x, cy = this.y - this.h * 0.75;
    let tx = 0, ty = 0.15;
    const target = this.look;
    if (target) {
      const dx = target.x - cx, dy = target.y - cy, d = Math.hypot(dx, dy) || 1;
      tx = dx / d;
      ty = dy / d;
    } else if (this.state === 'walk') {
      tx = this.dir;
    }
    if (this.state === 'air' || this.state === 'held') { tx += Math.sin(this.age * 23) * 0.6; ty += Math.cos(this.age * 19) * 0.6; }
    const lx = tx * this.dir;    // the body is mirrored when it faces left
    for (const e of this.eyes) {
      const ax = (lx * 0.42 - e.px) * 120 - e.vx * 9;
      const ay = (ty * 0.42 - e.py) * 120 - e.vy * 9 + (this.state === 'air' ? -this.vy / this.h * 0.4 : 0);
      e.vx += ax * dt;
      e.vy += ay * dt;
      e.px += e.vx * dt;
      e.py += e.vy * dt;
      const m = Math.hypot(e.px, e.py);
      if (m > 0.48) { e.px *= 0.48 / m; e.py *= 0.48 / m; e.vx *= -0.3; e.vy *= -0.3; }
    }
  }

  drawShadow(ctx, world) {
    if (this.state === 'peel') return;
    const g = world.ground(this.x - this.w * 0.25, this.x + this.w * 0.25, this.layer);
    const up = clamp((g - this.y) / (this.h * 3), 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 - up * 0.7);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(this.x, g, this.w * 0.42 * (1 - up * 0.5), this.h * 0.06 * (1 - up * 0.5), 0, 0, Math.PI * 2);
    ctx.filter = 'blur(4px)';
    ctx.fill();
    ctx.restore();
  }

  draw(ctx) {
    const s = this.sprite, sw = s.width, sh = s.height;
    const h = this.h, w = this.w, k = h / sh;
    const walking = this.state === 'walk' || this.state === 'held';
    const sq = this.squash;
    const scale = 1 + this.lift * 0.07;

    // The bendy body is drawn in strips into a buffer, then the buffer goes on screen in one piece so the
    // shadow and glow don't show seams between strips.
    const pad = h * 0.25, bw = w + pad * 2, bh = h + pad * 1.4, footY = h + pad * 0.4;
    const r = Math.min(2, window.devicePixelRatio || 1);
    if (!this.buf) { this.buf = document.createElement('canvas'); this.bctx = this.buf.getContext('2d'); }
    const pw = Math.ceil(bw * r), ph = Math.ceil(bh * r);
    if (this.buf.width !== pw || this.buf.height !== ph) { this.buf.width = pw; this.buf.height = ph; }
    const b = this.bctx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, pw, ph);
    b.setTransform(r, 0, 0, r, bw / 2 * r, footY * r);

    const swayAmt = (walking ? 0.05 : 0.025) * (1 + this.excite);
    const stripH = sh / STRIPS;
    for (let i = 0; i < STRIPS; i++) {
      const f = (i + 0.5) / STRIPS;
      const sway = Math.sin(this.sway - f * 1.8) * h * swayAmt * Math.pow(1 - f, 1.4);
      const lean = walking ? (1 - f) * h * 0.04 : 0;
      const dy = -h + i * stripH * k;
      if (f < LEG_START || !walking) {
        b.drawImage(s, 0, i * stripH, sw, stripH + 0.6, -w / 2 + sway + lean, dy, w, stripH * k + 1);
      } else {
        const lf = (f - LEG_START) / (1 - LEG_START);
        for (let side = 0; side < 2; side++) {
          const ph2 = Math.sin(this.step + side * Math.PI);
          const up = -Math.max(0, ph2) * h * 0.08 * lf;
          const fwd = Math.cos(this.step + side * Math.PI) * h * 0.035 * lf;
          b.drawImage(s, side * sw / 2, i * stripH, sw / 2, stripH + 0.6, -w / 2 + side * w / 2 + sway + fwd, dy + up, w / 2 + 0.6, stripH * k + 1);
        }
      }
    }

    // Googly eyes.
    for (const e of this.eyesOn === false ? [] : this.eyes) {
      const f = e.y / sh;
      const sway = Math.sin(this.sway - f * 1.8) * h * swayAmt * Math.pow(1 - f, 1.4) + (walking ? (1 - f) * h * 0.04 : 0);
      const ex = (e.x - sw / 2) * k + sway, ey = -h + e.y * k, er = e.r * k;
      const open = 1 - this.blink;
      b.fillStyle = '#fff';
      b.strokeStyle = '#111';
      b.lineWidth = Math.max(1.5, er * 0.14);
      b.beginPath();
      b.ellipse(ex, ey, er, Math.max(er * 0.08, er * open), 0, 0, Math.PI * 2);
      b.fill();
      b.stroke();
      if (open > 0.25) {
        b.save();
        b.beginPath();
        b.ellipse(ex, ey, er, er * open, 0, 0, Math.PI * 2);
        b.clip();
        b.fillStyle = '#111';
        b.beginPath();
        b.arc(ex + e.px * er, ey + e.py * er, er * (0.5 + this.excite * 0.08), 0, Math.PI * 2);
        b.fill();
        b.fillStyle = '#fff';
        b.beginPath();
        b.arc(ex + e.px * er - er * 0.16, ey + e.py * er - er * 0.18, er * 0.13, 0, Math.PI * 2);
        b.fill();
        b.restore();
      }
    }

    ctx.save();
    ctx.translate(this.x, this.y - h / 2);
    ctx.rotate(this.angle);
    ctx.scale(this.dir * scale * (1 + sq * 0.3), scale * (1 - sq * 0.3));
    ctx.translate(0, h / 2);
    if (this.state === 'peel') {
      // A soft glow while it wakes up on the paper.
      ctx.shadowColor = 'rgba(255, 236, 160, 0.95)';
      ctx.shadowBlur = 34 * this.lift;
    } else {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
    }
    ctx.drawImage(this.buf, -bw / 2, -footY, bw, bh);
    ctx.restore();
  }
}
