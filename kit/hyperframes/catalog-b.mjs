// HyperFrames emitters for catalogue B (function-chart, gauge-compare,
// flow-compare, process-steps, archive-card, logo-row, brand-lockup).
//
// The model comes from kit/core/catalog-b.mjs. The static markup comes from
// the shared view tree (kit/core/catalog-b-view.mjs), so the DOM matches the
// Remotion components exactly; the motion is the same renderer-neutral op
// list, emitted as calls on the host's paused GSAP timeline `tl`.
//
// Seek safety: only tl.set and tl.fromTo with explicit from values and
// immediateRender:false; no onUpdate, no proxies, no wall clock. Line draws
// tween strokeDashoffset (pathLength = 1, autoRound:false so GSAP does not
// round the sub-pixel offset); the probe and count-ups are per-frame tl.set
// keyframes sampled from the model; flow particles are one linear repeat per
// belt, which GSAP evaluates as a pure function of the playhead.

import {gsapText} from '../core/motion.mjs';
import {catalogBView, catalogBTimeline} from '../core/catalog-b.mjs';
import {UNITLESS} from '../core/catalog-b-view.mjs';

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
const js = value => JSON.stringify(value).replace(/</g, '\\u003c');
const KEEP_ATTR_CASE = new Set(['viewBox', 'pathLength', 'preserveAspectRatio', 'gradientUnits']);
const VOID = new Set(['img']);
const SVG_LEAF = new Set(['path', 'line', 'rect', 'circle', 'stop']);
const kebab = key => key.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`).replace(/^webkit-/, '-webkit-');

function styleText(style) {
  return Object.entries(style).map(([key, value]) => `${kebab(key)}:${typeof value === 'number' && !UNITLESS.has(key) ? `${value}px` : value}`).join(';');
}

/** Serialise a view node to HTML. `rootAttrs` are extra attributes for the root. */
export function renderNode(node, rootAttrs = '') {
  if (typeof node === 'string') return escapeHtml(node);
  const attrs = [];
  if (node.id) attrs.push(`id="${escapeHtml(node.id)}"`);
  if (rootAttrs) attrs.push(rootAttrs);
  for (const [key, value] of Object.entries(node.attrs ?? {})) attrs.push(`${KEEP_ATTR_CASE.has(key) ? key : kebab(key)}="${escapeHtml(value)}"`);
  if (node.style && Object.keys(node.style).length) attrs.push(`style="${escapeHtml(styleText(node.style))}"`);
  const open = `<${node.tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  if (VOID.has(node.tag)) return `${open}>`;
  if (SVG_LEAF.has(node.tag) && !(node.children ?? []).length) return `${open}/>`;
  return `${open}>${(node.children ?? []).map(child => renderNode(child)).join('')}</${node.tag}>`;
}

const gsapProps = props => {
  const out = {};
  for (const [key, value] of Object.entries(props)) out[key === 'text' ? 'textContent' : key] = key === 'text' ? gsapText(value) : value;
  if ('strokeDashoffset' in out) out.autoRound = false;
  return out;
};

// GSAP owns the transform of every element the op list moves: its CSS
// transform comes off, and unless a tl.set at the module start already
// writes it, an equal tl.set leads the op list. GSAP composes translate,
// rotate and scale in that order, so the frames are unchanged, and nothing is
// left for GSAP to overwrite (HyperFrames' gsap_css_transform_conflict lint).
// Remotion keeps the CSS transforms: frameState applies the same ops over them.
const TRANSFORM_PROPS = new Set(['x', 'y', 'rotation', 'scale', 'scaleX', 'scaleY']);
const TRANSFORM_DEFAULTS = {x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1};
const TRANSFORM_ORDER = ['translate', 'rotate', 'scale'];

