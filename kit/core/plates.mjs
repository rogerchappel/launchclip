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
//   starfield  deep space: fine dots at three depths and a few bright stars
//   smoke      grey, low-saturation wisps (smoky silk)
//   wash       a bright full-frame gradient in the tint, for punctuation shots
//   image      a local still (params.src), full-bleed, blurred, dimmed, drifting
//
// Params: focus 0–1 (how out of focus; 0.6), intensity 0–1 (how bright; 0.5),
// speed 0–2 (drift speed; 1), depth 0–1 (parallax spread; 0.5), and tint
// (neutral, primary or accent: the colour the plate is lit in; neutral is
// paper, a silver on a dark style). A style tints a plate through tint.
// image also takes src (a project-relative still such as assets/bg.jpg),
// blur (px at 1080p, 0–80; 24) and dim (0–1, how much bg covers it; 0.55).
//
// Where the plate comes from (scenePlateSpec), first match wins:
//   scenes[i].backdrop  a plate, or "none" for the story's background
//   scenes[i].plate     the same (the older name)
//   chapters[j].plate   the chapter the scene starts in
//   story.plate.cycle   true: chapter j takes CYCLE_KINDS[(k + j) % 4], k the story kind's index;
//                       {every: n, plates?}: every n shots (track-0 scenes) the next of
//                       `plates` (default ROTATION_KINDS), from the story's own plate
//   story.plate         {kind, params?, cycle?} or a kind name
// A plate replaces story.background on the scenes it covers. Absent
// everywhere, nothing changes. In world mode the same per-scene plates are
// the camera's backdrops (kit/core/world-backdrops.mjs).
//
// Every colour a dark kind (DARK_PLATE_KINDS) lays over bg is clamped
// (backgrounds.mjs safeAlpha) on every tone already laid, so text in paper
// keeps 4.5:1 anywhere on the plate. A wash is bright by design and an
// image's pixels are unknown: their tones are reported as they are, and
// finish's caption check backs the captions where they need it.
// Motion follows the ambient level (off stills it) and is a function of
// absolute time, so any seek gives the same pixels.
//
// Plain ESM; imports only ./ambient.mjs, ./backgrounds.mjs and ./panels.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Backdrop plates".

import { AMBIENT_PRESETS, ambientSeed, fieldLevel, hashString, seededRandom } from './ambient.mjs';
import { LOGO_SRC, safeAlpha, svgUrl } from './backgrounds.mjs';
import { mix } from './panels.mjs';

export const PLATE_KINDS = Object.freeze(['hex-shell', 'silk', 'strands', 'bokeh', 'starfield', 'smoke', 'wash', 'image']);
// The kinds whose every tone keeps paper text at 4.5:1 (see the header).
export const DARK_PLATE_KINDS = Object.freeze(['hex-shell', 'silk', 'strands', 'bokeh', 'starfield', 'smoke']);
// cycle: true walks the four original kinds, so the stories that use it keep their plates.
export const CYCLE_KINDS = Object.freeze(['hex-shell', 'silk', 'strands', 'bokeh']);
// cycle: {every} without its own plates walks every dark kind.
export const ROTATION_KINDS = DARK_PLATE_KINDS;
export const CYCLE_MAX_PLATES = 12;
export const PLATE_TINTS = Object.freeze(['neutral', 'primary', 'accent']);
const range = (min, max, value) => Object.freeze({ min, max, default: value });
export const PLATE_PARAMS = Object.freeze({
  focus: range(0, 1, 0.6),
  intensity: range(0, 1, 0.5),
  speed: range(0, 2, 1),
  depth: range(0, 1, 0.5)
});
// Params only one kind takes: an image's file (required), blur and dim.
export const PLATE_KIND_PARAMS = Object.freeze({
  image: Object.freeze({ src: Object.freeze({ path: true }), blur: range(0, 80, 24), dim: range(0, 1, 0.55) })
});
// Each kind's own tint when params.tint is absent: silk, hex, starfield,
// smoke and image read as silver (paper), strands, bokeh and a wash as light
// in the brand's primary.
export const PLATE_DEFAULT_TINT = Object.freeze({ 'hex-shell': 'neutral', silk: 'neutral', strands: 'primary', bokeh: 'primary', starfield: 'neutral', smoke: 'neutral', wash: 'primary', image: 'neutral' });
const LEVEL_SPEED = Object.freeze({ off: 0, subtle: 0.6, standard: 1, lively: 1.4 });
const HEX = /^#[0-9a-fA-F]{6}$/;
// A project-relative still: no scheme, no leading slash, no "..", an image extension.
const IMAGE_SRC = /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/)[^\s"'<>\\]+\.(png|jpe?g|webp|avif)$/i;

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value, digits = 2) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

