// World: every bubble and particle, and the physics that moves them. Positions are CSS pixels, y down.
//
// - Bubbles drift in from the bottom-left corner (and from your mouth when you blow), grow, bounce off
//   the edges and each other with a squash-and-stretch wobble, swell at the end of life and pop.
// - Two bubbles that touch gently join into a double bubble. Real soap films meet at 120 degrees, which
//   puts the centres sqrt(r1² + r2² − r1·r2) apart; bonds hold that distance, so clusters form a foam.
// - Your outline (the person mask) is solid: bubbles settle on your head and shoulders and roll off;
//   moving suddenly flicks them away or pops them. A fast hand gusts them; a fast fingertip pops them.
// - Holding a bubble freezes it (frost grows across it); letting go shatters it into ice.
// - Dragging on empty space stretches a soap film that closes into a giant bubble when you let go.
// - "Bubble me" seals you in a giant bubble that floats up, pops, and drops you back down.
// - Time can be slowed (hold empty space); everything here runs on that slowed clock.

const MAX_BUBBLES = 40;
const CORNER_MAX = 30;                 // the corner stream leaves room for blown and tapped bubbles
const SPAWN_EVERY = [0.22, 0.5];
const LIFE = [16, 30];
const SWELL_TIME = 1.4;
const SWELL = 1.16;
const POP_TIME = 0.14;
const DROP_LIFE = 0.55;
const ICE_LIFE = 1.8;
export const SPEED = 1.25;             // drift speed multiplier
const DELAY = [0.2, 2.5];              // seconds of camera delay per bubble
const FREEZE_TIME = 1.4;

const rand = (a, b) => a + Math.random() * (b - a);
let nextId = 1;

export class World {
  constructor(events) {
    this.events = events;              // { pop(b, big), shatter(b, big), crackle(), whoosh(len), thud() }
    this.bubbles = [];
    this.particles = [];
    this.W = 1;
    this.H = 1;
    this.time = 0;
    this.nextSpawn = 0;
    this.trap = null;
  }

  get u() { return Math.min(this.W, this.H); }

  resize(W, H) { this.W = W; this.H = H; }

  // ---------- Making bubbles ----------

  add(x, y, vx, vy, startR, target, extra) {
    if (this.bubbles.length >= MAX_BUBBLES) return null;
    const droplet = Math.random() < 0.3;   // some are thick "water drop" lenses that flip the view
    const b = {
      id: nextId++,
      x, y, vx, vy,
      r: startR,
      target,
      age: 0,
      life: rand(LIFE[0], LIFE[1]),
      seed: Math.random(),
      delay: rand(DELAY[0], DELAY[1]),
      filmClock: Math.random() * 50,
      shimmer: rand(0, 0.15),
      lens: droplet ? rand(-0.95, -0.75) : rand(0.62, 0.8),
      droplet,
      squash: 0, wobAmp: 0, wobT: 9, wobAxis: 0,
      pop: 0, popAngle: 0, popAt: 0,
      freeze: 0, freezing: false, frostAngle: 0,
      bonds: [],
      perched: 0,
      held: false,
      giant: false,
      trapped: false,
      ...extra,
    };
    this.bubbles.push(b);
    return b;
  }

  spawnCorner() {
    if (this.bubbles.length >= CORNER_MAX) return;
    const u = this.u;
    const a = rand(-1.25, -0.3);
    const s = u * rand(0.22, 0.42) * SPEED;
    this.add(u * 0.03 + rand(0, 10), this.H - u * 0.03 - rand(0, 10), Math.cos(a) * s, Math.sin(a) * s,
      u * rand(0.01, 0.02), u * rand(0.045, 0.12));
  }

