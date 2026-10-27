// Renderer (WebGL2). Each frame:
//  1. the garden background, at half resolution;
//  2. the scene: the garden with you cut out of the camera and standing in it (your person mask), moved
//     and clipped into the "Bubble me" bubble when that is running;
//  3. the scene copied to the screen;
//  4. the bubbles, which bend the scene behind them like lenses (soap bubbles magnify a little, thick
//     water-drop bubbles flip it upside down), carry the delayed camera as a reflection, swirl with
//     thin-film colour, share flat walls where they have joined, and grow frost when held;
//  5. droplets and ice shards.

import { createProgram } from './gl-utils.js';

const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  vUv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

// A soft-focus garden, like a photo shot through a wide-open lens: sunlit leaves up top, a warm sun
// glow top-right, deep foliage in the middle, blurred grass along the bottom and drifting light bokeh.
const BACKGROUND_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uAspect;
uniform float uTime;
out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.07 + 3.1; a *= 0.5; }
  return s;
}

vec3 bokeh(vec2 p, float cell, float t, vec3 tint, float amount) {
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec3 sum = vec3(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 c = id + vec2(x, y);
    float h = hash(c);
    if (h > amount) continue;
    vec2 centre = c + 0.5 + 0.35 * vec2(sin(t * 0.3 + h * 40.0), cos(t * 0.25 + h * 23.0));
    float r = 0.18 + 0.22 * hash(c + 7.0);
    float d = length(g - centre);
    float disc = smoothstep(r, r * 0.86, d) * (0.55 + 0.45 * smoothstep(r * 0.5, r, d));
    sum += tint * disc * (0.35 + 0.65 * hash(c + 3.0));
  }
  return sum;
}

void main() {
  vec2 p = vUv * uAspect;
  float t = uTime;
  float y = vUv.y;
  vec2 sun = vec2(0.82, 1.08) * uAspect;
  float glow = exp(-2.2 * length(p - sun));
  vec2 sway = vec2(sin(t * 0.21) * 0.03, cos(t * 0.17) * 0.02);
  float leaves = fbm(p * 2.6 + sway + vec2(0.0, t * 0.01));
  float fine = fbm(p * 7.0 - sway * 2.0 + 11.0);
  vec3 deep = vec3(0.035, 0.11, 0.045);
  vec3 mid = vec3(0.13, 0.33, 0.10);
  vec3 lit = vec3(0.56, 0.78, 0.30);
  vec3 col = mix(deep, mid, smoothstep(0.30, 0.70, leaves));
  col = mix(col, lit, smoothstep(0.55, 0.85, leaves * 0.75 + fine * 0.35) * (0.35 + 1.2 * glow) * smoothstep(0.2, 0.75, y));
  col += vec3(1.0, 0.92, 0.65) * glow * 0.55;
  float ground = smoothstep(0.30, 0.0, y);
  float blades = noise(vec2(p.x * 60.0 + sin(t * 0.6 + p.x * 3.0) * 0.6, y * 3.0));
  vec3 grass = mix(vec3(0.05, 0.16, 0.04), vec3(0.30, 0.52, 0.12), blades * smoothstep(0.0, 0.25, y) + 0.2 * fine);
  col = mix(col, grass, ground * 0.85);
  float near = smoothstep(0.1, 0.9, y) * (0.4 + 1.6 * glow);
  col += bokeh(p + vec2(t * 0.004, 0.0), 0.22, t, vec3(0.85, 0.95, 0.55), 0.35) * 0.30 * near;
  col += bokeh(p + 5.0, 0.09, t * 1.3, vec3(1.0, 0.97, 0.75), 0.25) * 0.22 * near;
  vec2 c = vUv - 0.5;
  col *= 1.0 - 0.55 * dot(c, c);
  outColor = vec4(pow(col, vec3(0.95)), 1.0);
}`;

// You, cut out of the camera and standing in the garden.
const COMPOSE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uBg;
uniform sampler2D uCam;
uniform sampler2D uMask;
uniform float uPersonOn;
uniform vec2 uStage;
uniform vec2 uCover;        // the share of the camera frame that fills the screen
uniform float uMirror;
uniform vec3 uTrap;         // offset x, offset y (px), scale
uniform vec2 uPivot;        // px
uniform vec4 uClip;         // bubble centre x, y, radius (px), on
out vec4 outColor;
void main() {
  vec3 bg = texture(uBg, vUv).rgb;
  vec3 col = bg;
  if (uPersonOn > 0.5) {
    vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uStage;
    vec2 q = uPivot + (px - uPivot - uTrap.xy) / uTrap.z;
    vec2 s = q / uStage;
    if (uMirror > 0.5) s.x = 1.0 - s.x;
    vec2 cuv = 0.5 + (s - 0.5) * uCover;
    if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) {
      float a = smoothstep(0.3, 0.7, texture(uMask, cuv).r);
      if (uClip.w > 0.5) a *= smoothstep(uClip.z, uClip.z * 0.93, length(px - uClip.xy));
      vec3 cam = texture(uCam, cuv).rgb;
      cam = mix(cam, cam * vec3(0.96, 1.03, 0.9) + vec3(0.01, 0.02, 0.0), 0.6);   // into the garden's light
      float rim = a * (1.0 - a) * 4.0;
      cam += bg * rim * 0.6;                                                         // light wrap round the edge
      col = mix(bg, cam, a);
    }
  }
  outColor = vec4(col, 1.0);
}`;

