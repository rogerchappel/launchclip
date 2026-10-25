// HyperFrames emitters for catalogue G (the visual vocabulary). Same shape
// as catalogue B's: the shared view tree serialised to HTML and the op list
// emitted as calls on the host's paused GSAP timeline.

import {catalogGTimeline, catalogGView} from '../core/catalog-g.mjs';
import {gsapOwnedTransforms, opsToGsap, renderNode} from './catalog-b.mjs';

export function emitCatalogG(model) {
  const {view, ops} = gsapOwnedTransforms(catalogGView(model), catalogGTimeline(model), model.start);
  const timed = `class="clip lc-catalog-g" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}" data-module="${model.module}"`;
  const html = renderNode(view, timed);
  const css = `#${model.id}{pointer-events:none}#${model.id} svg{display:block}`;
  const motion = opsToGsap(ops).join('\n');
  return {html, css, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

export const EMITTERS = {
  'concept-card': emitCatalogG,
  'icon-row': emitCatalogG,
  'section-card': emitCatalogG,
  'object-card': emitCatalogG,
  'stat-card': emitCatalogG,
  'quote-card': emitCatalogG,
  'excerpt': emitCatalogG,
  'compare': emitCatalogG,
  'timeline': emitCatalogG,
};
