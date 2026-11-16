// GLSL ES 3.00 for the finishing chain (src/finish_pass.js). Each pass
// defines `vec4 effect(vec2 p)` with p in image pixels, y down (row 0 of the
// uploaded frame is gl_FragCoord.y 0.5, and readPixels returns rows in the
// same order). The shared main() mixes back to the input pixel inside the
// protect mask. Every value is a function of the frame number, the size and
// the params, so frame N rendered alone equals frame N in a sequence.

export const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the viewport.
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_frame;
uniform float u_t;
uniform int u_protect;
uniform vec4 u_rects[16];
uniform int u_nrects;
uniform float u_feather;
out vec4 o_color;

vec4 px(vec2 p) { return texture(u_src, p / u_res); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// pcg3d (Jarzynski and Olano 2020): integer hash, the same on every GPU.
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(uvec3 v) { return vec3(pcg3(v)) / 4294967295.0; }

float protectMask(vec2 p) {
  float m = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= u_nrects) break;
    vec4 r = u_rects[i];
    vec2 d = abs(p - (r.xy + r.zw * 0.5)) - r.zw * 0.5;
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
    m = max(m, 1.0 - smoothstep(0.0, u_feather, sd));
  }
  return m;
}
`;

const MAIN = `
void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 c = effect(p).rgb;
  if (u_protect == 1 && u_nrects > 0) c = mix(c, px(p).rgb, protectMask(p));
  o_color = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Each pass: its body and its uniforms from params (name → [glsl name, value]).
const PASSES = {
  // R and B sampled along the radius from the centre, G fixed; px is the
  // shift at the corners, falloff 0 shifts evenly, 1 grows with the radius.
  aberration: {
    body: `uniform float u_px;
uniform float u_falloff;
vec4 effect(vec2 p) {
  vec2 d = p - u_res * 0.5;
  float r = length(d) / (0.5 * length(u_res));
  vec2 dir = length(d) > 0.0 ? normalize(d) : vec2(0.0);
  vec2 s = dir * u_px * mix(1.0, r, u_falloff);
  return vec4(px(p + s).r, px(p).g, px(p - s).b, 1.0);
}`,
    uniforms: (q) => ({ u_px: q.px, u_falloff: q.falloff })
  },
  // A 3D LUT (the story's cube, strength mixed in) as a (N·N)×N float
  // texture, red fastest then green across, blue down; tetrahedral
  // interpolation, as ffmpeg lut3d interp=tetrahedral, so both paths agree.
  grade: {
    protect: false,
    body: `uniform sampler2D u_lut;
uniform int u_n;
vec3 lut(ivec3 i) { return texelFetch(u_lut, ivec2(i.g * u_n + i.r, i.b), 0).rgb; }
vec4 effect(vec2 p) {
  vec3 s = clamp(px(p).rgb, 0.0, 1.0) * float(u_n - 1);
  ivec3 a = min(ivec3(floor(s)), ivec3(u_n - 2));
  vec3 d = s - vec3(a);
  ivec3 b = a + 1;
  vec3 c000 = lut(a), c111 = lut(b), c;
  if (d.r > d.g) {
    if (d.g > d.b) c = (1.0 - d.r) * c000 + (d.r - d.g) * lut(ivec3(b.r, a.g, a.b)) + (d.g - d.b) * lut(ivec3(b.r, b.g, a.b)) + d.b * c111;
    else if (d.r > d.b) c = (1.0 - d.r) * c000 + (d.r - d.b) * lut(ivec3(b.r, a.g, a.b)) + (d.b - d.g) * lut(ivec3(b.r, a.g, b.b)) + d.g * c111;
    else c = (1.0 - d.b) * c000 + (d.b - d.r) * lut(ivec3(a.r, a.g, b.b)) + (d.r - d.g) * lut(ivec3(b.r, a.g, b.b)) + d.g * c111;
  } else {
    if (d.b > d.g) c = (1.0 - d.b) * c000 + (d.b - d.g) * lut(ivec3(a.r, a.g, b.b)) + (d.g - d.r) * lut(ivec3(a.r, b.g, b.b)) + d.r * c111;
    else if (d.b > d.r) c = (1.0 - d.g) * c000 + (d.g - d.b) * lut(ivec3(a.r, b.g, a.b)) + (d.b - d.r) * lut(ivec3(a.r, b.g, b.b)) + d.r * c111;
    else c = (1.0 - d.g) * c000 + (d.g - d.r) * lut(ivec3(a.r, b.g, a.b)) + (d.r - d.b) * lut(ivec3(b.r, b.g, a.b)) + d.b * c111;
  }
  // ffmpeg lut3d truncates to 8 bits; so does this, so a grade-only render and a chain agree.
  return vec4(floor(clamp(c, 0.0, 1.0) * 255.0) / 255.0, 1.0);
}`,
    uniforms: () => ({})
  },
  // Film grain after the grade: value noise on a size-px lattice, a fresh
  // field each frame (hash of cell, frame and seed), strongest in the
  // mid-tones (4·l·(1 − l)), mono or per channel.
  grain: {
    body: `uniform float u_amount;
uniform float u_size;
uniform int u_mono;
uniform float u_seed;
vec3 cell(vec2 c) {
  vec3 h = hash3(uvec3(ivec2(c) + 65536, uint(u_frame) * 2654435761u + uint(u_seed)));
  return u_mono == 1 ? vec3(h.x) : h;
}
vec4 effect(vec2 p) {
  vec2 q = p / u_size, i = floor(q), f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  vec3 n = mix(mix(cell(i), cell(i + vec2(1, 0)), f.x), mix(cell(i + vec2(0, 1)), cell(i + vec2(1, 1)), f.x), f.y);
  vec3 c = px(p).rgb;
  float l = luma(c);
  // Smoothed uniform noise has a narrower spread than white noise; ×3.4 brings it back to about ±1.
  return vec4(c + (n - 0.5) * 3.4 * u_amount * 4.0 * l * (1.0 - l), 1.0);
}`,
    uniforms: (q) => ({ u_amount: q.amount, u_size: q.size, u_mono: q.mono ? 1 : 0, u_seed: q.seed })
  }
};

export const FINISH_SHADER_PASSES = Object.freeze(Object.keys(PASSES));

/** The fragment shader of one pass. */
export const fragmentShader = (pass) => `${HEADER}\n${PASSES[pass].body}\n${MAIN}`;

/** Whether the protect mask applies to a pass (all but the grade). */
export const passProtects = (pass) => PASSES[pass].protect !== false;

/** A pass's own uniforms from its resolved params: {name: number}. */
export const passUniforms = (pass, params) => PASSES[pass].uniforms(params);
