// Render segments, the pure half (the Node half that reads files, renders and
// joins is src/render_segments.js, which re-exports all of this). The
// timeline of a resolved story splits into segments at the frames where the
// set of visible layers changes, and each segment hashes what can change its
// pixels; `finish` caches segments by that hash. Planning and hashing are
// here, without Node, so an editor can tell which segments an edit
// invalidates (story-patch.mjs diffSegments) with the same hashes `finish`
// computes. src/render_segments.js describes what each hash covers.
import { visibleChunks } from "./captions.mjs";
import { cameraOps } from "./catalog-c.mjs";
import { backgroundFieldTiles, backgroundLayer, blurAt, cameraPlan, containerState, objectRectFromModel, opsStateAt, overlayOps } from "./camera-world.mjs";
import { ambientField, blobStateAt } from "./ambient.mjs";
import { backgroundPlan } from "./backgrounds.mjs";
import { storyHasPlate } from "./plates.mjs";
import { resolveModule } from "./modules.mjs";
import { sha256Hex } from "./sha256.mjs";
import { storyBase } from "./story.mjs";
import { sceneWindows } from "./transitions.mjs";

export const SEGMENT_SCHEMA = "launchclip.render-segment.v1";


// Story fields whose visual effect is hashed through another route (scenes and
// the ending through the layers, overlays per window) or that never reach a
// frame (engine: the stamp of the engine that wrote the story). Everything
// else at the top level is global: a world camera, ambient drift, style or
// grammar settings invalidate every segment.
const NON_VISUAL_TOP = new Set(["scenes", "overlays", "audio", "ending", "title", "notes", "meta", "engine"]);
// audio.* that only shapes the soundtrack (captions are hashed as chunks).
const AUDIO_ONLY = new Set(["mix", "mix_volume", "voice", "narration", "words", "music", "sfx"]);
// WordCaptions shows a chunk from start − 0.001 s to end + 1 s.
const CAPTION_LEAD = 0.05;
const CAPTION_TAIL = 1;

// ---------------------------------------------------------------------------
// Hashing

