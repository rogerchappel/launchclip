// Story feel: one setting that turns on a set of motion habits together, so
// a storyboard moves like a top faceless animated reel with a single line.
// Plain ESM; imports only ./motion.mjs. Canonical copy: kit/core/feel.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Story feel".
//
//   story.motion.feel = "kinetic" | "snap"
//   story.motion.feel = {preset: "kinetic", ambient?: false | {scale?: [lo, hi],
//                        shift?, period?: [lo, hi]}, kicks?: false | "auto" |
//                        {auto?, scale?, gap?}, spring?: overshoot}
//   story.camera.kicks = [{at, scale?, origin?: {x, y}}]   explicit zoom kicks
//
// What "kinetic" turns on (kit/core/kinetic.mjs draws it, both renderers):
//   - an ambient camera over the whole composition, in every camera mode and
//     over clip scenes: a slow drift (x/y within ±shift of the frame) and a
//     breathing scale between scale[0] and scale[1], periods in period[]
//     seconds, never revealing an edge (scale[0] is the overscan the drift
//     needs). World mode keeps its own drift instead;
//   - zoom kicks: a punch-in to ×1.05 over 0.12 s on an emphasised word or
//     number, then a spring settle over 0.35 s with 27 % overshoot; explicit
//     ones from camera.kicks, plus automatic ones (kicks: "auto") at most one
//     per `gap` seconds and never during another camera move; a kick is
//     reduced when a bigger one would push the content area out of frame;
//   - springs: the grammar's entrance and emphasis eases become a spring with
//     `spring` overshoot (motion.mjs springEase), over the base grammar
//     (snappy unless motion.grammar names another), with longer entrances so
//     the spring can settle;
//   - a tuned whip-pan (0.26 s, the expo whip with full directional blur) as
//     the default cut, and the dot-wipe transition for chapter turns.
// What "snap" turns on: the same, except the ambient camera holds still on a
// framing (ambient.mode "step": hold[] seconds) and snaps to the next in
// `move` seconds, kicks punch and return fast, and held shots get no drift.
// Explicit motion.grammar overrides always win over the feel's.
// Footage-led stories (a base recording) keep their own camera: the feel's
// ambient camera and kicks are off there; its grammar still applies.

import { SPRING_OVERSHOOT, springEase } from './motion.mjs';

export const FEEL_NAMES = Object.freeze(['kinetic', 'snap']);

export const FEELS = Object.freeze({
  kinetic: Object.freeze({
    id: 'kinetic',
    describe: 'Never still: an ambient camera drifts and breathes under every shot, zoom kicks punch the emphasised words, entrances spring with 27% overshoot, cuts whip in 0.26 s and chapters turn with a halftone dot wipe.',
    base: 'snappy',
    // Tuned on a 52 s narrated reel: a livelier breathing than before and
    // kicks small enough that the content area stays in frame at the
    // ambient's peak (kinetic.mjs feelSafeArea: ×1.05 on ×1.045 in 9:16).
    ambient: Object.freeze({ scale: Object.freeze([1.02, 1.045]), shift: 0.009, period: Object.freeze([4, 7]) }),
    kicks: Object.freeze({ auto: true, scale: 1.05, gap: 1.5 }),
    spring: SPRING_OVERSHOOT,
    whip: 0.26,
    dotWipe: 0.5
  }),
  // Hold sharp, then snap: measured on an interface explainer reel, the
  // camera rests (no drift, so a held frame is crisp) for about a third of a
  // second to under a second, then jumps to its next framing in 0.22 s on an
  // expo ease, far enough that the motion blur smears it. A slow creep through
  // the hold (ambient.creep) does not help: it registers as motion on detailed
  // frames first, so the frames left still are the sparse, soft ones. What
  // keeps the reel from reading still is its content (a host, live panels).
  snap: Object.freeze({
    id: 'snap',
    describe: 'Holds sharp, then snaps: the camera rests on a framing for 0.35–0.8 s, then jumps to the next in 0.22 s (expo), kicks punch and return fast, entrances spring, cuts whip in 0.26 s',
    base: 'snappy',
    ambient: Object.freeze({ mode: 'step', scale: Object.freeze([1.012, 1.05]), shift: 0.016, period: Object.freeze([4, 7]), hold: Object.freeze([0.35, 0.8]), move: 0.22, creep: 0 }),
    kicks: Object.freeze({ auto: true, scale: 1.05, gap: 1.5 }),
    kick: Object.freeze({ punch: 0.1, settle: 0.22, relax: 0.2, relaxEase: 'expo.inOut' }),
    spring: SPRING_OVERSHOOT,
    whip: 0.26,
    dotWipe: 0.5,
    hold: 'off'
  })
});

