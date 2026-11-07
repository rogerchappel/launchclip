// Story feel: one setting that turns on a set of motion habits together, so
// a storyboard moves like a top faceless animated reel with a single line.
// Plain ESM; imports only ./motion.mjs. Canonical copy: kit/core/feel.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Story feel".
//
//   story.motion.feel = "kinetic"
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
//   - zoom kicks: a punch-in to ×1.15 over 0.12 s on an emphasised word or
//     number, then a spring settle over 0.35 s with 27 % overshoot; explicit
//     ones from camera.kicks, plus automatic ones (kicks: "auto") at most one
//     per `gap` seconds and never during another camera move;
//   - springs: the grammar's entrance and emphasis eases become a spring with
//     `spring` overshoot (motion.mjs springEase), over the base grammar
//     (snappy unless motion.grammar names another), with longer entrances so
//     the spring can settle;
//   - a tuned whip-pan (0.26 s, the expo whip with full directional blur) as
//     the default cut, and the dot-wipe transition for chapter turns.
// Explicit motion.grammar overrides always win over the feel's.
// Footage-led stories (a base recording) keep their own camera: the feel's
// ambient camera and kicks are off there; its grammar still applies.

import { SPRING_OVERSHOOT, springEase } from './motion.mjs';

export const FEEL_NAMES = Object.freeze(['kinetic']);

export const FEELS = Object.freeze({
  kinetic: Object.freeze({
    id: 'kinetic',
    describe: 'Never still: an ambient camera drifts and breathes under every shot, zoom kicks punch the emphasised words, entrances spring with 27% overshoot, cuts whip in 0.26 s and chapters turn with a halftone dot wipe.',
    base: 'snappy',
    ambient: Object.freeze({ scale: Object.freeze([1.015, 1.035]), shift: 0.006, period: Object.freeze([5, 9]) }),
    kicks: Object.freeze({ auto: true, scale: 1.15, gap: 1.5 }),
    spring: SPRING_OVERSHOOT,
    whip: 0.26,
    dotWipe: 0.5
  })
});

// Limits for overrides (story.mjs validateMotion repeats them, import-free).
export const FEEL_LIMITS = Object.freeze({
  scale: Object.freeze([1, 1.08]), shift: Object.freeze([0, 0.02]), period: Object.freeze([2, 20]),
  kickScale: Object.freeze([1.03, 1.4]), gap: Object.freeze([1.1, 10]), spring: Object.freeze([0, 0.6])
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
    if (!isObject(ambient)) errors.push(`${path}.ambient must be false or {scale?, shift?, period?}`);
    else {
      for (const key of Object.keys(ambient)) if (!['scale', 'shift', 'period'].includes(key)) errors.push(`${path}.ambient.${key} is not supported (allowed: scale, shift, period)`);
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
 * → {id, describe, base, ambient: {scale, shift, period} | null,
 *    kicks: {auto, scale, gap}, explicit: [{at, scale?, origin?}],
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
    ambient: ambient ? { scale: [...ambient.scale], shift: ambient.shift, period: [...ambient.period] } : null,
    kicks, explicit, spring: num(own.spring) ? own.spring : preset.spring, whip: preset.whip, dotWipe: preset.dotWipe, camera
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
    // Settled shots never rest: the lively hold (ambient.mjs) and a slow push on recorded media.
    ambient: 'lively',
    hold: { level: 'lively', mediaPush: 0.04 }
  };
}
