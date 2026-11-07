// The dot-wipe transition: a halftone grid of round dots in the story's ink
// grows in from the edges until the frame is nearly solid, the scene swaps
// under it, and the dots shrink away (centre first) to reveal the next one.
// Shared by the HyperFrames compiler and the Remotion StoryComposition: both
// draw the same SVG (one <circle> per dot, grouped by how late each dot
// grows) and the same CSS rule, and drive one custom property, --lc-dw
// (the cover, 0 → 1 → 0), so the two renderers draw the same frames.
// Plain ESM; imports only ./motion.mjs. Canonical copy: kit/core/dot-wipe.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Typed transitions".
//
//   scene.in = {type: "dot-wipe", dur: 0.5}       (track-0 scenes, ≈0.5 s)
//
// The layer side (kit/core/transitions.mjs): the incoming plate stays hidden
// for the first half and appears at the midpoint, under the full cover.

import { getEase } from './motion.mjs';

export const DOT_WIPE = Object.freeze({
  // Dots across the short side of the frame, the dot radius at full cover
  // (a share of the pitch; above 0.71 neighbours overlap and close the gaps),
  // how staggered the growth is (0: every dot at once), the dots' opacity at
  // full cover (the old scene just shows through, as printed halftone), and
  // the timeline: cover, hold (the swap sits in its middle), reveal.
  columns: 24, fill: 0.74, spread: 1.4, opacity: 0.96,
  cover: 0.45, hold: 0.1, coverEase: 'power1.in', revealEase: 'power1.out',
  // Lateness is quantised into this many groups (one CSS custom property each).
  levels: 24,
  // Stacking: over every scene, under the medium, the brand frame and the captions.
  z: Object.freeze({ hyperframes: 79000, remotion: 48 })
});

const round = (value, digits = 3) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const HEX = /^#[0-9a-fA-F]{6}$/;

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The dots' colour: the brand's ink when it stands out on the background,
 * else its paper (the text colour: dark on a light paper look, light on a
 * dark one), else the most contrasting of primary, black and white.
 */
export function dotWipeColor(brand) {
  const colors = brand?.colors ?? {};
  const bg = HEX.test(colors.bg ?? '') ? colors.bg : '#000000';
  for (const role of ['ink', 'paper']) if (HEX.test(colors[role] ?? '') && contrast(colors[role], bg) >= 4) return colors[role];
  const options = [colors.paper, colors.primary, '#111111', '#f5f5f5'].filter((value) => HEX.test(value ?? ''));
  return options.reduce((best, value) => (contrast(value, bg) > contrast(best, bg) + 1e-9 ? value : best), options[0]);
}

/**
 * The dot grid for a frame: a square grid centred on the canvas, each dot's
 * lateness (0 in the corners, 1 at the centre, elliptical, quantised).
 * → {pitch, radius, groups: [{late, dots: [{x, y}]}]} (groups by lateness, earliest first)
 */
export function dotWipeGrid(width, height) {
  const pitch = round(Math.min(width, height) / DOT_WIPE.columns, 3);
  const cols = Math.ceil(width / pitch) + 1, rows = Math.ceil(height / pitch) + 1;
  const x0 = (width - (cols - 1) * pitch) / 2, y0 = (height - (rows - 1) * pitch) / 2;
  const groups = new Map();
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = round(x0 + i * pitch, 2), y = round(y0 + j * pitch, 2);
      const nx = (x - width / 2) / (width / 2), ny = (y - height / 2) / (height / 2);
      const late = round(Math.round((1 - Math.min(1, Math.hypot(nx, ny) / Math.SQRT2)) * DOT_WIPE.levels) / DOT_WIPE.levels, 4);
      if (!groups.has(late)) groups.set(late, []);
      groups.get(late).push({ x, y });
    }
  }
  return { pitch, radius: round(pitch * DOT_WIPE.fill, 3), groups: [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([late, dots]) => ({ late, dots })) };
}

/** The CSS rule both renderers use: a dot's radius from the cover (--lc-dw) and its group's lateness (--lc-dl). */
export function dotWipeCss(width, height) {
  const { radius } = dotWipeGrid(width, height);
  const w = DOT_WIPE.spread;
  return `.lc-dot-wipe { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; pointer-events: none; }
.lc-dot-wipe svg { position: absolute; left: 0; top: 0; display: block; }
.lc-dot-wipe circle { r: calc(${radius}px * clamp(0, var(--lc-dw) * ${round(1 + w, 4)} - var(--lc-dl) * ${w}, 1)); }`;
}

