// The light-sweep transition: the whole frame dips nearly to black over the
// cut while a few thin, crisp streaks of light cut diagonally across it and
// soft bokeh discs drift through the dark, added to the picture (screen
// blend); the outgoing scene darkens and melts into soft glowing blobs and
// the incoming one rises out of the dark and sharpens. A transition of
// light, not graphics: the dip is a translucent shade (never fully black)
// and nothing opaque covers the frame.
// Shared by the HyperFrames compiler and the Remotion StoryComposition: both
// draw the same dip, streak and bokeh markup and CSS, and drive one custom
// property, --lc-ls (the sweep's progress, 0 → 1, linear), on both of a
// sweep's layers (the dip, then the light over it), so the two renderers
// draw the same frames. Plain ESM; imports only ./dot-wipe.mjs (the brand colour
// rules). Canonical copy: kit/core/light-sweep.mjs. Contract:
// docs/KIT_CONTRACTS.md, "Transitions".
//
//   scene.in = {type: "light-sweep", dur: 0.5, streaks?, angle?, color?}   (track-0 scenes, 0.4–0.6 s)
//
//   streaks  2–4 (default 3)
//   angle    the streaks' tilt from the horizontal, 20–80 degrees (default
//            64: steep, rising to the right); each one shoots along its own
//            line, bottom left to top right, drifting slowly across it
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
  // frame's short side: a crisp line of about 5 px at 1080 in a narrow
  // glow), the peak opacity and where it crosses the frame (a share of the
  // travel either side of the centre line).
  span: 0.84, stagger: 0.14,
  cores: Object.freeze([0.005, 0.0038, 0.006, 0.0042]),
  halos: Object.freeze([0.026, 0.018, 0.032, 0.022]),
  peaks: Object.freeze([1, 0.88, 0.95, 0.8]),
  lanes: Object.freeze([-0.3, 0.38, 0.05, 0.62]),
  // The core's and the halo's softness (px at 1080 on the short side: the
  // core stays crisp), the fade at each end of a streak's travel (a share of
  // it), a faint wash of the colour over the whole frame at the middle of the
  // sweep, the streak's length and how far it shoots along its own line
  // (shares of the frame's diagonal: fast, but along the line, so the
  // sub-frame blur only lengthens it), its lanes' spacing across the frame
  // and how far it drifts across (a share of the diagonal: slow, about 6 px a
  // frame, so the heavy sub-frame blur never steps a thin line into
  // parallel copies).
  coreBlur: 1, haloBlur: 12, edge: 0.18, wash: 0.02, long: 0.85, run: 0.9, spacing: 0.2, reach: 0.05,
  // The dip: a black shade over every scene and the background (under the
  // light), up to `peak` by `down` of the sweep, held, and gone from `up` to
  // the end. With the plates' own veil the frame falls to about a tenth of its
  // light at the middle.
  dip: Object.freeze({ peak: 0.94, down: 0.28, up: 0.66 }),
  // Bokeh: soft discs drifting up through the dark where the interface was,
  // as its bright parts defocus: one on each spot the outgoing scene gives
  // (its interface elements), the rest seeded across the middle band. Their
  // count, size (a share of the short side), the band they sit in (shares of
  // the height), how far they drift (a share of the short side) and when
  // they show (shares of the sweep: in from `from`, gone by `to`, staggered
  // by `spread`) and how bright they peak.
  bokeh: Object.freeze({ count: 12, size: Object.freeze([0.01, 0.045]), band: Object.freeze([0.2, 0.74]), drift: 0.06, from: 0.12, to: 0.86, spread: 0.16, peak: 0.9 }),
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
 * peak, lane, run, travel}] (px, offset and span shares of the sweep; lane
 * the streak's offset across the frame in px)
 */
export function lightSweepStreaks(width, height, { streaks = LIGHT_SWEEP.defaults.streaks } = {}) {
  const short = Math.min(width, height), diagonal = Math.hypot(width, height);
  const n = Math.max(1, streaks);
  return Array.from({ length: n }, (_, i) => {
    const halo = round(short * LIGHT_SWEEP.halos[i % 4], 1);
    return {
      offset: round(n > 1 ? (LIGHT_SWEEP.stagger * i) / (n - 1) : LIGHT_SWEEP.stagger / 2, 4),
      span: LIGHT_SWEEP.span,
      length: Math.ceil(diagonal * LIGHT_SWEEP.long),
      core: round(Math.max(2, short * LIGHT_SWEEP.cores[i % 4]), 1),
      halo,
      peak: LIGHT_SWEEP.peaks[i % 4],
      lane: round(LIGHT_SWEEP.lanes[i % 4] * diagonal * LIGHT_SWEEP.spacing, 1),
      // Along its line: in from beyond one end of the frame, out past the other.
      run: Math.ceil(diagonal * LIGHT_SWEEP.run),
      // Across it, either side of its lane.
      travel: Math.ceil(diagonal * LIGHT_SWEEP.reach / 2)
    };
  });
}

/** The CSS both renderers use (the dip, the light container, its streaks, bokeh and wash). */
export function lightSweepCss(width, height) {
  const k = Math.min(width, height) / 1080;
  return `.lc-light-sweep-dip { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; pointer-events: none; }
.lc-light-sweep-dip .lc-ls-dip { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; background: #000000; }
.lc-light-sweep { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; overflow: hidden; pointer-events: none; mix-blend-mode: screen; }
.lc-light-sweep .lc-ls-wash { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; }
.lc-light-sweep .lc-ls-streak { position: absolute; left: 50%; top: 50%; }
.lc-light-sweep .lc-ls-bokeh { position: absolute; left: 0; top: 0; border-radius: 50%; filter: blur(${round(2 * k, 2)}px); }
.lc-light-sweep .lc-ls-core { filter: blur(${round(LIGHT_SWEEP.coreBlur * k, 2)}px); }
.lc-light-sweep .lc-ls-halo { filter: blur(${round(LIGHT_SWEEP.haloBlur * k, 2)}px); }`;
}

/** The dip's markup (a string, both renderers parse the same): one black shade whose opacity follows --lc-ls. */
export function lightSweepDipHtml() {
  const { peak, down, up } = LIGHT_SWEEP.dip;
  return `<div class="lc-ls-dip" style="opacity:calc(${peak} * clamp(0, min(var(--lc-ls) / ${down}, (1 - var(--lc-ls)) / ${round(1 - up, 4)}), 1))"></div>`;
}

/** The dip's opacity at progress p (0 → 1), as the CSS computes it. */
export function lightSweepDipAt(p) {
  const { peak, down, up } = LIGHT_SWEEP.dip;
  return round(peak * Math.min(1, Math.max(0, Math.min(p / down, (1 - p) / (1 - up)))), 4);
}

// A deterministic 0–1 hash (no Math.random: frames are a function of t).
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const seedOf = (text) => [...String(text ?? '')].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 9973, 7);

