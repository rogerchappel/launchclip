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
// off. A carry needs the scene to arrive by a cut (a still plate), by a
// camera move that keeps zoom and roll (a pan or whip-pan, world or cuts
// mode): then A's rect is mapped through the two plates' world placements and
// the element travels with the move (docs/rd/carry-moving-camera.md), or by a
// push or pull of the camera: then the element rides a layer that cancels the
// camera (docs/FLUID_MOTION_RFC.md §6.6).
//
// Plain ESM; imports kit/core siblings only.

import {MODULES as CATALOG_B, catalogBTimeline, catalogBView} from './catalog-b.mjs';
import {MODULES as CATALOG_G, catalogGTimeline, catalogGView} from './catalog-g.mjs';
import {MODULES as CATALOG_H, catalogHTimeline, catalogHView} from './catalog-h.mjs';
import {ROOT_REST, parentFrame, sameBox, visualBoxes} from './carry.mjs';
import {scaleStepAt} from './motion.mjs';
import {indexView} from './shot-states.mjs';
import {FEELS} from './feel.mjs';
import {cameraActive, cameraPlan, resolveCamera, sceneObjectLookup, worldPoint} from './camera-world.mjs';
import {isCameraTransition, sceneWindows} from './transitions.mjs';

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

/** Camera moves a carry rides: they keep zoom and roll, so the element's world travel is a straight line on screen. */
export const CARRY_MOVES = Object.freeze(['pan', 'whip-pan']);
/** Camera moves that change zoom a carry rides on a layer that cancels the camera (§6.6). */
export const CARRY_RIDES = Object.freeze(['push', 'pull']);
/** Typed transitions a carry rides: B's layer slides in on one axis (and may blur), which is a camera move in all but name. */
export const CARRY_SLIDES = Object.freeze(['push', 'whip']);

/** Why a scene's arrival cannot take a carry, or null (a cut, or a pan or whip-pan of the camera). */
export function stillPlateProblem(story, scene) {
  const transition = scene?.in, type = transition?.type;
  if (!transition || type === 'cut') return null;
  if (isCameraTransition(transition, resolveCamera(story).mode)) return CARRY_MOVES.includes(type) || CARRY_RIDES.includes(type) ? null : `it arrives by a ${type} camera move; carry rides cuts, pans, whip-pans, pushes, pulls and whips`;
  if (CARRY_SLIDES.includes(type)) return null;
  return `it arrives by a ${type ?? 'typed'} transition; carry needs a cut (no in), a pan, a whip-pan, a push or a whip`;
}

/**
 * The camera move B arrives by and the two placements, when it is a carry's
 * move: {move: {start, duration, ease}, from, to} | null (a cut). Throws when
 * the move does not come from A or changes zoom or roll (a rebalanced pan).
 */
function arrivalMove(story, A, B, resolveBare) {
  if (!B.in || B.in.type === 'cut') return null;
  const windows = memo(story, 'windows', () => sceneWindows(story));
  if (!isCameraTransition(B.in, resolveCamera(story).mode)) {
    // A slide (push, whip): B's layer starts offset on one axis and eases home while A's leaves, so map A's
    // rect by that offset and travel with the layer's ease (docs/rd/carry-moving-camera.md §4).
    const slide = windows.scenes.find(entry => entry.id === B.id)?.tweens.find(tween => tween.role === 'in' && (tween.prop === 'x' || tween.prop === 'y'));
    if (!slide) return null;
    const rest = {x: 0, y: 0, scale: 1, rotation: 0};
    return {move: {start: slide.at, duration: slide.duration, ease: slide.ease}, from: rest, to: {...rest, [slide.prop]: slide.from}};
  }
  if (!cameraActive(story)) return null;
  const plan = memo(story, 'camera', () => cameraPlan(story, {windows, objects: sceneObjectLookup(story, scene => resolveBare(scene))}));
  const move = plan?.moves.find(entry => entry.sceneId === B.id && !entry.zoom);
  if (!move) return null;
  const order = plan.order, at = order.indexOf(B.id);
  if (order[at - 1] !== A.id) throw new Error(`it arrives by a camera move from ${order[at - 1]}, not from ${A.id}`);
  if (CARRY_RIDES.includes(move.type)) return {move: {start: move.start, duration: move.duration, ease: move.ease}, ride: rideOf(move, plan.placements[B.id], plan)};
  if (Math.abs(Math.log(move.to.zoom / move.from.zoom)) > 1e-4 || Math.abs(move.to.rotation - move.from.rotation) > 1e-3) throw new Error(`its ${move.type} changes the camera's zoom or roll; carry rides moves between plates of one scale`);
  return {move: {start: move.start, duration: move.duration, ease: move.ease}, from: plan.placements[A.id], to: plan.placements[B.id]};
}

// Ride samples of the camera's zoom per second (straight tweens between them).
const RIDE_RATE = 60;

/**
 * The camera's inverse through a move, in plate B's canvas px (§6.6): B's px
 * reach the screen as c + k·Rot(θ)·(p − q) with k = zoom · B's scale, θ = roll
 * + B's rotation and q the camera's centre in B's px. → {x, y, rotation} (the
 * translate q − c and the rotation −θ at the move's start, both 0 at its end
 * and tweened on its ease) and scale: [[t, 1/k]] samples.
 */
