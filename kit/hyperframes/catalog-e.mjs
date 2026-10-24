// HyperFrames emitters for catalogue E (product moments around the presenter).
//
// The model and view come from kit/core/catalog-e.mjs. The main html is the
// module's own layer (its behind tree for a behind module, else its front
// tree); a video is appended for the story compiler to hoist to the root,
// with the overlay returned as `overlay` so it is hoisted one z-index above
// it. An image stays in the scene layer, with the overlay after it. A split
// module returns its behind tree as `behind`, which the compiler draws under
// the subject. All motion is one op list; GSAP targets ids across parts.

import {catalogETimeline, catalogEView} from '../core/catalog-e.mjs';
import {opsToGsap, renderNode} from './catalog-b.mjs';

/** {html, overlay?, behind?, css, motion, events, layout}. */
export function emitCatalogE(model) {
  const view = catalogEView(model);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}" data-module="${model.module}"${extra}`;
  const main = model.layer === 'behind' ? view.behind : view.front;
  const out = {css: `#${model.id}-overlay{pointer-events:none}`, motion: opsToGsap(catalogETimeline(model)).join('\n'), events: model.events.map(event => ({...event})), layout: {...model.layout}};
  let html = renderNode(main, timed(model.track));
  if (view.media?.tag === 'video') {
    html += renderNode(view.media, timed(model.track, ` data-media-start="${model.content.media?.sourceStart ?? model.content.backdrop?.sourceStart ?? 0}"`));
    if (view.overlay) out.overlay = renderNode(view.overlay, timed(model.track + 1, ' data-layout-allow-occlusion="true"'));
  } else {
    if (view.media) html = html.replace(/<\/div>$/, `${renderNode(view.media)}</div>`);
    if (view.overlay) html = html.replace(/<\/div>$/, `${renderNode(view.overlay)}</div>`);
  }
  if (model.layer === 'split' && view.behind) out.behind = {html: renderNode(view.behind, timed(model.track)), css: '', motion: ''};
  return {...out, html};
}

export const EMITTERS = {
  'feed-frame': emitCatalogE,
  'pull-back': emitCatalogE,
  'backdrop-swap': emitCatalogE,
  'app-stage': emitCatalogE,
  'phone-stage': emitCatalogE,
  'growth-line': emitCatalogE,
};
