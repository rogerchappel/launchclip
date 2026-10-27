// Backdrop plates (VISUAL_GAP_MAP C1): the dark, heavily out-of-focus
// abstract plate a long-form explainer builds its shots over. One plate holds
// across every scene of a chapter and changes at the next chapter, so a build
// of cards lands on a backdrop that never cuts.
//
// A plate is drawn in the backgrounds kit's layer shape (kit/core/backgrounds.mjs:
// {id, box, style, svg, axes}) so both renderers draw it with the code that
// already draws story.background: HyperFrames as .lc-bg-layer divs with GSAP
// wave tweens, Remotion as BackgroundField. Every shape is procedural SVG
// (no binary assets), blurred inside the SVG by feGaussianBlur, and set as a
// layer's background image, so the browser rasterises each plate once and
// the drift only moves it. Depth of field comes from three depths per plate:
// a far layer (most blur, least travel), the subject layer (the plate's
// focus) and a near layer (large, very soft, travelling most), which is the
// parallax.
//
// Kinds:
//   hex-shell  a sphere of hexagonal cells, lit from the upper left
//   silk       folded ribbons of silk flowing across the frame
//   strands    molecular double-helix strands of glossy beads
//   bokeh      a starfield: pinpoints far, soft discs near
//
// Params: focus 0–1 (how out of focus; 0.6), intensity 0–1 (how bright; 0.5),
// speed 0–2 (drift speed; 1), depth 0–1 (parallax spread; 0.5), and tint
// (neutral, primary or accent: the colour the plate is lit in; neutral is
// paper, a silver on a dark style). A style tints a plate through tint.
//
// Where the plate comes from (scenePlateSpec), first match wins:
//   scenes[i].plate     a plate, or "none" for the story's background
//   chapters[j].plate   the chapter the scene starts in
//   story.plate.cycle   true: chapter j takes PLATE_KINDS[(k + j) % 4], k the story kind's index
//   story.plate         {kind, params?, cycle?} or a kind name
// A plate replaces story.background on the scenes it covers. Absent
// everywhere, nothing changes.
//
// Every colour a layer lays over bg is clamped (backgrounds.mjs safeAlpha) on
// every tone already laid, so text in paper keeps 4.5:1 anywhere on the plate.
// Motion follows the ambient level (off stills it) and is a function of
// absolute time, so any seek gives the same pixels.
//
// Plain ESM; imports only ./ambient.mjs, ./backgrounds.mjs and ./panels.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Backdrop plates".

import { AMBIENT_PRESETS, ambientSeed, fieldLevel, hashString, seededRandom } from './ambient.mjs';
import { safeAlpha, svgUrl } from './backgrounds.mjs';
import { mix } from './panels.mjs';

export const PLATE_KINDS = Object.freeze(['hex-shell', 'silk', 'strands', 'bokeh']);
export const PLATE_TINTS = Object.freeze(['neutral', 'primary', 'accent']);
const range = (min, max, value) => Object.freeze({ min, max, default: value });
export const PLATE_PARAMS = Object.freeze({
  focus: range(0, 1, 0.6),
  intensity: range(0, 1, 0.5),
  speed: range(0, 2, 1),
  depth: range(0, 1, 0.5)
});
// Each kind's own tint when params.tint is absent: silk and hex read as
// silver, strands and bokeh as light in the brand's primary.
export const PLATE_DEFAULT_TINT = Object.freeze({ 'hex-shell': 'neutral', silk: 'neutral', strands: 'primary', bokeh: 'primary' });
const LEVEL_SPEED = Object.freeze({ off: 0, subtle: 0.6, standard: 1, lively: 1.4 });
const HEX = /^#[0-9a-fA-F]{6}$/;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value, digits = 2) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

// ---------------------------------------------------------------------------
// Validation and resolution

