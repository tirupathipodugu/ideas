// Fluid: the water itself, as a small grid fluid simulation (Jos Stam's "stable fluids") on the CPU.
// About 36 cells across the short side is plenty: the water only has to carry bubbles and bend the
// view, not be looked at directly.
// - Velocities are px/s. Each step: slow ambient currents (the curl of a drifting stream function, so
//   they swirl without bunching up), the plume of every rising bubble dragging water up with it,
//   then advect (semi-Lagrangian), then project (Jacobi) so the water stays incompressible. Projection
//   is what turns a straight swipe into a pair of counter-rotating whirlpools.
// - Swipes, hands and breath push the water with splat(); bubbles read it back with sample().

const CELLS = 36;
const ITERATIONS = 18;
const FADE = 0.45;          // per second: how fast stirred water calms down

export class Fluid {
  constructor() {
    this.w = 0;
    this.h = 0;
    this.time = 0;
  }

  resize(W, H) {
    const cell = Math.min(W, H) / CELLS;
    const w = Math.max(8, Math.round(W / cell)), h = Math.max(8, Math.round(H / cell));
    this.W = W;
    this.H = H;
    this.cx = W / w;          // px per cell
    this.cy = H / h;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const n = w * h;
    this.u = new Float32Array(n);
    this.v = new Float32Array(n);
    this.u0 = new Float32Array(n);
    this.v0 = new Float32Array(n);
    this.p = new Float32Array(n);
    this.div = new Float32Array(n);
    this.texels = new Float32Array(n * 2);    // u, v interleaved, for the renderer
  }

