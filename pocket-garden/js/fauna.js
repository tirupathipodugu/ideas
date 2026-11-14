// Butterflies that find the gardens, land on fingers, ride along, and take off again.
// Positions are steered on the CPU (a handful of insects); wings flap in the vertex shader.

import * as THREE from '../vendor/three/three.module.js';

const VS = /* glsl */`
attribute vec4 aPose;   // x, y, z, heading
attribute vec4 aWing;   // flap angle, size, hue, unused
varying vec2 vUv; varying float vHue; varying float vShade;
void main() {
  float side = sign(position.x);
  float f = aWing.x;
  // hinge the wing on the body axis (local y); flapping folds it toward the camera
  vec3 p = vec3(position.x * cos(f), position.y, abs(position.x) * sin(f));
  float c = cos(aPose.w), s = sin(aPose.w);
  p.xy = mat2(c, s, -s, c) * p.xy;
  vec3 world = aPose.xyz + p * aWing.y;
  vUv = uv; vHue = aWing.z; vShade = 0.65 + 0.35 * cos(f);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}`;

const FS = /* glsl */`
varying vec2 vUv; varying float vHue; varying float vShade;
void main() {
  // vUv.x: 0 at the body, 1 at the wing edge; vUv.y: -1 (hind) .. 1 (fore)
  vec2 p = vec2(vUv.x, vUv.y);
  float fore = length((p - vec2(0.48, 0.42)) / vec2(0.55, 0.5));
  float hind = length((p - vec2(0.36, -0.42)) / vec2(0.4, 0.45));
  float d = min(fore, hind);
  if (d > 1.0) { if (p.x < 0.05 && abs(p.y) < 0.75) { gl_FragColor = vec4(vec3(0.06), 1.0); return; } discard; }
  vec3 base = vHue < 0.5 ? vec3(0.98, 0.52, 0.08) : vec3(0.35, 0.6, 1.0);
  vec3 c = base;
  float edge = smoothstep(0.84, 0.9, d);
  float ang = atan(p.y, p.x + 0.05);
  float veins = smoothstep(0.035, 0.0, abs(fract(ang * 1.6) - 0.5) - 0.465) * smoothstep(0.2, 0.35, d) * (1.0 - edge);
  c = mix(c, vec3(0.05), max(edge, veins * 0.8));
  // a few white spots inside the black border
  vec2 sp = vec2(fract(ang * 3.2) - 0.5, (d - 0.94) * 6.0);
  c = mix(c, vec3(0.97), smoothstep(0.22, 0.12, length(sp)) * edge);
  c = mix(c, base * 1.15, smoothstep(0.5, 0.0, d) * 0.25);
  c *= 0.35 + 0.75 * vShade;
  gl_FragColor = vec4(c, 1.0);
}`;

