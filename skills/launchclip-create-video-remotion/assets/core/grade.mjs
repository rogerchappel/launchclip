// Colour grade (docs/FINISHING_AND_ELEMENTS_RFC.md §E.2): the last colour
// step of a render, as a 3D LUT. Presets are generated here from a few OKLab
// operations (lift, gamma, gain, split tone, saturation by luma, a soft
// shoulder), so no third-party LUT enters the repo; a user's own `.cube` is
// read by path. The render applies the cube once to the finished video with
// ffmpeg `lut3d` (src/grade.js), so both renderers match by construction.
//
//   story.grade = "warm-film" | "off" | {preset | cube, strength: 0–1}
//
// Pure ESM that imports only kit/core siblings. Canonical copy:
// kit/core/grade.mjs.

import { contrastRatio } from './catalog-b-base.mjs';

export const GRADE_CUBE_SIZE = 33;
// Lightest text pairs must keep (WCAG AA body text).
export const GRADE_MIN_CONTRAST = 4.5;

// Each preset: OKLab operations. lift/gain/gamma act on L; shadow/highlight
// add an (a, b) tint weighted by (1 − L)² / L²; sat scales chroma, satShadow
// adds to that scale in the shadows; contrast is an S-curve about L 0.5;
// knee starts the soft shoulder; mono drops chroma.
export const GRADE_PRESETS = Object.freeze({
  clean: Object.freeze({ knee: 0.82 }),
  'warm-film': Object.freeze({ lift: 0.07, knee: 0.8, highlight: [0.008, 0.022], satShadow: -0.08 }),
  'teal-amber': Object.freeze({ knee: 0.82, shadow: [-0.018, -0.02], highlight: [0.01, 0.028], sat: 1.05 }),
  'cool-tech': Object.freeze({ knee: 0.84, shadow: [-0.006, -0.026] }),
  'neon-crush': Object.freeze({ lift: -0.035, contrast: 1.08, sat: 1.15, knee: 0.88 }),
  bleach: Object.freeze({ sat: 0.65, contrast: 1.18, knee: 0.86 }),
  'ink-mono': Object.freeze({ mono: true, knee: 0.84, highlight: [0.002, 0.012] })
});
export const GRADE_PRESET_NAMES = Object.freeze(Object.keys(GRADE_PRESETS));

