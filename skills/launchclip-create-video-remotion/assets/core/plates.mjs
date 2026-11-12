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
//   silk        folded ribbons of silk flowing across the frame
//   smoke       grey, low-saturation wisps (smoky silk)
//   bokeh       out-of-focus points of light: pinpoints far, soft discs near
//   veil        tall, leaning curtains of soft light in the tint and the accent
//   facets      an out-of-focus sheet of flat-shaded triangles
//   halftone    a dot screen that swells and thins across the frame
//   grain       two pools of light under still film grain
//   blooms      large blurred pools of the tint and the accent
//   light-leak  light spilling in from one side, with one long streak
//   spotlight   one soft pool of light with a long falloff
//   studio      a seamless studio sweep: a low band of light, a falling floor
//   beams       broad shafts of light from above
//   prism       diagonal streaks grading from the tint to the accent
//   bands       broad, soft diagonal bands
//   panes       large frosted rounded rectangles, overlapping
//   arcs        thin segments of very large circles
//   ripples     concentric rings from a point off-centre
//   flow-lines  stacked fine lines that wander together
//   pinstripe   fine diagonal lines under a slow sheen
//   dot-field   a regular grid of fine dots at two depths
//   linen       a still weave of fine threads over a soft glow
//   brush       broad dry-brush strokes
//   wash       a bright full-frame gradient in the tint, for punctuation shots
//   image      a local still (params.src), full-bleed, blurred, dimmed, drifting
//   video      a local clip (params.src from params.start s), full-bleed, under
//              an overlay treatment: dim (bg over it), blur (soft focus and a
//              lighter dim) or tint (a brand gradient over it)
//
// Params: focus 0–1 (how out of focus; 0.6), intensity 0–1 (how bright; 0.5),
// speed 0–2 (drift speed; 1), depth 0–1 (parallax spread; 0.5), and tint
// (neutral, primary or accent: the colour the plate is lit in; neutral is
// paper, a silver on a dark style). A style tints a plate through tint.
// image also takes src (a project-relative still such as assets/bg.jpg),
// blur (px at 1080p, 0–80; 24) and dim (0–1, how much bg covers it; 0.55).
// video takes src (a project-relative .mp4, .webm or .mov), start (seconds
// into the clip where it plays from; 0), treatment (dim, blur or tint; dim),
// blur and dim (each treatment's own defaults, VIDEO_TREATMENTS) and peak
// (0–1, the footage's brightest level once blurred, as measured; 1, white,
// when unknown). Its dim is raised to the floor at which paper text keeps
// 4.5:1 on a pixel at peak (videoPlateFloor), so a card over footage stays
// readable whatever the footage does.
//
// Where the plate comes from (scenePlateSpec), first match wins:
//   scenes[i].backdrop  a plate, or "none" for the story's background
//   scenes[i].plate     the same (the older name)
//   chapters[j].plate   the chapter the scene starts in
//   story.plate.cycle   true: chapter j takes CYCLE_KINDS[(k + j) % 4], k the story kind's index (0 when it is not one of them);
//                       {every: n, plates?}: every n shots (track-0 scenes) the next of
//                       `plates` (default ROTATION_KINDS), from the story's own plate
//   story.plate         {kind, params?, cycle?} or a kind name
// make's Motion videos rotate fallbackPlates when the plan chose none: neutral,
// brand-lit plates and the project's footage.
// No kind depicts a thing: a backdrop that shows a subject (a molecule, a
// globe, deep space) changes what the video seems to be about. The kinds that
// did are retired (RETIRED_PLATE_KINDS): a story that names one still builds,
// on the neutral kind listed for it, and validation warns.
// A plate replaces story.background on the scenes it covers. Absent
// everywhere, nothing changes. In world mode the same per-scene plates are
// the camera's backdrops (kit/core/world-backdrops.mjs).
//
// Every colour a dark kind (DARK_PLATE_KINDS) lays over bg is clamped
// (backgrounds.mjs safeAlpha) on every tone already laid, so text in paper
// keeps 4.5:1 anywhere on the plate. A wash is bright by design and an
// image's pixels are unknown: their tones are reported as they are, and
// finish's caption check backs the captions where they need it. A video's
// pixels are bounded by its peak, and its dim is set from it (see above).
// Motion follows the ambient level (off stills it) and is a function of
// absolute time, so any seek gives the same pixels.
//
// Plain ESM; imports only ./ambient.mjs, ./backgrounds.mjs and ./panels.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Backdrop plates".

import { AMBIENT_PRESETS, ambientSeed, fieldLevel, hashString, seededRandom } from './ambient.mjs';
import { LOGO_SRC, safeAlpha, svgUrl } from './backgrounds.mjs';
import { contrast, mix } from './panels.mjs';

