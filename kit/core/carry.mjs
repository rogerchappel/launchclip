// Elements carried across scenes (docs/FLUID_MOTION_RFC.md §6.3): what a
// carry does to one op-list model (catalogue B, G or H), written into the
// shared view tree and op list so both renderers draw it with no new code.
//
//   model.carry = {
//     out?: {ids: [element id], to: scene id, at?},  elements this scene hands on (at:
//                                                     the boundary, when the scene is
//                                                     drawn on past it through a camera move)
//     in?:  {from: scene id, items: [{id, box?}],    elements it receives (box: the
//            move?: {start, duration, ease},      source's rect at the boundary, in this
//            ride?: {legs, scale}, restFrom?}     plate's px; move: the camera move it
//                                                     arrives by; ride: the camera's inverse
//                                                     on a zoom or roll, see rideOps; restFrom:
//                                                     when its rest is sampled from, the ride's end)
//     exitTo?, enterFrom?                             the root motion lifted off the root
//   }
//
// - The root's exit (out) and entrance (in) are lifted: every element that is
//   neither carried nor on the way to one is wrapped in a `-lift` layer the
//   size of its parent, its transform origin at the module's centre, which
//   plays the root's motion instead. The root itself rests.
// - out: the handed elements and their ancestors drop their ops from the exit
//   on, so they hold their pose until the scene's last frame.
// - in: the received elements and their ancestors skip their entrance: a prop
//   that starts away from rest is set at the start to where its first move
//   takes it, and that move is dropped. Later moves still play.
// - in, carry (an item with a box that is not a pin): the FLIP. The element
//   starts at the source's rect as an x, y, scale and rotation offset from its
//   slot and settles on the slot, slow → fast → slow with no overshoot; members
//   leave nearest first, a hashed 0.04–0.1 s apart. Across a camera move it
//   travels in the world with the move's own timing and ease, all members at
//   once, so on screen it slides straight from its old place to its slot
//   (docs/rd/carry-moving-camera.md).
// - in, ride (a move that zooms or rolls, §6.6): each received element is
//   wrapped in a `-ride` layer that cancels the camera, so inside it the
//   plate's px are screen px for the whole move and the FLIP above is a
//   straight line on screen.
//
// Plain ESM; imports only catalog-b-view.mjs, shot-states.mjs, grammar.mjs and fluid-motion.mjs.

import {abs, el, frameState} from './catalog-b-view.mjs';
import {indexView} from './shot-states.mjs';
import {grammarDuration} from './grammar.mjs';
import {hashUnit} from './fluid-motion.mjs';

/** The hand-off move: duration (s, scaled by the grammar's camera role), eases, the gap between members. */
export const CARRY_MOVE = Object.freeze({duration: 0.7, x: 'power2.inOut', y: 'power3.inOut', scale: 'power3.inOut', gap: Object.freeze([0.04, 0.1])});

const EPS = 1e-6;
const KEYS = ['opacity', 'x', 'y', 'scaleX', 'scaleY', 'rotation', 'strokeDashoffset', 'blur', 'clipT', 'clipR', 'clipB', 'clipL'];
const REST = {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, strokeDashoffset: 0, blur: 0, clipT: 0, clipR: 0, clipB: 0, clipL: 0};
/** The root at rest: what a lifted enterFrom / exitTo becomes. */
export const ROOT_REST = Object.freeze({opacity: 1, x: 0, y: 0, scale: 1});
const SVG = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'text', 'tspan', 'defs', 'use']);
const opTime = op => (op.type === 'set' ? op.time : op.start);
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Every id a model's carry keeps (handed on or received). */
export function carriedIds(model) {
  const c = model?.carry;
  return [...new Set([...(c?.out?.ids ?? []), ...(c?.in?.items ?? []).map(item => item.id)])];
}

const plans = new WeakMap();

