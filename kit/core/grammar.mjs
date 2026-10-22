// Motion grammar: one named set of eases, durations, overshoot and stagger that
// every module, transition and camera move draws from, so a story moves with
// one consistent feel ("snappy", "smooth", …) instead of a per-module mix.
// Plain ESM; imports only ./motion.mjs. Canonical copy: kit/core/grammar.mjs.
// Contract: docs/KIT_CONTRACTS.md, "Motion grammar".
//
//   story.motion = {grammar: "snappy"}                       a preset name
//   story.motion = {grammar: {base: "smooth", ease: {enter: "power2.out"}, stagger: 1.4}}
//
// `editorial` is the default and reproduces the eases and durations the kit
// used before grammars existed, exactly: every mapping below returns its input
// unchanged when the grammar's value for a role equals editorial's, so an
// editorial story compiles byte for byte as it did before.
//
// Where a grammar applies (and nothing else changes):
//   - module enter/exit: the model's root enter/exit eases and durations
//     (editorial kinds, catalogue A/B/C), via grammarEase / grammarDuration;
//   - element entrances and emphasis pops inside catalogue modules (".out",
//     back/elastic eases), via grammarEase; ".inOut" content mechanics (chart
//     draws, fills, moves to a target) keep their designed ease, because some
//     modules derive event times from them;
//   - default staggers, via grammarStagger;
//   - typed transitions (kit/core/transitions.mjs) and the world camera
//     (kit/core/camera-world.mjs: grammar.ease.camera, grammar.camera).
// Overshooting eases only ever drive transforms: opacity, blur, colour and
// clip radii get the same family without overshoot (calmEase), so opacity
// never exceeds 1 and blur never goes negative.

import { getEase } from './motion.mjs';

export const GRAMMAR_NAMES = Object.freeze(['editorial', 'snappy', 'smooth', 'playful', 'documentary']);
export const DEFAULT_GRAMMAR = 'editorial';
export const EASE_ROLES = Object.freeze(['enter', 'exit', 'move', 'camera', 'emphasis']);
export const DURATION_ROLES = Object.freeze(['enter', 'exit', 'transition', 'camera']);

const freezeDeep = (value) => {
  if (value && typeof value === 'object') { for (const inner of Object.values(value)) freezeDeep(inner); Object.freeze(value); }
  return value;
};