/** A view transform (translate px, rotate deg, scale; in GSAP's order) as GSAP props. */
export function transformProps(transform) {
  const props = {...TRANSFORM_DEFAULTS};
  const pattern = /(translate|rotate|scale)\(([^)]*)\)/g;
  const unsupported = () => new Error(`hyperframes emitter: unsupported transform ${transform}`);
  let rest = String(transform), last = -1;
  for (const [whole, fn, args] of String(transform).matchAll(pattern)) {
    const order = TRANSFORM_ORDER.indexOf(fn);
    if (order <= last) throw unsupported();
    last = order;
    const units = fn === 'translate' ? /^-?[\d.]+(e-?\d+)?(px)?$/ : fn === 'rotate' ? /^-?[\d.]+(e-?\d+)?(deg)?$/ : /^-?[\d.]+(e-?\d+)?$/;
    const parts = args.split(',').map(value => value.trim());
    if (parts.some(value => !units.test(value))) throw unsupported();
    const values = parts.map(value => Number.parseFloat(value));
    if (fn === 'translate') [props.x, props.y = 0] = values;
    else if (fn === 'rotate') props.rotation = values[0];
    else [props.scaleX, props.scaleY = values[0]] = values;
    rest = rest.replace(whole, '');
  }
  if (rest.trim()) throw unsupported();
  return props;
}

/**
 * The view (one node, or {front, behind, media, overlay} parts) with
 * GSAP-owned transforms taken off, and the op list with the tl.set ops that
 * put them back. A transform GSAP cannot express stays in the CSS.
 */
export function gsapOwnedTransforms(view, ops, start) {
  const moved = new Set(ops.filter(op => Object.keys(op.props ?? {...op.from, ...op.to}).some(key => TRANSFORM_PROPS.has(key))).map(op => op.target));
  const opening = ops.filter(op => op.type === 'set' && Math.abs(op.time - start) < 1e-6);
  const written = (id, key) => opening.some(op => op.target === id && (key in op.props || (key.startsWith('scale') && 'scale' in op.props)));
  const sets = [];
  const strip = node => {
    if (!node || typeof node !== 'object') return node;
    let style = node.style;
    if (node.id && moved.has(node.id) && style?.transform) {
      let props = null;
      try { props = transformProps(style.transform); } catch { /* keep the CSS */ }
      if (props) {
        const {transform, ...others} = style;
        style = others;
        // A tl.set at the start that writes every non-default value already owns it.
        if (Object.entries(props).some(([key, value]) => value !== TRANSFORM_DEFAULTS[key] && !written(node.id, key))) sets.push({type: 'set', target: node.id, time: start, props});
      }
    }
    return {...node, ...(style ? {style} : {}), children: (node.children ?? []).map(strip)};
  };
  const out = typeof view?.tag === 'string' ? strip(view) : Object.fromEntries(Object.entries(view).map(([part, node]) => [part, node ? strip(node) : node]));
  return {view: out, ops: [...sets, ...ops]};
}

/** GSAP calls for a renderer-neutral op list, against a host timeline `tl`. */
export function opsToGsap(ops) {
  return ops.map(op => {
    const target = js(`#${op.target}`);
    if (op.type === 'set') return `tl.set(${target}, ${js(gsapProps(op.props))}, ${op.time});`;
    if (op.type === 'tween') {
      const to = {...gsapProps(op.to), duration: op.duration, ease: op.ease, immediateRender: false};
      return `tl.fromTo(${target}, ${js(gsapProps(op.from))}, ${js(to)}, ${op.start});`;
    }
    if (op.type === 'loop') return `tl.fromTo(${target}, ${js(op.from)}, ${js({...op.to, duration: op.cycle, ease: 'none', repeat: op.repeats - 1, immediateRender: false})}, ${op.start});`;
    throw new Error(`unknown op type ${op.type}`);
  });
}

/** Emitter shared by every catalogue B module: {html, css, motion, events, layout}. */
export function emitCatalogB(model) {
  const {view, ops} = gsapOwnedTransforms(catalogBView(model), catalogBTimeline(model), model.start);
  const timed = `class="clip lc-catalog-b" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}" data-module="${model.module}"`;
  const html = renderNode(view, timed);
  const css = `#${model.id}{pointer-events:none}#${model.id} svg{display:block}`;
  const motion = opsToGsap(ops).join('\n');
  return {html, css, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

export const EMITTERS = {
  'logo-row': emitCatalogB,
  'archive-card': emitCatalogB,
  'process-steps': emitCatalogB,
  'flow-compare': emitCatalogB,
  'gauge-compare': emitCatalogB,
  'function-chart': emitCatalogB,
  'brand-lockup': emitCatalogB,
};
