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
//   scene.in = {type: "dot-wipe", dur: 0.5, color?, cover?, hold?}   (track-0 scenes, ≈0.5 s)
//
//   color  "accent" (default) | "ink" | "paper" | "#rrggbb"
//   cover  the peak dot size, 0.3–1, as a share of the size that closes the
//          frame (default 0.8: the dots overlap but the diagonal gaps stay
//          open, so the peak never reads as a solid frame); at 1 the dots close
//   hold   frames held at the peak (default 0: the dots turn straight round)
//
// The layer side (kit/core/transitions.mjs): the incoming plate stays hidden
// for the first half and appears at the midpoint, at the peak.

import { getEase } from './motion.mjs';

export const DOT_WIPE = Object.freeze({
  // Dots across the short side of the frame, the dot radius at full cover
  // (a share of the pitch; above 0.71 neighbours overlap and close the gaps),
  // how staggered the growth is (0: every dot at once), the dots' opacity at
  // full cover (the old scene just shows through, as printed halftone), and
  // the eases: grow, then shrink, symmetric about the swap at the midpoint
  // (with any hold centred on it).
  columns: 24, fill: 0.74, spread: 1.4, opacity: 0.96,
  coverEase: 'power1.in', revealEase: 'power1.out',
  // The defaults for scene.in's options (see the header): accent dots that
  // peak at 0.8 of the closing size with no hold, so the wipe reads as
  // halftone passing over the cut rather than a 2–4 frame blink of solid colour.
  defaults: Object.freeze({ color: 'accent', cover: 0.8, hold: 0 }),
  // The named colours and the cover's range (kit/core/story.mjs validates
  // scene.in's options and repeats these, import-free).
  colors: Object.freeze(['accent', 'ink', 'paper']),
  coverRange: Object.freeze([0.3, 1]),
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
 * The ink dots' colour: the brand's ink when it stands out on the background,
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
 * A wipe's colour from scene.in.color: "ink" (dotWipeColor), "accent" (the
 * brand accent, falling back to ink when it is missing or all but invisible
 * on the background, under 1.5:1), "paper" (the page: the story background,
 * brand.colors.bg, for a soft wipe that reads as the page closing over the
 * cut) or a #rrggbb hex.
 */
export function resolveDotWipeColor(brand, color = DOT_WIPE.defaults.color) {
  if (typeof color === 'string' && HEX.test(color)) return color.toLowerCase();
  const colors = brand?.colors ?? {};
  const bg = HEX.test(colors.bg ?? '') ? colors.bg : '#000000';
  if (color === 'paper') return bg.toLowerCase();
  if (color === 'accent' && HEX.test(colors.accent ?? '') && contrast(colors.accent, bg) >= 1.5) return colors.accent.toLowerCase();
  return dotWipeColor(brand);
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
/**
 * The CSS rule both renderers use: a dot's radius from the progress (--lc-dw,
 * 0 → 1 → 0), its group's lateness (--lc-dl) and the wipe's peak size
 * (--lc-dc, its cover option, set on the wipe's element).
 */
export function dotWipeCss(width, height) {
  const { radius } = dotWipeGrid(width, height);
  const w = DOT_WIPE.spread;
  return `.lc-dot-wipe { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; pointer-events: none; }
.lc-dot-wipe svg { position: absolute; left: 0; top: 0; display: block; }
.lc-dot-wipe circle { r: calc(${radius}px * var(--lc-dc, 1) * clamp(0, var(--lc-dw) * ${round(1 + w, 4)} - var(--lc-dl) * ${w}, 1)); }`;
}

/** A dot's radius (px) at progress c for lateness `late` and peak size `cover`, as the CSS rule computes it. */
export function dotRadius(c, late, radius, cover = 1) {
  const w = DOT_WIPE.spread;
  return radius * cover * Math.min(1, Math.max(0, c * (1 + w) - late * w));
}

/** The SVG markup (a string, both renderers parse the same) for a frame's dot grid in `color`. */
export function dotWipeSvg(width, height, color) {
  const grid = dotWipeGrid(width, height);
  const groups = grid.groups.map((group) => `<g style="--lc-dl:${group.late}">${group.dots.map((dot) => `<circle cx="${dot.x}" cy="${dot.y}" r="0"/>`).join('')}</g>`).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><g fill="${color}" fill-opacity="${DOT_WIPE.opacity}">${groups}</g></svg>`;
}

/**
 * The dot wipes of a story: every track-0 window entry (and the loop ending)
 * that arrives with a dot-wipe, with its options resolved (DOT_WIPE.defaults
 * fill the gaps). windows: transitions.mjs sceneWindows.
 * → [{id, sceneId, start, dur, color, cover, hold}] (hold in seconds)
 */
export function dotWipes(story, windows) {
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const options = (spec, dur) => {
    const own = spec && typeof spec === 'object' ? spec : {};
    const cover = typeof own.cover === 'number' ? Math.min(1, Math.max(DOT_WIPE.coverRange[0], own.cover)) : DOT_WIPE.defaults.cover;
    const frames = Number.isInteger(own.hold) && own.hold > 0 ? own.hold : DOT_WIPE.defaults.hold;
    return { color: resolveDotWipeColor(story?.brand, own.color ?? DOT_WIPE.defaults.color), cover, hold: round(Math.min(frames / fps, dur / 2), 6) };
  };
  const out = [];
  for (const entry of windows?.scenes ?? []) {
    if (!entry.plate || entry.transitionIn?.type !== 'dot-wipe' || !(entry.transitionIn.dur > 0)) continue;
    const dur = round(entry.transitionIn.dur, 6);
    out.push({ id: `lc-dw-${entry.id}`, sceneId: entry.id, start: round(entry.start, 6), dur, ...options(entry.scene?.in, dur) });
  }
  const loop = windows?.loop;
  if (loop?.transitionIn?.type === 'dot-wipe' && loop.transitionIn.dur > 0) {
    const dur = round(loop.transitionIn.dur, 6);
    out.push({ id: `lc-dw-${loop.sceneId}-loop`, sceneId: `${loop.sceneId}-loop`, start: round(loop.start, 6), dur, ...options(story?.ending?.in, dur) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The phases of one wipe (absolute seconds): grow until coverEnd, peak until
 * revealStart (the hold, centred on the midpoint where the plates swap),
 * shrink until end.
 */
export function dotWipePhases(wipe) {
  const hold = Math.min(Math.max(0, wipe.hold ?? 0), wipe.dur / 2);
  const coverEnd = wipe.start + (wipe.dur - hold) / 2;
  const revealStart = coverEnd + hold;
  return { start: wipe.start, coverEnd: round(coverEnd, 6), revealStart: round(revealStart, 6), end: round(wipe.start + wipe.dur, 6) };
}

/** The progress (0 → 1 → 0) of one wipe at absolute t; 0 outside it. The dot size is this times the wipe's cover. */
export function dotWipeCover(wipe, t) {
  const p = dotWipePhases(wipe);
  if (t < p.start || t >= p.end) return 0;
  if (t < p.coverEnd) return getEase(DOT_WIPE.coverEase)((t - p.start) / (p.coverEnd - p.start));
  if (t < p.revealStart) return 1;
  return 1 - getEase(DOT_WIPE.revealEase)((t - p.revealStart) / (p.end - p.revealStart));
}

/** The inline style both renderers put on a wipe's element: its peak size. */
export function dotWipePeak(wipe) {
  return round(wipe.cover ?? 1, 4);
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