// The preset a look reads best through (RFC table); anything else: clean.
export const GRADE_LOOK_DEFAULTS = Object.freeze({
  'paper-cutout': 'warm-film', watercolour: 'warm-film', 'clay-2d': 'warm-film',
  hologram: 'cool-tech', 'ascii-terminal': 'cool-tech', blueprint: 'cool-tech',
  'neon-night': 'neon-crush', 'anime-cel': 'clean', thermal: 'clean', 'isometric-layers': 'clean'
});
// The seeded style generator's pick per tone (style-seed.mjs).
export const GRADE_TONE_DEFAULTS = Object.freeze({
  calm: 'clean', serious: 'bleach', warm: 'warm-film', energetic: 'teal-amber', playful: 'clean', premium: 'teal-amber', technical: 'cool-tech'
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The shape of story.grade / style.grade. → error messages */
export function gradeErrors(value, where = 'grade') {
  if (value === undefined || value === null || value === false || value === 'off') return [];
  if (typeof value === 'string') return GRADE_PRESETS[value] ? [] : [`${where} must be "off", one of ${GRADE_PRESET_NAMES.join(', ')}, or {preset | cube, strength}`];
  if (!isObject(value)) return [`${where} must be "off", a preset name or {preset | cube, strength}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!['preset', 'cube', 'strength'].includes(key)) errors.push(`${where}.${key} is not a grade field (preset, cube, strength)`);
  if (value.preset !== undefined && value.cube !== undefined) errors.push(`${where} takes preset or cube, not both`);
  if (value.preset === undefined && value.cube === undefined) errors.push(`${where} needs a preset or a cube`);
  if (value.preset !== undefined && !GRADE_PRESETS[value.preset]) errors.push(`${where}.preset must be one of ${GRADE_PRESET_NAMES.join(', ')}`);
  if (value.cube !== undefined && !(typeof value.cube === 'string' && /\.cube$/i.test(value.cube.trim()))) errors.push(`${where}.cube must be a path to a .cube file`);
  if (value.strength !== undefined && !(typeof value.strength === 'number' && value.strength >= 0 && value.strength <= 1)) errors.push(`${where}.strength must be a number from 0 to 1`);
  return errors;
}

/** The grade a story asks for, or null (none, off, or strength 0). → {preset | cube, strength} */
export function resolveGrade(story) {
  const value = story?.grade;
  if (value === undefined || value === null || value === false || value === 'off' || gradeErrors(value).length) return null;
  const grade = typeof value === 'string' ? { preset: value, strength: 1 } : { ...value, strength: value.strength ?? 1 };
  return grade.strength > 0 ? grade : null;
}

// --- colour maths (sRGB ↔ OKLab, per channel 0–1) ---------------------------
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);
function rgbToLab([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function labToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => Math.min(1, Math.max(0, toGamma(v))));
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** One preset applied to an sRGB colour (channels 0–1). */
export function gradeColor(name, rgb) {
  const p = GRADE_PRESETS[name];
  if (!p) throw new Error(`unknown grade preset ${name}`);
  let [L, a, b] = rgbToLab(rgb);
  const sw = (1 - L) ** 2, hw = L ** 2;
  if (p.contrast) L = 0.5 + (L - 0.5) * p.contrast - (p.contrast - 1) * 0.5 * (L - 0.5) * Math.abs(L - 0.5) * 2;
  if (p.lift) L = p.lift > 0 ? p.lift + L * (1 - p.lift) : Math.max(0, (L + p.lift) / (1 + p.lift));
  // Soft shoulder: slope 1 at the knee, white lands at ~0.98 L.
  if (p.knee && L > p.knee) { const k = p.knee, x = (L - k) / (1 - k); L = k + (1 - k) * (x - 0.12 * x * x); }
  const sat = (p.mono ? 0 : p.sat ?? 1) + (p.mono ? 0 : (p.satShadow ?? 0) * sw);
  a *= sat; b *= sat;
  if (p.shadow) { a += p.shadow[0] * sw; b += p.shadow[1] * sw; }
  if (p.highlight) { a += p.highlight[0] * hw; b += p.highlight[1] * hw; }
  return labToRgb([clamp01(L), a, b]);
}

/** A cube of `size`³ entries, red fastest (the .cube order), each a function of the input colour. → {size, data: Float32Array} */
export function buildCube(fn, size = GRADE_CUBE_SIZE) {
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let bi = 0; bi < size; bi += 1) for (let gi = 0; gi < size; gi += 1) for (let ri = 0; ri < size; ri += 1) {
    const out = fn([ri / (size - 1), gi / (size - 1), bi / (size - 1)]);
    data[i++] = out[0]; data[i++] = out[1]; data[i++] = out[2];
  }
  return { size, data };
}

export const presetCube = (name, size = GRADE_CUBE_SIZE) => buildCube((rgb) => gradeColor(name, rgb), size);

/** Mix a cube with identity: strength 0 is identity, 1 the cube. */
export function mixCube(cube, strength) {
  if (strength >= 1) return cube;
  const identity = buildCube((rgb) => rgb, cube.size).data;
  return { size: cube.size, data: cube.data.map((v, i) => identity[i] + (v - identity[i]) * strength) };
}

/** A .cube file's text → {size, data}. Throws on a 1D LUT, a domain other than 0–1, or a short table. */
export function parseCube(text) {
  let size = null;
  const values = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'TITLE') continue;
    if (key === 'LUT_1D_SIZE') throw new Error('a 1D .cube is not a colour grade; give a 3D LUT (LUT_3D_SIZE)');
    if (key === 'LUT_3D_SIZE') { size = Number(rest[0]); continue; }
    if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      if (rest.map(Number).some((v) => v !== (key === 'DOMAIN_MIN' ? 0 : 1))) throw new Error(`${key} must be ${key === 'DOMAIN_MIN' ? '0 0 0' : '1 1 1'}`);
      continue;
    }
    if (/^[A-Z_]+$/.test(key)) continue;
    const triple = [key, ...rest].map(Number);
    if (triple.length !== 3 || triple.some((v) => !Number.isFinite(v))) throw new Error(`.cube line is not three numbers: ${raw.trim()}`);
    values.push(...triple);
  }
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error('.cube needs LUT_3D_SIZE from 2 to 256');
  if (values.length !== size ** 3 * 3) throw new Error(`.cube has ${values.length / 3} entries; LUT_3D_SIZE ${size} needs ${size ** 3}`);
  return { size, data: Float32Array.from(values, clamp01) };
}

/** {size, data} → .cube text. */
export function cubeText({ size, data }, title = 'launchclip grade') {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${size}`];
  for (let i = 0; i < data.length; i += 3) lines.push(`${data[i].toFixed(6)} ${data[i + 1].toFixed(6)} ${data[i + 2].toFixed(6)}`);
  return `${lines.join('\n')}\n`;
}

/** A colour through a cube (trilinear; ffmpeg's tetrahedral differs by well under one step). */
export function sampleCube({ size, data }, rgb) {
  const n = size - 1;
  const pos = rgb.map((c) => clamp01(c) * n);
  const i0 = pos.map((p) => Math.min(n - 1, Math.floor(p)));
  const f = pos.map((p, k) => p - i0[k]);
  const at = (r, g, b) => (b * size * size + g * size + r) * 3;
  const out = [0, 0, 0];
  for (let corner = 0; corner < 8; corner += 1) {
    const d = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    const w = d.reduce((acc, bit, k) => acc * (bit ? f[k] : 1 - f[k]), 1);
    if (!w) continue;
    const idx = at(i0[0] + d[0], i0[1] + d[1], i0[2] + d[2]);
    for (let c = 0; c < 3; c += 1) out[c] += w * data[idx + c];
  }
  return out;
}

const hexRgb = (hex) => [0, 2, 4].map((i) => parseInt(String(hex).replace('#', '').slice(i, i + 2), 16) / 255);
const rgbHex = (rgb) => `#${rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')}`;
export const gradeHex = (cube, hex) => rgbHex(sampleCube(cube, hexRgb(hex)));

/**
 * Brand colour pairs the grade pushes under GRADE_MIN_CONTRAST (pairs that
 * met it before the grade). The caption legibility pass measures the real
 * frames after the grade too; this names the brand pair at plan time.
 * → [{fg, bg, before, after}]
 */
export function gradeContrastLosses(cube, colors = {}) {
  const hexes = Object.entries(colors).filter(([, hex]) => /^#[0-9a-f]{6}$/i.test(String(hex)));
  const losses = [];
  for (let i = 0; i < hexes.length; i += 1) for (let j = i + 1; j < hexes.length; j += 1) {
    const [[fg, a], [bg, b]] = [hexes[i], hexes[j]];
    const before = contrastRatio(a, b);
    if (before < GRADE_MIN_CONTRAST) continue;
    const after = contrastRatio(gradeHex(cube, a), gradeHex(cube, b));
    if (after < GRADE_MIN_CONTRAST) losses.push({ fg, bg, before: Math.round(before * 100) / 100, after: Math.round(after * 100) / 100 });
  }
  return losses;
}
