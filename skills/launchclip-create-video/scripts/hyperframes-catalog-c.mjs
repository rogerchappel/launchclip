// HyperFrames emitters for catalogue C (punch-in, footage-callout,
// lower-third, emphasis-caption) and the base camera.
//
// The model comes from kit/core/catalog-c.mjs. Markup is the shared view tree
// serialised by catalogue B's renderNode, so the DOM matches the Remotion
// components exactly; motion is the shared op list emitted as tl.set /
// tl.fromTo calls (immediateRender:false, explicit from values, no callbacks
// or clocks), so the paused timeline is seek-safe.
//
// punch-in draws nothing itself: its model.camera is merged by cameraGsap()
// into tl.set calls on every root base <video> (the story compiler owns the
// base, because HyperFrames only seeks media that are direct root children).

import {BASE_CAMERA, cameraOps, catalogCTimeline, catalogCView} from './catalog-c.mjs';
import {opsToGsap, renderNode} from './hyperframes-catalog-b.mjs';

/** Emitter shared by every catalogue C module: {html, css, motion, events, layout}. */
export function emitCatalogC(model) {
  const view = catalogCView(model);
  const timed = `class="clip lc-catalog-c" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${model.track}" data-module="${model.module}"${model.camera ? ' data-launchclip-camera="base"' : ''}`;
  const html = renderNode(view, timed);
  const css = `#${model.id}{pointer-events:none}#${model.id} svg{display:block}`;
  const motion = opsToGsap(catalogCTimeline(model)).join('\n');
  return {html, css, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

/**
 * GSAP calls that move the base: every camera in `models`, as tl.set calls on
 * `selector` (default the compiler's root base videos, ".lc-base-media").
 */
export function cameraGsap(models, selector = '.lc-base-media', options = {}) {
  const from = JSON.stringify(`#${BASE_CAMERA}`), to = JSON.stringify(selector);
  return opsToGsap(cameraOps(models, options)).map(line => line.replace(from, to));
}

export const EMITTERS = {
  'punch-in': emitCatalogC,
  'footage-callout': emitCatalogC,
  'lower-third': emitCatalogC,
  'emphasis-caption': emitCatalogC,
  'masthead': emitCatalogC,
  'dolly-zoom': emitCatalogC,
};