export const PLATE_KINDS = Object.freeze(['silk', 'smoke', 'bokeh', 'veil', 'facets', 'halftone', 'grain', 'blooms', 'light-leak', 'spotlight', 'studio', 'beams', 'prism', 'bands', 'panes', 'arcs', 'ripples', 'flow-lines', 'pinstripe', 'dot-field', 'linen', 'brush', 'wash', 'image', 'video']);
// The kinds whose every tone keeps paper text at 4.5:1 (see the header).
export const DARK_PLATE_KINDS = Object.freeze(['silk', 'smoke', 'bokeh', 'veil', 'facets', 'halftone', 'grain', 'blooms', 'light-leak', 'spotlight', 'studio', 'beams', 'prism', 'bands', 'panes', 'arcs', 'ripples', 'flow-lines', 'pinstripe', 'dot-field', 'linen', 'brush']);
// cycle: true walks these four.
export const CYCLE_KINDS = Object.freeze(['silk', 'veil', 'smoke', 'bokeh']);
// One line on each dark kind's look, for whoever picks one (the planning prompt, docs).
export const PLATE_NOTES = Object.freeze({
  silk: 'folded ribbons of silk',
  smoke: 'grey wisps',
  bokeh: 'out-of-focus points of light',
  veil: 'tall curtains of soft light',
  facets: 'soft flat-shaded triangles',
  halftone: 'a dot screen that swells and thins',
  grain: 'pools of light under film grain',
  blooms: 'large blurred pools of colour',
  'light-leak': 'light spilling in from one side',
  spotlight: 'one soft pool of light',
  studio: 'a seamless studio sweep',
  beams: 'broad shafts of light from above',
  prism: 'diagonal streaks grading from the primary to the accent',
  bands: 'broad soft diagonal bands',
  panes: 'overlapping frosted panes',
  arcs: 'thin segments of very large circles',
  ripples: 'soft concentric rings',
  'flow-lines': 'stacked fine wavy lines',
  pinstripe: 'fine diagonal lines under a slow sheen',
  'dot-field': 'a regular grid of fine dots',
  linen: 'a fine weave under a soft glow',
  brush: 'broad dry-brush strokes'
});
// Kinds that depicted a subject, and the neutral kind drawn for a story that still names one.
export const RETIRED_PLATE_KINDS = Object.freeze({ 'hex-shell': 'smoke', strands: 'silk', starfield: 'bokeh' });
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
// A video plate's overlay treatments and the blur and dim each starts from:
// dim keeps the footage nearly sharp under a heavy dim, blur softens it so a
// lighter dim reads, tint lays a brand gradient (primary into bg) over it.
export const VIDEO_TREATMENTS = Object.freeze({
  dim: Object.freeze({ blur: 4, dim: 0.62 }),
  blur: Object.freeze({ blur: 26, dim: 0.5 }),
  tint: Object.freeze({ blur: 10, dim: 0.6 })
});
// Text on a plate over footage: paper keeps this ratio on a pixel at its peak.
export const VIDEO_PLATE_CONTRAST = 4.5;
// The darkest a floor may push the overlay: past it the footage is gone.
const VIDEO_DIM_MAX = 0.92;
// Params only one kind takes: an image's file (required), blur and dim; a
// video's file (required), start, treatment, blur, dim and peak (a null
// default comes from the treatment).
export const PLATE_KIND_PARAMS = Object.freeze({
  image: Object.freeze({ src: Object.freeze({ path: 'image' }), blur: range(0, 80, 24), dim: range(0, 1, 0.55) }),
  video: Object.freeze({ src: Object.freeze({ path: 'video' }), start: range(0, 86400, 0), treatment: Object.freeze({ values: Object.keys(VIDEO_TREATMENTS), default: 'dim' }), blur: range(0, 80, null), dim: range(0, 1, null), peak: range(0, 1, 1) })
});
// Each kind's own tint when params.tint is absent: neutral reads as silver
// (paper), the others as light in the brand's primary.
export const PLATE_DEFAULT_TINT = Object.freeze({ silk: 'neutral', bokeh: 'primary', smoke: 'neutral', veil: 'primary', facets: 'neutral', halftone: 'primary', grain: 'primary', blooms: 'primary', 'light-leak': 'accent', spotlight: 'neutral', studio: 'neutral', beams: 'neutral', prism: 'primary', bands: 'primary', panes: 'neutral', arcs: 'primary', ripples: 'primary', 'flow-lines': 'primary', pinstripe: 'neutral', 'dot-field': 'neutral', linen: 'neutral', brush: 'primary', wash: 'primary', image: 'neutral', video: 'primary' });
const LEVEL_SPEED = Object.freeze({ off: 0, subtle: 0.6, standard: 1, lively: 1.4 });
const HEX = /^#[0-9a-fA-F]{6}$/;
// A project-relative still: no scheme, no leading slash, no "..", an image extension.
const IMAGE_SRC = /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/)[^\s"'<>\\]+\.(png|jpe?g|webp|avif)$/i;
// A project-relative clip: the same, with a video extension.
const VIDEO_SRC = /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/)[^\s"'<>\\]+\.(mp4|webm|mov)$/i;
const FILE_PLATE = Object.freeze({ image: 'a still under the project, e.g. assets/backdrop.jpg', video: 'a clip under the project, e.g. assets/broll.mp4' });

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const retired = (kind) => (typeof kind === 'string' && Object.hasOwn(RETIRED_PLATE_KINDS, kind) ? RETIRED_PLATE_KINDS[kind] : null);
// A plate value with a retired kind swapped for its neutral one.
const current = (value) => (retired(value) ?? (isObject(value) && retired(value.kind) ? { ...value, kind: retired(value.kind) } : value));
const round = (value, digits = 2) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

// ---------------------------------------------------------------------------
// Validation and resolution

/** Whether a value is a project-relative still an image plate can draw. */
export function plateImageSrc(value) {
  return typeof value === 'string' && IMAGE_SRC.test(value) && !value.split('/').includes('..');
}

/** Whether a value is a project-relative clip a video plate can play. */
export function plateVideoSrc(value) {
  return typeof value === 'string' && VIDEO_SRC.test(value) && !value.split('/').includes('..');
}

/** Validation messages for one plate value: a kind name, {kind, params?, cycle?}, or "none" where allowNone. */
export function plateErrors(plate, path = 'plate', { allowNone = false, allowCycle = false } = {}) {
  const value = current(plate);
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') {
    if (allowNone && value === 'none') return [];
    if (FILE_PLATE[value]) return [`${path}: ${value === 'image' ? 'an' : 'a'} ${value} plate needs its file: {kind: "${value}", params: {src: "assets/…"}}`];
    return PLATE_KINDS.includes(value) ? [] : [`${path} must be one of ${PLATE_KINDS.join(', ')}${allowNone ? ', none' : ''} (or {kind, params?})`];
  }
  if (!isObject(value)) return [`${path} must be a plate kind or {kind, params?}`];
  const errors = [];
  const keys = ['kind', 'params', ...(allowCycle ? ['cycle'] : [])];
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${keys.join(', ')})`);
  if (!PLATE_KINDS.includes(value.kind)) { errors.push(`${path}.kind must be one of ${PLATE_KINDS.join(', ')}`); return errors; }
  if (value.cycle !== undefined) errors.push(...cycleErrors(value.cycle, `${path}.cycle`));
  const own = PLATE_KIND_PARAMS[value.kind] ?? {};
  const srcRequired = `${path}.params.src is required for ${value.kind === 'image' ? 'an' : 'a'} ${value.kind} plate (${FILE_PLATE[value.kind]})`;
  if (FILE_PLATE[value.kind] && !isObject(value.params)) return [...errors, srcRequired];
  if (value.params === undefined) return errors;
  if (!isObject(value.params)) return [...errors, `${path}.params must be an object`];
  if (FILE_PLATE[value.kind] && value.params.src === undefined) errors.push(srcRequired);
  for (const [key, given] of Object.entries(value.params)) {
    if (key === 'tint') { if (!PLATE_TINTS.includes(given)) errors.push(`${path}.params.tint must be one of ${PLATE_TINTS.join(', ')}`); continue; }
    const spec = PLATE_PARAMS[key] ?? own[key];
    if (!spec) { errors.push(`${path}.params.${key} is not supported (allowed: ${[...Object.keys(PLATE_PARAMS), ...Object.keys(own), 'tint'].join(', ')})`); continue; }
    if (spec.path === 'image') { if (!plateImageSrc(given)) errors.push(`${path}.params.${key} must be a project-relative .png, .jpg, .webp or .avif path (no URL, no leading /, no ..)`); continue; }
    if (spec.path === 'video') { if (!plateVideoSrc(given)) errors.push(`${path}.params.${key} must be a project-relative .mp4, .webm or .mov path (no URL, no leading /, no ..)`); continue; }
    if (spec.values) { if (!spec.values.includes(given)) errors.push(`${path}.params.${key} must be one of ${spec.values.join(', ')}`); continue; }
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
export function resolvePlate(plate) {
  if (plate === 'none') return 'none';
  const value = current(plate);
  const spec = typeof value === 'string' ? { kind: value } : value;
  if (!isObject(spec) || !PLATE_KINDS.includes(spec.kind) || plateErrors(spec, 'plate', { allowCycle: true }).length) return null;
  const params = {};
  for (const [key, entry] of Object.entries(PLATE_PARAMS)) params[key] = spec.params?.[key] ?? entry.default;
  for (const [key, entry] of Object.entries(PLATE_KIND_PARAMS[spec.kind] ?? {})) params[key] = spec.params?.[key] ?? entry.default;
  if (spec.kind === 'video') for (const key of ['blur', 'dim']) params[key] ??= VIDEO_TREATMENTS[params.treatment][key];
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
  if (cycle === true && j > 0) return rotated(storyPlate, story, CYCLE_KINDS[(Math.max(0, CYCLE_KINDS.indexOf(storyPlate.kind)) + j) % CYCLE_KINDS.length]);
  if (isObject(cycle) && Number.isInteger(cycle.every) && cycle.every >= 1) {
    const step = Math.floor(Math.max(0, shotIndex(story, scene)) / cycle.every);
    if (step === 0) return storyPlate;
    // The rotation: the cycle's own plates (a kind takes the story's params),
    // or every dark kind; it starts from the story's plate when that is in it,
    // else the story's plate goes first.
    const list = (Array.isArray(cycle.plates) ? cycle.plates : ROTATION_KINDS).map((entry) => (typeof entry === 'string' && !FILE_PLATE[entry] ? rotated(storyPlate, story, entry) : resolvePlate(entry))).filter((entry) => entry && entry !== 'none');
    if (!list.length) return storyPlate;
    const at = list.findIndex((entry) => entry.kind === storyPlate.kind);
    return at >= 0 ? list[(at + step) % list.length] : [storyPlate, ...list][step % (list.length + 1)];
  }
  return storyPlate;
}

// ---------------------------------------------------------------------------
// Fallback plates: what a generated video (make) puts behind its full-screen
// cards when nothing else chose a plate: neutral plates lit in the brand's own
// colours, and the project's own footage, blurred and dimmed, when it has
// some. All of them are dark over bg (no wash), so the brand frame and logo
// keep the backdrop they are drawn against.

const plate = (kind, tint, extra = {}) => Object.freeze({ kind, params: Object.freeze({ tint, ...extra }) });
// Neutral plates for any brand, in rotation order: no two neighbours share a kind.
export const NEUTRAL_PLATES = Object.freeze([
  plate('silk', 'primary'),
  plate('smoke', 'neutral'),
  plate('veil', 'accent'),
  plate('blooms', 'primary'),
  plate('facets', 'neutral'),
  plate('light-leak', 'accent'),
  plate('flow-lines', 'primary'),
  plate('grain', 'neutral')
]);
// Footage behind a card: blurred well out of focus, under the treatment's dim
// (raised to the contrast floor; see videoPlateFloor).
const FOOTAGE_PLATES = 4;
const FOOTAGE_IMAGE = Object.freeze({ blur: 32, dim: 0.62 });

// The project's own footage on a story's shots → up to FOOTAGE_PLATES plates
// (video: blur treatment from where the shot plays; image: blurred and dimmed).
function footagePlates(story) {
  const seen = new Set();
  const found = [];
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    const media = scene?.params?.media;
    const src = typeof media === 'string' ? media : media?.src;
    if (typeof src !== 'string' || seen.has(src)) continue;
    seen.add(src);
    const start = Math.max(0, Number(media?.sourceStart ?? 0) || 0);
    if (plateVideoSrc(src)) found.push({ kind: 'video', params: { src, ...(start > 0 ? { start: round(start, 3) } : {}), treatment: 'blur' } });
    else if (plateImageSrc(src)) found.push({ kind: 'image', params: { src, ...FOOTAGE_IMAGE } });
  }
  // From the middle out: the first card after the hook does not sit on the hook's own clip.
  const half = Math.floor(found.length / 2);
  return [...found.slice(half), ...found.slice(0, half)].slice(0, FOOTAGE_PLATES);
}

/**
 * The plates a story with none of its own rotates through → [{kind, params}]:
 * NEUTRAL_PLATES, with the project's own footage between them when its shots
 * have some. Neighbours never repeat a plate.
 */
export function fallbackPlates(story) {
  const drawn = NEUTRAL_PLATES.map((entry) => ({ kind: entry.kind, params: { ...entry.params } }));
  const footage = footagePlates(story);
  if (!footage.length) return drawn;
  const out = [];
  for (let i = 0; i < Math.max(drawn.length, footage.length); i += 1) {
    if (drawn[i]) out.push(drawn[i]);
    if (footage[i]) out.push(footage[i]);
  }
  return out.slice(0, CYCLE_MAX_PLATES);
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
  else if (kind === 'video') video(ctx);
  else {
    // The atmosphere: a broad lift of the tint behind the subject, and a vignette.
    const glowAt = GLOW_AT[kind] ?? [0.5, 0.5];
    const glow = lay(light, 0.06 + 0.1 * params.intensity);
    layers.push({ id: 'air', box: box(F.x, F.y, F.width, F.height), svg: null,
      style: { background: `radial-gradient(ellipse 75% 70% at ${glowAt[0] * 100}% ${glowAt[1] * 100}%, ${withA(light, glow)} 0%, ${withA(light, glow * 0.35)} 45%, ${withA(light, 0)} 80%)` }, axes: {} });
    DRAW[kind](ctx);
  }

  // Vignette: the edges sink toward black, which only deepens a dark plate
  // (a wash keeps most of its light).
  layers.push(vignetteLayer(W, H, lay('#000000', kind === 'wash' ? 0.25 : 0.55)));
  return { kind, plate: true, level, params: ctx.params, colors, layers, tones: [...tones], frame: F, ...(FILE_PLATE[kind] ? { src: params.src } : {}), ...(ctx.contrast ? { contrast: ctx.contrast } : {}) };
}

const withA = (hex, alpha) => `${hex}${Math.max(0, Math.min(255, Math.round(alpha * 255))).toString(16).padStart(2, '0')}`;

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

// Bokeh: pinpoints, mid discs and big soft near discs with a brighter edge
// (a lens's out-of-focus highlight), spread evenly over the frame.
function bokeh({ u, add, lay, light, random, bright, blurAt, travel, period, area }) {
  const margin = 110 * u;
  const field = (count, rMin, rMax, want, blur, ringed, seed) => {
    const alpha = lay(ringed ? mix(light, '#ffffff', 0.3) : light, want * bright, { mark: !ringed });
    const dots = Array.from({ length: Math.round(count * area) }, () => [random(), random(), rMin + random() * (rMax - rMin), 0.35 + random() * 0.65]);
    return (bw, bh) => {
      const defs = ringed ? `<radialGradient id="d${seed}"><stop offset="0" stop-color="${light}" stop-opacity="0.45"/><stop offset="0.78" stop-color="${light}" stop-opacity="0.7"/><stop offset="0.92" stop-color="${mix(light, '#ffffff', 0.3)}" stop-opacity="1"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>` : '';
      const body = dots.map(([x, y, r, o]) => {
        const py = y * bh;
        return `<circle cx="${round(x * bw, 1)}" cy="${round(py, 1)}" r="${round(r * u, 2)}" fill="${ringed ? `url(#d${seed})` : light}" opacity="${round(o, 3)}"/>`;
      }).join('');
      return svgDoc(bw, bh, defs, body, blur, alpha);
    };
  };
  add('far', margin, field(320, 1.2, 3.4, 0.7, blurAt(1.2), false, 'f'), { x: wave(travel(10 * u), period(62), 0), y: wave(travel(8 * u), period(51), 1.4) });
  add('subject', margin, field(54, 10, 28, 0.45, blurAt(6), true, 's'), { x: wave(travel(30 * u), period(47), 0.8), y: wave(travel(16 * u), period(39), 2.3) });
  add('near', margin * 2, field(10, 70, 160, 0.26, blurAt(20), true, 'n'), { x: wave(travel(70 * u), period(40), 2.2), y: wave(travel(34 * u), period(33), 0.4) });
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

// Veil: tall, leaning curtains of soft light in the tint and the accent, each
// fading out above and below; a broad far bank and a nearer one drift apart.
function veil({ u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
  const margin = 160 * u;
  const bank = (count, want, blur, seed) => {
    const alpha = lay(light, want * bright);
    const accent = lay(colors.accent, want * 0.8 * bright);
    const folds = Array.from({ length: count }, (_, i) => [(i + 0.2 + random() * 0.6) / count, 0.05 + random() * 0.07, random() * 6.28, -0.3 + random() * 0.6, 0.25 + random() * 0.3, i % 3 === 1]);
    return (bw, bh) => {
      let defs = '', body = '';
      const step = bh / 24;
      folds.forEach(([x, w, p, lean, peak, isAccent], i) => {
        const color = isAccent ? colors.accent : light;
        const left = [], right = [];
        for (let y = -step; y <= bh + step; y += step) {
          const t = y / bh;
          const cx = x * bw + (t - 0.5) * lean * bw * 0.4 + bw * 0.025 * Math.sin(t * 5 + p);
          const half = w * bw * (0.65 + 0.35 * Math.sin(t * 3.4 + p * 1.7));
          left.push([cx - half, y]);
          right.push([cx + half, y]);
        }
        const id = `v${seed}${i}`;
        defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0"/><stop offset="${round(peak, 3)}" stop-color="${color}" stop-opacity="1"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
        body += `<path d="M${left.map(([px, py]) => `${round(px, 1)} ${round(py, 1)}`).join('L')}L${right.reverse().map(([px, py]) => `${round(px, 1)} ${round(py, 1)}`).join('L')}Z" fill="url(#${id})" opacity="${round(isAccent ? Math.min(1, accent / Math.max(alpha, 1e-3)) : 1, 3)}"/>`;
      });
      return svgDoc(bw, bh, defs, body, blur, alpha);
    };
  };
  add('far', margin, bank(4, 0.2, blurAt(64), 'f'), { x: wave(travel(24 * u), period(64), 0), y: wave(travel(10 * u), period(52), 1) });
  add('subject', margin, bank(6, 0.3, blurAt(28), 's'), { x: wave(travel(52 * u), period(50), 1), y: wave(travel(16 * u), period(41), 0) });
}

// Facets: a jittered sheet of triangles, each a flat shade between bg and the
// tint, out of focus; a larger, softer sheet far behind.
function facets({ u, add, lay, light, colors, random, bright, blurAt, travel, period }) {
  const margin = 130 * u;
  const N = 24;
  const sheet = (cell, want, blur) => {
    const alpha = lay(light, want * bright);
    const table = Array.from({ length: N * N }, () => [random() - 0.5, random() - 0.5, random(), random()]);
    const at = (i, k) => table[(((i % N) + N) % N) * N + (((k % N) + N) % N)];
    return (bw, bh) => {
      const c = cell * u;
      const point = (i, k) => { const [jx, jy] = at(i, k); return `${round((i + jx * 0.7) * c, 1)} ${round((k + jy * 0.7) * c, 1)}`; };
      let body = '';
      for (let k = -1; k <= Math.ceil(bh / c); k += 1) for (let i = -1; i <= Math.ceil(bw / c); i += 1) {
        const [, , s1, s2] = at(i, k);
        const shade = (s) => mix(colors.bg, light, 0.08 + 0.92 * s * s);
        body += `<path d="M${point(i, k)}L${point(i + 1, k)}L${point(i, k + 1)}Z" fill="${shade(s1)}"/><path d="M${point(i + 1, k)}L${point(i + 1, k + 1)}L${point(i, k + 1)}Z" fill="${shade(s2)}"/>`;
      }
      return svgDoc(bw, bh, '', body, blur, alpha);
    };
  };
  add('far', margin, sheet(520, 0.16, blurAt(40)), { x: wave(travel(18 * u), period(62), 0), y: wave(travel(10 * u), period(49), 1) });
  add('subject', margin, sheet(250, 0.26, blurAt(8)), { x: wave(travel(40 * u), period(47), 1), y: wave(travel(20 * u), period(38), 0), rotation: wave(1.2, period(70), 1) });
}

// Halftone: a screen of dots whose size follows a slow, soft field, so the
// screen swells and thins across the frame; a few huge soft dots near the lens.
function halftone({ u, add, lay, light, random, bright, blurAt, travel, period }) {
  const margin = 120 * u;
  const screen = (pitch, want, blur) => {
    const alpha = lay(light, want * bright);
    const p1 = random() * 6.28, p2 = random() * 6.28;
    return (bw, bh) => {
      const step = pitch * u, rowStep = step * 0.866;
      let body = '';
      for (let row = 0; row * rowStep <= bh; row += 1) for (let col = 0; col * step <= bw + step; col += 1) {
        const x = col * step + (row % 2 ? step / 2 : 0), y = row * rowStep;
        const s = x / bw, t = y / bh;
        const f = 0.5 + 0.5 * Math.sin(s * 3.1 + t * 2.3 + p1) * Math.cos(t * 2.7 - s * 1.3 + p2);
        const r = step * 0.44 * f * f;
        if (r >= 0.6 * u) body += `<circle cx="${round(x, 1)}" cy="${round(y, 1)}" r="${round(r, 1)}"/>`;
      }
      return svgDoc(bw, bh, '', `<g fill="${light}">${body}</g>`, blur, alpha);
    };
  };
  add('subject', margin, screen(42, 0.3, blurAt(2.5)), { x: wave(travel(34 * u), period(48), 0), y: wave(travel(18 * u), period(39), 1), rotation: wave(1, period(72), 0) });
  add('near', margin * 2, screen(260, 0.12, blurAt(34)), { x: wave(travel(70 * u), period(41), 1), y: wave(travel(30 * u), period(33), 0) });
}

// Grain: two soft pools of light (the tint, the accent) drifting under a
// still sheet of fine film grain.
function grain({ u, add, lay, light, colors, random, bright, travel, period, layers, over }) {
  const alpha = lay(light, 0.24 * bright);
  const accent = lay(colors.accent, 0.16 * bright);
  const pools = [[0.22 + random() * 0.16, 0.26 + random() * 0.16, 0.56, 0.4, light, 1], [0.66 + random() * 0.14, 0.64 + random() * 0.14, 0.46, 0.34, colors.accent, Math.min(1, accent / Math.max(alpha, 1e-3))]];
  add('glow', 180 * u, (bw, bh) => {
    const S = Math.min(bw, bh);
    return svgDoc(bw, bh, '', pools.map(([x, y, rx, ry, color, o]) => `<ellipse cx="${round(x * bw, 1)}" cy="${round(y * bh, 1)}" rx="${round(rx * S, 1)}" ry="${round(ry * S, 1)}" fill="${color}" opacity="${round(o, 3)}"/>`).join(''), 120 * u, alpha);
  }, { x: wave(travel(60 * u), period(44), 0), y: wave(travel(34 * u), period(35), 1) });
  // The grain is a mark (finer than a letter's stroke): clamped, but no tone.
  const speck = lay(light, 0.2 * bright, { mark: true });
  const [r, g, b] = [1, 3, 5].map((i) => round(parseInt(light.slice(i, i + 2), 16) / 255, 3));
  const size = round(256 * u);
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="g" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${round(0.85 / u, 3)}" numOctaves="2" seed="${Math.floor(random() * 1000)}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 2.4 0 0 0 -0.8"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
  layers.push({ id: 'grain', box: over(0), svg: null, style: { backgroundImage: svgUrl(tile), backgroundSize: `${size}px ${size}px`, opacity: round(speck, 4) }, axes: {} });
}

// Where each kind's atmosphere glows (fractions of the frame; the centre otherwise).
const GLOW_AT = { silk: [0.5, 0.45], bokeh: [0.5, 0.55] };
const DRAW = { silk, smoke, bokeh, veil, facets, halftone, grain, blooms, 'light-leak': lightLeak, spotlight, studio, beams, prism, bands, panes, arcs, ripples, 'flow-lines': flowLines, pinstripe, 'dot-field': dotField, linen, brush };

// ---------------------------------------------------------------------------
// More neutral kinds. Shared pieces first.

const pt = (x, y) => `${round(x, 1)} ${round(y, 1)}`;
const oval = (cx, cy, rx, ry, fill, opacity = 1, extra = '') => `<ellipse cx="${round(cx, 1)}" cy="${round(cy, 1)}" rx="${round(rx, 1)}" ry="${round(ry, 1)}" fill="${fill}"${opacity < 1 ? ` opacity="${round(opacity, 3)}"` : ''}${extra}/>`;
// A second colour's clamped alpha as an opacity inside a group drawn at the first's.
const ratio = (alpha, group) => Math.min(1, alpha / Math.max(group, 1e-3));
// The usual slow drift: d px of travel across, half that down, out of step.
const drift = ({ u, travel, period }, d, p, flip = 0) => ({ x: wave(travel(d * u), period(p), flip), y: wave(travel(d * 0.5 * u), period(p * 0.8), 1 - flip) });
// A slow swell in size (still when the plate is).
const breathe = ({ period }, p, amp = 0.03) => (period(p) < Infinity ? { kind: 'wave', center: 1 + amp, amp, period: round(period(p), 4), phase: 0 } : undefined);

// Blooms: large blurred pools of the tint and the accent at three depths,
// each wandering on its own path.
function blooms(ctx) {
  const { u, add, lay, light, colors, random, bright } = ctx;
  const pool = (id, color, want, count, d, p) => {
    const alpha = lay(color, want * bright);
    const spots = Array.from({ length: count }, () => [0.1 + random() * 0.8, 0.1 + random() * 0.8, 0.3 + random() * 0.2, 0.2 + random() * 0.16]);
    add(id, 200 * u, (bw, bh) => {
      const S = Math.min(bw, bh);
      return svgDoc(bw, bh, '', spots.map(([x, y, rx, ry]) => oval(x * bw, y * bh, rx * S, ry * S, color)).join(''), 110 * u, alpha);
    }, drift(ctx, d, p, count % 2));
  };
  pool('far', light, 0.22, 2, 40, 58);
  pool('mid', colors.accent, 0.18, 2, 70, 47);
  pool('near', light, 0.14, 1, 100, 39);
}

// Light leak: light spilling in from one side (seeded), the tint with the
// accent inside it and one long diagonal streak; it slides along its edge.
function lightLeak(ctx) {
  const { u, add, lay, light, colors, random, bright, travel, period } = ctx;
  const right = random() < 0.5;
  const alpha = lay(light, 0.34 * bright);
  const accent = lay(colors.accent, 0.24 * bright);
  add('leak', 220 * u, (bw, bh) => {
    const S = Math.min(bw, bh);
    const x = right ? bw : 0, dir = right ? -1 : 1;
    const sx = x + dir * S * 0.4, sy = bh * 0.3;
    const body = oval(x, bh * 0.34, S * 0.36, S * 0.72, light) + oval(x + dir * S * 0.16, bh * 0.62, S * 0.26, S * 0.5, colors.accent, ratio(accent, alpha))
      + oval(sx, sy, S * 0.75, S * 0.045, light, 0.7, ` transform="rotate(${dir * -26} ${round(sx, 1)} ${round(sy, 1)})"`);
    return svgDoc(bw, bh, '', body, 90 * u, alpha);
  }, { x: wave(travel(40 * u), period(44), 0), y: wave(travel(70 * u), period(52), 1) });
  // Far: the same light, faint, reaching the opposite side low down.
  const far = lay(light, 0.1 * bright);
  add('far', 220 * u, (bw, bh) => svgDoc(bw, bh, '', oval(right ? 0 : bw, bh * 0.8, Math.min(bw, bh) * 0.5, Math.min(bw, bh) * 0.3, light), 120 * u, far), drift(ctx, 20, 60, 1));
}

// Spotlight: one soft pool of light with a long falloff, breathing slowly,
// inside a wide, faint halo.
function spotlight(ctx) {
  const { u, add, lay, light, random, bright } = ctx;
  const x = 0.36 + random() * 0.28, y = 0.36 + random() * 0.14;
  const halo = lay(light, 0.1 * bright);
  add('far', 200 * u, (bw, bh) => svgDoc(bw, bh, '', oval(x * bw, y * bh, bw * 0.6, bh * 0.5, light), 130 * u, halo), drift(ctx, 24, 62, 1));
  const alpha = lay(light, 0.34 * bright);
  add('pool', 200 * u, (bw, bh) => {
    const S = Math.min(bw, bh);
    const defs = `<radialGradient id="p"><stop offset="0" stop-color="${light}" stop-opacity="1"/><stop offset="0.35" stop-color="${light}" stop-opacity="0.5"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>`;
    return svgDoc(bw, bh, defs, oval(x * bw, y * bh, S * 0.8, S * 0.62, 'url(#p)'), 0, alpha);
  }, { ...drift(ctx, 60, 50), scale: breathe(ctx, 38) });
}

// Studio: a seamless studio sweep. A low band of light where the wall turns
// into the floor, the floor falling off toward the lens.
function studio(ctx) {
  const { u, add, lay, light, bright, travel, period } = ctx;
  const alpha = lay(light, 0.3 * bright);
  add('sweep', 170 * u, (bw, bh) => {
    const h = bh * 0.64;
    const defs = `<linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}" stop-opacity="0.55"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></linearGradient>`;
    return svgDoc(bw, bh, defs, `${oval(bw / 2, h, bw * 0.6, bh * 0.2, light)}<rect x="0" y="${round(h, 1)}" width="${round(bw)}" height="${round(bh - h, 1)}" fill="url(#f)"/>`, 70 * u, alpha);
  }, { x: wave(travel(56 * u), period(56), 0) });
  const seam = lay(light, 0.16 * bright);
  add('seam', 170 * u, (bw, bh) => svgDoc(bw, bh, '', oval(bw / 2, bh * 0.64, bw * 0.46, 3 * u, light), 6 * u, seam), { x: wave(travel(24 * u), period(56), 0) });
}