/** Validation messages for one plate value: a kind name, {kind, params?, cycle?}, or "none" where allowNone. */
export function plateErrors(value, path = 'plate', { allowNone = false, allowCycle = false } = {}) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    if (allowNone && value === 'none') return [];
    return PLATE_KINDS.includes(value) ? [] : [`${path} must be one of ${PLATE_KINDS.join(', ')}${allowNone ? ', none' : ''} (or {kind, params?})`];
  }
  if (!isObject(value)) return [`${path} must be a plate kind or {kind, params?}`];
  const errors = [];
  const keys = ['kind', 'params', ...(allowCycle ? ['cycle'] : [])];
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${keys.join(', ')})`);
  if (!PLATE_KINDS.includes(value.kind)) { errors.push(`${path}.kind must be one of ${PLATE_KINDS.join(', ')}`); return errors; }
  if (value.cycle !== undefined && typeof value.cycle !== 'boolean') errors.push(`${path}.cycle must be true or false`);
  if (value.params === undefined) return errors;
  if (!isObject(value.params)) return [...errors, `${path}.params must be an object`];
  for (const [key, given] of Object.entries(value.params)) {
    if (key === 'tint') { if (!PLATE_TINTS.includes(given)) errors.push(`${path}.params.tint must be one of ${PLATE_TINTS.join(', ')}`); continue; }
    const spec = PLATE_PARAMS[key];
    if (!spec) { errors.push(`${path}.params.${key} is not supported (allowed: ${[...Object.keys(PLATE_PARAMS), 'tint'].join(', ')})`); continue; }
    if (!(typeof given === 'number' && given >= spec.min && given <= spec.max)) errors.push(`${path}.params.${key} must be a number from ${spec.min} to ${spec.max}`);
  }
  return errors;
}

/** Every plate message for a story: story.plate, chapters[j].plate and scenes[i].plate. */
export function storyPlateErrors(story) {
  const errors = plateErrors(story?.plate, 'plate', { allowCycle: true });
  (Array.isArray(story?.chapters) ? story.chapters : []).forEach((chapter, j) => errors.push(...plateErrors(chapter?.plate, `chapters[${j}].plate`, { allowNone: true })));
  (Array.isArray(story?.scenes) ? story.scenes : []).forEach((scene, i) => errors.push(...plateErrors(scene?.plate, `scenes[${i}].plate`, { allowNone: true })));
  return errors;
}

/** A plate value with every param filled → {kind, params}, "none", or null when absent or invalid. */
export function resolvePlate(value) {
  if (value === 'none') return 'none';
  const spec = typeof value === 'string' ? { kind: value } : value;
  if (!isObject(spec) || !PLATE_KINDS.includes(spec.kind) || plateErrors(spec, 'plate', { allowCycle: true }).length) return null;
  const params = {};
  for (const [key, entry] of Object.entries(PLATE_PARAMS)) params[key] = spec.params?.[key] ?? entry.default;
  params.tint = spec.params?.tint ?? PLATE_DEFAULT_TINT[spec.kind];
  return { kind: spec.kind, params };
}

// The chapter a time falls in: the last chapter whose numeric start is at or before it.
function chapterIndexAt(story, t) {
  const chapters = Array.isArray(story?.chapters) ? story.chapters : [];
  let found = -1;
  chapters.forEach((chapter, j) => { if (typeof chapter?.start === 'number' && chapter.start <= t + 1e-6) found = j; });
  return found;
}

/**
 * The plate a scene sits on → {kind, params} or null (the story's background
 * draws instead). Null too when the scene draws no background at all:
 * ambient.background false on the story or scene, or a footage-led story
 * (the recording is the backdrop). Times must be resolved for chapters to apply.
 */
export function scenePlateSpec(story, scene) {
  const own = isObject(scene?.ambient) ? scene.ambient : {};
  const base = isObject(story?.ambient) ? story.ambient : {};
  if (!(own.background ?? base.background ?? story?.lane !== 'footage-led')) return null;
  const scenePlate = resolvePlate(scene?.plate);
  if (scenePlate) return scenePlate === 'none' ? null : scenePlate;
  const j = chapterIndexAt(story, Number(scene?.start ?? 0));
  const chapterPlate = j >= 0 ? resolvePlate(story.chapters[j]?.plate) : null;
  if (chapterPlate) return chapterPlate === 'none' ? null : chapterPlate;
  const storyPlate = resolvePlate(story?.plate);
  if (!storyPlate || storyPlate === 'none') return null;
  if (story.plate?.cycle === true && j > 0) {
    const kind = PLATE_KINDS[(PLATE_KINDS.indexOf(storyPlate.kind) + j) % PLATE_KINDS.length];
    const tint = story.plate.params?.tint ?? PLATE_DEFAULT_TINT[kind];
    return { kind, params: { ...storyPlate.params, tint } };
  }
  return storyPlate;
}

/** Whether any scene, chapter or the story itself names a plate. */
export function storyHasPlate(story) {
  return Boolean(resolvePlate(story?.plate)) || (story?.chapters ?? []).some?.((c) => resolvePlate(c?.plate)) || (story?.scenes ?? []).some?.((s) => resolvePlate(s?.plate));
}

// ---------------------------------------------------------------------------
// Drawing

function palette(story) {
  const colors = isObject(story?.brand?.colors) ? story.brand.colors : {};
  const pick = (key, fallback) => (HEX.test(colors[key] ?? '') ? colors[key].toLowerCase() : fallback);
  const bg = pick('bg', '#000000');
  const paper = pick('paper', '#ffffff');
  return { bg, paper, primary: pick('primary', paper), accent: pick('accent', pick('primary', paper)), ink: pick('ink', bg) };
}

const box = (x, y, width, height) => ({ x: round(x), y: round(y), width: round(width), height: round(height) });
// A wave axis (ambient.mjs). Its phase is a whole number of half turns: the
// GSAP side plays half-period tweens between extrema at multiples of
// period / 2 (axisSegments), which matches the cosine only then. The periods
// differ, so the layers still drift out of step.
function wave(amp, period, phase) {
  if (!(Math.abs(amp) > 1e-6) || !(period > 0) || !Number.isFinite(period)) return undefined;
  return { kind: 'wave', center: 0, amp: round(amp, 4), period: round(period, 4), phase: Math.round(phase) % 2 };
}

// An SVG document blurred by `blur` px (0 = sharp), drawn in a group at `alpha`.
function svgDoc(width, height, defs, body, blur, alpha) {
  const W = round(width), H = round(height);
  const filter = blur > 0.25 ? `<filter id="b" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${round(blur)}"/></filter>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}${filter}</defs><g opacity="${round(alpha, 4)}"${filter ? ' filter="url(#b)"' : ''}>${body}</g></svg>`;
}

