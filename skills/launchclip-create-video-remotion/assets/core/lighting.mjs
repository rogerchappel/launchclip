// Story lighting: soft, mostly additive light that makes a dark frame read as
// lit, the way a stage is. Set by story.light (a style pack's `light`, merged
// by kit/core/style.mjs applyStyle) as {preset?, key?, pool?, vignette?,
// haze?, wrap?, pulses?}; no light (or preset "none" alone) leaves the render
// exactly as it was.
//
// Layers, in two groups:
//   under   drawn inside every plate, over the background and under the
//           scene's content: haze (low-contrast drifting bands, the frame's
//           mid-tones), key (a large soft glow from an edge, top centre by
//           default, in the brand accent, drifting and breathing slowly),
//           pool (a glow on the floor) and pulses (soft blooms that swell and
//           fade on key beats);
//   over    one full-canvas layer above every scene, under the dot wipes, the
//           medium, the brand frame and the captions: wrap (a faint screen
//           blend of the key, so panels near the light look lit), the pulses'
//           screen-blended halo and the vignette (darkened corners).
//
// Every layer is a box with inline CSS and wave axes (ambient.mjs), the shape
// of a background layer (kit/core/backgrounds.mjs), plus an opacity axis and,
// for a pulse, an envelope. GSAP plays the axes as half-period sine.inOut
// tweens and the envelope as fromTo tweens (lightTweens); Remotion evaluates
// the same functions per frame (lightLayerStyle), so both renderers draw the
// same pixels at any seek. No wall clock, randomness or timers.
//
// Colour comes from the palette (accent by default) or a hex, and every alpha
// laid over bg is clamped so paper text keeps 4.5:1 on it (or bg's own ratio
// when that is lower). Contract: docs/KIT_CONTRACTS.md, "Story lighting".

import { axisSegments, axisValue, fieldLevel } from './ambient.mjs';
import { contrast, mix } from './panels.mjs';
import { getEase } from './motion.mjs';

const range = (min, max, value) => Object.freeze({ min, max, default: value });
// Tested ranges per layer: {min, max, default}. x, y are shares of the canvas
// (0 left / top, 1 right / bottom); size scales the glow; intensity 0–1.
export const LIGHT_PARAMS = Object.freeze({
  key: Object.freeze({ x: range(0, 1, 0.5), y: range(0, 1, 0), size: range(0.3, 2, 1), intensity: range(0, 1, 0.6), drift: range(0, 1, 0.5) }),
  pool: Object.freeze({ x: range(0, 1, 0.5), size: range(0.3, 2, 1), intensity: range(0, 1, 0.4) }),
  vignette: Object.freeze({ intensity: range(0, 1, 0.5) }),
  haze: Object.freeze({ intensity: range(0, 1, 0.4), speed: range(0, 2, 1) }),
  wrap: Object.freeze({ intensity: range(0, 1, 0.35) })
});
export const LIGHT_LAYERS = Object.freeze(Object.keys(LIGHT_PARAMS));
// Layers that take a colour: a palette role or #rrggbb.
const COLORED = new Set(['key', 'pool']);
export const LIGHT_COLORS = Object.freeze(['accent', 'primary', 'paper']);
export const LIGHT_PULSE_PARAMS = Object.freeze({ x: range(0, 1, 0.5), y: range(0, 1, 0.45), radius: range(0.05, 1, 0.35), intensity: range(0, 1, 0.7), duration: range(0.2, 4, 1.2) });
export const LIGHT_PULSES_MAX = 24;
export const LIGHT_KEYS = Object.freeze(['preset', ...LIGHT_LAYERS, 'pulses']);
// Presets: full layer values; a story's own layer fields win, field by field,
// and false turns a layer off.
export const LIGHT_PRESETS = Object.freeze({
  none: Object.freeze({}),
  // A soft key from top centre, a floor pool, gentle corners and haze.
  studio: Object.freeze({
    key: Object.freeze({ x: 0.5, y: 0, size: 1, intensity: 0.6, drift: 0.5, color: 'accent' }),
    pool: Object.freeze({ x: 0.5, size: 1, intensity: 0.4, color: 'accent' }),
    vignette: Object.freeze({ intensity: 0.55 }),
    haze: Object.freeze({ intensity: 0.45, speed: 1 }),
    wrap: Object.freeze({ intensity: 0.35 })
  }),
  // A narrower, brighter key and deep corners: one pool of light on stage.
  spot: Object.freeze({
    key: Object.freeze({ x: 0.5, y: 0, size: 0.7, intensity: 0.8, drift: 0.3, color: 'accent' }),
    pool: Object.freeze({ x: 0.5, size: 0.7, intensity: 0.3, color: 'accent' }),
    vignette: Object.freeze({ intensity: 0.8 }),
    haze: Object.freeze({ intensity: 0.25, speed: 0.6 }),
    wrap: Object.freeze({ intensity: 0.3 })
  }),
  // A wide, low key and more haze: an even, glowing room.
  soft: Object.freeze({
    key: Object.freeze({ x: 0.5, y: 0, size: 1.4, intensity: 0.45, drift: 0.6, color: 'accent' }),
    pool: Object.freeze({ x: 0.5, size: 1.3, intensity: 0.3, color: 'accent' }),
    vignette: Object.freeze({ intensity: 0.35 }),
    haze: Object.freeze({ intensity: 0.6, speed: 1 }),
    wrap: Object.freeze({ intensity: 0.2 })
  })
});
export const LIGHT_PRESET_NAMES = Object.freeze(Object.keys(LIGHT_PRESETS));
// The over layer's z: above every scene and the camera, under the dot wipes
// (79000 / 48), the medium (80000 / 49), the brand frame and the captions.
export const LIGHT_Z = Object.freeze({ hyperframes: 78000, remotion: 47 });
export const LIGHT_OVER_ID = 'lc-light-over';

