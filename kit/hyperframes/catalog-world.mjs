// HyperFrames emitter for the world module. Same shape as the character
// modules (emitParts): one layer tree, one op list for GSAP, which owns the
// layers' camera-move transforms (gsapOwnedTransforms in catalog-b.mjs).

import {worldTimeline, worldView} from '../core/catalog-world.mjs';
import {emitParts} from './catalog-e.mjs';

export function emitWorld(model) {
  return emitParts(model, worldView(model), worldTimeline(model));
}

export const EMITTERS = {
  world: emitWorld,
};
