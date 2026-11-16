// Loop (docs/FLUID_MOTION_RFC.md §8): with scene.loop the module's last frame
// equals its first. The root's exit returns to its entrance pose (createBase
// and rootOps), each module fits its idle chains and pulses to the scene, and
// this pass makes every element's exit match its entrance: under the root's
// exit, each element that has moved tweens back to its frame-0 state, landing
// one frame before the end, so the next frame (the first again) follows on.
// Written as ops, so both renderers play it as is.
//
// Plain ESM; imports only catalog-b-view.mjs and catalog-b-base.mjs.

import {frameState, tw} from './catalog-b-view.mjs';
import {rt} from './catalog-b-base.mjs';

// The return eases slow → fast → slow. It runs under the root's exit, so the
// motion check reads it as the exit: no crowding, and no element leaves
// slower than twice its arrival (opacity comes home over its own fade-in).
export const LOOP = Object.freeze({ease: 'power2.inOut'});
const REST = {opacity: 1, scaleX: 1, scaleY: 1};

/** When a looping model's elements start home (its exit): idle chains fit to end here (fluid-motion.mjs idleOps fitTo). Undefined without a loop. */
export const loopHome = model => (model?.loop === true ? model.motion.exitStart : undefined);

/** The last frame a looping model shows (s): its first frame follows. */
export const loopLast = model => rt(model.end - 1 / model.fps);

/**
 * Bring every element home (in place on `ops`): drop element ops that would
 * start once the return has begun, then tween each element from where it is
 * at that moment to where it was on the first frame. The root keeps its own
 * ops.
 */
export function applyLoop(model, ops) {
  const home = loopHome(model), last = loopLast(model), span = rt(last - home);
  const kept = ops.filter(op => op.target === model.id || (op.type === 'set' ? op.time : op.start) < home - 1e-9);
  const first = frameState(kept, model.start), at = frameState(kept, home), end = frameState(kept, last);
  for (const target of new Set([...at.keys(), ...end.keys()])) {
    if (target === model.id) continue;
    const a = at.get(target) ?? {}, z = end.get(target) ?? {}, f = first.get(target) ?? {};
    const from = {}, to = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(z)])) {
      if (typeof (a[key] ?? z[key]) !== 'number') continue;
      const rest = f[key] ?? REST[key] ?? 0, now = a[key] ?? rest;
      // A prop still moving past `home` (a stream, a turn) comes home too, even if it passes through rest there.
      if (Math.abs(now - rest) > 1e-4 || Math.abs((z[key] ?? rest) - rest) > 1e-4) { from[key] = now; to[key] = rest; }
    }
    if ('opacity' in from) {
      const fade = kept.find(op => op.type === 'tween' && op.target === target && (op.from?.opacity ?? 1) < 0.05 && op.to?.opacity > 0.05);
      const d = rt(Math.min(span, fade?.duration ?? span));
      // From wherever a flash still running has taken it by then.
      tw(kept, target, rt(last - d), d, LOOP.ease, {opacity: frameState(kept, rt(last - d)).get(target)?.opacity ?? from.opacity}, {opacity: to.opacity});
      delete from.opacity; delete to.opacity;
    }
    if (Object.keys(from).length) tw(kept, target, home, span, LOOP.ease, from, to);
  }
  ops.splice(0, ops.length, ...kept);
}
