// Text over a world stays readable: every world names a quiet area (plain
// wall, sky or board, where text reads best) and the colours under it; the
// scrim is the brand background laid over that area at the opacity that
// lifts the text colour to at least 4.5:1 against every colour under it.
//
//   scrimFor(world, {text, bg, side?, min?})
//     → {side, alpha, contrast, rect, css, stops}
//
// side: where the scrim falls from: top | bottom | left | right | centre,
// or auto (from the quiet area's position). The scrim is a soft gradient
// (strongest over the quiet area, clear beyond it), so the world still
// reads around the text.

import {contrastRatio, mixColor} from '../catalog-b-base.mjs';

export const SCRIM_SIDES = Object.freeze(['auto', 'top', 'bottom', 'left', 'right', 'centre', 'none']);
export const TEXT_CONTRAST = 4.5;

/** Opacity of bg over `under` that gives text at least `min`:1 (0..0.92). */
export function scrimAlpha(text, bg, under, min = TEXT_CONTRAST) {
  let worst = 0;
  for (const c of under) {
    if (contrastRatio(text, c) >= min) continue;
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(text, mixColor(bg, c, mid)) >= min) hi = mid; else lo = mid;
    }
    worst = Math.max(worst, hi);
  }
  return Math.min(0.92, Math.ceil(worst * 100) / 100);
}

/** The side a quiet area sits on, for the scrim's direction. */
export function quietSide(world) {
  const {width: W, height: H} = world.canvas;
  const q = world.quiet;
  const cx = (q.x + q.width / 2) / W, cy = (q.y + q.height / 2) / H;
  if (q.width >= W * 0.7) return cy < 0.5 ? 'top' : 'bottom';
  if (q.height >= H * 0.7) return cx < 0.5 ? 'left' : 'right';
  if (cy < 0.3) return 'top';
  if (cy > 0.7) return 'bottom';
  return cx < 0.4 ? 'left' : cx > 0.6 ? 'right' : 'centre';
}

const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${Math.round(a * 1000) / 1000})`;

/**
 * The extremes that can show under a quiet area beyond its main tones: the
 * brightest (clouds and the sun outside, lamp light and white fittings
 * inside, lit windows and the moon at night) and the darkest (ink and the
 * night sky). The scrim is sized for these too, so text stays readable
 * whatever passes behind it.
 */
export function quietPeaks(world) {
  const pal = world.palette;
  const bright = world.group === 'inside' ? [pal.trim, pal.wallLight, pal.white, ...(world.time === 'day' ? [] : [pal.lamp, pal.lit])] : ['#ffffff', pal.sun, pal.moon, pal.lit];
  return [...bright, pal.ink, pal.skyTop];
}

/**
 * The scrim for text in brand colours over a world's quiet area: sized for
 * the area's tones and its peaks (quietPeaks), plus a 0.06 margin, at
 * least 0.18.
 */
export function scrimFor(world, {text, bg, side = 'auto', min = TEXT_CONTRAST} = {}) {
  const {width: W, height: H} = world.canvas;
  const q = world.quiet;
  const under = [...(q.under?.length ? q.under : [world.palette.skyLow]), ...quietPeaks(world)];
  const needed = scrimAlpha(text, bg, under, min);
  const alpha = side === 'none' ? 0 : Math.round(Math.min(0.94, Math.max(0.18, needed + 0.06)) * 100) / 100;
  const s = side === 'auto' ? quietSide(world) : side;
  const contrast = Math.min(...under.map(c => contrastRatio(text, mixColor(bg, c, alpha))));
  const pct = v => `${Math.round(v * 1000) / 10}%`;
  let css = 'none';
  if (s === 'top' || s === 'bottom') {
    const a = s === 'top' ? (q.y + q.height) / H : 1 - q.y / H;
    const reach = Math.min(1, a + 0.14);
    css = `linear-gradient(to ${s === 'top' ? 'bottom' : 'top'}, ${rgba(bg, alpha)} 0%, ${rgba(bg, alpha)} ${pct(a)}, ${rgba(bg, 0)} ${pct(reach)})`;
  } else if (s === 'left' || s === 'right') {
    const a = s === 'left' ? (q.x + q.width) / W : 1 - q.x / W;
    const reach = Math.min(1, a + 0.12);
    css = `linear-gradient(to ${s === 'left' ? 'right' : 'left'}, ${rgba(bg, alpha)} 0%, ${rgba(bg, alpha)} ${pct(a)}, ${rgba(bg, 0)} ${pct(reach)})`;
  } else if (s === 'centre') {
    const cx = q.x + q.width / 2, cy = q.y + q.height / 2;
    css = `radial-gradient(ellipse ${Math.round(q.width * 0.9)}px ${Math.round(q.height)}px at ${Math.round(cx)}px ${Math.round(cy)}px, ${rgba(bg, alpha)} 0%, ${rgba(bg, alpha)} 80%, ${rgba(bg, 0)} 100%)`;
  }
  return {side: s, alpha: side === 'none' ? 0 : alpha, needed, contrast: Math.round(contrast * 100) / 100, rect: {x: q.x, y: q.y, width: q.width, height: q.height}, css, text, bg};
}