// ---------------------------------------------------------------------------
// Validation and resolution

/** Whether a value is a project-relative still an image plate can draw. */
export function plateImageSrc(value) {
  return typeof value === 'string' && IMAGE_SRC.test(value) && !value.split('/').includes('..');
}

/** Validation messages for one plate value: a kind name, {kind, params?, cycle?}, or "none" where allowNone. */
export function plateErrors(value, path = 'plate', { allowNone = false, allowCycle = false } = {}) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    if (allowNone && value === 'none') return [];
    if (value === 'image') return [`${path}: an image plate needs its file: {kind: "image", params: {src: "assets/…"}}`];
    return PLATE_KINDS.includes(value) ? [] : [`${path} must be one of ${PLATE_KINDS.join(', ')}${allowNone ? ', none' : ''} (or {kind, params?})`];
  }
  if (!isObject(value)) return [`${path} must be a plate kind or {kind, params?}`];
  const errors = [];
  const keys = ['kind', 'params', ...(allowCycle ? ['cycle'] : [])];
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${keys.join(', ')})`);
  if (!PLATE_KINDS.includes(value.kind)) { errors.push(`${path}.kind must be one of ${PLATE_KINDS.join(', ')}`); return errors; }
  if (value.cycle !== undefined) errors.push(...cycleErrors(value.cycle, `${path}.cycle`));
  const own = PLATE_KIND_PARAMS[value.kind] ?? {};
  if (value.kind === 'image' && !isObject(value.params)) return [...errors, `${path}.params.src is required for an image plate (a still under the project, e.g. assets/backdrop.jpg)`];
  if (value.params === undefined) return errors;
  if (!isObject(value.params)) return [...errors, `${path}.params must be an object`];
  if (value.kind === 'image' && value.params.src === undefined) errors.push(`${path}.params.src is required for an image plate (a still under the project, e.g. assets/backdrop.jpg)`);
  for (const [key, given] of Object.entries(value.params)) {
    if (key === 'tint') { if (!PLATE_TINTS.includes(given)) errors.push(`${path}.params.tint must be one of ${PLATE_TINTS.join(', ')}`); continue; }
    const spec = PLATE_PARAMS[key] ?? own[key];
    if (!spec) { errors.push(`${path}.params.${key} is not supported (allowed: ${[...Object.keys(PLATE_PARAMS), ...Object.keys(own), 'tint'].join(', ')})`); continue; }
    if (spec.path) { if (!plateImageSrc(given)) errors.push(`${path}.params.${key} must be a project-relative .png, .jpg, .webp or .avif path (no URL, no leading /, no ..)`); continue; }
    if (!(typeof given === 'number' && given >= spec.min && given <= spec.max)) errors.push(`${path}.params.${key} must be a number from ${spec.min} to ${spec.max}`);
  }
  return errors;
}

/** Validation messages for story.plate.cycle: true / false, or {every, plates?}. */
export function cycleErrors(cycle, path = 'plate.cycle') {
  if (typeof cycle === 'boolean') return [];
  if (!isObject(cycle)) return [`${path} must be true, false or {every, plates?}`];
  const errors = [];
  for (const key of Object.keys(cycle)) if (!['every', 'plates'].includes(key)) errors.push(`${path}.${key} is not supported (allowed: every, plates)`);
  if (!(Number.isInteger(cycle.every) && cycle.every >= 1 && cycle.every <= 50)) errors.push(`${path}.every must be a whole number of shots from 1 to 50`);
  if (cycle.plates !== undefined) {
    if (!Array.isArray(cycle.plates) || !cycle.plates.length || cycle.plates.length > CYCLE_MAX_PLATES) errors.push(`${path}.plates must be a list of 1 to ${CYCLE_MAX_PLATES} plates`);
    else cycle.plates.forEach((plate, i) => errors.push(...plateErrors(plate, `${path}.plates[${i}]`)));
  }
  return errors;
}

/** Every plate message for a story: story.plate, chapters[j].plate, scenes[i].plate and scenes[i].backdrop. */
export function storyPlateErrors(story) {
  const errors = plateErrors(story?.plate, 'plate', { allowCycle: true });
  (Array.isArray(story?.chapters) ? story.chapters : []).forEach((chapter, j) => errors.push(...plateErrors(chapter?.plate, `chapters[${j}].plate`, { allowNone: true })));
  (Array.isArray(story?.scenes) ? story.scenes : []).forEach((scene, i) => {
    errors.push(...plateErrors(scene?.plate, `scenes[${i}].plate`, { allowNone: true }));
    errors.push(...plateErrors(scene?.backdrop, `scenes[${i}].backdrop`, { allowNone: true }));
  });
  return errors;
}

/** A plate value with every param filled → {kind, params}, "none", or null when absent or invalid. */
export function resolvePlate(value) {
  if (value === 'none') return 'none';
  const spec = typeof value === 'string' ? { kind: value } : value;
  if (!isObject(spec) || !PLATE_KINDS.includes(spec.kind) || plateErrors(spec, 'plate', { allowCycle: true }).length) return null;
  const params = {};
  for (const [key, entry] of Object.entries(PLATE_PARAMS)) params[key] = spec.params?.[key] ?? entry.default;
  for (const [key, entry] of Object.entries(PLATE_KIND_PARAMS[spec.kind] ?? {})) params[key] = spec.params?.[key] ?? entry.default;
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

// A scene's shot number: its place among the track-0 scenes in start order
// (memoised per story), or -1 for a scene on a higher track.
const shotIndexes = new WeakMap();
function shotIndex(story, scene) {
  let byId = isObject(story) ? shotIndexes.get(story) : null;
  if (!byId) {
    const plates = (Array.isArray(story?.scenes) ? story.scenes : []).filter((entry) => (entry?.track ?? 0) === 0)
      .map((entry, index) => ({ entry, index })).sort((a, b) => Number(a.entry.start ?? 0) - Number(b.entry.start ?? 0) || a.index - b.index);
    byId = new Map(plates.map(({ entry }, n) => [entry?.id, n]));
    if (isObject(story)) shotIndexes.set(story, byId);
  }
  return byId.get(scene?.id) ?? -1;
}

// The story plate's generic params laid on another kind: the kind keeps its
// own tint unless the story names one.
function rotated(storyPlate, story, kind) {
  const generic = Object.fromEntries(Object.keys(PLATE_PARAMS).map((key) => [key, storyPlate.params[key]]));
  return resolvePlate({ kind, params: { ...generic, tint: story.plate.params?.tint ?? PLATE_DEFAULT_TINT[kind] } });
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
  const scenePlate = resolvePlate(scene?.backdrop) ?? resolvePlate(scene?.plate);
  if (scenePlate) return scenePlate === 'none' ? null : scenePlate;
  const j = chapterIndexAt(story, Number(scene?.start ?? 0));
  const chapterPlate = j >= 0 ? resolvePlate(story.chapters[j]?.plate) : null;
  if (chapterPlate) return chapterPlate === 'none' ? null : chapterPlate;
  const storyPlate = resolvePlate(story?.plate);
  if (!storyPlate || storyPlate === 'none') return null;
  const cycle = story.plate?.cycle;
  if (cycle === true && j > 0) return rotated(storyPlate, story, CYCLE_KINDS[(CYCLE_KINDS.indexOf(storyPlate.kind) + j) % CYCLE_KINDS.length] ?? storyPlate.kind);
  if (isObject(cycle) && Number.isInteger(cycle.every) && cycle.every >= 1) {
    const step = Math.floor(Math.max(0, shotIndex(story, scene)) / cycle.every);
    if (step === 0) return storyPlate;
    // The rotation: the cycle's own plates (a kind takes the story's params),
    // or every dark kind; it starts from the story's plate when that is in it,
    // else the story's plate goes first.
    const list = (Array.isArray(cycle.plates) ? cycle.plates : ROTATION_KINDS).map((entry) => (typeof entry === 'string' && entry !== 'image' ? rotated(storyPlate, story, entry) : resolvePlate(entry))).filter((entry) => entry && entry !== 'none');
    if (!list.length) return storyPlate;
    const at = list.findIndex((entry) => entry.kind === storyPlate.kind);
    return at >= 0 ? list[(at + step) % list.length] : [storyPlate, ...list][step % (list.length + 1)];
  }
  return storyPlate;
}

/** Whether any scene, chapter or the story itself names a plate. */
export function storyHasPlate(story) {
  return Boolean(resolvePlate(story?.plate)) || (story?.chapters ?? []).some?.((c) => resolvePlate(c?.plate)) || (story?.scenes ?? []).some?.((s) => resolvePlate(s?.plate) || resolvePlate(s?.backdrop));
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
 * params, colors, layers, tones, frame} in backgroundPlan's shape (kit/core/backgrounds.mjs),
 * or null without a canvas. Memoised per story, spec and frame.
 * frame: the canvas-px rect the plate must cover (default the canvas): a world
 * backdrop that travels with the camera covers everywhere its segment shows
 * (kit/core/world-backdrops.mjs), with the same density per screen. A layer
 * marked `fixed` (the vignette) stays on the canvas: a renderer that moves the
 * plate leaves it where it is.
 */
export function platePlan(story, spec, { frame = null } = {}) {
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!(W > 0 && H > 0) || !spec || !PLATE_KINDS.includes(spec.kind)) return null;
  const F = frame ? { x: round(frame.x), y: round(frame.y), width: round(frame.width), height: round(frame.height) } : { x: 0, y: 0, width: W, height: H };
  let cache = isObject(story) ? plans.get(story) : null;
  if (!cache && isObject(story)) { cache = new Map(); plans.set(story, cache); }
  const key = JSON.stringify([spec, F.x, F.y, F.width, F.height]);
  if (cache?.has(key)) return cache.get(key);
  const plan = drawPlate(story, spec, { width: W, height: H, frame: F });
  cache?.set(key, plan);
  return plan;
}

/**
 * The vignette alone, as a fixed layer over the whole canvas: a world camera
 * draws one over all its backdrops (the plates' own stay off), so edges do not
 * double up while one backdrop slides in over another. alpha: how dark the
 * corners sink (0.55 is a plate's own).
 */
export function plateVignette(story, alpha = 0.55) {
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!(W > 0 && H > 0)) return null;
  return vignetteLayer(W, H, alpha);
}

const vignetteLayer = (W, H, alpha) => ({ id: 'vignette', fixed: true, box: box(0, 0, W, H), svg: null,
  style: { background: `radial-gradient(ellipse 85% 80% at 50% 50%, ${withA('#000000', 0)} 40%, ${withA('#000000', alpha)} 100%)` }, axes: {} });

function drawPlate(story, { kind, params }, { width: W, height: H, frame: F }) {
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
  const over = (margin) => box(F.x - margin, F.y - margin, F.width + 2 * margin, F.height + 2 * margin);
  const add = (id, margin, svg, axes) => {
    const b = over(margin);
    // A still plate (speed 0, ambient off) has no axes at all.
    layers.push({ id, box: b, svg: null, style: { backgroundImage: svgUrl(svg(b.width, b.height)), backgroundSize: '100% 100%' }, axes: Object.fromEntries(Object.entries(axes).filter(([, axis]) => axis)) });
  };
  const bright = 0.35 + 0.65 * params.intensity;
  // Screens' worth of area the frame covers: point fields keep their density.
  const area = (F.width * F.height) / (W * H);
  const ctx = { W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period, params, area, layers, tones, over, kind };

  if (kind === 'wash') wash(ctx);
  else if (kind === 'image') image(ctx);
  else {
    // The atmosphere: a broad lift of the tint behind the subject, and a vignette.
    const glowAt = { 'hex-shell': [0.62, 0.42], silk: [0.5, 0.45], strands: [0.55, 0.5], bokeh: [0.5, 0.55], starfield: [0.42, 0.4], smoke: [0.5, 0.5] }[kind];
    const glow = lay(light, 0.06 + 0.1 * params.intensity);
    layers.push({ id: 'air', box: box(F.x, F.y, F.width, F.height), svg: null,
      style: { background: `radial-gradient(ellipse 75% 70% at ${glowAt[0] * 100}% ${glowAt[1] * 100}%, ${withA(light, glow)} 0%, ${withA(light, glow * 0.35)} 45%, ${withA(light, 0)} 80%)` }, axes: {} });
    if (kind === 'hex-shell') hexShell(ctx);
    else if (kind === 'silk') silk(ctx);
    else if (kind === 'strands') strands(ctx);
    else if (kind === 'starfield') starfield(ctx);
    else if (kind === 'smoke') smoke(ctx);
    else bokeh(ctx);
  }

  // Vignette: the edges sink toward black, which only deepens a dark plate
  // (a wash keeps most of its light).
  layers.push(vignetteLayer(W, H, lay('#000000', kind === 'wash' ? 0.25 : 0.55)));
  return { kind, plate: true, level, params, colors, layers, tones: [...tones], frame: F, ...(kind === 'image' ? { src: params.src } : {}) };
}

const withA = (hex, alpha) => `${hex}${Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, '0')}`;

// A sphere of hex cells (orthographic): a flat hex grid wrapped onto the
// sphere by d → R·sin(d/R), so cells crowd toward the limb; each cell shaded
// by its normal against a light from the upper left, with a bright lip.
function hexShell({ W, H, u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
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
}

// Silk: ribbons between two wandering curves, shaded across their width
// (dark, a lit fold, dark), laid diagonally; a far, softer bank behind.
function silk({ u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
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
function strands({ u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
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
function bokeh({ u, add, lay, light, random, bright, blurAt, travel, period, area }) {
  const margin = 110 * u;
  const field = (count, rMin, rMax, want, blur, ringed, seed) => {
    const alpha = lay(ringed ? mix(light, '#ffffff', 0.3) : light, want * bright, { mark: !ringed });
    const dots = Array.from({ length: Math.round(count * area) }, () => [random(), random(), rMin + random() * (rMax - rMin), 0.35 + random() * 0.65]);
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
}

// Starfield: deep space. Far dust and mid stars are crisp pinpoints (marks),
// a faint nebula of the tint and the accent sits far behind, and a few bright
// stars carry a soft halo and a thin cross flare. Every depth drifts slowly,
// the bright stars most.
function starfield({ u, add, lay, light, colors, random, bright, blurAt, travel, period, area }) {
  const margin = 120 * u;
  const nebulaAlpha = lay(light, 0.14 * bright);
  const accentAlpha = lay(colors.accent, 0.1 * bright);
  const clouds = Array.from({ length: Math.max(2, Math.round(3 * area)) }, (_, i) => [random(), random(), 0.3 + random() * 0.25, 0.12 + random() * 0.12, i % 2]);
  add('nebula', margin, (bw, bh) => {
    const S = Math.min(bw, bh);
    const body = clouds.map(([x, y, rx, ry, k]) => `<ellipse cx="${round(x * bw, 1)}" cy="${round(y * bh, 1)}" rx="${round(rx * S * 1.6, 1)}" ry="${round(ry * S * 1.6, 1)}" fill="${k ? colors.accent : light}" opacity="${round(k ? accentAlpha / nebulaAlpha : 1, 3)}" transform="rotate(${round(-24 + 48 * x, 1)} ${round(x * bw, 1)} ${round(y * bh, 1)})"/>`).join('');
    return svgDoc(bw, bh, '', body, blurAt(70), nebulaAlpha);
  }, { x: wave(travel(10 * u), period(80), 0), y: wave(travel(6 * u), period(64), 1) });
  const dots = (count, rMin, rMax, want) => {
    const alpha = lay(light, want * bright, { mark: true });
    const list = Array.from({ length: Math.round(count * area) }, () => [random(), random(), rMin + random() * (rMax - rMin), 0.3 + random() * 0.7]);
    return (bw, bh) => svgDoc(bw, bh, '', list.map(([x, y, r, o]) => `<circle cx="${round(x * bw, 1)}" cy="${round(y * bh, 1)}" r="${round(r * u, 2)}" fill="${light}" opacity="${round(o, 3)}"/>`).join(''), 0, alpha);
  };
  add('far', margin, dots(760, 0.6, 1.4, 0.75), { x: wave(travel(8 * u), period(76), 0), y: wave(travel(5 * u), period(58), 1) });
  add('mid', margin, dots(200, 1.2, 2.4, 0.9), { x: wave(travel(20 * u), period(62), 1), y: wave(travel(12 * u), period(49), 0) });
  // Bright stars: the halo is a surface (a tone); the core and flare are marks.
  const haloAlpha = lay(light, 0.32 * bright);
  const stars = Array.from({ length: Math.max(4, Math.round(7 * area)) }, () => [0.06 + random() * 0.88, 0.08 + random() * 0.84, 0.7 + random() * 0.6]);
  add('bright', margin * 1.5, (bw, bh) => {
    const defs = `<radialGradient id="h"><stop offset="0" stop-color="${mix(light, '#ffffff', 0.5)}" stop-opacity="1"/><stop offset="0.25" stop-color="${light}" stop-opacity="0.45"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>`;
    const body = stars.map(([x, y, k]) => {
      const cx = round(x * bw, 1), cy = round(y * bh, 1), halo = round(30 * u * k, 1), flare = round(46 * u * k, 1), core = round(2.6 * u * k, 2);
      return `<circle cx="${cx}" cy="${cy}" r="${halo}" fill="url(#h)"/><path d="M${round(cx - flare, 1)} ${cy}H${round(cx + flare, 1)}M${cx} ${round(cy - flare, 1)}V${round(cy + flare, 1)}" stroke="${light}" stroke-width="${round(1.1 * u, 2)}" stroke-opacity="0.55" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="${core}" fill="#ffffff"/>`;
    }).join('');
    return svgDoc(bw, bh, defs, body, 0, haloAlpha);
  }, { x: wave(travel(34 * u), period(54), 0), y: wave(travel(18 * u), period(43), 1) });
}

// Smoke: grey, low-saturation wisps. The tint is pulled most of the way to a
// grey of the same lightness; billows far behind, a bank of thin wisps in
// focus and a soft near bank.
function smoke({ u, add, lay, light, random, bright, blurAt, travel, period, area }) {
  const margin = 150 * u;
  const grey = mix(light, greyOf(light), 0.8);
  const billowAlpha = lay(grey, 0.2 * bright);
  const billows = Array.from({ length: Math.max(4, Math.round(6 * area)) }, () => [random(), random(), 0.25 + random() * 0.3, 0.1 + random() * 0.14, random()]);
  add('far', margin, (bw, bh) => {
    const S = Math.min(bw, bh);
    const body = billows.map(([x, y, rx, ry, o]) => `<ellipse cx="${round(x * bw, 1)}" cy="${round(y * bh, 1)}" rx="${round(rx * S * 1.7, 1)}" ry="${round(ry * S * 1.7, 1)}" fill="${grey}" opacity="${round(0.45 + 0.55 * o, 3)}"/>`).join('');
    return svgDoc(bw, bh, '', body, blurAt(64), billowAlpha);
  }, { x: wave(travel(24 * u), period(66), 0), y: wave(travel(12 * u), period(52), 1) });
  const wisps = (count, want, blur, seed) => {
    const alpha = lay(grey, want * bright);
    const n = Math.max(3, Math.round(count * Math.sqrt(area)));
    const shapes = Array.from({ length: n }, () => [random() * 6.28, random() * 6.28, random() * 6.28, 0.3 + random() * 0.7, random()]);
    return (bw, bh) => {
      let defs = '', body = '';
      const step = bw / 60;
      shapes.forEach(([p1, p2, p3, w, y0], i) => {
        const top = [], bottom = [];
        for (let x = -step; x <= bw + step; x += step) {
          const s = x / bw;
          const y = bh * (0.05 + y0 * 0.9) + bh * 0.1 * Math.sin(s * 4.1 + p1) + bh * 0.05 * Math.sin(s * 9.3 + p2) + bh * 0.025 * Math.sin(s * 17 + p3) - (s - 0.5) * bh * 0.2;
          const t = bh * 0.03 * w * (0.35 + 0.65 * Math.abs(Math.sin(s * 5 + p3)));
          top.push([x, y - t]);
          bottom.push([x, y + t]);
        }
        const d = `M${top.map(([x, y]) => `${round(x, 1)} ${round(y, 1)}`).join('L')}L${bottom.reverse().map(([x, y]) => `${round(x, 1)} ${round(y, 1)}`).join('L')}Z`;
        const id = `w${seed}${i}`;
        defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${grey}" stop-opacity="0"/><stop offset="0.5" stop-color="${grey}" stop-opacity="1"/><stop offset="1" stop-color="${grey}" stop-opacity="0"/></linearGradient>`;
        body += `<path d="${d}" fill="url(#${id})" opacity="${round(0.5 + 0.5 * ((i * 5) % 7) / 6, 3)}"/>`;
      });
      return svgDoc(bw, bh, defs, body, blur, alpha);
    };
  };
  add('subject', margin, wisps(11, 0.36, blurAt(10), 's'), { x: wave(travel(40 * u), period(48), 1), y: wave(travel(18 * u), period(39), 0), rotation: wave(1.4, period(72), 1) });
  add('near', margin * 2, wisps(5, 0.18, blurAt(36), 'n'), { x: wave(travel(74 * u), period(41), 0), y: wave(travel(30 * u), period(34), 1) });
}

