// The feel camera: a story-level camera that wraps the whole composition
// (every scene, in every camera mode, clip scenes included) under the
// medium, the brand frame and the captions, and gives it the kinetic feel's
// ambient drift and breathing plus its zoom kicks (kit/core/feel.mjs).
// Shared by the HyperFrames compiler (one per-frame tl.set on #lc-feel) and
// the Remotion StoryComposition (the same samples, read per frame), so both
// draw the same frames. Plain ESM; imports only kit/core siblings.
// Canonical copy: kit/core/kinetic.mjs. Contract: docs/KIT_CONTRACTS.md,
// "Story feel".
//
// Model
// - The wrapper's transform is translate(x, y) scale(s) about the canvas
//   centre. Ambient: x and y waves within ±shift of the frame, s a wave
//   between scale[0] and scale[1]; each period lies in period[] seconds and
//   divides the story's duration, so a loop seam matches. scale[0] is the
//   overscan the drift needs, so the edge never shows.
// - Stepped ambient (ambient.mode "step", the snap feel): no wave; the
//   camera rests on a framing for hold[] seconds and moves to the next in
//   `move` seconds on expo.inOut (ambientSteps), so holds are crisp and
//   moves blur. Framings alternate wide and tight within scale[].
// - A kick multiplies the scale about its origin: a punch from 1 to its
//   scale over KICK.punch (power2.out), a spring settle (motion.mjs
//   springEase, 27 % overshoot) towards a rest just above 1, chosen so the
//   overshoot bottoms out at exactly 1 (the edge never shows), then a slow
//   relax to 1. Kicks come from story.camera.kicks and, with kicks.auto,
//   from emphasised narration words and numbers (captions.mjs
//   captionEmphasis: digits, overlay keywords, words named by impact hits)
//   and strong scene hits; at most one per kicks.gap seconds, never while a
//   transition, a camera move or a zoom inside a shot runs.
// - Content-safe (feelSafeArea): the kicks and the ambient compose about
//   different origins, so on their own they can push content out of frame.
//   The plan keeps the story's content area inside the frame: the profile
//   safe zone (layout-check.mjs), widened in a portrait frame to the content
//   margin headlines and top bars use (KICK.contentMargin of the short side,
//   left, right and top), plus KICK.pad of breathing room. A kick is reduced
//   to the largest scale that keeps that area in frame at the ambient's peak
//   during the kick (a warning names an explicit one), and every frame's
//   translate is clamped so the area stays inside, which moves the zoom's
//   origin towards the area rather than cropping it.
// - Every frame is sampled once (feelSamples); the wrapper is clamped so its
//   scaled box always covers the canvas and the content area stays in frame.

import { getEase, springEase } from './motion.mjs';
import { resolveFeel } from './feel.mjs';
import { captionEmphasis } from './captions.mjs';
import { ZOOM } from './zooms.mjs';
import { profileGeometry } from './layout-check.mjs';

// contentMargin and pad are shares of the frame's short side (60 px and 12 px
// at 1080).
export const KICK = Object.freeze({ punch: 0.12, settle: 0.35, relax: 0.6, punchEase: 'power2.out', relaxEase: 'sine.inOut', margin: 0.06, edge: 0.25, contentMargin: 60 / 1080, pad: 12 / 1080 });
// A tl.set at t − LEAD lands on frame t whichever way the timeline is sought.
export const FEEL_LEAD = 0.0005;
export const FEEL_SELECTOR = '#lc-feel';

const EPS = 1e-9;
const round = (value, digits = 4) => { const f = 10 ** digits; return Math.round(value * f) / f + 0; };
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const num = (value) => typeof value === 'number' && Number.isFinite(value);
const STRONG_HIT = /emphasis|lockup|hit|reveal|stamp|headline|number|count|land|impact/;
const STRONG_CUE = /impact|subdrop|riser|whoosh|hit|pop/;

/** A period in [lo, hi] that divides the duration (as close to `target` as it can). */
export function dividingPeriod(duration, target, [lo, hi]) {
  if (!(duration > 0)) return target;
  let n = Math.max(1, Math.round(duration / target));
  const fewest = Math.max(1, Math.ceil(duration / hi - EPS)), most = Math.floor(duration / lo + EPS);
  if (fewest <= most) n = Math.min(most, Math.max(fewest, n));
  return round(duration / n, 6);
}

