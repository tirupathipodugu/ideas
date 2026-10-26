// WebGL2 renderer: one full-screen pass. For each screen pixel it adds up where every body part's
// deformer says that pixel should come from (an inverse warp), then takes the camera pixel there only if
// it is the person (from the pose mask). Everything else stays the live background, so walls and door
// frames never bend. Where a leaner body uncovers background, it is filled by stepping outward until
// the mask ends. Last, the torso gets a little shading: rounder flanks and a soft fold above the
// waistband once the belly has filled out.

import { MAX_DEFORMERS } from './rig.js';

const N = MAX_DEFORMERS;

const VS = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform vec2 u_res;
uniform vec4 u_map;          // video drawn at x, y, w, h (canvas px)
uniform float u_mirror;
uniform int u_count;
uniform vec4 u_seg[${N}];    // A.xy, B.xy
uniform vec4 u_keys[${N}];   // width scale at t = 0, 1/3, 2/3, 1
uniform vec4 u_asym[${N}];   // extra on the front side at the same points (signed)
uniform vec4 u_along[${N}];  // fade in from x to y, fade out from z to w (in t)
uniform vec4 u_shape[${N}];  // half-width at A, at B, radial fade start, end (in half-widths)
uniform float u_amp[${N}];
uniform float u_step;        // fill step, px
uniform vec2 u_torsoShade;   // round, fold
uniform int u_debug;
out vec4 o;

vec2 toUV(vec2 p) {
  vec2 uv = (p - u_map.xy) / u_map.zw;
  uv.x = mix(uv.x, 1.0 - uv.x, u_mirror);
  return uv;
}
float keyAt(vec4 k, float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  if (t < 1.0) return mix(k.x, k.y, t);
  if (t < 2.0) return mix(k.y, k.z, t - 1.0);
  return mix(k.z, k.w, t - 2.0);
}

// Inverse displacement: the screen pixel p shows the camera pixel at p - d.
// torso: t along the torso, u across it in output half-widths, and its weight.
vec2 displacement(vec2 p, out vec3 torso) {
  vec2 d = vec2(0.0);
  torso = vec3(0.0, 9.0, 0.0);
  for (int i = 0; i < ${N}; i++) {
    if (i >= u_count) break;
    vec2 A = u_seg[i].xy, B = u_seg[i].zw;
    vec2 ab = B - A;
    float L = max(length(ab), 1.0);
    vec2 dir = ab / L;
    vec2 n = vec2(-dir.y, dir.x);
    vec2 r = p - A;
    float t = dot(r, dir) / L;
    float u = dot(r, n);
    vec4 al = u_along[i];
    float wAlong = smoothstep(al.x, al.y, t) * (1.0 - smoothstep(al.z, al.w, t));
    if (wAlong <= 0.0) continue;
    float edge = mix(u_shape[i].x, u_shape[i].y, clamp(t, 0.0, 1.0));
    float sgn = u >= 0.0 ? 1.0 : -1.0;
    float s = keyAt(u_keys[i], t) * (1.0 + keyAt(u_asym[i], t) * sgn);
    s = max(s, -0.35);
    float au = abs(u);
    float wRad = 1.0 - smoothstep(u_shape[i].z * edge, u_shape[i].w * edge, au);
    float w = wAlong * wRad * u_amp[i];
    if (w <= 0.0) continue;
    // Inside the new outline: scale about the axis. Beyond it: carry everything by the edge's own
    // shift (so an arm against the torso moves out with it instead of being stretched).
    float shift = s / (1.0 + s) * min(au, edge * (1.0 + s));
    d += n * sgn * shift * w;
    if (i == 0) torso = vec3(t, au / max(1.0, edge * (1.0 + s)), w);
  }
  return d;
}

