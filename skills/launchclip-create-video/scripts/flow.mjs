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
import {indexView} from './shot-states.mjs';
import {FEELS} from './feel.mjs';

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
  // A still plate: the per-scene hold drift (kit/core/ambient.mjs sceneDrift) restarts on every scene, so it is off on both sides.
  if (model.layout) model.layout.drift = false;
}

/**
 * The story's flow (docs/FLUID_MOTION_RFC.md §6.1): {carry: "auto" | false,
 * pin} or null when off. An explicit motion.flow wins; otherwise a named
 * feel's default (kit/core/feel.mjs FEELS[...].flow: kinetic and steady on).
 */
export function resolveFlow(story) {
  const own = story?.motion?.flow;
  let flow;
  if (own === true) flow = {carry: 'auto', pin: true};
  else if (own === false) return null;
  else if (isObject(own)) flow = {carry: own.carry === false ? false : 'auto', pin: own.pin !== false};
  else {
    const feel = story?.motion?.feel;
    const name = typeof feel === 'string' ? feel : isObject(feel) ? feel.preset ?? 'kinetic' : null;
    flow = FEELS[name]?.flow ? {carry: 'auto', pin: true} : null;
  }
  return flow && (flow.carry || flow.pin) ? flow : null;
}

// Boundary pairs per story: keyed by the two scenes and the flow.
const MEMO = new WeakMap();
function memo(story, key, make) {
  let map = MEMO.get(story);
  if (!map) MEMO.set(story, (map = new Map()));
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
}

const SVG = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'text']);

/**
 * A model's elements for automatic pairing: id-bearing boxes whose nearest
 * id-bearing ancestor is the root or a wrapper that fills the module's rect.
 * → [{id, suffix, kind, text, shape}]
 */
function elementsOf(model, children) {
  const index = indexView(children);
  const W = model.rect.width, H = model.rect.height;
  const fills = entry => Math.abs(entry.ax) < 0.5 && Math.abs(entry.ay) < 0.5 && Math.abs((entry.width ?? -1) - W) < 0.5 && Math.abs((entry.height ?? -1) - H) < 0.5;
  const textOf = node => (typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join(' ')).replace(/\s+/g, ' ').trim();
  const prefix = `${model.id}-`;
  const shapeOf = node => JSON.stringify(node, (key, value) => (key === 'id' && typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : value));
  const out = [];
  for (const [id, entry] of index.byId) {
    if (!id.startsWith(prefix) || !(entry.width > 0 && entry.height > 0) || SVG.has(entry.node.tag)) continue;
    let up = entry.parent;
    while (up && up.parent && !up.id) up = up.parent;
    if (up && up.parent && !fills(up)) continue;
    const suffix = id.slice(prefix.length);
    out.push({id, suffix, kind: suffix.replace(/-[a-z]*\d[a-z0-9]*$/i, ''), text: textOf(entry.node), shape: shapeOf(entry.node)});
  }
  return out;
}

/**
 * The pairs at the boundary into scene B from its source A, or null:
 * {map: {A id: B id}, boxes: {A id: box on A's last frame}, pins: Set of B ids}.
 * An explicit carry map is used as given (errors throw); otherwise, with flow
 * on and a still plate, identical elements pin and same-kind elements with the
 * same text carry, nearest centres first.
 */
function pairsFor(story, A, B, resolveBare) {
  const explicit = explicitCarry(story, B);
  const flow = explicit ? null : resolveFlow(story);
  if (!explicit && (!flow || B.carry === false || stillPlateProblem(story, B) || !isOpListModule(B.module))) return null;
  const key = JSON.stringify([A, B, flow, story.format?.width, story.format?.height]);
  return memo(story, key, () => {
    try { return measure(story, A, B, resolveBare, explicit?.map ?? null, flow); }
    catch (error) { if (explicit) throw error; return null; }
  });
}