/**
 * The carry plan for a model and its content children (the root's children):
 * {index, keep, path, subtree (target ids whose ops the carry edits, by side),
 * lifts: [{node, wrapper id, parent}]}. Throws when a carried id is missing,
 * sits inside an svg or would need a flowed element lifted.
 */
function carryPlan(model, children) {
  const cached = plans.get(model);
  if (cached && cached.children === children) return cached;
  const index = indexView(children);
  const ancestorsOf = entry => { const out = []; for (let at = entry.parent; at && at.parent; at = at.parent) out.push(at); return out; };
  const descendants = entry => { const out = []; const walk = e => { for (const [, other] of index.byId) if (other.parent === e) { out.push(other); walk(other); } }; walk(entry); return out; };
  const resolveIds = ids => ids.map(id => {
    const entry = index.byId.get(id);
    if (!entry) throw new Error(`carry: ${model.module} ${model.id} has no element "${id}"`);
    if (SVG.has(entry.node.tag) || ancestorsOf(entry).some(up => SVG.has(up.node.tag))) throw new Error(`carry: "${id}" is drawn inside an svg; carry a box element`);
    return entry;
  });
  const sideOf = ids => {
    const entries = resolveIds(ids);
    const path = new Set(entries.flatMap(ancestorsOf));
    const targets = new Set([...entries, ...path, ...entries.flatMap(descendants)].map(entry => entry.id).filter(Boolean));
    return {entries, path, targets};
  };
  const out = sideOf(model.carry?.out?.ids ?? []), into = sideOf((model.carry?.in?.items ?? []).map(item => item.id));
  const kept = new Set([...out.entries, ...into.entries].map(entry => entry.node));
  const pathNodes = new Set([...out.path, ...into.path].map(entry => entry.node));
  const W = model.rect.width, H = model.rect.height;
  // Lift every child of the root and of each path node that is neither kept nor on a path.
  const lifts = [];
  let n = 0;
  const visit = (node, ax, ay) => {
    for (const child of node.children ?? []) {
      if (!child || typeof child !== 'object') continue;
      if (pathNodes.has(child)) { const e = child.id ? index.byId.get(child.id) : null; visit(child, e ? e.ax : ax, e ? e.ay : ay); continue; }
      if (kept.has(child)) continue;
      const s = child.style ?? {};
      if (s.left === undefined && s.top === undefined && child.attrs?.x === undefined && s.position !== 'absolute') throw new Error(`carry: ${model.id} lays out ${child.id ?? `a ${child.tag}`} in flow beside a carried element; carry needs absolutely placed elements`);
      lifts.push({node: child, id: `${child.id ?? `${model.id}-el-${n}`}-lift`, origin: `${Math.round((W / 2 - ax) * 100) / 100}px ${Math.round((H / 2 - ay) * 100) / 100}px`});
      n += 1;
    }
  };
  if (kept.size) visit({children}, 0, 0);
  const plan = {children, index, out, into, lifts};
  plans.set(model, plan);
  return plan;
}

/** The content children with the carry's lift layers in place (the view hook). */
export function carryView(model, children) {
  if (!carriedIds(model).length) return children;
  const {lifts, index} = carryPlan(model, children);
  const byNode = new Map(lifts.map(lift => [lift.node, lift]));
  if (model.carry.in?.ride) for (const item of model.carry.in.items) {
    const node = index.byId.get(item.id).node, [x, y] = item.frame.origin;
    byNode.set(node, {id: `${item.id}-ride`, origin: `${x}px ${y}px`});
  }
  const wrap = node => {
    if (!node || typeof node !== 'object') return node;
    const lift = byNode.get(node);
    if (lift) return el('div', lift.id, {...abs(0, 0, '100%', '100%'), transformOrigin: lift.origin}, [lift.id.endsWith('-ride') ? wrapKids(node) : node]);
    return wrapKids(node);
  };
  const wrapKids = node => (node.children?.length ? {...node, children: node.children.map(wrap)} : node);
  return children.map(wrap);
}

