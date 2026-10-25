// HyperFrames emitters for the character modules (cast-scene,
// character-cameo). Same shape as catalogue E (emitParts): the module's
// layer, a screen video hoisted to the root with the cast as its overlay,
// one op list for GSAP.
//
// GSAP owns the transform of every element the op list moves (the rig's
// joints): its CSS transform comes off and an equal tl.set at the scene start
// comes first in the op list. GSAP composes translate, rotate and scale in
// transformString's order, so the frames are unchanged, and nothing is left
// for GSAP to overwrite (HyperFrames' gsap_css_transform_conflict lint).
// Remotion keeps the CSS transforms: frameState applies the same ops over them.

import {charactersTimeline, charactersView} from '../core/catalog-characters.mjs';
import {emitParts} from './catalog-e.mjs';

const TRANSFORM_PROPS = new Set(['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY']);

/** transformString() (and the character root's scale(n)) back to GSAP props. */
export function transformProps(transform) {
  const props = {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1};
  const pattern = /(translate|rotate|scale)\(([^)]*)\)/g;
  let rest = String(transform);
  for (const [whole, fn, args] of String(transform).matchAll(pattern)) {
    const values = args.split(',').map(value => Number.parseFloat(value));
    if (values.some(value => !Number.isFinite(value))) throw new Error(`character emitter: unsupported transform ${transform}`);
    if (fn === 'translate') [props.x, props.y = 0] = values;
    else if (fn === 'rotate') props.rotation = values[0];
    else [props.scaleX, props.scaleY = values[0]] = values;
    rest = rest.replace(whole, '');
  }
  if (rest.trim()) throw new Error(`character emitter: unsupported transform ${transform}`);
  return props;
}

/** The view with GSAP-owned transforms taken off, and the tl.set ops that put them back. */
export function gsapOwnedTransforms(view, ops, start) {
  const moved = new Set(ops.filter(op => Object.keys(op.props ?? {...op.from, ...op.to}).some(key => TRANSFORM_PROPS.has(key))).map(op => op.target));
  const sets = [];
  const strip = node => {
    if (!node || typeof node !== 'object') return node;
    let style = node.style;
    if (node.id && moved.has(node.id) && style?.transform) {
      const {transform, ...others} = style;
      style = others;
      sets.push({type: 'set', target: node.id, time: start, props: transformProps(transform)});
    }
    return {...node, ...(style ? {style} : {}), children: (node.children ?? []).map(strip)};
  };
  const out = Object.fromEntries(Object.entries(view).map(([part, node]) => [part, node ? strip(node) : node]));
  return {view: out, ops: [...sets, ...ops]};
}

export function emitCharacters(model) {
  const owned = gsapOwnedTransforms(charactersView(model), charactersTimeline(model), model.start);
  return emitParts(model, owned.view, owned.ops);
}

export const EMITTERS = {
  'cast-scene': emitCharacters,
  'character-cameo': emitCharacters,
};