const BLIT_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uScene;
out vec4 outColor;
void main() { outColor = texture(uScene, vUv); }`;

// Copies the newest camera frame, cropped to a centred square, into one layer of the history.
const CAPTURE_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uFrame;
uniform vec2 uCropScale;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uFrame, 0.5 + (vUv - 0.5) * uCropScale).rgb, 1.0);
}`;

const BUBBLE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBody;    // x, y (px), radius, seed
layout(location = 2) in vec4 aShape;   // squash, squash axis, pop progress, pop angle
layout(location = 3) in vec4 aLook;    // fade, history layer, film clock, lens
layout(location = 4) in vec4 aFrost;   // freeze, frost angle, water drop, -
layout(location = 5) in vec4 aJoin0;   // joined neighbours: x, y, radius, on
layout(location = 6) in vec4 aJoin1;
layout(location = 7) in vec4 aJoin2;
uniform vec2 uStage;
out vec2 vP;
out vec4 vBody, vShape, vLook, vFrost, vJoin0, vJoin1, vJoin2;
void main() {
  float reach = 1.3 + max(aShape.x, 0.0);   // stretched wand films need a longer quad
  vec2 p = aCorner * reach;
  vec2 px = aBody.xy + p * aBody.z;
  vec2 clip = px / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vP = p;
  vBody = aBody; vShape = aShape; vLook = aLook; vFrost = aFrost;
  vJoin0 = aJoin0; vJoin1 = aJoin1; vJoin2 = aJoin2;
}`;

const BUBBLE_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec4 vBody, vShape, vLook, vFrost, vJoin0, vJoin1, vJoin2;
uniform highp sampler2DArray uHist;
uniform sampler2D uScene;
uniform vec2 uStage;
uniform float uMirror;
out vec4 outColor;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                 mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
  return s;
}

// Joined bubbles split the overlap along the line where both films meet (the radical axis); the part
// past it belongs to the neighbour, and the line itself is the shared wall.
float wallFrom(vec4 j, vec2 px, vec2 c0, float r0, inout bool gone) {
  if (j.w < 0.5) return 0.0;
  vec2 c = j.xy;
  if (length(px - c) > j.z) return 0.0;
  float d = max(length(c - c0), 1.0);
  float s = ((dot(px - c0, px - c0) - r0 * r0) - (dot(px - c, px - c) - j.z * j.z)) / (2.0 * d);
  if (s > 0.0) gone = true;
  return smoothstep(2.5, 0.0, -s);
}

void main() {
  float squash = vShape.x;
  vec2 axis = vec2(cos(vShape.y), sin(vShape.y));
  float along = dot(vP, axis);
  vec2 across = vP - along * axis;
  vec2 p = along / (1.0 + squash) * axis + across * (1.0 + squash * 0.9);

  float r = length(p);
  float aa = fwidth(r) * 1.5;
  if (r > 1.0 + aa) discard;
  float coverage = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  float rr = min(r, 0.999);
  float z = sqrt(1.0 - rr * rr);
  vec3 n = vec3(p.x, -p.y, z);
  float seed = vBody.w;
  vec2 c0 = vBody.xy;
  float r0 = vBody.z;
  vec2 px = c0 + vP * r0;

  bool gone = false;
  float wall = wallFrom(vJoin0, px, c0, r0, gone);
  wall = max(wall, wallFrom(vJoin1, px, c0, r0, gone));
  wall = max(wall, wallFrom(vJoin2, px, c0, r0, gone));
  if (gone) discard;

  float tear = 0.0;
  if (vShape.z > 0.0) {
    vec2 at = 0.55 * vec2(cos(vShape.w), sin(vShape.w));
    float d = length(p - at);
    float hole = vShape.z * 2.4;
    float ragged = hole + 0.12 * (noise(vec3(atan(p.y - at.y, p.x - at.x) * 3.0, seed * 9.0, 0.0)) - 0.5);
    if (d < ragged) discard;
    tear = smoothstep(0.14, 0.0, d - ragged);
  }

  float freeze = vFrost.x;
  float drop = vFrost.z;

  // Thin-film interference: swirling, draining film; frozen film stops (its clock stops in JS).
  float t = vLook.z;
  vec3 q = vec3(n.xy * 1.3 + seed * 13.0, t + seed * 5.0);
  vec2 swirl = vec2(fbm(q), fbm(q + 4.7)) - 0.5;
  float film = fbm(vec3(n.xy * 1.6 + swirl * 1.8 + seed * 3.0, t * 0.7));
  float thickness = 280.0 + 640.0 * film - 170.0 * n.y;
  float cosT = sqrt(1.0 - rr * rr / (1.33 * 1.33));
  vec3 lambda = vec3(650.0, 532.0, 450.0);
  vec3 iri = 0.5 - 0.5 * cos(12.566 * 1.33 * thickness * cosT / lambda);
  iri = clamp(mix(vec3(dot(iri, vec3(0.333))), iri, 1.15), 0.0, 1.0);

  float rim = pow(1.0 - z, 2.0);
  float fres = 0.04 + 0.96 * pow(1.0 - z, 4.0);

  // What's behind, bent: soap magnifies a little (more near the rim), a water drop flips it over.
  float k = vLook.w * (1.0 + (drop > 0.5 ? 0.1 : 0.3) * rr * rr);
  vec2 lensPx = c0 + (px - c0) * k;
  vec3 col = texture(uScene, vec2(lensPx.x, uStage.y - lensPx.y) / uStage).rgb;
  if (drop > 0.5) {
    col = col * vec3(0.92, 1.0, 1.04) * mix(1.0, 0.3, smoothstep(0.7, 1.0, rr));   // dark rim of a drop
    iri = mix(vec3(0.8), iri, 0.3);
  }

  // The camera, reflected off the curved film, from this bubble's moment in the past.
  vec2 m = p * (0.92 - 0.22 * (1.0 - z)) + swirl * 0.025;
  if (uMirror > 0.5) m.x = -m.x;
  vec3 cam = texture(uHist, vec3(0.5 + 0.5 * m, vLook.y)).rgb;
  cam = pow(cam, vec3(0.9)) * 1.15;
  float camA = mix(0.18, 0.62, rim) * (drop > 0.5 ? 0.35 : 1.0);
  col = mix(col, cam * mix(vec3(1.0), 0.55 + 0.9 * iri, 0.35), camA);

  float filmA = (0.05 + 0.75 * fres + 0.18 * rim) * (drop > 0.5 ? 0.4 : 1.0);
  col += iri * filmA * 0.75;

  // Frost: crystals grow from where you hold it, feathery and branching, and the colour drains away.
  if (freeze > 0.0) {
    vec2 o = 0.8 * vec2(cos(vFrost.y), sin(vFrost.y));
    vec2 d = p - o;
    float dist = length(d);
    float ang = atan(d.y, d.x);
    float grain = fbm(vec3(p * 9.0, seed * 7.0));
    float front = freeze * 2.3;
    float mask = smoothstep(front, front - 0.25, dist + (grain - 0.5) * 0.5);
    float fern = pow(abs(sin(ang * 9.0 + fbm(vec3(p * 5.0, seed)) * 7.0)), 10.0);
    float flakes = smoothstep(0.58, 0.72, fbm(vec3(p * 22.0, seed * 3.0)));
    float crystal = mask * (0.25 + 0.75 * max(fern, flakes)) ;
    col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(0.9, 0.96, 1.05), mask * 0.6);
    col += vec3(0.82, 0.92, 1.0) * crystal * 0.75;
    col += vec3(0.7, 0.85, 1.0) * smoothstep(0.08, 0.0, abs(dist - front + 0.1)) * 0.35 * (1.0 - freeze);
  }

  // Highlights: the soft square window up-left (the Vista look) and a small bounce down-right.
  vec2 h = n.xy - vec2(-0.40, 0.46);
  float box = max(abs(h.x) * 1.05, abs(h.y));
  float win = smoothstep(0.22, 0.11, box) * smoothstep(-0.05, 0.25, z);
  win *= 0.8 + 0.2 * smoothstep(0.012, 0.03, min(abs(h.x), abs(h.y)));
  float spot = smoothstep(0.10, 0.0, length(n.xy - vec2(0.44, -0.50)));
  col += vec3(win * (drop > 0.5 ? 0.9 : 0.6) + spot * 0.4);

  float edge = smoothstep(0.93, 1.0, rr);
  col += (0.35 + 0.65 * iri) * edge * 0.55;
  col += (0.5 + 0.5 * iri) * wall * 0.6;
  col += vec3(1.0) * tear * 0.9;

  float fade = vLook.x * coverage;
  outColor = vec4(col * fade, fade);
}`;