// overshoot: the peak overshoot (fraction of the travel) of the grammar's
// enter and emphasis eases, measured, so a planner can read it as a number.
// stagger: a multiplier on every module's default stagger (editorial = 1).
// camera: the world-camera style (camera-world.mjs): drift amplitude (px at a
// 1080 px short side), drift period (s), breathing scale amplitude, the ease
// of whip-pans, and whether moves anticipate (the camera ease winds up).
// ambient: the ambient level this grammar suits (a hint for the planner and
// for ambient motion's story default).
export const GRAMMARS = freezeDeep({
  editorial: {
    id: 'editorial', describe: 'Clean product-editorial motion: power3 entrances, quick power2 exits, no overshoot on entrances. The default.',
    ease: { enter: 'power3.out', exit: 'power2.in', move: 'power3.inOut', camera: 'power3.inOut', emphasis: 'back.out(1.7)' },
    duration: { enter: 0.28, exit: 0.22, transition: 0.45, camera: 0.8 },
    overshoot: 0.1, stagger: 1,
    defaultTransition: { cuts: { type: 'push', dur: 0.45, direction: 'up' }, world: { type: 'pan', dur: 0.8 } },
    camera: { style: 'steady', drift: 7, driftPeriod: 11, breathe: 0.004, whip: 'expo.inOut', anticipation: false },
    ambient: 'standard'
  },
  snappy: {
    id: 'snappy', describe: 'Fast and punchy: expo-out entrances, short durations, a slight overshoot on pops, whips and anticipating camera moves.',
    ease: { enter: 'expo.out', exit: 'power3.in', move: 'expo.inOut', camera: 'back.inOut(1.2)', emphasis: 'back.out(1.2)' },
    duration: { enter: 0.2, exit: 0.16, transition: 0.32, camera: 0.55 },
    overshoot: 0.05, stagger: 0.75,
    defaultTransition: { cuts: { type: 'whip-pan', dur: 0.32, direction: 'right' }, world: { type: 'whip-pan', dur: 0.4 } },
    camera: { style: 'snap', drift: 6, driftPeriod: 9, breathe: 0.004, whip: 'expo.inOut', anticipation: true },
    ambient: 'standard'
  },
  smooth: {
    id: 'smooth', describe: 'Calm and fluid: sine and power2 curves, long durations, no overshoot anywhere.',
    ease: { enter: 'power2.out', exit: 'sine.in', move: 'sine.inOut', camera: 'sine.inOut', emphasis: 'power2.out' },
    duration: { enter: 0.5, exit: 0.36, transition: 0.7, camera: 1.1 },
    overshoot: 0, stagger: 1.25,
    defaultTransition: { cuts: { type: 'fade', dur: 0.6 }, world: { type: 'pan', dur: 1.1 } },
    camera: { style: 'glide', drift: 10, driftPeriod: 14, breathe: 0.005, whip: 'sine.inOut', anticipation: false },
    ambient: 'subtle'
  },
  playful: {
    id: 'playful', describe: 'Springy and bouncy: back-out entrances, elastic pops, bigger staggers and a camera that winds up and overshoots.',
    ease: { enter: 'back.out(1.7)', exit: 'back.in(1.4)', move: 'back.inOut(1.4)', camera: 'back.inOut(1.6)', emphasis: 'elastic.out(1, 0.5)' },
    duration: { enter: 0.42, exit: 0.26, transition: 0.5, camera: 0.75 },
    overshoot: 0.2, stagger: 1.6,
    defaultTransition: { cuts: { type: 'pan', dur: 0.5, direction: 'right' }, world: { type: 'pan', dur: 0.75 } },
    camera: { style: 'bounce', drift: 12, driftPeriod: 8, breathe: 0.006, whip: 'back.inOut(1.2)', anticipation: true },
    ambient: 'lively'
  },
  documentary: {
    id: 'documentary', describe: 'Slow and restrained: power1 curves, long holds and gentle moves, nothing that calls attention to itself.',
    ease: { enter: 'power1.out', exit: 'power1.in', move: 'power1.inOut', camera: 'power1.inOut', emphasis: 'power1.out' },
    duration: { enter: 0.6, exit: 0.45, transition: 0.8, camera: 1.3 },
    overshoot: 0, stagger: 1.3,
    defaultTransition: { cuts: { type: 'fade', dur: 0.8 }, world: { type: 'pan', dur: 1.3 } },
    camera: { style: 'drift', drift: 8, driftPeriod: 16, breathe: 0.004, whip: 'power2.inOut', anticipation: false },
    ambient: 'subtle'
  }
});

const EDITORIAL = GRAMMARS.editorial;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const OVERRIDE_KEYS = ['base', 'ease', 'duration', 'overshoot', 'stagger', 'defaultTransition', 'camera', 'ambient'];
const CAMERA_KEYS = ['style', 'drift', 'driftPeriod', 'breathe', 'whip', 'anticipation'];

/**
 * Validation messages for story.motion.grammar (empty = valid): a preset name
 * or {base?, ease?: {role: easeName}, duration?: {role: seconds}, overshoot?,
 * stagger?, camera?: {...}, ambient?}.
 */