// Limits for overrides (story.mjs validateMotion repeats them, import-free).
export const FEEL_LIMITS = Object.freeze({
  scale: Object.freeze([1, 1.08]), shift: Object.freeze([0, 0.02]), period: Object.freeze([2, 20]),
  kickScale: Object.freeze([1.03, 1.4]), gap: Object.freeze([1.1, 10]), spring: Object.freeze([0, 0.6]),
  hold: Object.freeze([0.2, 4]), move: Object.freeze([0.08, 0.6]), creep: Object.freeze([0, 0.5])
});

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const num = (value) => typeof value === 'number' && Number.isFinite(value);
const inRange = (value, [lo, hi]) => num(value) && value >= lo && value <= hi;
const pair = (value, limits) => Array.isArray(value) && value.length === 2 && value.every((v) => inRange(v, limits)) && value[0] <= value[1];

/** Validation messages for story.motion.feel (empty = valid). */
export function feelErrors(value, path = 'motion.feel') {
  if (value === undefined || value === null || value === false) return [];
  if (typeof value === 'string') return FEEL_NAMES.includes(value) ? [] : [`${path} must be one of ${FEEL_NAMES.join(', ')} or {preset, ...overrides}`];
  if (!isObject(value)) return [`${path} must be a feel name or {preset, ...overrides}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!['preset', 'ambient', 'kicks', 'spring'].includes(key)) errors.push(`${path}.${key} is not supported (allowed: preset, ambient, kicks, spring)`);
  if (value.preset !== undefined && !FEEL_NAMES.includes(value.preset)) errors.push(`${path}.preset must be one of ${FEEL_NAMES.join(', ')}`);
  const ambient = value.ambient;
  if (ambient !== undefined && ambient !== false) {
    if (!isObject(ambient)) errors.push(`${path}.ambient must be false or {mode?, scale?, shift?, period?, hold?, move?, creep?}`);
    else {
      for (const key of Object.keys(ambient)) if (!['mode', 'scale', 'shift', 'period', 'hold', 'move', 'creep'].includes(key)) errors.push(`${path}.ambient.${key} is not supported (allowed: mode, scale, shift, period, hold, move, creep)`);
      if (ambient.mode !== undefined && !['drift', 'step'].includes(ambient.mode)) errors.push(`${path}.ambient.mode must be drift (a slow wave) or step (holds, then snaps)`);
      if (ambient.hold !== undefined && !pair(ambient.hold, FEEL_LIMITS.hold)) errors.push(`${path}.ambient.hold must be [lo, hi] seconds between 0.2 and 4`);
      if (ambient.move !== undefined && !inRange(ambient.move, FEEL_LIMITS.move)) errors.push(`${path}.ambient.move must be seconds between 0.08 and 0.6`);
      if (ambient.creep !== undefined && !inRange(ambient.creep, FEEL_LIMITS.creep)) errors.push(`${path}.ambient.creep must be a share between 0 and 0.5 of each move made slowly during the hold`);
      if (ambient.scale !== undefined && !pair(ambient.scale, FEEL_LIMITS.scale)) errors.push(`${path}.ambient.scale must be [lo, hi] between 1 and 1.08`);
      if (ambient.shift !== undefined && !inRange(ambient.shift, FEEL_LIMITS.shift)) errors.push(`${path}.ambient.shift must be a share of the frame between 0 and 0.02`);
      if (ambient.period !== undefined && !pair(ambient.period, FEEL_LIMITS.period)) errors.push(`${path}.ambient.period must be [lo, hi] seconds between 2 and 20`);
    }
  }
  const kicks = value.kicks;
  if (kicks !== undefined && kicks !== false && kicks !== 'auto') {
    if (!isObject(kicks)) errors.push(`${path}.kicks must be false, "auto" or {auto?, scale?, gap?}`);
    else {
      for (const key of Object.keys(kicks)) if (!['auto', 'scale', 'gap'].includes(key)) errors.push(`${path}.kicks.${key} is not supported (allowed: auto, scale, gap)`);
      if (kicks.auto !== undefined && typeof kicks.auto !== 'boolean') errors.push(`${path}.kicks.auto must be true or false`);
      if (kicks.scale !== undefined && !inRange(kicks.scale, FEEL_LIMITS.kickScale)) errors.push(`${path}.kicks.scale must be between 1.03 and 1.4`);
      if (kicks.gap !== undefined && !inRange(kicks.gap, FEEL_LIMITS.gap)) errors.push(`${path}.kicks.gap must be between 1.1 and 10 seconds (a kick and its relax take about 1.07 s)`);
    }
  }
  if (value.spring !== undefined && !inRange(value.spring, FEEL_LIMITS.spring)) errors.push(`${path}.spring must be an overshoot between 0 and 0.6`);
  return errors;
}

/** Validation messages for story.camera.kicks (empty = valid). Times must be resolved numbers by render time. */
export function kickErrors(value, path = 'camera.kicks') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [`${path} must be an array of {at, scale?, origin?}`];
  const errors = [];
  for (const [i, kick] of value.entries()) {
    const at = `${path}[${i}]`;
    if (!isObject(kick)) { errors.push(`${at} must be {at, scale?, origin?}`); continue; }
    for (const key of Object.keys(kick)) if (!['at', 'scale', 'origin'].includes(key)) errors.push(`${at}.${key} is not supported (allowed: at, scale, origin)`);
    if (!(num(kick.at) && kick.at >= 0) && typeof kick.at !== 'string') errors.push(`${at}.at must be seconds or a narration anchor ("word:…")`);
    if (kick.scale !== undefined && !inRange(kick.scale, FEEL_LIMITS.kickScale)) errors.push(`${at}.scale must be between 1.03 and 1.4`);
    if (kick.origin !== undefined && !(isObject(kick.origin) && inRange(kick.origin.x, [0, 1]) && inRange(kick.origin.y, [0, 1]))) errors.push(`${at}.origin must be {x, y}, shares of the frame between 0 and 1`);
  }
  return errors;
}

/**
 * The story's feel, resolved, or null (no motion.feel and no camera.kicks).
 * → {id, describe, base, ambient: {mode, scale, shift, period, hold?, move?} | null,
 *    kicks: {auto, scale, gap}, kick: {punch, settle, relax, relaxEase} | null
 *    (the preset's own kick timing), explicit: [{at, scale?, origin?}],
 *    spring, whip, dotWipe, camera: false when a base recording owns the camera}
 * Explicit camera.kicks alone turn on kicks with the kinetic defaults and no
 * ambient camera or grammar change.
 */
export function resolveFeel(story) {
  const value = story?.motion?.feel;
  const explicit = Array.isArray(story?.camera?.kicks) ? story.camera.kicks : [];
  const named = value !== undefined && value !== null && value !== false;
  if (!named && !explicit.length) return null;
  const errors = [...feelErrors(value), ...kickErrors(story?.camera?.kicks)];
  if (errors.length) throw new Error(errors.join('; '));
  const own = isObject(value) ? value : {};
  const preset = FEELS[typeof value === 'string' ? value : own.preset ?? 'kinetic'];
  const ambient = !named || own.ambient === false ? null : { ...preset.ambient, ...(isObject(own.ambient) ? own.ambient : {}) };
  const kicksOwn = own.kicks;
  const kicks = kicksOwn === false ? { ...preset.kicks, auto: false } : { ...preset.kicks, ...(isObject(kicksOwn) ? kicksOwn : {}), ...(kicksOwn === 'auto' ? { auto: true } : {}) };
  if (!named) kicks.auto = false;
  const camera = !(story?.lane === 'footage-led' || isObject(story?.base) || typeof story?.base === 'string');
  return {
    id: preset.id, describe: preset.describe, named, base: preset.base,
    ambient: ambient ? { mode: ambient.mode ?? 'drift', scale: [...ambient.scale], shift: ambient.shift, period: [...ambient.period], ...(ambient.mode === 'step' ? { hold: [...(ambient.hold ?? FEELS.snap.ambient.hold)], move: ambient.move ?? FEELS.snap.ambient.move, creep: ambient.creep ?? (preset.ambient.mode === 'step' ? preset.ambient.creep ?? 0 : 0) } : {}) } : null,
    kicks, kick: preset.kick ?? null, explicit, spring: num(own.spring) ? own.spring : preset.spring, whip: preset.whip, dotWipe: preset.dotWipe, camera
  };
}

/**
 * The grammar overrides a named feel lays under story.motion.grammar
 * (grammar.mjs resolveGrammar merges preset < feel < the story's own), or
 * null. Entrances and emphasis spring; entrances get time to settle; whips
 * blur fully.
 */
export function feelGrammar(story) {
  const value = story?.motion?.feel;
  if (value === undefined || value === null || value === false) return null;
  if (feelErrors(value).length) return null;
  const own = isObject(value) ? value : {};
  const preset = FEELS[typeof value === 'string' ? value : own.preset ?? 'kinetic'];
  const spring = springEase(num(own.spring) ? own.spring : preset.spring);
  return {
    base: preset.base,
    ease: { enter: spring, emphasis: spring },
    duration: { enter: 0.42, transition: preset.whip },
    overshoot: num(own.spring) ? own.spring : preset.spring,
    defaultTransition: { cuts: { type: 'whip-pan', dur: preset.whip, direction: 'left' }, world: { type: 'whip-pan', dur: 0.36 } },
    camera: { whip: 'expo.inOut', moveBlur: 0.8 },
    // Settled shots never rest (kinetic): the lively hold (ambient.mjs) and a
    // slow push on recorded media. A feel that holds (snap) keeps holds still.
    ambient: preset.hold ?? 'lively',
    hold: { level: preset.hold ?? 'lively', mediaPush: preset.hold === 'off' ? 0 : 0.04 }
  };
}
