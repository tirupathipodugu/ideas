// Bubbles: the old Windows bubble screensaver, rebuilt in WebGL2. Small bubbles stream in from the
// bottom-left corner, grow as they drift, bounce off the edges and each other with a wobble, swell a
// little at the end of their life and pop into droplets. Every bubble is a thin soap film: rainbow
// interference colours that swirl and drain, a window highlight, and the live camera reflected
// across its surface, see-through in the middle and stronger towards the rim like real glass. Each
// bubble shows the camera a fraction of a second late, every one from its own moment up to 2.5 s back.

import { openCamera, cameraProblem, PROBLEMS } from './camera.js';
import { createDemoFeed } from './demo-feed.js';
import { createProgram } from './gl-utils.js';

const MAX_BUBBLES = 34;
const SPAWN_EVERY = [0.22, 0.5];       // seconds between new bubbles from the corner
const LIFE = [16, 30];                  // seconds before a bubble starts to swell
const SWELL_TIME = 1.4;                // the last breath before it pops
const SWELL = 1.16;                    // how much bigger it gets before popping
const POP_TIME = 0.14;                 // film tearing open
const DROPLET_LIFE = 0.55;
const SPEED = 1.25;                    // drift speed multiplier (15x felt far too fast; cut by 12x)
const SUBSTEPS = 3;                    // physics steps per frame, so fast bubbles never pass through each other

const canvas = document.getElementById('view');
const video = document.getElementById('cam');
const startScreen = document.getElementById('start');
const statusLine = document.getElementById('status');
const hint = document.getElementById('hint');
const soundButton = document.getElementById('sound');
const flipButton = document.getElementById('flip');
const fullButton = document.getElementById('full');

const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true });
if (!gl) statusLine.textContent = PROBLEMS.webgl;

// ---------- Shaders ----------

const BACKGROUND_VS = `#version 300 es
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

// One layer of out-of-focus light discs.
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
    float disc = smoothstep(r, r * 0.86, d) * (0.55 + 0.45 * smoothstep(r * 0.5, r, d));   // brighter rim, like a lens
    sum += tint * disc * (0.35 + 0.65 * hash(c + 3.0));
  }
  return sum;
}

void main() {
  vec2 p = vUv * uAspect;
  float t = uTime;
  float y = vUv.y;

  // Light falling from the top right through the canopy.
  vec2 sun = vec2(0.82, 1.08) * uAspect;
  float glow = exp(-2.2 * length(p - sun));

  // Foliage: big blurred masses of leaves swaying very slowly, lighter where the sun gets through.
  vec2 sway = vec2(sin(t * 0.21) * 0.03, cos(t * 0.17) * 0.02);
  float leaves = fbm(p * 2.6 + sway + vec2(0.0, t * 0.01));
  float fine = fbm(p * 7.0 - sway * 2.0 + 11.0);
  vec3 deep = vec3(0.035, 0.11, 0.045);
  vec3 mid = vec3(0.13, 0.33, 0.10);
  vec3 lit = vec3(0.56, 0.78, 0.30);
  vec3 col = mix(deep, mid, smoothstep(0.30, 0.70, leaves));
  col = mix(col, lit, smoothstep(0.55, 0.85, leaves * 0.75 + fine * 0.35) * (0.35 + 1.2 * glow) * smoothstep(0.2, 0.75, y));
  col += vec3(1.0, 0.92, 0.65) * glow * 0.55;

  // Blurred grass along the bottom: brighter blade tips catching the light.
  float ground = smoothstep(0.30, 0.0, y);
  float blades = noise(vec2(p.x * 60.0 + sin(t * 0.6 + p.x * 3.0) * 0.6, y * 3.0));
  vec3 grass = mix(vec3(0.05, 0.16, 0.04), vec3(0.30, 0.52, 0.12), blades * smoothstep(0.0, 0.25, y) + 0.2 * fine);
  col = mix(col, grass, ground * 0.85);

  // Bokeh: a big soft layer and a smaller sharper one, thickest where the sun is.
  float near = smoothstep(0.1, 0.9, y) * (0.4 + 1.6 * glow);
  col += bokeh(p + vec2(t * 0.004, 0.0), 0.22, t, vec3(0.85, 0.95, 0.55), 0.35) * 0.30 * near;
  col += bokeh(p * 1.0 + 5.0, 0.09, t * 1.3, vec3(1.0, 0.97, 0.75), 0.25) * 0.22 * near;

  // A gentle vignette and a touch of warmth, so the bubbles stand out in the middle.
  vec2 c = vUv - 0.5;
  col *= 1.0 - 0.55 * dot(c, c);
  col = pow(col, vec3(0.95));
  outColor = vec4(col, 1.0);
}`;