// Beams: broad shafts of light falling from above, widening and fading as
// they fall; two banks sway against each other.
function beams(ctx) {
  const { u, add, lay, light, random, bright, blurAt, travel, period } = ctx;
  const bank = (id, count, want, blur, d, p, flip) => {
    const alpha = lay(light, want * bright);
    const shafts = Array.from({ length: count }, (_, i) => [(i + 0.15 + random() * 0.7) / count, 0.015 + random() * 0.03, 0.07 + random() * 0.1, -0.25 + random() * 0.5, 0.5 + random() * 0.5]);
    add(id, 170 * u, (bw, bh) => {
      const defs = `<linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light}" stop-opacity="1"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></linearGradient>`;
      const body = shafts.map(([x, top, bottom, lean, o]) => {
        const x0 = x * bw, x1 = x0 + lean * bh;
        return `<path d="M${pt(x0 - top * bw, 0)}L${pt(x0 + top * bw, 0)}L${pt(x1 + bottom * bw, bh)}L${pt(x1 - bottom * bw, bh)}Z" fill="url(#s${id})" opacity="${round(o, 3)}"/>`;
      }).join('');
      return svgDoc(bw, bh, defs, body, blur, alpha);
    }, { x: wave(travel(d * u), period(p), flip), rotation: wave(1.4, period(p * 1.4), 1 - flip) });
  };
  bank('far', 4, 0.14, blurAt(50), 20, 60, 0);
  bank('subject', 5, 0.24, blurAt(22), 44, 48, 1);
}