const HEX = /^#[0-9a-fA-F]{6}$/;
const TEXT_MIN = 4.5;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const round = (value, digits = 3) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const inRange = (value, { min, max }) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isColor = (value) => LIGHT_COLORS.includes(value) || (typeof value === 'string' && HEX.test(value));

/**
 * Validation messages for story.light (empty = valid). anchor(value, path)
 * checks a pulse's `at` (story.mjs passes its anchor parser); without one,
 * `at` must be seconds.
 */
export function lightErrors(value, path = 'light', { anchor = null } = {}) {
  if (value === undefined || value === null) return [];
  if (!isObject(value)) return [`${path} must be an object {preset?, key?, pool?, vignette?, haze?, wrap?, pulses?}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!LIGHT_KEYS.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${LIGHT_KEYS.join(', ')})`);
  if (value.preset !== undefined && !LIGHT_PRESET_NAMES.includes(value.preset)) errors.push(`${path}.preset must be one of ${LIGHT_PRESET_NAMES.join(', ')}`);
  for (const layer of LIGHT_LAYERS) {
    const given = value[layer];
    if (given === undefined || given === false) continue;
    if (!isObject(given)) { errors.push(`${path}.${layer} must be an object or false`); continue; }
    const spec = LIGHT_PARAMS[layer];
    const allowed = [...Object.keys(spec), ...(COLORED.has(layer) ? ['color'] : [])];
    for (const [key, inner] of Object.entries(given)) {
      if (!allowed.includes(key)) { errors.push(`${path}.${layer}.${key} is not supported (allowed: ${allowed.join(', ')})`); continue; }
      if (key === 'color') { if (!isColor(inner)) errors.push(`${path}.${layer}.color must be ${LIGHT_COLORS.join(', ')} or #rrggbb`); continue; }
      if (!inRange(inner, spec[key])) errors.push(`${path}.${layer}.${key} must be a number from ${spec[key].min} to ${spec[key].max}`);
    }
  }
  if (value.pulses !== undefined) {
    if (!Array.isArray(value.pulses)) errors.push(`${path}.pulses must be a list of {at, x?, y?, radius?, intensity?, duration?, color?}`);
    else {
      if (value.pulses.length > LIGHT_PULSES_MAX) errors.push(`${path}.pulses takes at most ${LIGHT_PULSES_MAX} pulses`);
      value.pulses.forEach((pulse, i) => {
        const where = `${path}.pulses[${i}]`;
        if (!isObject(pulse)) { errors.push(`${where} must be {at, x?, y?, radius?, intensity?, duration?, color?}`); return; }
        const allowed = ['at', 'color', ...Object.keys(LIGHT_PULSE_PARAMS)];
        for (const [key, inner] of Object.entries(pulse)) {
          if (!allowed.includes(key)) { errors.push(`${where}.${key} is not supported (allowed: ${allowed.join(', ')})`); continue; }
          if (key === 'at') continue;
          if (key === 'color') { if (!isColor(inner)) errors.push(`${where}.color must be ${LIGHT_COLORS.join(', ')} or #rrggbb`); continue; }
          if (!inRange(inner, LIGHT_PULSE_PARAMS[key])) errors.push(`${where}.${key} must be a number from ${LIGHT_PULSE_PARAMS[key].min} to ${LIGHT_PULSE_PARAMS[key].max}`);
        }
        if (pulse.at === undefined) errors.push(`${where}.at is required`);
        else if (anchor) anchor(pulse.at, `${where}.at`);
        else if (!(typeof pulse.at === 'number' && pulse.at >= 0)) errors.push(`${where}.at must be seconds (resolve the story first for word anchors)`);
      });
    }
  }
  return errors;
}