  /** A bubble blown out of a point (a tap, or your mouth). `power` 0..1. */
  blowFrom(x, y, power = 0.5) {
    const u = this.u;
    const a = -Math.PI / 2 + rand(-1.2, 1.2);   // up and out, in a fan
    const s = u * (0.25 + 0.6 * power) * SPEED;
    return this.add(x + rand(-4, 4), y + rand(-4, 4), Math.cos(a) * s, Math.sin(a) * s,
      u * 0.012, u * rand(0.035, 0.07 + 0.08 * power));
  }

  seed(n) {
    for (let i = 0; i < n; i++) {
      this.spawnCorner();
      const b = this.bubbles[this.bubbles.length - 1];
      if (!b) break;
      b.x = rand(0.2, 0.8) * this.W;
      b.y = rand(0.2, 0.7) * this.H;
      b.r = b.target * 0.8;
      b.age = rand(1, 4);
    }
  }

  pick(x, y) {
    let best = null;
    for (const b of this.bubbles) {
      if (b.pop > 0 || b.held || b.trapped) continue;
      if (Math.hypot(x - b.x, y - b.y) < b.r * 1.08 && (!best || b.r < best.r)) best = b;
    }
    return best;
  }

  // ---------- Ending bubbles ----------

  unbond(b) {
    for (const o of b.bonds) {
      o.bonds = o.bonds.filter(x => x !== b);
      this.wobble(o, 0.12, Math.atan2(b.y - o.y, b.x - o.x));
    }
    b.bonds = [];
  }

  pop(b, fromX, fromY) {
    if (b.pop > 0) return;
    this.unbond(b);
    b.pop = 0.0001;
    b.popAngle = fromX === undefined ? rand(0, Math.PI * 2) : Math.atan2(fromY - b.y, fromX - b.x);
    this.events.pop(b, Math.min(1, b.r / (this.u * 0.15)));
    const n = 10 + Math.round(b.r / this.u * 120);
    for (let i = 0; i < n && this.particles.length < 1400; i++) {
      const a = rand(0, Math.PI * 2);
      const s = b.r * rand(1.2, 3.5);
      this.particles.push({
        kind: 0,
        x: b.x + Math.cos(a) * b.r * rand(0.6, 1),
        y: b.y + Math.sin(a) * b.r * rand(0.6, 1),
        vx: Math.cos(a) * s + b.vx * 0.3,
        vy: Math.sin(a) * s + b.vy * 0.3,
        size: rand(1.5, 4.5) * (0.6 + b.r / this.u * 5),
        age: 0, life: DROP_LIFE, rot: 0, spin: 0,
      });
    }
  }

  /** A frozen bubble breaking into falling ice. */
  shatter(b) {
    if (b.pop > 0) return;
    this.unbond(b);
    b.pop = 1;                         // gone at once; the ice carries on
    this.events.shatter(b, Math.min(1, b.r / (this.u * 0.15)));
    const n = 24 + Math.round(b.r / this.u * 260);
    for (let i = 0; i < n && this.particles.length < 1400; i++) {
      const a = rand(0, Math.PI * 2);
      const d = Math.sqrt(Math.random());
      const s = b.r * rand(0.4, 2.2);
      this.particles.push({
        kind: 1,
        x: b.x + Math.cos(a) * b.r * d,
        y: b.y + Math.sin(a) * b.r * d,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - b.r * 0.6,
        size: rand(3, 9) * (0.6 + b.r / this.u * 4),
        age: 0, life: ICE_LIFE * rand(0.7, 1.2), rot: rand(0, 6.28), spin: rand(-8, 8),
      });
    }
  }

  /** A shake: one bubble pops and the pop runs through the rest like a chain reaction. */
  chainPop() {
    const live = this.bubbles.filter(b => b.pop === 0 && !b.trapped && !b.held);
    if (!live.length) return;
    const start = live[Math.floor(Math.random() * live.length)];
    const speed = this.u * 2.5;
    for (const b of live) {
      const d = Math.hypot(b.x - start.x, b.y - start.y);
      b.popAt = this.time + 0.02 + d / speed + rand(0, 0.05);
    }
  }