// Prism: long diagonal streaks of light that grade from the tint to the accent.
function prism(ctx) {
  const { u, add, lay, light, colors, random, bright, blurAt } = ctx;
  const bank = (id, count, want, blur, d, p, flip) => {
    const alpha = lay(light, want * bright);
    const accent = ratio(lay(colors.accent, want * bright), alpha);
    const streaks = Array.from({ length: count }, (_, i) => [random(), random(), 0.5 + random() * 0.7, 0.012 + random() * 0.03, i / Math.max(1, count - 1)]);
    add(id, 180 * u, (bw, bh) => {
      const S = Math.min(bw, bh);
      const body = streaks.map(([x, y, len, thick, k]) => oval(x * bw, y * bh, len * S, thick * S, mix(light, colors.accent, k), 1 - k * (1 - accent), ` transform="rotate(-32 ${round(x * bw, 1)} ${round(y * bh, 1)})"`)).join('');
      return svgDoc(bw, bh, '', body, blur, alpha);
    }, drift(ctx, d, p, flip));
  };
  bank('far', 5, 0.16, blurAt(44), 24, 60, 0);
  bank('subject', 8, 0.3, blurAt(16), 56, 46, 1);
}

// Bands: broad, soft diagonal bands of the tint at uneven widths and strengths.
function bands(ctx) {
  const { u, add, lay, light, random, bright, blurAt } = ctx;
  const bank = (id, count, want, blur, d, p, flip) => {
    const alpha = lay(light, want * bright);
    const strips = Array.from({ length: count }, (_, i) => [(i + random() * 0.6) / count, (0.3 + random() * 0.5) / count, 0.3 + random() * 0.7]);
    add(id, 170 * u, (bw, bh) => {
      const span = bw * 1.5;
      const body = strips.map(([x, w, o]) => `<rect x="${round(-bw * 0.25 + x * span, 1)}" y="${round(-bh, 1)}" width="${round(w * span, 1)}" height="${round(bh * 3, 1)}" fill="${light}" opacity="${round(o, 3)}"/>`).join('');
      return svgDoc(bw, bh, '', `<g transform="rotate(-28 ${round(bw / 2, 1)} ${round(bh / 2, 1)})">${body}</g>`, blur, alpha);
    }, drift(ctx, d, p, flip));
  };
  bank('far', 4, 0.14, blurAt(48), 22, 62, 0);
  bank('subject', 7, 0.22, blurAt(18), 50, 47, 1);
}