const BUBBLE_VS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aBody;    // x, y (css px), radius, seed
layout(location = 2) in vec4 aShape;   // squash, squash axis angle, pop progress, pop point angle
layout(location = 3) in vec4 aLook;    // fade, shimmer, history layer, -
uniform vec2 uStage;
out vec2 vP;
out vec4 vBody;
out vec4 vShape;
out vec4 vLook;
void main() {
  vec2 p = aCorner * 1.3;               // room for the squash and the pop
  vec2 px = aBody.xy + p * aBody.z;
  vec2 clip = px / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vP = p;
  vBody = aBody;
  vShape = aShape;
  vLook = aLook;
}`;

const BUBBLE_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec4 vBody;
in vec4 vShape;
in vec4 vLook;
uniform highp sampler2DArray uCam;   // the last second of camera frames, already square
uniform float uMirror;      // 1 for the front camera
uniform float uTime;
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

void main() {
  // Undo the wobble: stretched along the axis, pinched across it.
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
  vec3 n = vec3(p.x, -p.y, z);          // y up
  float seed = vBody.w;

  // The pop: a hole opens from one point and races round the film, with a bright torn edge.
  float tear = 0.0;
  if (vShape.z > 0.0) {
    vec2 at = 0.55 * vec2(cos(vShape.w), sin(vShape.w));
    float d = length(p - at);
    float hole = vShape.z * 2.4;
    float ragged = hole + 0.12 * (noise(vec3(atan(p.y - at.y, p.x - at.x) * 3.0, seed * 9.0, 0.0)) - 0.5);
    if (d < ragged) discard;
    tear = smoothstep(0.14, 0.0, d - ragged);
  }

  // Thin-film interference. The film swirls slowly and drains, so it is thinner (golds and magentas
  // turning clear) at the top and thicker (deep blues and greens) at the bottom.
  float t = uTime * (0.10 + vLook.y * 0.6);
  vec3 q = vec3(n.xy * 1.3 + seed * 13.0, t + seed * 5.0);
  vec2 swirl = vec2(fbm(q), fbm(q + 4.7)) - 0.5;
  float film = fbm(vec3(n.xy * 1.6 + swirl * 1.8 + seed * 3.0, t * 0.7));
  float thickness = 280.0 + 640.0 * film - 170.0 * n.y;
  float cosT = sqrt(1.0 - rr * rr / (1.33 * 1.33));
  vec3 lambda = vec3(650.0, 532.0, 450.0);
  vec3 iri = 0.5 - 0.5 * cos(12.566 * 1.33 * thickness * cosT / lambda);
  iri = mix(vec3(dot(iri, vec3(0.333))), iri, 1.15);   // a touch more saturated
  iri = clamp(iri, 0.0, 1.0);

  float rim = pow(1.0 - z, 2.0);
  float fres = 0.04 + 0.96 * pow(1.0 - z, 4.0);

  // The camera, reflected off the curved film: squeezed towards the rim like a convex mirror,
  // with a little wobble where the film flows.
  vec2 m = p * (0.92 - 0.22 * (1.0 - z)) + swirl * 0.025;
  if (uMirror > 0.5) m.x = -m.x;
  vec2 uv = 0.5 + 0.5 * m;
  vec3 cam = texture(uCam, vec3(uv, vLook.z)).rgb;
  cam = pow(cam, vec3(0.9)) * 1.15;
  float camA = mix(0.20, 0.70, rim);
  vec3 col = cam * camA * mix(vec3(1.0), 0.55 + 0.9 * iri, 0.35);

  // Film colour, strongest at the rim.
  float filmA = 0.05 + 0.75 * fres + 0.18 * rim;
  col += iri * filmA * 0.75;

  // Highlights: a soft square window up-left (the Vista look) and a small bounce down-right.
  vec2 h = n.xy - vec2(-0.40, 0.46);
  float box = max(abs(h.x) * 1.05, abs(h.y));
  float win = smoothstep(0.22, 0.11, box) * smoothstep(-0.05, 0.25, z);
  win *= 0.8 + 0.2 * smoothstep(0.012, 0.03, min(abs(h.x), abs(h.y)));   // a faint window cross
  float spot = smoothstep(0.10, 0.0, length(n.xy - vec2(0.44, -0.50)));
  float spec = win * 0.6 + spot * 0.4;
  col += vec3(spec);

  // A thin bright edge where you look through the most film.
  float edge = smoothstep(0.93, 1.0, rr);
  col += (0.35 + 0.65 * iri) * edge * 0.55;

  col += vec3(1.0) * tear * 0.9;
  float alpha = clamp(camA * 0.9 + filmA * 0.45 + spec + edge * 0.4 + tear, 0.0, 1.0);
  float fade = vLook.x * coverage;
  outColor = vec4(col * fade, alpha * fade);
}`;

