// Full-frame media presence: whether a full-bleed photo or video scene
// (photo-scene) shows something, measured from its asset's pixels.
//
//   probeFullFrameMedia(project, resolved, adapters) → {[sceneId]: facts}
//   mediaPresenceFacts(frames, {width, height, fps}) → facts of decoded frames
//
// facts: {src, kind, detail, detailed, moving_spans: [[from, to]] (story
// seconds), meaningful}. A photo-scene declares its rect as "decor" (it is
// the backdrop the module's text sits on), so the layout, density and hold
// gates used to read every one as an empty plate, whatever it showed, and
// pushed authors to cover a story object (a fridge with a tally drawn on it)
// with cards. With facts, a detailed or moving full-frame asset counts as
// content (src/layout_check.js adds it as a full-frame media element) and its
// moving spans count as live motion (holdGate). A flat or blank asset is
// still the empty plate it looks like, and an asset that cannot be read
// keeps the old reading.

import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Sampling and thresholds. Frames are read in grey at a short side of
// MEDIA_PRESENCE.shortSide px, MEDIA_PRESENCE.fps a second.
// - detail: the share of pixels on an edge (a step of at least edgeLevel to
//   the right or below neighbour); a drawing or photo is well above
//   minimumEdgeShare, a flat colour, a gradient or faint grain is not.
// - motion: a pair of samples moves when at least movingPixels pixels (and
//   movingShare of the frame) change by changeLevel or more; runs of moving
//   pairs closer than mergeGap seconds join.
export const MEDIA_PRESENCE = Object.freeze({
  modules: Object.freeze(["photo-scene"]),
  shortSide: 144,
  fps: 4,
  maxSeconds: 120,
  edgeLevel: 24,
  minimumEdgeShare: 0.01,
  changeLevel: 24,
  movingPixels: 12,
  movingShare: 0.0003,
  mergeGap: 0.6
});

const IMAGE = /\.(png|jpe?g|webp|svg)$/i;
const cache = new Map();

/** Facts from decoded grey frames (a Buffer of frames × width × height bytes). */
export function mediaPresenceFacts(frames, { width, height, fps = MEDIA_PRESENCE.fps } = {}) {
  const size = width * height;
  const count = size > 0 ? Math.floor(frames.length / size) : 0;
  if (!count) return null;
  const P = MEDIA_PRESENCE;
  const edgeShares = [];
  for (let f = 0; f < count; f += 1) {
    const o = f * size;
    let edges = 0;
    for (let y = 0; y < height - 1; y += 1) for (let x = 0; x < width - 1; x += 1) {
      const v = frames[o + y * width + x];
      if (Math.abs(v - frames[o + y * width + x + 1]) >= P.edgeLevel || Math.abs(v - frames[o + (y + 1) * width + x]) >= P.edgeLevel) edges += 1;
    }
    edgeShares.push(edges / ((width - 1) * (height - 1)));
  }
  const moving = [];
  const need = Math.max(P.movingPixels, Math.ceil(size * P.movingShare));
  for (let f = 1; f < count; f += 1) {
    const a = (f - 1) * size, b = f * size;
    let changed = 0;
    for (let i = 0; i < size; i += 1) if (Math.abs(frames[a + i] - frames[b + i]) >= P.changeLevel) changed += 1;
    if (changed >= need) moving.push([(f - 1) / fps, f / fps]);
  }
  const spans = [];
  for (const [from, to] of moving) {
    const last = spans.at(-1);
    if (last && from - last[1] <= P.mergeGap + 1e-9) last[1] = to;
    else spans.push([from, to]);
  }
  const sorted = [...edgeShares].sort((x, y) => x - y);
  const detail = sorted[Math.floor((sorted.length - 1) / 2)];
  const detailed = detail >= P.minimumEdgeShare;
  return { frames: count, detail: round(detail, 4), detailed, moving_spans: spans.map(([from, to]) => [round(from, 3), round(to, 3)]), meaningful: detailed || spans.length > 0 };
}