// Panes: large frosted rounded rectangles overlapping at two depths, each a
// faint fill with a brighter lip.
function panes(ctx) {
  const { u, add, lay, light, random, bright, blurAt } = ctx;
  const bank = (id, count, want, blur, d, p, flip) => {
    const alpha = lay(light, want * bright);
    const rects = Array.from({ length: count }, () => [random() * 0.8, random() * 0.75, 0.22 + random() * 0.3, 0.25 + random() * 0.35, 0.4 + random() * 0.6]);
    add(id, 160 * u, (bw, bh) => {
      const body = rects.map(([x, y, w, h, o]) => `<rect x="${round(x * bw, 1)}" y="${round(y * bh, 1)}" width="${round(w * bw, 1)}" height="${round(h * bh, 1)}" rx="${round(30 * u, 1)}" fill="${light}" fill-opacity="${round(0.3 * o, 3)}" stroke="${light}" stroke-opacity="${round(o, 3)}" stroke-width="${round(3 * u, 2)}"/>`).join('');
      return svgDoc(bw, bh, '', body, blur, alpha);
    }, drift(ctx, d, p, flip));
  };
  bank('far', 3, 0.18, blurAt(34), 22, 60, 0);
  bank('subject', 4, 0.3, blurAt(7), 48, 46, 1);
}