const PART_VS = `#version 300 es
layout(location = 0) in vec4 aPart;    // x, y, size, alpha
layout(location = 1) in vec2 aKind;    // kind (0 drop, 1 ice), rotation
uniform vec2 uStage;
uniform float uScale;
out float vAlpha;
out vec2 vKind;
void main() {
  vec2 clip = aPart.xy / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aPart.z * uScale;
  vAlpha = aPart.w;
  vKind = aKind;
}`;

const PART_FS = `#version 300 es
precision mediump float;
in float vAlpha;
in vec2 vKind;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  if (vKind.x < 0.5) {
    float r = length(p);
    if (r > 1.0) discard;
    float body = smoothstep(1.0, 0.6, r) * 0.35 + smoothstep(0.35, 0.0, length(p - vec2(-0.3, -0.3))) * 0.9;
    float a = (smoothstep(1.0, 0.75, r) * 0.45 + body * 0.5) * vAlpha;
    outColor = vec4(vec3(0.85, 0.93, 1.0) * a + body * vAlpha * 0.4, a);
  } else {
    // An ice shard: a thin rotated diamond with one bright facet.
    float c = cos(vKind.y), s = sin(vKind.y);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float shape = abs(q.x) * 2.2 + abs(q.y);
    if (shape > 1.0) discard;
    float facet = q.x > 0.0 ? 1.0 : 0.55;
    float a = smoothstep(1.0, 0.8, shape) * vAlpha * 0.9;
    outColor = vec4(vec3(0.85, 0.93, 1.0) * facet * a, a);
  }
}`;

