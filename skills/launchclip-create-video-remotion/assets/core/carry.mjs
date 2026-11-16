// Elements carried across scenes (docs/FLUID_MOTION_RFC.md §6.3): what a
// carry does to one op-list model (catalogue B, G or H), written into the
// shared view tree and op list so both renderers draw it with no new code.
//
//   model.carry = {
//     out?: {ids: [element id], to: scene id},       elements this scene hands on
//     in?:  {from: scene id, items: [{id, box?}]},   elements it receives (box: the
//                                                     source's rect at the boundary)
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
//
// Plain ESM; imports only catalog-b-view.mjs and shot-states.mjs.

import {abs, el, frameState} from './catalog-b-view.mjs';
import {indexView} from './shot-states.mjs';

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
  const {lifts} = carryPlan(model, children);
  const byNode = new Map(lifts.map(lift => [lift.node, lift]));
  const wrap = node => {
    if (!node || typeof node !== 'object') return node;
    const lift = byNode.get(node);
    if (lift) return el('div', lift.id, {...abs(0, 0, '100%', '100%'), transformOrigin: lift.origin}, [node]);
    return node.children?.length ? {...node, children: node.children.map(wrap)} : node;
  };
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
  }
  if (c.in) skipEntrances(model, ops, plan.into.targets, plan.index);
  return ops;
}

/**
 * For each target and prop that starts away from rest (the sets at the
 * model's start, else the view's opacity), set it at the start to where its
 * first move takes it and drop that move. Loops are left alone.
 */
function skipEntrances(model, ops, targets, index) {
  const start = model.start;
  const settles = new Map();
  for (const target of targets) {
    const mine = ops.map((op, i) => ({op, i})).filter(({op}) => op.target === target).sort((a, b) => opTime(a.op) - opTime(b.op) || a.i - b.i);
    for (const key of KEYS) {
      const touching = mine.filter(({op}) => (op.type === 'set' ? key in (op.props ?? {}) : key in (op.to ?? {})));
      const lead = [];
      let k = 0;
      while (k < touching.length && touching[k].op.type === 'set' && touching[k].op.time <= start + EPS) lead.push(touching[k++].op);
      const initial = lead.length ? lead.at(-1).props[key] : key === 'opacity' ? index.byId.get(target)?.opacity : undefined;
      if (initial === undefined || typeof initial !== 'number' || Math.abs(initial - REST[key]) < 1e-3) continue;
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
    let point = [w / 2, h / 2];
    let linear = [1, 0, 0, 1];
    for (let at = entry; at && at.parent; at = at.parent) {
      const p = state.get(at.id) ?? {};
      const ow = (at.width ?? 0) * at.origin.x, oh = (at.height ?? 0) * at.origin.y;
      const r = ((p.rotation ?? 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      const local = mul([cos, -sin, sin, cos], [p.scaleX ?? 1, 0, 0, p.scaleY ?? 1]);
      const [dx, dy] = apply(local, [point[0] - ow, point[1] - oh]);
      point = [(at.x ?? 0) + ow + (p.x ?? 0) + dx, (at.y ?? 0) + oh + (p.y ?? 0) + dy];
      linear = mul(local, linear);
    }
    const [ux, uy] = apply(linear, [1, 0]), [vx, vy] = apply(linear, [0, 1]);
    const round = value => Math.round(value * 100) / 100;
    out[id] = {cx: round(model.rect.x + point[0]), cy: round(model.rect.y + point[1]), w: round(w * Math.hypot(ux, uy)), h: round(h * Math.hypot(vx, vy)), rotation: round((Math.atan2(uy, ux) * 180) / Math.PI)};
  }
  return out;
}

/** Whether two visual boxes are the same on screen (half a pixel, a tenth of a degree). */
export const sameBox = (a, b) => Boolean(a && b) && ['cx', 'cy', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) < 0.5) && Math.abs(a.rotation - b.rotation) < 0.1;
