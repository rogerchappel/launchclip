// Background pool (docs/SEEDED_STYLES_RFC.md §3.2, §3.5): the plate behind
// every track-0 scene, chosen once per video by story.background {kind,
// params} (a style pack's `background`, merged by kit/core/style.mjs
// applyStyle). Shared by the HyperFrames compiler and the Remotion
// StoryComposition the way the ambient field is: a renderer-neutral list of
// layers, each a box, inline CSS, optional SVG markup and wave axes. GSAP
// plays the axes as half-period sine.inOut tweens (ambient.mjs axisSegments)
// and Remotion evaluates the same cosines per frame, so both renderers draw
// the same pixels at any seek. Plain ESM; imports only ./ambient.mjs and
// ./panels.mjs. Contract: docs/KIT_CONTRACTS.md, "Backgrounds and panels".
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

export const BACKGROUND_KINDS = Object.freeze(['flat', 'gradient', 'grain-gradient', 'paper', 'geometric', 'blobs', 'dot-grid', 'mesh', 'stripes', 'topographic', 'halftone', 'light-rays']);
export const DEFAULT_BACKGROUND_KIND = 'blobs';

// Tested parameter ranges, per kind: {min, max, default}. angle in degrees;
// scale multiplies the pattern size; density, intensity and grain are 0–1;
// speed multiplies the level's motion speed (0 = still). color picks the
// palette role the pattern takes.
const range = (min, max, value) => Object.freeze({ min, max, default: value });
const ANGLE = range(0, 360, 160), SCALE = range(0.5, 2, 1), DENSITY = range(0, 1, 0.5), INTENSITY = range(0, 1, 0.5), GRAIN = range(0, 1, 0.4), SPEED = range(0, 2, 1);
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
  'light-rays': Object.freeze({ angle: range(-60, 60, 0), density: DENSITY, intensity: INTENSITY, speed: SPEED })
});
// Kinds whose pattern takes a palette role (params.color).
const COLORED = new Set(['gradient', 'grain-gradient', 'geometric', 'dot-grid', 'stripes', 'topographic', 'halftone', 'light-rays']);
const DEFAULT_COLOR = Object.freeze({ gradient: 'primary', 'grain-gradient': 'primary', geometric: 'primary', 'dot-grid': 'paper', stripes: 'paper', topographic: 'primary', halftone: 'primary', 'light-rays': 'paper' });
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
  const spec = BACKGROUND_PARAMS[value.kind];
  const allowed = [...Object.keys(spec), ...(COLORED.has(value.kind) ? ['color'] : [])];
  for (const [key, given] of Object.entries(value.params)) {
    if (!allowed.includes(key)) { errors.push(`${path}.params.${key} is not supported for ${value.kind}${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ' (it takes no params)'}`); continue; }
    if (key === 'color') { if (!BACKGROUND_COLORS.includes(given)) errors.push(`${path}.params.color must be one of ${BACKGROUND_COLORS.join(', ')}`); continue; }
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
  for (const [key, spec] of Object.entries(BACKGROUND_PARAMS[value.kind])) params[key] = value.params?.[key] ?? spec.default;
  if (COLORED.has(value.kind)) params.color = value.params?.color ?? DEFAULT_COLOR[value.kind];
  return { kind: value.kind, params };
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
function grainImage(seed, frequency, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="2" seed="${seed % 1000}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#g)"/></svg>`;
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}')`;
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
  const colors = palette(story);
  const level = fieldLevel(story);
  const speed = (LEVEL_SPEED[level] ?? 1) * (params.speed ?? 0) * (AMBIENT_PRESETS[level] ? 1 : 0);
  const u = Math.min(W, H) / 1080;
  const random = seededRandom(ambientSeed(story) ^ 0x5bd1e995);
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
  const grain = (amount, frequency, size, id = 'grain') => {
    if (!(amount > 0)) return;
    // Grain greys a pixel toward black or white by up to half its opacity; both extremes are tones.
    const want = 0.16 * amount;
    const under = [...tones];
    let alpha = want;
    for (const tone of under) alpha = Math.min(alpha, 2 * safeAlpha(colors, '#ffffff', want / 2, tone), 2 * safeAlpha(colors, '#000000', want / 2, tone));
    alpha = Math.floor(alpha * 1e4) / 1e4;
    for (const tone of under) { tones.add(mix(tone, '#ffffff', alpha / 2)); tones.add(mix(tone, '#000000', alpha / 2)); }
    layers.push({ id, box: box(0, 0, W, H), svg: null, style: { backgroundImage: grainImage(ambientSeed(story), frequency, size), backgroundSize: `${size}px ${size}px`, opacity: round(alpha, 4) }, axes: {} });
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
      const strokeAlpha = lay(tint, 0.1 + 0.3 * params.intensity);
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
      const radius = round(cell * (0.05 + 0.08 * params.density), 2);
      const alpha = lay(tint, 0.14 + 0.3 * params.intensity);
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
      const alpha = lay(tint, 0.06 + 0.24 * params.intensity);
      const size = diag + 2 * periodPx;
      layers.push({ id: 'stripes', box: box((W - size) / 2, (H - size) / 2, size, size), svg: null,
        style: { backgroundImage: `repeating-linear-gradient(${round(params.angle, 2)}deg, ${rgba(tint, alpha)} 0px, ${rgba(tint, alpha)} ${band}px, ${rgba(tint, 0)} ${band}px, ${rgba(tint, 0)} ${periodPx}px)` },
        axes: { x: wave(periodPx * 0.5, period(20), 0) } });
      break;
    }
    case 'topographic': {
      // Contour rings around two summits, each ring a wobbled closed curve.
      const rings = Math.round(6 + 10 * params.density);
      const alpha = lay(tint, 0.12 + 0.3 * params.intensity);
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
      const alpha = lay(tint, 0.16 + 0.4 * params.intensity);
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
      const alpha = lay(tint, 0.06 + 0.2 * params.intensity);
      const size = diag * 2.2;
      const cx = W / 2 + Math.tan((params.angle * Math.PI) / 180) * H * 0.5, cy = -H * 0.12;
      const slice = round(360 / rays, 4), lit = round(slice * 0.42, 4);
      layers.push({ id: 'rays', box: box(cx - size / 2, cy - size / 2, size, size), svg: null,
        style: { backgroundImage: `repeating-conic-gradient(from ${round(180 + params.angle, 2)}deg at 50% 50%, ${rgba(tint, alpha)} 0deg, ${rgba(tint, 0)} ${lit}deg, ${rgba(tint, 0)} ${slice}deg)`,
          maskImage: `radial-gradient(closest-side, #000000 0%, #000000b3 30%, #00000033 62%, #00000000 92%)`, WebkitMaskImage: `radial-gradient(closest-side, #000000 0%, #000000b3 30%, #00000033 62%, #00000000 92%)` },
        axes: { rotation: wave(3, period(30), 0) } });
      break;
    }
    default:
      return null;
  }
  for (const layer of layers) for (const key of Object.keys(layer.axes)) if (layer.axes[key] === undefined) delete layer.axes[key];
  return { kind, level, params, colors, layers, tones: [...tones] };
}