  // ---------- Freezing ----------

  startFreeze(b, x, y) {
    b.freezing = true;
    b.frostAngle = Math.atan2(y - b.y, x - b.x);
  }

  /** Let go of a freezing bubble: frozen enough shatters, otherwise it thaws. */
  endFreeze(b) {
    b.freezing = false;
    if (b.freeze > 0.25 && b.pop === 0) this.shatter(b);
  }

  // ---------- The wand: drag to stretch a film, let go for a giant bubble ----------

  wandStart(x, y) {
    const b = this.add(x, y, 0, 0, this.u * 0.05, this.u * 0.05, { held: true, giant: true, lens: rand(0.7, 0.85), droplet: false });
    if (!b) return null;
    b.anchorX = x; b.anchorY = y; b.tipX = x; b.tipY = y;
    return b;
  }

  wandMove(b, x, y) { b.tipX = x; b.tipY = y; }

  wandRelease(b, vx, vy) {
    const u = this.u;
    const len = Math.hypot(b.tipX - b.anchorX, b.tipY - b.anchorY);
    b.held = false;
    b.r = Math.min(u * 0.42, Math.max(u * 0.07, len * 0.42));
    b.target = b.r;
    b.squash = 0;
    const sp = Math.hypot(vx, vy), max = u * 0.8;
    b.vx = (sp > max ? vx * max / sp : vx) * 0.5;
    b.vy = (sp > max ? vy * max / sp : vy) * 0.5;
    b.age = 0.4;
    b.life = rand(18, 30);
    this.wobble(b, 0.2, Math.atan2(b.tipY - b.anchorY, b.tipX - b.anchorX));
    this.events.whoosh(0.7, 0.08);
  }

  updateWand(b) {
    const u = this.u;
    const dx = b.tipX - b.anchorX, dy = b.tipY - b.anchorY;
    const len = Math.hypot(dx, dy);
    b.x = (b.anchorX + b.tipX) / 2;
    b.y = (b.anchorY + b.tipY) / 2;
    b.r = Math.max(u * 0.05, Math.min(u * 0.2, len * 0.28));
    b.wobAxis = Math.atan2(dy, dx);
    // Stretched along the drag; the film thins (narrows) as it stretches, and ripples.
    b.squash = Math.max(0, (len / 2 + b.r * 0.25) / b.r - 1) + 0.03 * Math.sin(this.time * 14);
  }

  // ---------- "Bubble me" ----------

  startTrap(pivotX, pivotY, R) {
    if (this.trap) return false;
    const b = this.add(pivotX, pivotY, 0, 0, R * 0.25, R, { trapped: true, giant: true, lens: 1, droplet: false, life: 1e9 });
    if (!b) return false;
    this.trap = { b, t: 0, phase: 'form', pivotX, pivotY, R, offX: 0, offY: 0, scale: 1, vy: 0, landed: false };
    this.events.whoosh(1.6, 0.14);
    return true;
  }

  updateTrap(dt) {
    const T = this.trap;
    const b = T.b;
    T.t += dt;
    const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
    if (T.phase === 'form') {
      const k = ease(T.t / 0.9);
      b.r = T.R * (0.25 + 0.75 * k);
      T.scale = 1 - 0.4 * k;
      if (T.t > 0.9) { T.phase = 'float'; T.t = 0; }
    } else if (T.phase === 'float') {
      const lift = ease(T.t / 2.6);
      const topY = T.R * 1.08;
      T.offY = (topY - T.pivotY) * lift + Math.sin(T.t * 1.7) * T.R * 0.04;
      T.offX = Math.sin(T.t * 0.8) * this.W * 0.12 * lift;
      if (T.t > 6) {
        T.phase = 'fall';
        T.t = 0;
        this.pop(b, b.x, b.y + b.r);
      }
    } else if (T.phase === 'fall') {
      T.vy += this.H * 3.2 * dt;
      T.offY += T.vy * dt;
      T.offX *= Math.exp(-dt * 3);
      T.scale += (1 - T.scale) * Math.min(1, dt * 5);
      if (T.offY >= 0) {
        T.offY = 0;
        if (!T.landed) { T.landed = true; this.events.thud(); }
        T.vy = -T.vy * 0.3;
        if (Math.abs(T.vy) < this.H * 0.05) { this.trap = null; return; }
      }
    }
    if (b.pop === 0) {
      b.x = T.pivotX + T.offX;
      b.y = T.pivotY + T.offY;
      b.squash = 0.025 * Math.sin(T.t * 5.3);
      b.wobAxis = T.t * 0.7;
    }
  }

