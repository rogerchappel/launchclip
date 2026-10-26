// Background pool (docs/SEEDED_STYLES_RFC.md §3.2, §3.5): the plate behind
// every track-0 scene, chosen once per video by story.background {kind,
// params} (a style pack's `background`, merged by kit/core/style.mjs
// applyStyle). Shared by the HyperFrames compiler and the Remotion
// StoryComposition the way the ambient field is: a renderer-neutral list of
// layers, each a box, inline CSS, optional SVG markup and wave axes. GSAP
// plays the axes as half-period sine.inOut tweens (ambient.mjs axisSegments)
// and Remotion evaluates the same cosines per frame, so both renderers draw
// the same pixels at any seek. Plain ESM; imports only ./ambient.mjs,
// ./panels.mjs and ./icons.mjs. Contract: docs/KIT_CONTRACTS.md, "Backgrounds and panels".
//
// Kinds:
//   flat            the brand background alone
//   gradient        a linear gradient from bg toward primary or accent
//   grain-gradient  the gradient under a fine film grain
//   paper           a sheet a shade off bg, with fibre grain
//   geometric       outlined rings, triangles, squares and crosses, drifting
//   blobs           today's ambient field (kit/core/ambient.mjs ambientField);
//                   the default when story.background is absent, unchanged
//   dot-grid        an even grid of small dots
//   mesh            large overlapping colour washes that move slowly
//   stripes         diagonal bands
//   topographic     contour lines around two summits
//   halftone        a dot screen that grows toward one corner
//   light-rays      soft rays fanning from above the frame
//   icon-pattern    icons from kit/core/icons.mjs tiled in offset rows
//   icon-scatter    icons scattered without overlap, jittered in size and turn
//   logo-pattern    the brand frame's logo (story.frame.logo) tiled
//   motif           a repeating line motif: plus, circle, chevron, wave, hatch, crosshatch
//   texture         a still surface: noise, paper fibre, canvas or linen
//
// Every kind but blobs takes params.fade, a mask that keeps one area calm
// (the centre or a side), and story.panel.fill draws any of them inside a
// panel (panelFillPlan).
//
// Colour comes from the palette only, and every colour a layer lays over bg
// is clamped so text in paper (the modules' foreground) keeps at least 4.5:1
// on it (or bg's own ratio, when that is already lower). backgroundTones()
// lists the colours text can sit on; backgroundContrastFindings() checks
// captions and panel text against them (the layout gate).
//
// Motion obeys the ambient level: off draws the background still; subtle,
// standard and lively scale the speed (0.6×, 1×, 1.4×). Every value is a
// function of absolute time, so seeking in any order gives the same pixels.

import { AMBIENT_PRESETS, ambientSeed, axisSegments, axisValue, fieldLevel, sceneAmbient, seededRandom } from './ambient.mjs';
import { contrast, mix, panelFill, storyPanel, withAlpha } from './panels.mjs';
import { ICONS, ICON_BOX, isIcon } from './icons.mjs';

export const BACKGROUND_KINDS = Object.freeze(['flat', 'gradient', 'grain-gradient', 'paper', 'geometric', 'blobs', 'dot-grid', 'mesh', 'stripes', 'topographic', 'halftone', 'light-rays', 'icon-pattern', 'icon-scatter', 'logo-pattern', 'motif', 'texture']);
export const DEFAULT_BACKGROUND_KIND = 'blobs';

// Tested parameter ranges, per kind: {min, max, default}. angle in degrees;
// scale multiplies the pattern size; density, intensity and grain are 0–1;
// speed multiplies the level's motion speed (0 = still). color picks the
// palette role the pattern takes.
const range = (min, max, value) => Object.freeze({ min, max, default: value });
const ANGLE = range(0, 360, 160), SCALE = range(0.5, 2, 1), DENSITY = range(0, 1, 0.5), INTENSITY = range(0, 1, 0.5), GRAIN = range(0, 1, 0.4), SPEED = range(0, 2, 1);
const OPACITY = range(0.04, 0.2, 0.1), STROKE = range(1, 3, 1.75);
export const BACKGROUND_COLORS = Object.freeze(['primary', 'accent', 'paper']);
export const BACKGROUND_PARAMS = Object.freeze({
  flat: Object.freeze({}),
  gradient: Object.freeze({ angle: ANGLE, intensity: INTENSITY, speed: SPEED }),
  'grain-gradient': Object.freeze({ angle: ANGLE, intensity: INTENSITY, grain: GRAIN, speed: SPEED }),
  paper: Object.freeze({ grain: range(0, 1, 0.5), intensity: range(0, 1, 0.4) }),
  geometric: Object.freeze({ density: DENSITY, scale: SCALE, intensity: INTENSITY, speed: SPEED }),
  blobs: Object.freeze({}),
  'dot-grid': Object.freeze({ scale: SCALE, density: DENSITY, intensity: INTENSITY, speed: SPEED }),
  mesh: Object.freeze({ intensity: INTENSITY, scale: SCALE, speed: SPEED }),
  stripes: Object.freeze({ angle: range(0, 180, 45), scale: SCALE, density: range(0.15, 0.6, 0.35), intensity: range(0, 1, 0.35), speed: SPEED }),
  topographic: Object.freeze({ density: DENSITY, scale: SCALE, intensity: INTENSITY, speed: SPEED }),
  halftone: Object.freeze({ angle: range(0, 360, 135), scale: SCALE, intensity: INTENSITY, speed: SPEED }),
  'light-rays': Object.freeze({ angle: range(-60, 60, 0), density: DENSITY, intensity: INTENSITY, speed: SPEED }),
  'icon-pattern': Object.freeze({ scale: SCALE, spacing: SCALE, rotation: range(-45, 45, 0), offset: range(0, 1, 0.5), opacity: OPACITY, stroke: STROKE, speed: SPEED }),
  'icon-scatter': Object.freeze({ scale: SCALE, density: DENSITY, jitter: DENSITY, opacity: OPACITY, stroke: STROKE, speed: SPEED }),
  'logo-pattern': Object.freeze({ scale: SCALE, spacing: SCALE, offset: range(0, 1, 0.5), opacity: OPACITY, speed: SPEED }),
  motif: Object.freeze({ scale: SCALE, weight: range(0.5, 3, 1.5), opacity: range(0.04, 0.3, 0.14), angle: range(0, 180, 45), speed: SPEED }),
  texture: Object.freeze({ amount: DENSITY, scale: SCALE })
});
// Kinds whose pattern takes a palette role (params.color).
const COLORED = new Set(['gradient', 'grain-gradient', 'geometric', 'dot-grid', 'stripes', 'topographic', 'halftone', 'light-rays', 'icon-pattern', 'icon-scatter', 'motif']);
const DEFAULT_COLOR = Object.freeze({ gradient: 'primary', 'grain-gradient': 'primary', geometric: 'primary', 'dot-grid': 'paper', stripes: 'paper', topographic: 'primary', halftone: 'primary', 'light-rays': 'paper', 'icon-pattern': 'paper', 'icon-scatter': 'paper', motif: 'paper' });
// Fades keep an area calm: the pattern fades out toward it (center: a radial
// mask; a side: a linear one). Every kind but blobs takes one.
export const BACKGROUND_FADES = Object.freeze(['none', 'center', 'top', 'bottom', 'left', 'right']);
export const BACKGROUND_MOTIFS = Object.freeze(['plus', 'circle', 'chevron', 'wave', 'hatch', 'crosshatch']);
export const BACKGROUND_TEXTURES = Object.freeze(['noise', 'fibre', 'canvas', 'linen']);
// Option params (one of a list) per kind: {key: {values, default}}.
const option = (values, value) => Object.freeze({ values, default: value });
export const BACKGROUND_OPTIONS = Object.freeze(Object.fromEntries(BACKGROUND_KINDS.map((kind) => [kind, Object.freeze({
  ...(COLORED.has(kind) ? { color: option(BACKGROUND_COLORS, DEFAULT_COLOR[kind]) } : {}),
  ...(kind === 'blobs' ? {} : { fade: option(BACKGROUND_FADES, 'none') }),
  ...(kind === 'motif' ? { shape: option(BACKGROUND_MOTIFS, 'plus') } : {}),
  ...(kind === 'texture' ? { type: option(BACKGROUND_TEXTURES, 'noise') } : {})
})])));
// Kinds that draw icons take params.icons: 1–8 icon names (kit/core/icons.mjs) or "auto".
const ICON_KINDS = new Set(['icon-pattern', 'icon-scatter']);
export const DEFAULT_PATTERN_ICONS = Object.freeze(['sparkle', 'star', 'bolt', 'lightbulb', 'heart', 'rocket']);
const LEVEL_SPEED = Object.freeze({ off: 0, subtle: 0.6, standard: 1, lively: 1.4 });
const TEXT_MIN = 4.5;