/**
 * Edit a model's op list for its carry (the timeline hook): lift the root's
 * exit and entrance, hold what is handed on, skip the entrance of what is
 * received. `children` are the content children carryView was given.
 */
export function applyCarry(model, ops, children) {
  if (!carriedIds(model).length) return ops;
  const plan = carryPlan(model, children);
  const m = model.motion, c = model.carry;
  const identity = {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1};
  const pose = from => ({opacity: from.opacity, x: from.x, y: from.y, scaleX: from.scale, scaleY: from.scale});
  for (const lift of plan.lifts) {
    if (c.in && c.enterFrom) {
      ops.push({type: 'set', target: lift.id, time: model.start, props: pose(c.enterFrom)});
      ops.push({type: 'tween', target: lift.id, start: m.enterStart, duration: m.enterDuration, ease: m.enterEase, from: pose(c.enterFrom), to: {...identity}});
    } else ops.push({type: 'set', target: lift.id, time: model.start, props: {...identity}});
    if (c.out && c.exitTo) ops.push({type: 'tween', target: lift.id, start: m.exitStart, duration: m.exitDuration, ease: m.exitEase, from: {...identity}, to: pose(c.exitTo)});
  }
  // Hold: what is handed on keeps its pose from the exit on.
  if (c.out) {
    const held = plan.out.targets;
    for (let i = ops.length - 1; i >= 0; i -= 1) if (held.has(ops[i].target) && opTime(ops[i]) >= m.exitStart - EPS) ops.splice(i, 1);
    // Drawn on through a camera move: the copy hides as the receiver's shows.
    if (c.out.at < model.end - EPS) for (const id of c.out.ids) ops.push({type: 'set', target: id, time: c.out.at, props: {opacity: 0}});
  }
  if (c.in) {
    skipEntrances(model, ops, plan.into.targets, plan.index);
    flipOps(model, ops, children);
    if (c.in.ride) rideOps(model, ops);
  }
  return ops;
}

/**
 * The FLIP for each carried (not pinned) item: an offset that puts the
 * element on the source's rect at the start, tweened to its slot.
 */
function flipOps(model, ops, children) {
  const moving = (model.carry.in.items ?? []).filter(item => item.box && !item.pin);
  if (!moving.length) return;
  const index = indexView(children);
  const start = model.start, move = model.carry.in.move;
  // Across a camera move: its timing and ease on every prop, no gap (a lag behind the camera swings on screen).
  const duration = move ? move.duration : grammarDuration(model.grammar ?? null, 'camera', CARRY_MOVE.duration, {min: 0.5, max: 1});
  const ease = move ? {x: move.ease, y: move.ease, scale: move.ease} : CARRY_MOVE;
  const rest = frameState(ops, start);
  const slotOf = (id, props) => visualBoxes(model, children, props ? [...ops, {type: 'set', target: id, time: start, props}] : ops, start, [id])[id];
  const plans = moving.map(item => {
    const own = {x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, ...pick(rest.get(item.id))};
    const slot = slotOf(item.id);
    const from = {...own, scaleX: own.scaleX * ratio(item.box.w, slot.w), scaleY: own.scaleY * ratio(item.box.h, slot.h), rotation: own.rotation + item.box.rotation - slot.rotation};
    // The ancestors' linear map at the start turns a canvas offset into the element's own x/y.
    const inverse = invert(ancestorLinear(index.byId.get(item.id), rest));
    // Scale and rotation about a transform origin off-centre move the centre too: correct twice.
    for (let k = 0; k < 3; k += 1) {
      const at = slotOf(item.id, from);
      const [dx, dy] = apply(inverse, [item.box.cx - at.cx, item.box.cy - at.cy]);
      from.x += dx; from.y += dy;
    }
    return {item, own, from: roundProps(from), distance: Math.hypot(item.box.cx - slot.cx, item.box.cy - slot.cy)};
  }).sort((a, b) => a.distance - b.distance || (a.item.id < b.item.id ? -1 : 1));
  let at = move ? move.start : start;
  for (const [k, plan] of plans.entries()) {
    if (k && !move) at += CARRY_MOVE.gap[0] + (CARRY_MOVE.gap[1] - CARRY_MOVE.gap[0]) * hashUnit(plan.item.id);
    const t = Math.round(at * 1e6) / 1e6, {from, own} = plan, id = plan.item.id;
    // The move owns the element's transform until it lands: drop what is left of its own entrance.
    for (const op of ops) if (op.target === id && op.type !== 'loop' && opTime(op) < t + duration - EPS) for (const key of ['x', 'y', 'scaleX', 'scaleY', 'rotation']) strip(op, key);
    for (let i = ops.length - 1; i >= 0; i -= 1) if (isEmpty(ops[i])) ops.splice(i, 1);
    ops.push({type: 'set', target: id, time: start, props: {...from}});
    ops.push({type: 'tween', target: id, start: t, duration, ease: ease.x, from: {x: from.x}, to: {x: own.x}});
    ops.push({type: 'tween', target: id, start: t, duration, ease: ease.y, from: {y: from.y}, to: {y: own.y}});
    ops.push({type: 'tween', target: id, start: t, duration, ease: ease.scale, from: {scaleX: from.scaleX, scaleY: from.scaleY, rotation: from.rotation}, to: {scaleX: own.scaleX, scaleY: own.scaleY, rotation: own.rotation}});
  }
}