/**
 * The bokeh discs of a sweep on a width × height frame, seeded by its id:
 * where each sits and drifts to, its diameter, colour (a few white-hot, the
 * rest the sweep's colour) and the share of the sweep it shows over.
 * → [{x, y, dx, dy, size, white, from, to, peak}] (px, shares of the sweep)
 */
export function lightSweepBokeh(width, height, sweep = {}) {
  const B = LIGHT_SWEEP.bokeh, short = Math.min(width, height), seed = seedOf(sweep.id) * 0.37;
  const spots = Array.isArray(sweep.spots) ? sweep.spots.slice(0, B.count) : [];
  return Array.from({ length: B.count }, (_, i) => {
    const h = (k) => hash(seed + i * 7 + k);
    const spot = spots[i];
    // On a spot: somewhere inside its box, about as big as its shorter side allows.
    const room = spot ? Math.min(spot.width, spot.height) / short : B.size[1];
    const size = round(short * Math.min(room, B.size[0] + (B.size[1] - B.size[0]) * (spot ? 0.4 + 0.6 * h(1) : h(1) * h(1))), 1);
    const from = round(B.from + B.spread * h(5), 4);
    const x = spot ? spot.x + spot.width * (0.2 + 0.6 * h(2)) : width * (0.1 + 0.8 * h(2));
    const y = spot ? spot.y + spot.height * (0.25 + 0.5 * h(3)) : height * (B.band[0] + (B.band[1] - B.band[0]) * h(3));
    return {
      x: round(x, 1), y: round(y, 1),
      dx: round(short * B.drift * (h(4) - 0.5), 1), dy: round(-short * B.drift * (0.4 + 0.6 * h(6)), 1),
      size, white: i % 4 === 1, from, to: round(Math.min(1, B.to + 0.12 * h(7)), 4), peak: round(B.peak * (0.55 + 0.45 * h(8)), 3)
    };
  });
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
  // Each disc: a flat body with a soft rim, moved by --lc-ls along its
  // drift, up over the first third of its window and down over the rest.
  const bokeh = lightSweepBokeh(width, height, sweep).map((disc) => {
    const fill = disc.white ? '255,255,255' : c;
    // A white-hot centre in the colour's glow: a point of light out of focus.
    const q = `clamp(0, (var(--lc-ls) - ${disc.from}) / ${round(disc.to - disc.from, 4)}, 1)`;
    return `<div class="lc-ls-bokeh" style="width:${disc.size}px;height:${disc.size}px;margin-left:${round(-disc.size / 2, 1)}px;margin-top:${round(-disc.size / 2, 1)}px;background:radial-gradient(circle closest-side, rgba(255,255,255,0.95) 0%, rgba(${fill},0.85) 34%, rgba(${fill},0.35) 66%, rgba(${fill},0) 100%);transform:translate(calc(${disc.x}px + ${q} * ${disc.dx}px), calc(${disc.y}px + ${q} * ${disc.dy}px));opacity:calc(${disc.peak} * clamp(0, min(${q} * 3, (1 - ${q}) * 1.5), 1))"></div>`;
  });
  const parts = lightSweepStreaks(width, height, sweep).map((streak) => {
    // Along the streak: from -run to +run; across it: its lane, drifting
    // from -travel to +travel.
    const along = `calc((${local(streak)} * 2 - 1) * ${streak.run}px)`;
    const across = `calc(${streak.lane}px + (${local(streak)} * 2 - 1) * ${streak.travel}px)`;
    const box = (thick, cls, fill, peak) => `<div class="lc-ls-streak ${cls}" style="width:${streak.length}px;height:${thick}px;margin-left:${-streak.length / 2}px;margin-top:${-thick / 2}px;transform:rotate(${angle}deg) translate(${along}, ${across});background:${fill};opacity:${envelope(streak, peak)}"></div>`;
    // Bright along the middle of its length, fading out at both ends.
    const halo = box(streak.halo, 'lc-ls-halo', `linear-gradient(to right, rgba(${c},0), rgba(${c},0.5) 35%, rgba(${c},0.5) 65%, rgba(${c},0))`, round(streak.peak * 0.5, 3));
    const core = box(streak.core, 'lc-ls-core', `linear-gradient(to right, rgba(${c},0), rgba(255,255,255,1) 30%, rgba(255,255,255,1) 70%, rgba(${c},0))`, streak.peak);
    return `${halo}${core}`;
  });
  return `${wash}${bokeh.join('')}${parts.join('')}`;
}

