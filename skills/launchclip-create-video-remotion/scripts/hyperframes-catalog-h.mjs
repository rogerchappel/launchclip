// HyperFrames emitters for catalogue H (the element library). Same shape as
// catalogue B's: the shared view tree serialised to HTML and the op list
// emitted as calls on the host's paused GSAP timeline. Blur and clip props
// become CSS filter and clip-path strings, which GSAP tweens number by
// number, the same values Remotion's frameState computes.

import {MODULES, catalogHTimeline, catalogHView, cssProps} from './catalog-h.mjs';
import {gsapOwnedTransforms, opsToGsap, renderNode} from './hyperframes-catalog-b.mjs';
import {PARTICLE_RUNTIME} from './particles.mjs';

const num = value => Math.round(value * 1e4) / 1e4;

/**
 * Paint plans (kit/core/particles.mjs): the painter, once per page, and per
 * canvas a proxy tween over the scene whose onUpdate paints the frame at the
 * timeline's time. The painter is a pure function of (plan, t), so seeking
 * draws what Remotion draws at the same instant.
 */
export function paintMotion(model) {
  const paint = model.content?.paint;
  if (!paint || !Object.keys(paint).length) return '';
  const lines = [PARTICLE_RUNTIME];
  for (const [canvasId, plan] of Object.entries(paint)) {
    lines.push(`(function () {
  var canvas = document.getElementById(${JSON.stringify(canvasId)}), c2 = canvas.getContext('2d'), plan = ${JSON.stringify(plan).replace(/</g, '\\u003c')}, clock = {t: ${num(model.start)}};
  window.lcPaintParticles(c2, plan, clock.t);
  tl.fromTo(clock, {t: ${num(model.start)}}, {t: ${num(model.end)}, duration: ${num(model.end - model.start)}, ease: 'none', immediateRender: false, onUpdate: function () { window.lcPaintParticles(c2, plan, clock.t); }}, ${num(model.start)});
})();`);
  }
  return lines.join('\n');
}

export function emitCatalogH(model) {
  const {view, ops} = gsapOwnedTransforms(catalogHView(model), catalogHTimeline(model), model.start);
  const css = op => (op.type === 'set' ? {...op, props: cssProps(op.props)} : op.type === 'tween' ? {...op, from: cssProps(op.from), to: cssProps(op.to)} : op);
  const timed = `class="clip lc-catalog-h" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}" data-module="${model.module}"`;
  const html = renderNode(view, timed);
  const style = `#${model.id}{pointer-events:none}#${model.id} svg{display:block}`;
  const motion = [opsToGsap(ops.map(css)).join('\n'), paintMotion(model)].filter(Boolean).join('\n');
  return {html, css: style, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

export const EMITTERS = Object.fromEntries(Object.keys(MODULES).map(id => [id, emitCatalogH]));
