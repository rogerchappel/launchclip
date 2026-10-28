// HyperFrames emitters for catalogue D (product-demo, photo-scene, evidence-clip).
//
// The model comes from kit/core/catalog-d.mjs. Markup is the shared view
// serialised by catalogue B's renderNode, motion the shared op list as
// tl.set / tl.fromTo calls. The <video> (html) is hoisted to the composition
// root by the story compiler, and the overlay (highlights and callouts,
// returned as `overlay`) one z-index above it, so it is drawn over the video
// it annotates. On a world plate both stay in the plate, in that order, and
// ride the camera (story-compiler.mjs soleVideo).

import {evidenceClipTimeline, evidenceClipView, photoSceneTimeline, photoSceneView, productDemoTimeline, productDemoView} from './catalog-d.mjs';
import {gsapOwnedTransforms, opsToGsap, renderNode} from './hyperframes-catalog-b.mjs';

/** {html: the <video>, overlay: the annotation layer, css, motion, events, layout}. */
export function emitProductDemo(model) {
  const {view, ops} = gsapOwnedTransforms(productDemoView(model), productDemoTimeline(model), model.start);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}"${extra}`;
  const html = renderNode(view.media, `${timed(model.track)} data-media-start="${model.content.media.sourceStart}" data-module="product-demo"`);
  const overlay = renderNode(view.overlay, timed(model.track + 1, ' data-layout-allow-occlusion="true" data-module="product-demo"'));
  const css = `#${model.id}-overlay{pointer-events:none}`;
  const motion = opsToGsap(ops).join('\n');
  return {html, overlay, css, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

/**
 * photo-scene: a video is hoisted like product-demo's (html: the <video>,
 * overlay: the scrim and text one z-index above); an image stays in the
 * scene layer with its overlay, so it also follows a world camera.
 */
export function emitPhotoScene(model) {
  const {view, ops} = gsapOwnedTransforms(photoSceneView(model), photoSceneTimeline(model), model.start);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}"${extra}`;
  const css = `#${model.id}-overlay{pointer-events:none}`;
  const motion = opsToGsap(ops).join('\n');
  const out = {css, motion, events: model.events.map(event => ({...event})), layout: {...model.layout}};
  if (model.content.media.kind === 'video') {
    return {...out, html: renderNode(view.media, `${timed(model.track)} data-media-start="${model.content.media.sourceStart}" data-module="photo-scene"`),
      overlay: renderNode(view.overlay, timed(model.track + 1, ' data-layout-allow-occlusion="true" data-module="photo-scene"'))};
  }
  const frame = {tag: 'div', id: `${model.id}-frame`, style: {position: 'absolute', left: 0, top: 0, width: model.canvas.width, height: model.canvas.height}, children: [view.media, view.overlay]};
  return {...out, html: renderNode(frame, `${timed(model.track)} data-module="photo-scene"`)};
}

/** evidence-clip: the <video> hoisted like product-demo's, the frame, cursor and source tag one z-index above. */
export function emitEvidenceClip(model) {
  const {view, ops} = gsapOwnedTransforms(evidenceClipView(model), evidenceClipTimeline(model), model.start);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}"${extra}`;
  const html = renderNode(view.media, `${timed(model.track)} data-media-start="${model.content.media.sourceStart}" data-module="evidence-clip"`);
  const overlay = renderNode(view.overlay, timed(model.track + 1, ' data-layout-allow-occlusion="true" data-module="evidence-clip"'));
  return {html, overlay, css: `#${model.id}-overlay{pointer-events:none}`, motion: opsToGsap(ops).join('\n'), events: model.events.map(event => ({...event})), layout: {...model.layout}};
}

export const EMITTERS = {
  'product-demo': emitProductDemo,
  'photo-scene': emitPhotoScene,
  'evidence-clip': emitEvidenceClip,
};
