// GL generator backgrounds (docs/FINISHING_AND_ELEMENTS_RFC.md §E.1, §E.3):
// aurora, fog, plasma, cells and caustics, each a fragment shader that draws
// new pixels from the time alone. A background layer carries `gl` (its plan:
// kind, variant, seed, speed, scale, canvas size, two colours) the way the
// weather layer carries `vfx`, and both renderers paint it with this one
// painter: Remotion's PlateLayer calls paintGl in a layout effect, the
// HyperFrames compiler inlines installGl and paints from a proxy tween.
//
// installGl is self-contained (no module scope), so the compiler can inline
// its source. The shaders are written fresh; the hash is pcg3d as in
// src/finish_shaders.js. Every value is a function of t × speed, so any frame
// alone equals that frame in sequence. Without WebGL2 nothing is drawn and
// the brand background shows.

/** Installs the painter on `root` (window in HyperFrames) as root.lcGl = {paint, kinds}. */
export function installGl(root) {
  const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 u_res;
uniform float u_t;
uniform float u_seed;
uniform float u_scale;
uniform int u_variant;
uniform vec3 u_a;
uniform vec3 u_b;
out vec4 o_color;
uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(uvec3 v) { return vec3(pcg3(v)) / 4294967295.0; }
vec2 hash2(ivec2 c, uint k) { return hash3(uvec3(c + 65536, k)).xy; }
float vnoise(vec2 q, uint k) {
  vec2 i = floor(q), f = q - i;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(i);
  return mix(mix(hash2(c, k).x, hash2(c + ivec2(1, 0), k).x, f.x), mix(hash2(c + ivec2(0, 1), k).x, hash2(c + ivec2(1, 1), k).x, f.x), f.y);
}
float fbm(vec2 q, uint k) {
  float v = 0.0, a = 0.5;
  for (int o = 0; o < 5; o++) { v += a * vnoise(q, k + uint(o)); q = mat2(1.6, 1.2, -1.2, 1.6) * q; a *= 0.5; }
  return v / 0.96875;
}
// q: aspect-correct coordinates, the short side 1 at scale 1; k: the seed.
void field(vec2 q, uint k, out float v, out float m);
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 q = p / min(u_res.x, u_res.y) / u_scale;
  float v, m;
  field(q, uint(u_seed), v, m);
  v = clamp(v, 0.0, 1.0);
  // Premultiplied: the colour between u_a and u_b at coverage v.
  o_color = vec4(mix(u_a, u_b, clamp(m, 0.0, 1.0)) * v, v);
}
`;
  const FIELDS = {
    // Curtains: three ribbons that wander across the sky, bright at their
    // lower edge and fading up in vertical rays.
    aurora: `void field(vec2 q, uint k, out float v, out float m) {
  float t = u_t * 0.06;
  v = 0.0; m = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.35 + 0.18 * fi + 0.3 * (fbm(vec2(q.x * 0.9 + t + fi * 3.1, fi * 7.0), k + uint(i)) - 0.5);
    float d = q.y - y;
    float rays = 0.55 + 0.45 * fbm(vec2(q.x * 9.0 + t * 3.0, fi), k + 17u + uint(i));
    float band = d > 0.0 ? exp(-d * d / 0.0015) : exp(d / 0.22) * rays;
    float w = band * (0.75 - 0.15 * fi);
    m += w * fi * 0.5; v += w;
  }
  m /= max(v, 1e-3);
}`,
    // Drifting noise, domain-warped. fog: soft and low, heavier at the
    // bottom; cloud: puffy banks; smoke: ridged wisps that rise; ember: a
    // dark haze with sparks that rise and flicker (the second colour).
    fog: `void field(vec2 q, uint k, out float v, out float m) {
  float t = u_t * 0.05;
  m = 0.0;
  if (u_variant == 2) {
    vec2 w = vec2(fbm(q * 1.5 + vec2(0.0, t * 2.0), k), fbm(q * 1.5 + vec2(5.2, t * 2.0), k + 9u));
    float r = 1.0 - abs(2.0 * fbm(q * 2.0 + 1.5 * w + vec2(0.0, t * 3.0), k + 3u) - 1.0);
    v = pow(r, 3.0) * 0.9; return;
  }
  vec2 w = vec2(fbm(q * 1.2 + vec2(t, 0.0), k), fbm(q * 1.2 + vec2(-t, 3.7), k + 5u));
  float f = fbm(q * 1.6 + 1.2 * w + vec2(t * 1.5, 0.0), k + 11u);
  if (u_variant == 1) { v = smoothstep(0.42, 0.72, f); return; }
  float low = smoothstep(0.1, 1.1, q.y * u_scale * min(u_res.x, u_res.y) / u_res.y);
  v = smoothstep(0.25, 0.85, f) * (0.45 + 0.55 * low);
  if (u_variant == 3) {
    v *= 0.55;
    vec2 g = vec2(q.x * 14.0, q.y * 14.0 + u_t * 1.2);
    ivec2 c = ivec2(floor(g));
    vec3 h = hash3(uvec3(c + 65536, k + 77u));
    float spark = h.z > 0.88 ? (1.0 - smoothstep(0.02, 0.09, length(fract(g) - 0.25 - 0.5 * h.xy))) * (0.6 + 0.4 * sin(u_t * 6.0 + h.x * 40.0)) : 0.0;
    v = max(v, spark); m = spark > v * 0.5 ? 1.0 : 0.0;
  }
}`,
    // Warped fbm through a two-colour map; silk mirrors it about the centre
    // and stretches it into long folds.
    plasma: `void field(vec2 q, uint k, out float v, out float m) {
  float t = u_t * 0.08;
  if (u_variant == 1) q = vec2(abs(q.x - 0.5 * u_res.x / min(u_res.x, u_res.y) / u_scale), q.y * 0.45);
  vec2 w = vec2(fbm(q * 1.4 + vec2(t, -t), k), fbm(q * 1.4 + vec2(4.3 - t, 1.7 + t), k + 7u));
  float f = fbm(q * 1.8 + 2.2 * w, k + 13u);
  if (u_variant == 1) f = 0.5 + 0.5 * sin(f * 9.0 + t * 2.0);
  m = smoothstep(0.2, 0.8, f);
  v = 0.55 + 0.45 * smoothstep(0.15, 0.85, f);
}`,
    // Worley. cells: soft glowing cells whose sites drift; facets: flat
    // shaded panes with thin edges; hex: a hexagon mosaic that pulses.
    cells: `void field(vec2 q, uint k, out float v, out float m) {
  float t = u_t * 0.25;
  vec2 g = q * 4.0;
  if (u_variant == 2) {
    vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
    vec2 a = mod(g, r) - h, b = mod(g - h, r) - h;
    vec2 d = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = g - d;
    vec3 n = hash3(uvec3(ivec2(floor(id * 2.0)) + 65536, k));
    float edge = 0.5 - max(abs(d.x) * 0.5 + abs(d.y) * 0.8660254, abs(d.x));
    m = n.x;
    v = (0.35 + 0.35 * (0.5 + 0.5 * sin(t * 2.0 + n.y * 6.2831853))) * smoothstep(0.02, 0.05, edge) + (1.0 - smoothstep(0.0, 0.03, edge)) * 0.9;
    return;
  }
  ivec2 c = ivec2(floor(g));
  float f1 = 9.0, f2 = 9.0; ivec2 near = c;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    ivec2 n = c + ivec2(x, y);
    vec2 h = hash2(n, k);
    vec2 s = vec2(n) + 0.5 + 0.4 * sin(t + 6.2831853 * h);
    float d = length(g - s);
    if (d < f1) { f2 = f1; f1 = d; near = n; } else if (d < f2) f2 = d;
  }
  m = hash2(near, k + 3u).x;
  if (u_variant == 1) { v = 0.3 + 0.45 * m * (1.0 - 0.3 * f1) + (1.0 - smoothstep(0.02, 0.06, f2 - f1)) * 0.7; return; }
  v = (1.0 - smoothstep(0.0, 0.9, f1)) * 0.8 + (1.0 - smoothstep(0.0, 0.08, f2 - f1)) * 0.35;
}`,
    // Light through a moving water surface: two layers of ridged, warped
    // noise drifting against each other; their product is the bright web.
    caustics: `void field(vec2 q, uint k, out float v, out float m) {
  float t = u_t * 0.18;
  vec2 g = q * 3.0;
  vec2 w = vec2(vnoise(g * 0.7 + vec2(t, 0.0), k), vnoise(g * 0.7 + vec2(0.0, -t), k + 4u)) * 1.6;
  float r1 = 1.0 - abs(2.0 * vnoise(g + w + vec2(t * 0.8, t * 0.3), k + 8u) - 1.0);
  float r2 = 1.0 - abs(2.0 * vnoise(g * 1.3 - w + vec2(-t * 0.5, t * 0.7), k + 12u) - 1.0);
  float c = pow(r1, 6.0) + pow(r2, 6.0);
  v = 0.18 + 0.82 * clamp(c, 0.0, 1.0);
  m = clamp(c - 0.6, 0.0, 1.0);
}`
  };
  const VERTEX = `#version 300 es
