// storyboard.json (resolved) → a complete HyperFrames project.
//
//   const {html, files, warnings} = await compileStoryToHyperFrames(resolvedStory, {projectDir, sourceDir, sceneFilter});
//
// The output follows the standalone HyperFrames runtime contract
// (skills-src/references/standalone-hyperframes.md): one root with
// data-composition-id / data-duration / data-width / data-height, one paused
// GSAP timeline registered on window.__timelines, every module's emitter
// html/css/motion inside a scene layer, typed transitions between track-0
// scenes (kit/core/transitions.mjs, shared with the Remotion kit), the phase-2
// boundary attributes from deriveBoundaries, the footage-led base (root
// <video>s per trim segment, moved by punch-in cameras), one root <audio> (audio.mix, or
// the voice), word captions (kit/core/captions.mjs), the loop ending and the
// brand fonts. Unknown modules render a labelled placeholder and a warning.
//
// Canonical copy: kit/hyperframes/story-compiler.mjs. Skills ship a copy whose
// ../core/ imports point at ./ (scripts/sync-skills.mjs).

import { copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { baseMediaStyle, deriveBoundaries, storyBase, validateStory } from '../core/story.mjs';
import { knownModules, placeholderModel, PLACEHOLDER_STYLE, resolveModule } from '../core/modules.mjs';
import { gsapVars, holdTime, layerStateAt, sceneWindows } from '../core/transitions.mjs';
import { CAMERA_STACK, resolveCamera, rideWorldPlates, backgroundFieldTiles, backgroundLayer, cameraPlan, captionDipWindows, overlayOps, placementTransform, sceneObjectLookup } from '../core/camera-world.mjs';
import { getEase } from '../core/motion.mjs';
import { ambientField, blobBackground, fieldTileTransform, blobStateAt, blobTweens, driftGsap, sceneDrift } from '../core/ambient.mjs';
import { backgroundPlan, fieldStyle, layerCss, layerSvg, layerTweens, layoutFillClip, panelFillPlan, sceneBackground } from '../core/backgrounds.mjs';
import { scenePlatePlan, scenePlateSpec, storyPlatePlan } from '../core/plates.mjs';
import { worldBackdrops } from '../core/world-backdrops.mjs';
import { shotZooms, zoomOps } from '../core/zooms.mjs';
import { profileGeometry } from '../core/layout-check.mjs';
import { CAPTION_DEFAULT_COLORS, captionChunksFrom, captionDipTweens, captionMoveHide, captionPlan, captionPlanRuntime, captionsOverlayOf, chunkWords, narrationWords } from '../core/captions.mjs';
import { brandFramePlan, brandFrameRuntime } from '../core/brand-frame.mjs';
import { MEDIUM_LAYER_ID, MEDIUM_Z, mediumDefs, mediumFilterAt, mediumPlan, mediumSteps } from '../core/medium.mjs';
import { brandFontStacks, fontFaceRule, fontSlug, frozenFontFaces, projectFontFamilies, registryFontFaces } from '../core/fonts.mjs';
import { EMITTERS as EDITORIAL_EMITTERS } from './editorial-ui-modules.mjs';
import { EMITTERS as CATALOG_A_EMITTERS } from './catalog-a.mjs';
import { EMITTERS as CATALOG_B_EMITTERS, opsToGsap } from './catalog-b.mjs';
import { EMITTERS as CATALOG_C_EMITTERS, cameraGsap } from './catalog-c.mjs';
import { EMITTERS as CATALOG_D_EMITTERS } from './catalog-d.mjs';
import { EMITTERS as CATALOG_E_EMITTERS } from './catalog-e.mjs';
import { EMITTERS as CATALOG_F_EMITTERS } from './catalog-f.mjs';
import { EMITTERS as CATALOG_G_EMITTERS } from './catalog-g.mjs';
import { EMITTERS as CATALOG_H_EMITTERS } from './catalog-h.mjs';
import { EMITTERS as CHARACTER_EMITTERS } from './catalog-characters.mjs';
import { EMITTERS as WORLD_EMITTERS } from './catalog-world.mjs';
import { cameraOverlaps } from '../core/catalog-c.mjs';
import { needsSubject, roomChanges, roomStateAt, sceneLayerOf, SUBJECT_CAMERA, subjectCameraOps, subjectFilterAt, subjectFilterChanges, subjectSegments, subjectWindows } from '../core/subject-layer.mjs';
import { LAYOUT_FRAME, layoutFrameStyle, layoutPlan, withLayoutCameras } from '../core/footage-layout.mjs';

export const COMPOSITION_ID = 'launchclip-story';
export const GSAP_SRC = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
const CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const FIRST_SCENE_TRACK = 2;
const TOGGLE_LEAD = 0.0005;

/** Every HyperFrames emitter, keyed by module id. */
export function hyperframesEmitters() {
  return { ...CATALOG_A_EMITTERS, ...CATALOG_B_EMITTERS, ...CATALOG_C_EMITTERS, ...CATALOG_D_EMITTERS, ...CATALOG_E_EMITTERS, ...CATALOG_F_EMITTERS, ...CATALOG_G_EMITTERS, ...CATALOG_H_EMITTERS, ...CHARACTER_EMITTERS, ...WORLD_EMITTERS, ...EDITORIAL_EMITTERS };
}

/**
 * Compile a resolved story into a HyperFrames project in options.projectDir.
 * options:
 *   projectDir   output directory (index.html, assets/); required when write is true
 *   sourceDir    the storyboard project holding assets/, captions and words (default projectDir)
 *   sceneFilter  scene id, id array or predicate: compile only those scenes on
 *                the background, without transitions, captions, audio or loop
 *                (the HyperFrames twin of the Remotion ModuleReview composition)
 *   window       [start, end] seconds: compile only that stretch of the
 *                story, as a composition from 0 whose every frame is the
 *                whole composition's frame at the same story time
 *                (finish --preview-scene; windowComposition)
 *   write        false to return {html, files} without touching the disk
 *   copyAssets   false to skip copying sourceDir/assets into projectDir
 * → {html, files: [relative paths written], warnings, boundaries, compositionId}
 */
export async function compileStoryToHyperFrames(story, options = {}) {
  const { projectDir, sceneFilter, window: span, write = true, copyAssets = true } = options;
  const sourceDir = options.sourceDir ?? projectDir;
  if (write && !projectDir) throw new Error('compileStoryToHyperFrames needs options.projectDir');
  const warnings = [];
  const known = knownModules();
  const validation = validateStory(story, { modules: known });
  const unknown = (message) => /\.module "[^"]+" is not a known module$/.test(message);
  // Unknown modules are reported once per scene by build() below.
  const errors = validation.errors.filter((message) => !unknown(message));
  if (errors.length) throw new Error(`storyboard.json is invalid:\n- ${errors.join('\n- ')}`);
  warnings.push(...validation.warnings);
  if (!story.resolved || story.scenes.some((scene) => typeof scene.start !== 'number' || typeof scene.end !== 'number')) {
    throw new Error('compileStoryToHyperFrames needs a resolved story (run resolveStory first)');
  }

  const format = { width: story.format.width, height: story.format.height, fps: story.resolved.fps, duration: story.resolved.duration };
  const W = format.width, H = format.height, D = format.duration;
  const isolate = sceneFilter !== undefined && sceneFilter !== null;
  const keep = sceneSelector(sceneFilter);
  const colors = story.brand?.colors ?? {};
  const bg = colors.bg ?? '#000000';
  const emitters = hyperframesEmitters();
  // Casts riding world plates (world mode) take their plate's window and travel with it.
  const windows = rideWorldPlates(story, sceneWindows(story));
  const layers = windows.scenes.filter((entry) => keep(entry.scene));
  if (isolate && !layers.length) throw new Error(`sceneFilter matched no scene (scenes: ${story.scenes.map((scene) => scene.id).join(', ')})`);
  if (isolate) for (const entry of layers) { entry.tweens = []; entry.renderEnd = entry.end; }

  // Footage-led base (storyBase: frame-snapped trim segments on the timeline).
  const base = storyBase(story);
  if (base && sourceDir && !existsSync(path.join(sourceDir, base.src))) warnings.push(`base recording ${base.src} was not found in ${sourceDir}`);
  if (base && story.base?.edl && !story.base?.trim) warnings.push(`base.edl ${story.base.edl} was not resolved into base.trim (pass the edit plan to resolveStory as {edl}); the base plays untrimmed`);

  // Footage layouts (kit/core/footage-layout.mjs): the story's sections, or
  // null without any (a module review has none).
  const layout = base && !isolate ? layoutPlan(story) : null;
  if (layout) warnings.push(...layout.warnings);

  // Subject layer (kit/core/subject-layer.mjs): mounted only when a scene
  // sits behind the cut-out presenter, moves it or treats the room (or a
  // layout section treats the room), so other stories compile byte for byte
  // as before.
  const subjectNeeded = Boolean(base) && (Boolean(layout?.rooms.length) || layers.some((entry) => {
    try { return needsSubject(entry.scene, resolveModule(entry.scene, story, { end: entry.renderEnd })); }
    catch { return entry.scene.layer === 'behind' || entry.scene.layer === 'split'; }
  }));

  // Tracks: 0 audio, 1 background, then (footage-led) 2 base video, 3 base
  // audio and (with a subject) 4 the subject mattes; each scene takes a pair
  // (root, root+1), reused once its render window has ended.
  const SUBJECT_TRACK = FIRST_SCENE_TRACK + 2;
  const firstTrack = base ? FIRST_SCENE_TRACK + (subjectNeeded ? 3 : 2) : FIRST_SCENE_TRACK;
  const trackEnds = [];
  const allocate = (start, end) => {
    let slot = trackEnds.findIndex((until) => until <= start + 1e-6);
    if (slot < 0) { slot = trackEnds.length; trackEnds.push(end); } else trackEnds[slot] = end;
    return firstTrack + slot * 2;
  };

  const css = [];
  const markup = [];
  const hoisted = [];
  const motion = [];
  const hide = [];
  const boundaries = isolate ? [] : deriveBoundaries(story);
  // Ambient motion (kit/core/ambient.mjs): the background field inside every
  // track-0 plate and the hold drift wrapper around each scene's content. A
  // sceneFilter compile is a module review and, like ModuleReview, has none.
  // A story.background kind other than blobs (kit/core/backgrounds.mjs)
  // replaces the field with its layers, in the same places.
  // A backdrop plate (kit/core/plates.mjs) replaces the background on the
  // scenes it covers, one per chapter. In world mode the plates are the
  // camera's backdrops (kit/core/world-backdrops.mjs), changing with its
  // moves; story.background (or the depth layer's field and glows) shows
  // only where a shot has none.
  const worldCamera = !isolate && resolveCamera(story).mode === 'world';
  const everyShotPlated = (story.scenes ?? []).filter((scene) => (scene.track ?? 0) === 0).every((scene) => scenePlateSpec(story, scene));
  const backdrop = isolate ? null : worldCamera ? backgroundPlan(story) : storyPlatePlan(story) ?? backgroundPlan(story);
  const field = isolate || backdrop || (worldCamera && everyShotPlated && storyPlatePlan(story)) ? null : ambientField(story);
  const plateFor = (scene) => (isolate ? null : scenePlatePlan(story, scene));
  const drawsBackground = (scene) => Boolean(plateFor(scene)) || sceneBackground(story, scene);
  const geometry = profileGeometry({ width: W, height: H });
  const backdropLayer = (key, from, to, backdrop) => {
    const html = backdrop.layers.map((layer) => `<div id="lc-bg-${key}-${layer.id}" class="lc-bg-layer" style="${layerCss(layer, from)}">${layerSvg(layer) ?? ''}</div>`).join('');
    const lines = backdrop.layers.flatMap((layer) => layerTweens(layer, from, to).map((tw) => `tl.fromTo(${js(`#lc-bg-${key}-${layer.id}`)}, ${js({ [tw.prop]: tw.from, force3D: false })}, ${js({ [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false, force3D: false })}, ${num(tw.at)});`));
    const mask = Object.entries(fieldStyle(backdrop)).map(([prop, value]) => `${prop === 'WebkitMaskImage' ? '-webkit-mask-image' : 'mask-image'}:${value}`).join(';');
    return { html: `<div id="lc-bg-field-${key}" class="lc-ambient-field" data-launchclip-background="${backdrop.kind}" aria-hidden="true"${mask ? ` style="${mask}"` : ''}>${html}</div>`, motion: lines };
  };
  const fieldLayer = (key, from, to, scene) => {
    const plate = plateFor(scene);
    if (plate) return backdropLayer(key, from, to, plate);
    if (backdrop) return backdropLayer(key, from, to, backdrop);
    if (!field) return { html: '', motion: [] };
    const html = field.blobs.map((blob) => {
      const state = blobStateAt(blob, from);
      return `<div id="lc-amb-${key}-${blob.id}" class="lc-ambient-blob" style="width:${num(blob.size)}px;height:${num(blob.size)}px;background:${blobBackground(blob)};transform:translate(${num(state.x)}px, ${num(state.y)}px) scale(${round(state.scale, 5)})"></div>`;
    }).join('');
    const lines = field.blobs.flatMap((blob) => blobTweens(blob, from, to).map((tw) => `tl.fromTo(${js(`#lc-amb-${key}-${blob.id}`)}, ${js({ [tw.prop]: tw.from, force3D: false })}, ${js({ [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false, force3D: false })}, ${num(tw.at)});`));
    return { html: `<div id="lc-amb-field-${key}" class="lc-ambient-field" aria-hidden="true">${html}</div>`, motion: lines };
  };
  // World mode: the field as one continuous backdrop in the depth layer.
  // Every copy of a blob (camera-world.mjs backgroundFieldTiles) sits in a
  // static translate wrapper and shares the blob's class, so one set of
  // tweens per blob moves all of its copies; nothing is clipped, so the field
  // has no edge anywhere the camera travels.
  const worldFieldLayer = (tiles) => {
    if (!field || !tiles.length) return { html: '', motion: [] };
    const byId = new Map(field.blobs.map((blob) => [blob.id, blob]));
    const html = tiles.map((tile) => {
      const blob = byId.get(tile.blob);
      const state = blobStateAt(blob, 0);
      return `<div class="lc-world-tile" style="transform:${fieldTileTransform(tile)}"><div class="lc-ambient-blob lc-amb-world-${blob.id}" style="width:${num(blob.size)}px;height:${num(blob.size)}px;background:${blobBackground(blob)};transform:translate(${num(state.x)}px, ${num(state.y)}px) scale(${round(state.scale, 5)})"></div></div>`;
    }).join('');
    const used = field.blobs.filter((blob) => tiles.some((tile) => tile.blob === blob.id));
    const lines = used.flatMap((blob) => blobTweens(blob, 0, D).map((tw) => `tl.fromTo(${js(`.lc-amb-world-${blob.id}`)}, ${js({ [tw.prop]: tw.from, force3D: false })}, ${js({ [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false, force3D: false })}, ${num(tw.at)});`));
    return { html: `<div id="lc-amb-field-world" class="lc-world-field" aria-hidden="true">${html}</div>`, motion: lines };
  };
  const boundaryFor = new Map(boundaries.map((entry) => [entry.to_id, entry]));
  let z = CAMERA_STACK.scenes;
  // With a subject, behind scenes stack from 10 under the matte layer and
  // every other scene from above it.
  let zBehind = 10;
  const subjectZ = 10 + 10 * (layers.length + 1);
  if (subjectNeeded) z = subjectZ + 10;
  const sceneLayers = [];
  // Set once a cuts-mode shot zooms (kit/core/zooms.mjs): its wrappers need CSS.
  let usesZoom = false;
  // World camera (kit/core/camera-world.mjs): world mode, or a camera
  // transition in a cuts story. Plates then live inside one world container
  // (#lc-cam-pan in #lc-cam-zoom in #lc-cam-drift in #lc-camera) that the
  // camera ops move; without a camera nothing below changes.
  const plan = isolate ? null : cameraPlan(story, { windows, objects: sceneObjectLookup(story, (scene, value) => resolveModule(scene, value)) });
  if (plan?.warnings?.length) warnings.push(...plan.warnings);
  const world = [];
  const cameraMotion = plan ? cameraGsapLines(plan) : [];
  const worldField = plan?.background ? worldFieldLayer(backgroundFieldTiles(plan, field)) : { html: '', motion: [] };
  cameraMotion.push(...worldField.motion);
  // World mode: the plates travel with the camera as backdrops over the
  // depth layer; a background kind stays fixed to the screen under the camera
  // (in #lc-bg), in place of the depth layer's glows, where a shot has none.
  const backdrops = plan?.mode === 'world' ? worldBackdrops(story, plan, windows) : null;
  const covered = Boolean(backdrops?.segments.every((segment) => segment.plan));
  const stack = backdrops ? worldBackdropStack(backdrops, bg) : null;
  if (stack) cameraMotion.push(...stack.motion);
  const worldBackdrop = plan?.mode === 'world' && backdrop && !covered ? backdropLayer('world', 0, D, backdrop) : null;
  if (worldBackdrop) cameraMotion.push(...worldBackdrop.motion);
  const plateStyle = (sceneId, placement) => (plan && placement ? `;transform-origin:0 0;transform:${placementTransform(placement)}` : '');

  const build = (entry, { idSuffix = '', track, clone = false, held = false } = {}) => {
    const scene = idSuffix ? { ...entry.scene, id: `${entry.scene.id}${idSuffix}` } : entry.scene;
    const end = clone && !held ? entry.scene.end : entry.renderEnd;
    let model;
    let reason = null;
    if (scene.module === 'custom') reason = 'custom modules render only in Remotion (remotion/modules/); use a catalogue module for HyperFrames';
    else {
      try { model = resolveModule(scene, story, { track, end }); }
      catch (error) { reason = error.message; }
    }
    if (model && !emitters[model.module]) reason = `no HyperFrames emitter for module "${model.module}"`;
    if (reason) {
      if (!clone) warnings.push(`${entry.scene.id}: ${reason}; rendering a placeholder`);
      model = placeholderModel(scene, story, reason, { end });
      model.track = track;
      return { model, out: emitPlaceholder(model) };
    }
    let out;
    try { out = emitters[model.module](model); }
    catch (error) {
      if (!clone) warnings.push(`${entry.scene.id}: HyperFrames emitter for "${model.module}" failed (${error.message}); rendering a placeholder`);
      model = placeholderModel(scene, story, error.message, { end });
      model.track = track;
      out = emitPlaceholder(model);
    }
    return { model, out };
  };

  const models = [];
  for (const entry of layers) {
    const track = allocate(entry.start, entry.renderEnd);
    const { model, out } = build(entry, { track });
    models.push(model);
    const depth = subjectNeeded ? sceneLayerOf(entry.scene, model) : { layer: 'front' };
    if (depth.reason) warnings.push(`${entry.scene.id}: ${depth.reason}`);
    sceneLayers.push(depth.layer);
    const sceneZ = depth.layer === 'behind' ? zBehind : z;
    if (model.hidesCaptions) hide.push([entry.start, entry.renderEnd]);
    const id = attr(entry.scene.id);
    const outer = `lc-scene-${id}`, inner = `lc-layer-${id}`;
    const inWorld = Boolean(plan && (entry.plate || entry.rides));
    // On a world plate a module whose html is its <video> alone (evidence-clip,
    // product-demo…) keeps it, and its overlay, inside the plate, so the
    // camera's moves and zooms carry it as they carry the rest of the plate.
    const inCamera = inWorld && soleVideo(out.html);
    const media = inCamera ? { html: `${out.html}${out.overlay ?? ''}`, elements: [] } : hoistMedia(out.html ?? '');
    // A module whose own layer is a timed clip on its track and which also
    // hoists a video (backdrop-swap, app-stage…) gives the video its own track,
    // or the two clips overlap on one track.
    const own = `data-track-index="${model.track}"`;
    if (media.html.includes(own)) media.elements = media.elements.map((element) => (element.includes(own) ? element.replace(own, `data-track-index="${allocate(entry.start, entry.renderEnd)}"`) : element));
    for (const element of media.elements) hoisted.push(withZIndex(element, sceneZ + 5));
    // An emitter's `overlay` annotates its root media (product-demo), so it is
    // hoisted too, one z-index above the video.
    if (out.overlay && !inCamera) {
      media.elements.push(out.overlay);
      hoisted.push(withZIndex(out.overlay, sceneZ + 6));
    }
    const mediaMotion = [];
    for (const element of media.elements) {
      const follow = mediaLayerTweens(element, entry.tweens);
      mediaMotion.push(...follow.lines);
      if (follow.unsupported.length) warnings.push(`${entry.scene.id}: root media does not follow the ${follow.unsupported.join(', ')} of its ${entry.transitionIn?.type ?? 'transition'} (HyperFrames keeps <video>/<audio> on the root)`);
    }
    const boundary = boundaryFor.get(entry.scene.id);
    const worldMode = plan?.mode === 'world';
    const worldClass = inWorld && worldMode ? ' lc-world-plate' : '';
    if (inWorld && media.elements.length) warnings.push(`${entry.scene.id}: root media stays on the root and does not follow the world camera`);
    // Ambient field: inside every plate, except in world mode, where the one
    // field is the camera's depth layer (#lc-world-bg) instead, tiled across the world.
    const ambient = entry.plate && !worldMode && drawsBackground(entry.scene) ? fieldLayer(id, entry.start, entry.renderEnd, entry.scene) : { html: '', motion: [] };
    const drift = isolate ? null : sceneDrift(story, entry.scene, model, { window: { start: entry.start, end: entry.renderEnd }, geometry });
    const content = drift ? `<div id="lc-drift-${id}" class="lc-drift" style="transform-origin:${num(drift.origin.x)}px ${num(drift.origin.y)}px">${media.html}</div>` : media.html;
    // Overlays slide 1.15× the camera's travel (parallax) inside a wrapper.
    const parallax = plan && !entry.plate && !entry.rides ? overlayOps(plan, { start: entry.start, end: entry.renderEnd }) : [];
    // Zooms inside the shot (kit/core/zooms.mjs): in world mode they are
    // camera moves; in cuts mode a scale (about the centre) over a translate
    // wraps the layer, the same math.
    const zoom = !isolate && entry.plate && !worldMode ? shotZooms(story, entry, model.zoomRects) : null;
    if (zoom?.warnings.length) warnings.push(...zoom.warnings);
    const zooming = zoomOps(zoom?.keys, { width: W, height: H });
    if (zooming.length && media.elements.length) warnings.push(`${entry.scene.id}: root media stays on the root and does not follow the shot's zooms`);
    const plain = `<div id="${inner}" class="lc-layer">${ambient.html}${content}</div>`;
    const layer = zooming.length ? `<div id="lc-zs-${id}" class="lc-zoom"><div id="lc-zp-${id}" class="lc-zoom">${plain}</div></div>` : plain;
    const body = parallax.length ? `<div id="lc-par-${id}" class="lc-parallax">${layer}</div>` : layer;
    (inWorld ? world : markup).push(`<div id="${outer}" class="lc-scene${entry.plate ? ' lc-plate' : ''}${worldClass}" data-launchclip-scene="${id}" data-launchclip-module="${attr(entry.scene.module)}" data-launchclip-start="${num(entry.start)}" data-launchclip-render-end="${num(entry.renderEnd)}"${boundaryAttrs(boundary)} style="z-index:${sceneZ}${inWorld ? plateStyle(entry.id, plan.placements[entry.rides ?? entry.id]) : ''}">${body}</div>`);
    css.push(out.css ?? '');
    motion.push(`// ${entry.scene.id} (${entry.scene.module}) ${num(entry.start)}–${num(entry.renderEnd)}s`);
    motion.push(...toggle(`#${outer}`, entry.start, entry.renderEnd, D));
    motion.push(...entry.tweens.map((tw) => tweenCode(`#${inner}`, tw)));
    motion.push(...opsGsap(parallax, { overlay: `#lc-par-${id}` }));
    motion.push(...opsGsap(zooming, { zoom: `#lc-zs-${id}`, pan: `#lc-zp-${id}` }));
    if (zooming.length) usesZoom = true;
    motion.push(...ambient.motion);
    if (drift) {
      const { from, to, position } = driftGsap(drift);
      motion.push(`tl.fromTo(${js(`#lc-drift-${id}`)}, ${js(from)}, ${js(to)}, ${num(position)});`);
    }
    if (out.motion) motion.push(`{\n${out.motion}\n}`);
    motion.push(...mediaMotion);
    // Split modules: their behind part is a second layer under the subject,
    // shown and moved with the scene.
    if (depth.layer === 'split' && out.behind?.html) {
      const behindOuter = `lc-scene-${id}-behind`, behindInner = `lc-layer-${id}-behind`;
      markup.push(`<div id="${behindOuter}" class="lc-scene" data-launchclip-scene="${id}" data-launchclip-part="behind" style="z-index:${zBehind}"><div id="${behindInner}" class="lc-layer">${out.behind.html}</div></div>`);
      css.push(out.behind.css ?? '');
      motion.push(...toggle(`#${behindOuter}`, entry.start, entry.renderEnd, D));
      motion.push(...entry.tweens.map((tw) => tweenCode(`#${behindInner}`, tw)));
      if (out.behind.motion) motion.push(`{\n${out.behind.motion}\n}`);
      zBehind += 10;
    }
    if (depth.layer === 'behind') zBehind += 10;
    else z += 10;
  }

  // Overview holds (transitions.mjs sceneWindows holds): a shot an overview
  // frames is drawn again at its placement for the overview, frozen on its
  // settled last frame (holdTime): its module runs on its own paused
  // timeline, held at that time, as the loop ending holds its clone.
  const heldFrames = [];
  if (plan?.mode === 'world') for (const [index, entry] of layers.entries()) {
    if (!entry.plate || !entry.holds?.length) continue;
    const at = holdTime(entry, models[index], format.fps);
    for (const [k, hold] of entry.holds.entries()) {
      const { out } = build(entry, { idSuffix: `-held${k ? `-${k}` : ''}`, clone: true, held: true });
      const id = attr(`${entry.id}-held${k ? `-${k}` : ''}`);
      const outer = `lc-scene-${id}`, inner = `lc-layer-${id}`;
      // A video kept in its plate (soleVideo) is held as a still of the frame
      // Remotion's <Freeze> shows (written with the project; heldStill), under its overlay.
      const still = soleVideo(out.html) ? heldStill(out.html, at, format.fps, `held/${id}.png`) : null;
      if (still) heldFrames.push(still.frame);
      const media = still ? { html: `${still.html}${out.overlay ?? ''}`, elements: [] } : hoistMedia(out.html ?? '');
      world.push(`<div id="${outer}" class="lc-scene lc-plate lc-held lc-world-plate" data-launchclip-scene="${id}" data-launchclip-held="${attr(entry.id)}" data-launchclip-start="${num(hold.start)}" style="z-index:${z}${plateStyle(entry.id, plan.placements[entry.id])}"><div id="${inner}" class="lc-layer">${unclip(media.html)}</div></div>`);
      if (media.elements.length) warnings.push(`${entry.id}: root media is not held in the overview (HyperFrames keeps <video>/<audio> on the root)`);
      css.push(out.css ?? '');
      motion.push(`// overview ${hold.overview} → ${entry.id} held at ${num(at)}s, ${num(hold.start)}–${num(hold.end)}s`);
      motion.push(...toggle(`#${outer}`, hold.start, hold.end, D));
      if (out.motion) motion.push(`{\nconst heldTl = gsap.timeline({ paused: true });\n((tl) => {\n${out.motion}\n})(heldTl);\nheldTl.render(${num(at)}, true, true);\ntl.fromTo(heldTl, { time: ${num(at)} }, { time: ${num(at)}, duration: ${num(Math.max(0.001, hold.end - hold.start + TOGGLE_LEAD))}, ease: 'none', immediateRender: false }, ${num(Math.max(0, hold.start - TOGGLE_LEAD))});\n}`);
      z += 10;
    }
  }

  // Loop ending: the loop_to scene's first state, held over the final window.
  // In world mode a cast riding that plate is part of it, so it is cloned too
  // (a set never vanishes from its world at the loop seam).
  const loop = isolate ? null : windows.loop;
  if (loop) {
    const riders = plan?.mode === 'world' ? windows.scenes.filter((item) => item.rides === loop.sceneId) : [];
    for (const target of [windows.scenes.find((item) => item.id === loop.sceneId), ...riders]) {
      const entry = { ...target };
      const plate = entry.id === loop.sceneId;
      const { out } = build(entry, { idSuffix: '-loop', clone: true });
      const id = attr(`${entry.id}-loop`);
      const outer = `lc-scene-${id}`, inner = `lc-layer-${id}`;
      const media = hoistMedia(out.html ?? '');
      const boundary = plate ? boundaries.find((item) => item.to_id === loop.sceneId && Math.abs(item.start_seconds - loop.start) < 1e-3) : null;
      // The clone holds the scene's first state, where its drift is identity;
      // the field keeps moving with absolute time (in world mode it is the
      // camera's depth layer instead).
      const ambient = plate && plan?.mode !== 'world' && drawsBackground(entry.scene) ? fieldLayer(id, loop.start, loop.end, entry.scene) : { html: '', motion: [] };
      (plan ? world : markup).push(`<div id="${outer}" class="lc-scene${plate ? ' lc-plate' : ''} lc-loop${plan?.mode === 'world' ? ' lc-world-plate' : ''}" data-launchclip-scene="${id}" data-launchclip-loop-to="${attr(loop.sceneId)}" data-launchclip-start="${num(loop.start)}"${boundaryAttrs(boundary)} style="z-index:${z}${plateStyle(loop.sceneId, plan?.loop)}"><div id="${inner}" class="lc-layer">${ambient.html}${unclip(media.html)}</div></div>`);
      motion.push(...ambient.motion);
      if (media.elements.length) warnings.push(`${entry.id}: root media is not repeated in the loop ending`);
      css.push(out.css ?? '');
      motion.push(`// loop ending → ${entry.id} at its first state, ${num(loop.start)}–${num(loop.end)}s`);
      motion.push(...toggle(`#${outer}`, loop.start, loop.end + 1, D));
      motion.push(...loop.tweens.map((tw) => tweenCode(`#${inner}`, tw)));
      if (out.motion) {
        // The hold never moves loopTl's playhead, and GSAP does not render a
        // tl.set at a playhead that has not moved (a scene at 0 s), so the
        // clone's first state is rendered once here.
        motion.push(`{\nconst loopTl = gsap.timeline({ paused: true });\n((tl) => {\n${out.motion}\n})(loopTl);\nloopTl.render(${num(entry.scene.start)}, true, true);\ntl.fromTo(loopTl, { time: ${num(entry.scene.start)} }, { time: ${num(entry.scene.start)}, duration: ${num(Math.max(0.001, loop.end - loop.start + TOGGLE_LEAD))}, ease: 'none', immediateRender: false }, ${num(Math.max(0, loop.start - TOGGLE_LEAD))});\n}`);
      }
      z += 10;
    }
  }

  if (plan) {
    motion.push(`// world camera (${plan.mode}, ${plan.grammar}): ${plan.moves.length} move(s)${plan.drift ? ', drift' : ''}${plan.parallax ? ', parallax' : ''}${plan.blurSamples.length ? ', motion blur' : ''}`);
    motion.push(...cameraMotion);
  }

  // Base: one muted root <video> per trim segment (HyperFrames lifts and
  // seeks direct-root media; data-media-start is the segment's source
  // in-point), the punch-in cameras as tl.set calls on those videos, and one
  // root <audio> per segment for the recording's sound, which keeps playing
  // under full-frame inserts.
  const baseMarkup = [];
  if (base) {
    // The canvas box with the base's fit and focus, or, with base.crop, the
    // whole recording's box clipped to the crop (baseMediaStyle); the mattes
    // draw in the same box, so they stay aligned.
    const media = baseMediaStyle(base, { width: W, height: H });
    const fit = media.clipPath
      ? `left:${num(media.left)}px;top:${num(media.top)}px;width:${num(media.width)}px;height:${num(media.height)}px;object-fit:${media.objectFit};object-position:${media.objectPosition};clip-path:${media.clipPath};transform-origin:${media.transformOrigin}`
      : `left:0;top:0;width:${W}px;height:${H}px;object-fit:${base.fit};object-position:${num(base.focus.x * 100)}% ${num(base.focus.y * 100)}%;transform-origin:50% 50%`;
    for (const segment of base.segments) {
      const timing = `data-start="${num(segment.start)}" data-duration="${num(segment.duration)}" data-media-start="${num(segment.sourceStart)}"`;
      baseMarkup.push(`<video id="lc-base-${segment.index}" class="clip lc-base-media" src="${attr(base.src)}" ${timing} data-track-index="${FIRST_SCENE_TRACK}" data-launchclip-base-segment="${segment.index}" muted playsinline style="position:absolute;${fit};z-index:1"></video>`);
      if (!isolate && base.volume > 0) baseMarkup.push(`<audio id="lc-base-audio-${segment.index}" class="clip" src="${attr(base.src)}" ${timing} data-volume="${num(base.volume)}" data-track-index="${FIRST_SCENE_TRACK + 1}"></audio>`);
    }
    // Subject: the matte clips over the base, under every front scene, moved
    // with the base cameras unless a subjectCamera runs; room treatments
    // (hide, dim, blur) touch the base videos only.
    // Layout sections reframe the presenter through the base camera (composed
    // with any punch-in) and treat the room like a scene's room.
    const cameraModels = withLayoutCameras(models, layout, { fps: format.fps, duration: D });
    const roomModels = [...cameraModels, ...(layout?.rooms ?? [])];
    if (subjectNeeded) {
      const entries = [...layers.map((entry, index) => ({ scene: entry.scene, model: models[index], start: entry.start, end: entry.renderEnd })), ...(layout?.rooms ?? []).map((room) => ({ scene: { id: room.sceneId }, model: room, start: room.start, end: room.end }))];
      const clips = subjectSegments(story, subjectWindows(entries));
      if (!clips.length) warnings.push(`${entries.filter((entry) => needsSubject(entry.scene, entry.model)).map((entry) => entry.scene.id).join(', ')}: these scenes need the cut-out subject, but base.subject has no matte for their time (run: launchclip subject matte <recording> --range <in>-<out> --project <dir>)`);
      for (const clip of clips) {
        baseMarkup.push(`<video id="lc-subject-${clip.index}" class="clip lc-subject-media" src="${attr(clip.src)}" data-start="${num(clip.start)}" data-duration="${num(clip.duration)}" data-media-start="${num(clip.mediaStart)}" data-track-index="${SUBJECT_TRACK}" data-launchclip-subject-segment="${clip.index}" muted playsinline style="position:absolute;${fit};z-index:${subjectZ}"></video>`);
        if (sourceDir && !existsSync(path.join(sourceDir, clip.src))) warnings.push(`subject matte ${clip.src} was not found in ${sourceDir}`);
      }
      const subjectOps = subjectCameraOps(cameraModels, { subjectFilterAt: (t) => subjectFilterAt(models, t) });
      if (clips.length && subjectOps.length) {
        motion.push('// subject camera (follows the base cameras; subjectCamera takes over while it runs)');
        motion.push(...opsToGsap(subjectOps).map((line) => line.replace(JSON.stringify(`#${SUBJECT_CAMERA}`), JSON.stringify('.lc-subject-media'))));
      }
      const styles = subjectFilterChanges(models);
      if (clips.length && styles.length) {
        motion.push('// subject style (sticker outline, shadow)');
        motion.push(...styles.map((change) => `tl.set('.lc-subject-media', ${js({ filter: change.filter })}, ${num(change.time)});`));
      }
      const room = roomChanges(roomModels);
      if (room.length) {
        motion.push('// room treatment (base videos only)');
        motion.push(...room.map((change) => `tl.set('.lc-base-media', ${js(change.state)}, ${num(change.time)});`));
      }
    }
    const camera = cameraGsap(cameraModels, '.lc-base-media', { roomFilterAt: (t) => roomStateAt(roomModels, t).filter });
    if (camera.length) {
      motion.push(`// base camera (${cameraModels.filter((model) => model.camera).map((model) => model.sceneId ?? model.id).join(', ')})`);
      motion.push(...camera);
    }
    for (const [a, b] of cameraOverlaps(models)) warnings.push(`${b}: its camera overlaps ${a}; the later punch-in wins while both run`);
    // The layout frame: one box at the presenter's window whose box-shadow
    // paints the panel, above the subject and under every front scene; its
    // props change on the frames layoutOps lists. Each layout-shift is a
    // declared boundary for evidence.
    if (layout) {
      const frameStyle = (state) => layoutFrameStyle(state, layout.canvas);
      const first = frameStyle(layout.ops[0].state);
      baseMarkup.push(`<div id="${LAYOUT_FRAME}" class="lc-layout-frame" aria-hidden="true" style="position:absolute;left:${first.left}px;top:${first.top}px;width:${first.width}px;height:${first.height}px;border-radius:${first.borderRadius}px;box-shadow:${first.boxShadow};pointer-events:none;z-index:${subjectNeeded ? subjectZ + 5 : 5}"></div>`);
      for (const entry of layout.boundaries) baseMarkup.push(`<div class="lc-layout-boundary" aria-hidden="true" data-launchclip-transition-type="layout-shift"${boundaryAttrs(entry)} style="display:none"></div>`);
      motion.push(`// footage layout (${layout.sections.map((section) => `${section.id} ${section.layout}`).join(', ')})`);
      motion.push(...layout.ops.map((op) => `tl.set(${js(`#${LAYOUT_FRAME}`)}, ${js(frameStyle(op.state))}, ${num(op.time)});`));
      // A panel fill (story.panel.fill, kit/core/backgrounds.mjs): the
      // pattern over the panel colour, clipped to the canvas minus the
      // presenter's window on the same frames as the frame element.
      const fillPlan = panelFillPlan(story, { width: W, height: H });
      if (fillPlan) {
        const html = fillPlan.layers.map((layer) => `<div id="lc-layout-fill-${layer.id}" class="lc-bg-layer" style="${layerCss(layer, 0)}">${layerSvg(layer) ?? ''}</div>`).join('');
        const mask = Object.entries(fieldStyle(fillPlan)).map(([prop, value]) => `${prop === 'WebkitMaskImage' ? '-webkit-mask-image' : 'mask-image'}:${value}`).join(';');
        baseMarkup.push(`<div id="lc-layout-fill" class="lc-layout-fill" data-launchclip-background="${fillPlan.kind}" aria-hidden="true" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;pointer-events:none;z-index:${subjectNeeded ? subjectZ + 5 : 5};clip-path:${attr(layoutFillClip(layout.ops[0].state, layout.canvas))}"><div class="lc-layout-fill-field" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px;${mask}">${html}</div></div>`);
        motion.push(...layout.ops.map((op) => `tl.set("#lc-layout-fill", ${js({ clipPath: layoutFillClip(op.state, layout.canvas) })}, ${num(op.time)});`));
        motion.push(...fillPlan.layers.flatMap((layer) => layerTweens(layer, 0, D).map((tw) => `tl.fromTo(${js(`#lc-layout-fill-${layer.id}`)}, ${js({ [tw.prop]: tw.from, force3D: false })}, ${js({ [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false, force3D: false })}, ${num(tw.at)});`)));
      }
    }
  } else if (models.some((model) => model.camera)) warnings.push('punch-in moves the base recording, but the story has no base; it has no effect');
  if (!base && models.some((model) => model.room || model.subjectCamera)) warnings.push('a scene moves the subject or treats the room, but the story has no base recording; it has no effect');

  // Audio: exactly one root track (footage-led: the bed under the base; the
  // recording carries the voice).
  const audioSrc = isolate ? null : base ? story.audio?.mix ?? null : story.audio?.mix ?? story.audio?.voice ?? null;
  const mixVolume = typeof story.audio?.mix_volume === 'number' && audioSrc === story.audio?.mix ? story.audio.mix_volume : 1;
  if (audioSrc && sourceDir && !existsSync(path.join(sourceDir, audioSrc))) warnings.push(`audio file ${audioSrc} was not found in ${sourceDir}`);
  const audio = audioSrc ? `<audio id="lc-audio" class="clip" src="${attr(audioSrc)}" data-start="0" data-duration="${num(D)}" data-media-start="0" data-volume="${num(mixVolume)}" data-track-index="0"></audio>` : '';

  // Captions.
  let captions = null;
  const overlay = isolate ? null : captionsOverlayOf(story);
  if (overlay) {
    const chunks = await loadCaptionChunks(story, overlay, sourceDir, warnings);
    if (chunks?.length) {
      for (const range of overlay.hide ?? []) hide.push([Number(range[0]), Number(range[1])]);
      const captionsPlan = captionPlan(chunks, overlay, { brand: story.brand, format, story, hide, zones: layout?.captions });
      // Camera moves that sweep panels through the band dip the captions out
      // (captions.hide_during_moves, camera-world.mjs captionDipWindows).
      const dips = captionDipTweens(captionDipWindows(plan, captionMoveHide(overlay)));
      if (captionsPlan.nodes.length) captions = { chunks, hide, plan: captionsPlan, dips };
    }
  }

  // Brand frame (kit/core/brand-frame.mjs): kicker, section labels and the
  // progress line over every scene, under the captions.
  const frame = isolate ? null : brandFramePlan(story, { format });

  // Medium (kit/core/medium.mjs): a full-canvas layer above every scene and
  // the footage, under the brand frame and the captions, that paints what is
  // behind it through a backdrop-filter; the drawing boils on threes through
  // tl.set calls on --lc-medium-filter. No medium, nothing added. A module
  // review has none, like ModuleReview.
  const medium = isolate ? null : mediumPlan(story);

  const fonts = brandFontStacks(story.brand);
  const fontCss = await projectFontFaces(story.brand, { sourceDir });
  warnings.push(...fontCss.warnings);
  const capIdle = colors.paper ?? CAPTION_DEFAULT_COLORS.idle;
  const capActive = colors.primary ?? CAPTION_DEFAULT_COLORS.active;
  let html = `<!doctype html>
<html lang="${attr(story.format.language ?? 'en')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=${W}, height=${H}">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>${text(story.title ?? 'LaunchClip story')}</title>
  <script src="${GSAP_SRC}"></script>
  <style>
${fontCss.css.split('\n').map((line) => `    ${line}`).join('\n')}
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${bg}; }
    #launchclip-root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; --lc-font-display: ${fonts.display}; --lc-font-body: ${fonts.body}; --lc-font-meta: ${fonts.meta}; --cap-font: ${fonts.display}; --cap-idle: ${capIdle}; --cap-active: ${capActive}; font-family: var(--lc-font-body); }
    #lc-bg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; background: ${bg}; }
    .lc-scene { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; opacity: 0; isolation: isolate; overflow: hidden; pointer-events: none; }
    .lc-layer { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 50% 50%; }
    .lc-plate > .lc-layer { background: ${bg}; }${usesZoom ? `\n    .lc-zoom { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 50% 50%; }\n    .lc-plate > .lc-zoom > .lc-zoom > .lc-layer { background: ${bg}; }` : ''}${plan ? `\n    ${cameraCss(plan, W, H)}` : ''}
    .lc-ambient-field { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; pointer-events: none; }
    .lc-ambient-blob { position: absolute; left: 0; top: 0; border-radius: 50%; transform-origin: 50% 50%; }
    .lc-drift { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
    ${placeholderCss()}
    ${captions ? `${captions.plan.css.trim().split('\n').join('\n    ')}\n    #lc-captions { z-index: 100000; }` : ''}${medium ? `\n    #${MEDIUM_LAYER_ID} { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; pointer-events: none; z-index: ${MEDIUM_Z.hyperframes}; --lc-medium-filter: ${mediumFilterAt(medium, 0)}; backdrop-filter: var(--lc-medium-filter); -webkit-backdrop-filter: var(--lc-medium-filter); }` : ''}${frame ? `\n    #lc-frame-root { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; pointer-events: none; z-index: 90000; }\n    ${frame.css.trim().split('\n').join('\n    ')}` : ''}
    ${css.filter(Boolean).join('\n    ')}
  </style>
  <script>${FONT_WARMUP}</script>
</head>
<body>
  <div id="launchclip-root" data-composition-id="${COMPOSITION_ID}" data-start="0" data-duration="${num(D)}" data-width="${W}" data-height="${H}" data-fps="${format.fps}" data-launchclip-cinematic-contract="phase-2" data-launchclip-story="${attr(story.schema)}">
    <div id="lc-bg" class="clip" data-start="0" data-duration="${num(D)}" data-track-index="1">${worldBackdrop?.html ?? ''}</div>
    ${baseMarkup.join('\n    ')}
    ${audio}
    ${plan ? cameraMarkup(plan, story.brand, world, worldField.html, !worldBackdrop && !covered, stack?.html ?? '') : ''}
    ${hoisted.join('\n    ')}
    ${markup.join('\n    ')}
    ${medium ? `${mediumDefs(medium)}<div id="${MEDIUM_LAYER_ID}" data-launchclip-medium="${medium.kind}" aria-hidden="true"></div>\n    ` : ''}${frame ? `<div id="lc-frame-root" aria-hidden="true"></div>\n    <script>\n${brandFrameRuntime(frame)}</script>\n    ` : ''}${captions ? '<div id="lc-captions" class="lc-captions"></div>' : ''}
    ${captions ? `<script>\n${captionPlanRuntime(captions.plan)}</script>` : ''}
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${motion.join('\n').split('\n').map((line) => `      ${line}`).join('\n')}
      ${medium ? `${mediumSteps(medium, D).map((step) => `tl.set(${js(`#${MEDIUM_LAYER_ID}`)}, ${js({ '--lc-medium-filter': step.filter })}, ${num(step.time)});`).join('\n      ')}\n      ` : ''}${frame ? 'window.mountBrandFrame(tl, document.getElementById("lc-frame-root"));\n      ' : ''}${captions ? 'window.mountCaptions(tl, document.getElementById("lc-captions"));' : ''}${captions?.dips.length ? `\n      // captions dip out during sweeping camera moves\n      ${captions.dips.map((dip) => `tl.fromTo('#lc-captions', { opacity: ${dip.from} }, { opacity: ${dip.to}, duration: ${num(dip.dur)}, ease: 'none', immediateRender: false }, ${num(dip.at)});`).join('\n      ')}` : ''}
      window.__timelines["${COMPOSITION_ID}"] = tl;
    </script>
  </div>
</body>
</html>
`.replace(/\n\s*\n(?=\s*<)/g, '\n');
  if (span) html = windowComposition(html, span);

  const files = [];
  if (write) {
    await mkdir(projectDir, { recursive: true });
    if (copyAssets && sourceDir && path.resolve(sourceDir) !== path.resolve(projectDir) && existsSync(path.join(sourceDir, 'assets'))) {
      await cp(path.join(sourceDir, 'assets'), path.join(projectDir, 'assets'), { recursive: true, force: true });
      files.push('assets/');
    }
    if (fontCss.copies.length) { await copyProjectFonts(fontCss.copies, projectDir); files.push('fonts/'); }
    for (const frame of heldFrames) {
      const error = await extractFrame(path.join(sourceDir ?? projectDir, frame.src), frame.time, path.join(projectDir, frame.file));
      if (error) warnings.push(`${frame.file}: the held frame of ${frame.src} at ${num(frame.time)}s was not extracted (${error}); the overview shows the clip's frame without it`);
      else if (!files.includes('held/')) files.push('held/');
    }
    await writeFile(path.join(projectDir, 'index.html'), html);
    files.push('index.html');
  }
  return { html, files, warnings, boundaries, compositionId: COMPOSITION_ID };
}

/**
 * The stretch [start, end] seconds of a compiled story as its own composition
 * from 0. HyperFrames' render has no frame range, so a preview of one scene
 * renders this instead of the whole video: every clip's timing moves back by
 * start (a clip straddling the start keeps its tail, and media plays from the
 * matching offset), clips wholly outside the stretch are taken off the
 * timeline and hidden, and the registered timeline scrubs the story's own
 * timeline from start to end, so frame n here is the whole composition's
 * frame at start + n / fps.
 */
export function windowComposition(html, [start, end]) {
  const length = Number(end) - Number(start);
  if (!(Number(start) >= 0 && length > 0)) throw new Error(`windowComposition needs 0 <= start < end; got [${start}, ${end}]`);
  const shift = (tag) => {
    const get = (name) => { const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return match ? Number(match[1]) : null; };
    const set = (source, name, value) => source.replace(new RegExp(`(\\s${name}=")[^"]*(")`), `$1${num(value)}$2`);
    // Rounded down, so the frame count is not rounded up a frame (71 / 30 s is 2.3666…, not 2.3667).
    if (/\sid="launchclip-root"/.test(tag)) return tag.replace(/(\sdata-duration=")[^"]*(")/, `$1${Math.floor(length * 1e4 + 1e-6) / 1e4}$2`);
    const from = get('data-start') - start;
    const duration = get('data-duration');
    const to = duration == null ? length : from + duration;
    if (to <= 0 || from >= length) {
      // Off the timeline: no longer a clip, and never shown.
      let hidden = tag.replace(/\sdata-(?:start|duration|media-start)="[^"]*"/g, '').replace(/(\sclass=")([^"]*)"/, (_all, head, names) => `${head}${names.split(/\s+/).filter((name) => name !== 'clip').join(' ')}"`);
      hidden = /\sstyle="/.test(hidden) ? hidden.replace(/\sstyle="/, ' style="display:none !important;') : hidden.replace(/^<([a-z0-9-]+)/i, '<$1 style="display:none !important"');
      return hidden;
    }
    const cut = Math.max(0, -from);
    let out = set(tag, 'data-start', Math.max(0, from));
    if (duration != null) out = set(out, 'data-duration', Math.min(to, length) - Math.max(0, from));
    if (cut > 0 && get('data-media-start') != null) out = set(out, 'data-media-start', get('data-media-start') + cut);
    return out;
  };
  const registration = `window.__timelines["${COMPOSITION_ID}"] = tl;`;
  if (!html.includes(registration)) throw new Error('windowComposition: the story timeline registration was not found');
  return html
    .replace(/<[a-z][a-z0-9-]*\s[^>]*\sdata-start="[^"]*"[^>]*>/gi, shift)
    .replace(registration, `// window ${num(start)}–${num(end)} s of the story (windowComposition)
      const lcWindow = gsap.timeline({ paused: true });
      lcWindow.add(tl.tweenFromTo(${num(start)}, ${num(end)}, { duration: ${num(length)}, ease: 'none', immediateRender: false }), 0);
      window.__timelines["${COMPOSITION_ID}"] = lcWindow;`);
}

// World camera containers. #lc-world-bg is the background depth layer (world
// mode); #lc-camera carries the motion-blur filter (an SVG feGaussianBlur with
// separate x/y deviations, switched on through --lc-cam-filter only while a
// blurred move runs), then drift, zoom (about the canvas centre) and pan.
const CAMERA_SELECTORS = Object.freeze({ pan: '#lc-cam-pan', zoom: '#lc-cam-zoom', drift: '#lc-cam-drift', background: '#lc-world-bg' });

// World backdrops (kit/core/world-backdrops.mjs): one segment per run of
// shots on the same plate, each an opaque, masked canvas of the plate's
// layers inside a mover (#lc-wb-<n>-move, the ops' x / y) inside the segment
// (#lc-wb-<n>, the ops' opacity as autoAlpha, so a hidden segment is not
// painted), with one fixed vignette over the stack.
function worldBackdropStack(backdrops, bg) {
  const html = [], motion = [];
  for (const segment of backdrops.segments) {
    const id = `lc-wb-${segment.index}`;
    const c = segment.canvas;
    const mask = segment.mask ? `;-webkit-mask-image:${segment.mask};mask-image:${segment.mask};-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat` : '';
    const layers = segment.layers.map((layer) => `<div id="${id}-${layer.id}" class="lc-bg-layer" style="${layerCss(layer, segment.from)}">${layerSvg(layer) ?? ''}</div>`).join('');
    const canvas = segment.plan ? `<div class="lc-wb-canvas" style="left:${num(c.x)}px;top:${num(c.y)}px;width:${num(c.width)}px;height:${num(c.height)}px;background:${bg}${mask}">${layers}</div>` : '';
    html.push(`<div id="${id}" class="lc-wb" data-launchclip-backdrop="${attr(segment.kind)}" style="${segment.index === 0 ? '' : 'opacity:0;visibility:hidden'}"><div id="${id}-move" class="lc-wb-move">${canvas}</div></div>`);
    for (const layer of segment.layers) {
      motion.push(...layerTweens(layer, segment.from, segment.to).map((tw) => `tl.fromTo(${js(`#${id}-${layer.id}`)}, ${js({ [tw.prop]: tw.from, force3D: false })}, ${js({ [tw.prop]: tw.to, duration: tw.duration, ease: tw.ease, immediateRender: false, force3D: false })}, ${num(tw.at)});`));
    }
  }
  // Ops: {x, y} move the canvas, opacity shows the segment (autoAlpha).
  for (const op of backdrops.ops) {
    const id = `#lc-wb-${op.target.slice('backdrop-'.length)}`;
    const split = (props) => {
      const move = {}, show = {};
      for (const [key, value] of Object.entries(props)) (key === 'opacity' ? show : move)[key === 'opacity' ? 'autoAlpha' : key] = value;
      return { move, show };
    };
    if (op.type === 'set') {
      const { move, show } = split(op.props);
      if (Object.keys(move).length) motion.push(`tl.set(${js(`${id}-move`)}, ${js({ ...move, force3D: false })}, ${num(op.time)});`);
      if (Object.keys(show).length) motion.push(`tl.set(${js(id)}, ${js(show)}, ${num(op.time)});`);
    } else {
      const from = split(op.from), to = split(op.to);
      const timing = { duration: round(op.duration, 6), ease: op.ease, immediateRender: false };
      if (Object.keys(to.move).length) motion.push(`tl.fromTo(${js(`${id}-move`)}, ${js({ ...from.move, force3D: false })}, ${js({ ...to.move, ...timing, force3D: false })}, ${num(op.start)});`);
      if (Object.keys(to.show).length) motion.push(`tl.fromTo(${js(id)}, ${js(from.show)}, ${js({ ...to.show, ...timing })}, ${num(op.start)});`);
    }
  }
  const vignette = backdrops.vignette ? `<div class="lc-bg-layer lc-wb-vignette" style="${layerCss(backdrops.vignette, 0)}"></div>` : '';
  return { html: `<div id="lc-wb" class="lc-wb-stack" aria-hidden="true">${html.join('')}${vignette}</div>`, motion };
}

function cameraMarkup(plan, brand, plates, field = '', glowing = true, backdrops = '') {
  const parts = [];
  if (plan.background) {
    // The depth layer (world mode): ambient motion's background field tiled
    // across the world when the story has one, else the brand glows (world
    // plates are transparent, so the one field moves behind them, at 0.3×
    // with parallax and 1× without, instead of once inside every plate).
    // Never both: stacked translucent gradients dither differently in the two
    // renderers (16:9 parity fell to 0.963 with glows under the field).
    const glows = field || !glowing ? [] : backgroundLayer(plan, brand).glows;
    parts.push(`<div id="lc-world-bg" class="lc-world-bg" aria-hidden="true">${glows.map((glow) => `<div class="lc-world-glow" style="left:${glow.left}px;top:${glow.top}px;width:${glow.size}px;height:${glow.size}px;background:${glow.background}"></div>`).join('')}${field}</div>`);
  }
  if (backdrops) parts.push(backdrops);
  const defs = plan.blurSamples.length ? '<svg class="lc-cam-defs" width="0" height="0" aria-hidden="true"><defs><filter id="lc-cam-blur" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feGaussianBlur id="lc-cam-blur-k" in="SourceGraphic" stdDeviation="0 0"></feGaussianBlur></filter></defs></svg>' : '';
  parts.push(`${defs}<div id="lc-camera" class="lc-camera" data-launchclip-camera="${plan.mode}"><div id="lc-cam-drift" class="lc-cam"><div id="lc-cam-zoom" class="lc-cam"><div id="lc-cam-pan" class="lc-cam">${plates.join('')}</div></div></div></div>`);
  return parts.join('\n    ');
}

function cameraCss(plan, W, H) {
  const rules = [
    `.lc-camera { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: hidden; z-index: ${CAMERA_STACK.camera}; --lc-cam-filter: none; filter: var(--lc-cam-filter); }`,
    `.lc-cam { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 50% 50%; }`,
    '.lc-cam-defs { position: absolute; left: 0; top: 0; width: 0; height: 0; }',
    `.lc-parallax { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }`
  ];
  if (plan.mode === 'world') rules.push('.lc-world-plate > .lc-layer { background: transparent; }', '.lc-scene.lc-world-plate { overflow: visible; }');
  if (plan.mode === 'world') rules.push(`.lc-wb-stack, .lc-wb, .lc-wb-move { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; pointer-events: none; }`, '.lc-wb-stack, .lc-wb { overflow: hidden; }', '.lc-wb-canvas { position: absolute; overflow: hidden; }');
  if (plan.background) rules.push(`.lc-world-bg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 50% 50%; pointer-events: none; }`, '.lc-world-glow { position: absolute; border-radius: 50%; }', `.lc-world-field, .lc-world-tile { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: visible; pointer-events: none; }`);
  return rules.join('\n    ');
}

/** Camera ops (camera-world.mjs) → GSAP calls on the camera containers. */
export function cameraGsapLines(plan) {
  return opsGsap(plan.ops, CAMERA_SELECTORS);
}

// Renderer-neutral ops → seek-safe GSAP: explicit fromTo states with
// immediateRender false, 2D transforms (force3D false keeps text rasterised
// at its final scale), sets for sampled values.
function opsGsap(ops, selectors) {
  const lines = [];
  for (const op of ops) {
    if (op.target === 'blur') {
      const on = op.props.x > 0 || op.props.y > 0;
      lines.push(`tl.set("#lc-cam-blur-k", { attr: { stdDeviation: "${num(op.props.x)} ${num(op.props.y)}" } }, ${num(op.time)});`);
      lines.push(`tl.set("#lc-camera", { "--lc-cam-filter": "${on ? 'url(#lc-cam-blur)' : 'none'}" }, ${num(op.time)});`);
      continue;
    }
    const selector = selectors[op.target];
    if (!selector) continue;
    if (op.type === 'set') lines.push(`tl.set(${js(selector)}, ${js({ ...op.props, force3D: false })}, ${num(op.time)});`);
    else lines.push(`tl.fromTo(${js(selector)}, ${js({ ...op.from, force3D: false })}, ${js({ ...op.to, duration: round(op.duration, 6), ease: op.ease, immediateRender: false, force3D: false })}, ${num(op.start)});`);
  }
  return lines;
}

function sceneSelector(filter) {
  if (filter === undefined || filter === null) return () => true;
  if (typeof filter === 'function') return filter;
  const ids = new Set(Array.isArray(filter) ? filter : [filter]);
  return (scene) => ids.has(scene.id);
}

// Outer layer visibility: explicit zero-length fromTo states so the timeline
// gives the same frame whatever order it is sought in.
// Both switch half a millisecond early so a frame time (frame / fps) that
// rounds just below the boundary still lands on the right side of it, as a
// Remotion <Sequence> does with whole frames.
function toggle(selector, start, end, duration) {
  const at = (time) => num(Math.max(0, time - TOGGLE_LEAD));
  const lines = [`tl.fromTo(${js(selector)}, { opacity: 0 }, { opacity: 1, duration: 0, immediateRender: false }, ${at(start)});`];
  if (end < duration - 1e-6) lines.push(`tl.fromTo(${js(selector)}, { opacity: 1 }, { opacity: 0, duration: 0, immediateRender: false }, ${at(end)});`);
  return lines;
}

function tweenCode(selector, tw) {
  const from = gsapVars(tw.prop, tw.from), to = gsapVars(tw.prop, tw.to);
  return `tl.fromTo(${js(selector)}, ${js(from)}, ${js({ ...to, duration: round(tw.duration, 4), ease: tw.ease, immediateRender: false })}, ${num(tw.at)});`;
}

function boundaryAttrs(boundary) {
  if (!boundary) return '';
  let out = ` data-launchclip-boundary-id="${attr(boundary.boundary_id)}" data-launchclip-transition-kind="${boundary.kind}" data-launchclip-transition-start="${num(boundary.start_seconds)}" data-launchclip-transition-duration="${num(boundary.duration_seconds)}"`;
  if (boundary.sequence_id) out += ` data-launchclip-sequence-id="${attr(boundary.sequence_id)}"`;
  if (boundary.from_id) out += ` data-launchclip-transition-from="${attr(boundary.from_id)}"`;
  if (boundary.to_id) out += ` data-launchclip-transition-to="${attr(boundary.to_id)}"`;
  return out;
}

// <video>/<audio> leave the scene layer for the root, where no layer
// transition or wrapper can hide or freeze them.
function hoistMedia(html) {
  const elements = [];
  const rest = html.replace(/<(video|audio)\b[^>]*>(?:[\s\S]*?<\/\1>)?/gi, (match) => { elements.push(match); return ''; });
  return { html: rest, elements };
}

// html that is one <video> and nothing else. Such a video can stay inside a
// world plate: HyperFrames seeks every timed <video> in the document unless a
// timed ancestor holds it (the plate and camera wrappers are not timed), and
// its render draws each frame as an <img> sibling with the video's own box,
// so the plate's and camera's transforms apply to the frame too.
function soleVideo(html) {
  return /^\s*<video\b[^>]*>(?:\s*<\/video>)?\s*$/i.test(html ?? '');
}

// A held clone's <video> → {html: an <img> with the video's id, class and
// style (so the held timeline's sets still move it), frame: {src, time, file}}.
// time is the source time of the frame Remotion's <Freeze> holds: the
// scene-relative frame at `at` from data-media-start.
function heldStill(videoHtml, at, fps, file) {
  const tag = /<video\b[^>]*>/i.exec(videoHtml)[0];
  const read = (name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  const src = read('src');
  if (!src) return null;
  const start = Number(read('data-start')) || 0, mediaStart = Number(read('data-media-start')) || 0;
  const time = round(mediaStart + Math.max(0, Math.round(at * fps) - Math.round(start * fps)) / fps, 6);
  const keep = ['id', 'class', 'style'].map((name) => (read(name) === undefined ? '' : ` ${name}="${read(name)}"`)).join('');
  return { html: `<img${keep} src="${attr(file)}" alt="" data-launchclip-held-frame="${attr(src)}">`, frame: { src, time, file } };
}

// One frame of a video as a PNG, with ffmpeg's default conversion (as
// HyperFrames' own frame extraction). → null, or the error message.
function extractFrame(source, time, target) {
  return new Promise((resolve) => {
    mkdir(path.dirname(target), { recursive: true }).then(() => {
      execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(time), '-i', source, '-frames:v', '1', target], (error, stdout, stderr) => {
        resolve(error ? (String(stderr).trim().split('\n').at(-1) || error.message) : (existsSync(target) ? null : 'no frame at that time'));
      });
    }, (error) => resolve(error.message));
  });
}

// Root media sits outside its scene layer, so it would ignore the layer's
// transition (a morph's crossfade, a push or whip) that Remotion applies to
// everything in the scene. Replay the layer tweens on the media element with
// properties the module's own motion never touches: x/y as xPercent/yPercent
// of the element box (GSAP adds them to x/y as pure translations), opacity and
// blur as one CSS filter, so they multiply with the module's opacity. Each
// filter tween writes both components, holding the other at the layer's value.
// Layer scale (zoom) and iris pivot on the canvas centre and are reported as
// unsupported. → {lines: [GSAP calls], unsupported: [props]}
export function mediaLayerTweens(element, tweens) {
  const id = /\sid="([^"]+)"/.exec(element)?.[1];
  const box = (name) => Number(new RegExp(`[;"\\s]${name}:\\s*(-?[\\d.]+)px`).exec(element)?.[1]);
  const width = box('width'), height = box('height');
  const lines = [];
  const unsupported = new Set();
  if (!id) return { lines, unsupported: [...new Set(tweens.map((tw) => tw.prop))] };
  const selector = `#${id}`;
  const filter = (state) => `opacity(${round(state.opacity, 4)}) blur(${round(state.blur, 3)}px)`;
  for (const tw of tweens) {
    const timing = { duration: round(tw.duration, 4), ease: tw.ease, immediateRender: false };
    if ((tw.prop === 'x' && width > 0) || (tw.prop === 'y' && height > 0)) {
      const key = tw.prop === 'x' ? 'xPercent' : 'yPercent', size = tw.prop === 'x' ? width : height;
      lines.push(`tl.fromTo(${js(selector)}, ${js({ [key]: round(tw.from / size * 100, 4) })}, ${js({ [key]: round(tw.to / size * 100, 4), ...timing })}, ${num(tw.at)});`);
    } else if (tw.prop === 'opacity' || tw.prop === 'blur') {
      const before = { ...layerStateAt(tw.at, tweens, getEase), [tw.prop]: tw.from };
      const after = { ...layerStateAt(tw.at + tw.duration, tweens, getEase), [tw.prop]: tw.to };
      lines.push(`tl.fromTo(${js(selector)}, ${js({ filter: filter(before) })}, ${js({ filter: filter(after), ...timing })}, ${num(tw.at)});`);
    } else unsupported.add(tw.prop);
  }
  return { lines, unsupported: [...unsupported] };
}

function withZIndex(element, z) {
  return /\sstyle="/.test(element) ? element.replace(/\sstyle="/, ` style="z-index:${z};`) : element.replace(/^<(\w+)/, `<$1 style="z-index:${z}"`);
}

// The loop clone is shown by its layer, not by HyperFrames clip timing.
function unclip(html) {
  return html
    .replace(/\sclass="clip(?=[\s"])\s*/g, ' class="lc-unclipped ')
    .replace(/\sdata-(start|duration|track-index)="[^"]*"/g, '');
}

export function emitPlaceholder(model) {
  const { id, rect, start, duration, track, content } = model;
  const html = `<section id="${attr(id)}" class="clip lc-placeholder" data-start="${num(start)}" data-duration="${num(duration)}" data-track-index="${track ?? FIRST_SCENE_TRACK}" data-launchclip-placeholder="${attr(model.module ?? '')}" style="left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px"><div class="lc-placeholder-label">${text(content.label)}</div>${content.detail ? `<div class="lc-placeholder-detail">${text(content.detail)}</div>` : ''}</section>`;
  return { html, css: '', motion: '', events: [], layout: model.layout };
}

function placeholderCss() {
  const S = PLACEHOLDER_STYLE;
  return `.lc-placeholder { position: absolute; display: flex; flex-direction: column; justify-content: center; gap: 16px; padding: ${S.padding}px; overflow: hidden; background: ${S.surface}; color: ${S.foreground}; border: ${S.borderWidth}px dashed ${S.border}; border-radius: ${S.radius}px; font-family: ${S.fontFamily}; }
    .lc-placeholder-label { font-size: ${S.labelSize}px; font-weight: 800; line-height: 1.1; overflow-wrap: anywhere; }
    .lc-placeholder-detail { font-size: ${S.detailSize}px; line-height: 1.3; color: ${S.muted}; overflow-wrap: anywhere; }`;
}

async function loadCaptionChunks(story, overlay, sourceDir, warnings) {
  try {
    if (overlay.src) {
      if (!sourceDir) throw new Error('captions src needs options.sourceDir');
      return captionChunksFrom(JSON.parse(await readFile(path.join(sourceDir, overlay.src), 'utf8')));
    }
    const wordsFile = story.audio?.words;
    if (!wordsFile || !sourceDir) { warnings.push('captions overlay has no src and no audio.words file to chunk; captions skipped'); return null; }
    const words = narrationWords(JSON.parse(await readFile(path.join(sourceDir, wordsFile), 'utf8')));
    if (!words.length) { warnings.push(`${wordsFile} has no words; captions skipped`); return null; }
    return chunkWords(words);
  } catch (error) {
    warnings.push(`captions skipped: ${error.message}`);
    return null;
  }
}

// Project fonts (kit/core/fonts.mjs): every family the project draws with
// (role defaults, the symbol fallback and the brand families) as @font-face
// rules over local files, so a render never fetches a font or reaches a host
// system font. For each family, frozen files under <sourceDir>/assets/fonts/
// (named <family-slug>*.woff2) win; otherwise the registry's @fontsource file
// is copied to <projectDir>/fonts/. The Remotion kit (kit/remotion/fonts.ts)
// makes the same choice per family, so both renderers draw the same files.
//
//   const {css, copies, warnings} = await projectFontFaces(story.brand, {sourceDir});
//   await copyProjectFonts(copies, projectDir);
export async function projectFontFaces(brand, { sourceDir, resolveFrom = [] } = {}) {
  const rules = [];
  const copies = [];
  const warnings = [];
  let local = [];
  if (sourceDir && existsSync(path.join(sourceDir, 'assets/fonts'))) local = await readdir(path.join(sourceDir, 'assets/fonts'));
  for (const family of projectFontFamilies(brand)) {
    const frozen = frozenFontFaces(family, local);
    if (frozen.length) {
      for (const face of frozen) rules.push(fontFaceRule(face, `assets/fonts/${face.file}`));
      continue;
    }
    const faces = registryFontFaces([family]);
    if (!faces.length) {
      warnings.push(`font "${family}" is not in the LaunchClip font registry and has no files under assets/fonts/ (named ${fontSlug(family)}-<weight>.woff2); its role's bundled family is used instead`);
      continue;
    }
    for (const face of faces) {
      const file = resolveFontFile(face.module, [sourceDir, ...resolveFrom]);
      if (!file) {
        warnings.push(`font file ${face.module} is not installed; run npm install (the @fontsource packages pinned in package.json) so ${family} renders`);
        continue;
      }
      copies.push({ from: file, to: `fonts/${face.file}` });
      rules.push(fontFaceRule(face, `fonts/${face.file}`));
    }
  }
  return { css: rules.join('\n'), copies, warnings };
}

/** Copy resolved font files into the project (fonts/<file>). → relative paths written */
export async function copyProjectFonts(copies, projectDir) {
  const written = [];
  for (const { from, to } of copies) {
    const target = path.join(projectDir, to);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(from, target);
    written.push(to);
  }
  return written;
}

// A registry file inside node_modules: next to this compiler first (the repo
// or an installed launchclip), then next to the storyboard project (a skill
// copy of this file used in a project that installed the font packages).
function resolveFontFile(specifier, roots) {
  const bases = [import.meta.url, ...roots.filter(Boolean).map((dir) => path.join(path.resolve(dir), 'package.json')), path.join(process.cwd(), 'package.json')];
  for (const base of bases) {
    try { return createRequire(base).resolve(specifier); } catch { /* try the next base */ }
  }
  return null;
}

// Start every declared face loading as soon as the page parses, so the
// renderer's document.fonts.ready wait covers faces whose text is not on
// screen yet (captions, later scenes).
export const FONT_WARMUP = 'if (document.fonts) for (const face of document.fonts) face.load().catch(() => {});';

function attr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function text(value) { return attr(value); }
function js(value) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
function round(value, digits = 3) { const f = 10 ** digits; return Math.round(value * f) / f; }
function num(value) { return String(round(Number(value), 4)); }