function wingGeometry() {
  const pos = [], uv = [], idx = [];
  for (const side of [-1, 1]) {
    const b = pos.length / 3;
    for (const [x, y] of [[0, -1], [1, -1], [0, 1], [1, 1]]) { pos.push(side * x, y * 0.8, 0); uv.push(x, y); }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  return { pos, uv, idx };
}

export class Butterflies {
  constructor(scene, n = 5) {
    const g = new THREE.InstancedBufferGeometry();
    const w = wingGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(w.uv, 2));
    g.setIndex(w.idx);
    this.pose = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.wing = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.pose.setUsage(THREE.DynamicDrawUsage); this.wing.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPose', this.pose); g.setAttribute('aWing', this.wing);
    g.instanceCount = n;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.flies = Array.from({ length: n }, (_, i) => ({
      p: new THREE.Vector3(-400, 300, 0), v: new THREE.Vector3(), heading: 0, phase: Math.random() * 10,
      state: 'away', target: null, timer: 1.5 + i * 1.6 + Math.random(), hue: i % 4 === 3 ? 1 : 0, size: 1,
    }));
  }

  /** gardens: HandGarden[]; view: {w, h} in world px (y up, so screen is x 0..w, y -h..0). */
  update(gardens, t, dt, view) {
    const live = gardens.filter((g) => g.tracked && g.u.uAge.value > 0.8);
    this.flies.forEach((f, i) => {
      f.timer -= dt;
      const homeScale = live[0]?.scale ?? 120;
      f.size = homeScale * 0.16 * (f.hue ? 0.8 : 1);
      if (live.length === 0) {
        if (f.state !== 'away') { f.state = 'leaving'; f.target = null; }
      } else if (f.state === 'away' && f.timer <= 0) {
        // enter from a random edge
        f.p.set(Math.random() < 0.5 ? -60 : view.w + 60, -view.h * (0.2 + Math.random() * 0.6), 400);
        f.state = 'seek';
        f.pickAt = 0;
      }
      if (f.state === 'seek' || f.state === 'landed') {
        if (!f.target || !live.includes(f.target.g) || f.timer <= 0) {
          const g = live[Math.floor(Math.random() * live.length)];
          if (!g) { f.state = 'leaving'; return; }
          const j = g.perches[Math.floor(Math.random() * g.perches.length)];
          f.target = { g, j, off: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.3, 0) };
          f.state = 'seek';
          f.timer = 4 + Math.random() * 5;
        }
      }
      let flap;
      if (f.state === 'seek') {
        const g = f.target.g, J = g.joints[f.target.j], s = g.scale;
        const goal = new THREE.Vector3(J.x + f.target.off.x * s, J.y + f.target.off.y * s, J.z + s * 0.6);
        const wob = new THREE.Vector3(Math.sin(t * 2.3 + i * 4) * s * 0.6, Math.cos(t * 1.9 + i) * s * 0.4, 0);
        const toGoal = goal.clone().add(f.p.distanceTo(goal) > s * 0.6 ? wob : new THREE.Vector3()).sub(f.p);
        f.v.add(toGoal.multiplyScalar(dt * 3.2)).multiplyScalar(Math.pow(0.12, dt));
        if (f.p.distanceTo(goal) < s * 0.12 && Math.random() < dt * 1.5) { f.state = 'landed'; f.timer = 2.5 + Math.random() * 4; }
        flap = Math.abs(Math.sin(t * 22 + i)) * 1.35;
      } else if (f.state === 'landed') {
        const g = f.target.g, J = g.joints[f.target.j], s = g.scale;
        f.p.set(J.x + f.target.off.x * s, J.y + f.target.off.y * s, J.z + s * 0.6);
        f.v.set(0, 0, 0);
        flap = 0.25 + 0.9 * (0.5 + 0.5 * Math.sin(t * 2.2 + i)) ** 3;   // slow open-close while resting
      } else if (f.state === 'leaving') {
        f.v.add(new THREE.Vector3(f.p.x < view.w / 2 ? -1 : 1, 0.6, 0).multiplyScalar(dt * 500)).multiplyScalar(Math.pow(0.3, dt));
        flap = Math.abs(Math.sin(t * 24 + i)) * 1.35;
        if (f.p.x < -100 || f.p.x > view.w + 100 || f.p.y > 100) { f.state = 'away'; f.timer = 1 + Math.random() * 3; }
      } else {
        flap = 1.5; f.p.set(-1000, 1000, 0);
      }
      if (f.state !== 'landed') f.p.addScaledVector(f.v, dt);
      if (f.v.lengthSq() > 4) f.heading += (Math.atan2(-f.v.x, f.v.y) * 0.35 - f.heading) * Math.min(1, dt * 4);
      this.pose.setXYZW(i, f.p.x, f.p.y, f.p.z, f.heading);
      this.wing.setXYZW(i, flap, f.size, f.hue, 0);
    });
    this.pose.needsUpdate = true;
    this.wing.needsUpdate = true;
  }
}
