// Flow across scenes (docs/FLUID_MOTION_RFC.md §6): which scene hands which
// elements to which, and the boundary rects. resolveModule (modules.mjs)
// calls applyFlow on every op-list model; kit/core/carry.mjs then edits the
// model's view and op list.
//
//   scene.carry = {from?: scene id, map: {"<from>-<element>": "<scene>-<element>"}}
//   scene.carry = false                      opt out
//
// The source of a scene is the last earlier scene on its track whose module is
// an op-list module (catalogue B, G or H), with only footage or a gap between,
// so a plate that comes back after a footage cutaway resumes where it left
// off. A carry needs a still plate at the boundary: the scene arrives by a cut
// and the story has no world camera.
//
// Plain ESM; imports kit/core siblings only.

import {MODULES as CATALOG_B, catalogBTimeline, catalogBView} from './catalog-b.mjs';
import {MODULES as CATALOG_G, catalogGTimeline, catalogGView} from './catalog-g.mjs';
import {MODULES as CATALOG_H, catalogHTimeline, catalogHView} from './catalog-h.mjs';
import {ROOT_REST, sameBox, visualBoxes} from './carry.mjs';

const EPS = 1e-3;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const trackOf = scene => scene?.track ?? 0;

/** Whether a module draws from the shared view tree and op list. */
export const isOpListModule = id => Boolean(CATALOG_B[id] || CATALOG_G[id] || CATALOG_H[id]);

/** A model's content children and op list. */
export function opList(model) {
  const [view, timeline] = CATALOG_B[model.module] ? [catalogBView, catalogBTimeline] : CATALOG_G[model.module] ? [catalogGView, catalogGTimeline] : [catalogHView, catalogHTimeline];
  return {children: view(model).children ?? [], ops: timeline(model)};
}

/** The scene a scene's carry comes from (see above), or null. */
export function carrySource(story, scene) {
  const start = Number(scene?.start);
  if (!Number.isFinite(start) || !Array.isArray(story?.scenes)) return null;
  let best = null;
  for (const other of story.scenes) {
    if (other === scene || other?.id === scene.id || trackOf(other) !== trackOf(scene) || !isOpListModule(other?.module)) continue;
    const end = Number(other.end);
    if (!(Number.isFinite(end) && end <= start + EPS && Number(other.start) < start)) continue;
    if (!best || end > Number(best.end)) best = other;
  }
  return best;
}

/** Why a boundary is not a still plate, or null. */
export function stillPlateProblem(story, scene) {
  const type = scene?.in?.type;
  if (scene?.in && type !== 'cut') return `it arrives by a ${type ?? 'typed'} transition; carry needs a cut (no in)`;
  if (story?.camera?.mode === 'world') return 'the story has a world camera, which moves between plates';
  return null;
}

/** The scene's explicit carry: {from, map} or null (validation errors throw). */
function explicitCarry(story, scene) {
  const carry = scene?.carry;
  if (carry === undefined || carry === false || carry === null) return null;
  const where = `scenes ${scene.id}.carry`;
  if (!isObject(carry) || !isObject(carry.map) || !Object.keys(carry.map).length) throw new Error(`${where} must be false or {from?, map: {"<from element id>": "<element id>"}}`);
  if (!isOpListModule(scene.module)) throw new Error(`${where}: ${scene.module} does not draw from an op list (carry works on catalogue B, G and H modules)`);
  const source = carrySource(story, scene);
  if (!source) throw new Error(`${where}: no earlier ${scene.module ? 'op-list ' : ''}scene on track ${trackOf(scene)} to carry from`);
  if (carry.from !== undefined && carry.from !== source.id) throw new Error(`${where}.from must be ${source.id}, the last op-list scene before it on its track (got ${JSON.stringify(carry.from)})`);
  const problem = stillPlateProblem(story, scene);
  if (problem) throw new Error(`${where}: ${problem}`);
  return {from: source, map: {...carry.map}};
}

/** Tag a model with its carry and lift the root's motion off the root. */
function tag(model, {out = null, into = null}) {
  const carry = {...(model.carry ?? {})};
  if (out) { carry.out = out; carry.exitTo = {...model.motion.exitTo}; model.motion.exitTo = {...ROOT_REST}; }
  if (into) { carry.in = into; carry.enterFrom = {...model.motion.enterFrom}; model.motion.enterFrom = {...ROOT_REST}; }
  model.carry = carry;
}

// Boundary rects per story: keyed by the two scenes and what moves them.
const MEMO = new WeakMap();
function memo(story, key, make) {
  let map = MEMO.get(story);
  if (!map) MEMO.set(story, (map = new Map()));
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

/**
 * Tag a resolved op-list model with what its scene hands on and receives.
 * resolveBare(scene) resolves a scene with no carry. Throws on a carry the
 * story cannot play.
 */
export function applyFlow(model, scene, story, resolveBare) {
  if (!isOpListModule(model?.module) || !model.motion) return model;
  const ownCarry = explicitCarry(story, scene);
  // Out: every later scene on the track that carries from this one.
  const outIds = [];
  for (const other of story?.scenes ?? []) {
    if (other === scene || !isObject(other?.carry)) continue;
    if (carrySource(story, other)?.id !== scene.id) continue;
    outIds.push(...Object.keys(other.carry.map ?? {}));
  }
  if (!ownCarry && !outIds.length) return model;
  const outTo = outIds.length ? (story.scenes.find(other => isObject(other?.carry) && carrySource(story, other)?.id === scene.id)?.id ?? null) : null;
  const items = ownCarry ? Object.entries(ownCarry.map).map(([from, id]) => ({id, from})) : [];
  tag(model, {out: outIds.length ? {ids: [...new Set(outIds)], to: outTo} : null, into: ownCarry ? {from: ownCarry.from.id, items: items.map(({id}) => ({id}))} : null});
  if (!ownCarry) return model;

  // The source's rects on its last frame, with its hand-off applied.
  const key = JSON.stringify([ownCarry.from, scene.id, ownCarry.map, story.format?.width, story.format?.height]);
  const before = memo(story, key, () => {
    const source = resolveBare(ownCarry.from);
    tag(source, {out: {ids: Object.keys(ownCarry.map), to: scene.id}});
    const {children, ops} = opList(source);
    return visualBoxes(source, children, ops, source.end, Object.keys(ownCarry.map));
  });
  const {children, ops} = opList(model);
  const slots = visualBoxes(model, children, ops, model.start, items.map(item => item.id));
  model.carry.in.items = items.map(({id, from}) => {
    const box = before[from];
    if (!sameBox(box, slots[id])) throw new Error(`scenes ${scene.id}.carry: ${from} → ${id} moves (from ${JSON.stringify(box)} to ${JSON.stringify(slots[id])}); only pins (the same rect on both sides) are supported so far`);
    return {id, box, pin: true};
  });
  return model;
}
