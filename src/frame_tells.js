// The frame tells (docs/VIDEO_TELLS_RFC.md §1, applies "frame"): the pixels
// kit/core/tells.mjs frameTells judges, sampled here.
//
//   measureFrameTells(project, video, story, {rects}) → findings
//
// - frames: one frame per main-track scene at the middle of its hold, at a
//   quarter of the canvas (accent-everywhere).
// - media: each media window the layout check placed (role "media", not
//   full frame, not the footage base), at the middle of its time, at full
//   size so its edge strips are sharp (unblended-media).
// - plates: each image or video plate dimmed over TELLS.rasterDim, read from
//   its asset (media_presence's grey frames): the edge share as it is, and
//   with the edge step scaled up by 1 / (1 - dim), which is what the dim
//   (bg laid over it at that opacity) leaves of every step (buried-raster).
//   shortcut: the plate's blur is not modelled, so a blurred, dimmed photo
//   reads as more detailed than it shows; model it if a buried plate slips by.
//
// Both renderers draw the same frame, so one measure covers both.

import path from "node:path";
import { TELLS, frameTells } from "@launchclip/core/tells.mjs";
import { videoFrame } from "./caption_legibility.js";
import { MEDIA_PRESENCE, decodeFrames, mediaPresenceFacts } from "./media_presence.js";

/** Image and video plates over TELLS.rasterDim: [{id, at, path, kind, src, dim}]. */
export function dimmedPlates(story) {
  const out = [];
  const add = (plate, at, where, id) => {
    const list = plate && typeof plate === "object" ? [plate, ...(Array.isArray(plate.cycle?.plates) ? plate.cycle.plates : [])] : [];
    for (const p of list) {
      const dim = Number(p?.params?.dim);
      if ((p?.kind === "image" || p?.kind === "video") && typeof p.params?.src === "string" && dim > TELLS.rasterDim) out.push({ id, at, path: where, kind: p.kind, src: p.params.src, dim });
    }
  };
  add(story?.plate, 0, "plate", "plate");
  (story?.chapters ?? []).forEach((chapter, i) => add(chapter?.plate, Number(chapter?.start ?? 0) || 0, `chapters[${i}].plate`, `chapter-${i}`));
  (story?.scenes ?? []).forEach((scene, i) => {
    for (const key of ["plate", "backdrop"]) add(scene?.[key], Number(scene?.start) || 0, `scenes[${i}].${key}`, scene?.id ?? `scene-${i}`);
  });
  return out;
}

export async function measureFrameTells(project, video, story, { rects = [], frame = videoFrame, decode = decodeFrames } = {}) {
  const width = Number(story.format.width), height = Number(story.format.height);
  const quarter = { width: 2 * Math.round(width / 8), height: 2 * Math.round(height / 8) };
  const frames = [];
  for (const scene of story.scenes ?? []) {
    if (scene.track) continue;
    const at = (Number(scene.start) + Number(scene.end)) / 2;
    if (Number.isFinite(at)) frames.push({ id: scene.id, at, image: await frame(video, at, quarter) });
  }
  const media = [];
  for (const element of rects) {
    if (element.role !== "media" || element.fullFrame || element.id === "base" || !element.rect) continue;
    if (element.rect.width * element.rect.height > 0.9 * width * height) continue;
    const at = (Number(element.start) + Number(element.end)) / 2;
    if (Number.isFinite(at)) media.push({ id: element.id, at, rect: element.rect, image: await frame(video, at, { width, height }) });
  }
  const plates = [];
  for (const plate of dimmedPlates(story)) {
    if (path.isAbsolute(plate.src) || plate.src.split(/[\\/]/).includes("..")) continue;
    let decoded = null;
    try { decoded = await decode(path.join(project, plate.src), { kind: plate.kind, start: 0, duration: 4, fps: 1 }); } catch { decoded = null; }
    if (!decoded) continue;
    const grid = { width: decoded.width, height: decoded.height, fps: 1 };
    const raw = mediaPresenceFacts(decoded.frames, grid)?.detail ?? 0;
    const dimmed = mediaPresenceFacts(decoded.frames, { ...grid, edgeLevel: MEDIA_PRESENCE.edgeLevel / (1 - plate.dim) })?.detail ?? 0;
    plates.push({ ...plate, raw, dimmed, minimum: MEDIA_PRESENCE.minimumEdgeShare });
  }
  return frameTells({ story, frames, media, plates });
}
