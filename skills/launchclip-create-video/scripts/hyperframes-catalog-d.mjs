// HyperFrames emitters for catalogue D (product-demo, photo-scene, evidence-clip,
// clip and the media layouts).
//
// The model comes from kit/core/catalog-d.mjs. Markup is the shared view
// serialised by catalogue B's renderNode, motion the shared op list as
// tl.set / tl.fromTo calls. The <video> (html) is hoisted to the composition
// root by the story compiler, and the overlay (highlights and callouts,
// returned as `overlay`) one z-index above it, so it is drawn over the video
// it annotates. On a world plate both stay in the plate, in that order, and
// ride the camera (story-compiler.mjs soleVideo).

import {MEDIA_LAYOUTS, clipTimeline, clipView, setPropTimeline, setPropView, evidenceClipTimeline, evidenceClipView, photoSceneTimeline, photoSceneView, mediaLayoutTimeline, mediaLayoutView, productDemoTimeline, productDemoView} from './catalog-d.mjs';
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

/**
 * clip: like photo-scene, a video is hoisted (html: the <video>, overlay: the
 * callout pills one z-index above), trimmed to media.sourceStart; a still stays
 * in the scene layer with its overlay, so it also follows a world camera.
 */
export function emitClip(model) {
  const {view, ops} = gsapOwnedTransforms(clipView(model), clipTimeline(model), model.start);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}"${extra}`;
  const out = {css: `#${model.id}-overlay{pointer-events:none}`, motion: opsToGsap(ops).join('\n'), events: model.events.map(event => ({...event})), layout: {...model.layout}};
  if (model.content.media.kind === 'video') {
    return {...out, html: renderNode(view.media, `${timed(model.track)} data-media-start="${model.content.media.sourceStart}" data-module="clip"`),
      overlay: renderNode(view.overlay, timed(model.track + 1, ' data-layout-allow-occlusion="true" data-module="clip"'))};
  }
  const frame = {tag: 'div', id: `${model.id}-frame`, style: {position: 'absolute', left: 0, top: 0, width: model.canvas.width, height: model.canvas.height}, children: [view.media, view.overlay]};
  return {...out, html: renderNode(frame, `${timed(model.track)} data-module="clip"`)};
}

/**
 * set-prop: a drawn prop or an image stays in the scene layer with its
 * contact shadow (so it also follows a world camera); a video is the html
 * alone, hoisted to the root like clip's (on a world plate it stays in the
 * plate). The per-frame ops move the element itself, so either way it
 * follows the plate's camera.
 */
export function emitSetProp(model) {
  const {view, ops} = gsapOwnedTransforms(setPropView(model), setPropTimeline(model), model.start);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}"${extra}`;
  const out = {css: '', motion: opsToGsap(ops).join('\n'), events: model.events.map(event => ({...event})), layout: {...model.layout}};
  if (view.media) return {...out, html: renderNode(view.media, `${timed(model.track)} data-media-start="${model.content.media.sourceStart}" data-module="set-prop"`)};
  return {...out, html: renderNode(view.front, `${timed(model.track)} data-module="set-prop"`)};
}

/**
 * The media layouts: html is the base (fill, panel) with every window in it;
 * the story compiler hoists each <video> to the root (each on its own track,
 * timed to the scene and trimmed to its sourceStart), so the overlay
 * (dividers, chips, text) is hoisted one z-index above them. With no video
 * the base, the framed stills and the overlay stay together in the scene
 * layer, so they also follow a world camera.
 */
export function emitMediaLayout(model) {
  const raw = mediaLayoutView(model);
  const timed = (track, extra = '') => `class="clip" data-start="${model.start}" data-duration="${model.duration}" data-track-index="${track}"${extra}`;
  const windows = raw.windows.map((node, i) => {
    const media = model.content.windows[i].media;
    if (media.kind !== 'video') return node;
    return {...node, attrs: {...node.attrs, class: 'clip', 'data-start': model.start, 'data-duration': model.duration, 'data-media-start': media.sourceStart, 'data-track-index': model.track}};
  });
  const hoists = model.content.windows.some(win => win.media.kind === 'video');
  const frame = {tag: 'div', id: `${model.id}-frame`, style: {position: 'absolute', left: 0, top: 0, width: model.canvas.width, height: model.canvas.height}, children: [raw.base, ...windows, ...(hoists ? [] : [raw.overlay])]};
  const {view, ops} = gsapOwnedTransforms({frame, overlay: raw.overlay}, mediaLayoutTimeline(model), model.start);
  const out = {css: `#${model.id}-overlay{pointer-events:none}`, motion: opsToGsap(ops).join('\n'), events: model.events.map(event => ({...event})), layout: {...model.layout}};
  if (!hoists) return {...out, html: renderNode(view.frame, timed(model.track, ` data-module="${model.module}"`))};
  return {...out, html: renderNode(view.frame, timed(model.track, ` data-module="${model.module}"`)),
    overlay: renderNode(view.overlay, timed(model.track + 1, ` data-layout-allow-occlusion="true" data-module="${model.module}"`))};
}

export const EMITTERS = {
  'product-demo': emitProductDemo,
  'photo-scene': emitPhotoScene,
  'set-prop': emitSetProp,
  'evidence-clip': emitEvidenceClip,
  clip: emitClip,
  ...Object.fromEntries(MEDIA_LAYOUTS.map(def => [def.id, emitMediaLayout])),
};