const DROP_VS = `#version 300 es
layout(location = 0) in vec4 aDrop;    // x, y, size, alpha
uniform vec2 uStage;
uniform float uScale;
out float vAlpha;
void main() {
  vec2 clip = aDrop.xy / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = aDrop.z * uScale;
  vAlpha = aDrop.w;
}`;

const DROP_FS = `#version 300 es
precision mediump float;
in float vAlpha;
out vec4 outColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float body = smoothstep(1.0, 0.6, r) * 0.35 + smoothstep(0.35, 0.0, length(p - vec2(-0.3, -0.3))) * 0.9;
  float a = (smoothstep(1.0, 0.75, r) * 0.45 + body * 0.5) * vAlpha;
  outColor = vec4(vec3(0.85, 0.93, 1.0) * a + body * vAlpha * 0.4, a);
}`;

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

// ---------- GL setup ----------

let bg, bubbleProgram, dropProgram, captureProgram, quadVao, dropVao, instanceBuffer, dropBuffer, camTexture;

// Video history: a ring of square frames covering about the last second. Each bubble reads the frame
// from its own moment in the past, so every bubble shows you a fraction of a second late.
const HISTORY = 80;
const HISTORY_SIZE = 256;
const DELAY = [0.2, 2.5];             // seconds
let history, historyFbo;
const historyTimes = new Float64Array(HISTORY).fill(-1);
let historyHead = -1;
const FLOATS = 12;
const instanceData = new Float32Array(MAX_BUBBLES * 2 * FLOATS);
const dropData = new Float32Array(1024 * 4);

function setupGL() {
  bg = createProgram(gl, BACKGROUND_VS, BACKGROUND_FS);
  bubbleProgram = createProgram(gl, BUBBLE_VS, BUBBLE_FS);
  dropProgram = createProgram(gl, DROP_VS, DROP_FS);
  captureProgram = createProgram(gl, BACKGROUND_VS, CAPTURE_FS);

  history = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, history);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, HISTORY_SIZE, HISTORY_SIZE, HISTORY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  historyFbo = gl.createFramebuffer();

  quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  instanceBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(1 + i);
    gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FLOATS * 4, i * 16);
    gl.vertexAttribDivisor(1 + i, 1);
  }

  dropVao = gl.createVertexArray();
  gl.bindVertexArray(dropVao);
  dropBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dropBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, dropData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  camTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, camTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 26, 36, 255]));
}

// ---------- Stage ----------

let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}
window.addEventListener('resize', resize);
resize();
const unit = () => Math.min(W, H);          // sizes scale with the short side of the screen

// ---------- Sound: a pop is a tiny noise burst plus a quick falling blip ----------

const sound = {
  ctx: null,
  noise: null,
  on: (() => { try { return localStorage.getItem('bubbles:sound') !== 'off'; } catch { return true; } })(),
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = this.ctx.sampleRate * 0.25;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  pop(size) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const big = Math.min(1, size / (unit() * 0.15));
    const level = 0.12 + 0.28 * big;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600 - 1300 * big + Math.random() * 500;
    band.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(band).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.06);

    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    const f = 1100 - 500 * big + Math.random() * 200;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.35, t + 0.05);
    og.gain.setValueAtTime(level * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(og).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  },
};