function rideOf(move, placement, {width, height}) {
  const r = (-placement.rotation * Math.PI) / 180, round = (value, f = 1e4) => Math.round(value * f) / f + 0;
  const dx = move.from.x - placement.x, dy = move.from.y - placement.y;
  const qx = (dx * Math.cos(r) - dy * Math.sin(r)) / placement.scale, qy = (dx * Math.sin(r) + dy * Math.cos(r)) / placement.scale;
  const count = Math.max(1, Math.ceil(move.duration * RIDE_RATE - 1e-6));
  const scale = Array.from({length: count + 1}, (_, i) => [round(move.start + (move.duration * i) / count, 1e6), round(1 / (scaleStepAt(i / count, {from: move.from.zoom, to: move.to.zoom, duration: move.duration, ease: move.ease}) * placement.scale), 1e6)]);
  scale[count][1] = 1;
  return {x: round(qx - width / 2, 100), y: round(qy - height / 2, 100), rotation: round(-(move.from.rotation + placement.rotation)), scale};
}

/** A visual box on plate `from` (canvas px) → the same box in the world, in plate `to`'s canvas px. */
export function mapBox(box, from, to) {
  const world = worldPoint(from, {x: box.cx, y: box.cy});
  const r = (-to.rotation * Math.PI) / 180, dx = world.x - to.x, dy = world.y - to.y, k = from.scale / to.scale;
  const round = value => Math.round(value * 100) / 100;
  return {cx: round((dx * Math.cos(r) - dy * Math.sin(r)) / to.scale), cy: round((dx * Math.sin(r) + dy * Math.cos(r)) / to.scale), w: round(box.w * k), h: round(box.h * k), rotation: round(box.rotation + from.rotation - to.rotation)};
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
  const arrival = arrivalMove(story, A, B, resolveBare);
  let map = explicitMap;
  if (!map) {
    const a = resolveBare(A), b = resolveBare(B);
    const la = opList(a), lb = opList(b);
    const ea = elementsOf(a, la.children), eb = elementsOf(b, lb.children);
    // Where each element rests: A before its exit, B once its entrances are done.
    const ra = toB(visualBoxes(a, la.children, la.ops, a.motion.exitStart, ea.map(e => e.id)), arrival), rb = visualBoxes(b, lb.children, lb.ops, b.motion.exitStart, eb.map(e => e.id));
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
  // Exact rects: A on its last frame before B (a camera move draws it on through the move) with its
  // hand-off, mapped into B's plate; B on its first frame with its entrances skipped.
  const a = resolveBare(A);
  const at = Math.min(a.end, Number(B.start));
  tag(a, {out: {ids: Object.keys(map), to: B.id, at}});
  const la = opList(a);
  const boxes = toB(visualBoxes(a, la.children, la.ops, at, Object.keys(map)), arrival);
  const b = resolveBare(B);
  tag(b, {into: {from: A.id, items: Object.values(map).map(id => ({id}))}});
  const lb = opList(b);
  const slots = visualBoxes(b, lb.children, lb.ops, b.start, Object.values(map));
  // On a ride nothing is a pin: a twin in the same place holds still on screen while B's plate zooms under it.
  const pins = new Set(arrival?.ride ? [] : Object.entries(map).filter(([from, to]) => sameBox(boxes[from], slots[to])).map(([, to]) => to));
  const centre = [Number(story.format.width) / 2, Number(story.format.height) / 2];
  const frames = arrival?.ride ? Object.fromEntries(Object.values(map).map(id => [id, parentFrame(b, lb.children, lb.ops, b.start, id, centre)])) : null;
  if (!explicitMap) {
    // A same-shape twin that moved is a carry (flow.carry) or nothing; carry: false keeps only pins.
    for (const [from, to] of Object.entries(map)) if (pins.has(to) ? !flow.pin : !flow.carry) delete map[from];
    if (!Object.keys(map).length) return null;
  }
  if (frames) for (const id of Object.keys(frames)) if (!Object.values(map).includes(id)) delete frames[id];
  return {map, boxes, pins, at, move: arrival?.move ?? null, ride: arrival?.ride ?? null, frames};
}

// A ride needs no mapping: on the boundary the camera rests on A, and inside the ride B's px are screen px.
const toB = (boxes, arrival) => (arrival?.from ? Object.fromEntries(Object.entries(boxes).map(([id, box]) => [id, mapBox(box, arrival.from, arrival.to)])) : boxes);

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
    if (pairs) out = {ids: Object.keys(pairs.map), to: other.id, at: pairs.at};
  }
  if (!into && !out) return model;
  tag(model, {out, into: into ? {from: source.id, ...(into.move ? {move: into.move} : {}), ...(into.ride ? {ride: into.ride} : {}), items: Object.entries(into.map).map(([from, id]) => ({id, box: into.boxes[from], pin: into.pins.has(id), ...(into.frames ? {frame: into.frames[id]} : {})}))} : null});
  return model;
}