/**
 * The ride layers (§6.6): the camera's inverse in the plate's px (ride: the
 * translate x, y and rotation it starts at, tweened to 0 on the move's ease,
 * and the scale as [time, value] samples joined by straight tweens),
 * conjugated into each element's parent px by its frame (origin: the canvas
 * centre in the parent's px, inverse: the parent's linear map inverted, a
 * similarity, so rotation and scale pass through unchanged).
 */
function rideOps(model, ops) {
  const {ride, items} = model.carry.in;
  const r = value => Math.round(value * 1e4) / 1e4;
  for (const item of items) {
    const id = `${item.id}-ride`, s0 = ride.scale[0][1];
    const pose = leg => { const [x, y] = leg ? apply(item.frame.inverse, [leg.x, leg.y]).map(r) : [0, 0]; return {x, y, rotation: leg?.rotation ?? 0}; };
    ops.push({type: 'set', target: id, time: model.start, props: {...pose(ride.legs[0]), scaleX: s0, scaleY: s0}});
    for (const [k, leg] of ride.legs.entries()) ops.push({type: 'tween', target: id, start: leg.start, duration: leg.duration, ease: leg.ease, from: pose(leg), to: pose(ride.legs[k + 1])});
    for (let k = 1; k < ride.scale.length; k += 1) {
      const [t0, a] = ride.scale[k - 1], [t1, b] = ride.scale[k];
      if (t1 - t0 < 1e-6) continue;
      ops.push({type: 'tween', target: id, start: t0, duration: r(t1 - t0), ease: 'none', from: {scaleX: a, scaleY: a}, to: {scaleX: b, scaleY: b}});
    }
  }
}

/**
 * An element's parent frame at t: {origin: the canvas point (cx, cy) in the
 * parent's px, inverse: the parent's linear map to the canvas, inverted}.
 * Throws when that map is not a similarity (a ride needs rotation and scale to
 * commute with it).
 */
export function parentFrame(model, children, ops, t, id, [cx, cy]) {
  const entry = indexView(children).byId.get(id), state = frameState(ops, t);
  const at = point => { const [x, y] = toCanvas(entry.parent, point, state); return [model.rect.x + x, model.rect.y + y]; };
  const [ox, oy] = at([0, 0]), [ax, ay] = at([1, 0]), [bx, by] = at([0, 1]);
  const linear = [ax - ox, bx - ox, ay - oy, by - oy];
  if (Math.abs(linear[0] - linear[3]) > 1e-4 || Math.abs(linear[1] + linear[2]) > 1e-4) throw new Error(`carry: ${id} sits in a layer that stretches unevenly; a zoom or roll needs uniform scale`);
  const inverse = invert(linear), round = value => Math.round(value * 100) / 100;
  return {origin: apply(inverse, [cx - ox, cy - oy]).map(round), inverse: inverse.map(value => Math.round(value * 1e6) / 1e6)};
}

