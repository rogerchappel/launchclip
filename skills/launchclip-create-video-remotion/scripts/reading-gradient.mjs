// The reading gradient: a brand-coloured layer over a photo or video, solid
// where the type sits and fading to clear, so the picture shows through the
// rest. It is a CSS linear-gradient built here once, so Remotion and
// HyperFrames draw the same stops (the image and video plates, photo-scene's
// scrim, split-screen's seam and the carousel panorama all take it).
//
//   color      ground | primary: a palette token, never a hex
//   tint       0–0.6, how much of the other token mixes in (a ground tinted
//              by the primary, or the primary deepened toward the ground)
//   direction  bottom | top | both | full: the edge it is solid at (both:
//              each of top and bottom; full: flat, stops unused)
//   stops      [solid, clear]: fractions of the layer from that edge; solid
//              up to the first, clear from the second (both: clear ≤ 0.5)
//   opacity    0.3–1, the solid end's alpha
// Between the stops the alpha eases (smoothstep), so no band shows.

import { mix } from './panels.mjs';

export const READING_COLORS = Object.freeze(['ground', 'primary']);
export const READING_DIRECTIONS = Object.freeze(['bottom', 'top', 'both', 'full']);
const DEFAULTS = Object.freeze({ color: 'ground', tint: 0, direction: 'bottom', stops: Object.freeze([0.5, 1]), opacity: 0.85 });
const KEYS = Object.keys(DEFAULTS);
const ANGLE = Object.freeze({ bottom: '0deg', top: '180deg', left: '90deg', right: '270deg' });
const HEX = /^#[0-9a-f]{6}$/i;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const num = (value, min, max) => typeof value === 'number' && value >= min && value <= max;

/** Validation messages for a reading gradient at `path`; [] when it is sound. */
export function readingGradientErrors(gradient, path = 'gradient') {
  if (!isObject(gradient)) return [`${path} must be {color?, tint?, direction?, stops?, opacity?}`];
  const errors = [];
  for (const key of Object.keys(gradient)) if (!KEYS.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${KEYS.join(', ')})`);
  const g = { ...DEFAULTS, ...gradient };
  if (!READING_COLORS.includes(g.color)) errors.push(`${path}.color must be one of ${READING_COLORS.join(', ')}`);
  if (!num(g.tint, 0, 0.6)) errors.push(`${path}.tint must be a number from 0 to 0.6`);
  if (!READING_DIRECTIONS.includes(g.direction)) errors.push(`${path}.direction must be one of ${READING_DIRECTIONS.join(', ')}`);
  if (!num(g.opacity, 0.3, 1)) errors.push(`${path}.opacity must be a number from 0.3 to 1`);
  const [solid, clear] = Array.isArray(g.stops) ? g.stops : [];
  if (!(Array.isArray(g.stops) && g.stops.length === 2 && num(solid, 0, 1) && num(clear, 0, 1) && solid < clear)) errors.push(`${path}.stops must be [solid, clear], fractions from 0 to 1 with solid < clear`);
  else if (g.direction === 'both' && clear > 0.5) errors.push(`${path}.stops: a gradient solid at both edges must reach clear by 0.5`);
  return errors;
}

/** The gradient with every field filled. */
export const readingSpec = (gradient) => ({ ...DEFAULTS, ...gradient });

/** The solid end's colour from a palette ({bg, primary}). */
export function readingColor(gradient, colors) {
  const g = readingSpec(gradient);
  const ground = HEX.test(colors?.bg ?? '') ? colors.bg : '#000000';
  const primary = HEX.test(colors?.primary ?? '') ? colors.primary : ground;
  const [main, other] = g.color === 'primary' ? [primary, ground] : [ground, primary];
  return g.tint > 0 ? mix(main, other, g.tint) : main.toLowerCase();
}

const withA = (hex, alpha) => `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;
const pct = (f) => `${Math.round(f * 10000) / 100}%`;
const RAMP = [0, 0.25, 0.5, 0.75, 1];
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * The gradient as a CSS background over its layer. edge: the edge a seam
 * anchors it to (bottom, top, left, right), overriding a bottom or top
 * direction (split-screen fades its photo toward the panel).
 */
export function readingGradient(gradient, colors, { edge = null } = {}) {
  const g = readingSpec(gradient);
  const color = readingColor(g, colors);
  if (g.direction === 'full') return withA(color, g.opacity);
  const [solid, clear] = g.stops;
  // From the anchored edge inward: [position, alpha].
  const ramp = [[0, g.opacity], ...RAMP.map((t) => [solid + (clear - solid) * t, g.opacity * (1 - smooth(t))]), ...(clear < 1 ? [[1, 0]] : [])];
  if (g.direction === 'both') {
    const there = [...ramp].reverse().map(([at, alpha]) => [1 - at, alpha]).filter(([at]) => at > clear);
    return `linear-gradient(0deg, ${[...ramp.filter(([at]) => at <= clear), ...there].map(([at, alpha]) => `${withA(color, alpha)} ${pct(at)}`).join(', ')})`;
  }
  return `linear-gradient(${ANGLE[edge ?? g.direction]}, ${ramp.map(([at, alpha]) => `${withA(color, alpha)} ${pct(at)}`).join(', ')})`;
}