export function grammarErrors(value, path = 'motion.grammar') {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return GRAMMAR_NAMES.includes(value) ? [] : [`${path} must be one of ${GRAMMAR_NAMES.join(', ')} or an object {base, ...overrides}`];
  if (!isObject(value)) return [`${path} must be a grammar name or an object {base, ...overrides}`];
  const errors = [];
  for (const key of Object.keys(value)) if (!OVERRIDE_KEYS.includes(key)) errors.push(`${path}.${key} is not supported (allowed: ${OVERRIDE_KEYS.join(', ')})`);
  if (value.base !== undefined && !GRAMMAR_NAMES.includes(value.base)) errors.push(`${path}.base must be one of ${GRAMMAR_NAMES.join(', ')}`);
  if (value.ease !== undefined) {
    if (!isObject(value.ease)) errors.push(`${path}.ease must be an object of role → ease name`);
    else for (const [role, name] of Object.entries(value.ease)) {
      if (!EASE_ROLES.includes(role)) { errors.push(`${path}.ease.${role} is not a role (allowed: ${EASE_ROLES.join(', ')})`); continue; }
      try { if (typeof name !== 'string') throw new Error('not a string'); getEase(name); } catch { errors.push(`${path}.ease.${role} must be a GSAP ease name such as "power3.out"`); }
    }
  }
  if (value.duration !== undefined) {
    if (!isObject(value.duration)) errors.push(`${path}.duration must be an object of role → seconds`);
    else for (const [role, seconds] of Object.entries(value.duration)) {
      if (!DURATION_ROLES.includes(role)) errors.push(`${path}.duration.${role} is not a role (allowed: ${DURATION_ROLES.join(', ')})`);
      else if (!(typeof seconds === 'number' && seconds >= 0.05 && seconds <= 3)) errors.push(`${path}.duration.${role} must be between 0.05 and 3 seconds`);
    }
  }
  if (value.overshoot !== undefined && !(typeof value.overshoot === 'number' && value.overshoot >= 0 && value.overshoot <= 0.5)) errors.push(`${path}.overshoot must be between 0 and 0.5`);
  if (value.stagger !== undefined && !(typeof value.stagger === 'number' && value.stagger >= 0.25 && value.stagger <= 3)) errors.push(`${path}.stagger must be a multiplier between 0.25 and 3`);
  if (value.ambient !== undefined && !['off', 'subtle', 'standard', 'lively'].includes(value.ambient)) errors.push(`${path}.ambient must be off, subtle, standard or lively`);
  if (value.camera !== undefined) {
    if (!isObject(value.camera)) errors.push(`${path}.camera must be an object`);
    else for (const key of Object.keys(value.camera)) if (!CAMERA_KEYS.includes(key)) errors.push(`${path}.camera.${key} is not supported (allowed: ${CAMERA_KEYS.join(', ')})`);
  }
  return errors;
}

/**
 * The story's motion grammar: story.motion.grammar as a preset name, or
 * {base, ...overrides} merged over the base preset (editorial by default).
 * → a plain grammar object {id, base, custom, describe, ease, duration,
 * overshoot, stagger, defaultTransition, camera, ambient}. Throws on an
 * invalid grammar (validateStory reports the same problems first).
 */
export function resolveGrammar(story) {
  const value = story?.motion?.grammar;
  const errors = grammarErrors(value);
  if (errors.length) throw new Error(errors.join('; '));
  const name = typeof value === 'string' ? value : value?.base ?? DEFAULT_GRAMMAR;
  const preset = GRAMMARS[name];
  const own = isObject(value) ? value : {};
  const custom = Object.keys(own).some((key) => key !== 'base');
  return {
    id: name, base: name, custom, describe: preset.describe,
    ease: { ...preset.ease, ...(own.ease ?? {}) },
    duration: { ...preset.duration, ...(own.duration ?? {}) },
    overshoot: own.overshoot ?? preset.overshoot,
    stagger: own.stagger ?? preset.stagger,
    defaultTransition: { cuts: { ...preset.defaultTransition.cuts }, world: { ...preset.defaultTransition.world }, ...(own.defaultTransition ?? {}) },
    camera: { ...preset.camera, ...(own.camera ?? {}) },
    ambient: own.ambient ?? preset.ambient
  };
}

/** True when the grammar moves exactly like editorial (every mapping is the identity). */
export function isEditorialGrammar(grammar) {
  if (!grammar) return true;
  return EASE_ROLES.every((role) => grammar.ease?.[role] === EDITORIAL.ease[role])
    && DURATION_ROLES.every((role) => grammar.duration?.[role] === EDITORIAL.duration[role])
    && (grammar.stagger ?? 1) === EDITORIAL.stagger;
}

// ---------------------------------------------------------------------------
// Ease mapping

const OVERSHOOTING = /^(back|elastic|bounce)\b/;
const KEEP = /^(none|linear|power0|steps)\b/;

/**
 * The role a designed ease plays: "enter" (.out / bare), "exit" (.in), "move"
 * (.inOut), "emphasis" (an overshooting .out: back, elastic, bounce) or null
 * for linear and stepped eases, which are never remapped.
 */
