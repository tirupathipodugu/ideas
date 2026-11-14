// Leaves, grass and petals knocked off by a clap or a rub. Real world-space particles: they tumble,
// flutter side to side, fall with gravity and fade out.

import * as THREE from '../vendor/three/three.module.js';

const MAX = 600;

const VS = /* glsl */`
attribute vec4 aP;     // x, y, z, spin angle
attribute vec4 aK;     // size, kind (0 leaf, 1 grass, 2 petal), alpha, tilt
attribute vec3 aC;
varying vec2 vUv; varying float vKind; varying float vA; varying vec3 vC; varying float vShade;
void main() {
  vec3 p = position;
  // tumble: squash one axis by the tilt so leaves flip as they fall
  p.x *= cos(aK.w);
  float c = cos(aP.w), s = sin(aP.w);
  p.xy = mat2(c, s, -s, c) * p.xy;
  vUv = uv; vKind = aK.y; vA = aK.z; vC = aC; vShade = 0.65 + 0.35 * abs(cos(aK.w));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(aP.xyz + p * aK.x, 1.0);
}`;

const FS = /* glsl */`
varying vec2 vUv; varying float vKind; varying float vA; varying vec3 vC; varying float vShade;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float inside;
  if (vKind < 0.5) inside = step(abs(p.x), sin(3.1416 * clamp(p.y * 0.5 + 0.5, 0.0, 1.0)) * 0.6);   // leaf
  else if (vKind < 1.5) inside = step(abs(p.x), 0.14 * (1.0 - (p.y * 0.5 + 0.5)));                // grass blade
  else inside = step(length(p * vec2(1.0, 0.7)), 0.8);                                                // petal
  if (inside < 0.5) discard;
  vec3 col = vC * vShade;
  if (vKind < 0.5) col = mix(col, col * 1.25, smoothstep(0.08, 0.0, abs(p.x)) * 0.5);   // midrib
  gl_FragColor = vec4(col, vA);
}`;

export class Falling {
  constructor(scene) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 1, 2, 1, 3, 2]);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aK = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP); g.setAttribute('aK', this.aK); g.setAttribute('aC', this.aC);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
    this.parts = [];
  }

  /**
   * Knock n bits off around a world point. unit = palm/shoulder size in px, push = hand velocity (px/s),
   * colors = garden uniforms for this season.
   */
  burst(center, radius, n, unit, push, colors, gentle = false) {
    const kick = gentle ? 0.2 : 1;
    const pal = [colors.uLeaf.value, colors.uGrassTip.value, colors.uMossLight.value, colors.uF0.value, colors.uF1.value];
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      const kindRoll = Math.random();
      const kind = kindRoll < 0.55 ? 0 : kindRoll < 0.88 ? 1 : 2;
      const col = kind === 2 ? pal[3 + (Math.random() < 0.35 ? 1 : 0)] : pal[kind === 0 ? (Math.random() < 0.5 ? 0 : 2) : 1];
      const tint = 0.8 + Math.random() * 0.35;
      this.parts.push({
        x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r, z: center.z + unit * 0.4,
        vx: ((Math.random() - 0.5) * unit * 2.2 + push.x * 0.25) * kick, vy: (Math.random() * unit * 1.6 + push.y * 0.15) * kick,
        spin: Math.random() * 6.28, vs: (Math.random() - 0.5) * 8, tilt: Math.random() * 6.28, vt: 3 + Math.random() * 6,
        size: unit * (kind === 1 ? 0.13 : kind === 2 ? 0.06 : 0.09) * (0.7 + Math.random() * 0.6),
        kind, life: 0, max: 1.8 + Math.random() * 1.2, unit,
        r: col.r * tint, g: col.g * tint, b: col.b * tint, ph: Math.random() * 6.28,
      });
    }
  }

  update(dt, floorY) {
    const P = this.aP.array, K = this.aK.array, C = this.aC.array;
    this.parts = this.parts.filter((p) => p.life < p.max && p.y > floorY - 200);
    this.parts.forEach((p, i) => {
      p.life += dt;
      const g = p.unit * 5.5;
      p.vy -= g * dt;
      const drag = p.kind === 1 ? 1.2 : 2.4;                 // leaves and petals drift, grass drops
      p.vx *= Math.exp(-drag * dt); p.vy *= Math.exp(-drag * 0.6 * dt);
      p.x += (p.vx + Math.sin(p.life * 4 + p.ph) * p.unit * 0.6 * (p.kind === 1 ? 0.3 : 1)) * dt;
      p.y += p.vy * dt;
      p.spin += p.vs * dt; p.tilt += p.vt * dt;
      const a = Math.min(1, (p.max - p.life) / 0.6);
      P.set([p.x, p.y, p.z, p.spin], i * 4);
      K.set([p.size, p.kind, a, p.tilt], i * 4);
      C.set([p.r, p.g, p.b], i * 3);
    });
    this.mesh.geometry.instanceCount = this.parts.length;
    this.aP.needsUpdate = this.aK.needsUpdate = this.aC.needsUpdate = true;
  }
}
