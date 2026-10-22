// HyperFrames emitters for catalogue B (function-chart, gauge-compare,
// flow-compare, process-steps, archive-card, logo-row).
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

import {catalogBView, catalogBTimeline} from './catalog-b.mjs';
import {UNITLESS} from './catalog-b-view.mjs';

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
  for (const [key, value] of Object.entries(props)) out[key === 'text' ? 'textContent' : key] = value;
  if ('strokeDashoffset' in out) out.autoRound = false;
  return out;
};

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
  const view = catalogBView(model);
  const timed = `class="clip lc-catalog-b" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}" data-module="${model.module}"`;
  const html = renderNode(view, timed);
  const css = `#${model.id}{pointer-events:none}#${model.id} svg{display:block}`;
  const motion = opsToGsap(catalogBTimeline(model)).join('\n');
  return {html, css, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

export const EMITTERS = {
};