// Arcs: thin segments of very large circles, out of focus, turning slowly.
function arcs(ctx) {
  const { u, add, lay, light, random, bright, blurAt, period } = ctx;
  const bank = (id, count, want, blur, d, p, flip) => {
    const alpha = lay(light, want * bright);
    const list = Array.from({ length: count }, () => [random(), random(), 0.25 + random() * 0.6, 2 + random() * 10, random() * 6.28, 1 + random() * 2.4, 0.4 + random() * 0.6]);
    add(id, 170 * u, (bw, bh) => {
      const S = Math.min(bw, bh);
      const body = list.map(([x, y, r, width, from, sweep, o]) => {
        const cx = x * bw, cy = y * bh, R = r * S;
        return `<path d="M${pt(cx + Math.cos(from) * R, cy + Math.sin(from) * R)}A${round(R, 1)} ${round(R, 1)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${pt(cx + Math.cos(from + sweep) * R, cy + Math.sin(from + sweep) * R)}" fill="none" stroke="${light}" stroke-width="${round(width * u, 2)}" stroke-linecap="round" opacity="${round(o, 3)}"/>`;
      }).join('');
      return svgDoc(bw, bh, '', body, blur, alpha);
    }, { ...drift(ctx, d, p, flip), rotation: wave(2.2, period(p * 1.5), flip) });
  };
  bank('far', 4, 0.18, blurAt(30), 20, 60, 0);
  bank('subject', 6, 0.34, blurAt(6), 44, 47, 1);
}

