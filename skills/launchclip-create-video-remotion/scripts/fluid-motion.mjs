// Fluid motion: group patterns, idle breath, impact shake and the beat grid,
// written as catalogue B/H ops ({type: 'set' | 'tween', target, …}) so both
// renderers play them with no new runtime (docs/FLUID_MOTION_RFC.md §3, §4,
// §8). Frame-pure: every offset comes from a hash of an id, never a random
// number. Each pattern drives its own wrapper (a member's layout node, its
// `-idle` child, a camera node), so two patterns never tween one prop of one
// target at the same time.
//
// Plain ESM; imports only catalog-b-view.mjs and catalog-b-base.mjs.

import {set, tw} from './catalog-b-view.mjs';
import {r2, rt} from './catalog-b-base.mjs';

/** A stable number in [0, 1) from a string (FNV-1a). */
export function hashUnit(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// Idle amplitude by grammar (RFC §4): bob px and tilt degrees at 1080 px are
// multiplied by this.
export const IDLE_SCALE = Object.freeze({editorial: 1, snappy: 1.2, playful: 1.4, smooth: 0.8, cinematic: 0.7, documentary: 0.5});
export const IDLE = Object.freeze({bob: 10, tilt: 1.8, periodMin: 3.2, periodMax: 4.4});

/** {bob (px), tilt (deg)} for a grammar (a resolved grammar or null) at `unit` (canvas min side / 1080). */
export function idleAmplitude(grammar, unit) {
  const k = IDLE_SCALE[grammar?.id] ?? 1;
  return {bob: r2(IDLE.bob * unit * k), tilt: r2(IDLE.tilt * k)};
}

/**
 * A slow breath on `target` from `from` to `to` (absolute s): sine.inOut
 * half-cycles of y and rotation, each at least 1.6 s (so the motion check
 * reads them as continuous motion, not gestures), offset in phase and period
 * by a hash of the target, returning to rest by `to`.
 */
export function idleOps(ops, target, start, from, to, {bob, tilt}) {
  const seed = hashUnit(target);
  const half = rt((IDLE.periodMin + (IDLE.periodMax - IDLE.periodMin) * seed) / 2);
  set(ops, target, start, {y: 0, rotation: 0});
  if (to - from < half * 2) return;
  const sign = seed < 0.5 ? 1 : -1;
  let t = from, k = 0, prev = {y: 0, rotation: 0};
  while (t + half * 2 <= to + 1e-9) {
    const s = (k % 2 === 0 ? 1 : -1) * sign;
    const next = {y: r2(-bob * s), rotation: r2(tilt * s)};
    tw(ops, target, rt(t), half, 'sine.inOut', prev, next);
    prev = next; t += half; k++;
  }
  tw(ops, target, rt(t), half, 'sine.inOut', prev, {y: 0, rotation: 0});
}

/**
 * Flock (RFC §3): members leave `origin` together and spread to their slots on
 * arcing paths (x and y on different eases), each launched `gap` after the
 * last plus a hashed jitter. members: [{id, x, y (slot centre), rotation?,
 * at (launch time)}]. Returns the landing time per member.
 */
export function flockOps(ops, members, start, origin, {duration = 0.8, from = 0.35} = {}) {
  return members.map(m => {
    const dx = r2(origin.x - m.x), dy = r2(origin.y - m.y), rot = m.rotation ?? 0;
    const spin = r2((hashUnit(m.id) - 0.5) * 40);
    set(ops, m.id, start, {opacity: 0, x: dx, y: dy, scaleX: from, scaleY: from, rotation: spin});
    tw(ops, m.id, m.at, 0.2, 'power1.out', {opacity: 0}, {opacity: 1});
    tw(ops, m.id, m.at, duration, 'power2.out', {x: dx}, {x: 0});
    tw(ops, m.id, m.at, duration, 'power4.out', {y: dy}, {y: 0});
    tw(ops, m.id, m.at, duration, 'power3.out', {scaleX: from, scaleY: from, rotation: spin}, {scaleX: 1, scaleY: 1, rotation: rot});
    return rt(m.at + duration * 0.7);
  });
}

/**
 * Wave (RFC §3): a ripple through settled members, ordered along x, each
 * lifting `amp` px and settling. members: [{id, x}].
 */
export function waveOps(ops, members, at, amp, {span = 0.35} = {}) {
  const xs = members.map(m => m.x), lo = Math.min(...xs), hi = Math.max(...xs);
  for (const m of members) {
    const t = rt(at + (hi > lo ? (m.x - lo) / (hi - lo) : 0) * span);
    tw(ops, m.id, t, 0.16, 'power2.out', {y: 0}, {y: -amp});
    tw(ops, m.id, rt(t + 0.16), 0.5, 'power2.inOut', {y: -amp}, {y: 0});
  }
}

/**
 * Impact shake (RFC §8) on a camera wrapper at `at`: four steps that halve each
 * time and end at rest, 0.06 s each; no step goes further than the one before.
 */
export const SHAKE_STEPS = Object.freeze([[1, -0.6], [-0.5, 0.35], [0.25, -0.15], [0, 0]]);
export function shakeOps(ops, target, at, amp) {
  let prev = {x: 0, y: 0}, t = at;
  for (const [kx, ky] of SHAKE_STEPS) {
    const next = {x: r2(amp * kx), y: r2(amp * ky)};
    tw(ops, target, rt(t), 0.06, 'power1.inOut', prev, next);
    prev = next; t += 0.06;
  }
}

/** The beat grid (RFC §8): {beat (s), snap(t) → the first beat at or after t, counted from `origin`}. */
export function beatGrid(bpm, origin = 0) {
  const beat = 60 / bpm;
  return {beat: rt(beat), snap: t => rt(origin + Math.ceil((t - origin) / beat - 1e-6) * beat)};
}