function showSound() {
  soundButton.setAttribute('aria-pressed', String(sound.on));
  soundButton.innerHTML = sound.on ? '<span aria-hidden="true">🔊</span> Sound on' : '<span aria-hidden="true">🔇</span> Sound off';
}
showSound();
soundButton.addEventListener('click', () => {
  sound.on = !sound.on;
  sound.unlock();
  try { localStorage.setItem('bubbles:sound', sound.on ? 'on' : 'off'); } catch { /* private mode */ }
  showSound();
});

// ---------- Bubbles ----------

const rand = (a, b) => a + Math.random() * (b - a);
const bubbles = [];
const drops = [];
let nextSpawn = 0;

function blow(x, y, vx, vy, startR) {
  if (bubbles.length >= MAX_BUBBLES) {
    const oldest = bubbles.find(b => b.pop === 0);
    if (oldest) startPop(oldest);
  }
  const u = unit();
  bubbles.push({
    x, y, vx, vy,
    r: startR,
    target: u * rand(0.045, 0.12),
    age: 0,
    life: rand(LIFE[0], LIFE[1]),
    seed: Math.random(),
    squash: 0, wobAmp: 0, wobT: 0, wobAxis: 0,
    pop: 0, popAngle: 0,
    shimmer: rand(0, 0.15),
    delay: rand(DELAY[0], DELAY[1]),
  });
}

function spawnFromCorner() {
  if (bubbles.length >= MAX_BUBBLES) return;   // full screen: wait for a natural pop instead of forcing one
  const u = unit();
  const a = rand(-1.25, -0.3);               // up and to the right
  const speed = u * rand(0.22, 0.42) * SPEED;
  blow(u * 0.03 + rand(0, 10), H - u * 0.03 - rand(0, 10), Math.cos(a) * speed, Math.sin(a) * speed, u * rand(0.010, 0.02));
}

function wobble(b, amount, angle) {
  b.wobAmp = Math.min(0.22, Math.max(Math.abs(b.squash), amount));
  b.wobT = 0;
  b.wobAxis = angle;
}

function startPop(b, fromX, fromY) {
  if (b.pop > 0) return;
  b.pop = 0.0001;
  b.popAngle = fromX === undefined ? rand(0, Math.PI * 2) : Math.atan2(fromY - b.y, fromX - b.x);
  sound.pop(b.r);
  // Droplets fly out from the rim, mostly away from where it tore.
  const n = 10 + Math.round(b.r / unit() * 120);
  for (let i = 0; i < n && drops.length < 1000; i++) {
    const a = rand(0, Math.PI * 2);
    const s = b.r * rand(1.2, 3.5);
    drops.push({
      x: b.x + Math.cos(a) * b.r * rand(0.6, 1),
      y: b.y + Math.sin(a) * b.r * rand(0.6, 1),
      vx: Math.cos(a) * s + b.vx * 0.05,
      vy: Math.sin(a) * s + b.vy * 0.05,
      size: rand(1.5, 4.5) * (0.6 + b.r / unit() * 5),
      age: 0,
    });
  }
}