/**
 * The story's light with every field filled → {key, pool, vignette, haze,
 * wrap, pulses} (a layer that is off is null), or null when the story has no
 * light, it is invalid, nothing is on, or the story is footage-led (the
 * recording is the picture).
 */
export function storyLight(story) {
  const value = story?.light;
  if (!isObject(value) || story?.lane === 'footage-led') return null;
  if (lightErrors(value).length) return null;
  const preset = LIGHT_PRESETS[value.preset ?? 'none'];
  const out = {};
  for (const layer of LIGHT_LAYERS) {
    const own = value[layer], base = preset[layer];
    if (own === false || (own === undefined && !base)) { out[layer] = null; continue; }
    const filled = {};
    for (const [key, spec] of Object.entries(LIGHT_PARAMS[layer])) filled[key] = own?.[key] ?? base?.[key] ?? spec.default;
    if (COLORED.has(layer)) filled.color = own?.color ?? base?.color ?? 'accent';
    out[layer] = filled;
  }
  out.pulses = (Array.isArray(value.pulses) ? value.pulses : []).map((pulse) => {
    const filled = { at: pulse.at, color: pulse.color ?? out.key?.color ?? 'accent' };
    for (const [key, spec] of Object.entries(LIGHT_PULSE_PARAMS)) filled[key] = pulse[key] ?? spec.default;
    return filled;
  }).sort((a, b) => a.at - b.at);
  const on = LIGHT_LAYERS.some((layer) => out[layer]) || out.pulses.length;
  return on ? out : null;
}

// ---------------------------------------------------------------------------
// Geometry

/**
 * The key light's ellipse in shares of a box: {x, y, rx, ry} (centre and
 * radii; rx of the width, ry of the height). Used by the key layer and by a
 * lit dot grid (backgrounds.mjs), which shows its dots where this light falls.
 * width / height: the canvas (9:16 by default).
 */
export function keyEllipse(key, { width = 1080, height = 1920 } = {}) {
  const k = { ...Object.fromEntries(Object.entries(LIGHT_PARAMS.key).map(([name, spec]) => [name, spec.default])), ...(isObject(key) ? key : {}) };
  // A circle of radius 0.78 × the short side at size 1, stretched 1.1× along the edge it hangs from.
  const r = 0.78 * k.size * Math.min(width, height);
  const along = k.y <= 0.2 || k.y >= 0.8;
  return { x: k.x, y: k.y, rx: round((r * (along ? 1.1 : 1)) / width, 4), ry: round((r * (along ? 1 : 1.1)) / height, 4) };
}