/** A dot's radius (px) at cover c for lateness `late`, as the CSS rule computes it. */
export function dotRadius(c, late, radius) {
  const w = DOT_WIPE.spread;
  return radius * Math.min(1, Math.max(0, c * (1 + w) - late * w));
}

/** The SVG markup (a string, both renderers parse the same) for a frame's dot grid in `color`. */
export function dotWipeSvg(width, height, color) {
  const grid = dotWipeGrid(width, height);
  const groups = grid.groups.map((group) => `<g style="--lc-dl:${group.late}">${group.dots.map((dot) => `<circle cx="${dot.x}" cy="${dot.y}" r="0"/>`).join('')}</g>`).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><g fill="${color}" fill-opacity="${DOT_WIPE.opacity}">${groups}</g></svg>`;
}

/**
 * The dot wipes of a story: every track-0 window entry (and the loop ending)
 * that arrives with a dot-wipe. windows: transitions.mjs sceneWindows.
 * → [{id, sceneId, start, dur, color}]
 */
export function dotWipes(story, windows) {
  const color = dotWipeColor(story?.brand);
  const out = [];
  for (const entry of windows?.scenes ?? []) {
    if (!entry.plate || entry.transitionIn?.type !== 'dot-wipe' || !(entry.transitionIn.dur > 0)) continue;
    out.push({ id: `lc-dw-${entry.id}`, sceneId: entry.id, start: round(entry.start, 6), dur: round(entry.transitionIn.dur, 6), color });
  }
  const loop = windows?.loop;
  if (loop?.transitionIn?.type === 'dot-wipe' && loop.transitionIn.dur > 0) out.push({ id: `lc-dw-${loop.sceneId}-loop`, sceneId: `${loop.sceneId}-loop`, start: round(loop.start, 6), dur: round(loop.transitionIn.dur, 6), color });
  return out.sort((a, b) => a.start - b.start);
}

/** The phases of one wipe (absolute seconds): cover until coverEnd, full until revealStart, reveal until end. */
export function dotWipePhases(wipe) {
  const coverEnd = wipe.start + wipe.dur * DOT_WIPE.cover;
  const revealStart = wipe.start + wipe.dur * (DOT_WIPE.cover + DOT_WIPE.hold);
  return { start: wipe.start, coverEnd: round(coverEnd, 6), revealStart: round(revealStart, 6), end: round(wipe.start + wipe.dur, 6) };
}

/** The cover (0 → 1 → 0) of one wipe at absolute t; 0 outside it. */
export function dotWipeCover(wipe, t) {
  const p = dotWipePhases(wipe);
  if (t < p.start || t >= p.end) return 0;
  if (t < p.coverEnd) return getEase(DOT_WIPE.coverEase)((t - p.start) / (p.coverEnd - p.start));
  if (t < p.revealStart) return 1;
  return 1 - getEase(DOT_WIPE.revealEase)((t - p.revealStart) / (p.end - p.revealStart));
}

/**
 * HyperFrames: the GSAP lines for one wipe on its element (#id): shown at its
 * start, the cover tweened in and out on --lc-dw, hidden at its end.
 */
export function dotWipeGsap(wipe) {
  const p = dotWipePhases(wipe);
  const sel = JSON.stringify(`#${wipe.id}`);
  const n = (value) => round(value, 6);
  return [
    `tl.set(${sel}, { opacity: 1 }, ${n(p.start)});`,
    `tl.fromTo(${sel}, { "--lc-dw": 0 }, { "--lc-dw": 1, duration: ${n(p.coverEnd - p.start)}, ease: "${DOT_WIPE.coverEase}", immediateRender: false }, ${n(p.start)});`,
    `tl.fromTo(${sel}, { "--lc-dw": 1 }, { "--lc-dw": 0, duration: ${n(p.end - p.revealStart)}, ease: "${DOT_WIPE.revealEase}", immediateRender: false }, ${n(p.revealStart)});`,
    `tl.set(${sel}, { opacity: 0 }, ${n(p.end)});`
  ];
}