function step(dt) {
  const u = unit();
  nextSpawn -= dt;
  if (nextSpawn <= 0) {
    spawnFromCorner();
    nextSpawn = rand(SPAWN_EVERY[0], SPAWN_EVERY[1]);
  }

  for (const b of bubbles) {
    b.age += dt;
    if (b.pop > 0) {
      b.pop += dt / POP_TIME;
      continue;
    }
    // Grow towards full size; at the end of life swell a little, shimmer faster, then pop.
    const swelling = b.age > b.life;
    const goal = swelling ? b.target * SWELL : b.target;
    b.r += (goal - b.r) * (1 - Math.exp(-dt / (swelling ? 0.5 : 1.4)));
    if (swelling) {
      b.shimmer = Math.min(1, b.shimmer + dt * 1.5);
      if (b.wobAmp < 0.03) wobble(b, 0.04, rand(0, Math.PI));
      if (b.age > b.life + SWELL_TIME) startPop(b);
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // Keep drifting at a lazy screensaver pace: never stall, never race.
    const sp = Math.hypot(b.vx, b.vy);
    const want = Math.min(Math.max(sp, u * 0.16 * SPEED), u * 0.5 * SPEED);
    if (sp > 0) { b.vx *= want / sp; b.vy *= want / sp; }

    // Edges.
    if (b.x - b.r < 0 && b.vx < 0) { b.x = b.r; b.vx = -b.vx; wobble(b, Math.abs(b.vx) / (u * SPEED) * 0.5, 0); }
    if (b.x + b.r > W && b.vx > 0) { b.x = W - b.r; b.vx = -b.vx; wobble(b, Math.abs(b.vx) / (u * SPEED) * 0.5, 0); }
    if (b.y - b.r < 0 && b.vy < 0) { b.y = b.r; b.vy = -b.vy; wobble(b, Math.abs(b.vy) / (u * SPEED) * 0.5, Math.PI / 2); }
    if (b.y + b.r > H && b.vy > 0 && b.age > 1.5) { b.y = H - b.r; b.vy = -b.vy; wobble(b, Math.abs(b.vy) / (u * SPEED) * 0.5, Math.PI / 2); }

    // Wobble: a damped squash-and-stretch after every bump.
    b.wobT += dt;
    b.squash = b.wobAmp * Math.exp(-3.2 * b.wobT) * Math.sin(17 * b.wobT);
    if (b.wobT > 2) b.wobAmp = 0;
  }

  // Bubbles bounce off each other (mass by area), softly.
  for (let i = 0; i < bubbles.length; i++) {
    const a = bubbles[i];
    if (a.pop > 0) continue;
    for (let j = i + 1; j < bubbles.length; j++) {
      const b = bubbles[j];
      if (b.pop > 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const min = a.r + b.r;
      if (dist >= min || dist === 0) continue;
      const nx = dx / dist, ny = dy / dist;
      const ma = a.r * a.r, mb = b.r * b.r;
      const push = (min - dist);
      a.x -= nx * push * mb / (ma + mb);
      a.y -= ny * push * mb / (ma + mb);
      b.x += nx * push * ma / (ma + mb);
      b.y += ny * push * ma / (ma + mb);
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel < 0) {
        const k = (1.9 * rel) / (ma + mb);
        a.vx += k * mb * nx; a.vy += k * mb * ny;
        b.vx -= k * ma * nx; b.vy -= k * ma * ny;
        const angle = Math.atan2(ny, nx);
        wobble(a, Math.abs(rel) / (u * SPEED) * 0.6, angle);
        wobble(b, Math.abs(rel) / (u * SPEED) * 0.6, angle);
      }
    }
  }

  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].pop >= 1) bubbles.splice(i, 1);

  for (const d of drops) {
    d.age += dt;
    d.vx *= 1 - dt * 2.5;
    d.vy = d.vy * (1 - dt * 2.5) + u * 1.6 * dt;   // a little gravity
    d.x += d.vx * dt;
    d.y += d.vy * dt;
  }
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].age > DROPLET_LIFE) drops.splice(i, 1);
}

// ---------- Camera ----------

let source = null;
let facing = 'user';

async function startCamera() {
  try {
    const cam = await openCamera(video, facing);
    source?.stop();
    source = cam;
    return true;
  } catch (error) {
    statusLine.textContent = PROBLEMS[cameraProblem(error)];
    return false;
  }
}

