// Catalogue B static view: model → element tree, shared by the HyperFrames
// emitter (serialised to HTML) and the Remotion components (rendered as
// React elements). Sharing the tree keeps the DOM, the static styles and the
// initial (pre-animation) state identical in both renderers; each renderer
// then animates the same element ids from the same model: GSAP tweens on one
// side, frame-pure motion.mjs values on the other.
//
// Node: {tag, id?, style?, attrs?, children?: (Node|string)[]}
// - `id` is the full DOM id (`${model.id}-<part>`).
// - style keys are camelCase; numbers mean px except UNITLESS keys.
// - attrs keys are React-style (strokeWidth, viewBox, pathLength…).
//
// Imports only kit/core/motion.mjs and catalog-b-base.mjs.

import {tween} from './motion.mjs';
import {SAMPLE_LEAD} from './catalog-b-base.mjs';

export const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'flex', 'strokeDashoffset', 'strokeDasharray', 'strokeWidth', 'fillOpacity', 'strokeOpacity', 'scale']);

export const abs = (x, y, width, height, extra = {}) => ({position: 'absolute', left: x, top: y, ...(width === undefined ? {} : {width}), ...(height === undefined ? {} : {height}), ...extra});
export const el = (tag, id, style, children = [], attrs) => ({tag, ...(id ? {id} : {}), ...(style ? {style} : {}), ...(attrs ? {attrs} : {}), children});
export const text = (id, style, value) => el('div', id, {margin: 0, whiteSpace: 'nowrap', ...style}, [value]);
export const svgRoot = (width, height, children) => el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, children, {width, height, viewBox: `0 0 ${width} ${height}`, fill: 'none'});
export const hex2 = (color, alpha) => `${color}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;

/** Root transform string matching GSAP's translate → rotate → scale order. */
export function transformString({x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = 1} = {}) {
  let out = `translate(${x}px, ${y}px)`;
  if (rotation) out += ` rotate(${rotation}deg)`;
  if (scaleX !== 1 || scaleY !== 1) out += ` scale(${scaleX}, ${scaleY})`;
  return out;
}

export function rootNode(model, children) {
  const {rect, motion} = model;
  const from = motion.enterFrom;
  return el('div', model.id, abs(rect.x, rect.y, rect.width, rect.height, {
    boxSizing: 'border-box', opacity: from.opacity, transform: transformString({x: from.x, y: from.y, scaleX: from.scale, scaleY: from.scale}), transformOrigin: '50% 50%'
  }), children);
}

// ---------------------------------------------------------------------------
// Timeline: one renderer-neutral list of operations per model.
//
//   {type:'set',   target, time, props}
//   {type:'tween', target, start, duration, ease, from, to}
//   {type:'loop',  target, start, cycle, repeats, from:{x}, to:{x}}  linear, wraps
//
// Props: opacity, x, y, scaleX, scaleY, rotation (deg), strokeDashoffset, text.
// The HyperFrames emitter turns these into tl.set / tl.fromTo (loop → fromTo
// with repeat) on a paused GSAP timeline. Remotion evaluates them with
// frameState(), which reproduces GSAP's timeline semantics for these ops:
// ops are applied in start order and a later op wins for the props it sets;
// a tween renders only once its start is reached (immediateRender:false).

const TRANSFORM_PROPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation'];
const IDENTITY = {opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1};

export function rootOps(model, ops) {
  const m = model.motion, f = m.enterFrom, e = m.exitTo;
  const from = {opacity: f.opacity, x: f.x, y: f.y, scaleX: f.scale, scaleY: f.scale};
  ops.push({type: 'set', target: model.id, time: model.start, props: from});
  ops.push({type: 'tween', target: model.id, start: m.enterStart, duration: m.enterDuration, ease: m.enterEase, from, to: {...IDENTITY}});
  ops.push({type: 'tween', target: model.id, start: m.exitStart, duration: m.exitDuration, ease: m.exitEase, from: {...IDENTITY}, to: {opacity: e.opacity, x: e.x, y: e.y, scaleX: e.scale, scaleY: e.scale}});
  ops.push({type: 'set', target: model.id, time: model.end, props: {opacity: 0}});
}
export const set = (ops, target, time, props) => ops.push({type: 'set', target, time, props});
export const tw = (ops, target, start, duration, ease, from, to) => ops.push({type: 'tween', target, start, duration, ease, from, to});
export const sampleTime = t => Math.round((t - SAMPLE_LEAD) * 1e6) / 1e6;

/** Linear wrap-around value of a loop op at t (GSAP repeat semantics). */
export function loopValue(op, t) {
  const out = {};
  const cycles = t <= op.start ? 0 : (t - op.start) / op.cycle;
  const p = cycles >= op.repeats ? 1 : cycles - Math.floor(cycles);
  for (const key of Object.keys(op.to)) out[key] = op.from[key] + (op.to[key] - op.from[key]) * p;
  return out;
}

const opTime = op => (op.type === 'set' ? op.time : op.start);

/**
 * Frame-pure state at absolute time t: Map target → props. Uses motion.mjs
 * eases, so it matches GSAP's rendering of the same ops.
 */
export function frameState(ops, t) {
  const order = ops.map((op, index) => ({op, index})).sort((a, b) => opTime(a.op) - opTime(b.op) || a.index - b.index);
  const state = new Map();
  for (const {op} of order) {
    if (opTime(op) > t + 1e-9) break;
    const props = state.get(op.target) ?? {};
    if (op.type === 'set') Object.assign(props, op.props);
    else if (op.type === 'tween') Object.assign(props, tween(t, {from: op.from, to: op.to, start: op.start, duration: op.duration, ease: op.ease}));
    else if (op.type === 'loop') Object.assign(props, loopValue(op, t));
    state.set(op.target, props);
  }
  return state;
}

/** Style patch (and text) for one target's props. */
export function propsToStyle(props) {
  const style = {};
  if (props.opacity !== undefined) style.opacity = props.opacity;
  if (TRANSFORM_PROPS.some(key => props[key] !== undefined)) style.transform = transformString(props);
  if (props.strokeDashoffset !== undefined) style.strokeDashoffset = props.strokeDashoffset;
  return style;
}