/**
 * The ambient camera for a frame and duration: waves (mode drift) →
 * {x, y, s: {amp, period, phase, mid?}}, or steps (mode step, ambientSteps).
 */
export function ambientWaves(ambient, { width, height, duration }) {
  if (ambient.mode === 'step') return ambientSteps(ambient, { width, height, duration });
  const [lo, hi] = ambient.period;
  return {
    x: { amp: round(ambient.shift * width, 4), period: dividingPeriod(duration, (lo + hi) / 2, ambient.period), phase: 0 },
    y: { amp: round(ambient.shift * height, 4), period: dividingPeriod(duration, lo + (hi - lo) * 0.25, ambient.period), phase: round(Math.PI / 2, 6) },
    s: { mid: round((ambient.scale[0] + ambient.scale[1]) / 2, 6), amp: round((ambient.scale[1] - ambient.scale[0]) / 2, 6), period: dividingPeriod(duration, hi, ambient.period), phase: round(Math.PI / 4, 6) }
  };
}

const wave = (axis, t) => axis.amp * Math.sin((2 * Math.PI * t) / axis.period + axis.phase);

// A fixed-seed generator (mulberry32), so a story's steps never change between renders.
function stepRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stepped ambient camera (ambient.mode "step"): it rests on a framing for
 * hold[] seconds, then moves to the next in `move` seconds on expo.inOut.
 * Framings alternate between the wide and tight halves of scale[] and
 * between sides of ±shift, so every move travels far enough to blur and no
 * two holds look alike. → {mode: 'step', move, poses: [{at, x, y, s}]}: pose
 * k holds from poses[k].at to poses[k + 1].at − move, then moves.
 */
export function ambientSteps(ambient, { width, height, duration }) {
  const random = stepRandom(0x5eed + Math.round(duration * 1000));
  const [lo, hi] = ambient.scale, [h0, h1] = ambient.hold;
  const move = ambient.move;
  const poses = [];
  for (let k = 0, at = 0; at < duration + h1 + move; k += 1) {
    const tight = k % 2 === 1;
    const share = tight ? 0.6 + 0.4 * random() : 0.35 * random();
    const side = (n) => (n % 2 ? 1 : -1) * (0.45 + 0.55 * random());
    const scale = round(lo + (hi - lo) * share, 6);
    // Each framing's translate stays inside its own overscan, so the edge never shows.
    const reach = (size, amount) => Math.min(amount, 0.9 * ((scale - 1) * size) / 2);
    poses.push({ at: round(at, 6), x: round(side(k) * reach(width, ambient.shift * width), 3), y: round(side(Math.floor(k / 2) + k) * reach(height, ambient.shift * height * 0.6), 3), s: scale });
    at += h0 + (h1 - h0) * random() + move;
  }
  return { mode: 'step', move, poses };
}

// The ambient camera at t → {x, y, s}.
function ambientAt(ambient, t) {
  if (!ambient) return { x: 0, y: 0, s: 1 };
  if (ambient.mode !== 'step') return { x: wave(ambient.x, t), y: wave(ambient.y, t), s: ambient.s.mid + wave(ambient.s, t) };
  const { poses, move } = ambient;
  let k = poses.length - 1;
  while (k > 0 && poses[k].at > t + EPS) k -= 1;
  const next = poses[k + 1];
  const start = next ? next.at - move : Infinity;
  if (!next || t < start) return { x: poses[k].x, y: poses[k].y, s: poses[k].s };
  const u = getEase('expo.inOut')(Math.min(1, (t - start) / move));
  const a = poses[k];
  return { x: a.x + (next.x - a.x) * u, y: a.y + (next.y - a.y) * u, s: a.s + (next.s - a.s) * u };
}

/**
 * Spans no kick may overlap (absolute seconds, padded by KICK.margin):
 * every track-0 transition in (from its scene's start, never before: a
 * transition does not pre-roll), the loop ending, the camera plan's moves
 * and every zoom inside a shot. A kick occupies [at, at + punch + settle],
 * so one starting up to 0.47 s (0.32 s with snap) before a span is refused
 * too. → [{start, end, why}]
 */
