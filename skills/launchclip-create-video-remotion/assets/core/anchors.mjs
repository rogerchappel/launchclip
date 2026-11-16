// Anchors (docs/FLUID_MOTION_RFC.md §7): named points a module publishes on
// its plate, each with the time it lands, for other scenes to aim at (a cast
// cue's gaze and point). Any catalogue module publishes them by declaring
//
//   anchors(model) → [{name, element, event}]
//
// on its definition: `element` is an element id in the module's view tree,
// measured at rest (its centre, canvas px), and `event` names the model
// event whose time the anchor carries (absolute seconds).
//
// Imports only sibling kit/core files.

import {indexView} from './shot-states.mjs';

const r2 = value => Math.round(value * 100) / 100;

/**
 * A module's anchors from its view tree (root at model.rect, as
 * catalogHView returns it). → {name: {x, y, width, height, element, time}}
 * (x, y the centre; width, height the element's box at rest). Throws on an element or
 * event the module does not have (a bug in its declaration).
 */
export function publishAnchors(model, tree, declared) {
  const index = indexView(Array.isArray(tree) ? tree : [tree]);
  const out = {};
  for (const {name, element, event} of declared) {
    const entry = index.byId.get(element);
    if (!entry) throw new Error(`anchor "${name}": element "${element}" is not in the ${model.module} view`);
    const time = model.events?.find(item => item.name === event)?.time;
    if (!Number.isFinite(time)) throw new Error(`anchor "${name}": event "${event}" is not in the ${model.module} model`);
    out[name] = {x: r2(entry.ax + (entry.width ?? 0) / 2), y: r2(entry.ay + (entry.height ?? 0) / 2), width: r2(entry.width ?? 0), height: r2(entry.height ?? 0), element, time};
  }
  return out;
}

/** Whether a target names another scene's anchor: {scene, anchor}. */
export const isAnchorTarget = target => Boolean(target) && typeof target === 'object' && typeof target.scene === 'string' && typeof target.anchor === 'string';

/**
 * An anchor target's point and time. anchorsOf(sceneId) → that scene's
 * anchors (throws a message when the scene is missing or publishes none).
 * → {x, y, time}; throws on an unknown anchor.
 */
export function anchorOf(target, anchorsOf) {
  if (typeof anchorsOf !== 'function') throw new Error(`target {scene: "${target.scene}", anchor: "${target.anchor}"} needs the story's scenes (resolve this scene through kit/core/modules.mjs)`);
  const anchors = anchorsOf(target.scene);
  const anchor = anchors[target.anchor];
  if (!anchor) throw new Error(`scene "${target.scene}" has no anchor "${target.anchor}" (anchors: ${Object.keys(anchors).join(', ') || 'none'})`);
  return anchor;
}
