// GSAP versus frameState: emitted motion code, run on a real paused GSAP
// timeline, must give the values the shared op list gives at every time.
// Shared by catalog_b and photo_scene (importing a test file reruns its tests).
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import gsap from 'gsap';
import {frameState} from '@launchclip/core/catalog-b-view.mjs';

/** Run emitted GSAP code against a real paused GSAP timeline on plain objects. */
export function gsapHarness(motion) {
  const targets = new Map();
  const target = selector => {
    if (!targets.has(selector)) targets.set(selector, {});
    return targets.get(selector);
  };
  const real = gsap.timeline({paused: true});
  const tl = {
    set: (selector, vars, position) => real.set(target(selector), vars, position),
    fromTo: (selector, from, to, position) => real.fromTo(target(selector), from, to, position),
    to: () => { throw new Error('emitters must use fromTo with explicit from values'); }
  };
  runInNewContext(motion, {tl});
  return {seek: t => { real.seek(t, false); return targets; }, targets};
}
const GSAP_KEYS = {text: 'textContent'};
export function assertMatchesFrameState(ops, motion, times, label = '') {
  const harness = gsapHarness(motion);
  for (const t of times) {
    const objects = harness.seek(t);
    const state = frameState(ops, t);
    for (const [id, props] of state) {
      const object = objects.get(`#${id}`);
      if (!object) continue;
      for (const [key, value] of Object.entries(props)) {
        const actual = object[GSAP_KEYS[key] ?? key];
        if (actual === undefined) continue; // not touched by GSAP yet: the static view holds it
        if (typeof value === 'number') assert.ok(Math.abs(actual - value) < 1e-3, `${label} ${id}.${key} at ${t}: gsap ${actual} vs frameState ${value}`);
        else assert.equal(String(actual), value, `${label} ${id}.${key} at ${t}`);
      }
    }
  }
}