/**
 * Where a scene's interface sits (px): the boxes of a ui-scene's top-level
 * elements, largest first, light (bloom, burst) left out; [] for any other
 * module. The bokeh of a sweep out of it sit there.
 */
export function lightSweepSpots(scene, width, height) {
  const elements = scene?.module === 'ui-scene' && Array.isArray(scene?.params?.elements) ? scene.params.elements : [];
  // ui-scene design px: 1080 wide in portrait, 1920 in landscape.
  const unit = width / (width <= height ? 1080 : 1920);
  return elements
    .filter((el) => el && el.kind !== 'bloom' && el.kind !== 'burst' && el.rect && [el.rect.x, el.rect.y, el.rect.width, el.rect.height].every(Number.isFinite))
    .map((el) => ({ x: round(el.rect.x * unit, 1), y: round(el.rect.y * unit, 1), width: round(el.rect.width * unit, 1), height: round(el.rect.height * unit, 1) }))
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

/**
 * The light sweeps of a story: every track-0 window entry (and the loop
 * ending) that arrives with a light-sweep, options resolved, with the spots
 * of the scene it leaves (lightSweepSpots).
 * windows: transitions.mjs sceneWindows.
 * → [{id, sceneId, start, dur, color, streaks, angle, spots}]
 */
export function lightSweeps(story, windows) {
  const out = [];
  const width = story?.format?.width ?? 1080, height = story?.format?.height ?? 1920;
  const plates = (windows?.scenes ?? []).filter((entry) => entry.plate);
  // The plate the sweep leaves: the latest one that ends by its start.
  const leaving = (start) => plates.filter((entry) => entry.end <= start + 1e-6 && entry.start < start - 1e-6).reduce((best, entry) => (!best || entry.end > best.end ? entry : best), null);
  const add = (id, sceneId, start, dur, spec, from) => {
    const options = lightSweepOptions(spec);
    out.push({ id, sceneId, start: round(start, 6), dur: round(dur, 6), ...options, color: resolveDotWipeColor(story?.brand, options.color), spots: lightSweepSpots(from?.scene, width, height) });
  };
  for (const entry of windows?.scenes ?? []) {
    if (!entry.plate || entry.transitionIn?.type !== 'light-sweep' || !(entry.transitionIn.dur > 0)) continue;
    add(`lc-ls-${entry.id}`, entry.id, entry.start, entry.transitionIn.dur, entry.scene?.in, leaving(entry.start));
  }
  const loop = windows?.loop;
  if (loop?.transitionIn?.type === 'light-sweep' && loop.transitionIn.dur > 0) add(`lc-ls-${loop.sceneId}-loop`, `${loop.sceneId}-loop`, loop.start, loop.transitionIn.dur, story?.ending?.in, leaving(loop.start));
  return out.sort((a, b) => a.start - b.start);
}

/** The sweep's progress (0 → 1, linear) at absolute t; 0 outside it. */
export function lightSweepProgress(sweep, t) {
  if (t < sweep.start || t >= sweep.start + sweep.dur) return 0;
  return round((t - sweep.start) / sweep.dur, 6);
}

/**
 * HyperFrames: the GSAP lines for one sweep on its two elements (#id-dip,
 * the shade, and #id, the light): each shown at its start, --lc-ls tweened
 * 0 → 1 (linear), hidden at its end.
 */
export function lightSweepGsap(sweep) {
  const n = (value) => round(value, 6);
  return [`${sweep.id}-dip`, sweep.id].flatMap((id) => {
    const sel = JSON.stringify(`#${id}`);
    return [
      `tl.set(${sel}, { opacity: 1 }, ${n(sweep.start)});`,
      `tl.fromTo(${sel}, { "--lc-ls": 0 }, { "--lc-ls": 1, duration: ${n(sweep.dur)}, ease: "none", immediateRender: false }, ${n(sweep.start)});`,
      `tl.set(${sel}, { opacity: 0 }, ${n(sweep.start + sweep.dur)});`
    ];
  });
}