/** The pool's ellipse in shares of a box, as keyEllipse: a wide, low glow on the floor. */
export function poolEllipse(pool, { width = 1080, height = 1920 } = {}) {
  const p = { x: 0.5, size: 1, ...(isObject(pool) ? pool : {}) };
  const short = Math.min(width, height);
  return { x: p.x, y: 1.02, rx: round((0.85 * p.size * short) / width, 4), ry: round((0.38 * p.size * short) / height, 4) };
}

// ---------------------------------------------------------------------------
// Colour

function palette(story) {
  const colors = isObject(story?.brand?.colors) ? story.brand.colors : {};
  const pick = (key, fallback) => (HEX.test(colors[key] ?? '') ? colors[key].toLowerCase() : fallback);
  const bg = pick('bg', '#000000');
  const paper = pick('paper', '#ffffff');
  const primary = pick('primary', paper);
  return { bg, paper, primary, accent: pick('accent', primary) };
}

const colorOf = (colors, value) => (HEX.test(value ?? '') ? value.toLowerCase() : colors[value] ?? colors.accent);
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, alpha) => `rgba(${rgbOf(hex).join(', ')}, ${round(alpha, 4)})`;

// The largest alpha (≤ want) at which `color` over `under` keeps paper text at
// its floor (backgrounds.mjs safeAlpha, kept here so this file does not import it).
function textSafeAlpha(colors, color, want, under = colors.bg) {
  const floor = Math.min(TEXT_MIN, contrast(colors.paper, colors.bg) - 0.01);
  const ok = (alpha) => contrast(colors.paper, mix(under, color, alpha)) >= floor;
  if (ok(want)) return round(want, 4);
  let lo = 0, hi = want;
  for (let i = 0; i < 24; i += 1) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return Math.floor(lo * 1e4) / 1e4;
}

// Gaussian-like falloff (stop %, alpha fraction), many stops so no ring shows.
const FALLOFF = Object.freeze([[0, 1], [10, 0.95], [20, 0.84], [30, 0.69], [40, 0.53], [50, 0.38], [60, 0.25], [70, 0.14], [80, 0.07], [90, 0.025], [100, 0]]);
const glow = (hex, alpha) => `radial-gradient(closest-side, ${FALLOFF.map(([stop, k]) => `${rgba(hex, alpha * k)} ${stop}%`).join(', ')})`;

// ---------------------------------------------------------------------------
// Plan

const box = (x, y, width, height) => ({ x: round(x, 2), y: round(y, 2), width: round(width, 2), height: round(height, 2) });
// phase is 0 or 1 (axisSegments tweens between extrema at half periods).
function wave(amp, period, phase, center = 0) {
  if (!(Math.abs(amp) > 1e-6) || !(period > 0) || !Number.isFinite(period)) return undefined;
  return { kind: 'wave', center, amp: round(amp, 4), period: round(period, 4), phase };
}
// Pulse envelope: a quick swell, a longer fade.
const PULSE_RISE = Object.freeze({ share: 0.3, max: 0.4, ease: 'sine.out' });
const PULSE_FALL_EASE = 'sine.inOut';
const PULSE_GROW = Object.freeze({ from: 0.72, to: 1.12, ease: 'power2.out' });
// How much of a pulse shows over the scenes (screen-blended), against under them.
const PULSE_OVER = 0.8;

/**
 * The light for a story → {colors, level, under: [layer], over: [layer]} or
 * null (no light, or no canvas). Layer = {id, box, style, axes: {x?, y?,
 * scale?, opacity?}, pulse?: {at, rise, fall, peak}}: a background-shaped
 * layer (backgrounds.mjs) whose transform pivots on its box centre; a pulse
 * layer's opacity and scale follow its envelope instead of axes.
 */