// Ripples: concentric rings spreading from a point off-centre, each wider
// and fainter than the last; the set breathes.
function ripples(ctx) {
  const { u, add, lay, light, random, bright, blurAt } = ctx;
  const x = 0.64 + random() * 0.12, y = 0.3 + random() * 0.12;
  // Far: a second, larger set from the opposite corner, well out of focus.
  const far = lay(light, 0.14 * bright);
  add('far', 180 * u, (bw, bh) => {
    const S = Math.min(bw, bh);
    let body = '';
    for (let i = 0; i < 6; i += 1) body += `<circle cx="${round((1 - x) * bw, 1)}" cy="${round((1 - y) * bh, 1)}" r="${round(S * 0.16 * 1.4 ** i, 1)}" fill="none" stroke="${light}" stroke-width="${round((8 + i * 4) * u, 2)}" opacity="${round(1 - i / 7, 3)}"/>`;
    return svgDoc(bw, bh, '', body, blurAt(30), far);
  }, drift(ctx, 16, 62, 1));
  const alpha = lay(light, 0.3 * bright);
  add('subject', 180 * u, (bw, bh) => {
    const S = Math.min(bw, bh);
    let body = '';
    for (let i = 0; i < 11; i += 1) body += `<circle cx="${round(x * bw, 1)}" cy="${round(y * bh, 1)}" r="${round(S * 0.07 * 1.34 ** i, 1)}" fill="none" stroke="${light}" stroke-width="${round((1.5 + i * 1.2) * u, 2)}" opacity="${round(1 - i / 12, 3)}"/>`;
    return svgDoc(bw, bh, '', body, blurAt(3), alpha);
  }, { ...drift(ctx, 30, 50), scale: breathe(ctx, 36, 0.04) });
}

// Flow lines: stacked fine lines that wander together; a thicker, softer
// bank far behind.
function flowLines(ctx) {
  const { u, add, lay, light, random, bright, blurAt } = ctx;
  const bank = (id, count, want, blur, width, d, p, flip) => {
    const alpha = lay(light, want * bright);
    const p1 = random() * 6.28, p2 = random() * 6.28;
    const lines = Array.from({ length: count }, () => [random() * 0.5, 0.35 + random() * 0.65]);
    add(id, 150 * u, (bw, bh) => {
      const step = bw / 60;
      const body = lines.map(([jitter, o], i) => {
        const base = bh * (0.04 + (i / Math.max(1, count - 1)) * 0.92);
        const points = [];
        for (let x = -step; x <= bw + step; x += step) {
          const s = x / bw;
          points.push(pt(x, base + bh * 0.09 * Math.sin(s * 4.4 + p1 + i * 0.16) + bh * 0.035 * Math.sin(s * 9.5 + p2 + jitter) - (s - 0.5) * bh * 0.18));
        }
        return `<path d="M${points.join('L')}" opacity="${round(o, 3)}"/>`;
      }).join('');
      return svgDoc(bw, bh, '', `<g fill="none" stroke="${light}" stroke-width="${round(width * u, 2)}" stroke-linejoin="round">${body}</g>`, blur, alpha);
    }, drift(ctx, d, p, flip));
  };
  bank('far', 8, 0.16, blurAt(18), 6, 22, 60, 0);
  bank('subject', 20, 0.34, blurAt(1.5), 2.2, 46, 47, 1);
}

// Pinstripe: fine diagonal lines under a slow diagonal sheen.
function pinstripe(ctx) {
  const { u, add, lay, light, bright, travel, period } = ctx;
  const line = lay(light, 0.3 * bright, { mark: true });
  const gap = round(22 * u, 2);
  add('lines', 140 * u, (bw, bh) => svgDoc(bw, bh, `<pattern id="p" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="${round(1.6 * u, 2)}" height="${gap}" fill="${light}"/></pattern>`, `<rect width="${round(bw)}" height="${round(bh)}" fill="url(#p)"/>`, 0, line), drift(ctx, 18, 60));
  const sheen = lay(light, 0.16 * bright);
  add('sheen', 240 * u, (bw, bh) => {
    const defs = `<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0.34" stop-color="${light}" stop-opacity="0"/><stop offset="0.5" stop-color="${light}" stop-opacity="1"/><stop offset="0.66" stop-color="${light}" stop-opacity="0"/></linearGradient>`;
    return svgDoc(bw, bh, defs, `<rect width="${round(bw)}" height="${round(bh)}" fill="url(#s)"/>`, 40 * u, sheen);
  }, { x: wave(travel(150 * u), period(34), 0) });
}

// Dot field: a regular grid of fine dots at two depths, fading across the
// frame; the nearer grid travels further.
function dotField(ctx) {
  const { u, add, lay, light, bright, blurAt } = ctx;
  const field = (id, pitch, r, want, blur, d, p, flip) => {
    const alpha = lay(light, want * bright, { mark: true });
    const cell = round(pitch * u, 2);
    add(id, 130 * u, (bw, bh) => {
      const defs = `<pattern id="d" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse"><circle cx="${round(cell / 2, 2)}" cy="${round(cell / 2, 2)}" r="${round(r * u, 2)}" fill="${light}"/></pattern>`
        + `<linearGradient id="g" x1="${flip}" y1="0" x2="${1 - flip}" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0.12"/></linearGradient><mask id="m"><rect width="${round(bw)}" height="${round(bh)}" fill="url(#g)"/></mask>`;
      return svgDoc(bw, bh, defs, `<rect width="${round(bw)}" height="${round(bh)}" fill="url(#d)" mask="url(#m)"/>`, blur, alpha);
    }, drift(ctx, d, p, flip));
  };
  field('far', 30, 1.5, 0.5, 0, 12, 62, 0);
  field('subject', 64, 3.2, 0.55, blurAt(1.5), 44, 46, 1);
}