const HEX = /^#[0-9a-fA-F]{6}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value, digits = 3) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };

/** Validation messages for story.background (empty = valid). */
export function backgroundErrors(value, path = 'background') {
  if (value === undefined || value === null) return [];
  if (!isObject(value)) return [`${path} must be an object {kind, params?}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!['kind', 'params'].includes(key)) errors.push(`${path}.${key} is not supported (allowed: kind, params)`);
  if (!BACKGROUND_KINDS.includes(value.kind)) { errors.push(`${path}.kind must be one of ${BACKGROUND_KINDS.join(', ')}`); return errors; }
  if (value.params === undefined) return errors;
  if (!isObject(value.params)) return [...errors, `${path}.params must be an object`];
  const spec = BACKGROUND_PARAMS[value.kind], options = BACKGROUND_OPTIONS[value.kind];
  const allowed = [...Object.keys(spec), ...Object.keys(options), ...(ICON_KINDS.has(value.kind) ? ['icons'] : [])];
  for (const [key, given] of Object.entries(value.params)) {
    if (!allowed.includes(key)) { errors.push(`${path}.params.${key} is not supported for ${value.kind}${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ' (it takes no params)'}`); continue; }
    if (options[key]) { if (!options[key].values.includes(given)) errors.push(`${path}.params.${key} must be one of ${options[key].values.join(', ')}`); continue; }
    if (key === 'icons') {
      if (given === 'auto') continue;
      if (!Array.isArray(given) || given.length < 1 || given.length > 8) errors.push(`${path}.params.icons must be "auto" or a list of 1–8 icon names`);
      else for (const name of given) if (!isIcon(name)) errors.push(`${path}.params.icons: unknown icon ${JSON.stringify(name)} (see ICON_NAMES in kit/core/icons.mjs)`);
      continue;
    }
    const { min, max } = spec[key];
    if (!(typeof given === 'number' && given >= min && given <= max)) errors.push(`${path}.params.${key} must be a number from ${min} to ${max}`);
  }
  return errors;
}

/** The story's background with every param filled → {kind, params}. Absent or invalid → blobs. */
export function storyBackground(story) {
  const value = story?.background;
  if (!isObject(value) || !BACKGROUND_KINDS.includes(value.kind) || backgroundErrors(value).length) return { kind: DEFAULT_BACKGROUND_KIND, params: {} };
  const params = {};
  for (const [key, spec] of Object.entries({ ...BACKGROUND_PARAMS[value.kind], ...BACKGROUND_OPTIONS[value.kind] })) params[key] = value.params?.[key] ?? spec.default;
  if (ICON_KINDS.has(value.kind)) params.icons = value.params?.icons ?? 'auto';
  return { kind: value.kind, params };
}

/**
 * The icons an icon pattern draws: params.icons, or for "auto" the icons the
 * story's scenes name (any `icon` param, in order, at most 6), else
 * DEFAULT_PATTERN_ICONS.
 */
export function patternIcons(story, icons = 'auto') {
  if (Array.isArray(icons) && icons.some(isIcon)) return icons.filter(isIcon);
  const found = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (isObject(value)) for (const [key, inner] of Object.entries(value)) { if (key === 'icon' && isIcon(inner) && !found.includes(inner)) found.push(inner); else walk(inner); }
  };
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) walk(scene?.params);
  return found.length ? found.slice(0, 6) : [...DEFAULT_PATTERN_ICONS];
}

/**
 * Whether a scene's plate draws the background. For blobs this is the
 * ambient field's rule (sceneAmbient().background, off at level "off"). Any
 * other kind is part of the look, so it draws at every level (level "off"
 * only stills it) unless ambient.background is false for the story or scene,
 * or the story is footage-led (the recording is the background).
 */
export function sceneBackground(story, scene) {
  if (storyBackground(story).kind === DEFAULT_BACKGROUND_KIND) return sceneAmbient(story, scene).background;
  const own = isObject(scene?.ambient) ? scene.ambient : {};
  const base = isObject(story?.ambient) ? story.ambient : {};
  return Boolean(own.background ?? base.background ?? story?.lane !== 'footage-led');
}

// ---------------------------------------------------------------------------
// Colour

function palette(story) {
  const colors = isObject(story?.brand?.colors) ? story.brand.colors : {};
  const pick = (key, fallback) => (HEX.test(colors[key] ?? '') ? colors[key].toLowerCase() : fallback);
  const bg = pick('bg', '#000000');
  const paper = pick('paper', '#ffffff');
  return { bg, paper, primary: pick('primary', paper), accent: pick('accent', pick('primary', paper)), ink: pick('ink', bg) };
}

// The text floor on a tone: 4.5:1, or bg's own ratio when that is lower.
function textFloor(colors) {
  return Math.min(TEXT_MIN, contrast(colors.paper, colors.bg) - 0.01);
}

/**
 * The largest alpha (≤ want) at which `color` laid over `under` keeps paper
 * text at its floor. Bisection over the composite, so it holds for any
 * palette.
 */
export function safeAlpha(colors, color, want, under = colors.bg) {
  const floor = textFloor(colors);
  const ok = (alpha) => contrast(colors.paper, mix(under, color, alpha)) >= floor;
  if (ok(want)) return round(want, 4);
  let lo = 0, hi = want;
  for (let i = 0; i < 24; i += 1) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return Math.floor(lo * 1e4) / 1e4;
}

const rgba = (hex, alpha) => withAlpha(hex, alpha);

// ---------------------------------------------------------------------------
// Layers

// A wave axis (ambient.mjs Axis) centred on `center`; amp 0 or no speed → none.
function wave(amp, period, phase, center = 0) {
  if (!(Math.abs(amp) > 1e-6) || !(period > 0) || !Number.isFinite(period)) return undefined;
  return { kind: 'wave', center, amp: round(amp, 4), period: round(period, 4), phase };
}

// A grain texture: fractal noise as an SVG data URI, tiled. The seed keeps it fixed.
function grainImage(seed, frequency, size, type = 'fractalNoise') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="${type}" baseFrequency="${frequency}" numOctaves="2" seed="${seed % 1000}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
  return svgUrl(svg);
}

/** SVG markup → a CSS url() of a data URI (single-quoted, so it sits in a style attribute). */
export function svgUrl(svg) {
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
}

// One icon as SVG markup centred at (x, y), `size` px, turned `turn` degrees.
function iconMarkup(name, x, y, size, turn, color, alpha, stroke) {
  const k = size / ICON_BOX;
  return `<path d="${ICONS[name]}" transform="translate(${round(x - size / 2, 2)} ${round(y - size / 2, 2)}) rotate(${round(turn, 2)} ${round(size / 2, 2)} ${round(size / 2, 2)}) scale(${round(k, 4)})" fill="none" stroke="${color}" stroke-opacity="${alpha}" stroke-width="${round(stroke, 3)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// The fade mask: transparent toward the calm area, opaque away from it.
const FADE_MASKS = Object.freeze({
  center: 'radial-gradient(ellipse 70% 60% at 50% 50%, #00000000 0%, #00000000 35%, #000000 100%)',
  top: 'linear-gradient(to bottom, #00000000 0%, #00000000 20%, #000000 75%)',
  bottom: 'linear-gradient(to top, #00000000 0%, #00000000 20%, #000000 75%)',
  left: 'linear-gradient(to right, #00000000 0%, #00000000 20%, #000000 75%)',
  right: 'linear-gradient(to left, #00000000 0%, #00000000 20%, #000000 75%)'
});

/** The field container's CSS (camelCase) for a plan: its fade mask, or {}. */
export function fieldStyle(plan) {
  const mask = plan?.mask;
  return mask ? { maskImage: mask, WebkitMaskImage: mask } : {};
}

const box = (x, y, width, height) => ({ x: round(x, 2), y: round(y, 2), width: round(width, 2), height: round(height, 2) });

/**
 * The background for a story → {kind, level, params, colors, layers, tones}
 * or null when the story draws today's ambient field (kind blobs) or has no
 * canvas. Layer = {id, box: {x, y, width, height}, style: {camelCase CSS},
 * svg: string | null, axes: {x?, y?, rotation?, scale?}}; axes are
 * ambient.mjs wave axes, x/y in px, rotation in degrees. A layer's transform
 * pivots on its box centre.
 */
export function backgroundPlan(story) {
  const { kind, params } = storyBackground(story);
  if (kind === DEFAULT_BACKGROUND_KIND) return null;
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!(W > 0 && H > 0)) return null;
  return planBackground({ kind, params }, { story, width: W, height: H, colors: palette(story), level: fieldLevel(story) });
}

/**
 * The plan for a resolved {kind, params} over a box of width × height
 * (the canvas, or a panel): the core of backgroundPlan, shared with panel
 * fills. colors.bg is what the layers sit on; level is the ambient level;
 * unit is the px scale (default: the box's short side over 1080).
 */
export function planBackground({ kind, params }, { story, width: W, height: H, colors, level, unit = null, seed = 0 }) {
  const speed = (LEVEL_SPEED[level] ?? 1) * (params.speed ?? 0) * (AMBIENT_PRESETS[level] ? 1 : 0);
  const u = unit ?? Math.min(W, H) / 1080;
  const random = seededRandom((ambientSeed(story) ^ 0x5bd1e995 ^ seed) >>> 0);
  const tint = params.color ? colors[params.color] : colors.primary;
  const layers = [];
  const tones = new Set([colors.bg]);
  // Lays `color` at `want` alpha over bg, clamped to keep text contrast; records the tone.
  const lay = (color, want, under = colors.bg) => {
    const alpha = safeAlpha(colors, color, want, under);
    tones.add(mix(under, color, alpha));
    return alpha;
  };
  // A box larger than the canvas by `margin` px on every side, so a layer can move or turn without showing an edge.
  const over = (margin) => box(-margin, -margin, W + 2 * margin, H + 2 * margin);
  const diag = Math.hypot(W, H);
  const period = (base) => (speed > 0 ? base / speed : Infinity);

  const gradient = () => {
    const alpha = lay(tint, 0.18 + 0.5 * params.intensity);
    const size = diag * 1.08;
    layers.push({ id: 'gradient', box: box((W - size) / 2, (H - size) / 2, size, size), svg: null,
      style: { background: `linear-gradient(${round(params.angle, 2)}deg, ${colors.bg} 8%, ${rgba(tint, alpha)} 92%), ${colors.bg}` },
      axes: { rotation: wave(5, period(26), 0) } });
    return alpha;
  };
  const grain = (amount, frequency, size, id = 'grain', type = 'fractalNoise') => {
    if (!(amount > 0)) return;
    // Grain greys a pixel toward black or white by up to half its opacity; both extremes are tones.
    const want = 0.3 * amount;
    const under = [...tones];
    let alpha = want;
    for (const tone of under) alpha = Math.min(alpha, 2 * safeAlpha(colors, '#ffffff', want / 2, tone), 2 * safeAlpha(colors, '#000000', want / 2, tone));
    alpha = Math.floor(alpha * 1e4) / 1e4;
    for (const tone of under) { tones.add(mix(tone, '#ffffff', alpha / 2)); tones.add(mix(tone, '#000000', alpha / 2)); }
    layers.push({ id, box: box(0, 0, W, H), svg: null, style: { backgroundImage: grainImage(ambientSeed(story) + layers.length, frequency, size, type), backgroundSize: `${size}px ${size}px`, opacity: round(alpha, 4) }, axes: {} });
  };

  switch (kind) {
    case 'flat':
      break;
    case 'gradient':
      gradient();
      break;
    case 'grain-gradient':
      gradient();
      grain(params.grain, 0.85, 240);
      break;
    case 'paper': {
      // The sheet: bg a shade toward paper, then fine grain and coarse fibres.
      const alpha = lay(colors.paper, 0.03 + 0.07 * params.intensity);
      layers.push({ id: 'sheet', box: box(0, 0, W, H), svg: null, style: { background: rgba(colors.paper, alpha) }, axes: {} });
      tones.delete(colors.bg);
      grain(params.grain, 0.9, 220, 'grain');
      grain(params.grain * 0.6, 0.06, 420, 'fibre');
      break;
    }
    case 'geometric': {
      // Two depths of outlined shapes, the far one smaller and slower.
      const count = Math.round(6 + 14 * params.density);
      const strokeAlpha = lay(tint, 0.18 + 0.4 * params.intensity);
      const margin = 60 * u;
      for (const [depth, share, motion] of [['far', 0.55, 0.6], ['near', 0.45, 1]]) {
        const n = Math.max(1, Math.round(count * share));
        const shapes = [];
        for (let i = 0; i < n; i += 1) {
          const size = (depth === 'far' ? 40 : 70) * u * params.scale * (0.8 + random() * 0.9);
          const x = margin + random() * W, y = margin + random() * H;
          const turn = round(random() * 360, 1), sw = round((depth === 'far' ? 2 : 3) * u, 2);
          const shape = Math.floor(random() * 4);
          const common = `fill="none" stroke="${tint}" stroke-width="${sw}" stroke-opacity="${round(strokeAlpha * (depth === 'far' ? 0.7 : 1), 4)}" transform="rotate(${turn} ${round(x, 1)} ${round(y, 1)})"`;
          const s = round(size, 1), h = round(size / 2, 1);
          if (shape === 0) shapes.push(`<circle cx="${round(x, 1)}" cy="${round(y, 1)}" r="${h}" ${common}/>`);
          else if (shape === 1) shapes.push(`<rect x="${round(x - h, 1)}" y="${round(y - h, 1)}" width="${s}" height="${s}" rx="${round(size * 0.12, 1)}" ${common}/>`);
          else if (shape === 2) shapes.push(`<path d="M${round(x, 1)} ${round(y - h, 1)}L${round(x + h * 0.95, 1)} ${round(y + h * 0.7, 1)}L${round(x - h * 0.95, 1)} ${round(y + h * 0.7, 1)}Z" stroke-linejoin="round" ${common}/>`);
          else shapes.push(`<path d="M${round(x - h, 1)} ${round(y, 1)}H${round(x + h, 1)}M${round(x, 1)} ${round(y - h, 1)}V${round(y + h, 1)}" stroke-linecap="round" ${common}/>`);
        }
        const b = over(margin);
        layers.push({ id: depth, box: b, style: {}, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">${shapes.join('')}</svg>`,
          axes: { x: wave(margin * 0.6 * motion, period(depth === 'far' ? 30 : 22), 0), y: wave(margin * 0.4 * motion, period(depth === 'far' ? 26 : 19), 1), rotation: wave(1.2 * motion, period(34), 0) } });
      }
      break;
    }
    case 'dot-grid': {
      const cell = round(40 * u * params.scale, 2);
      const radius = round(cell * (0.07 + 0.1 * params.density), 2);
      const alpha = lay(tint, 0.3 + 0.45 * params.intensity);
      layers.push({ id: 'dots', box: over(cell), svg: null,
        style: { backgroundImage: `radial-gradient(circle at ${round(cell / 2, 2)}px ${round(cell / 2, 2)}px, ${rgba(tint, alpha)} ${radius}px, ${rgba(tint, 0)} ${round(radius + 1.2 * u, 2)}px)`, backgroundSize: `${cell}px ${cell}px` },
        axes: { x: wave(cell * 0.5, period(18), 0), y: wave(cell * 0.5, period(23), 1) } });
      break;
    }
    case 'mesh': {
      // Four soft washes, one per corner, in primary, accent and paper.
      const size = Math.max(W, H) * (0.75 + 0.35 * (params.scale - 0.5) / 1.5);
      const corners = [[0.15, 0.12, colors.primary], [0.88, 0.3, colors.accent], [0.2, 0.82, colors.accent], [0.85, 0.92, colors.primary]];
      for (const [i, [cx, cy, color]] of corners.entries()) {
        const alpha = lay(color, 0.2 + 0.4 * params.intensity);
        layers.push({ id: `wash${i}`, box: box(cx * W - size / 2, cy * H - size / 2, size, size), svg: null,
          style: { borderRadius: '50%', background: `radial-gradient(closest-side, ${rgba(color, alpha)} 0%, ${rgba(color, alpha * 0.6)} 40%, ${rgba(color, alpha * 0.2)} 72%, ${rgba(color, 0)} 100%)` },
          axes: { x: wave(size * 0.08, period(20 + i * 3), i % 2), y: wave(size * 0.06, period(24 + i * 2), (i + 1) % 2), scale: wave(0.05, period(18 + i * 2), i % 2, 1) } });
      }
      break;
    }
    case 'stripes': {
      const periodPx = round(64 * u * params.scale, 2);
      const band = round(periodPx * params.density, 2);
      const alpha = lay(tint, 0.14 + 0.36 * params.intensity);
      const size = diag + 2 * periodPx;
      layers.push({ id: 'stripes', box: box((W - size) / 2, (H - size) / 2, size, size), svg: null,
        style: { backgroundImage: `repeating-linear-gradient(${round(params.angle, 2)}deg, ${rgba(tint, alpha)} 0px, ${rgba(tint, alpha)} ${band}px, ${rgba(tint, 0)} ${band}px, ${rgba(tint, 0)} ${periodPx}px)` },
        axes: { x: wave(periodPx * 0.5, period(20), 0) } });
      break;
    }
    case 'topographic': {
      // Contour rings around two summits, each ring a wobbled closed curve.
      const rings = Math.round(6 + 10 * params.density);
      const alpha = lay(tint, 0.22 + 0.45 * params.intensity);
      const margin = 80 * u;
      const b = over(margin);
      const paths = [];
      for (const [cx, cy] of [[0.28 + random() * 0.12, 0.3 + random() * 0.1], [0.64 + random() * 0.12, 0.68 + random() * 0.1]]) {
        const x0 = margin + cx * W, y0 = margin + cy * H;
        const p = [random() * 6.28, random() * 6.28, random() * 6.28];
        const step = 46 * u * params.scale;
        for (let k = 1; k <= rings; k += 1) {
          const r = k * step;
          const points = [];
          for (let i = 0; i < 48; i += 1) {
            const a = (i / 48) * Math.PI * 2;
            const wobble = 1 + 0.12 * Math.sin(3 * a + p[0] + k * 0.15) + 0.07 * Math.sin(5 * a + p[1] - k * 0.1) + 0.04 * Math.sin(2 * a + p[2]);
            points.push(`${round(x0 + Math.cos(a) * r * wobble, 1)} ${round(y0 + Math.sin(a) * r * wobble * 0.85, 1)}`);
          }
          paths.push(`M${points.join('L')}Z`);
        }
      }
      layers.push({ id: 'contours', box: b, style: {},
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}"><path d="${paths.join('')}" fill="none" stroke="${tint}" stroke-opacity="${alpha}" stroke-width="${round(2 * u, 2)}" stroke-linejoin="round"/></svg>`,
        axes: { x: wave(margin * 0.5, period(28), 0), y: wave(margin * 0.4, period(23), 1), rotation: wave(1, period(36), 0) } });
      break;
    }
    case 'halftone': {
      // A dot screen whose dots grow toward one corner (params.angle points at it).
      const cell = 30 * u * params.scale;
      const alpha = lay(tint, 0.26 + 0.5 * params.intensity);
      const margin = cell * 2;
      const b = over(margin);
      const a = (params.angle * Math.PI) / 180;
      const dx = Math.cos(a), dy = Math.sin(a);
      const extent = Math.abs(dx) * b.width + Math.abs(dy) * b.height;
      const lo = Math.min(0, dx * b.width) + Math.min(0, dy * b.height);
      let d = '';
      for (let y = cell / 2; y < b.height; y += cell) {
        for (let x = cell / 2 + ((Math.round(y / cell) % 2) * cell) / 2; x < b.width; x += cell) {
          const along = (dx * x + dy * y - lo) / extent;
          const r = cell * 0.46 * Math.max(0, (along - 0.35) / 0.65) ** 1.4;
          if (r < 0.6 * u) continue;
          const R = round(r, 1);
          d += `M${round(x - R, 1)} ${round(y, 1)}a${R} ${R} 0 1 0 ${round(2 * R, 1)} 0a${R} ${R} 0 1 0 ${round(-2 * R, 1)} 0`;
        }
      }
      layers.push({ id: 'screen', box: b, style: {},
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}"><path d="${d}" fill="${tint}" fill-opacity="${alpha}"/></svg>`,
        axes: { x: wave(cell * 0.8, period(24), 0), y: wave(cell * 0.6, period(19), 1) } });
      break;
    }
    case 'light-rays': {
      // Rays fan from a point above the frame, fading with distance.
      const rays = Math.round(8 + 10 * params.density);
      const alpha = lay(tint, 0.1 + 0.3 * params.intensity);
      const size = diag * 2.2;
      const cx = W / 2 + Math.tan((params.angle * Math.PI) / 180) * H * 0.5, cy = -H * 0.12;
      const slice = round(360 / rays, 4), lit = round(slice * 0.42, 4);
      layers.push({ id: 'rays', box: box(cx - size / 2, cy - size / 2, size, size), svg: null,
        style: { backgroundImage: `repeating-conic-gradient(from ${round(180 + params.angle, 2)}deg at 50% 50%, ${rgba(tint, alpha)} 0deg, ${rgba(tint, 0)} ${lit}deg, ${rgba(tint, 0)} ${slice}deg)`,
          maskImage: `radial-gradient(closest-side, #000000 0%, #000000b3 30%, #00000033 62%, #00000000 92%)`, WebkitMaskImage: `radial-gradient(closest-side, #000000 0%, #000000b3 30%, #00000033 62%, #00000000 92%)` },
        axes: { rotation: wave(3, period(30), 0) } });
      break;
    }
    case 'icon-pattern': {
      // A tile of every icon in a row, then the same row shifted by params.offset of a cell.
      const icons = patternIcons(story, params.icons);
      const cell = 120 * u * params.spacing;
      const size = 44 * u * params.scale;
      const alpha = lay(tint, params.opacity);
      const tileW = round(cell * icons.length, 2), tileH = round(cell * 2, 2);
      const marks = [];
      for (let row = 0; row < 2; row += 1) {
        const shift = row * params.offset * cell;
        for (let i = 0; i < icons.length; i += 1) {
          const name = icons[(i + row * Math.ceil(icons.length / 2)) % icons.length];
          const x = (i + 0.5) * cell + shift, y = (row + 0.5) * cell;
          // A copy one tile left, so a shifted icon wraps at the tile edge.
          for (const dx of [0, -tileW]) marks.push(iconMarkup(name, x + dx, y, size, params.rotation, tint, alpha, params.stroke));
        }
      }
      const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${tileH}" viewBox="0 0 ${tileW} ${tileH}">${marks.join('')}</svg>`;
      layers.push({ id: 'icons', box: over(Math.max(tileW, tileH)), svg: null, style: { backgroundImage: svgUrl(tile), backgroundSize: `${tileW}px ${tileH}px` },
        axes: { x: wave(cell * 0.5, period(26), 0), y: wave(cell * 0.35, period(21), 1) } });
      break;
    }
    case 'icon-scatter': {
      // Seeded, non-overlapping: each icon is tried at random places until it clears the others.
      const icons = patternIcons(story, params.icons);
      const margin = 80 * u;
      const b = over(margin);
      const base = 52 * u * params.scale;
      const count = Math.round((b.width * b.height) / (base * base) * (0.04 + 0.1 * params.density));
      const alpha = lay(tint, params.opacity);
      const placed = [];
      for (let i = 0; i < count; i += 1) {
        const size = base * (1 + (random() - 0.5) * 0.8 * params.jitter);
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const x = size / 2 + random() * (b.width - size), y = size / 2 + random() * (b.height - size);
          if (placed.some((other) => Math.hypot(other.x - x, other.y - y) < (other.size + size) * 0.75)) continue;
          placed.push({ x, y, size, turn: (random() - 0.5) * 70 * params.jitter, name: icons[placed.length % icons.length] });
          break;
        }
      }
      layers.push({ id: 'scatter', box: b, style: {},
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">${placed.map((mark) => iconMarkup(mark.name, mark.x, mark.y, mark.size, mark.turn, tint, alpha, params.stroke)).join('')}</svg>`,
        axes: { x: wave(margin * 0.5, period(28), 0), y: wave(margin * 0.4, period(23), 1) } });
      break;
    }
    case 'logo-pattern': {
      // The brand frame's logo (story.frame.logo), tiled in offset rows. Its
      // colours are its own, so both extremes count as tones. The SVG names
      // the file as LOGO_SRC; each renderer swaps in its own URL (layerSvg).
      const src = typeof story?.frame?.logo === 'string' && story.frame.logo.trim() ? story.frame.logo.trim() : null;
      if (!src) break;
      const cell = 170 * u * params.spacing, size = round(64 * u * params.scale, 2);
      let alpha = params.opacity;
      for (const tone of [...tones]) alpha = Math.min(alpha, safeAlpha(colors, '#ffffff', alpha, tone), safeAlpha(colors, '#000000', alpha, tone));
      for (const tone of [...tones]) { tones.add(mix(tone, '#ffffff', alpha)); tones.add(mix(tone, '#000000', alpha)); }
      const margin = cell;
      const b = over(margin);
      const marks = [];
      for (let row = 0, y = cell / 2; y < b.height + cell; row += 1, y += cell) {
        for (let x = cell / 2 + (row % 2) * params.offset * cell - cell; x < b.width + cell; x += cell) {
          marks.push(`<image href="${LOGO_SRC}" x="${round(x - size / 2, 2)}" y="${round(y - size / 2, 2)}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`);
        }
      }
      layers.push({ id: 'logos', box: b, src, style: { opacity: round(alpha, 4) },
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}">${marks.join('')}</svg>`,
        axes: { x: wave(cell * 0.5, period(26), 0), y: wave(cell * 0.35, period(21), 1) } });
      break;
    }
    case 'motif': {
      const cell = round(56 * u * params.scale, 2);
      const sw = round(params.weight * u, 2);
      const alpha = lay(tint, params.opacity);
      const c = cell, h = round(c / 2, 2), stroke = `fill="none" stroke="${tint}" stroke-opacity="${alpha}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
      const shapes = {
        plus: `<path d="M${h} ${round(h - c * 0.16, 2)}V${round(h + c * 0.16, 2)}M${round(h - c * 0.16, 2)} ${h}H${round(h + c * 0.16, 2)}" ${stroke}/>`,
        circle: `<circle cx="${h}" cy="${h}" r="${round(c * 0.18, 2)}" ${stroke}/>`,
        chevron: `<path d="M${round(c * 0.3, 2)} ${round(c * 0.4, 2)}L${h} ${round(c * 0.6, 2)}L${round(c * 0.7, 2)} ${round(c * 0.4, 2)}" ${stroke}/>`,
        wave: `<path d="M0 ${h}C${round(c * 0.25, 2)} ${round(c * 0.3, 2)} ${round(c * 0.25, 2)} ${round(c * 0.3, 2)} ${h} ${h}S${round(c * 0.75, 2)} ${round(c * 0.7, 2)} ${c} ${h}" ${stroke}/>`
      };
      const style = {};
      if (params.shape === 'hatch' || params.shape === 'crosshatch') {
        const line = (angle) => `repeating-linear-gradient(${round(angle, 2)}deg, ${rgba(tint, alpha)} 0px, ${rgba(tint, alpha)} ${sw}px, ${rgba(tint, 0)} ${sw}px, ${rgba(tint, 0)} ${cell}px)`;
        style.backgroundImage = params.shape === 'hatch' ? line(params.angle) : `${line(params.angle)}, ${line(params.angle + 90)}`;
      } else {
        style.backgroundImage = svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${c}" height="${c}" viewBox="0 0 ${c} ${c}">${shapes[params.shape]}</svg>`);
        style.backgroundSize = `${c}px ${c}px`;
      }
      const size = diag + 4 * cell;
      layers.push({ id: 'motif', box: box((W - size) / 2, (H - size) / 2, size, size), svg: null, style, axes: { x: wave(cell * 0.5, period(22), 0), y: wave(cell * 0.4, period(27), 1) } });
      break;
    }
    case 'texture': {
      // Still surfaces: noise, paper fibre, a canvas weave or linen.
      const amount = params.amount, s = params.scale;
      if (params.type === 'noise') grain(amount, round(0.9 / s, 3), 220, 'noise');
      else if (params.type === 'fibre') { grain(amount * 0.7, round(0.9 / s, 3), 220, 'grain'); grain(amount, `${round(0.008 / s, 4)} ${round(0.12 / s, 4)}`, 400, 'fibre', 'turbulence'); }
      else if (params.type === 'linen') { grain(amount * 0.8, `${round(0.9 / s, 3)} ${round(0.04 / s, 4)}`, 240, 'weft'); grain(amount * 0.8, `${round(0.04 / s, 4)} ${round(0.9 / s, 3)}`, 240, 'warp'); }
      else {
        // canvas: a fine weave of light and dark threads over grain.
        const step = round(6 * u * s, 2);
        const light = lay('#ffffff', 0.12 * amount), dark = lay('#000000', 0.14 * amount);
        layers.push({ id: 'weave', box: box(0, 0, W, H), svg: null, axes: {},
          style: { backgroundImage: `repeating-linear-gradient(0deg, ${rgba('#ffffff', light)} 0px, ${rgba('#ffffff', light)} ${round(step / 2, 2)}px, ${rgba('#000000', dark)} ${round(step / 2, 2)}px, ${rgba('#000000', dark)} ${step}px), repeating-linear-gradient(90deg, ${rgba('#ffffff', light)} 0px, ${rgba('#ffffff', light)} ${round(step / 2, 2)}px, ${rgba('#000000', dark)} ${round(step / 2, 2)}px, ${rgba('#000000', dark)} ${step}px)` } });
        grain(amount * 0.6, 0.8, 220, 'grain');
      }
      break;
    }
    default:
      return null;
  }
  for (const layer of layers) for (const key of Object.keys(layer.axes)) if (layer.axes[key] === undefined) delete layer.axes[key];
  const mask = params.fade && params.fade !== 'none' ? FADE_MASKS[params.fade] : null;
  return { kind, level, params, colors, layers, tones: [...tones], ...(mask ? { mask } : {}) };
}

