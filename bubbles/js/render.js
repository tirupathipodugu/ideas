// Renderer (WebGL2). Each frame:
//  1. the scene: the live camera, with you cut out of it (your person mask), moved and clipped into
//     the "Bubble me" bubble when that is running;
//  2. the scene copied to the screen;
//  3. the bubbles, which bend the scene behind them like lenses (soap bubbles magnify a little, thick
//     water-drop bubbles flip it upside down), carry the delayed camera as a reflection, swirl with
//     thin-film colour, share flat walls where they have joined, and grow frost when held;
//  4. droplets and ice shards.

import { createProgram } from './gl-utils.js';

const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  vUv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

// The live camera as the background. While "Bubble me" carries you away, your cut-out moves and
// a soft shadow stays where you stood. Under water (uWater) the camera is replaced by open sea (a sandy
// floor with rocks and swaying kelp; your face only appears in the diver's helmet), the whole view ripples as if seen through
// moving water, colours shift blue-green and darken with depth (water soaks up red first), caustics
// dance over everything, sun rays slant down from a shimmering surface, and specks drift past.
const COMPOSE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uCam;
uniform sampler2D uMask;
uniform float uPersonOn;
uniform vec2 uStage;
uniform vec2 uCover;        // the share of the camera frame that fills the screen
uniform float uMirror;
uniform vec3 uTrap;         // offset x, offset y (px), scale
uniform vec2 uPivot;        // px
uniform vec4 uClip;         // bubble centre x, y, radius (px), on
uniform float uWater;       // 0 in the air .. 1 under water
uniform float uTime;
uniform sampler2D uFlow;    // the water's velocity, px/s (fluid.js)
uniform sampler2D uSea;     // the sea life layer (sea.js), straight alpha
out vec4 outColor;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Open water: brighter towards the surface, a rippled sandy floor with dark rocks, and two layers of
// kelp swaying in the current (the far layer fainter).
vec3 ocean(vec2 sp, vec2 uv, float t) {
  float y = uv.y;
  vec3 col = mix(vec3(0.62, 0.92, 1.0), vec3(0.32, 0.62, 0.82), smoothstep(0.0, 0.55, y));
  col = mix(col, vec3(0.16, 0.36, 0.55), smoothstep(0.55, 1.0, y));
  float floorY = 0.84 + 0.03 * sin(sp.x * 2.3) + 0.015 * sin(sp.x * 5.7 + 1.0);
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    float spacing = 0.3 - fl * 0.07;
    float x = sp.x + 0.37 * fl;
    float id = floor(x / spacing);
    float h = h21(vec2(id, fl + 3.0));
    if (h < 0.3) continue;
    float height = 0.3 + 0.4 * h;
    float k = clamp((floorY - y) / height, 0.0, 1.0);
    float sway = (sin(t * 0.6 + id * 1.7 + y * 3.0) * 0.05 + sin(t * 1.1 + id * 2.3 + y * 8.0) * 0.012) * k;
    float baseX = (id + 0.3 + 0.4 * h) * spacing;
    float dx = abs(x - baseX - sway);
    float w = (0.011 + 0.006 * fl) * (1.0 - 0.6 * k);
    float leaf = pow(abs(sin(y * 38.0 + id * 3.0)), 6.0) * 0.02 * (1.0 - k * 0.5);   // blades along the stalk
    float kelp = smoothstep(w + leaf, (w + leaf) * 0.5, dx) * step(floorY - height, y) * step(y, floorY + 0.03);
    vec3 kc = mix(vec3(0.18, 0.42, 0.26), vec3(0.12, 0.34, 0.16), fl) * (0.75 + 0.35 * (1.0 - y));
    col = mix(col, kc, kelp * (0.45 + 0.4 * fl));
  }
  float sand = smoothstep(floorY, floorY + 0.008, y);
  float ripple = 0.8 + 0.2 * sin(sp.x * 42.0 + sin(sp.x * 6.0 + y * 20.0) * 3.0 + y * 70.0);
  col = mix(col, vec3(0.86, 0.8, 0.62) * ripple, sand);
  float rockTop = floorY - 0.06 * max(0.0, sin(sp.x * 2.7 + 0.8)) * (0.6 + 0.4 * sin(sp.x * 9.1)) - 0.01;
  float rock = smoothstep(rockTop, rockTop + 0.006, y) * step(y, floorY + 0.06);
  col = mix(col, mix(vec3(0.22, 0.26, 0.3), vec3(0.4, 0.45, 0.48), smoothstep(rockTop + 0.03, rockTop, y)), rock);
  return col;
}