const plans = new WeakMap();

/** The plan for a scene's plate (memoised per story), or null: see scenePlateSpec. */
export function scenePlatePlan(story, scene) {
  const spec = scenePlateSpec(story, scene);
  return spec ? platePlan(story, spec) : null;
}

/** The story-level plate's plan (a world camera's one backdrop), or null. */
export function storyPlatePlan(story) {
  const spec = resolvePlate(story?.plate);
  if (!spec || spec === 'none') return null;
  const own = isObject(story?.ambient) ? story.ambient : {};
  if (!(own.background ?? story?.lane !== 'footage-led')) return null;
  return platePlan(story, spec);
}

/**
 * A plate {kind, params} over the story's canvas → {kind, plate: true, level,
 * params, colors, layers, tones} in backgroundPlan's shape (kit/core/backgrounds.mjs),
 * or null without a canvas. Memoised per story and spec.
 */
export function platePlan(story, spec) {
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!(W > 0 && H > 0) || !spec || !PLATE_KINDS.includes(spec.kind)) return null;
  let cache = isObject(story) ? plans.get(story) : null;
  if (!cache && isObject(story)) { cache = new Map(); plans.set(story, cache); }
  const key = JSON.stringify(spec);
  if (cache?.has(key)) return cache.get(key);
  const plan = drawPlate(story, spec, { width: W, height: H });
  cache?.set(key, plan);
  return plan;
}

