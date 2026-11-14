// Moss over the person's exact outline. MediaPipe Pose's person mask fills the gaps the body capsules
// leave (loose clothes, hair, shoes); the 3D plants grow on top. The face is kept clear.

import * as THREE from '../vendor/three/three.module.js';

const VS = /* glsl */`
varying vec2 vUv; varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FS = /* glsl */`
uniform sampler2D uMask; uniform float uMirror; uniform vec2 uTexel;
uniform vec3 uMossDark; uniform vec3 uMossLight; uniform vec3 uGrassTip; uniform vec3 uF0; uniform vec3 uF1;
uniform vec2 uFaceC; uniform vec2 uFaceR; uniform float uFaceA; uniform float uFaceOn;
uniform float uAlpha; uniform float uUnit;
uniform vec4 uHole[8];
varying vec2 vUv; varying vec3 vWorld;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float mask(vec2 uv) { return texture2D(uMask, vec2(uMirror > 0.5 ? 1.0 - uv.x : uv.x, 1.0 - uv.y)).r; }
void main() {
  vec2 p = vWorld.xy / max(uUnit, 1.0) * 30.0;
  float n = vnoise(p * 0.6) * 0.55 + vnoise(p * 1.7) * 0.3 + vnoise(p * 4.3) * 0.15;
  float m = mask(vUv);
  // grassy fringe instead of a cut-out edge
  float a = smoothstep(0.5, 0.56, m + (vnoise(p * 2.5) - 0.5) * 0.3);
  // face hole (soft ellipse)
  vec2 d = vWorld.xy - uFaceC;
  float ca = cos(uFaceA), sa = sin(uFaceA);
  d = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / uFaceR;
  a *= mix(1.0, smoothstep(0.92, 1.02, length(d) + (vnoise(p * 2.0) - 0.5) * 0.15), uFaceOn);
  for (int i = 0; i < 8; i++) {
    if (uHole[i].w <= 0.0) continue;
    float hd = length(vWorld.xy - uHole[i].xy) / uHole[i].z;
    a *= 1.0 - uHole[i].w * (1.0 - smoothstep(0.6, 1.0, hd + (vnoise(p * 3.0) - 0.5) * 0.25));
  }
  a *= uAlpha;
  if (a < 0.02) discard;
  // depth: blurred mask -> darker near the outline, so the shape reads as rounded
  float b = 0.0;
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) b += mask(vUv + vec2(float(i), float(j)) * uTexel * 6.0);
  b /= 25.0;
  vec3 c = mix(uMossDark, uMossLight, smoothstep(0.3, 0.8, n));
  c = mix(c, uGrassTip, smoothstep(0.78, 0.95, vnoise(p * 3.1)) * 0.6);   // sunlit blade tips
  c *= mix(0.5, 1.05, smoothstep(0.45, 0.95, b)) * (0.8 + 0.3 * n);
  // a few tiny flowers
  vec2 cell = floor(p * 0.9), f = fract(p * 0.9) - 0.5;
  float h = hash12(cell);
  if (h > 0.93) {
    vec2 o = vec2(hash12(cell + 7.1), hash12(cell + 3.3)) * 0.5 - 0.25;
    float r = length(f - o);
    vec3 fc = h > 0.965 ? uF1 : uF0;
    c = mix(c, fc, smoothstep(0.16, 0.1, r));
    c = mix(c, vec3(0.98, 0.8, 0.2), smoothstep(0.06, 0.03, r) * (1.0 - step(0.965, h)));
  }
  gl_FragColor = vec4(c, a);
}`;

export class Silhouette {
  constructor(scene, gardenUniforms) {
    this.tex = new THREE.DataTexture(new Uint8Array(4), 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    const g = gardenUniforms;
    this.u = {
      uMask: { value: this.tex }, uMirror: { value: 1 }, uTexel: { value: new THREE.Vector2(0.01, 0.01) },
      uMossDark: g.uMossDark, uMossLight: g.uMossLight, uGrassTip: g.uGrassTip, uF0: g.uF0, uF1: g.uF1,
      uFaceC: { value: new THREE.Vector2() }, uFaceR: { value: new THREE.Vector2(1, 1) }, uFaceA: { value: 0 }, uFaceOn: { value: 0 },
      uAlpha: { value: 0 }, uUnit: { value: 100 }, uHole: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.u, transparent: true, depthWrite: false, depthTest: false,
    }));
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.buf = null;
  }

  /** Copy a MediaPipe mask (float 0..1) into the texture at half resolution. */
  setMask(mpMask) {
    const src = mpMask.getAsFloat32Array(), w = mpMask.width, h = mpMask.height;
    const tw = w >> 1, th = h >> 1;
    if (!this.buf || this.buf.length !== tw * th) {
      this.buf = new Uint8Array(tw * th);
      this.tex.dispose();
      this.tex = new THREE.DataTexture(this.buf, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
      this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
      this.u.uMask.value = this.tex;
      this.u.uTexel.value.set(1 / tw, 1 / th);
    }
    const out = this.buf;
    for (let y = 0; y < th; y++) {
      const row = (y * 2) * w;
      for (let x = 0; x < tw; x++) out[y * tw + x] = src[row + x * 2] * 255;
    }
    this.tex.needsUpdate = true;
  }

  /** rect: where the video is drawn (cover-fit, px); body: the body Garden (for face, unit and growth). */
  update(rect, mirrored, body, on, t = 0) {
    const u = this.u;
    const holes = body.holes(t);
    u.uHole.value.forEach((h, i) => { const o = holes[i]; if (o) h.set(o.x, o.y, o.r, o.k); else h.set(0, 0, 1, 0); });
    const target = on && body.tracked ? Math.min(1, Math.max(0, (body.u.uAge.value - 0.3) / 1.2)) : 0;
    u.uAlpha.value += (target - u.uAlpha.value) * 0.15;
    this.mesh.visible = u.uAlpha.value > 0.01;
    if (!this.mesh.visible) return;
    this.mesh.position.set(rect.ox + rect.dw / 2, -(rect.oy + rect.dh / 2), -2500);
    this.mesh.scale.set(rect.dw, rect.dh, 1);
    u.uMirror.value = mirrored ? 1 : 0;
    const J = body.joints, V = body.vis;
    u.uUnit.value = body.u.uScale.value;
    // face ellipse from eyes, mouth and ears
    const ex = (J[2].x + J[5].x) / 2, ey = (J[2].y + J[5].y) / 2, mx = (J[9].x + J[10].x) / 2, my = (J[9].y + J[10].y) / 2;
    const earW = Math.max(1, Math.hypot(J[8].x - J[7].x, J[8].y - J[7].y));
    u.uFaceC.value.set(ex * 0.45 + mx * 0.55, ey * 0.45 + my * 0.55);
    u.uFaceR.value.set(earW * 0.5, earW * 0.72);
    u.uFaceA.value = Math.atan2(J[8].y - J[7].y, J[8].x - J[7].x);
    u.uFaceOn.value = Math.min(V[0], V[2], V[5]) > 0.5 ? 1 : 0;
  }
}