export function easeRole(name) {
  if (name === undefined || name === null) return 'enter';
  if (typeof name !== 'string') return null;
  const key = name.trim();
  if (KEEP.test(key)) return null;
  const type = /\.(inOut|in|out)\b/.exec(key)?.[1] ?? 'out';
  if (type === 'in') return 'exit';
  if (type === 'inOut') return 'move';
  return OVERSHOOTING.test(key) ? 'emphasis' : 'enter';
}

/**
 * The same curve family without overshoot: back/elastic/bounce become power2
 * of the same direction; anything else is returned unchanged.
 */
export function calmEase(name) {
  if (typeof name !== 'string' || !OVERSHOOTING.test(name.trim())) return name;
  const type = /\.(inOut|in|out)\b/.exec(name)?.[1] ?? 'out';
  return `power2.${type}`;
}

const CALM_PROPS = new Set(['opacity', 'blur', 'filter', 'color', 'backgroundColor', 'borderColor', 'iris', 'clipPath', 'strokeDashoffset', 'text', 'textContent', 'autoAlpha']);

/** Whether every animated prop is a transform (x, y, scale, rotation, …), so an overshooting ease is safe. */
export function transformOnly(props) {
  const list = Array.isArray(props) ? props : props && typeof props === 'object' ? Object.keys(props) : [];
  return list.length > 0 && list.every((prop) => !CALM_PROPS.has(prop));
}

/**
 * Map a designed ease through the grammar. The role decides which grammar
 * ease replaces it; when the grammar's ease for that role equals editorial's,
 * the designed ease is kept (so editorial is the identity). `props` (names
 * or a from/to object) that are not all transforms get calmEase().
 * options.roles limits which roles are remapped (default: enter, exit,
 * emphasis; pass ["move", …] to include .inOut eases).
 */
export function grammarEase(grammar, name, { props = null, roles = ['enter', 'exit', 'emphasis'] } = {}) {
  if (!grammar) return name;
  const role = easeRole(name);
  if (!role || !roles.includes(role)) return name;
  const target = grammar.ease?.[role];
  if (!target || target === EDITORIAL.ease[role]) return name;
  return props !== null && !transformOnly(props) ? calmEase(target) : target;
}

/**
 * Scale a designed duration by the grammar's ratio for a role ("enter",
 * "exit", "transition", "camera"), clamped to [min, max]. Editorial (ratio 1)
 * returns the input unchanged.
 */
export function grammarDuration(grammar, role, seconds, { min = 0, max = Infinity } = {}) {
  if (!grammar) return seconds;
  const own = grammar.duration?.[role], base = EDITORIAL.duration[role];
  if (own === undefined || own === base) return seconds;
  return round(Math.min(max, Math.max(min, seconds * (own / base))), 4);
}

/** A default stagger (seconds) scaled by the grammar's stagger multiplier. */
export function grammarStagger(grammar, seconds, { min = 0, max = Infinity } = {}) {
  const factor = grammar?.stagger ?? 1;
  if (factor === 1) return seconds;
  return round(Math.min(max, Math.max(min, seconds * factor)), 4);
}

/**
 * Remap the eases of renderer-neutral tween ops ({type: "tween", ease, from,
 * to, …}, catalogue B/C timelines) or animations ({ease, from, to}, catalogue
 * A) in place through grammarEase. Returns the list.
 */
export function grammarTweens(list, grammar, options = {}) {
  if (!grammar || isEditorialGrammar(grammar)) return list;
  for (const item of list) {
    if (!item || (item.type !== undefined && item.type !== 'tween')) continue;
    item.ease = grammarEase(grammar, item.ease, { ...options, props: item.to ?? item.from ?? null });
  }
  return list;
}

/** Peak overshoot of an ease over [0, 1] (fraction of the travel above 1). */
export function easeOvershoot(name, steps = 2000) {
  const fn = getEase(name);
  let peak = 0;
  for (let i = 0; i <= steps; i += 1) peak = Math.max(peak, fn(i / steps) - 1);
  return round(peak, 4);
}

function round(value, digits = 4) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