function drawPlate(story, { kind, params }, { width: W, height: H }) {
  const level = fieldLevel(story);
  const colors = palette(story);
  const speed = (LEVEL_SPEED[level] ?? 1) * params.speed * (AMBIENT_PRESETS[level] ? 1 : 0);
  const u = Math.min(W, H) / 1080;
  const random = seededRandom((ambientSeed(story) ^ hashString(`plate:${kind}`)) >>> 0);
  const light = params.tint === 'neutral' ? colors.paper : colors[params.tint];
  const tones = new Set([colors.bg]);
  // The largest alpha ≤ want at which `color` keeps paper text at its floor
  // on every tone so far; records the new tones. A `mark` (pinpoints a few px
  // across, finer than a letter's stroke) is clamped the same way but is not
  // a surface text sits on, so it adds no tone.
  const lay = (color, want, { mark = false } = {}) => {
    let alpha = want;
    for (const tone of tones) alpha = Math.min(alpha, safeAlpha(colors, color, want, tone));
    if (!mark) for (const tone of [...tones]) tones.add(mix(tone, color, alpha));
    return alpha;
  };
  const period = (base) => (speed > 0 ? base / speed : Infinity);
  // Depth: far travels least, near most; depth 0 flattens the spread.
  const travel = (d) => (0.6 + params.depth * 1.4) * d;
  const blurAt = (base) => base * u * (0.35 + 1.3 * params.focus);
  const layers = [];
  const add = (id, margin, svg, axes) => {
    const b = box(-margin, -margin, W + 2 * margin, H + 2 * margin);
    // A still plate (speed 0, ambient off) has no axes at all.
    layers.push({ id, box: b, svg: null, style: { backgroundImage: svgUrl(svg(b.width, b.height)), backgroundSize: '100% 100%' }, axes: Object.fromEntries(Object.entries(axes).filter(([, axis]) => axis)) });
  };
  const bright = 0.35 + 0.65 * params.intensity;

  // The atmosphere: a broad lift of the tint behind the subject, and a vignette.
  const glowAt = { 'hex-shell': [0.62, 0.42], silk: [0.5, 0.45], strands: [0.55, 0.5], bokeh: [0.5, 0.55] }[kind];
  const glow = lay(light, 0.06 + 0.1 * params.intensity);
  layers.push({ id: 'air', box: box(0, 0, W, H), svg: null,
    style: { background: `radial-gradient(ellipse 75% 70% at ${glowAt[0] * 100}% ${glowAt[1] * 100}%, ${withA(light, glow)} 0%, ${withA(light, glow * 0.35)} 45%, ${withA(light, 0)} 80%)` }, axes: {} });

  if (kind === 'hex-shell') hexShell({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period, params });
  else if (kind === 'silk') silk({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period });
  else if (kind === 'strands') strands({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period });
  else bokeh({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period });

  // Vignette: the edges sink toward black, which only deepens a dark plate.
  const dark = lay('#000000', 0.55);
  layers.push({ id: 'vignette', box: box(0, 0, W, H), svg: null,
    style: { background: `radial-gradient(ellipse 85% 80% at 50% 50%, ${withA('#000000', 0)} 40%, ${withA('#000000', dark)} 100%)` }, axes: {} });
  return { kind, plate: true, level, params, colors, layers, tones: [...tones] };
}

const withA = (hex, alpha) => `${hex}${Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, '0')}`;

// A sphere of hex cells (orthographic): a flat hex grid wrapped onto the
// sphere by d → R·sin(d/R), so cells crowd toward the limb; each cell shaded
// by its normal against a light from the upper left, with a bright lip.
function hexShell({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period, params }) {
  const S = Math.min(W, H);
  const R = S * 0.62;
  const margin = 90 * u;
  const alpha = lay(light, 0.42 * bright);
  const L = normalize([-0.55, -0.6, 0.6]);
  const subject = (bw, bh) => {
    const cx = bw * 0.64, cy = bh * 0.46;
    const cell = S * 0.082;
    const w = Math.sqrt(3) * cell;
    let body = '';
    const reach = (R * Math.PI) / 2;
    for (let row = -Math.ceil(reach / (cell * 1.5)); row <= Math.ceil(reach / (cell * 1.5)); row += 1) {
      for (let col = -Math.ceil(reach / w) - 1; col <= Math.ceil(reach / w) + 1; col += 1) {
        const hx = col * w + (row % 2 ? w / 2 : 0), hy = row * cell * 1.5;
        const d = Math.hypot(hx, hy);
        if (d > reach * 0.985) continue;
        const wrap = (x, y) => { const r = Math.hypot(x, y); const k = r > 1e-6 ? (R * Math.sin(Math.min(r, reach) / R)) / r : 1; return [cx + x * k, cy + y * k]; };
        const [px, py] = wrap(hx, hy);
        const nx = (px - cx) / R, ny = (py - cy) / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const lit = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const rim = Math.pow(1 - nz, 3);
        const k = 0.12 + 0.6 * lit + 0.5 * rim;
        const pts = [];
        for (let i = 0; i < 6; i += 1) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          pts.push(wrap(hx + Math.cos(a) * cell * 0.84, hy + Math.sin(a) * cell * 0.84));
        }
        const d2 = `M${pts.map(([x, y]) => `${round(x, 1)} ${round(y, 1)}`).join('L')}Z`;
        body += `<path d="${d2}" fill="${mix(colors.bg, light, Math.min(1, k * 0.42))}" stroke="${mix(colors.bg, light, Math.min(1, k * 1.1 + 0.2))}" stroke-width="${round(4.5 * u, 2)}" stroke-linejoin="round"/>`;
      }
    }
    // The shell's dark core so the cells read as a surface, not a decal.
    const defs = `<radialGradient id="core" cx="0.42" cy="0.38" r="0.7"><stop offset="0" stop-color="${mix(colors.bg, light, 0.22)}"/><stop offset="1" stop-color="${colors.bg}"/></radialGradient>`;
    return svgDoc(bw, bh, defs, `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(R)}" fill="url(#core)"/>${body}`, blurAt(7), alpha);
  };
  add('subject', margin, subject, { x: wave(travel(26 * u), period(48), 0), y: wave(travel(18 * u), period(37), 1.3), rotation: wave(2.4, period(64), 0.4) });
  // Near: two out-of-focus cell fragments sliding past the lens.
  const nearAlpha = lay(light, 0.16 * bright);
  const near = (bw, bh) => {
    let body = '';
    for (let i = 0; i < 2; i += 1) {
      const x = bw * (i ? 0.1 : 0.92), y = bh * (i ? 0.85 : 0.12 + random() * 0.1), r = S * (0.16 + random() * 0.06);
      const pts = Array.from({ length: 6 }, (_, k) => { const a = Math.PI / 6 + (k * Math.PI) / 3; return `${round(x + Math.cos(a) * r, 1)} ${round(y + Math.sin(a) * r, 1)}`; });
      body += `<path d="M${pts.join('L')}Z" fill="none" stroke="${light}" stroke-width="${round(10 * u, 2)}"/>`;
    }
    return svgDoc(bw, bh, '', body, blurAt(38), nearAlpha);
  };
  add('near', margin * 2, near, { x: wave(travel(60 * u), period(41), 2.1), y: wave(travel(34 * u), period(33), 0.7) });
  void params;
}

