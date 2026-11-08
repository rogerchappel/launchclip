// The light-sweep transition: a few soft streaks of light sweep diagonally
// across the frame over the cut, added to the picture (screen blend), while
// the outgoing scene darkens and melts into soft glowing blobs and the
// incoming one rises out of the dark and sharpens. A transition of light, not
// graphics: nothing opaque ever covers the frame.
// Shared by the HyperFrames compiler and the Remotion StoryComposition: both
// draw the same streak markup and CSS, and drive one custom property,
// --lc-ls (the sweep's progress, 0 → 1, linear), so the two renderers draw
// the same frames. Plain ESM; imports only ./dot-wipe.mjs (the brand colour
// rules). Canonical copy: kit/core/light-sweep.mjs. Contract:
// docs/KIT_CONTRACTS.md, "Transitions".
//
//   scene.in = {type: "light-sweep", dur: 0.5, streaks?, angle?, color?}   (track-0 scenes, 0.4–0.6 s)
//
//   streaks  2–4 (default 3)
//   angle    the streaks' tilt from the horizontal, 20–80 degrees (default
//            64: steep, rising to the right); they travel across it, left
//            to right
//   color    "accent" (default) | "ink" | "paper" | "#rrggbb", as the dot-wipe
//
// The layer side (kit/core/transitions.mjs): the outgoing plate takes the
// `veil` (blur, darken, a little contrast) and drifts forward, the incoming
// one fades up from under the same veil.

import { resolveDotWipeColor } from './dot-wipe.mjs';

export const LIGHT_SWEEP = Object.freeze({
  defaults: Object.freeze({ streaks: 3, angle: 64, color: 'accent' }),
  streakRange: Object.freeze([2, 4]),
  angleRange: Object.freeze([20, 80]),
  // Each streak travels its own share of the sweep (span), starting at its
  // offset; the streaks are spaced across the first `stagger` of it. Per
  // streak (cycled): the core's thickness and the halo's (shares of the
  // frame's short side), the peak opacity and where it crosses the frame
  // (a share of the travel either side of the centre line).
  span: 0.78, stagger: 0.16,
  cores: Object.freeze([0.022, 0.018, 0.026, 0.02]),
  halos: Object.freeze([0.14, 0.09, 0.18, 0.11]),
  peaks: Object.freeze([0.95, 0.75, 0.85, 0.65]),
  lanes: Object.freeze([-0.25, 0.35, 0.05, 0.6]),
  // The core's and the halo's softness (px at 1080 on the short side: the
  // core's is its own motion smear, since it moves across its length), the
  // fade at each end of a streak's travel (a share of it), a soft wash of the
  // colour over the whole frame at the middle of the sweep, and how far a
  // streak travels (a share of the frame's diagonal).
  coreBlur: 4, haloBlur: 30, edge: 0.22, wash: 0.1, reach: 0.36,
  // Stacking: as the dot-wipe (over every scene, under the medium, the brand
  // frame and the captions).
  z: Object.freeze({ hyperframes: 79000, remotion: 48 })
});

const round = (value, digits = 3) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const HEX = /^#[0-9a-fA-F]{6}$/;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');

/** A sweep's options from scene.in, defaults filling the gaps (out-of-range values clamped). */
export function lightSweepOptions(spec = {}) {
  const own = spec && typeof spec === 'object' ? spec : {};
  const [slo, shi] = LIGHT_SWEEP.streakRange, [alo, ahi] = LIGHT_SWEEP.angleRange;
  const streaks = Number.isInteger(own.streaks) ? Math.min(shi, Math.max(slo, own.streaks)) : LIGHT_SWEEP.defaults.streaks;
  const angle = typeof own.angle === 'number' && Number.isFinite(own.angle) ? Math.min(ahi, Math.max(alo, own.angle)) : LIGHT_SWEEP.defaults.angle;
  return { streaks, angle, color: own.color ?? LIGHT_SWEEP.defaults.color };
}

/**
 * The streaks of a sweep on a width × height frame: their geometry and the
 * share of the sweep each runs over. → [{offset, span, length, core, halo,
 * peak, lane, travel}] (px, offset and span shares of the sweep)
 */
export function lightSweepStreaks(width, height, { streaks = LIGHT_SWEEP.defaults.streaks } = {}) {
  const short = Math.min(width, height), diagonal = Math.hypot(width, height);
  const n = Math.max(1, streaks);
  return Array.from({ length: n }, (_, i) => {
    const halo = round(short * LIGHT_SWEEP.halos[i % 4], 1);
    return {
      offset: round(n > 1 ? (LIGHT_SWEEP.stagger * i) / (n - 1) : LIGHT_SWEEP.stagger / 2, 4),
      span: LIGHT_SWEEP.span,
      length: Math.ceil(diagonal * 1.25),
      core: round(Math.max(2, short * LIGHT_SWEEP.cores[i % 4]), 1),
      halo,
      peak: LIGHT_SWEEP.peaks[i % 4],
      lane: LIGHT_SWEEP.lanes[i % 4],
      // Across the middle of the frame (a share of the half diagonal either
      // side): slow enough that a sub-frame blur smears it instead of
      // stepping it (about 60 px a frame at 1080 × 1920 over 0.5 s).
      travel: Math.ceil(diagonal * LIGHT_SWEEP.reach / 2)
    };
  });
}

