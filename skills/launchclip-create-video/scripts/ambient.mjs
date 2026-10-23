// Frame-pure ambient motion, shared by the HyperFrames compiler (as GSAP
// fromTo calls on the master timeline) and the Remotion StoryComposition
// (evaluated per frame), so both renderers move the same layers by the same
// amounts with the same eases. Plain ESM; imports only ./motion.mjs and
// ./grammar.mjs.
// Canonical copy: kit/core/ambient.mjs. Contract: docs/KIT_CONTRACTS.md,
// "Ambient motion".
//
// Two layers keep a settled frame alive between beats:
//
// - Hold drift: every eligible scene's content sits in a wrapper that pushes
//   in very slowly (scale 1 → 1 + a about the module's rect centre, plus a few
//   px of vertical travel) from the scene start to the end of its render
//   window, linearly, so the motion never stops dead at settle and hands off
//   to the exit with the same velocity. The amplitude is clamped so the drifted
//   rect stays inside the safe zone (and out of the caption band); a module
//   with no room pulls back instead (scale 1 → 1 − a, which only shrinks it).
//   layout-check inflates each rect by driftExtent() so it proves the clamp.
// - Background field: a few large, soft, low-contrast brand-colour blobs drawn
//   inside every track-0 plate, under the content. Each blob axis is a cosine
//   of absolute time whose extrema fall on multiples of half its period, so a
//   chain of sine.inOut tweens between extrema reproduces it exactly in GSAP.
//
// Nothing here reads a clock or keeps state: every value is a function of
// absolute time and the story, so seeking in any order gives the same pixels.

import { getEase } from './motion.mjs';
import { resolveGrammar } from './grammar.mjs';

export const AMBIENT_LEVELS = Object.freeze(['off', 'subtle', 'standard', 'lively']);

// Per-level tuning. Drift lengths are px at a 1080 px short side and scale
// with the canvas. field.contrast is the luma step (0–255) a blob centre adds
// over brand.colors.bg, so every brand gets the same low-contrast field
// whatever its colours; field.speed is canvas widths per second. scaleRate/shiftRate are per second of the drift window, capped at
// scaleMax/shiftMax, so short and long scenes drift at a similar speed.
export const AMBIENT_PRESETS = Object.freeze({
  off: null,
  subtle: Object.freeze({ scaleRate: 0.004, scaleMax: 0.02, shiftRate: 1.5, shiftMax: 8, field: Object.freeze({ contrast: 22, speed: 0.06, count: 4 }) }),
  standard: Object.freeze({ scaleRate: 0.007, scaleMax: 0.03, shiftRate: 2.5, shiftMax: 14, field: Object.freeze({ contrast: 40, speed: 0.11, count: 4 }) }),
  lively: Object.freeze({ scaleRate: 0.010, scaleMax: 0.04, shiftRate: 3.5, shiftMax: 20, field: Object.freeze({ contrast: 54, speed: 0.14, count: 4 }) })
});

// Scene energy (0 calm … 3 full, "build") → default ambient level.
const ENERGY_LEVEL = Object.freeze({ 0: 'subtle', 1: 'standard', 2: 'standard', 3: 'lively', build: 'standard' });
const DRIFT_EASE = 'none';
const FIELD_EASE = 'sine.inOut';
const EPS = 1e-6;