/** Every colour text can sit on over this story's background (bg alone for blobs, whose field is gated by its own contrast step). */
export function backgroundTones(story) {
  return backgroundPlan(story)?.tones ?? [palette(story).bg];
}

// ---------------------------------------------------------------------------
// Drawing (both renderers)

/** The token a layer's SVG uses for an image file (logo-pattern); layerSvg swaps it. */
export const LOGO_SRC = '__launchclip_logo_src__';

/** A layer's SVG markup with its image file resolved by `resolve(src)` (HyperFrames: the project path; Remotion: staticFile). */
export function layerSvg(layer, resolve = (src) => src) {
  if (!layer.svg) return null;
  return layer.src ? layer.svg.split(LOGO_SRC).join(String(resolve(layer.src)).replace(/&/g, '&amp;').replace(/"/g, '&quot;')) : layer.svg;
}

/** A layer's state at absolute time t → {x, y, rotation, scale}. */
export function layerStateAt(layer, t) {
  const axes = layer.axes ?? {};
  return {
    x: axes.x ? axisValue(axes.x, t) : 0,
    y: axes.y ? axisValue(axes.y, t) : 0,
    rotation: axes.rotation ? axisValue(axes.rotation, t) : 0,
    scale: axes.scale ? axisValue(axes.scale, t) : 1
  };
}

/** A layer state → its CSS transform, in GSAP's 2D order (translate, rotate, scale). */
export function layerTransform(state) {
  return `translate(${round(state.x, 3)}px, ${round(state.y, 3)}px) rotate(${round(state.rotation, 4)}deg) scale(${round(state.scale, 5)})`;
}

/** A layer's full inline CSS (camelCase) at absolute time t, for the Remotion kit. */
export function layerStyle(layer, t) {
  const b = layer.box;
  return { position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height, transformOrigin: '50% 50%', pointerEvents: 'none', ...layer.style, transform: layerTransform(layerStateAt(layer, t)) };
}

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`); // WebkitMaskImage → -webkit-mask-image
const cssValue = (value) => (typeof value === 'number' ? `${value}px` : String(value));

/** layerStyle() as an inline style string, for the HyperFrames compiler. Numbers are px except opacity. */
export function layerCss(layer, t) {
  return Object.entries(layerStyle(layer, t)).map(([key, value]) => `${kebab(key)}:${key === 'opacity' ? value : cssValue(value)}`).join(';');
}

/**
 * Tweens that reproduce a layer's axes over [from, to] → [{prop: "x" | "y" |
 * "rotation" | "scale", at, duration, from, to, ease}] in absolute seconds
 * (ambient.mjs axisSegments), for GSAP fromTo on the layer.
 */
export function layerTweens(layer, from, to) {
  return Object.entries(layer.axes ?? {}).flatMap(([prop, axis]) => axisSegments(axis, from, to).map((segment) => ({ prop, ...segment }))).sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Panel fills

/** Validation messages for story.panel.fill: a background other than blobs. */
export function panelFillErrors(value, path = 'panel.fill') {
  if (value === undefined || value === null) return [];
  const errors = backgroundErrors(value, path);
  if (!errors.length && value.kind === DEFAULT_BACKGROUND_KIND) errors.push(`${path}.kind cannot be blobs (the ambient field draws only on plates)`);
  return errors;
}

/**
 * The background plan inside a panel (story.panel.fill), or null: the same
 * renderer as the plate, over a box of width × height, on `bg` (the panel's
 * fill colour), at the canvas's px scale. Used for the footage-layout panel
 * (moving, clipped to the panel by layoutFillClip) and catalogue G cards
 * (still, cardFillNodes).
 */
export function panelFillPlan(story, { width, height, bg = null } = {}) {
  const fill = storyPanel(story)?.fill;
  if (!fill || panelFillErrors(fill).length) return null;
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!(width > 0 && height > 0 && W > 0 && H > 0)) return null;
  const resolved = storyBackground({ background: fill });
  const colors = { ...palette(story), ...(HEX.test(bg ?? '') ? { bg: bg.toLowerCase() } : {}) };
  return planBackground(resolved, { story, width, height, colors, level: fieldLevel(story), unit: Math.min(W, H) / 1080, seed: 0x9e3779b9 });
}

/**
 * The footage-layout fill's clip for a layout state (footage-layout.mjs
 * layoutStateAt): the canvas minus the presenter's rounded window, as a CSS
 * clip-path (even-odd), so the pattern sits only on the panel.
 */
export function layoutFillClip(state, canvas) {
  const W = canvas.width, H = canvas.height;
  const outer = `M0 0H${W}V${H}H0Z`;
  const w = state?.window;
  if (!w || state.hidden || !(w.width > 0 && w.height > 0)) return `path(evenodd, "${outer}")`;
  const r = Math.max(0, Math.min(Number(state.radius) || 0, w.width / 2, w.height / 2));
  const x0 = round(w.x, 2), y0 = round(w.y, 2), x1 = round(w.x + w.width, 2), y1 = round(w.y + w.height, 2), R = round(r, 2);
  const inner = R > 0
    ? `M${round(x0 + R, 2)} ${y0}H${round(x1 - R, 2)}A${R} ${R} 0 0 1 ${x1} ${round(y0 + R, 2)}V${round(y1 - R, 2)}A${R} ${R} 0 0 1 ${round(x1 - R, 2)} ${y1}H${round(x0 + R, 2)}A${R} ${R} 0 0 1 ${x0} ${round(y1 - R, 2)}V${round(y0 + R, 2)}A${R} ${R} 0 0 1 ${round(x0 + R, 2)} ${y0}Z`
    : `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
  return `path(evenodd, "${outer}${inner}")`;
}

/**
 * A still panel fill as plain style objects for a view tree (catalogue G
 * cards): [{style}] at t = 0, inline SVG turned into a data-URI background.
 * A logo pattern needs a resolved file URL, which a view tree cannot give,
 * so it draws nothing here.
 */
export function cardFillStyles(plan) {
  if (!plan) return [];
  return plan.layers.filter((layer) => !layer.src).map((layer) => {
    const style = { ...layerStyle(layer, 0) };
    if (layer.svg) { style.backgroundImage = svgUrl(layer.svg); style.backgroundSize = `${layer.box.width}px ${layer.box.height}px`; style.backgroundRepeat = 'no-repeat'; }
    return style;
  });
}

// ---------------------------------------------------------------------------
// Contrast gate

/**
 * Text contrast against the background's tones → [{rule, severity, ids, at,
 * detail}] for the layout gate. Checks, on every tone:
 *   - panel text (paper) on the story's panel fill composited over the tone,
 *     at 4.5:1 (an opaque panel is checked once, on its own fill);
 *   - caption words (idle colour) at 3:1, the large-type floor, unless they
 *     carry an outline of 4 px or more, a plate, a band or a chip behind them.
 * captions: captionOptions() of the story's captions overlay, or null.
 */
export function backgroundContrastFindings(story, { captions = null } = {}) {
  const plan = backgroundPlan(story);
  const panel = storyPanel(story);
  if (!plan && !panel?.fill) return [];
  const findings = [];
  const colors = plan?.colors ?? palette(story);
  const tones = plan?.tones ?? [colors.bg];
  const kind = plan?.kind ?? 'plain';
  const worst = (fg, list) => list.map((tone) => ({ tone, ratio: contrast(fg, tone) })).sort((a, b) => a.ratio - b.ratio)[0];
  const fill = panelFill(panel?.treatment ?? 'solid', colors);
  let panelTones = fill.alpha >= 1 ? [fill.color] : tones.map((tone) => mix(tone, fill.color, fill.alpha));
  // A panel fill pattern lays its own tones over each panel tone.
  if (panel?.fill) panelTones = panelTones.flatMap((tone) => panelFillPlan(story, { width: 1080, height: 1080, bg: tone })?.tones ?? [tone]);
  const floor = textFloor(colors);
  const onPanel = worst(colors.paper, panelTones);
  if (onPanel.ratio < floor) findings.push({ rule: 'background-contrast', severity: 'error', ids: ['panel'], at: 0,
    detail: `panel text (${colors.paper}) has ${onPanel.ratio.toFixed(2)}:1 on a ${panel?.treatment ?? 'solid'} panel${panel?.fill ? ` filled with ${panel.fill.kind}` : ''} over the ${kind} background (${onPanel.tone}); it needs ${TEXT_MIN}:1. Lower the background's or fill's intensity or opacity, or use a more opaque panel` });
  if (!plan) return findings;
  const onBg = worst(colors.paper, tones);
  if (onBg.ratio < floor) findings.push({ rule: 'background-contrast', severity: 'error', ids: ['background'], at: 0,
    detail: `text in paper (${colors.paper}) has ${onBg.ratio.toFixed(2)}:1 on the ${plan.kind} background's ${onBg.tone}; it needs ${TEXT_MIN}:1. Lower background.params.intensity or grain` });
  if (captions && captions.preset !== 'none') {
    const backed = captions.plate || captions.layout === 'band' || captions.word === 'chip' || Number(captions.stroke) >= 4;
    if (!backed && HEX.test(captions.colors?.idle ?? '')) {
      const onCaption = worst(captions.colors.idle, tones);
      if (onCaption.ratio < 3) findings.push({ rule: 'background-contrast', severity: 'error', ids: ['captions'], at: 0,
        detail: `caption words (${captions.colors.idle}, preset ${captions.preset}) have ${onCaption.ratio.toFixed(2)}:1 on the ${plan.kind} background's ${onCaption.tone}; captions need 3:1. Give them an outline or plate, or change the caption colour` });
    }
  }
  return findings;
}