export function lightPlan(story) {
  const light = storyLight(story);
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!light || !(W > 0 && H > 0)) return null;
  const colors = palette(story);
  const level = fieldLevel(story);
  const still = level === 'off';
  const short = Math.min(W, H);
  const under = [], over = [];
  const key = light.key;
  const keyColor = key ? colorOf(colors, key.color) : colors.accent;
  let keyAlpha = 0;
  let lit = colors.bg; // the brightest tone the under layers reach, for the next clamp

  if (light.haze) {
    // Three wide, faint bands of the key colour washed toward paper, drifting
    // past each other: the frame's mid-tones, never a shape.
    const tone = mix(keyColor, colors.paper, 0.35);
    const speed = still ? 0 : light.haze.speed;
    const bands = [[0.22, 0.62, 0.9, 0], [0.55, 0.5, 1, 1], [0.8, 0.68, 0.8, 0]];
    bands.forEach(([cy, height, alpha, phase], i) => {
      const want = 0.1 * light.haze.intensity * alpha;
      const a = textSafeAlpha(colors, tone, want);
      const bw = W * 1.9, bh = H * height * 0.55;
      under.push({ id: `haze${i}`, box: box((W - bw) / 2, cy * H - bh / 2, bw, bh),
        style: { background: glow(tone, a) },
        axes: { x: wave(W * 0.12, speed > 0 ? (26 + 7 * i) / speed : Infinity, phase), y: wave(H * 0.02, speed > 0 ? (19 + 5 * i) / speed : Infinity, 1 - phase) } });
    });
    lit = mix(lit, tone, 0.1 * light.haze.intensity);
  }
  if (key) {
    const e = keyEllipse(key, { width: W, height: H });
    const rx = e.rx * W, ry = e.ry * H;
    keyAlpha = textSafeAlpha(colors, keyColor, 0.32 * key.intensity, lit);
    const drift = still ? 0 : key.drift;
    under.push({ id: 'key', box: box(e.x * W - rx, e.y * H - ry, 2 * rx, 2 * ry),
      style: { background: glow(keyColor, keyAlpha) },
      axes: { x: wave(0.05 * short * drift, 17, 0), y: wave(0.02 * short * drift, 13, 1), scale: wave(0.045 * drift, 9.5, 1, 1), opacity: wave(0.08 * drift, 7.3, 0, 1 - 0.08 * drift) } });
    lit = mix(lit, keyColor, keyAlpha);
  }
  if (light.pool) {
    const p = light.pool;
    const e = poolEllipse(p, { width: W, height: H });
    const rx = e.rx * W, ry = e.ry * H;
    const color = colorOf(colors, p.color);
    const a = textSafeAlpha(colors, color, 0.5 * p.intensity);
    const drift = still ? 0 : (key?.drift ?? 0.5);
    under.push({ id: 'pool', box: box(e.x * W - rx, e.y * H - ry, 2 * rx, 2 * ry),
      style: { background: glow(color, a) },
      axes: { x: wave(0.04 * short * drift, 21, 1), scale: wave(0.035 * drift, 11, 0, 1) } });
  }
  light.pulses.forEach((pulse, i) => {
    const color = colorOf(colors, pulse.color);
    const r = pulse.radius * short;
    const rise = round(Math.min(PULSE_RISE.max, pulse.duration * PULSE_RISE.share), 4);
    const env = { at: round(pulse.at, 4), rise, fall: round(pulse.duration - rise, 4) };
    const b = box(pulse.x * W - r, pulse.y * H - r, 2 * r, 2 * r);
    const peak = textSafeAlpha(colors, color, 0.6 * pulse.intensity, lit);
    under.push({ id: `pulse${i}`, box: b, style: { background: glow(color, peak) }, axes: {}, pulse: env });
    over.push({ id: `pulse${i}`, box: b, style: { background: glow(color, round(peak * PULSE_OVER, 4)), mixBlendMode: 'screen' }, axes: {}, pulse: env });
  });
  if (key && light.wrap && keyAlpha > 0) {
    // The key again, screen-blended over the scenes at a fraction: a panel
    // under the light lifts a little, text on it barely moves.
    const e = keyEllipse(key, { width: W, height: H });
    const rx = e.rx * W, ry = e.ry * H;
    const a = round(keyAlpha * 0.4 * light.wrap.intensity, 4);
    const drift = still ? 0 : key.drift;
    if (a > 0) over.unshift({ id: 'wrap', box: box(e.x * W - rx, e.y * H - ry, 2 * rx, 2 * ry),
      style: { background: glow(keyColor, a), mixBlendMode: 'screen' },
      axes: { x: wave(0.05 * short * drift, 17, 0), y: wave(0.02 * short * drift, 13, 1), scale: wave(0.045 * drift, 9.5, 1, 1) } });
  }
  if (light.vignette) {
    // Corners toward black; the clamp keeps paper text readable on the darkened bg.
    const want = 0.9 * light.vignette.intensity;
    const ok = (alpha) => contrast(colors.paper, mix(colors.bg, '#000000', alpha)) >= Math.min(TEXT_MIN, contrast(colors.paper, colors.bg) - 0.01);
    let a = want;
    if (!ok(a)) { let lo = 0, hi = a; for (let i = 0; i < 24; i += 1) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; } a = lo; }
    const stops = [[0, 0], [45, 0], [62, 0.2], [78, 0.52], [100, 1]];
    over.push({ id: 'vignette', box: box(0, 0, W, H), axes: {},
      style: { background: `radial-gradient(ellipse 78% 62% at 50% 46%, ${stops.map(([stop, k]) => `rgba(0, 0, 0, ${round(a * k, 4)}) ${stop}%`).join(', ')})`, backgroundSize: '100% 100%' } });
  }
  for (const layer of [...under, ...over]) for (const name of Object.keys(layer.axes)) if (layer.axes[name] === undefined) delete layer.axes[name];
  return { colors, level, under, over };
}

