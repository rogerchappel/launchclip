// Render segments: the "second pass" iteration loop of `launchclip finish`.
//
// The timeline of a resolved story is split into segments at the frames where
// the set of visible layers changes (kit/core/transitions.mjs sceneWindows, in
// the frame space StoryComposition uses). A scene's body is one segment and
// every transition overlap is its own segment: the incoming scene and the
// outgoing scene held under it are wholly inside it, so no join ever falls
// mid-transition and editing one scene re-renders only its body and the two
// transitions that show it.
//
// Each segment is hashed from what can change its pixels: the visible layers
// (scene, render window, transition tweens, scenes it morphs from, the assets
// it references), the caption chunks on screen in its window (a chunk that
// crosses a join is in the hash of both segments), timed overlays in its
// window, the global settings (brand, format, lane, style, camera, ambient …
// every top-level field that is not a scene, an overlay or audio-only), the
// footage base and its camera path, the world camera's state on every frame of
// the segment (kit/core/camera-world.mjs: the path is derived across scenes,
// so editing one scene's camera transition moves the camera, the parallax
// layer and the overlays in later segments too), the fonts, a content hash of the kit
// sources that render, the renderer and the segment encoder. Segments are
// cached by hash in .launchclip/finish/segments/<renderer>/<hash>.mp4.
//
// Remotion renders missing segments by frame range (src/renderers/remotion_segments.js),
// joins them with the FFmpeg concat demuxer (stream copy), encodes once with
// the delivery settings and muxes the soundtrack once over the whole timeline.
// HyperFrames' CLI has no frame range, so it renders whole videos, cached by
// the hash of the whole timeline.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { captionChunksFrom, chunkWords, narrationWords, visibleChunks } from "../kit/core/captions.mjs";
import { cameraOps } from "../kit/core/catalog-c.mjs";
import { backgroundLayer, blurAt, cameraPlan, containerState, objectRectFromModel, opsStateAt, overlayOps } from "../kit/core/camera-world.mjs";
import { ambientField } from "../kit/core/ambient.mjs";
import { allFontFaces } from "../kit/core/fonts.mjs";
import { resolveModule } from "../kit/core/modules.mjs";
import { storyBase } from "../kit/core/story.mjs";
import { sceneWindows } from "../kit/core/transitions.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const SEGMENT_SCHEMA = "launchclip.render-segment.v1";
export const SEGMENTS_DIR = ".launchclip/finish/segments";
/** Renderers that can render a frame range. */
export const PARTIAL_RENDERERS = Object.freeze(["remotion"]);

// Story fields whose visual effect is hashed through another route (scenes and
// the ending through the layers, overlays per window) or that never reach a
// frame. Everything else at the top level is global: a world camera, ambient
// drift, style or grammar settings invalidate every segment.
const NON_VISUAL_TOP = new Set(["scenes", "overlays", "audio", "ending", "title", "notes", "meta"]);
// audio.* that only shapes the soundtrack (captions are hashed as chunks).
const AUDIO_ONLY = new Set(["mix", "mix_volume", "voice", "narration", "words", "music", "sfx"]);
// WordCaptions shows a chunk from start − 0.001 s to end + 1 s.
const CAPTION_LEAD = 0.05;
const CAPTION_TAIL = 1;

// ---------------------------------------------------------------------------
// Hashing