// Wash: a bright, opaque gradient in the tint (light at the upper left, deeper
// toward the lower right), two drifting soft highlights and a slow diagonal
// sheen. It is bright on purpose, so it is not clamped to paper's contrast:
// its tones are the colours it lays.
function wash({ u, add, light, colors, params, travel, period, layers, tones, over }) {
  const k = params.intensity;
  const hi = mix(light, '#ffffff', 0.12 + 0.25 * k), mid = light, low = mix(light, colors.bg, 0.45 - 0.3 * k);
  for (const tone of [hi, mid, low]) tones.add(tone);
  const b = over(0);
  layers.push({ id: 'base', box: b, svg: null, style: { background: `linear-gradient(135deg, ${hi} 0%, ${mid} 48%, ${low} 100%)` }, axes: {} });
  const glow = 0.28 + 0.2 * k;
  tones.add(mix(hi, '#ffffff', glow));
  add('glow', 160 * u, (bw, bh) => {
    const S = Math.min(bw, bh);
    const body = `<ellipse cx="${round(bw * 0.28, 1)}" cy="${round(bh * 0.3, 1)}" rx="${round(S * 0.55, 1)}" ry="${round(S * 0.38, 1)}" fill="#ffffff"/><ellipse cx="${round(bw * 0.78, 1)}" cy="${round(bh * 0.72, 1)}" rx="${round(S * 0.4, 1)}" ry="${round(S * 0.3, 1)}" fill="#ffffff" opacity="0.6"/>`;
    return svgDoc(bw, bh, '', body, 110 * u, glow);
  }, { x: wave(travel(60 * u), period(30), 0), y: wave(travel(36 * u), period(24), 1) });
  add('sheen', 220 * u, (bw, bh) => {
    const defs = `<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0.38" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="1"/><stop offset="0.62" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`;
    return svgDoc(bw, bh, defs, `<rect width="${round(bw)}" height="${round(bh)}" fill="url(#s)"/>`, 40 * u, 0.16);
  }, { x: wave(travel(140 * u), period(22), 0) });
}