export function feelBusy(story, windows, camera = null) {
  const out = [];
  const add = (start, end, why) => { if (num(start) && num(end) && end > start) out.push({ start: round(start - KICK.margin, 6), end: round(end + KICK.margin, 6), why }); };
  for (const entry of windows?.scenes ?? []) {
    if (entry.plate && entry.transitionIn && entry.transitionIn.type !== 'cut' && entry.transitionIn.dur > 0) add(entry.start, entry.start + entry.transitionIn.dur, `${entry.id} ${entry.transitionIn.type}`);
    if (!entry.plate || !Array.isArray(entry.scene?.zooms)) continue;
    const zooms = entry.scene.zooms.filter((zoom) => num(zoom?.at));
    zooms.forEach((zoom, i) => {
      add(zoom.at, zoom.at + ZOOM.move.max, `${entry.id} zoom`);
      if (num(zoom.until)) add(zoom.until, zoom.until + ZOOM.move.max, `${entry.id} zoom out`);
      else if (i === zooms.length - 1) add(entry.end - ZOOM.move.max, entry.end, `${entry.id} zoom out`);
    });
  }
  if (windows?.loop?.transitionIn && windows.loop.transitionIn.type !== 'cut') add(windows.loop.start, windows.loop.end, 'loop ending');
  for (const move of camera?.moves ?? []) add(move.start, move.start + move.duration, `camera ${move.type}`);
  return out.sort((a, b) => a.start - b.start);
}

const flatWords = (words) => (Array.isArray(words) ? words : []).flatMap((item) => (Array.isArray(item?.words) ? item.words : [item]))
  .map((word) => ({ text: String(word?.text ?? word?.word ?? ''), start: Number(word?.start) }))
  .filter((word) => word.text && num(word.start));
const normToken = (text) => String(text ?? '').toLowerCase().replace(/#\d+$/, '').replace(/[^\p{L}\p{N}-]+/gu, '');

/**
 * The kicks of a story. feel: resolveFeel(story); busy: feelBusy; words:
 * narration words or caption chunks (both renderers pass the same caption
 * chunks). Explicit kicks first (dropped with a warning when they fall in a
 * busy span or too close to another), then automatic ones.
 * → {kicks: [{at, scale, origin: {x, y} (px), source}], warnings}
 */
export function feelKicks(story, feel, { busy = [], words = [] } = {}) {
  const width = Number(story.format.width), height = Number(story.format.height);
  const duration = Number(story?.resolved?.duration ?? story.format.duration);
  const timing = kickTiming(feel);
  const span = timing.punch + timing.settle;
  const warnings = [], kicks = [];
  const blocked = (at) => busy.find((window) => at < window.end - EPS && at + span > window.start + EPS);
  const crowded = (at) => kicks.some((kick) => Math.abs(kick.at - at) < feel.kicks.gap - EPS);
  const inside = (at) => at >= KICK.edge - EPS && at + span <= duration - 0.05 + EPS;
  const origin = (value) => ({ x: round((isObject(value) && num(value.x) ? value.x : 0.5) * width, 3), y: round((isObject(value) && num(value.y) ? value.y : 0.5) * height, 3) });
  const explicit = feel.explicit.map((kick, index) => ({ kick, index })).filter(({ kick }) => num(Number(kick?.at)) && typeof kick.at !== 'string').sort((a, b) => a.kick.at - b.kick.at || a.index - b.index);
  for (const { kick, index } of feel.explicit.map((k, i) => ({ kick: k, index: i }))) if (typeof kick?.at === 'string') warnings.push(`camera.kicks[${index}] skipped: its at "${kick.at}" was not resolved (run resolveStory with the narration)`);
  for (const { kick, index } of explicit) {
    const at = round(Number(kick.at), 6);
    const busyWith = blocked(at);
    if (!inside(at)) { warnings.push(`camera.kicks[${index}] skipped: at ${at}s leaves no room for the kick inside the story`); continue; }
    // A kick runs from at for its punch and settle: one that starts before a busy span still overlaps it.
    if (busyWith) { warnings.push(`camera.kicks[${index}] skipped: at ${at}s its punch and settle (${at}–${round(at + span, 3)}s) would overlap ${busyWith.why} (${busyWith.start}–${busyWith.end}s, the move ±${KICK.margin}s); start it by ${round(busyWith.start - span, 3)}s or after ${busyWith.end}s`); continue; }
    if (crowded(at)) { warnings.push(`camera.kicks[${index}] skipped: at ${at}s it is within ${feel.kicks.gap}s of another kick`); continue; }
    kicks.push({ at, scale: num(kick.scale) ? kick.scale : feel.kicks.scale, origin: origin(kick.origin), source: `camera.kicks[${index}]` });
  }
  if (feel.kicks.auto) {
    const candidates = [];
    const emphasis = captionEmphasis(story);
    for (const word of flatWords(words)) if (emphasis.has(normToken(word.text)) || /\d/.test(word.text)) candidates.push({ at: word.start, source: `word "${word.text}"` });
    for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
      for (const hit of Array.isArray(scene?.hits) ? scene.hits : []) {
        if (!num(hit?.at)) continue;
        if (STRONG_HIT.test(String(hit.event ?? '')) || STRONG_CUE.test(String(hit.cue ?? ''))) candidates.push({ at: hit.at, source: `${scene.id} hit ${hit.event}` });
      }
    }
    candidates.sort((a, b) => a.at - b.at || a.source.localeCompare(b.source));
    for (const candidate of candidates) {
      const at = round(candidate.at, 6);
      if (!inside(at) || blocked(at) || crowded(at)) continue;
      kicks.push({ at, scale: feel.kicks.scale, origin: origin(null), source: candidate.source });
    }
  }
  kicks.sort((a, b) => a.at - b.at);
  return { kicks, warnings };
}

