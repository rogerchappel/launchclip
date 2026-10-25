// HyperFrames emitters for catalogue G (the visual vocabulary). Same shape
// as catalogue B's: the shared view tree serialised to HTML and the op list
// emitted as calls on the host's paused GSAP timeline.

import {catalogGTimeline, catalogGView} from './catalog-g.mjs';
import {opsToGsap, renderNode} from './hyperframes-catalog-b.mjs';

export function emitCatalogG(model) {
  const timed = `class="clip lc-catalog-g" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}" data-module="${model.module}"`;
  const html = renderNode(catalogGView(model), timed);
  const css = `#${model.id}{pointer-events:none}#${model.id} svg{display:block}`;
  const motion = opsToGsap(catalogGTimeline(model)).join('\n');
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
};