/** The grid a width × height asset is read at (its aspect, short side MEDIA_PRESENCE.shortSide). */
export function presenceGrid(width, height) {
  const s = MEDIA_PRESENCE.shortSide;
  const even = (value) => Math.max(2, 2 * Math.round(value / 2));
  const w = Number(width) > 0 ? Number(width) : 9, h = Number(height) > 0 ? Number(height) : 16;
  return w >= h ? { width: even((s * w) / h), height: s } : { width: s, height: even((s * h) / w) };
}

function sceneMedia(scene) {
  const media = scene?.params?.media;
  const src = typeof media === "string" ? media : media?.src;
  if (typeof src !== "string" || !src) return null;
  const kind = media?.kind ?? (IMAGE.test(src) ? "image" : "video");
  return { src, kind, sourceStart: kind === "video" ? Number(media?.sourceStart ?? 0) || 0 : 0 };
}

/**
 * Facts for every full-frame media scene (MEDIA_PRESENCE.modules) of a
 * resolved story, keyed by scene id; a scene whose asset is missing or
 * unreadable is left out. adapters.frames(file, {kind, start, duration, fps})
 * → {frames: Buffer, width, height} replaces the ffmpeg decode.
 */
export async function probeFullFrameMedia(project, resolved, adapters = {}) {
  const out = {};
  for (const scene of resolved?.scenes ?? []) {
    if (!MEDIA_PRESENCE.modules.includes(scene?.module)) continue;
    const media = sceneMedia(scene);
    if (!media || path.isAbsolute(media.src) || media.src.split(/[\\/]/).includes("..")) continue;
    const file = path.join(project, media.src);
    const start = Number(scene.start), end = Number(scene.end);
    const duration = Math.min(MEDIA_PRESENCE.maxSeconds, Math.max(0, end - start));
    let info;
    try { info = await stat(file); } catch { continue; }
    const key = JSON.stringify([file, info.size, info.mtimeMs, media.kind, media.sourceStart, round(duration, 3)]);
    let facts = cache.get(key);
    if (facts === undefined) {
      try {
        const decoded = await (adapters.frames ?? decodeFrames)(file, { kind: media.kind, start: media.sourceStart, duration, fps: MEDIA_PRESENCE.fps });
        facts = decoded ? mediaPresenceFacts(decoded.frames, { width: decoded.width, height: decoded.height, fps: MEDIA_PRESENCE.fps }) : null;
      } catch {
        facts = null;
      }
      if (!adapters.frames) cache.set(key, facts);
    }
    if (!facts) continue;
    // Source seconds → story seconds, clipped to the scene.
    const spans = facts.moving_spans
      .map(([from, to]) => [round(start + from, 3), round(Math.min(end, start + to), 3)])
      .filter(([from, to]) => to > from);
    out[scene.id] = { src: media.src, kind: media.kind, detail: facts.detail, detailed: facts.detailed, moving_spans: spans, meaningful: facts.detailed || spans.length > 0 };
  }
  return out;
}

/** Grey frames of an asset at presenceGrid(), fps a second. → {frames: Buffer, width, height} | null */
export async function decodeFrames(file, { kind, start, duration, fps }) {
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file]);
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream) return null;
  const grid = presenceGrid(stream.width, stream.height);
  const filter = `scale=${grid.width}:${grid.height}:flags=area,format=gray`;
  const args = kind === "image"
    ? ["-v", "error", "-i", file, "-frames:v", "1", "-vf", filter, "-f", "rawvideo", "pipe:1"]
    : ["-v", "error", "-ss", String(Math.max(0, start)), "-t", String(Math.max(0.25, duration)), "-i", file, "-vf", `fps=${fps},${filter}`, "-an", "-f", "rawvideo", "pipe:1"];
  const decoded = await execFileAsync("ffmpeg", args, { encoding: "buffer", maxBuffer: 1 << 28 });
  return { frames: decoded.stdout, width: grid.width, height: grid.height };
}

function round(value, places = 4) {
  const factor = 10 ** places;
  return Math.round(Number(value) * factor) / factor;
}