/**
 * The content area the feel camera keeps in frame, padded by KICK.pad:
 * {left, top, right, bottom} in canvas px, and maxScale, the largest wrapper
 * scale that can keep it inside the canvas (with the translate free).
 * Portrait: the Shorts safe zone widened to KICK.contentMargin on the left,
 * right and top (where headlines and top bars sit; the bottom stays the safe
 * zone's, the caption band is drawn outside the wrapper). Landscape: the
 * title-safe zone.
 */
export function feelSafeArea({ width, height }) {
  const geometry = profileGeometry({ width, height });
  const zone = geometry.safeZone, short = Math.min(width, height);
  const m = KICK.contentMargin * short, pad = KICK.pad * short;
  const portrait = height > width;
  let left = zone.x, top = zone.y, right = zone.x + zone.width, bottom = zone.y + zone.height;
  if (portrait) { left = Math.min(left, m); right = Math.max(right, width - m); top = Math.min(top, m); }
  left = Math.max(0, left - pad); top = Math.max(0, top - pad); right = Math.min(width, right + pad); bottom = Math.min(height, bottom + pad);
  const maxScale = Math.min(width / (right - left), height / (bottom - top));
  return { left: round(left, 3), top: round(top, 3), right: round(right, 3), bottom: round(bottom, 3), maxScale: round(Math.floor(maxScale * 1e6) / 1e6, 6) };
}

// The ambient scale at t (1 without one).
const ambientScale = (ambient, t) => ambientAt(ambient, t).s;

/**
 * Kicks reduced so the content area stays in frame: each kick's peak times
 * the ambient's largest scale over the kick stays at or under
 * area.maxScale. → {kicks, warnings} (a warning per explicit kick reduced,
 * and one for the feel's kicks.scale when the story set it)
 */