float person(vec2 p) { return texture(u_mask, toUV(p)).r; }

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 uv = toUV(p);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { o = vec4(0.02, 0.02, 0.024, 1.0); return; }
  vec3 here = texture(u_tex, uv).rgb;
  vec3 torso;
  vec2 d = displacement(p, torso);
  if (u_debug == 1) {
    float m = person(p);
    o = vec4(mix(here, vec3(0.1, 1.0, 0.6), 0.35 * m) + vec3(clamp(length(d) / 20.0, 0.0, 1.0), 0.0, 0.0), 1.0);
    return;
  }
  if (dot(d, d) < 0.0004 && torso.z <= 0.0) { o = vec4(here, 1.0); return; }

  vec2 src = p - d;
  vec3 moved = texture(u_tex, toUV(src)).rgb;
  float isPerson = smoothstep(0.35, 0.65, person(src));
  vec3 bg = here;
  float wasPerson = smoothstep(0.2, 0.6, person(p));
  if (wasPerson > 0.0 && isPerson < 0.99) {
    // Background a leaner body has uncovered: take the background just outside the old outline (the
    // same few pixels the body moved), which stays continuous with its neighbours.
    bg = mix(here, moved, wasPerson);
  }
  vec3 c = mix(bg, moved, isPerson);

  // Torso shading, on the person only.
  if (torso.z > 0.0 && isPerson > 0.0) {
    float t = torso.x, x = torso.y;
    float body = smoothstep(0.15, 0.3, t) * (1.0 - smoothstep(1.0, 1.12, t)) * torso.z * isPerson;
    // Rounder flanks: the sides turn away from the light a little sooner.
    float flank = u_torsoShade.x * 0.13 * smoothstep(0.6, 1.0, x) * (1.0 - smoothstep(1.0, 1.15, x));
    // A soft fold above the waistband, dipping in the middle where the belly hangs lowest.
    float tf = 0.84 - 0.05 * x * x;
    float dy = (t - tf) / 0.022;
    float across = 1.0 - smoothstep(0.65, 0.92, x);
    float fold = u_torsoShade.y * across * (0.26 * exp(-(dy - 0.7) * (dy - 0.7)) - 0.08 * exp(-(dy + 1.2) * (dy + 1.2)));
    float k = clamp((flank + fold) * body, -0.15, 0.4);
    // Shadows on skin and cloth go a touch warmer, light goes neutral.
    c *= k > 0.0 ? vec3(1.0 - k * 0.85, 1.0 - k, 1.0 - k * 1.08) : vec3(1.0 - k);
  }
  o = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class Warp {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw Object.assign(new Error('WebGL2 unavailable'), { name: 'WebGL' });
    this.gl = gl;
    this.canvas = canvas;
    this.debug = 0;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.p = p;
    this.u = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      this.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const texture = (unit) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.tex = texture(0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.maskTex = texture(1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]));

    this.arr = {
      seg: new Float32Array(N * 4), keys: new Float32Array(N * 4), asym: new Float32Array(N * 4),
      along: new Float32Array(N * 4), shape: new Float32Array(N * 4), amp: new Float32Array(N),
    };
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  upload(video) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  uploadMask(mask, w, h) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, mask);
  }

  clearMask() { this.uploadMask(new Uint8Array([0]), 1, 1); }

  /** view: { map, mirror }. rig: buildDeformers output (or null). shade: { round, fold }. */
  draw(view, rig, shade) {
    const gl = this.gl, u = this.u, A = this.arr;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform1i(u.u_mask, 1);
    gl.uniform2f(u.u_res, W, H);
    gl.uniform4fv(u.u_map, view.map);
    gl.uniform1f(u.u_mirror, view.mirror ? 1 : 0);
    gl.uniform1i(u.u_debug, this.debug);

    const list = rig ? rig.deformers : [];
    for (const k of Object.keys(A)) A[k].fill(0);
    list.forEach((d, i) => {
      A.seg.set([d.a.x, d.a.y, d.b.x, d.b.y], i * 4);
      A.keys.set(d.keys, i * 4);
      A.asym.set(d.asym, i * 4);
      A.along.set(d.along, i * 4);
      A.shape.set([d.edgeA, d.edgeB, d.fade[0], d.fade[1]], i * 4);
      A.amp[i] = d.amp;
    });
    // The torso must be deformer 0 for the shading; if it isn't there, skip the shading.
    const torsoFirst = rig && rig.torso && list[0] === rig.torso;
    gl.uniform1i(u.u_count, list.length);
    gl.uniform4fv(u.u_seg, A.seg);
    gl.uniform4fv(u.u_keys, A.keys);
    gl.uniform4fv(u.u_asym, A.asym);
    gl.uniform4fv(u.u_along, A.along);
    gl.uniform4fv(u.u_shape, A.shape);
    gl.uniform1fv(u.u_amp, A.amp);
    gl.uniform1f(u.u_step, Math.max(2, (rig?.unit || 100) * 0.02));
    gl.uniform2f(u.u_torsoShade, torsoFirst ? shade.round : 0, torsoFirst ? shade.fold : 0);

    const loc = gl.getAttribLocation(this.p, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(loc);
  }
}
