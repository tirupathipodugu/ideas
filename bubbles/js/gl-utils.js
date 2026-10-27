// Small WebGL2 helpers: compile a program, make textures and framebuffers. Nothing app-specific.

/** The full-screen triangle every pass draws. vStage is the position in stage px, y pointing down. */
export const FULLSCREEN_VERTEX = `#version 300 es
uniform vec2 uStage;
out vec2 vStage;
void main() {
  vec2 corner = vec2(float((gl_VertexID & 1) << 2) - 1.0, float((gl_VertexID & 2) << 1) - 1.0);
  vStage = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5) * uStage;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'Shader failed to compile');
  }
  return shader;
}

/** Link a program and look up every active uniform, so callers write `program.u.uStage`. */
export function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Program failed to link');
  }
  const u = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(program, name);
  }
  return { program, u };
}

/** A 2D texture with the given storage. Pass `linear` for smooth sampling, otherwise nearest. */
export function createTexture(gl, { width, height, internalFormat, linear = false }) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
  setSampling(gl, gl.TEXTURE_2D, linear);
  return texture;
}

export function setSampling(gl, target, linear) {
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** A framebuffer drawing into one texture. */
export function createFramebuffer(gl, texture) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return framebuffer;
}

/** Bind a texture to a texture unit and point a sampler uniform at it. */
export function bindTexture(gl, unit, target, texture, location) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, texture);
  gl.uniform1i(location, unit);
}