export function contentSafeKicks(kicks, { ambient, area, fps = 30, story = null, timing = KICK } = {}) {
  const warnings = [];
  let autoReduced = null;
  const out = kicks.map((kick) => {
    let peak = 1;
    const span = timing.punch + timing.settle;
    for (let i = 0; i <= Math.ceil(span * fps); i += 1) peak = Math.max(peak, ambientScale(ambient, kick.at + i / fps));
    const most = Math.floor((area.maxScale / peak) * 1e4) / 1e4;
    if (kick.scale <= most + EPS) return kick;
    const scale = Math.max(1, most);
    if (kick.source.startsWith('camera.kicks[')) warnings.push(`${kick.source} at ${kick.at}s reduced from ${kick.scale} to ${scale}: a bigger kick (with the ambient camera at ×${round(peak, 3)}) would push the content area out of frame`);
    else autoReduced = autoReduced ? { ...autoReduced, count: autoReduced.count + 1, to: Math.min(autoReduced.to, scale) } : { from: kick.scale, to: scale, count: 1 };
    return { ...kick, scale, requested: kick.scale };
  });
  const own = story?.motion?.feel?.kicks;
  if (autoReduced && isObject(own) && num(own.scale)) warnings.push(`motion.feel.kicks.scale ${autoReduced.from} reduced to as low as ${autoReduced.to} on ${autoReduced.count} automatic kick(s): a bigger kick would push the content area out of frame`);
  return { kicks: out.filter((kick) => kick.scale > 1 + EPS), warnings };
}

/** The rest a kick settles to, so the spring's overshoot bottoms out at exactly 1. */
export function kickRest(scale, overshoot) {
  return round((1 + overshoot * scale) / (1 + overshoot), 6);
}

/** A feel's kick timing: KICK with the preset's own punch, settle and relax over it. */
export function kickTiming(feel) {
  return feel?.kick ? { ...KICK, ...feel.kick } : KICK;
}

/** One kick's scale multiplier at absolute t (1 outside it); timing defaults to KICK. */
export function kickValue(kick, t, overshoot, timing = KICK) {
  const u = t - kick.at;
  if (u < 0) return 1;
  const S = kick.scale, R = kickRest(S, overshoot);
  if (u < timing.punch) return 1 + (S - 1) * getEase(timing.punchEase)(u / timing.punch);
  if (u < timing.punch + timing.settle) return S + (R - S) * getEase(springEase(overshoot))((u - timing.punch) / timing.settle);
  const relax = u - timing.punch - timing.settle;
  if (relax < timing.relax) return R + (1 - R) * getEase(timing.relaxEase)(relax / timing.relax);
  return 1;
}

/**
 * The feel camera plan for a resolved story, or null when it has nothing to
 * do (no feel, a base recording owns the camera, or no ambient and no kick).
 * windows: transitions.mjs sceneWindows (riders joined or not); camera:
 * camera-world.mjs cameraPlan (null without a world camera); words: caption
 * chunks or narration words for automatic kicks.
 * → {width, height, fps, duration, frames, feel: id, ambient: waves | null,
 *    spring, kicks, busy, warnings}
 */
export function feelPlan(story, { windows, camera = null, words = [] } = {}) {
  const feel = resolveFeel(story);
  if (!feel || !feel.camera) return null;
  const width = Number(story.format.width), height = Number(story.format.height);
  const fps = Number(story?.resolved?.fps ?? story.format.fps ?? 30);
  const duration = Number(story?.resolved?.duration ?? story.format.duration);
  const frames = Number(story?.resolved?.frames ?? Math.round(duration * fps));
  // World mode keeps its own drift (camera-world.mjs); kicks still apply.
  const ambient = feel.ambient && !camera?.drift ? ambientWaves(feel.ambient, { width, height, duration }) : null;
  const busy = feelBusy(story, windows, camera);
  const found = feelKicks(story, feel, { busy, words });
  const safe = feelSafeArea({ width, height });
  const timing = kickTiming(feel);
  const reduced = contentSafeKicks(found.kicks, { ambient, area: safe, fps, story, timing });
  const kicks = reduced.kicks, warnings = [...found.warnings, ...reduced.warnings];
  if (!ambient && !kicks.length) return warnings.length ? { width, height, fps, duration, frames, feel: feel.id, ambient: null, spring: feel.spring, kicks: [], busy, safe, warnings, idle: true } : null;
  return { width, height, fps, duration, frames, feel: feel.id, ambient, spring: feel.spring, kicks, ...(feel.kick ? { timing } : {}), busy, safe, warnings };
}