// Linen: a still weave of fine threads, uneven in strength, over two soft
// pools of light that drift.
function linen(ctx) {
  const { u, add, lay, light, random, bright, layers, over } = ctx;
  const alpha = lay(light, 0.2 * bright);
  const pools = [[0.24 + random() * 0.16, 0.3 + random() * 0.14, 0.6, 0.42], [0.7 + random() * 0.12, 0.66 + random() * 0.12, 0.46, 0.34]];
  add('glow', 180 * u, (bw, bh) => {
    const S = Math.min(bw, bh);
    return svgDoc(bw, bh, '', pools.map(([x, y, rx, ry], i) => oval(x * bw, y * bh, rx * S, ry * S, light, i ? 0.6 : 1)).join(''), 120 * u, alpha);
  }, drift(ctx, 56, 46));
  // The threads are marks (finer than a letter's stroke): clamped, but no tone.
  const weave = lay(light, 0.24 * bright, { mark: true });
  const n = 16, gap = round(5 * u, 2), size = round(n * gap, 2), thread = round(1.3 * u, 2);
  let body = '';
  for (let i = 0; i < n; i += 1) {
    body += `<rect x="0" y="${round(i * gap, 2)}" width="${size}" height="${thread}" opacity="${round(0.25 + random() * 0.75, 3)}"/><rect x="${round(i * gap, 2)}" y="0" width="${thread}" height="${size}" opacity="${round(0.25 + random() * 0.75, 3)}"/>`;
  }
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><g fill="${light}">${body}</g></svg>`;
  layers.push({ id: 'weave', box: over(0), svg: null, style: { backgroundImage: svgUrl(tile), backgroundSize: `${size}px ${size}px`, opacity: round(weave, 4) }, axes: {} });
}

// Brush: broad dry-brush strokes, each a bundle of uneven bristle lines
// along one sweep; a softer pair far behind.
function brush(ctx) {
  const { u, add, lay, light, random, bright, blurAt } = ctx;
  const bank = (id, count, want, blur, d, p, flip) => {
    const alpha = lay(light, want * bright);
    const strokes = Array.from({ length: count }, (_, i) => ({
      x: -0.05 + random() * 0.3, y: (i + 0.2 + random() * 0.6) / count, length: 0.6 + random() * 0.45, angle: -14 + random() * 10, phase: random() * 6.28,
      bristles: Array.from({ length: 18 }, () => [random() * 0.18, 1 - random() * 0.25, 0.25 + random() * 0.75])
    }));
    add(id, 160 * u, (bw, bh) => {
      const gap = bh * 0.011;
      const body = strokes.map(({ x, y, length, angle, phase, bristles }) => {
        const x0 = x * bw, y0 = y * bh, L = length * bw;
        const lines = bristles.map(([from, to, o], j) => {
          const points = [];
          for (let k = 0; k <= 16; k += 1) { const s = from + ((to - from) * k) / 16; points.push(pt(x0 + s * L, y0 + (j - bristles.length / 2) * gap + bh * 0.03 * Math.sin(s * 3 + phase))); }
          return `<path d="M${points.join('L')}" opacity="${round(o, 3)}"/>`;
        }).join('');
        return `<g transform="rotate(${round(angle, 1)} ${round(x0, 1)} ${round(y0, 1)})">${lines}</g>`;
      }).join('');
      return svgDoc(bw, bh, '', `<g fill="none" stroke="${light}" stroke-width="${round(gap * 0.9, 2)}" stroke-linecap="round">${body}</g>`, blur, alpha);
    }, drift(ctx, d, p, flip));
  };
  bank('far', 2, 0.14, blurAt(34), 22, 60, 0);
  bank('subject', 3, 0.26, blurAt(3), 46, 47, 1);
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

/**
 * The overlay a video plate needs → {dim, ratio, ok}: the least alpha, from
 * `want` up, at which paper text keeps VIDEO_PLATE_CONTRAST under each
 * overlay colour on a pixel at `peak` (0–1 grey, the footage's brightest once
 * blurred) and on black (the worst pixel for dark paper on a light palette),
 * capped at VIDEO_DIM_MAX; ratio is paper's worst contrast there and ok
 * whether it meets the floor.
 */
export function videoPlateFloor({ paper, overlays, peak = 1, want = 0 }) {
  const v = Math.round(Math.max(0, Math.min(1, peak)) * 255).toString(16).padStart(2, '0');
  const pixels = [`#${v}${v}${v}`, '#000000'];
  const worst = (alpha) => Math.min(...overlays.flatMap((color) => pixels.map((pixel) => contrast(paper, mix(pixel, color, alpha)))));
  let dim = Math.max(0, Math.min(VIDEO_DIM_MAX, want));
  if (worst(dim) < VIDEO_PLATE_CONTRAST) {
    let lo = dim, hi = VIDEO_DIM_MAX;
    if (worst(hi) >= VIDEO_PLATE_CONTRAST) {
      for (let i = 0; i < 24; i += 1) { const m = (lo + hi) / 2; if (worst(m) >= VIDEO_PLATE_CONTRAST) hi = m; else lo = m; }
    }
    dim = hi;
  }
  const ratio = round(worst(dim), 2);
  return { dim: round(Math.ceil(dim * 1000) / 1000, 3), ratio, ok: ratio >= VIDEO_PLATE_CONTRAST };
}

// Video: a clip from the project, full-bleed (cover) past every edge by twice
// its blur, with the image plate's slow push and drift, playing from
// params.start where the plate first shows (each renderer times it). Over it
// the treatment's overlay: bg (dim, blur) or a gradient from the primary into
// bg (tint), at the dim videoPlateFloor sets. Its tones are the black and the
// peak pixel under each overlay colour.
function video(ctx) {
  const { u, colors, params, travel, period, layers, tones, over } = ctx;
  const blur = params.blur * u;
  const b = over(70 * u + 2 * blur);
  const scale = period(40) < Infinity ? { kind: 'wave', center: 1.03, amp: 0.025, period: round(period(40), 4), phase: 0 } : undefined;
  const axes = { x: wave(travel(20 * u), period(46), 1), y: wave(travel(10 * u), period(37), 0), scale };
  layers.push({ id: 'video', box: b, src: params.src, video: { src: params.src, start: params.start }, svg: null, style: blur > 0.25 ? { filter: `blur(${round(blur)}px)` } : {}, axes: Object.fromEntries(Object.entries(axes).filter(([, axis]) => axis)) });
  const tint = params.treatment === 'tint' ? tintOver(colors, params.tint === 'neutral' ? colors.paper : colors[params.tint], params.peak) : null;
  const overlays = tint ? [tint, colors.bg] : [colors.bg];
  const floor = videoPlateFloor({ paper: colors.paper, overlays, peak: params.peak, want: params.dim });
  ctx.params = { ...params, dim: floor.dim };
  ctx.contrast = { floor: VIDEO_PLATE_CONTRAST, ratio: floor.ratio, ok: floor.ok, raised: floor.dim > params.dim };
  const background = tint ? `linear-gradient(160deg, ${tint} 0%, ${mix(tint, colors.bg, 0.5)} 45%, ${colors.bg} 100%)` : colors.bg;
  layers.push({ id: 'dim', box: over(0), svg: null, style: { background, opacity: floor.dim }, axes: {} });
  const v = Math.round(params.peak * 255).toString(16).padStart(2, '0');
  for (const color of overlays) for (const ink of [`#${v}${v}${v}`, '#000000']) tones.add(mix(ink, color, floor.dim));
}

// The tint treatment's lead colour: bg mixed toward the light by up to 0.55,
// held back until some overlay strength meets the floor on any footage (a
// mid-tone primary under dark paper never would, however strong).
function tintOver(colors, light, peak) {
  let k = 0.55;
  while (k > 0.05 && !videoPlateFloor({ paper: colors.paper, overlays: [mix(colors.bg, light, k), colors.bg], peak, want: VIDEO_DIM_MAX }).ok) k -= 0.05;
  return mix(colors.bg, light, k);
}

// A grey of the same lightness (Rec. 709 luma).
function greyOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const v = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
}