/** sha256 hex of a string, or of any value as stable (key-sorted) JSON. */
export function hashValue(value) {
  return sha256Hex(typeof value === "string" ? value : stableJson(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// ---------------------------------------------------------------------------
// Planning

/** {fps, frames, width, height, duration} of a resolved story. */
export function storyFrames(story) {
  const fps = Number(story?.resolved?.fps ?? story?.format?.fps ?? 30);
  const duration = Number(story?.resolved?.duration ?? story?.format?.duration);
  const frames = Math.max(1, Number(story?.resolved?.frames ?? Math.round(duration * fps)));
  return { fps, frames, duration, width: story?.format?.width, height: story?.format?.height };
}

/**
 * Every drawn layer with its frame window [from, to), exactly as
 * StoryComposition mounts it: scene layers over their render windows (the
 * outgoing track-0 scene is held until the incoming transition settles) and
 * the loop ending.
 */
export function segmentLayers(story) {
  const { fps, frames } = storyFrames(story);
  const at = (seconds) => Math.round(seconds * fps);
  const windows = sceneWindows(story);
  const layers = windows.scenes.map((entry) => {
    const from = at(entry.start);
    return { key: entry.id, kind: "scene", sceneId: entry.id, from, to: from + Math.max(1, at(entry.renderEnd) - from), entry };
  });
  if (windows.loop) {
    const from = at(windows.loop.start);
    layers.push({ key: `${windows.loop.sceneId}~loop`, kind: "loop", sceneId: windows.loop.sceneId, from, to: from + Math.max(1, at(windows.loop.end) - from), entry: windows.loop });
  }
  for (const layer of layers) {
    layer.from = Math.max(0, Math.min(frames, layer.from));
    layer.to = Math.max(layer.from, Math.min(frames, layer.to));
  }
  return layers.filter((layer) => layer.to > layer.from);
}

/**
 * Split a resolved story into render segments: maximal frame ranges over
 * which the same layers are on screen. → {fps, frames, segments: [{index, id,
 * label, kind, startFrame, endFrame (exclusive), start, end, frames, scenes,
 * layers}]}. kind: "scene" (one track-0 scene), "transition" (two or more:
 * the overlap of an incoming scene and the scene held under it), "gap".
 * options.minFrames merges shorter segments into their shorter neighbour.
 */
export function planSegments(story, { minFrames = 1 } = {}) {
  const { fps, frames } = storyFrames(story);
  const layers = segmentLayers(story);
  const cuts = [...new Set([0, frames, ...layers.flatMap((layer) => [layer.from, layer.to])])].filter((frame) => frame >= 0 && frame <= frames).sort((a, b) => a - b);
  let ranges = [];
  for (let i = 0; i < cuts.length - 1; i += 1) ranges.push({ startFrame: cuts[i], endFrame: cuts[i + 1] });
  const visible = (range) => layers.filter((layer) => layer.from < range.endFrame && layer.to > range.startFrame);
  // Neighbouring ranges with the same layers (a split that only a zero-length layer made) are one segment.
  ranges = ranges.reduce((out, range) => {
    const previous = out.at(-1);
    if (previous && sameKeys(visible(previous), visible(range))) previous.endFrame = range.endFrame;
    else out.push({ ...range });
    return out;
  }, []);
  while (ranges.length > 1) {
    const index = ranges.findIndex((range) => range.endFrame - range.startFrame < minFrames);
    if (index < 0) break;
    const neighbour = index === 0 ? 1 : index === ranges.length - 1 ? index - 1 : (ranges[index - 1].endFrame - ranges[index - 1].startFrame <= ranges[index + 1].endFrame - ranges[index + 1].startFrame ? index - 1 : index + 1);
    const [a, b] = [Math.min(index, neighbour), Math.max(index, neighbour)];
    ranges.splice(a, 2, { startFrame: ranges[a].startFrame, endFrame: ranges[b].endFrame });
  }
  const segments = ranges.map((range, index) => {
    const shown = visible(range);
    const plates = shown.filter((layer) => layer.kind === "loop" || layer.entry.plate);
    const label = shown.length ? shown.map((layer) => layer.key).join("+") : "gap";
    return {
      index,
      id: `${String(index).padStart(2, "0")}-${label}`,
      label,
      kind: plates.length > 1 ? "transition" : shown.length ? "scene" : "gap",
      startFrame: range.startFrame,
      endFrame: range.endFrame,
      start: round6(range.startFrame / fps),
      end: round6(range.endFrame / fps),
      frames: range.endFrame - range.startFrame,
      scenes: [...new Set(shown.map((layer) => layer.sceneId))],
      layers: shown.map((layer) => layer.key)
    };
  });
  return { fps, frames, segments, layers };
}

function sameKeys(a, b) {
  return a.length === b.length && a.every((layer, index) => layer.key === b[index].key);
}

// ---------------------------------------------------------------------------
// Segment inputs

/** The captions overlay that draws (style other than "none"), or null. */
export function captionOverlay(story) {
  return (Array.isArray(story?.overlays) ? story.overlays : []).find((overlay) => overlay?.type === "captions" && overlay.style !== "none") ?? null;
}

function hasWindow(overlay) {
  return typeof overlay?.start === "number" || typeof overlay?.end === "number";
}

function omit(object, keys) {
  if (!object || typeof object !== "object") return undefined;
  const out = {};
  for (const [key, value] of Object.entries(object)) if (!keys.has(key)) out[key] = value;
  return Object.keys(out).length ? out : undefined;
}

/** Module models by scene id (null when a module does not resolve: the placeholder renders). */
export function sceneModels(story) {
  const models = new Map();
  for (const entry of sceneWindows(story).scenes) {
    const scene = entry.scene;
    if (scene.module === "custom") {
      models.set(entry.id, { id: scene.id, module: "custom", start: scene.start, end: entry.renderEnd, hidesCaptions: Boolean(scene.params?.hidesCaptions) });
      continue;
    }
    try { models.set(entry.id, resolveModule(scene, story, { end: entry.renderEnd })); }
    catch { models.set(entry.id, null); }
  }
  return models;
}

/**
 * The caption chunks StoryComposition shows: the chunks (from the captions
 * overlay's src, else the chunked narration words) minus those that start in
 * a hidden range (overlay.hide and scenes whose module hides captions). null
 * without a captions overlay or chunks.
 */
export function shownCaptionChunks(story, chunks, { models = sceneModels(story) } = {}) {
  const overlay = captionOverlay(story);
  if (!overlay || !chunks) return null;
  const windows = sceneWindows(story).scenes;
  const hide = [
    ...(Array.isArray(overlay.hide) ? overlay.hide : []),
    ...windows.filter((entry) => models.get(entry.id)?.hidesCaptions).map((entry) => [entry.start, entry.renderEnd])
  ];
  return visibleChunks(chunks, hide);
}

/** Every assets/ path referenced anywhere in a value. */
export function collectAssets(value) {
  const found = new Set();
  const visit = (item) => {
    if (typeof item === "string") { if (/^(\.\/)?assets\//.test(item)) found.add(item.replace(/^\.\//, "")); return; }
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return [...found].sort();
}

/** The settings every segment depends on. */
export function globalSettings(story, { models = sceneModels(story), base = null } = {}) {
  const top = {};
  for (const [key, value] of Object.entries(story ?? {})) if (!NON_VISUAL_TOP.has(key)) top[key] = value;
  const audio = omit(story?.audio, AUDIO_ONLY);
  const overlay = captionOverlay(story);
  const footage = storyBase(story);
  return {
    top,
    audio: audio ?? null,
    captions: overlay ? omit(overlay, new Set(["src"])) ?? {} : null,
    overlays: (Array.isArray(story?.overlays) ? story.overlays : []).filter((entry) => entry?.type !== "captions" && !hasWindow(entry)),
    // The footage base runs under every segment, moved by a camera path built
    // from every scene's camera samples.
    base: footage ? { base: footage, file: base, camera: cameraOps([...models.values()].filter(Boolean)) } : null,
    // The ambient background field is seeded from the title and takes its
    // default level from the dominant scene energy, so it varies with fields
    // that are otherwise outside the hash.
    ambient: backgroundPlan(story) ? null : ambientField(story),
    // A background kind (kit/core/backgrounds.mjs) replaces the field; keyed
    // only when set, so stories without one keep their digests.
    ...(backgroundPlan(story) ? { background: backgroundPlan(story) } : {}),
    // Backdrop plates (kit/core/plates.mjs): the story's and each chapter's
    // (a scene's own plate is in its scene); keyed only when set.
    ...(storyHasPlate(story) ? { plate: { story: story.plate ?? null, chapters: (Array.isArray(story.chapters) ? story.chapters : []).map((chapter) => ({ start: chapter?.start ?? null, plate: chapter?.plate ?? null })) } } : {})
  };
}

function layerDigest(layer, story, byId) {
  const entry = layer.entry;
  if (layer.kind === "loop") return { kind: "loop", scene: entry.scene, start: entry.start, end: entry.end, tweens: entry.tweens, transitionIn: entry.transitionIn };
  const from = typeof entry.scene?.in?.from_object === "string" ? entry.scene.in.from_object.split(".")[0] : null;
  return {
    kind: "scene",
    index: entry.index,
    scene: entry.scene,
    start: entry.start,
    end: entry.end,
    renderEnd: entry.renderEnd,
    track: entry.track,
    plate: entry.plate,
    tweens: entry.tweens,
    transitionIn: entry.transitionIn,
    // A morph draws the shared object from the scene it names.
    refs: from && byId.has(from) && from !== entry.id ? { [from]: byId.get(from) } : {}
  };
}

/**
 * Attach a content hash to every planned segment. inputs: gatherSegmentInputs()
 * (or the same shape); encoder: the segment encoder settings.
 * Each segment also gets `parts` (the hash of each input group), so a caller
 * can tell why a segment changed.
 */
export function hashSegments(story, plan, inputs, { encoder = null } = {}) {
  const byId = new Map((story.scenes ?? []).map((scene) => [scene.id, scene]));
  const layersByKey = new Map(plan.layers.map((layer) => [layer.key, layer]));
  const camera = segmentCamera(story, inputs.models ?? sceneModels(story), plan.fps);
  const global = hashValue(globalSettings(story, { models: inputs.models ?? sceneModels(story), base: inputs.base ?? null }));
  const { width, height } = storyFrames(story);
  const timedOverlays = (Array.isArray(story.overlays) ? story.overlays : []).filter((entry) => entry?.type !== "captions" && hasWindow(entry));
  return plan.segments.map((segment) => {
    const first = segment.startFrame / plan.fps;
    const last = (segment.endFrame - 1) / plan.fps;
    const layers = segment.layers.map((key) => layersByKey.get(key));
    const scenes = layers.map((layer) => layer.entry.scene);
    const parts = {
      global,
      layers: hashValue(layers.map((layer) => layerDigest(layer, story, byId))),
      captions: hashValue((inputs.captions ?? []).filter((chunk) => chunk.start - CAPTION_LEAD <= last + 1e-9 && chunk.end + CAPTION_TAIL >= first - 1e-9)),
      overlays: hashValue(timedOverlays.filter((entry) => Number(entry.start ?? 0) <= last + 1e-9 && Number(entry.end ?? Infinity) >= first - 1e-9)),
      assets: hashValue(Object.fromEntries(collectAssets(scenes).map((asset) => [asset, inputs.assets?.[asset] ?? null]))),
      ...(camera ? { camera: hashValue(camera(segment, layers)) } : {})
    };
    const hash = hashValue({
      schema: SEGMENT_SCHEMA,
      renderer: inputs.renderer,
      encoder,
      kit: inputs.kit,
      fonts: inputs.fonts,
      fps: plan.fps,
      size: [width, height],
      frames: [segment.startFrame, segment.endFrame],
      parts
    });
    return { ...segment, hash, parts };
  });
}

/**
 * The world camera (kit/core/camera-world.mjs) as a per-segment digest, or
 * null when the story has no camera. The camera path is derived across scenes
 * (every plate's placement follows from the transitions before it, the
 * parallax layer accumulates every move, pushes read another scene's object),
 * so a segment hashes what the camera puts on screen during its frames rather
 * than its own scenes: the container states and blur on every frame, the
 * placements of its plates, its overlays' parallax and the depth-layer glows
 * and field tiles that pass through the canvas. → (segment, layers) => digest
 */
export function segmentCamera(story, models, fps) {
  const objects = (sceneId, name) => objectRectFromModel(models.get(sceneId), name);
  const plan = cameraPlan(story, { windows: sceneWindows(story), objects });
  if (!plan) return null;
  // The depth layer is the tiled ambient field when there is one, else glows.
  const field = plan.background && !backgroundPlan(story) ? ambientField(story) : null;
  const blobs = new Map((field?.blobs ?? []).map((blob) => [blob.id, blob]));
  const tiles = backgroundFieldTiles(plan, field);
  // A background kind in world mode sits fixed under the camera, in place of the glows.
  const glows = plan.background && !tiles.length && !(plan.mode === "world" && backgroundPlan(story)) ? backgroundLayer(plan, story.brand).glows : [];
  const r4 = (value) => Math.round(value * 1e4) / 1e4;
  const state = (t) => {
    const c = containerState(plan, t);
    return [c.pan.x, c.pan.y, c.zoom.scale, c.zoom.rotation, c.drift.x, c.drift.y, c.drift.scale, c.background.x, c.background.y, c.background.rotation].map(r4);
  };
  return (segment, layers) => {
    const frames = [];
    const seen = new Set();
    const seenTiles = new Set();
    const overlays = layers.filter((layer) => layer.kind === "scene" && !layer.entry.plate)
      .map((layer) => ({ key: layer.key, ops: overlayOps(plan, { start: layer.entry.start, end: layer.entry.renderEnd }) }))
      .filter((entry) => entry.ops.length);
    for (let frame = segment.startFrame; frame < segment.endFrame; frame += 1) {
      const t = frame / fps;
      const blur = blurAt(plan, t);
      frames.push([...state(t), r4(blur.x), r4(blur.y), ...overlays.map((entry) => { const o = opsStateAt(entry.ops, "overlay", t); return [r4(o.x ?? 0), r4(o.y ?? 0)]; })]);
      const bg = containerState(plan, t).background;
      glows.forEach((glow, index) => {
        const x = glow.left + bg.x, y = glow.top + bg.y, pad = glow.size * 0.1;
        if (x < plan.width + pad && x + glow.size > -pad && y < plan.height + pad && y + glow.size > -pad) seen.add(index);
      });
      tiles.forEach((tile, index) => {
        const blob = blobs.get(tile.blob), b = blobStateAt(blob, t);
        const size = blob.size * b.scale, x = tile.dx + b.x + bg.x - (size - blob.size) / 2, y = tile.dy + b.y + bg.y - (size - blob.size) / 2, pad = size * 0.1;
        if (x < plan.width + pad && x + size > -pad && y < plan.height + pad && y + size > -pad) seenTiles.add(index);
      });
    }
    return {
      mode: plan.mode,
      frames,
      placements: layers.map((layer) => [layer.key, layer.kind === "loop" ? plan.loop : plan.placements[layer.key] ?? null]),
      overlays: overlays.map((entry) => entry.key),
      glows: [...seen].sort((a, b) => a - b).map((index) => glows[index]),
      field: [...seenTiles].sort((a, b) => a - b).map((index) => tiles[index])
    };
  };
}

/** Segments that show any of the given scene ids. */
export function segmentsForScenes(segments, sceneIds) {
  const wanted = new Set(sceneIds);
  return segments.filter((segment) => segment.scenes.some((id) => wanted.has(id)));
}

// ---------------------------------------------------------------------------
// Soundtrack

/**
 * What StoryComposition plays: audio.mix (or the voice when there is no mix
 * and no footage base) at audio.mix_volume, plus the footage base's own audio.
 * → {src, volume, base: boolean}
 */
export function storySoundtrack(story) {
  const base = storyBase(story);
  const src = base ? story.audio?.mix ?? null : story.audio?.mix ?? story.audio?.voice ?? null;
  const volume = typeof story.audio?.mix_volume === "number" && src === story.audio?.mix ? story.audio.mix_volume : 1;
  return { src, volume, base: Boolean(base && base.volume > 0) };
}

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}