/** The CSS both renderers use (the container, its streaks and the wash). */
export function lightSweepCss(width, height) {
  const k = Math.min(width, height) / 1080;
  return `.lc-light-sweep { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; overflow: hidden; pointer-events: none; mix-blend-mode: screen; }
.lc-light-sweep .lc-ls-wash { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; }
.lc-light-sweep .lc-ls-streak { position: absolute; left: 50%; top: 50%; }
.lc-light-sweep .lc-ls-core { filter: blur(${round(LIGHT_SWEEP.coreBlur * k, 2)}px); }
.lc-light-sweep .lc-ls-halo { filter: blur(${round(LIGHT_SWEEP.haloBlur * k, 2)}px); }`;
}

// A streak's progress (0 → 1 over its own span) from the sweep's, as CSS.
const local = (streak) => `clamp(0, (var(--lc-ls) - ${streak.offset}) / ${streak.span}, 1)`;
// Its opacity: up over the first `edge` of its travel, down over the last.
const envelope = (streak, peak) => `calc(${peak} * min(1, ${local(streak)} / ${LIGHT_SWEEP.edge}, (1 - ${local(streak)}) / ${LIGHT_SWEEP.edge}))`;

/**
 * The markup (a string, both renderers parse the same) for a sweep: per
 * streak a halo and a core, rotated to the angle and moved across it by
 * --lc-ls, over a wash that peaks at the middle.
 */
export function lightSweepHtml(width, height, sweep) {
  const color = HEX.test(sweep.color ?? '') ? sweep.color : '#ffffff';
  const c = rgb(color);
  const angle = -(sweep.angle ?? LIGHT_SWEEP.defaults.angle);
  const wash = `<div class="lc-ls-wash" style="background:radial-gradient(ellipse 80% 60% at 50% 50%, rgba(${c},${LIGHT_SWEEP.wash}), rgba(${c},0) 70%);opacity:calc(min(1, var(--lc-ls) * 2.5, (1 - var(--lc-ls)) * 2.5))"></div>`;
  const parts = lightSweepStreaks(width, height, sweep).map((streak) => {
    // Across the streak: from -travel to +travel, plus its lane.
    const shift = `calc((${local(streak)} * 2 - 1 + ${streak.lane}) * ${streak.travel}px)`;
    const box = (thick, cls, fill, peak) => `<div class="lc-ls-streak ${cls}" style="width:${streak.length}px;height:${thick}px;margin-left:${-streak.length / 2}px;margin-top:${-thick / 2}px;transform:rotate(${angle}deg) translateY(${shift});background:${fill};opacity:${envelope(streak, peak)}"></div>`;
    const halo = box(streak.halo, 'lc-ls-halo', `linear-gradient(to bottom, rgba(${c},0), rgba(${c},0.42) 50%, rgba(${c},0))`, round(streak.peak * 0.8, 3));
    const core = box(streak.core, 'lc-ls-core', `linear-gradient(to bottom, rgba(${c},0), rgba(${c},0.9) 30%, rgba(255,255,255,0.95) 50%, rgba(${c},0.9) 70%, rgba(${c},0))`, streak.peak);
    return `${halo}${core}`;
  });
  return `${wash}${parts.join('')}`;
}

/**
 * The light sweeps of a story: every track-0 window entry (and the loop
 * ending) that arrives with a light-sweep, options resolved.
 * windows: transitions.mjs sceneWindows.
 * → [{id, sceneId, start, dur, color, streaks, angle}]
 */
export function lightSweeps(story, windows) {
  const out = [];
  const add = (id, sceneId, start, dur, spec) => {
    const options = lightSweepOptions(spec);
    out.push({ id, sceneId, start: round(start, 6), dur: round(dur, 6), ...options, color: resolveDotWipeColor(story?.brand, options.color) });
  };
  for (const entry of windows?.scenes ?? []) {
    if (!entry.plate || entry.transitionIn?.type !== 'light-sweep' || !(entry.transitionIn.dur > 0)) continue;
    add(`lc-ls-${entry.id}`, entry.id, entry.start, entry.transitionIn.dur, entry.scene?.in);
  }
  const loop = windows?.loop;
  if (loop?.transitionIn?.type === 'light-sweep' && loop.transitionIn.dur > 0) add(`lc-ls-${loop.sceneId}-loop`, `${loop.sceneId}-loop`, loop.start, loop.transitionIn.dur, story?.ending?.in);
  return out.sort((a, b) => a.start - b.start);
}

/** The sweep's progress (0 → 1, linear) at absolute t; 0 outside it. */
export function lightSweepProgress(sweep, t) {
  if (t < sweep.start || t >= sweep.start + sweep.dur) return 0;
  return round((t - sweep.start) / sweep.dur, 6);
}

/**
 * HyperFrames: the GSAP lines for one sweep on its element (#id): shown at
 * its start, --lc-ls tweened 0 → 1 (linear), hidden at its end.
 */
export function lightSweepGsap(sweep) {
  const sel = JSON.stringify(`#${sweep.id}`);
  const n = (value) => round(value, 6);
  return [
    `tl.set(${sel}, { opacity: 1 }, ${n(sweep.start)});`,
    `tl.fromTo(${sel}, { "--lc-ls": 0 }, { "--lc-ls": 1, duration: ${n(sweep.dur)}, ease: "none", immediateRender: false }, ${n(sweep.start)});`,
    `tl.set(${sel}, { opacity: 0 }, ${n(sweep.start + sweep.dur)});`
  ];
}