function uploadFrame(time) {
  if (!source || !source.takeFrame() || !source.width) return;
  gl.bindTexture(gl.TEXTURE_2D, camTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.element);

  historyHead = (historyHead + 1) % HISTORY;
  historyTimes[historyHead] = time;
  gl.bindFramebuffer(gl.FRAMEBUFFER, historyFbo);
  gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, history, 0, historyHead);
  gl.viewport(0, 0, HISTORY_SIZE, HISTORY_SIZE);
  gl.useProgram(captureProgram.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, camTexture);
  gl.uniform1i(captureProgram.u.uFrame, 0);
  const s = camScale();
  gl.uniform2f(captureProgram.u.uCropScale, s[0], s[1]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/** The history layer closest to `delay` seconds ago (the oldest one we have, early on). */
function layerFor(time, delay) {
  const want = time - delay;
  let best = Math.max(historyHead, 0), bestGap = Infinity;
  for (let i = 0; i < HISTORY; i++) {
    const t = historyTimes[i];
    if (t < 0) continue;
    const gap = Math.abs(t - want);
    if (gap < bestGap) { bestGap = gap; best = i; }
  }
  return best;
}

function camScale() {
  const w = source?.width || 1, h = source?.height || 1;
  return w > h ? [h / w, 1] : [1, w / h];
}

// ---------- Draw ----------

function render(time) {
  uploadFrame(time);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.useProgram(bg.program);
  gl.uniform2f(bg.u.uAspect, W / unit(), H / unit());
  gl.uniform1f(bg.u.uTime, time);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // Pack the bubbles, smallest first so big ones sit on top.
  const order = bubbles.slice().sort((a, b) => a.r - b.r);
  let k = 0;
  for (const b of order) {
    const fadeIn = Math.min(1, b.age / 0.35);
    instanceData.set([
      b.x, b.y, b.r, b.seed,
      b.squash, b.wobAxis, Math.min(b.pop, 1), b.popAngle,
      fadeIn * (b.pop > 0 ? 1 - b.pop * 0.5 : 1), b.shimmer, layerFor(time, b.delay), 0,
    ], k * FLOATS);
    k++;
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  if (k) {
    gl.useProgram(bubbleProgram.program);
    gl.uniform2f(bubbleProgram.u.uStage, W, H);
    gl.uniform1f(bubbleProgram.u.uTime, time);
    gl.uniform1f(bubbleProgram.u.uMirror, facing === 'user' && source?.element === video ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, history);
    gl.uniform1i(bubbleProgram.u.uCam, 0);
    gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, k * FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
  }

  if (drops.length) {
    let n = 0;
    for (const d of drops) {
      const life = 1 - d.age / DROPLET_LIFE;
      dropData.set([d.x, d.y, d.size, life * life], n * 4);
      n++;
    }
    gl.useProgram(dropProgram.program);
    gl.uniform2f(dropProgram.u.uStage, W, H);
    gl.uniform1f(dropProgram.u.uScale, dpr);
    gl.bindVertexArray(dropVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dropBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dropData, 0, n * 4);
    gl.drawArrays(gl.POINTS, 0, n);
  }
  gl.bindVertexArray(null);
}

let last = 0;
function frame(now) {
  const t = now / 1000;
  const dt = Math.min(0.05, last ? t - last : 0.016);
  last = t;
  for (let i = 0; i < SUBSTEPS; i++) step(dt / SUBSTEPS);
  render(t);
  requestAnimationFrame(frame);
}

// ---------- Input ----------

canvas.addEventListener('pointerdown', e => {
  sound.unlock();
  const hit = bubbles
    .filter(b => b.pop === 0 && Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r * 1.05)
    .sort((a, b) => a.r - b.r)[0];
  if (hit) {
    startPop(hit, e.clientX, e.clientY);
  } else {
    const a = rand(0, Math.PI * 2);
    const s = unit() * 0.25 * SPEED;
    blow(e.clientX, e.clientY, Math.cos(a) * s, Math.sin(a) * s - s * 0.5, unit() * 0.02);
  }
  hint.style.opacity = '0';
});

flipButton.addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  if (!(await startCamera())) facing = facing === 'user' ? 'environment' : 'user';
});

fullButton.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});
if (!document.documentElement.requestFullscreen) fullButton.hidden = true;

document.addEventListener('visibilitychange', () => {
  if (document.hidden) sound.ctx?.suspend();
  else if (sound.on) sound.ctx?.resume();
});

// ---------- Start ----------

function begin() {
  sound.unlock();
  startScreen.hidden = true;
  setTimeout(() => { hint.style.opacity = '0'; }, 7000);
}

if (gl) {
  setupGL();
  for (let i = 0; i < 10; i++) {
    spawnFromCorner();
    const b = bubbles[bubbles.length - 1];
    b.x = rand(0.2, 0.8) * W;
    b.y = rand(0.2, 0.7) * H;
    b.r = b.target * 0.8;
    b.age = rand(1, 4);
  }
  requestAnimationFrame(frame);

  document.getElementById('go').addEventListener('click', async () => {
    statusLine.textContent = 'Opening camera…';
    if (await startCamera()) begin();
  });
  document.getElementById('nocam').addEventListener('click', () => {
    source = createDemoFeed();
    flipButton.hidden = true;
    begin();
  });
}