  // ---------- Physics ----------

  wobble(b, amount, angle) {
    b.wobAmp = Math.min(0.22, Math.max(Math.abs(b.squash), amount));
    b.wobT = 0;
    b.wobAxis = angle;
  }

  /**
   * Advance by dt (seconds of slowed time). env: {
   *   solid(x, y) → 0..1  your outline, or null;  moved(x, y) → 0..1 how much it just changed there;
   *   hands: [{ x, y, vx, vy, tipX, tipY, tipSpeed }];  mouth: { x, y } | null;  breath 0..1;
   *   tilt: { x, y } }
   */
  step(dt, env) {
    const u = this.u;
    this.time += dt;
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.spawnCorner();
      this.nextSpawn = rand(SPAWN_EVERY[0], SPAWN_EVERY[1]);
    }
    if (this.trap) this.updateTrap(dt);

    for (const b of this.bubbles) {
      b.age += dt;
      b.filmClock += dt * (0.1 + b.shimmer * 0.6) * (1 - b.freeze);
      if (b.pop > 0) { b.pop += dt / POP_TIME; continue; }
      if (b.held) { this.updateWand(b); continue; }
      if (b.trapped) continue;
      if (b.popAt && this.time >= b.popAt) { this.pop(b); continue; }

      // Freezing: held still while frost spreads; thaws back if let go too early.
      if (b.freezing) {
        b.freeze = Math.min(1, b.freeze + dt / FREEZE_TIME);
        b.vx *= Math.exp(-8 * dt);
        b.vy *= Math.exp(-8 * dt);
        if (b.freeze < 1) this.events.crackle();
      } else if (b.freeze > 0) {
        b.freeze = Math.max(0, b.freeze - dt * 0.6);
      }

      // Grow; at the end of life swell a little, shimmer faster, then pop.
      const swelling = b.age > b.life && !b.freezing;
      const goal = swelling ? b.target * SWELL : b.target;
      b.r += (goal - b.r) * (1 - Math.exp(-dt / (swelling ? 0.5 : (b.giant ? 0.3 : 1.4))));
      if (swelling) {
        b.shimmer = Math.min(1, b.shimmer + dt * 1.5);
        if (b.wobAmp < 0.03) this.wobble(b, 0.04, rand(0, Math.PI));
        if (b.age > b.life + SWELL_TIME) { this.pop(b); continue; }
      }

      // Forces: a little gravity (real bubbles slowly sink), phone tilt, hands, breath.
      b.vy += u * 0.05 * dt;
      if (env.tilt) { b.vx += env.tilt.x * u * 1.4 * dt; b.vy += env.tilt.y * u * 1.4 * dt; }
      for (const h of env.hands) {
        const d = Math.hypot(b.x - h.x, b.y - h.y);
        const reach = u * 0.28 + b.r;
        const hs = Math.hypot(h.vx, h.vy);
        if (d < reach && hs > u * 0.35) {
          const k = (1 - d / reach) * Math.min(1, dt * 6);
          b.vx += h.vx * k * 0.8;
          b.vy += h.vy * k * 0.8;
          if (b.wobAmp < 0.05) this.wobble(b, 0.08, Math.atan2(h.vy, h.vx));
        }
        if (h.tipSpeed > u * 1.1 && Math.hypot(b.x - h.tipX, b.y - h.tipY) < b.r * 0.95 && !b.freezing) {
          this.pop(b, h.tipX, h.tipY);
          break;
        }
      }
      if (b.pop > 0) continue;
      if (env.mouth && env.breath > 0) {
        const dx = b.x - env.mouth.x, dy = b.y - env.mouth.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = u * 0.5;
        if (d < reach && b.age > 0.3) {
          const k = env.breath * (1 - d / reach) * u * 2.2 * dt;
          b.vx += dx / d * k;
          b.vy += dy / d * k;
        }
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Lazy screensaver pace while floating free; resting or bonded bubbles keep their own motion.
      const sp = Math.hypot(b.vx, b.vy);
      const minSp = u * 0.16 * SPEED, maxSp = u * 0.5 * SPEED;
      if (b.perched <= 0 && !b.bonds.length && !b.freezing && sp > 0 && sp < minSp) {
        const f = 1 + (minSp / sp - 1) * Math.min(1, dt * 1.5);
        b.vx *= f; b.vy *= f;
      }
      if (sp > maxSp) {
        const f = Math.max(maxSp / sp, Math.exp(-2.5 * dt));
        b.vx *= f; b.vy *= f;
      }

      // Edges.
      const kick = v => Math.abs(v) / (u * SPEED) * 0.5;
      if (b.x - b.r < 0 && b.vx < 0) { b.x = b.r; b.vx = -b.vx; this.wobble(b, kick(b.vx), 0); }
      if (b.x + b.r > this.W && b.vx > 0) { b.x = this.W - b.r; b.vx = -b.vx; this.wobble(b, kick(b.vx), 0); }
      if (b.y - b.r < 0 && b.vy < 0) { b.y = b.r; b.vy = -b.vy; this.wobble(b, kick(b.vy), Math.PI / 2); }
      if (b.y + b.r > this.H && b.vy > 0 && b.age > 1.5) { b.y = this.H - b.r; b.vy = -b.vy; this.wobble(b, kick(b.vy), Math.PI / 2); }

      // Your outline is solid.
      b.perched -= dt;
      if (env.solid) this.restOn(b, env, dt);

      b.wobT += dt;
      b.squash = b.wobAmp * Math.exp(-3.2 * b.wobT) * Math.sin(17 * b.wobT);
      if (b.wobT > 2) b.wobAmp = 0;
    }

    this.pairs();

    this.bubbles = this.bubbles.filter(b => b.pop < 1);
    for (const p of this.particles) {
      p.age += dt;
      if (p.kind === 0) {
        p.vx *= 1 - dt * 2.5;
        p.vy = p.vy * (1 - dt * 2.5) + u * 1.6 * dt;
      } else {
        p.vx *= 1 - dt * 0.8;
        p.vy = p.vy * (1 - dt * 0.8) + u * 2.2 * dt;
        p.rot += p.spin * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter(p => p.age < p.life);
  }

  /** Bubbles meeting your outline settle on it, slide off slopes, and get flicked if you move fast. */
  restOn(b, env, dt) {
    const N = 12;
    let nx = 0, ny = 0, hits = 0, moved = 0;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const cx = Math.cos(a), cy = Math.sin(a);
      const x = b.x + cx * b.r * 0.92, y = b.y + cy * b.r * 0.92;
      const s = env.solid(x, y);
      if (s > 0.5) {
        nx += cx; ny += cy; hits++;
        moved += env.moved(x, y);
      }
    }
    if (!hits) return;
    if (hits >= N - 1) {                      // swallowed whole (you stepped into it): just pop
      if (b.age > 1) this.pop(b);
      return;
    }
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;                       // points from the bubble into you
    const u = this.u;
    b.x -= nx * b.r * 0.12 * hits / N * 4 * Math.min(1, dt * 30);
    b.y -= ny * b.r * 0.12 * hits / N * 4 * Math.min(1, dt * 30);
    const vn = b.vx * nx + b.vy * ny;
    if (vn > 0) {                               // moving into you: stop that part, keep the slide
      b.vx -= vn * nx * 1.2;
      b.vy -= vn * ny * 1.2;
      if (vn > u * 0.15) this.wobble(b, Math.min(0.15, vn / u * 0.3), Math.atan2(ny, nx));
    }
    b.vx *= Math.exp(-1.2 * dt);                // a little friction on you
    b.vy *= Math.exp(-1.2 * dt);
    b.perched = 0.4;
    const m = moved / hits;
    if (m > 0.35) {                             // you moved suddenly: flick it, sometimes pop it
      if (m > 0.6 && Math.random() < 0.5) { this.pop(b, b.x + nx * b.r, b.y + ny * b.r); return; }
      b.vx -= nx * u * 1.2 * m;
      b.vy -= ny * u * 1.2 * m;
      this.wobble(b, 0.15, Math.atan2(ny, nx));
    }
  }

  pairs() {
    const u = this.u;
    const list = this.bubbles;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.pop > 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.pop > 0) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const nx = dx / dist, ny = dy / dist;
        const ma = a.trapped || a.held ? 1e9 : a.r * a.r;
        const mb = b.trapped || b.held ? 1e9 : b.r * b.r;
        const bonded = a.bonds.includes(b);

        if (bonded) {
          // A double bubble: hold the 120° spacing; stretched too far, it pinches apart.
          const rest = Math.sqrt(a.r * a.r + b.r * b.r - a.r * b.r);
          if (dist > rest * 1.6 || a.freeze > 0.5 || b.freeze > 0.5) {
            a.bonds = a.bonds.filter(x => x !== b);
            b.bonds = b.bonds.filter(x => x !== a);
            this.wobble(a, 0.12, Math.atan2(ny, nx));
            this.wobble(b, 0.12, Math.atan2(ny, nx));
            continue;
          }
          const c = (dist - rest) * 0.25;
          a.x += nx * c * mb / (ma + mb); a.y += ny * c * mb / (ma + mb);
          b.x -= nx * c * ma / (ma + mb); b.y -= ny * c * ma / (ma + mb);
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          const k = rel * 0.2 / (ma + mb);
          a.vx += k * mb * nx; a.vy += k * mb * ny;
          b.vx -= k * ma * nx; b.vy -= k * ma * ny;
          continue;
        }

        const min = a.r + b.r;
        if (dist >= min) continue;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        const canJoin = !a.trapped && !b.trapped && !a.held && !b.held && !a.freezing && !b.freezing &&
          a.freeze < 0.1 && b.freeze < 0.1 && a.bonds.length < 3 && b.bonds.length < 3 && a.age > 0.6 && b.age > 0.6;
        if (canJoin && Math.abs(rel) < u * 0.35 * SPEED && Math.random() < 0.7) {
          a.bonds.push(b);
          b.bonds.push(a);
          const angle = Math.atan2(ny, nx);
          this.wobble(a, 0.1, angle);
          this.wobble(b, 0.1, angle);
          continue;
        }

        const push = min - dist;
        a.x -= nx * push * mb / (ma + mb); a.y -= ny * push * mb / (ma + mb);
        b.x += nx * push * ma / (ma + mb); b.y += ny * push * ma / (ma + mb);
        if (rel < 0) {
          const k = (1.9 * rel) / (ma + mb);
          a.vx += k * mb * nx; a.vy += k * mb * ny;
          b.vx -= k * ma * nx; b.vy -= k * ma * ny;
          const angle = Math.atan2(ny, nx);
          const amt = Math.abs(rel) / (u * SPEED) * 0.6;
          if (!a.trapped) this.wobble(a, amt, angle);
          if (!b.trapped) this.wobble(b, amt, angle);
        }
      }
    }
  }
}