// Silk: ribbons between two wandering curves, shaded across their width
// (dark, a lit fold, dark), laid diagonally; a far, softer bank behind.
function silk({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
  const margin = 140 * u;
  const bank = (count, spread, blur, want, seed) => {
    const alpha = lay(light, want * bright);
    const phases = Array.from({ length: count }, () => [random() * 6.28, random() * 6.28, 0.6 + random() * 0.8]);
    return (bw, bh) => {
      let defs = '', body = '';
      const step = bw / 48;
      for (let i = 0; i < count; i += 1) {
        const [p1, p2, w] = phases[i];
        const base = bh * (0.08 + (i / Math.max(1, count - 1)) * spread);
        const thick = bh * 0.07 * w;
        const top = [], bottom = [];
        for (let x = -step; x <= bw + step; x += step) {
          const s = x / bw;
          const y = base + bh * 0.12 * Math.sin(s * 5.2 + p1) + bh * 0.06 * Math.sin(s * 11 + p2) + (s - 0.5) * bh * 0.35;
          const t = thick * (0.55 + 0.45 * Math.sin(s * 7 + p2 + i));
          top.push([x, y - t]);
          bottom.push([x, y + t]);
        }
        const d = `M${top.map(([x, y]) => `${round(x, 1)} ${round(y, 1)}`).join('L')}L${bottom.reverse().map(([x, y]) => `${round(x, 1)} ${round(y, 1)}`).join('L')}Z`;
        const id = `r${seed}${i}`;
        defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0.18" y2="1"><stop offset="0" stop-color="${colors.bg}"/><stop offset="0.48" stop-color="${mix(colors.bg, light, 0.75)}"/><stop offset="0.56" stop-color="${light}"/><stop offset="1" stop-color="${colors.bg}"/></linearGradient>`;
        body += `<path d="${d}" fill="url(#${id})" opacity="${round(0.55 + 0.45 * ((i * 7) % 5) / 4, 3)}"/>`;
      }
      return svgDoc(bw, bh, defs, body, blur, alpha);
    };
  };
  add('far', margin, bank(7, 0.9, blurAt(30), 0.2, 'f'), { x: wave(travel(20 * u), period(57), 0.3), y: wave(travel(12 * u), period(44), 1.9) });
  add('subject', margin, bank(9, 0.85, blurAt(12), 0.3, 's'), { x: wave(travel(42 * u), period(46), 1.1), y: wave(travel(20 * u), period(38), 0), rotation: wave(1.6, period(70), 2) });
}

// Strands: double helices of beads (radial-lit spheres) joined by rungs; one
// strand in focus across the middle, a big soft one near the lens, a faint
// one far behind.
function strands({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
  const margin = 120 * u;
  const helix = (want, scale, blur, y0, tilt, seed) => {
    // The bead's specular point is the brightest colour laid.
    const alpha = lay(mix(light, '#ffffff', 0.35), want * bright);
    const phase = random() * 6.28;
    return (bw, bh) => {
      const defs = `<radialGradient id="bead${seed}" cx="0.35" cy="0.32" r="0.7"><stop offset="0" stop-color="${mix(light, '#ffffff', 0.35)}"/><stop offset="0.35" stop-color="${light}"/><stop offset="1" stop-color="${mix(colors.bg, light, 0.15)}"/></radialGradient>`;
      const S = Math.min(bw, bh) * scale;
      const n = 30, amp = S * 0.15, bead = S * 0.026;
      let rungs = '', beads = '';
      for (let i = 0; i < n; i += 1) {
        const s = i / (n - 1);
        const x = -bw * 0.05 + s * bw * 1.1;
        const cy = bh * y0 + (s - 0.5) * bh * tilt;
        const a = s * Math.PI * 4 + phase;
        const ends = [0, Math.PI].map((off) => ({ y: cy + Math.sin(a + off) * amp, z: Math.cos(a + off) }));
        rungs += `<line x1="${round(x, 1)}" y1="${round(ends[0].y, 1)}" x2="${round(x, 1)}" y2="${round(ends[1].y, 1)}" stroke="${mix(colors.bg, light, 0.45)}" stroke-width="${round(bead * 0.35, 2)}"/>`;
        for (const end of ends) {
          const r = bead * (0.7 + 0.45 * (end.z + 1) / 2);
          beads += `<circle cx="${round(x, 1)}" cy="${round(end.y, 1)}" r="${round(r, 1)}" fill="url(#bead${seed})" opacity="${round(0.45 + 0.55 * (end.z + 1) / 2, 3)}"/>`;
        }
      }
      return svgDoc(bw, bh, defs, rungs + beads, blur, alpha);
    };
  };
  add('far', margin, helix(0.16, 0.7, blurAt(26), 0.28, 0.3, 'f'), { x: wave(travel(16 * u), period(60), 0.5), y: wave(travel(10 * u), period(47), 2.2) });
  add('subject', margin, helix(0.36, 1.1, blurAt(9), 0.56, -0.25, 's'), { x: wave(travel(36 * u), period(44), 1.2), y: wave(travel(16 * u), period(35), 0.2), rotation: wave(1.2, period(66), 0.9) });
  add('near', margin * 2, helix(0.14, 2.2, blurAt(40), 0.9, 0.4, 'n'), { x: wave(travel(80 * u), period(39), 2.6), y: wave(travel(30 * u), period(31), 1) });
}

// Bokeh: a starfield of pinpoints, mid discs and big soft near discs with a
// brighter edge (a lens's out-of-focus highlight).
function bokeh({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
  const margin = 110 * u;
  const field = (count, rMin, rMax, want, blur, ringed, seed) => {
    const alpha = lay(ringed ? mix(light, '#ffffff', 0.3) : light, want * bright, { mark: !ringed });
    const dots = Array.from({ length: count }, () => [random(), random(), rMin + random() * (rMax - rMin), 0.35 + random() * 0.65]);
    return (bw, bh) => {
      const defs = ringed ? `<radialGradient id="d${seed}"><stop offset="0" stop-color="${light}" stop-opacity="0.45"/><stop offset="0.78" stop-color="${light}" stop-opacity="0.7"/><stop offset="0.92" stop-color="${mix(light, '#ffffff', 0.3)}" stop-opacity="1"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>` : '';
      // Denser toward a diagonal band, like a galaxy's lane.
      const body = dots.map(([x, y, r, o]) => {
        const lane = 0.5 + (x - 0.5) * 0.5;
        const py = (lane + (y - 0.5) * 0.7) * bh;
        return `<circle cx="${round(x * bw, 1)}" cy="${round(py, 1)}" r="${round(r * u, 2)}" fill="${ringed ? `url(#d${seed})` : light}" opacity="${round(o, 3)}"/>`;
      }).join('');
      return svgDoc(bw, bh, defs, body, blur, alpha);
    };
  };
  add('far', margin, field(320, 1.2, 3.4, 0.7, blurAt(1.2), false, 'f'), { x: wave(travel(10 * u), period(62), 0), y: wave(travel(8 * u), period(51), 1.4) });
  add('subject', margin, field(54, 10, 28, 0.45, blurAt(6), true, 's'), { x: wave(travel(30 * u), period(47), 0.8), y: wave(travel(16 * u), period(39), 2.3) });
  add('near', margin * 2, field(10, 70, 160, 0.26, blurAt(20), true, 'n'), { x: wave(travel(70 * u), period(40), 2.2), y: wave(travel(34 * u), period(33), 0.4) });
  void W; void H; void colors;
}

function normalize(v) {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