const pick = (props = {}) => Object.fromEntries(['x', 'y', 'scaleX', 'scaleY', 'rotation'].filter(key => typeof props[key] === 'number').map(key => [key, props[key]]));
const ratio = (a, b) => (b > 0 ? a / b : 1);
const roundProps = props => Object.fromEntries(Object.entries(props).map(([key, value]) => [key, key.startsWith('scale') ? Math.round(value * 1e4) / 1e4 : Math.round(value * 100) / 100]));
const invert = ([a, b, c, d]) => { const det = a * d - b * c || 1; return [d / det, -b / det, -c / det, a / det]; };

/** The linear part (rotation and scale) of an entry's ancestors at a frame state. */
function ancestorLinear(entry, state) {
  let linear = [1, 0, 0, 1];
  for (let at = entry?.parent; at && at.parent; at = at.parent) {
    const p = state.get(at.id) ?? {};
    const r = ((p.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    linear = mul(mul([cos, -sin, sin, cos], [p.scaleX ?? 1, 0, 0, p.scaleY ?? 1]), linear);
  }
  return linear;
}

/**
 * For each target and prop that starts away from rest (the sets at the
 * model's start, else the view's opacity), set it at the start to where its
 * first move takes it and drop that move. Rest is the value the prop holds for
 * most of the scene, so an overlay that rests hidden and only flashes (a lit
 * rim, a ring) is not an entrance. Loops are left alone.
 */
function skipEntrances(model, ops, targets, index) {
  const start = model.start;
  const settles = new Map();
  const rests = restValues(model, ops, targets);
  // On a ride, a module may hold its elements' entrances until the camera arrives (an overview's 2 s or more), so
  // the received elements' rest is sampled from then; their ancestors (node-graph's slow -cam push) keep the scene's.
  const restFrom = model.carry.in?.restFrom;
  if (restFrom !== undefined) for (const [id, rest] of restValues(model, ops, new Set(model.carry.in.items.map(item => item.id)), restFrom)) rests.set(id, rest);
  for (const target of targets) {
    const mine = ops.map((op, i) => ({op, i})).filter(({op}) => op.target === target).sort((a, b) => opTime(a.op) - opTime(b.op) || a.i - b.i);
    for (const key of KEYS) {
      const touching = mine.filter(({op}) => (op.type === 'set' ? key in (op.props ?? {}) : key in (op.to ?? {})));
      const lead = [];
      let k = 0;
      while (k < touching.length && touching[k].op.type === 'set' && touching[k].op.time <= start + EPS) lead.push(touching[k++].op);
      const initial = lead.length ? lead.at(-1).props[key] : key === 'opacity' ? index.byId.get(target)?.opacity : undefined;
      if (initial === undefined || typeof initial !== 'number' || Math.abs(initial - (rests.get(target)?.[key] ?? REST[key])) < 1e-3) continue;
      const first = touching[k]?.op;
      if (!first || first.type === 'loop') continue;
      const value = first.type === 'set' ? first.props[key] : first.to[key];
      for (const op of [...lead, first]) strip(op, key);
      settles.set(target, {...(settles.get(target) ?? {}), [key]: value});
    }
  }
  for (let i = ops.length - 1; i >= 0; i -= 1) if (isEmpty(ops[i])) ops.splice(i, 1);
  for (const [target, props] of settles) ops.push({type: 'set', target, time: start, props});
}

/** target → {key: the value it holds for most of the scene (sampled from `after` up to the exit)}. */
function restValues(model, ops, targets, after = model.start) {
  const counts = new Map();
  const from = Math.min(after, model.motion.exitStart);
  const end = model.motion.exitStart, samples = 48;
  for (let k = 0; k <= samples; k += 1) {
    const state = frameState(ops, from + ((end - from) * k) / samples);
    for (const target of targets) {
      const props = state.get(target);
      if (!props) continue;
      const mine = counts.get(target) ?? counts.set(target, {}).get(target);
      for (const key of KEYS) if (typeof props[key] === 'number') {
        const value = Math.round(props[key] * 100) / 100;
        const tally = mine[key] ?? (mine[key] = new Map());
        tally.set(value, (tally.get(value) ?? 0) + 1);
      }
    }
  }
  const out = new Map();
  for (const [target, keys] of counts) out.set(target, Object.fromEntries(Object.entries(keys).map(([key, tally]) => [key, [...tally].sort((a, b) => b[1] - a[1])[0][0]])));
  return out;
}

function strip(op, key) {
  if (op.type === 'set') delete op.props[key];
  else { delete op.from[key]; delete op.to[key]; }
}
const isEmpty = op => (op.type === 'set' ? isObject(op.props) && !Object.keys(op.props).length : op.type === 'tween' && isObject(op.to) && !Object.keys(op.to).length);

// ---------------------------------------------------------------------------
// Rects at the boundary

const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
const apply = (m, [x, y]) => [m[0] * x + m[1] * y, m[2] * x + m[3] * y];

/**
 * Visual boxes on the canvas at time t: id → {cx, cy, w, h, rotation}, each
 * element's layout box mapped through its own and its ancestors' transforms
 * (frameState of `ops` at t; the root at model.rect, at rest). children: the
 * root's content children.
 */
export function visualBoxes(model, children, ops, t, ids) {
  const index = indexView(children);
  const state = frameState(ops, t);
  const out = {};
  for (const id of ids) {
    const entry = index.byId.get(id);
    if (!entry) continue;
    const w = entry.width ?? 0, h = entry.height ?? 0;
    const linear = [1, 0, 0, 1];
    const point = toCanvas(entry, [w / 2, h / 2], state, linear);
    const [ux, uy] = apply(linear, [1, 0]), [vx, vy] = apply(linear, [0, 1]);
    const round = value => Math.round(value * 100) / 100;
    out[id] = {cx: round(model.rect.x + point[0]), cy: round(model.rect.y + point[1]), w: round(w * Math.hypot(ux, uy)), h: round(h * Math.hypot(vx, vy)), rotation: round((Math.atan2(uy, ux) * 180) / Math.PI)};
  }
  return out;
}

/** A point in an entry's own px → the module's content px, through it and its ancestors at a frame state (linear: multiplied in place by their linear maps). */
function toCanvas(entry, point, state, linear = [1, 0, 0, 1]) {
  for (let at = entry; at && at.parent; at = at.parent) {
    const p = state.get(at.id) ?? {};
    const ow = at.origin.ox ?? (at.width ?? 0) * at.origin.x, oh = at.origin.oy ?? (at.height ?? 0) * at.origin.y;
    const r = ((p.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    const local = mul([cos, -sin, sin, cos], [p.scaleX ?? 1, 0, 0, p.scaleY ?? 1]);
    const [dx, dy] = apply(local, [point[0] - ow, point[1] - oh]);
    point = [(at.x ?? 0) + ow + (p.x ?? 0) + dx, (at.y ?? 0) + oh + (p.y ?? 0) + dy];
    linear.splice(0, 4, ...mul(local, linear));
  }
  return point;
}

/** Whether two visual boxes are the same on screen (half a pixel, a tenth of a degree). */
export const sameBox = (a, b) => Boolean(a && b) && ['cx', 'cy', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) < 0.5) && Math.abs(a.rotation - b.rotation) < 0.1;
