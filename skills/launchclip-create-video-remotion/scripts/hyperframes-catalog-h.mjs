// HyperFrames emitters for catalogue H (the element library). Same shape as
// catalogue B's: the shared view tree serialised to HTML and the op list
// emitted as calls on the host's paused GSAP timeline. Blur and clip props
// become CSS filter and clip-path strings, which GSAP tweens number by
// number, the same values Remotion's frameState computes.

import {MODULES, catalogHTimeline, catalogHView, cssProps} from './catalog-h.mjs';
import {gsapOwnedTransforms, opsToGsap, renderNode} from './hyperframes-catalog-b.mjs';

export function emitCatalogH(model) {
  const {view, ops} = gsapOwnedTransforms(catalogHView(model), catalogHTimeline(model), model.start);
  const css = op => (op.type === 'set' ? {...op, props: cssProps(op.props)} : op.type === 'tween' ? {...op, from: cssProps(op.from), to: cssProps(op.to)} : op);
  const timed = `class="clip lc-catalog-h" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}" data-module="${model.module}"`;
  const html = renderNode(view, timed);
  const style = `#${model.id}{pointer-events:none}#${model.id} svg{display:block}`;
  const motion = opsToGsap(ops.map(css)).join('\n');
  return {html, css: style, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

export const EMITTERS = Object.fromEntries(Object.keys(MODULES).map(id => [id, emitCatalogH]));