// ---------------------------------------------------------------------------
// Drawing (both renderers)

const PULSE_IDLE = Object.freeze({ opacity: 0, scale: PULSE_GROW.from });

/** A pulse layer's {opacity, scale} at absolute time t. */
export function pulseStateAt(pulse, t) {
  const { at, rise, fall } = pulse;
  if (!(t > at)) return { ...PULSE_IDLE };
  const end = at + rise + fall;
  if (t >= end) return { ...PULSE_IDLE };
  const grow = getEase(PULSE_GROW.ease)((t - at) / (rise + fall));
  const scale = PULSE_GROW.from + (PULSE_GROW.to - PULSE_GROW.from) * grow;
  const opacity = t < at + rise ? getEase(PULSE_RISE.ease)((t - at) / rise) : 1 - getEase(PULSE_FALL_EASE)((t - at - rise) / fall);
  return { opacity, scale };
}

/** A light layer's state at absolute time t → {x, y, scale, opacity}. */
export function lightStateAt(layer, t) {
  const axes = layer.axes ?? {};
  const base = { x: axes.x ? axisValue(axes.x, t) : 0, y: axes.y ? axisValue(axes.y, t) : 0, scale: axes.scale ? axisValue(axes.scale, t) : 1, opacity: axes.opacity ? axisValue(axes.opacity, t) : 1 };
  return layer.pulse ? { ...base, ...pulseStateAt(layer.pulse, t) } : base;
}

/** A light layer's inline CSS (camelCase) at absolute time t, for the Remotion kit. */
export function lightLayerStyle(layer, t) {
  const b = layer.box, s = lightStateAt(layer, t);
  return { position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height, transformOrigin: '50% 50%', pointerEvents: 'none', ...layer.style,
    opacity: round(s.opacity, 5), transform: `translate(${round(s.x, 3)}px, ${round(s.y, 3)}px) rotate(0deg) scale(${round(s.scale, 5)})` };
}