// Light focused by the moving surface into bright wandering lines (a classic iterative caustic).
float caustic(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uStage;
  float unit = min(uStage.x, uStage.y);
  vec2 sp = px / unit;
  float t = uTime;
  vec2 wob = vec2(sin(sp.y * 9.0 + t * 1.7) + sin(sp.x * 5.0 - t * 1.3),
                  cos(sp.x * 8.0 + t * 1.5) + sin(sp.y * 6.0 + t * 1.1));
  px += wob * 0.004 * unit * uWater;
  vec2 flow = texture(uFlow, px / uStage).rg;
  px -= flow * 0.03 / (1.0 + length(flow) * 0.002) * uWater;    // stirred water bends the view
  vec2 rs = px / uStage;
  if (uMirror > 0.5) rs.x = 1.0 - rs.x;
  vec2 ruv = 0.5 + (rs - 0.5) * uCover;
  vec3 bg = texture(uCam, ruv).rgb;
  bool moving = uTrap.z != 1.0 || uTrap.x != 0.0 || uTrap.y != 0.0;
  if (uPersonOn > 0.5 && moving) bg *= 1.0 - 0.75 * smoothstep(0.3, 0.7, texture(uMask, ruv).r);
  vec3 col = bg;
  if (uPersonOn > 0.5 && moving) {
    vec2 q = uPivot + (px - uPivot - uTrap.xy) / uTrap.z;
    vec2 s = q / uStage;
    if (uMirror > 0.5) s.x = 1.0 - s.x;
    vec2 cuv = 0.5 + (s - 0.5) * uCover;
    if (cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0) {
      float a = smoothstep(0.3, 0.7, texture(uMask, cuv).r);
      if (uClip.w > 0.5) a *= smoothstep(uClip.z, uClip.z * 0.93, length(px - uClip.xy));
      vec3 cam = texture(uCam, cuv).rgb;
      col = mix(bg, cam, a);
    }
  }
  col = mix(col, ocean(px / unit, px / uStage, t), uWater);
  vec4 life = texture(uSea, px / uStage);
  col = mix(col, life.rgb, life.a * uWater);
  if (uWater > 0.0) {
    float depth = clamp(px.y / uStage.y, 0.0, 1.0);    // 0 at the surface, 1 at the bottom
    vec3 under = col * mix(vec3(0.55, 0.86, 0.95), vec3(0.16, 0.48, 0.68), depth)
               + vec3(0.0, 0.06, 0.11) * (1.0 - depth * 0.5);
    float c = caustic(sp * 0.8 + vec2(0.0, t * 0.015), t * 0.4);
    under += vec3(0.55, 0.9, 1.0) * c * 0.38 * (1.0 - depth * 0.7);
    float x = sp.x + sp.y * 0.35;
    float rays = pow(0.5 + 0.5 * sin(x * 7.0 + t * 0.3), 6.0)
               + 0.6 * pow(0.5 + 0.5 * sin(x * 13.0 - t * 0.21 + 1.7), 8.0)
               + 0.4 * pow(0.5 + 0.5 * sin(x * 3.1 + t * 0.13 + 4.0), 4.0);
    under += vec3(0.6, 0.9, 1.0) * rays * 0.13 * (1.0 - depth) * (1.0 - depth);
    float edge = depth + 0.012 * sin(sp.x * 20.0 + t * 2.0) + 0.008 * sin(sp.x * 37.0 - t * 3.1);
    under += vec3(0.75, 0.95, 1.0) * smoothstep(0.07, 0.0, edge) * 0.5;
    for (int L = 0; L < 2; L++) {
      float g = L == 0 ? 0.06 : 0.11;
      float sp2 = 1.0 + float(L);
      vec2 q = sp / g + vec2(sin(t * 0.2 + float(L)) * 0.6, t * 0.18 * sp2);
      vec2 id = floor(q);
      float hh = h21(id + float(L) * 17.0);
      if (hh > 0.6) {
        vec2 pos = vec2(h21(id + 3.1), h21(id + 7.7)) * 0.8 + 0.1;
        float d = length(fract(q) - pos);
        under += vec3(0.75, 0.92, 1.0) * smoothstep(0.07 * sp2, 0.0, d) * (0.12 + 0.12 * sin(t * 2.0 + hh * 40.0)) * sp2;
      }
    }
    vec2 v = vUv - 0.5;
    under *= 1.0 - 0.7 * dot(v, v);
    col = mix(col, under, uWater);
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
  float reach = 1.3 + max(aShape.x, 0.0) + aFrost.w * 1.5;   // stretched films and jelly need room
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
uniform float uWater;       // under water these are air bubbles: silvery, and they shrink what's behind
uniform float uTime;        // world time (slows with slow motion)
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

  // Under water: big bubbles are squat with a flatter bottom, and wobble like jelly (shape modes 2
  // and 3 ringing at their own rates; bigger bubbles ring slower).
  float seedJ = vBody.w;
  if (uWater > 0.0) {
    float unit = min(uStage.x, uStage.y);
    float squat = uWater * clamp((vBody.z / unit - 0.035) * 2.2, 0.0, 0.14);
    p.y *= 1.0 + squat * (p.y > 0.0 ? 1.8 : 0.6);
  }
  float jel = vFrost.w;
  if (jel > 0.0) {
    float th = atan(p.y, p.x);
    float slow = 1.0 / (1.0 + vBody.z / min(uStage.x, uStage.y) * 12.0);
    float def = jel * (cos(2.0 * (th - seedJ * 6.0)) * sin(uTime * 11.0 * slow + seedJ * 9.0)
                     + 0.6 * cos(3.0 * (th + seedJ * 4.0)) * sin(uTime * 17.0 * slow + seedJ * 3.0));
    p /= 1.0 + def;
  }

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
  k = mix(k, 1.45 + 0.9 * rr * rr, uWater);              // an air pocket in water is a diverging lens
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
  vec2 mirrorPx = c0 - (px - c0) * 1.6;                    // under water: the sea, upside down, not you
  cam = mix(cam, texture(uScene, clamp(vec2(mirrorPx.x, uStage.y - mirrorPx.y) / uStage, 0.0, 1.0)).rgb, uWater);
  cam = pow(cam, vec3(0.9)) * 1.15;
  float camA = mix(0.18, 0.62, rim) * (drop > 0.5 ? 0.35 : 1.0);
  col = mix(col, cam * mix(vec3(1.0), 0.55 + 0.9 * iri, 0.35), camA);

  iri = mix(iri, vec3(0.88, 0.97, 1.0), 0.7 * uWater);     // no soap film under water, just air and light
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
  // Seen from the water, the rim reflects everything (total internal reflection): a dark band inside
  // a bright silver ring.
  col *= 1.0 - 0.35 * uWater * smoothstep(0.74, 0.88, rr) * smoothstep(0.99, 0.9, rr);
  col += vec3(0.85, 0.96, 1.0) * edge * 0.6 * uWater;
  col += (0.35 + 0.65 * iri) * edge * 0.55;
  col += (0.5 + 0.5 * iri) * wall * 0.6;
  col += vec3(1.0) * tear * 0.9;

  float fade = vLook.x * coverage;
  outColor = vec4(col * fade, fade);
}`;

const PART_VS = `#version 300 es
layout(location = 0) in vec4 aPart;    // x, y, size, alpha
layout(location = 1) in vec2 aKind;    // kind (0 drop, 1 ice, 2 glowing plankton), rotation
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
  if (vKind.x > 1.5) {
    // Glowing plankton: a soft cyan halo round a white-hot core, added on top (alpha 0 = additive).
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    float halo = exp(-r2 * 4.0) * vAlpha, core = exp(-r2 * 40.0) * vAlpha;
    outColor = vec4(vec3(0.35, 1.0, 0.95) * halo * 1.6 + vec3(1.0) * core * 1.5, 0.0);
  } else if (vKind.x < 0.5) {
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
const MAX_INSTANCES = 96;
const HISTORY = 80;
const HISTORY_SIZE = 256;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true });
    this.gl = gl;
    if (!gl) return;
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
    this.seaTexture = this.texture2D(1, 1, new Uint8Array([0, 0, 0, 0]));
    this.flowTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
    this.sampling(gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, 1, 1, 0, gl.RG, gl.FLOAT, new Float32Array(2));

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
  }

  /** The sea life layer (a 2D canvas the size of the screen). */
  uploadSea(canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.seaTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  /** The water's velocity field, for bending the view where it was stirred. */
  uploadFlow(fluid) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.flowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, fluid.w, fluid.h, 0, gl.RG, gl.FLOAT, fluid.pack());
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

  draw({ time, dt = 0.016, world, mirror, personOn }) {
    const gl = this.gl;
    this.waterMix = (this.waterMix ?? (world.water ? 1 : 0)) + ((world.water ? 1 : 0) - (this.waterMix ?? 0)) * Math.min(1, dt * 2);
    const W = this.W, H = this.H;
    const u = Math.min(W, H);

    // 1. The camera behind everything (and you, when "Bubble me" moves you).
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, this.scene.w, this.scene.h);
    const c = this.compose;
    gl.useProgram(c.program);
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
    gl.uniform1f(c.u.uWater, this.waterMix);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.flowTexture); gl.uniform1i(c.u.uFlow, 3);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.seaTexture); gl.uniform1i(c.u.uSea, 4);
    gl.uniform1f(c.u.uTime, time % 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. To the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.blit.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(this.blit.u.uScene, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. Bubbles: smallest first, giants and "Bubble me" on top.
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
      d[o + 12] = b.freeze; d[o + 13] = b.frostAngle; d[o + 14] = b.droplet ? 1 : 0; d[o + 15] = b.jelly;
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
      gl.uniform1f(p.u.uWater, this.waterMix);
      gl.uniform1f(p.u.uTime, world.time % 1000);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.history); gl.uniform1i(p.u.uHist, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex); gl.uniform1i(p.u.uScene, 1);
      gl.bindVertexArray(this.quadVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, k * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, k);
    }

    // 4. Droplets, ice and glowing plankton.
    const parts = world.particles;
    if (parts.length) {
      const pd = this.partData;
      let n = 0;
      for (const p of parts) {
        if (n >= 1500) break;
        const life = 1 - p.age / p.life;
        const o = n * 6;
        pd[o] = p.x; pd[o + 1] = p.y; pd[o + 2] = p.size;
        pd[o + 3] = p.kind === 2 ? Math.min(1, life * 1.5) * (0.55 + 0.45 * Math.sin(p.age * 9 + p.rot * 10))
          : p.kind ? Math.min(1, life * 2) : life * life;
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
