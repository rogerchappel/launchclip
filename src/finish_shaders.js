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
uniform float u_fps;
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
// Value noise and five-octave fbm on a lattice, seeded by k.
float vnoise(vec2 q, uint k) {
  vec2 i = floor(q), f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i) + 65536;
  float a = hash3(uvec3(c, k)).x, b = hash3(uvec3(c + ivec2(1, 0), k)).x, d = hash3(uvec3(c + ivec2(0, 1), k)).x, e = hash3(uvec3(c + ivec2(1, 1), k)).x;
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
float fbm(vec2 q, uint k) {
  float v = 0.0, a = 0.5;
  for (int o = 0; o < 5; o++) { v += a * vnoise(q, k + uint(o)); q *= 2.03; a *= 0.5; }
  return v / 0.96875;
}

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

const HITS = `uniform float u_hits[32];
uniform int u_nhits;`;
// Hit times padded to the shader's 32 slots, and their count.
const hits = (at) => ({ u_hits: Array.from({ length: 32 }, (_, i) => at[i] ?? -1e9), u_nhits: at.length });
const rgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);

// Each pass: its body (and a pre-pass for bloom) and its uniforms from params.
const PASSES = {
  // Threshold bloom: the pre-pass keeps what is brighter than threshold (soft
  // knee), the page mipmaps it (the downsample pyramid), and each of six
  // levels is read through a 9-tap tent, then screen-added in the tint.
  bloom: {
    pre: `uniform float u_threshold;
vec4 effect(vec2 p) {
  vec3 c = px(p).rgb;
  float m = max(c.r, max(c.g, c.b));
  return vec4(c * clamp((m - u_threshold) / max(1.0 - u_threshold, 1e-3), 0.0, 1.0), 1.0);
}`,
    body: `uniform sampler2D u_pre;
uniform float u_radius;
uniform float u_strength;
uniform vec3 u_tint;
vec4 effect(vec2 p) {
  vec2 uv = p / u_res;
  vec3 b = vec3(0.0);
  for (int l = 1; l <= 6; l++) {
    float lod = float(l);
    vec2 step = exp2(lod) / u_res * u_radius;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
      b += (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0) / 16.0 * textureLod(u_pre, uv + vec2(x, y) * step, lod).rgb;
  }
  b = clamp(b / 6.0 * u_strength * 2.0, 0.0, 1.0) * u_tint;
  vec3 c = px(p).rgb;
  return vec4(1.0 - (1.0 - c) * (1.0 - b), 1.0);
}`,
    uniforms: (q) => ({ u_threshold: q.threshold, u_radius: q.radius, u_strength: q.strength, u_tint: rgb(q.tint) })
  },
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
  // Zoom blur toward centre: samples along the line to it, amount the share
  // of the way. With hit times (at), amount is an envelope: up over 0.07 s
  // before each hit, down over 0.35 s after it (both smoothstep: slow, fast,
  // slow); without, it is constant.
  "zoom-blur": {
    body: `${HITS}
uniform float u_amount;
uniform vec2 u_centre;
uniform float u_samples;
float envelope() {
  if (u_nhits == 0) return 1.0;
  float e = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= u_nhits) break;
    float d = u_t - u_hits[i];
    e = max(e, d < 0.0 ? smoothstep(-0.07, 0.0, d) : 1.0 - smoothstep(0.0, 0.35, d));
  }
  return e;
}
vec4 effect(vec2 p) {
  float a = u_amount * envelope();
  if (a <= 0.0) return px(p);
  vec2 c = u_centre * u_res;
  vec3 s = vec3(0.0);
  float n = 0.0;
  for (int i = 0; i < 24; i++) {
    if (float(i) >= u_samples) break;
    s += px(mix(p, c, float(i) / max(u_samples - 1.0, 1.0) * a)).rgb;
    n += 1.0;
  }
  return vec4(s / n, 1.0);
}`,
    uniforms: (q) => ({ u_amount: q.amount, u_centre: q.centre, u_samples: q.samples, ...hits(q.at) })
  },
  // Film burn at each hit: over `frames` frames centred on it, a front of
  // fbm noise plus distance from a seeded origin eats the frame to white and
  // recedes; a band of colour glows ahead of the white core. Each hit has
  // its own pattern (seed and hit index).
  burn: {
    body: `${HITS}
uniform float u_frames;
uniform float u_band;
uniform vec3 u_colour;
uniform float u_seed;
vec4 effect(vec2 p) {
  vec3 c = px(p).rgb;
  float half_ = u_frames * 0.5 / u_fps, e = 0.0;
  int hit = -1;
  for (int i = 0; i < 32; i++) {
    if (i >= u_nhits) break;
    float v = 1.0 - abs(u_t - u_hits[i]) / half_;
    if (v > e) { e = v; hit = i; }
  }
  if (hit < 0) return vec4(c, 1.0);
  uint k = uint(u_seed) * 977u + uint(hit) * 7919u + 13u;
  vec2 origin = hash3(uvec3(k, 1u, 2u)).xy * u_res;
  float n = fbm(p / u_res.y * 3.0, k) * 0.6 + length(p - origin) / length(u_res) * 0.4;
  // Squared, so the front creeps in and only whites out the frame at the hit.
  float edge = e * e * 1.05 - n;
  c = mix(c, u_colour, smoothstep(-u_band, 0.0, edge) * 0.85);
  c = mix(c, vec3(1.0, 0.96, 0.88), smoothstep(0.0, u_band, edge));
  return vec4(c, 1.0);
}`,
    uniforms: (q) => ({ u_frames: q.frames, u_band: q.band, u_colour: rgb(q.colour), u_seed: q.seed, ...hits(q.at) })
  },
  // A CRT: luma sharp, chroma smeared sideways and red shifted (YIQ), a
  // barrel curve, scanlines, an aperture grille, a tracking band that rolls
  // up the screen and slips rows sideways (hashed by row and frame), and an
  // optional power-on (the picture opens from a bright line over 0.45 s).
  // Lengths scale with the frame height (1080 = 1).
  crt: {
    body: `uniform float u_scan;
uniform float u_grille;
uniform float u_bleed;
uniform float u_curvature;
uniform float u_tracking;
uniform int u_powerOn;
const mat3 TO_YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 TO_RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
vec4 effect(vec2 p) {
  float k = min(u_res.x, u_res.y) / 1080.0;
  vec2 uv = p / u_res;
  float open = u_powerOn == 1 ? smoothstep(0.05, 0.45, u_t) : 1.0;
  uv.y = 0.5 + (uv.y - 0.5) / max(open, 0.004);
  vec2 q = uv - 0.5;
  q *= 1.0 + u_curvature * dot(q, q) * 4.0;
  uv = q + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 sp = uv * u_res;
  float band = 1.1 - fract(u_t * 0.15) * 1.2;
  float row = floor(sp.y / (2.0 * k));
  float slip = (1.0 - smoothstep(0.0, 0.04, abs(uv.y - band))) * 24.0 + 1.5;
  sp.x += u_tracking * k * slip * (hash3(uvec3(uint(row), uint(u_frame), 9u)).x - 0.5);
  float y = (TO_YIQ * px(sp).rgb).x;
  vec2 iq = vec2(0.0);
  for (int i = -3; i <= 3; i++) iq += (TO_YIQ * px(sp + vec2(float(i) * 2.0 * k * u_bleed, 0.0)).rgb).yz / 7.0;
  vec3 c = TO_RGB * vec3(y, iq);
  c.r = (TO_RGB * vec3((TO_YIQ * px(sp + vec2(1.5 * k * u_bleed, 0.0)).rgb).x, iq)).r;
  float s = 0.5 + 0.5 * cos(6.2831853 * sp.y / (3.0 * k));
  c *= mix(1.0, 0.55 + 0.45 * s, u_scan) * (1.0 + 0.25 * u_scan);
  int col = int(mod(floor(p.x / k), 3.0));
  c *= mix(vec3(1.0), vec3(col == 0 ? 1.0 : 0.7, col == 1 ? 1.0 : 0.7, col == 2 ? 1.0 : 0.7) * 1.15, u_grille);
  c *= smoothstep(0.0, 0.015, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
  c += (1.0 - open) * 1.5;
  return vec4(c, 1.0);
}`,
    uniforms: (q) => ({ u_scan: q.scan, u_grille: q.grille, u_bleed: q.bleed, u_curvature: q.curvature, u_tracking: q.tracking, u_powerOn: q.powerOn ? 1 : 0 })
  },
  // Whole-frame halftone on a grid turned by angle: each cell reads its
  // centre colour and prints an ink dot (area follows darkness) or, in
  // "line" mode, a rule whose width does; "duotone" prints the dots over a
  // two-stop map from accent (shadows) to paper (highlights).
  halftone: {
    body: `uniform float u_cell;
uniform float u_angle;
uniform vec3 u_ink;
uniform vec3 u_paper;
uniform vec3 u_accent;
uniform int u_mode;
vec4 effect(vec2 p) {
  float a = radians(u_angle);
  mat2 turn = mat2(cos(a), sin(a), -sin(a), cos(a));
  vec2 r = turn * p;
  vec2 centre = (floor(r / u_cell) + 0.5) * u_cell;
  vec2 at = u_mode == 1 ? vec2(r.x, centre.y) : centre;
  float l = luma(px(transpose(turn) * at).rgb), d = 1.0 - l;
  vec3 base = u_mode == 2 ? mix(u_accent, u_paper, smoothstep(0.2, 0.9, l)) : u_paper;
  float cover;
  if (u_mode == 1) { float w = d * u_cell * 0.5; cover = 1.0 - smoothstep(w - 0.75, w + 0.75, abs(r.y - centre.y)); }
  else { float rad = sqrt(d) * u_cell * 0.7071; cover = 1.0 - smoothstep(rad - 0.75, rad + 0.75, length(r - centre)); }
  return vec4(mix(base, u_ink, cover), 1.0);
}`,
    uniforms: (q) => ({ u_cell: q.cell, u_angle: q.angle, u_ink: rgb(q.ink), u_paper: rgb(q.paper), u_accent: rgb(q.accent), u_mode: ["dot", "line", "duotone"].indexOf(q.mode) })
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

/** The pass's pre-pass shader (drawn into a mipmapped texture the pass reads as u_pre), or null. */
export const preShader = (pass) => (PASSES[pass].pre ? `${HEADER}\n${PASSES[pass].pre}\n${MAIN}` : null);

/** Whether the protect mask applies to a pass (all but the grade). */
export const passProtects = (pass) => PASSES[pass].protect !== false;

/** A pass's own uniforms from its resolved params: {name: number}. */
export const passUniforms = (pass, params) => PASSES[pass].uniforms(params);