const FLOATS = 32;
const MAX_INSTANCES = 64;
const HISTORY = 80;
const HISTORY_SIZE = 256;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true });
    this.gl = gl;
    if (!gl) return;
    this.bg = createProgram(gl, FULLSCREEN_VS, BACKGROUND_FS);
    this.compose = createProgram(gl, FULLSCREEN_VS, COMPOSE_FS);
    this.blit = createProgram(gl, FULLSCREEN_VS, BLIT_FS);
    this.capture = createProgram(gl, FULLSCREEN_VS, CAPTURE_FS);
    this.bubble = createProgram(gl, BUBBLE_VS, BUBBLE_FS);
    this.part = createProgram(gl, PART_VS, PART_FS);

    this.instanceData = new Float32Array(MAX_INSTANCES * FLOATS);
    this.partData = new Float32Array(1500 * 6);

    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 7; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }

    this.partVao = gl.createVertexArray();
    gl.bindVertexArray(this.partVao);
    this.partBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.partData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
    gl.bindVertexArray(null);

    this.camTexture = this.texture2D(1, 1, new Uint8Array([20, 26, 36, 255]));
    this.maskTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    this.sampling(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));
    this.maskSize = [1, 1];

    this.history = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.history);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, HISTORY_SIZE, HISTORY_SIZE, HISTORY);
    this.sampling(gl.TEXTURE_2D_ARRAY);
    this.historyFbo = gl.createFramebuffer();
    this.historyTimes = new Float64Array(HISTORY).fill(-1);
    this.historyHead = -1;
    this.camW = 1;
    this.camH = 1;
  }

  sampling(target) {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  texture2D(w, h, data) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    this.sampling(gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return t;
  }

  target(old, w, h) {
    const gl = this.gl;
    if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fbo); }
    const tex = this.texture2D(w, h, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  resize(W, H, dpr) {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.scene = this.target(this.scene, this.canvas.width, this.canvas.height);
    this.bgTarget = this.target(this.bgTarget, Math.max(1, this.canvas.width >> 1), Math.max(1, this.canvas.height >> 1));
  }

  /** A new camera frame: keep it for compositing you, and add it to the delay history. */
  uploadFrame(source, time) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.camTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.element);
    this.camW = source.width;
    this.camH = source.height;

    this.historyHead = (this.historyHead + 1) % HISTORY;
    this.historyTimes[this.historyHead] = time;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.historyFbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.history, 0, this.historyHead);
    gl.viewport(0, 0, HISTORY_SIZE, HISTORY_SIZE);
    gl.useProgram(this.capture.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.camTexture);
    gl.uniform1i(this.capture.u.uFrame, 0);
    const w = this.camW, h = this.camH;
    gl.uniform2f(this.capture.u.uCropScale, w > h ? h / w : 1, w > h ? 1 : w / h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  uploadMask(mask, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (this.maskSize[0] !== w || this.maskSize[1] !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, mask);
      this.maskSize = [w, h];
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, mask);
    }
  }

  layerFor(time, delay) {
    const want = time - delay;
    let best = Math.max(this.historyHead, 0), gap = Infinity;
    for (let i = 0; i < HISTORY; i++) {
      const t = this.historyTimes[i];
      if (t < 0) continue;
      const g = Math.abs(t - want);
      if (g < gap) { gap = g; best = i; }
    }
    return best;
  }

  /** The share of the camera frame that covers the screen (crop to fill). */
  cover() {
    const s = Math.max(this.W / this.camW, this.H / this.camH);
    return [this.W / (this.camW * s), this.H / (this.camH * s)];
  }

  draw({ time, world, mirror, personOn }) {
    const gl = this.gl;
    const W = this.W, H = this.H;
    const u = Math.min(W, H);

    // 1. Garden.
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bgTarget.fbo);
    gl.viewport(0, 0, this.bgTarget.w, this.bgTarget.h);
    gl.useProgram(this.bg.program);
    gl.uniform2f(this.bg.u.uAspect, W / u, H / u);
    gl.uniform1f(this.bg.u.uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. You in the garden.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.scene.w, this.scene.h);
    const c = this.compose;
    gl.useProgram(c.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.bgTarget.tex); gl.uniform1i(c.u.uBg, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.camTexture); gl.uniform1i(c.u.uCam, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.maskTexture); gl.uniform1i(c.u.uMask, 2);
    gl.uniform1f(c.u.uPersonOn, personOn ? 1 : 0);
    gl.uniform2f(c.u.uStage, W, H);
    const cv = this.cover();
    gl.uniform2f(c.u.uCover, cv[0], cv[1]);
    gl.uniform1f(c.u.uMirror, mirror ? 1 : 0);
    const T = world.trap;
    gl.uniform3f(c.u.uTrap, T ? T.offX : 0, T ? T.offY : 0, T ? T.scale : 1);
    gl.uniform2f(c.u.uPivot, T ? T.pivotX : 0, T ? T.pivotY : 0);
    const clipOn = T && T.b.pop === 0;
    gl.uniform4f(c.u.uClip, clipOn ? T.b.x : 0, clipOn ? T.b.y : 0, clipOn ? T.b.r : 0, clipOn ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. To the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.blit.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(this.blit.u.uScene, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. Bubbles: smallest first, giants and "Bubble me" on top.
    const order = world.bubbles.slice().sort((a, b) => (a.trapped - b.trapped) || (a.r - b.r));
    const d = this.instanceData;
    let k = 0;
    for (const b of order) {
      if (k >= MAX_INSTANCES) break;
      const o = k * FLOATS;
      const fadeIn = Math.min(1, b.age / 0.35);
      d[o] = b.x; d[o + 1] = b.y; d[o + 2] = b.r; d[o + 3] = b.seed;
      d[o + 4] = b.squash; d[o + 5] = b.wobAxis; d[o + 6] = Math.min(b.pop, 1); d[o + 7] = b.popAngle;
      d[o + 8] = fadeIn * (b.pop > 0 ? 1 - b.pop * 0.5 : 1);
      d[o + 9] = this.layerFor(time, b.delay);
      d[o + 10] = b.filmClock;
      d[o + 11] = b.lens;
      d[o + 12] = b.freeze; d[o + 13] = b.frostAngle; d[o + 14] = b.droplet ? 1 : 0; d[o + 15] = 0;
      for (let j = 0; j < 3; j++) {
        const n = b.bonds[j];
        const q = o + 16 + j * 4;
        if (n) { d[q] = n.x; d[q + 1] = n.y; d[q + 2] = n.r; d[q + 3] = 1; }
        else { d[q] = 0; d[q + 1] = 0; d[q + 2] = 0; d[q + 3] = 0; }
      }
      k++;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (k) {
      const p = this.bubble;
      gl.useProgram(p.program);
      gl.uniform2f(p.u.uStage, W, H);
      gl.uniform1f(p.u.uMirror, mirror ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.history); gl.uniform1i(p.u.uHist, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(p.u.uScene, 1);
      gl.bindVertexArray(this.quadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, k * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
    }

    // 5. Droplets and ice.
    const parts = world.particles;
    if (parts.length) {
      const pd = this.partData;
      let n = 0;
      for (const p of parts) {
        if (n >= 1500) break;
        const life = 1 - p.age / p.life;
        const o = n * 6;
        pd[o] = p.x; pd[o + 1] = p.y; pd[o + 2] = p.size;
        pd[o + 3] = p.kind ? Math.min(1, life * 2) : life * life;
        pd[o + 4] = p.kind; pd[o + 5] = p.rot;
        n++;
      }
      gl.useProgram(this.part.program);
      gl.uniform2f(this.part.u.uStage, W, H);
      gl.uniform1f(this.part.u.uScale, this.dpr);
      gl.bindVertexArray(this.partVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pd, 0, n * 6);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    gl.bindVertexArray(null);
  }
}
