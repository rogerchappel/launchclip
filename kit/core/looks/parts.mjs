// Shared parts of the scene looks (kit/core/look.mjs, docs/SCENE_LOOKS_RFC.md):
// seeded numbers, the SVG filter primitives a grade is built from, and the
// furniture pieces looks share. Everything is a pure function of its inputs,
// so both renderers draw the same markup.
//
// A grade is a list of filter primitives ending in a result named "out". It
// runs in canvas pixels and sRGB over exactly the canvas (look.mjs lookDefs).
//
// Plain ESM with no imports.

export const r = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const HEX = /^#[0-9a-fA-F]{6}$/;
export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const rgba = (hex, alpha) => { const [x, y, z] = rgb(HEX.test(hex) ? hex : '#000000').map((c) => Math.round(c * 255)); return `rgba(${x},${y},${z},${r(alpha, 3)})`; };

// ---------------------------------------------------------------------------
// Seeded numbers

/** A 32-bit hash of a string (FNV-1a). */
export function hash(text) {
  let h = 0x811c9dc5;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A number in [0, 1) from a seed and an index: the same for the same pair, always. */
export function rand(seed, index = 0) {
  let h = (hash(seed) ^ Math.imul((index | 0) + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Filter primitives

const attrs = (values) => Object.entries(values).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => ` ${key}="${value}"`).join('');
export const fe = (tag, values, children = '') => `<${tag}${attrs(values)}>${children}</${tag}>`;
export const freq = (...values) => values.map((value) => r(value, 5)).join(' ');
export const noise = (result, baseFrequency, seed, octaves = 2, type = 'fractalNoise') => fe('feTurbulence', { type, baseFrequency, numOctaves: octaves, seed, result });
export const displace = (result, input, map, scale, x = 'R', y = 'G') => fe('feDisplacementMap', { in: input, in2: map, scale: r(scale, 2), xChannelSelector: x, yChannelSelector: y, result });
export const blur = (result, input, dx, dy = dx) => fe('feGaussianBlur', { in: input, stdDeviation: dx === dy ? r(dx, 2) : `${r(dx, 2)} ${r(dy, 2)}`, result });
export const arithmetic = (result, a, b, k1, k2, k3, k4 = 0) => fe('feComposite', { in: a, in2: b, operator: 'arithmetic', k1: r(k1), k2: r(k2), k3: r(k3), k4: r(k4), result });
export const composite = (result, a, b, operator = 'over') => fe('feComposite', { in: a, in2: b, operator, result });
export const blend = (result, top, bottom, mode) => fe('feBlend', { in: top, in2: bottom, mode, result });
export const matrix = (result, input, values) => fe('feColorMatrix', { in: input, type: 'matrix', values: values.map((v) => r(v)).join(' '), result });
export const saturate = (result, input, amount) => fe('feColorMatrix', { in: input, type: 'saturate', values: r(amount), result });
export const offset = (result, input, dx, dy) => fe('feOffset', { in: input, dx: r(dx, 2), dy: r(dy, 2), result });
export const morph = (result, input, operator, radius) => fe('feMorphology', { in: input, operator, radius: r(radius, 2), result });
export const flood = (result, color, opacity = 1) => fe('feFlood', { 'flood-color': color, 'flood-opacity': r(opacity, 3), result });
/** Luminance into every colour channel, opaque. */
export const grey = (result, input, gain = 1, bias = 0) => matrix(result, input, [0.2126 * gain, 0.7152 * gain, 0.0722 * gain, 0, bias, 0.2126 * gain, 0.7152 * gain, 0.0722 * gain, 0, bias, 0.2126 * gain, 0.7152 * gain, 0.0722 * gain, 0, bias, 0, 0, 0, 0, 1]);
/** Every colour channel × slope + intercept. */
export const linear = (result, input, slope, intercept) => fe('feComponentTransfer', { in: input, result }, ['R', 'G', 'B'].map((c) => fe(`feFunc${c}`, { type: 'linear', slope: r(slope), intercept: r(intercept) })).join(''));
/** Every colour channel through one table of values (0..1), evenly spaced. */
export const curve = (result, input, table) => fe('feComponentTransfer', { in: input, result }, ['R', 'G', 'B'].map((c) => fe(`feFunc${c}`, { type: 'table', tableValues: table.map((v) => r(v)).join(' ') })).join(''));
/**
 * Colour-ramp mapping: a grey picture through a ramp of colours, darkest
 * first, evenly spaced. The input must already be grey (grey()).
 */
export const ramp = (result, input, stops) => {
  const channels = stops.map(rgb);
  return fe('feComponentTransfer', { in: input, result }, ['R', 'G', 'B'].map((c, i) => fe(`feFunc${c}`, { type: 'table', tableValues: channels.map((stop) => r(stop[i])).join(' ') })).join(''));
};
/** One channel of a noise as opaque grey, stretched about 0.5 by gain. */
export const channel = (result, input, index, gain = 1) => {
  const row = [0, 0, 0, 0, 0.5 - 0.5 * gain];
  row[index] = gain;
  return matrix(result, input, [...row, ...row, ...row, 0, 0, 0, 0, 1]);
};
/** Displacement and blur sample past the canvas edge: laying the result over its source keeps the edges filled. */
export const filled = (result, input, under) => composite(result, input, under, 'over');
/** Glow: the bright parts of `input`, blurred and added back (screen), `amount` 0..1. */
export const glow = (result, input, radius, amount, threshold = 0.5) => [
  linear(`${result}-hi`, input, 1 / Math.max(0.05, 1 - threshold), -threshold / Math.max(0.05, 1 - threshold)),
  blur(`${result}-b`, `${result}-hi`, radius),
  linear(`${result}-a`, `${result}-b`, amount, 0),
  blend(result, `${result}-a`, input, 'screen')
].join('');
/**
 * Edge lines of a picture: white where its colour changes, `width` px wide,
 * black elsewhere. The change is summed over the colour channels, so two
 * colours of the same brightness still get a line between them.
 */
export const outline = (result, input, width, gain = 1.6) => [
  morph(`${result}-d`, input, 'dilate', width / 2),
  morph(`${result}-e`, input, 'erode', width / 2),
  blend(`${result}-x`, `${result}-d`, `${result}-e`, 'difference'),
  matrix(result, `${result}-x`, [gain, gain, gain, 0, 0, gain, gain, gain, 0, 0, gain, gain, gain, 0, 0, 0, 0, 0, 0, 1])
].join('');
/** Sensor noise: fine grey noise added about zero, `amount` 0..1, its pattern from `seed`. */
export const sensor = (result, input, seed, amount, frequency = 0.8) => [
  noise(`${result}-n`, freq(frequency), seed, 1),
  channel(`${result}-g`, `${result}-n`, 0, 1.6),
  arithmetic(result, input, `${result}-g`, 0, 1, amount, -amount / 2)
].join('');
/** A whole-frame nudge by (dx, dy) px, the uncovered edge filled from the source. */
export const nudge = (result, input, dx, dy) => [offset(`${result}-o`, input, dx, dy), filled(result, `${result}-o`, input)].join('');

// ---------------------------------------------------------------------------
// Furniture pieces (markup and CSS; the motion is CSS variables set per frame)

const escapeText = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const text = escapeText;

/**
 * Where furniture may sit: a strip above the safe zone and, when the format
 * leaves room under the caption band, one below it; never the caption band.
 * → {top: {x, y, w, h}, bottom: {x, y, w, h} | null, safe, band}
 */
export function zones(plan) {
  const { width: W, height: H, safe, band } = plan;
  const h = Math.round(H * 0.06);
  const topY = Math.max(Math.round(H * 0.03), safe.y - h - Math.round(H * 0.012));
  const x = safe.x, w = safe.width;
  const under = Math.max(band.y + band.height, safe.y + safe.height) + Math.round(H * 0.008);
  const bottom = under + h <= H * 0.85 ? { x, y: under, w, h } : null;
  return { top: { x, y: topY, w, h }, bottom, safe, band };
}

/** Horizontal scanlines over the whole frame that roll by `--lc-look-scan` (0..1 of one period). */
export function scanlines({ period, color, alpha, thickness = 0.5 }) {
  const on = r(period * thickness, 2);
  return {
    html: '<div class="lc-look-scan"></div>',
    css: `.lc-look-scan { position: absolute; left: 0; top: ${-period}px; right: 0; bottom: 0; background: repeating-linear-gradient(to bottom, ${rgba(color, alpha)} 0, ${rgba(color, alpha)} ${on}px, transparent ${on}px, transparent ${period}px); transform: translateY(calc(var(--lc-look-scan, 0) * ${period}px)); }`
  };
}

/** A dark vignette toward the corners, `amount` 0..1. */
export function vignette({ color = '#000000', amount = 0.5, inner = 55 }) {
  return {
    html: '<div class="lc-look-vignette"></div>',
    css: `.lc-look-vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 50%, transparent ${inner}%, ${rgba(color, amount)} 100%); }`
  };
}

/** Whether frame `frame` falls in a seeded burst: about `rate` bursts a second, each `length` frames. */
export function burstAt(seed, frame, fps, rate, length) {
  const slot = Math.max(1, Math.round(fps / Math.max(0.01, rate)));
  const index = Math.floor(frame / slot);
  const start = index * slot + Math.floor(rand(seed, index) * Math.max(1, slot - length));
  return frame >= start && frame < start + length ? { index, age: frame - start } : null;
}

/** Ease out cubic over [0, 1]. */
export const easeOut = (p) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 3;
/** The shot playing at `t` seconds, and how far into it: {index, age} (index −1 before the first). */
export function shotAt(plan, t) {
  let index = -1;
  for (let i = 0; i < plan.shots.length; i += 1) if (plan.shots[i].start <= t + 1e-6) index = i;
  return { index, age: index < 0 ? 0 : t - plan.shots[index].start };
}

/** Lines `line` px thick every `cell` px across the canvas, white on transparent: horizontal (`axis` "y") or vertical ("x"). */
export const rules = (result, axis, cell, line, plan) => [
  fe('feFlood', { 'flood-color': '#ffffff', x: 0, y: 0, width: axis === 'y' ? r(cell, 2) : r(line, 2), height: axis === 'y' ? r(line, 2) : r(cell, 2), result: `${result}-l` }),
  fe('feOffset', { in: `${result}-l`, dx: 0, dy: 0, x: 0, y: 0, width: r(cell, 2), height: r(cell, 2), result: `${result}-c` }),
  fe('feTile', { in: `${result}-c`, x: 0, y: 0, width: plan.width, height: plan.height, result })
].join('');

/**
 * Tearing: a few horizontal bands of the picture pushed sideways by up to
 * `amount` px, the bands chosen by `seed`. Most rows do not move.
 */
export const tear = (result, input, seed, amount, band = 0.02) => [
  noise(`${result}-n`, freq(0.00001, band), seed, 1),
  // Only the extremes of the noise move a row; the middle maps to no displacement.
  curve(`${result}-t`, `${result}-n`, [0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1]),
  displace(`${result}-d`, input, `${result}-t`, amount * 2, 'R', 'A'),
  filled(result, `${result}-d`, input)
].join('');

/**
 * A counter digit: ten stacked numerals, the one equal to the CSS variable
 * `name` showing. Set the variable to 0..9 per frame.
 */
export function digit(name) {
  return `<span class="lc-look-digit">${Array.from({ length: 10 }, (_, n) => `<span style="opacity:clamp(0, calc(1 - max(var(${name}, 0) - ${n}, ${n} - var(${name}, 0))), 1)">${n}</span>`).join('')}<i>0</i></span>`;
}
export const DIGIT_CSS = '.lc-look-digit { position: relative; display: inline-block; } .lc-look-digit > span { position: absolute; left: 0; top: 0; } .lc-look-digit > i { font-style: normal; visibility: hidden; }';
/** The variables of a mm:ss clock at `seconds`, as {`${prefix}0`..`${prefix}3`}. */
export function clockVars(prefix, seconds) {
  const s = Math.max(0, Math.floor(seconds + 1e-6));
  const mm = Math.floor(s / 60) % 100, ss = s % 60;
  return { [`${prefix}0`]: Math.floor(mm / 10), [`${prefix}1`]: mm % 10, [`${prefix}2`]: Math.floor(ss / 10), [`${prefix}3`]: ss % 10 };
}