  /** Push the water at (x, y) towards velocity (vx, vy), over a soft disc of radius r (px). */
  splat(x, y, vx, vy, r, strength = 0.8) {
    const { w, h, cx, cy, u, v } = this;
    const gx = x / cx - 0.5, gy = y / cy - 0.5;
    const R = r / cx;
    const x0 = Math.max(0, Math.floor(gx - R * 2)), x1 = Math.min(w - 1, Math.ceil(gx + R * 2));
    const y0 = Math.max(0, Math.floor(gy - R * 2)), y1 = Math.min(h - 1, Math.ceil(gy + R * 2));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const d2 = ((i - gx) ** 2 + (j - gy) ** 2) / (R * R);
        if (d2 > 4) continue;
        const k = Math.exp(-d2) * strength;
        const id = j * w + i;
        u[id] += (vx - u[id]) * k;
        v[id] += (vy - v[id]) * k;
      }
    }
  }

  /** Water velocity at (x, y), px/s. */
  sample(x, y) {
    return { vx: this.bilerp(this.u, x / this.cx - 0.5, y / this.cy - 0.5), vy: this.bilerp(this.v, x / this.cx - 0.5, y / this.cy - 0.5) };
  }

  bilerp(f, gx, gy) {
    const w = this.w, h = this.h;
    gx = Math.min(w - 1.001, Math.max(0, gx));
    gy = Math.min(h - 1.001, Math.max(0, gy));
    const i = Math.floor(gx), j = Math.floor(gy);
    const fx = gx - i, fy = gy - j;
    const a = j * w + i;
    return (f[a] * (1 - fx) + f[a + 1] * fx) * (1 - fy) + (f[a + w] * (1 - fx) + f[a + w + 1] * fx) * fy;
  }

  step(dt, bubbles) {
    if (!this.w || dt <= 0) return;
    const { w, h, cx, cy, u, v } = this;
    const unit = Math.min(this.W, this.H);
    this.time += dt;
    const t = this.time;

    // Ambient currents: big lazy eddies that drift and turn over every few seconds.
    const amp = unit * 0.025 * dt;
    for (let j = 0; j < h; j++) {
      const y = (j + 0.5) / CELLS;
      for (let i = 0; i < w; i++) {
        const x = (i + 0.5) / CELLS;
        // stream function ψ = sin(a x + t…) cos(b y − t…) + …; velocity = (∂ψ/∂y, −∂ψ/∂x)
        const a1 = 2.1 * x + 0.13 * t, b1 = 1.7 * y - 0.11 * t;
        const a2 = 3.3 * x - 0.07 * t + 2.0, b2 = 2.9 * y + 0.09 * t + 1.0;
        const dpdy = -1.7 * Math.sin(a1) * Math.sin(b1) - 0.5 * 2.9 * Math.sin(a2) * Math.sin(b2);
        const dpdx = 2.1 * Math.cos(a1) * Math.cos(b1) + 0.5 * 3.3 * Math.cos(a2) * Math.cos(b2);
        const id = j * w + i;
        u[id] += dpdy * amp;
        v[id] -= dpdx * amp;
      }
    }

    // Rising bubbles drag water up behind them, so streams of bubbles speed up and pull neighbours in.
    for (const b of bubbles) {
      if (b.pop > 0 || b.trapped || b.held) continue;
      const gx = b.x / cx - 0.5, gy = b.y / cy - 0.5;
      const i = Math.round(gx), j = Math.round(gy);
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      const lift = -unit * 9 * (b.r / unit) * (b.r / unit) * 40 * dt;
      v[j * w + i] += lift;
      if (j + 1 < h) v[(j + 1) * w + i] += lift * 0.6;
    }

    // Advect: each cell takes the velocity found where its water came from.
    this.u0.set(u);
    this.v0.set(v);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const id = j * w + i;
        const gx = i - this.u0[id] * dt / cx, gy = j - this.v0[id] * dt / cy;
        u[id] = this.bilerp(this.u0, gx, gy);
        v[id] = this.bilerp(this.v0, gx, gy);
      }
    }

    this.project();

    const fade = Math.exp(-FADE * dt), max = unit * 1.6;
    for (let k = 0; k < u.length; k++) {
      u[k] = Math.max(-max, Math.min(max, u[k] * fade));
      v[k] = Math.max(-max, Math.min(max, v[k] * fade));
    }
  }

  /** Remove the part of the flow that would squeeze or stretch the water. */
  project() {
    const { w, h, u, v, p, div } = this;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const id = j * w + i;
        const ur = i < w - 1 ? u[id + 1] : 0, ul = i > 0 ? u[id - 1] : 0;
        const vd = j < h - 1 ? v[id + w] : 0, vu = j > 0 ? v[id - w] : 0;
        div[id] = -0.5 * ((ur - ul) / this.cx + (vd - vu) / this.cy);
        p[id] = 0;
      }
    }
    const c = this.cx * this.cx;
    for (let k = 0; k < ITERATIONS; k++) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const id = j * w + i;
          const pl = i > 0 ? p[id - 1] : p[id], pr = i < w - 1 ? p[id + 1] : p[id];
          const pu = j > 0 ? p[id - w] : p[id], pd = j < h - 1 ? p[id + w] : p[id];
          p[id] = (div[id] * c + pl + pr + pu + pd) / 4;
        }
      }
    }
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const id = j * w + i;
        const pl = i > 0 ? p[id - 1] : p[id], pr = i < w - 1 ? p[id + 1] : p[id];
        const pu = j > 0 ? p[id - w] : p[id], pd = j < h - 1 ? p[id + w] : p[id];
        u[id] -= 0.5 * (pr - pl) / this.cx;
        v[id] -= 0.5 * (pd - pu) / this.cy;
        if (i === 0 || i === w - 1) u[id] = 0;     // walls
        if (j === 0 || j === h - 1) v[id] = 0;
      }
    }
  }

  /** u, v interleaved for an RG texture (row 0 at the top of the screen). */
  pack() {
    const { u, v, texels } = this;
    for (let k = 0; k < u.length; k++) { texels[k * 2] = u[k]; texels[k * 2 + 1] = v[k]; }
    return texels;
  }
}