function measure(story, A, B, resolveBare, explicitMap, flow) {
  let map = explicitMap;
  if (!map) {
    const a = resolveBare(A), b = resolveBare(B);
    const la = opList(a), lb = opList(b);
    const ea = elementsOf(a, la.children), eb = elementsOf(b, lb.children);
    // Where each element rests: A before its exit, B once its entrances are done.
    const ra = visualBoxes(a, la.children, la.ops, a.motion.exitStart, ea.map(e => e.id)), rb = visualBoxes(b, lb.children, lb.ops, b.motion.exitStart, eb.map(e => e.id));
    map = {};
    const taken = new Set();
    for (const e of ea) {
      const twin = eb.find(other => other.suffix === e.suffix && other.shape === e.shape);
      if (twin && flow.pin) { map[e.id] = twin.id; taken.add(twin.id); }
    }
    if (flow.carry) {
      const options = [];
      for (const e of ea) if (!map[e.id]) for (const other of eb) if (!taken.has(other.id) && other.kind === e.kind && other.text === e.text && ra[e.id] && rb[other.id]) options.push([Math.hypot(ra[e.id].cx - rb[other.id].cx, ra[e.id].cy - rb[other.id].cy), e.id, other.id]);
      options.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : 1));
      for (const [, from, to] of options) if (!map[from] && !taken.has(to)) { map[from] = to; taken.add(to); }
    }
    if (!Object.keys(map).length) return null;
  }
  // Exact rects: A on its last frame with its hand-off, B on its first with its entrances skipped.
  const a = resolveBare(A);
  tag(a, {out: {ids: Object.keys(map), to: B.id}});
  const la = opList(a);
  const boxes = visualBoxes(a, la.children, la.ops, a.end, Object.keys(map));
  const b = resolveBare(B);
  tag(b, {into: {from: A.id, items: Object.values(map).map(id => ({id}))}});
  const lb = opList(b);
  const slots = visualBoxes(b, lb.children, lb.ops, b.start, Object.values(map));
  const pins = new Set(Object.entries(map).filter(([from, to]) => sameBox(boxes[from], slots[to])).map(([, to]) => to));
  if (!explicitMap) {
    // A same-shape twin that moved is a carry (flow.carry) or nothing; carry: false keeps only pins.
    for (const [from, to] of Object.entries(map)) if (pins.has(to) ? !flow.pin : !flow.carry) delete map[from];
    if (!Object.keys(map).length) return null;
  }
  return {map, boxes, pins};
}

/**
 * The elements pinned into scene B from its source (explicit or automatic):
 * {A id: B id}, {} when none. A moved (FLIP) carry is not a pin.
 */
export function pinnedInto(story, B, resolveBare) {
  const A = carrySource(story, B);
  const pairs = A ? pairsFor(story, A, B, resolveBare) : null;
  return pairs ? Object.fromEntries(Object.entries(pairs.map).filter(([, to]) => pairs.pins.has(to))) : {};
}

/**
 * Tag a resolved op-list model with what its scene hands on and receives.
 * resolveBare(scene) resolves a scene with no carry. Throws on an explicit
 * carry the story cannot play; automatic pairing never throws.
 */
export function applyFlow(model, scene, story, resolveBare) {
  if (!isOpListModule(model?.module) || !model.motion || !Array.isArray(story?.scenes)) return model;
  const source = carrySource(story, scene);
  if (!source && isObject(scene.carry)) explicitCarry(story, scene);
  const into = source ? pairsFor(story, source, scene, resolveBare) : null;
  // Out: the next scene on the track whose source this is.
  let out = null;
  for (const other of story.scenes) {
    if (other === scene || carrySource(story, other)?.id !== scene.id) continue;
    const pairs = pairsFor(story, scene, other, resolveBare);
    if (pairs) out = {ids: Object.keys(pairs.map), to: other.id};
  }
  if (!into && !out) return model;
  tag(model, {out, into: into ? {from: source.id, items: Object.entries(into.map).map(([from, id]) => ({id, box: into.boxes[from], pin: into.pins.has(id)}))} : null});
  return model;
}