// The translate range on one axis that keeps the canvas covered (|v| ≤
// (s − 1)·size/2) and, with a content area [lo, hi], keeps the area inside
// [0, size]: lo maps to c + (lo − c)·s + v ≥ 0, hi to c + (hi − c)·s + v ≤ size.
function axisRange(s, size, lo, hi) {
  const c = size / 2, edge = (s - 1) * c;
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) return [-edge, edge];
  const a = Math.max(-edge, (c - lo) * s - c), b = Math.min(edge, size - c - (hi - c) * s);
  return a <= b ? [a, b] : [(a + b) / 2, (a + b) / 2];
}

/**
 * The wrapper's transform at absolute t: {x, y, scale} (translate in px,
 * then scale about the canvas centre). Clamped so the scaled box covers the
 * canvas (scale ≥ 1 and |x| ≤ (scale − 1)·W/2, y likewise) and, with
 * plan.safe, so the content area stays in frame (scale ≤ safe.maxScale and
 * the translate inside axisRange).
 */
export function feelStateAt(plan, t) {
  if (!plan || plan.idle) return { x: 0, y: 0, scale: 1 };
  const W = plan.width, H = plan.height;
  let dx = 0, dy = 0, a = 1;
  if (plan.ambient) ({ x: dx, y: dy, s: a } = ambientAt(plan.ambient, t));
  let scale = a, x = dx, y = dy;
  const kick = [...plan.kicks].reverse().find((entry) => t >= entry.at - EPS);
  if (kick) {
    const k = kickValue(kick, t, plan.spring, plan.timing ?? KICK);
    scale = a * k;
    x = dx + a * (1 - k) * (kick.origin.x - W / 2);
    y = dy + a * (1 - k) * (kick.origin.y - H / 2);
  }
  scale = Math.max(1, scale);
  const safe = plan.safe;
  if (safe) scale = Math.min(scale, Math.max(1, safe.maxScale));
  const [x0, x1] = axisRange(scale, W, safe?.left, safe?.right), [y0, y1] = axisRange(scale, H, safe?.top, safe?.bottom);
  return { x: round(Math.min(x1, Math.max(x0, x)), 3), y: round(Math.min(y1, Math.max(y0, y)), 3), scale: round(scale, 6) };
}

/** Every frame's wrapper state, frame 0 to frames − 1 → [{x, y, scale}]. */
export function feelSamples(plan) {
  if (!plan) return [];
  return Array.from({ length: Math.max(1, plan.frames) }, (_, f) => feelStateAt(plan, f / plan.fps));
}

/** Whether the wrapper's box covers the canvas for a state (the edge never shows). */
export function feelCovers(state, { width, height }) {
  const tol = 1e-6;
  return state.scale >= 1 - tol && Math.abs(state.x) <= ((state.scale - 1) * width) / 2 + tol && Math.abs(state.y) <= ((state.scale - 1) * height) / 2 + tol;
}

/** A state → the CSS transform both renderers use (transform-origin 50% 50%). */
export function feelTransform(state) {
  return `translate(${round(state.x, 3)}px, ${round(state.y, 3)}px) scale(${round(state.scale, 6)})`;
}

/**
 * HyperFrames: the GSAP code that plays the samples on #lc-feel: one tl.set
 * per frame whose state changed, from a compact table. → [line]
 */
export function feelGsap(plan, samples = feelSamples(plan)) {
  if (!plan || plan.idle || !samples.length) return [];
  const rows = [];
  let last = null;
  samples.forEach((state, f) => {
    if (last && last.x === state.x && last.y === state.y && last.scale === state.scale) return;
    rows.push([f, state.x, state.y, state.scale]);
    last = state;
  });
  return [
    `// story feel (${plan.feel}): ${plan.ambient ? (plan.ambient.mode === 'step' ? `ambient holds and snaps (${plan.ambient.poses.length} framings)` : 'ambient drift and breathing') : 'no ambient'}, ${plan.kicks.length} kick(s) at ${plan.kicks.map((kick) => kick.at).join(', ') || '-'}`,
    `(function () { var F = ${JSON.stringify(rows)}; for (var i = 0; i < F.length; i++) { var f = F[i][0]; tl.set(${JSON.stringify(FEEL_SELECTOR)}, { x: F[i][1], y: F[i][2], scale: F[i][3], force3D: false }, f === 0 ? 0 : Math.max(0, f / ${plan.fps} - ${FEEL_LEAD})); } })();`
  ];
}