void main() { vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0); }`;
  const states = new WeakMap();
  const VARIANTS = { fog: ['fog', 'cloud', 'smoke', 'ember'], plasma: ['plasma', 'silk'], cells: ['cells', 'facets', 'hex'] };
  /** Paints one frame of plan (a layer's gl) at t seconds into canvas; false when WebGL2 is missing. */
  function paint(canvas, plan, t) {
    let state = states.get(canvas);
    if (!state) {
      const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (!gl) return false;
      const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`gl background ${plan.kind}: ${gl.getShaderInfoLog(s)}`); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, HEADER + FIELDS[plan.kind]));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`gl background ${plan.kind}: ${gl.getProgramInfoLog(prog)}`);
      state = { gl, prog };
      states.set(canvas, state);
    }
    const { gl, prog } = state;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    const at = (name) => gl.getUniformLocation(prog, name);
    gl.uniform2f(at('u_res'), canvas.width, canvas.height);
    gl.uniform1f(at('u_t'), t * plan.speed);
    gl.uniform1f(at('u_seed'), plan.seed);
    gl.uniform1f(at('u_scale'), plan.scale);
    gl.uniform1i(at('u_variant'), Math.max(0, (VARIANTS[plan.kind] ?? []).indexOf(plan.variant)));
    gl.uniform3fv(at('u_a'), plan.colors[0]);
    gl.uniform3fv(at('u_b'), plan.colors[1]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
  root.lcGl = { paint, kinds: Object.keys(FIELDS), variants: VARIANTS };
  return root.lcGl;
}

const GL = installGl({});
/** The GL background kinds, and the variants of those that have them ({kind: [names]}, the first the default). */
export const GL_BACKGROUND_KINDS = Object.freeze([...GL.kinds]);
export const GL_BACKGROUND_VARIANTS = Object.freeze(GL.variants);
/** Paints a layer's gl plan at t seconds into a canvas (Remotion; HyperFrames inlines installGl). */
export const paintGl = (canvas, plan, t) => GL.paint(canvas, plan, t);