/** Every colour text can sit on over this story's background (bg alone for blobs, whose field is gated by its own contrast step). */
export function backgroundTones(story) {
  return backgroundPlan(story)?.tones ?? [palette(story).bg];
}

// ---------------------------------------------------------------------------
// Drawing (both renderers)

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
  if (!plan) return [];
  const findings = [];
  const { colors, tones } = plan;
  const worst = (fg, list) => list.map((tone) => ({ tone, ratio: contrast(fg, tone) })).sort((a, b) => a.ratio - b.ratio)[0];
  const panel = storyPanel(story);
  const fill = panelFill(panel?.treatment ?? 'solid', colors);
  const panelTones = fill.alpha >= 1 ? [fill.color] : tones.map((tone) => mix(tone, fill.color, fill.alpha));
  const floor = textFloor(colors);
  const onPanel = worst(colors.paper, panelTones);
  if (onPanel.ratio < floor) findings.push({ rule: 'background-contrast', severity: 'error', ids: ['panel'], at: 0,
    detail: `panel text (${colors.paper}) has ${onPanel.ratio.toFixed(2)}:1 on a ${panel?.treatment ?? 'solid'} panel over the ${plan.kind} background (${onPanel.tone}); it needs ${TEXT_MIN}:1. Lower background.params.intensity or use a more opaque panel` });
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