/** Default level for a scene energy (0–3 or "build"; anything else → "standard"). */
export function levelForEnergy(energy) {
  return ENERGY_LEVEL[energy] ?? 'standard';
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// `ambient` may be a level string or {level?, background?, drift?}.
function ambientObject(value) {
  if (typeof value === 'string') return { level: value };
  return isObject(value) ? value : {};
}

/**
 * Validation messages for story.ambient or scenes[i].ambient (empty = valid).
 * Accepts a level string or {level?, background?, drift?}.
 */
export function ambientErrors(value, path = 'ambient') {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return AMBIENT_LEVELS.includes(value) ? [] : [`${path} must be one of ${AMBIENT_LEVELS.join(', ')} or an object {level?, background?, drift?}`];
  if (!isObject(value)) return [`${path} must be a level string or an object {level?, background?, drift?}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!['level', 'background', 'drift'].includes(key)) errors.push(`${path}.${key} is not supported (allowed: level, background, drift)`);
  if (value.level !== undefined && !AMBIENT_LEVELS.includes(value.level)) errors.push(`${path}.level must be one of ${AMBIENT_LEVELS.join(', ')}`);
  for (const key of ['background', 'drift']) if (value[key] !== undefined && typeof value[key] !== 'boolean') errors.push(`${path}.${key} must be true or false`);
  return errors;
}

/**
 * Effective ambient settings for one scene → {level, background, drift}.
 * Precedence: scene.ambient ← story.ambient ← defaults. The default level
 * is the motion grammar's hold level when it has one (cinematic: lively),
 * else it follows the scene's energy; the footage-led lane (whose base already moves)
 * defaults to no background field and drifts overlays only (track ≥ 1, not
 * full-frame inserts). Level "off" turns both layers off.
 */
export function sceneAmbient(story, scene) {
  const base = ambientObject(story?.ambient);
  const own = ambientObject(scene?.ambient);
  const footage = story?.lane === 'footage-led';
  const level = own.level ?? base.level ?? grammarHoldLevel(story) ?? levelForEnergy(scene?.energy);
  if (level === 'off' || !AMBIENT_PRESETS[level]) return { level: 'off', background: false, drift: false };
  const track = Number.isInteger(scene?.track) ? scene.track : 0;
  const background = own.background ?? base.background ?? !footage;
  let drift = own.drift ?? base.drift ?? true;
  if (footage && (track === 0 || scene?.insert === true) && own.drift !== true) drift = false;
  return { level, background: Boolean(background), drift: Boolean(drift) };
}

// The motion grammar's hold level (null for grammars without one, or an
// invalid grammar, which validateStory reports).
function grammarHoldLevel(story) {
  if (!story?.motion?.grammar) return null;
  try { return resolveGrammar(story).hold?.level ?? null; } catch { return null; }
}

/**
 * The story-wide field level: story.ambient.level when set, otherwise the
 * most common default scene level (ties → the calmer level). The field is one
 * continuous backdrop, so it does not change intensity from plate to plate.
 */
export function fieldLevel(story) {
  const base = ambientObject(story?.ambient);
  if (base.level) return base.level;
  const counts = new Map();
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    const level = levelForEnergy(scene?.energy);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }
  let best = 'standard', bestCount = -1;
  for (const level of AMBIENT_LEVELS) {
    const count = counts.get(level) ?? 0;
    if (count > bestCount) { best = level; bestCount = count; }
  }
  return bestCount > 0 ? best : 'standard';
}

// ---------------------------------------------------------------------------
// Deterministic seed

/** 32-bit FNV-1a hash of a string. */
export function hashString(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32 PRNG → () => [0, 1). */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The story's ambient seed: its title, brand colours and format. */
export function ambientSeed(story) {
  const colors = isObject(story?.brand?.colors) ? story.brand.colors : {};
  const format = story?.format ?? {};
  return hashString([story?.title ?? '', ...Object.keys(colors).sort().map((key) => `${key}=${colors[key]}`), format.width, format.height].join('|'));
}

// ---------------------------------------------------------------------------
// Background field

const HEX = /^#[0-9a-fA-F]{6}$/;

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * The background field for a story → {level, blobs} or null (level off, or
 * no plate wants it). Blob = {id, color: "#rrggbb", rgb: [r, g, b], alpha,
 * size, x: Axis, y: Axis, scale: Axis}; x/y are the blob centre in canvas px
 * and size its diameter. Axis is one of
 *   {kind: "wave", center, amp, period, phase: 0 | 1}
 *       value(t) = center + amp · cos(2πt / period + phase·π)
 *   {kind: "glide", from, to, period, offset}
 *       value(t) = from + (to − from) · frac((t + offset) / period)
 * Blobs glide across the canvas at a steady, slightly different speed each
 * (a parallax drift), wrapping while fully off canvas, bob gently on the
 * cross axis and breathe in scale.
 */
export function ambientField(story) {
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  if (!scenes.some((scene) => (scene?.track ?? 0) === 0 && sceneAmbient(story, scene).background)) return null;
  const level = fieldLevel(story);
  const preset = AMBIENT_PRESETS[level];
  if (!preset) return null;
  const width = Number(story?.format?.width), height = Number(story?.format?.height);
  if (!(width > 0 && height > 0)) return null;
  const colors = isObject(story?.brand?.colors) ? story.brand.colors : {};
  const palette = [colors.primary, colors.accent, colors.secondary].filter((value) => HEX.test(value ?? ''));
  if (!palette.length) palette.push(HEX.test(colors.paper ?? '') ? colors.paper : '#ffffff');
  const random = seededRandom(ambientSeed(story));
  const { contrast, speed, count } = preset.field;
  const bg = HEX.test(colors.bg ?? '') ? colors.bg : '#000000';
  const direction = random() < 0.5 ? -1 : 1;
  const base = Math.max(width, height) * 0.55;
  const blobs = [];
  for (let index = 0; index < count; index += 1) {
    const color = palette[index % Math.min(palette.length, 2)];
    const size = round(base * (0.9 + random() * 0.3));
    const scaleAmp = round(0.05 + random() * 0.04, 4);
    // Glide: fully off canvas at both ends of the cycle, so the wrap is unseen.
    const reach = (size * (1 + scaleAmp)) / 2 + 2;
    const travel = width + 2 * reach;
    const velocity = width * speed * (0.92 + 0.16 * (index / Math.max(1, count - 1)));
    const period = round(travel / velocity, 4);
    const [from, to] = direction < 0 ? [width + reach, -reach] : [-reach, width + reach];
    const row = index % 2 ? 0.7 : 0.3;
    blobs.push({
      id: `b${index}`,
      color,
      rgb: rgb(color),
      alpha: round(blobAlpha(color, bg, contrast) * (index % 2 ? 0.85 : 1), 4),
      size,
      x: { kind: 'glide', from: round(from, 3), to: round(to, 3), period, offset: round(period * ((index + random() * 0.4) / count), 4) },
      y: { kind: 'wave', center: round(height * (row + (random() - 0.5) * 0.12), 3), amp: round(height * (0.03 + random() * 0.02), 3), period: round(16 + random() * 8, 3), phase: random() < 0.5 ? 0 : 1 },
      scale: { kind: 'wave', center: 1, amp: scaleAmp, period: round(14 + random() * 6, 3), phase: random() < 0.5 ? 0 : 1 }
    });
  }
  return { level, direction, blobs };
}

const frac = (value) => value - Math.floor(value);
const MAX_ALPHA = 0.45;

/** BT.601 luma (0–255) of a #rrggbb colour, the grey the motion analyser measures. */
export function luma(hex) {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Alpha at which `color` over `bg` changes luma by `contrast` levels (capped at 0.45). */
export function blobAlpha(color, bg, contrast) {
  const step = Math.abs(luma(color) - luma(bg));
  return step > 1 ? Math.min(MAX_ALPHA, contrast / step) : MAX_ALPHA;
}

/** Value of one field axis at absolute time t. */
export function axisValue(axis, t) {
  if (axis.kind === 'glide') return axis.from + (axis.to - axis.from) * frac((t + axis.offset) / axis.period);
  return axis.center + axis.amp * Math.cos((2 * Math.PI * t) / axis.period + axis.phase * Math.PI);
}

/** Blob state at absolute time t → {x, y, scale} (x/y = top-left translate in px). */
export function blobStateAt(blob, t) {
  return { x: axisValue(blob.x, t) - blob.size / 2, y: axisValue(blob.y, t) - blob.size / 2, scale: axisValue(blob.scale, t) };
}

/** Blob state → inline CSS (camelCase keys) for the Remotion kit. */
export function blobStyle(blob, t) {
  const state = blobStateAt(blob, t);
  return { transform: `translate(${round(state.x, 3)}px, ${round(state.y, 3)}px) scale(${round(state.scale, 5)})` };
}

// Gaussian-like falloff (stop, alpha fraction): many stops, so no stop edge
// reads as a ring.
const FALLOFF = Object.freeze([[0, 1], [15, 0.94], [30, 0.78], [45, 0.56], [60, 0.34], [75, 0.16], [88, 0.05], [100, 0]]);

/** CSS background for a blob: a soft radial falloff of its colour. */
export function blobBackground(blob) {
  const [r, g, b] = blob.rgb;
  return `radial-gradient(closest-side, ${FALLOFF.map(([stop, k]) => `rgba(${r}, ${g}, ${b}, ${round(blob.alpha * k, 4)}) ${stop}%`).join(', ')})`;
}

/**
 * Tweens that reproduce one axis exactly over [from, to]: → [{at, duration,
 * from, to, ease}] in absolute seconds. A wave axis becomes half-period
 * sine.inOut tweens between its extrema (the first may start before `from`,
 * never before 0); a glide axis becomes one linear tween per wrap cycle (the
 * first starts at max(0, its cycle start) from the value there). `offset` is
 * subtracted from every value (blob x/y are written as a top-left translate).
 */
export function axisSegments(axis, from, to, offset = 0) {
  const segments = [];
  if (!(to > from)) return segments;
  if (axis.kind === 'glide') {
    const period = axis.period;
    if (!(period > 0)) return segments;
    for (let k = Math.floor((from + axis.offset) / period + EPS); k * period - axis.offset < to - EPS; k += 1) {
      const cycleStart = k * period - axis.offset;
      const at = Math.max(0, cycleStart);
      const end = cycleStart + period;
      if (end <= from + EPS) continue;
      const value = at > cycleStart + EPS ? axisValue(axis, at) : axis.from;
      segments.push({ at: round(at, 6), duration: round(end - at, 6), from: round(value - offset, 4), to: round(axis.to - offset, 4), ease: "none" });
    }
    return segments;
  }
  const half = axis.period / 2;
  if (!(half > 0)) return segments;
  for (let k = Math.max(0, Math.floor(from / half + EPS)); k * half < to - EPS; k += 1) {
    const sign = (k + axis.phase) % 2 === 0 ? 1 : -1;
    segments.push({ at: round(k * half, 6), duration: round(half, 6), from: round(axis.center + axis.amp * sign - offset, 4), to: round(axis.center - axis.amp * sign - offset, 4), ease: FIELD_EASE });
  }
  return segments;
}

/** All field tweens for one blob over [from, to]: → [{prop: "x"|"y"|"scale", at, duration, from, to, ease}]. */
export function blobTweens(blob, from, to) {
  return [
    ...axisSegments(blob.x, from, to, blob.size / 2).map((segment) => ({ prop: 'x', ...segment })),
    ...axisSegments(blob.y, from, to, blob.size / 2).map((segment) => ({ prop: 'y', ...segment })),
    ...axisSegments(blob.scale, from, to).map((segment) => ({ prop: 'scale', ...segment }))
  ].sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Hold drift

function validRect(rect) {
  return isObject(rect) && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(rect[key]))) && rect.width > 0 && rect.height > 0;
}

function intersects(a, b) {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPS && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPS;
}

/**
 * Whether a scene's content may drift: its ambient drift is on, it resolved to
 * a real module (not a placeholder), and its content is not full-frame decor
 * (a punch-in camera), a module that moves on its own (layout.drift false:
 * photo-scene's Ken Burns) or a root <video> (media-window video: HyperFrames lifts
 * the video out of the scene layer, so it would not follow the wrapper).
 */
export function driftEligible(story, scene, model) {
  if (!model || model.placeholder || !sceneAmbient(story, scene).drift) return false;
  if (model.camera || model.layout?.role === 'decor' || model.layout?.drift === false) return false;
  if (scene?.module === 'media-window' && scene?.params?.media?.kind === 'video') return false;
  return validRect(model.layout?.rect ?? model.rect);
}

/**
 * The region a drifted rect must stay inside: the safe zone, shortened so a
 * rect that starts clear of the caption band stays clear of it.
 * geometry: {safeZone, captionBand} (layout-check profileGeometry()).
 */
export function driftBounds(rect, { safeZone, captionBand, captions = false } = {}) {
  const width = Number(safeZone?.width), height = Number(safeZone?.height);
  if (!(width > 0 && height > 0)) return null;
  const bounds = { x: safeZone.x, y: safeZone.y, width, height };
  if (captions && captionBand && !intersects(rect, captionBand)) {
    if (rect.y + rect.height <= captionBand.y + EPS) bounds.height = Math.max(0, Math.min(bounds.y + bounds.height, captionBand.y) - bounds.y);
    else if (rect.y >= captionBand.y + captionBand.height - EPS) {
      const bottom = bounds.y + bounds.height;
      bounds.y = Math.max(bounds.y, captionBand.y + captionBand.height);
      bounds.height = Math.max(0, bottom - bounds.y);
    }
  }
  return bounds;
}

/**
 * Drift for one rect over the window [start, end] → Drift | null.
 * Drift = {start, duration, ease, origin: {x, y}, scale, x, y, mode: "push"|"pull"}
 * (scale/x/y are the end values; the wrapper is identity at `start`).
 *   level       ambient level (subtle | standard | lively)
 *   canvas      {width, height}
 *   bounds      driftBounds() result (null = no clamp beyond the canvas)
 *   minTextPx / minTextLimit   a pull-back never shrinks key text below the limit
 * The rect is pushed in about its centre as far as the bounds allow; when the
 * push would be less than half the level's amplitude it pulls back instead.
 * Vertical travel goes toward the side with more room, within that room.
 */
export function driftPlan({ rect, level, start, end, canvas, bounds = null, minTextPx = null, minTextLimit = null } = {}) {
  const preset = AMBIENT_PRESETS[level];
  if (!preset || !validRect(rect) || !(end - start > EPS)) return null;
  const unit = Math.min(Number(canvas?.width) || 1080, Number(canvas?.height) || 1920) / 1080;
  const duration = end - start;
  const wanted = Math.min(preset.scaleMax, preset.scaleRate * duration);
  const travel = Math.min(preset.shiftMax, preset.shiftRate * duration) * unit;
  const area = bounds ?? { x: 0, y: 0, width: Number(canvas?.width) || rect.x + rect.width, height: Number(canvas?.height) || rect.y + rect.height };
  const left = rect.x - area.x, right = area.x + area.width - (rect.x + rect.width);
  const up = rect.y - area.y, down = area.y + area.height - (rect.y + rect.height);
  if (Math.min(left, right, up, down) < -EPS) return null; // already outside: leave it alone
  const roomX = Math.max(0, Math.min(left, right)), roomUp = Math.max(0, up), roomDown = Math.max(0, down);
  // Push in as far as the room allows.
  const fit = Math.min(wanted, (2 * roomX) / rect.width, (2 * Math.min(roomUp, roomDown)) / rect.height);
  let mode = 'push', scale, y;
  const direction = roomUp >= roomDown ? -1 : 1;
  if (fit >= wanted * 0.5) {
    scale = 1 + fit;
    const grow = (fit * rect.height) / 2;
    y = direction * Math.min(travel, Math.max(0, (direction < 0 ? roomUp : roomDown) - grow));
  } else {
    mode = 'pull';
    let shrink = wanted;
    if (Number.isFinite(minTextPx) && Number.isFinite(minTextLimit) && minTextPx > 0) shrink = Math.min(shrink, Math.max(0, 1 - minTextLimit / minTextPx));
    scale = 1 - shrink;
    // Shrinking about the centre frees shrink·h/2 on each side.
    const freed = (shrink * rect.height) / 2;
    y = direction * Math.min(travel, (direction < 0 ? roomUp : roomDown) + freed);
  }
  // Round toward identity so the rounded drift never exceeds the clamp.
  scale = 1 + Math.trunc((scale - 1) * 1e5) / 1e5;
  y = Math.trunc(y * 1e3) / 1e3;
  if (Math.abs(scale - 1) < 1e-4 && Math.abs(y) < 0.05) return null;
  return {
    start: round(start, 6),
    duration: round(duration, 6),
    ease: DRIFT_EASE,
    origin: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    scale,
    x: 0,
    y,
    mode
  };
}

/**
 * Drift for a scene and its resolved model, or null. window = {start, end}
 * (the scene's render window, kit/core/transitions.mjs sceneWindows);
 * geometry = layout-check profileGeometry(canvas) ({safeZone, captionBand,
 * minTextPx}). Both compilers and layout-check call this, so the drift drawn
 * and the extent checked are the same.
 */
export function sceneDrift(story, scene, model, { window, geometry } = {}) {
  if (!driftEligible(story, scene, model)) return null;
  const rect = model.layout?.rect ?? model.rect;
  const captions = (Array.isArray(story?.overlays) ? story.overlays : []).some((overlay) => overlay?.type === 'captions' && overlay.style !== 'none');
  const canvas = { width: Number(story?.format?.width), height: Number(story?.format?.height) };
  const role = model.layout?.role ?? 'text';
  const keyed = role === 'text' || role === 'hero';
  const bounds = geometry ? (keyed ? driftBounds(rect, { safeZone: geometry.safeZone, captionBand: geometry.captionBand, captions }) : null) : null;
  const start = Number(window?.start ?? scene.start), end = Number(window?.end ?? scene.end);
  return driftPlan({ rect, level: sceneAmbient(story, scene).level, start, end, canvas, bounds, minTextPx: Number.isFinite(model.minTextPx) ? model.minTextPx : null, minTextLimit: (model.textRole === 'body' ? geometry?.minBodyTextPx ?? geometry?.minTextPx : geometry?.minTextPx) ?? null });
}

// ---------------------------------------------------------------------------
// Composition with a camera (world camera / parallax layers)

/** Default depth of the background field under a world camera: it moves at 0.3× the camera. */
export const FIELD_PARALLAX = 0.3;

/**
 * A camera state seen from a layer at `depth` (0 = fixed to the screen,
 * 1 = moves with the camera): → {x, y, scale}. camera = {x, y, scale} is the
 * camera's offset at one instant (a pure function of time on the camera
 * side). A camera move drives the field container with
 * parallaxState(camera(t), FIELD_PARALLAX); the blobs inside keep their own
 * glide, so the two compose by nesting transforms, never by editing blobs.
 */
export function parallaxState(camera, depth = FIELD_PARALLAX) {
  const x = Number(camera?.x) || 0, y = Number(camera?.y) || 0;
  const scale = Number.isFinite(Number(camera?.scale)) ? Number(camera.scale) : 1;
  return { x: x * depth, y: y * depth, scale: 1 + (scale - 1) * depth };
}

/**
 * The field as one continuous backdrop across a whole world, for a world
 * camera's depth layer. Inside a plate (cuts mode) the field is a canvas-sized
 * box with overflow hidden; a camera that travels past that box would show
 * its edge as a hard vertical seam. Here each blob is instead repeated on its
 * own lattice: copies `tileX = |glide to − from|` apart horizontally (the
 * glide's wrap distance, so a copy takes over exactly where the blob wraps,
 * the glide reads as one endless drift, and no other copy of the blob is ever
 * on the home canvas) and one canvas height apart vertically (continuing the
 * plate field's 0.3 / 0.7 row rhythm, so a camera that travels down sees the
 * same density as at home rather than empty bands; only a blob's soft rim
 * reaches into the home canvas from the row above or below). The copies are
 * never clipped, so the field has no edges anywhere.
 * Copies are static translates; the blob motion inside is the plate field's
 * own (blobStateAt / blobTweens), so the result stays frame-pure.
 *   region  {x0, y0, x1, y1}: the field-frame rect a camera can show
 *           (camera-world.mjs backgroundExtent)
 * → [{blob: id, dx, dy}] in blob order, then by row and column.
 */
export function fieldTiles(field, region, { width, height } = {}) {
  const tiles = [];
  if (!field?.blobs?.length || !region) return tiles;
  for (const blob of field.blobs) {
    const lo = Math.min(blob.x.from, blob.x.to), hi = Math.max(blob.x.from, blob.x.to);
    const tileX = hi - lo;
    const reach = (tileX - width) / 2;
    const tileY = height;
    if (!(tileX > 0 && tileY > 0)) continue;
    const yLo = blob.y.center - Math.abs(blob.y.amp), yHi = blob.y.center + Math.abs(blob.y.amp);
    // Copy (i, j) can cover [lo + i·tileX − reach, hi + i·tileX + reach] × [yLo + j·tileY − reach, …].
    const i0 = Math.floor((region.x0 - hi - reach) / tileX), i1 = Math.ceil((region.x1 - lo + reach) / tileX);
    const j0 = Math.floor((region.y0 - yHi - reach) / tileY), j1 = Math.ceil((region.y1 - yLo + reach) / tileY);
    for (let j = j0; j <= j1; j += 1) {
      if (yHi + j * tileY + reach < region.y0 || yLo + j * tileY - reach > region.y1) continue;
      for (let i = i0; i <= i1; i += 1) {
        if (hi + i * tileX + reach < region.x0 || lo + i * tileX - reach > region.x1) continue;
        tiles.push({ blob: blob.id, dx: round(i * tileX, 3) + 0, dy: round(j * tileY, 3) + 0 });
      }
    }
  }
  return tiles;
}

/** A field tile → its wrapper's CSS transform (both renderers). */
export function fieldTileTransform(tile) {
  return `translate(${round(tile.dx, 3)}px, ${round(tile.dy, 3)}px)`;
}

/** Parallax state → inline CSS (camelCase keys), pivoting on the canvas centre. */
export function parallaxStyle(camera, depth = FIELD_PARALLAX) {
  const state = parallaxState(camera, depth);
  return { transformOrigin: '50% 50%', transform: `translate(${round(state.x, 3)}px, ${round(state.y, 3)}px) scale(${round(state.scale, 5)})` };
}

/** Drift wrapper state at absolute time t → {x, y, scale}. Identity before start. */
export function driftStateAt(drift, t) {
  if (!drift) return { x: 0, y: 0, scale: 1 };
  const p = drift.duration > 0 ? Math.min(1, Math.max(0, (t - drift.start) / drift.duration)) : 1;
  const k = p >= 1 ? 1 : getEase(drift.ease)(p);
  return { x: drift.x * k, y: drift.y * k, scale: 1 + (drift.scale - 1) * k };
}

/** Drift wrapper inline CSS (camelCase keys) at absolute time t, for the Remotion kit. */
export function driftStyle(drift, t) {
  if (!drift) return {};
  const state = driftStateAt(drift, t);
  return { transformOrigin: `${drift.origin.x}px ${drift.origin.y}px`, transform: `translate(${round(state.x, 3)}px, ${round(state.y, 3)}px) scale(${round(state.scale, 5)})` };
}

/** GSAP fromTo arguments for a drift wrapper: → {from, to, position} (seek-safe, 2D transforms). */
export function driftGsap(drift) {
  return {
    from: { x: 0, y: 0, scale: 1, force3D: false },
    to: { x: drift.x, y: drift.y, scale: drift.scale, duration: drift.duration, ease: drift.ease, immediateRender: false, force3D: false },
    position: drift.start
  };
}

/**
 * The largest rect a drifted rect covers over its window (the union of the
 * rest rect and the end state; the drift is monotonic). layout-check checks
 * this instead of the rest rect.
 */
export function driftExtent(rect, drift) {
  if (!drift || !validRect(rect)) return rect;
  const s = drift.scale, ox = drift.origin.x, oy = drift.origin.y;
  const x0 = ox + (rect.x - ox) * s + drift.x, y0 = oy + (rect.y - oy) * s + drift.y;
  const x1 = ox + (rect.x + rect.width - ox) * s + drift.x, y1 = oy + (rect.y + rect.height - oy) * s + drift.y;
  const minX = Math.min(rect.x, x0), minY = Math.min(rect.y, y0);
  const maxX = Math.max(rect.x + rect.width, x1), maxY = Math.max(rect.y + rect.height, y1);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