// Image: a still from the project, full-bleed (cover), blurred inside its SVG
// and drawn past every edge by twice the blur so the blur never thins at the
// frame, with a slow push and drift, under a bg-coloured dim. The file is named
// as LOGO_SRC and each renderer swaps in its own URL (backgrounds.mjs layerSvg).
// Its pixels are unknown, so its tones are white and black under the dim.
function image({ u, colors, params, travel, period, layers, tones, over }) {
  const blur = params.blur * u;
  const margin = 70 * u + 2 * blur;
  const b = over(margin);
  const id = `lc-plate-img-${hashString(`${params.src}|${blur}|${b.width}x${b.height}`).toString(36)}`;
  const pad = round(2 * blur + 2);
  // The filter region is the layer's own box (user space), so the blurred
  // overscan is cut at the box edge, where it is still opaque.
  const filter = blur > 0.25 ? `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${b.width}" height="${b.height}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${round(blur)}"/></filter>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" preserveAspectRatio="none">${filter ? `<defs>${filter}</defs>` : ''}<image href="${LOGO_SRC}" x="${-pad}" y="${-pad}" width="${round(b.width + 2 * pad)}" height="${round(b.height + 2 * pad)}" preserveAspectRatio="xMidYMid slice"${filter ? ` filter="url(#${id})"` : ''}/></svg>`;
  const scale = period(40) < Infinity ? { kind: 'wave', center: 1.03, amp: 0.025, period: round(period(40), 4), phase: 0 } : undefined;
  const axes = { x: wave(travel(26 * u), period(46), 1), y: wave(travel(14 * u), period(37), 0), scale };
  layers.push({ id: 'image', box: b, src: params.src, svg, style: {}, axes: Object.fromEntries(Object.entries(axes).filter(([, axis]) => axis)) });
  layers.push({ id: 'dim', box: over(0), svg: null, style: { background: colors.bg, opacity: round(params.dim, 3) }, axes: {} });
  for (const ink of ['#ffffff', '#000000']) tones.add(mix(ink, colors.bg, params.dim));
}

// A grey of the same lightness (Rec. 709 luma).
function greyOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const v = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
}

function normalize(v) {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}