export function hashValue(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

async function fileHash(file) {
  try { return createHash("sha256").update(await readFile(file)).digest("hex"); }
  catch (error) { if (error.code === "ENOENT" || error.code === "EISDIR") return null; throw error; }
}

async function treeContentHash(directory, { filter = () => true } = {}) {
  const entries = [];
  const walk = async (dir) => {
    let names;
    try { names = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && filter(full)) entries.push(`${path.relative(directory, full)}:${await fileHash(full)}`);
    }
  };
  await walk(directory);
  return hashValue(entries.join("\n"));
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

function captionOverlay(story) {
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
 * Caption chunks exactly as StoryComposition shows them: the captions
 * overlay's src (captions.json), else chunked audio.words, minus the chunks
 * that start in a hidden range (overlay.hide and scenes whose module hides
 * captions). null without a captions overlay or when the file is missing.
 */
export async function storyCaptionChunks(project, story, { models = sceneModels(story) } = {}) {
  const overlay = captionOverlay(story);
  if (!overlay) return null;
  let chunks = null;
  try {
    if (overlay.src) chunks = captionChunksFrom(JSON.parse(await readFile(path.join(project, overlay.src), "utf8")));
    else if (story.audio?.words) {
      const words = narrationWords(JSON.parse(await readFile(path.join(project, story.audio.words), "utf8")));
      chunks = words.length ? chunkWords(words) : null;
    }
  } catch {
    return null;
  }
  if (!chunks) return null;
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

// The kit sources that render for each renderer (content, not mtimes, so a
// fresh checkout reuses its segments).
const KIT_DIRS = Object.freeze({ remotion: ["kit/core", "kit/remotion"], hyperframes: ["kit/core", "kit/hyperframes"] });
const kitCache = new Map();

/**
 * Content hash of the kit sources a renderer draws with, plus its package
 * version (memoised per process; cache: false re-reads the files).
 */
export async function kitFingerprint(renderer, { root = ROOT, project, cache = true } = {}) {
  const dirs = KIT_DIRS[renderer] ?? ["kit"];
  const key = `${renderer}:${root}`;
  if (!cache) kitCache.delete(key);
  if (!kitCache.has(key)) {
    kitCache.set(key, (async () => {
      const parts = {};
      for (const dir of dirs) parts[dir] = await treeContentHash(path.join(root, dir));
      parts.package = renderer === "remotion" ? packageVersion("@remotion/renderer") : renderer === "hyperframes" ? packageVersion("hyperframes") : null;
      return hashValue(parts);
    })());
  }
  const kit = await kitCache.get(key);
  // A project's own Remotion entry and custom modules render too.
  const own = renderer === "remotion" && project && existsSync(path.join(project, "remotion")) ? await treeContentHash(path.join(project, "remotion")) : null;
  return own ? hashValue({ kit, project_remotion: own }) : kit;
}

function packageVersion(name) {
  try { return require(`${name}/package.json`).version; } catch { return null; }
}

/** Hash of every registry font file and of the project's frozen fonts (assets/fonts/). */
export async function fontsFingerprint(project) {
  const files = {};
  for (const face of allFontFaces()) {
    let file = null;
    try { file = require.resolve(face.module); } catch { /* not installed: hashed as missing */ }
    files[face.module] = file ? await fileHash(file) : null;
  }
  const frozen = project ? await treeContentHash(path.join(project, "assets", "fonts")) : null;
  return hashValue({ registry: files, frozen });
}

/**
 * Everything segment hashes need from disk: {renderer, kit, fonts, captions,
 * assets: {path: sha256|null}, base: sha256|null, models}.
 */
export async function gatherSegmentInputs(project, story, renderer) {
  const models = sceneModels(story);
  const assets = {};
  for (const asset of collectAssets(story.scenes ?? [])) assets[asset] = await fileHash(path.join(project, asset));
  const base = storyBase(story);
  return {
    renderer,
    kit: await kitFingerprint(renderer, { project }),
    fonts: await fontsFingerprint(project),
    captions: await storyCaptionChunks(project, story, { models }),
    assets,
    base: base ? await fileHash(path.join(project, base.src)) : null,
    models
  };
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
    ambient: ambientField(story)
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
 * that pass through the canvas. → (segment, layers) => digest
 */
export function segmentCamera(story, models, fps) {
  const objects = (sceneId, name) => objectRectFromModel(models.get(sceneId), name);
  const plan = cameraPlan(story, { windows: sceneWindows(story), objects });
  if (!plan) return null;
  const glows = plan.parallax ? backgroundLayer(plan, story.brand).glows : [];
  const r4 = (value) => Math.round(value * 1e4) / 1e4;
  const state = (t) => {
    const c = containerState(plan, t);
    return [c.pan.x, c.pan.y, c.zoom.scale, c.zoom.rotation, c.drift.x, c.drift.y, c.drift.scale, c.background.x, c.background.y, c.background.rotation].map(r4);
  };
  return (segment, layers) => {
    const frames = [];
    const seen = new Set();
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
    }
    return {
      mode: plan.mode,
      frames,
      placements: layers.map((layer) => [layer.key, layer.kind === "loop" ? plan.loop : plan.placements[layer.key] ?? null]),
      overlays: overlays.map((entry) => entry.key),
      glows: [...seen].sort((a, b) => a - b).map((index) => glows[index])
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

// ---------------------------------------------------------------------------
// FFmpeg tools (each replaceable in tests)

export function defaultSegmentTools() {
  const ffmpeg = (args) => execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 1 << 26 });
  return {
    async concat(files, output) {
      const list = `${output}.txt`;
      await writeFile(list, files.map((file) => `file '${path.resolve(file).replaceAll("'", "'\\''")}'`).join("\n") + "\n");
      try { await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-c", "copy", "-an", output]); }
      finally { await rm(list, { force: true }); }
    },
    // The soundtrack as AAC (48 kHz stereo, 320 kb/s, as Remotion encodes it),
    // padded or cut to the timeline; cached, so a re-render only remuxes it.
    async encodeAudio({ audio, output, volume = 1, duration }) {
      await ffmpeg(["-i", audio, "-vn", "-af", `volume=${volume},apad`, "-t", String(duration), "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "320k", output]);
    },
    // Mux the soundtrack (stream copy): offset/duration cut a window of it (previews).
    async mux({ video, audio, output, offset = 0, duration }) {
      if (!audio) { await copyFile(video, output); return; }
      const input = [...(offset > 0 ? ["-ss", String(offset)] : []), "-i", audio];
      await ffmpeg(["-i", video, ...input, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", ...(duration ? ["-t", String(duration)] : ["-shortest"]), "-movflags", "+faststart", output]);
    },
    async countFrames(file) {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file]);
      return Number(String(stdout).trim());
    },
    async still(video, frame, output) {
      await mkdir(path.dirname(output), { recursive: true });
      await ffmpeg(["-i", video, "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", output]);
    },
    async sideBySide(left, right, output) {
      await ffmpeg(["-i", left, "-i", right, "-filter_complex", "[0][1]hstack=inputs=2,scale=iw/2:-2", "-frames:v", "1", output]);
    },
    async trim(video, startFrame, endFrame, output, { fps }) {
      await ffmpeg(["-i", video, "-vf", `trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS`, "-af", `atrim=start=${startFrame / fps}:end=${endFrame / fps},asetpts=PTS-STARTPTS`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-c:a", "aac", "-b:a", "320k", output]);
    }
  };
}

// ---------------------------------------------------------------------------
// Rendering

async function readIndex(dir) {
  try { return JSON.parse(await readFile(path.join(dir, "index.json"), "utf8")); }
  catch { return { schema_version: SEGMENT_SCHEMA, segments: {} }; }
}

async function writeIndex(dir, index) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

const segmentFile = (dir, hash) => path.join(dir, `${hash}.mp4`);
const short = (hash) => hash.slice(0, 12);

/**
 * Render a resolved story through the segment cache.
 *
 * options:
 *   project, story (resolved), renderer (name), adapter (renderer adapter),
 *   quality, output (where the joined, muxed video goes),
 *   scenes: scene ids whose segments re-render even when cached,
 *   previewScene: render only the segments that show this scene,
 *   renderWhole(output): renders the whole video (renderers without frame ranges),
 *   tools: defaultSegmentTools() overrides, now: clock (ms),
 *   cacheRoot: default <project>/.launchclip/finish/segments
 * Returns the stage details: {mode, renderer, segments, reused, rendered,
 * forced, frames, seconds, seconds_saved, cache, plan}.
 */
export async function renderWithSegments(options) {
  const { project, story, renderer, adapter, quality = "draft" } = options;
  const tools = { ...defaultSegmentTools(), ...(options.tools ?? {}) };
  const now = options.now ?? (() => performance.now());
  const cacheRoot = options.cacheRoot ?? path.join(project, SEGMENTS_DIR);
  const dir = path.join(cacheRoot, renderer);
  const started = now();
  const forced = new Set(options.scenes ?? []);
  const plan = planSegments(story);
  if (options.previewScene && !plan.segments.some((segment) => segment.scenes.includes(options.previewScene))) {
    throw new Error(`scene "${options.previewScene}" is not on screen in the resolved story`);
  }
  const inputs = await gatherSegmentInputs(project, story, renderer);
  const partial = PARTIAL_RENDERERS.includes(renderer) && typeof adapter?.renderSegments === "function";
  await mkdir(dir, { recursive: true });
  const index = await readIndex(dir);
  const seconds = { plan: round3((now() - started) / 1000) };

  if (!partial) return renderWhole({ ...options, tools, now, dir, index, plan, inputs, forced, started, seconds });

  const encoder = typeof adapter.segmentEncoder === "function" ? adapter.segmentEncoder() : adapter.segmentEncoder ?? null;
  const hashed = hashSegments(story, plan, inputs, { encoder });
  const scope = options.previewScene ? contiguous(hashed, segmentsForScenes(hashed, [options.previewScene])) : hashed;
  const entries = scope.map((segment) => {
    const file = segmentFile(dir, segment.hash);
    const force = segment.scenes.some((id) => forced.has(id));
    return { segment, file, status: force ? "forced" : existsSync(file) ? "reused" : "rendered" };
  });

  // Render what is missing or forced, into a temporary name first.
  const work = entries.filter((entry) => entry.status !== "reused");
  const renderStarted = now();
  const timings = new Map();
  if (work.length) {
    const result = await adapter.renderSegments(project, work.map((entry) => ({ startFrame: entry.segment.startFrame, endFrame: entry.segment.endFrame, output: `${entry.file}.partial.mp4`, id: entry.segment.id })), { story, kitHash: inputs.kit, quality });
    for (const [i, entry] of work.entries()) {
      const temporary = `${entry.file}.partial.mp4`;
      if (!existsSync(temporary)) throw new Error(`segment ${entry.segment.id} was not rendered (${rel(project, temporary)})`);
      await rename(temporary, entry.file);
      const took = Number(result?.segments?.[i]?.seconds);
      timings.set(entry.segment.hash, Number.isFinite(took) ? took : null);
    }
  }
  seconds.render = round3((now() - renderStarted) / 1000);

  // Estimate the time reuse saved from what each reused segment took to render.
  const rate = perFrameRate(work, timings, index);
  let saved = 0;
  for (const entry of entries) {
    const record = index.segments?.[entry.segment.hash];
    if (entry.status === "reused") saved += Number.isFinite(record?.seconds) ? record.seconds : rate * entry.segment.frames;
    const took = timings.get(entry.segment.hash);
    index.segments[entry.segment.hash] = { id: entry.segment.id, frames: [entry.segment.startFrame, entry.segment.endFrame], scenes: entry.segment.scenes, seconds: took ?? record?.seconds ?? null, used_at: new Date().toISOString() };
  }

  // Join (stream copy), one delivery encode, one soundtrack mux.
  const output = path.resolve(options.output);
  await mkdir(path.dirname(output), { recursive: true });
  const joined = `${output}.joined.mp4`;
  const encoded = `${output}.video.mp4`;
  const joinStarted = now();
  await tools.concat(entries.map((entry) => entry.file), joined);
  seconds.join = round3((now() - joinStarted) / 1000);
  const encodeStarted = now();
  if (typeof adapter.encodeDelivery === "function") await adapter.encodeDelivery(joined, encoded, { quality });
  else await rename(joined, encoded);
  await rm(joined, { force: true });
  seconds.encode = round3((now() - encodeStarted) / 1000);
  const first = scope[0].startFrame;
  const last = scope.at(-1).endFrame;
  const muxStarted = now();
  const audio = await soundtrackFile({ project, story, adapter, dir, inputs, tools });
  await tools.mux({ video: encoded, audio: audio?.file ?? null, output, offset: first / plan.fps, duration: options.previewScene ? (last - first) / plan.fps : undefined });
  await rm(encoded, { force: true });
  seconds.mux = round3((now() - muxStarted) / 1000);
  const frames = await tools.countFrames(output);
  if (Number.isFinite(frames) && frames !== last - first) throw new Error(`joined render has ${frames} frames; expected ${last - first}`);

  if (!options.previewScene) await pruneCache(dir, index, new Set([...hashed.map((segment) => segment.hash), ...(audio?.key ? [audio.key] : [])]));
  await writeIndex(dir, index);
  seconds.total = round3((now() - started) / 1000);
  const count = (status) => entries.filter((entry) => entry.status === status).length;
  return {
    mode: "segments",
    renderer,
    segments: entries.length,
    reused: count("reused"),
    rendered: count("rendered") + count("forced"),
    forced: count("forced"),
    frames: { start: first, end: last, count: last - first },
    seconds,
    seconds_saved: round3(saved),
    cache: rel(project, dir),
    audio: audio ? { source: audio.source, volume: audio.volume } : null,
    plan: entries.map((entry) => ({ id: entry.segment.id, kind: entry.segment.kind, frames: [entry.segment.startFrame, entry.segment.endFrame], scenes: entry.segment.scenes, hash: short(entry.segment.hash), status: entry.status, seconds: timings.get(entry.segment.hash) == null ? null : round3(timings.get(entry.segment.hash)) }))
  };
}

// HyperFrames (no frame range): whole renders, cached by the whole timeline's hash.
async function renderWhole({ project, story, renderer, quality, output, previewScene, renderWhole: render, tools, now, dir, index, plan, inputs, forced, started, seconds }) {
  if (typeof render !== "function") throw new Error(`renderer "${renderer}" cannot render frame ranges and no whole-video renderer was given`);
  const segments = hashSegments(story, plan, inputs, { encoder: null });
  const soundtrack = storySoundtrack(story);
  const hash = hashValue({
    schema: SEGMENT_SCHEMA,
    whole: segments.map((segment) => segment.hash),
    quality,
    // A whole render carries its soundtrack.
    audio: { ...soundtrack, file: soundtrack.src ? await fileHash(path.join(project, soundtrack.src)) : null }
  });
  const file = segmentFile(dir, hash);
  const status = forced.size ? "forced" : existsSync(file) ? "reused" : "rendered";
  const renderStarted = now();
  let took = null;
  if (status !== "reused") {
    const temporary = `${file}.partial.mp4`;
    await render(temporary);
    if (!existsSync(temporary)) throw new Error(`${renderer} render did not write ${rel(project, temporary)}`);
    await rename(temporary, file);
    took = (now() - renderStarted) / 1000;
  }
  seconds.render = round3((now() - renderStarted) / 1000);
  const out = path.resolve(output);
  await mkdir(path.dirname(out), { recursive: true });
  let frames = { start: 0, end: plan.frames, count: plan.frames };
  if (previewScene) {
    const scope = contiguous(segments, segmentsForScenes(segments, [previewScene]));
    frames = { start: scope[0].startFrame, end: scope.at(-1).endFrame, count: scope.at(-1).endFrame - scope[0].startFrame };
    await tools.trim(file, frames.start, frames.end, out, { fps: plan.fps });
  } else {
    await copyFile(file, out);
  }
  const record = index.segments?.[hash];
  index.segments[hash] = { id: "whole", frames: [0, plan.frames], scenes: (story.scenes ?? []).map((scene) => scene.id), seconds: took ?? record?.seconds ?? null, used_at: new Date().toISOString() };
  if (!previewScene) await pruneCache(dir, index, new Set([hash]), { keep: 4 });
  await writeIndex(dir, index);
  seconds.total = round3((now() - started) / 1000);
  return {
    mode: "whole",
    renderer,
    note: `${renderer} renders whole videos (its CLI has no frame range); partial rendering is Remotion-only`,
    segments: 1,
    reused: status === "reused" ? 1 : 0,
    rendered: status === "reused" ? 0 : 1,
    forced: status === "forced" ? 1 : 0,
    frames,
    seconds,
    seconds_saved: status === "reused" && Number.isFinite(record?.seconds) ? round3(record.seconds) : 0,
    cache: rel(project, dir),
    plan: [{ id: "whole", kind: "whole", frames: [0, plan.frames], scenes: index.segments[hash].scenes, hash: short(hash), status, seconds: took == null ? null : round3(took) }]
  };
}

// The soundtrack to mux, encoded once and cached by the hash of what it is
// made of: audio.mix (or the voice) at its volume or, when a footage base plays
// its own audio, Remotion's own mix of the whole timeline.
async function soundtrackFile({ project, story, adapter, dir, inputs, tools }) {
  const soundtrack = storySoundtrack(story);
  if (soundtrack.base) {
    if (typeof adapter.renderAudio !== "function") throw new Error("the footage base plays audio, and this renderer cannot render the soundtrack on its own");
    const key = hashValue({ audio: story.audio ?? null, base: storyBase(story), base_file: inputs.base, mix: soundtrack.src ? await fileHash(path.join(project, soundtrack.src)) : null, duration: storyFrames(story) });
    const file = path.join(dir, `audio-${key}.aac`);
    if (!existsSync(file)) await adapter.renderAudio(project, file, { story, kitHash: inputs.kit });
    return { file, key, volume: 1, source: "remotion-mix" };
  }
  if (!soundtrack.src) return null;
  const source = path.join(project, soundtrack.src);
  const content = await fileHash(source);
  if (!content) throw new Error(`soundtrack not found: ${soundtrack.src}`);
  const { frames, fps } = storyFrames(story);
  const key = hashValue({ content, volume: soundtrack.volume, frames, fps, codec: "aac-320k-48k" });
  const file = path.join(dir, `audio-${key}.m4a`);
  if (!existsSync(file)) {
    await tools.encodeAudio({ audio: source, output: `${file}.partial.m4a`, volume: soundtrack.volume, duration: frames / fps });
    await rename(`${file}.partial.m4a`, file);
  }
  return { file, key, volume: soundtrack.volume, source: soundtrack.src };
}

function contiguous(all, chosen) {
  if (!chosen.length) return [];
  const first = all.indexOf(chosen[0]);
  const last = all.indexOf(chosen.at(-1));
  return all.slice(first, last + 1);
}

function perFrameRate(work, timings, index) {
  let seconds = 0, frames = 0;
  for (const entry of work) {
    const took = timings.get(entry.segment.hash);
    if (Number.isFinite(took)) { seconds += took; frames += entry.segment.frames; }
  }
  if (frames) return seconds / frames;
  for (const record of Object.values(index.segments ?? {})) {
    if (Number.isFinite(record?.seconds) && Array.isArray(record.frames)) { seconds += record.seconds; frames += record.frames[1] - record.frames[0]; }
  }
  return frames ? seconds / frames : 0;
}

// Keep the current plan's segments plus the most recently used others (the
// previous versions of an edited scene, so an undo is free); delete the rest.
async function pruneCache(dir, index, current, { keep = Math.max(24, current.size * 2) } = {}) {
  let names;
  try { names = await readdir(dir); } catch { return; }
  const files = [];
  for (const name of names) {
    const match = name.match(/^(?:audio-)?([0-9a-f]{64})\.(?:mp4|aac|m4a)$/);
    if (!match || current.has(match[1])) continue;
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (info) files.push({ name, hash: match[1], mtime: info.mtimeMs });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(keep)) {
    await rm(path.join(dir, file.name), { force: true });
    delete index.segments?.[file.hash];
  }
}

/**
 * Stills of each scene from a video at the middle of the scene's own segment
 * (after its incoming transition, before its outgoing one).
 * → [{scene, frame, file}]
 */
export async function sceneStills(story, video, sceneIds, outDir, { suffix, tools } = {}) {
  const ffmpeg = { ...defaultSegmentTools(), ...(tools ?? {}) };
  const plan = planSegments(story);
  const out = [];
  for (const id of sceneIds) {
    const own = plan.segments.filter((segment) => segment.scenes.includes(id));
    const body = own.find((segment) => segment.kind === "scene" && segment.scenes.length === 1) ?? own[0];
    if (!body) continue;
    const frame = Math.floor((body.startFrame + body.endFrame - 1) / 2);
    const file = path.join(outDir, `${id}-${suffix}.png`);
    await ffmpeg.still(video, frame, file);
    out.push({ scene: id, frame, seconds: round3(frame / plan.fps), file });
  }
  return out;
}

function rel(project, file) {
  const relative = path.relative(project, file);
  return relative.startsWith("..") ? file : relative;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}