const kebab = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
/** lightLayerStyle() as an inline style string, for the HyperFrames compiler. Numbers are px except opacity. */
export function lightLayerCss(layer, t) {
  return Object.entries(lightLayerStyle(layer, t)).map(([key, value]) => `${kebab(key)}:${typeof value === 'number' && key !== 'opacity' ? `${value}px` : value}`).join(';');
}

/** Whether a layer draws anything in [from, to] (a pulse outside it does not). */
export function lightLayerActive(layer, from, to) {
  if (!layer.pulse) return true;
  const { at, rise, fall } = layer.pulse;
  return at < to && at + rise + fall > from;
}

/**
 * Tweens that reproduce a layer over [from, to] → [{prop, at, duration, from,
 * to, ease}] in absolute seconds, for GSAP fromTo on the layer: its axes
 * (ambient.mjs axisSegments) or its pulse envelope (swell, fade and growth).
 */
export function lightTweens(layer, from, to) {
  if (layer.pulse) {
    if (!lightLayerActive(layer, from, to)) return [];
    const { at, rise, fall } = layer.pulse;
    return [
      { prop: 'opacity', at, duration: rise, from: 0, to: 1, ease: PULSE_RISE.ease },
      { prop: 'opacity', at: round(at + rise, 4), duration: fall, from: 1, to: 0, ease: PULSE_FALL_EASE },
      { prop: 'scale', at, duration: round(rise + fall, 4), from: PULSE_GROW.from, to: PULSE_GROW.to, ease: PULSE_GROW.ease }
    ];
  }
  return Object.entries(layer.axes ?? {}).flatMap(([prop, axis]) => axisSegments(axis, from, to).map((segment) => ({ prop, ...segment }))).sort((a, b) => a.at - b.at);
}

/** The over group's container CSS (camelCase): the full canvas, no pointer events. */
export function lightOverStyle({ width, height }) {
  return { position: 'absolute', left: 0, top: 0, width, height, overflow: 'hidden', pointerEvents: 'none' };
}

/**
 * The CSS mask for a lit dot grid (backgrounds.mjs dot-grid params.lit): the
 * dots show under the key light (and, fainter, its floor pool) and almost
 * nowhere else. Light reveals the grid; it is not a pattern of its own. The
 * mask follows the square of the light's falloff, so the dots fade out well
 * inside the glow, and leaves (1 − lit)² elsewhere (0.09 at lit 0.7, 0.02 at
 * 0.85). Shares of the masked box, so it fits the canvas or a panel. Without
 * a story light the key is the studio preset's.
 */
export function litMask(story, lit, { width = 1080, height = 1920 } = {}) {
  if (!(lit > 0)) return null;
  const light = storyLight(story) ?? storyLight({ light: { preset: 'studio' } });
  const key = keyEllipse(light.key ?? LIGHT_PRESETS.studio.key, { width, height });
  const pct = (value) => `${round(value * 100, 2)}%`;
  const floor = round((1 - lit) ** 2, 3);
  const falloff = (alpha) => FALLOFF.map(([stop, k]) => `rgba(0, 0, 0, ${round(alpha * k * k, 4)}) ${stop}%`).join(', ');
  const layers = [`radial-gradient(ellipse ${pct(key.rx * 1.15)} ${pct(key.ry * 1.15)} at ${pct(key.x)} ${pct(key.y)}, ${falloff(1)})`];
  if (light.pool) {
    const pool = poolEllipse(light.pool, { width, height });
    layers.push(`radial-gradient(ellipse ${pct(pool.rx)} ${pct(pool.ry)} at ${pct(pool.x)} ${pct(pool.y)}, ${falloff(0.35)})`);
  }
  if (floor > 0) layers.push(`linear-gradient(rgba(0, 0, 0, ${floor}), rgba(0, 0, 0, ${floor}))`);
  return layers.join(', ');
}
