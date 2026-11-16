// Cast silhouettes for the VFX layer's (m) effects (docs/VFX_LAYER_RFC.md §1,
// phase 8): a cue's `mask` names what the effect draws round,
//
//   module      the scene's card (its model rect), in the panel colour
//   cast:<id>   a cast member as drawn at the cue's moment: every shape of its
//               drawing flattened to polygons (characters/bounds.mjs) and
//               scan-filled in its own colours (kit/core/vfx/silhouette.mjs)
//
// and without one, a cast scene's first member, else the module.
import {drawCharacter} from '../characters/styles.mjs';
import {stateJoints} from '../characters/acting.mjs';
import {partShapes, pathOutline, placePoint} from '../characters/bounds.mjs';
import {actorProps} from '../characters/sets.mjs';
import {moduleSilhouette, silhouette} from './silhouette.mjs';

/** A cast member's state at local time t (seconds into its scene): the last that has begun. */
export function stateAt(actor, t) {
  let state = actor.states[0];
  for (const s of actor.states) if ((s.time ?? 0) <= t + 1e-9) state = s;
  return state;
}

// A shape's outline in its own coordinates: ellipses as 24-gons, paths sampled, rects as boxes.
function outline(node) {
  const a = node.attrs ?? {};
  if (node.tag === 'ellipse' || node.tag === 'circle') {
    const rx = +(a.rx ?? a.r), ry = +(a.ry ?? a.r);
    return {closed: true, points: Array.from({length: 24}, (_, i) => [+a.cx + rx * Math.cos((i * Math.PI) / 12), +a.cy + ry * Math.sin((i * Math.PI) / 12)])};
  }
  if (node.tag === 'rect') return {closed: true, points: [[+a.x, +a.y], [+a.x + +a.width, +a.y], [+a.x + +a.width, +a.y + +a.height], [+a.x, +a.y + +a.height]]};
  if (node.tag === 'path') return {closed: /z\s*$/i.test(String(a.d).trim()), points: pathOutline(a.d, 8)};
  return {closed: false, points: []};
}

/** A cast member's silhouette at local time t in its scene (model: its cast-scene model). */
export function castSilhouette(actor, t, grid) {
  const state = stateAt(actor, t);
  const drawing = drawCharacter(actor.style, actor.params, actor.colors, {id: 'mask', joints: stateJoints({...state, gaze: null}, actor), expression: state.expression ?? 'neutral', expressions: actor.expressions, props: actorProps(actor), light: actor.light, facing: actor.facing});
  const ox = actor.x + (state.x ?? 0), s = actor.scale;
  const shapes = partShapes(drawing, () => true).filter(({node}) => Number(node.attrs?.opacity ?? 1) >= 0.5).map(({node, matrix}) => {
    const a = node.attrs ?? {}, {closed, points} = outline(node);
    // a gradient fill (url(#…)) takes the skin colour: gradients shade skin and hair
    return {closed: closed || node.tag !== 'path', fill: a.fill ?? '#000000', paint: actor.colors?.skin, stroke: a.stroke, width: Number(a.strokeWidth ?? 0) * s, points: points.map(([px, py]) => placePoint(matrix, px, py)).map(([px, py]) => [ox + px * s, actor.floor + py * s])};
  });
  return silhouette(shapes, {fx: ox, fy: actor.floor, grid, cut: actor.cut});
}


/** The silhouette a masked cue draws round, from its scene's resolved model, on a grid of `grid` px per art pixel. */
export function cueSilhouette(scene, cue, model, grid) {
  const actors = model?.content?.actors ?? [];
  const spec = cue.mask ?? (actors.length ? `cast:${actors[0].id}` : 'module');
  if (spec === 'module') {
    if (!model?.rect) throw new Error(`${scene.id}: vfx mask "module" needs the scene's card, and ${scene.module} has none`);
    return moduleSilhouette(model.rect, grid, model.theme?.panel ?? model.theme?.surface ?? '#222222');
  }
  const id = String(spec).slice('cast:'.length), actor = actors.find(item => item.id === id);
  if (!actor) throw new Error(`${scene.id}: vfx mask ${JSON.stringify(spec)} names no cast member in this scene (${actors.map(item => item.id).join(', ') || 'none'})`);
  const sil = castSilhouette(actor, cue.at - scene.start, grid);
  if (!sil) throw new Error(`${scene.id}: vfx mask ${JSON.stringify(spec)} draws nothing`);
  return sil;
}
