// A rendered world as element trees: one absolutely placed div per layer
// (back, mid, front, fx), each holding a canvas-sized SVG drawn past the
// left and right edges by the overscan. The layer divs carry the depth
// effects as CSS filters (depth of field on the back layer, the cut-paper
// lift for the paper style), which both renderers draw the same way.

import {el} from '../catalog-b-view.mjs';

export const WORLD_LAYERS = Object.freeze(['back', 'mid', 'front', 'fx']);

/** CSS filter for a layer at the world's detail. */
export function layerFilter(world, layer) {
  const d = world.detail;
  const u = Math.min(world.canvas.width, world.canvas.height) / 1080;
  const parts = [];
  if (layer === 'back' && d.dof) parts.push(`blur(${Math.round(d.dof * u * 10) / 10}px)`);
  if (d.paperLift && layer !== 'fx') parts.push(`drop-shadow(0px ${Math.round(6 * u)}px ${Math.round(5 * u)}px rgba(0,0,0,${layer === 'back' ? 0.18 : 0.3}))`);
  if (d.grade && layer === 'fx') return null;
  return parts.length ? parts.join(' ') : null;
}

/** One layer's div: {id}-{layer}, with its SVG (defs first). */
export function layerNode(world, layer, id, extra = {}) {
  const {width: W, height: H} = world.canvas;
  const ov = world.overscan;
  const filter = layerFilter(world, layer);
  const defs = world.defs[layer]?.length ? [el('defs', null, null, world.defs[layer])] : [];
  const svg = el('svg', null, {position: 'absolute', left: -ov, top: 0, overflow: 'visible'}, [...defs, ...world.layers[layer]], {width: W + 2 * ov, height: H, viewBox: `${-ov} 0 ${W + 2 * ov} ${H}`, fill: 'none'});
  // The SVG is drawn past the edges on purpose (overscan for the camera move),
  // so the layer tells layout audits that its overflow is intended.
  return el('div', `${id}-${layer}`, {position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: '50% 50%', ...(filter ? {filter} : {}), ...(layer === 'fx' ? {pointerEvents: 'none'} : {}), ...extra}, [svg], {'data-layout-allow-overflow': 'true'});
}

/** Every layer, back to front. */
export function worldLayerNodes(world, id) {
  return WORLD_LAYERS.map(layer => layerNode(world, layer, id));
}
