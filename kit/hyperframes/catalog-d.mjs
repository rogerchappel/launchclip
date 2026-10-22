// HyperFrames emitter for catalogue D (product-demo).
//
// The model comes from kit/core/catalog-d.mjs. Markup is the shared view
// serialised by catalogue B's renderNode, motion the shared op list as
// tl.set / tl.fromTo calls. HyperFrames only seeks root media, so the
// <video> (html) is hoisted to the composition root by the story compiler,
// and the overlay (highlights and callouts, returned as `overlay`) is hoisted
// one z-index above it, so it is drawn over the video it annotates.

import {productDemoTimeline, productDemoView} from '../core/catalog-d.mjs';
import {opsToGsap, renderNode} from './catalog-b.mjs';

/** {html: the <video>, overlay: the annotation layer, css, motion, events, layout}. */
export function emitProductDemo(model) {
  const view = productDemoView(model);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}"${extra}`;
  const html = renderNode(view.media, `${timed(model.track)} data-media-start="${model.content.media.sourceStart}" data-module="product-demo"`);
  const overlay = renderNode(view.overlay, timed(model.track + 1, ' data-layout-allow-occlusion="true" data-module="product-demo"'));
  const css = `#${model.id}-overlay{pointer-events:none}`;
  const motion = opsToGsap(productDemoTimeline(model)).join('\n');
  return {html, overlay, css, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

export const EMITTERS = {
  'product-demo': emitProductDemo,
};
