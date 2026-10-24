// The subject stage (docs/SUBJECT_EFFECTS_RFC.md §4): a cheap probe of the
// whole recording before planning, and a full matte for one source range.
//
// Cache layout, keyed by the source's sha256 and the model:
//   <cache>/<sha256-12>-<model>/probe.json
//   <cache>/<sha256-12>-<model>/ranges/<in>-<out>/{matte.webm, subject.json}
// <cache> defaults to .launchclip/subject in the working directory.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SUBJECT_PROBE_SCHEMA, SUBJECT_SCHEMA, maskStats, summarizeSamples, validateSubjectInfo, validateSubjectProbe } from "../../kit/core/subject.mjs";
import { probeMedia } from "../media_trim.js";
import { openMatteWriter, readFrames, withAlpha, writeImage } from "./frames.js";
import { createPlateAccumulator } from "./plate.js";
import { DEFAULT_PROBE_MODEL, DEFAULT_SUBJECT_MODEL, sha256File, subjectPipeline } from "./models.js";
import { createSubjectSegmenter } from "./segment.js";

// Probe: about one frame a second, at most this many, decoded this wide.
const PROBE_MAX_SAMPLES = 60;
const PROBE_WIDTH = 360;
// Mask statistics for matte frames are measured on a mask this wide.
const STATS_WIDTH = 270;
// Mattes are written with at most this short edge: the largest canvas is
// 1080×1920, and a 9:16 crop of a landscape source needs its full height.
const MATTE_MAX_SHORT_EDGE = 1920;

export function defaultCacheDir(cwd = process.cwd()) {
  return path.join(cwd, ".launchclip", "subject");
}

/** Source facts the stage needs: {sha256, width, height, fps, duration} (display orientation). */
export async function describeSource(src) {
  const probe = await probeMedia(src);
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error(`No video stream found in ${src}`);
  const rotation = Math.abs(Number(video.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0)) % 180;
  const [width, height] = rotation === 90 ? [video.height, video.width] : [video.width, video.height];
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;
  const duration = Number(probe.format?.duration ?? video.duration);
  if (!(duration > 0)) throw new Error(`Could not read the duration of ${src}`);
  return { sha256: await sha256File(src), width, height, fps: round(fps, 3), duration: round(duration, 3) };
}

export function subjectCacheEntry(source, model, cacheDir) {
  return path.join(cacheDir, `${source.sha256.slice(0, 12)}-${model}`);
}

export function rangeDirName(range) {
  return `${range.in.toFixed(3)}-${range.out.toFixed(3)}`;
}

/**
 * Probe a recording. → {probe, path, cached}
 * options: {model, cacheDir, force, download, smooth, log, segmenter (tests)}
 */
export async function runSubjectProbe(src, options = {}) {
  const modelId = options.model ?? DEFAULT_PROBE_MODEL;
  subjectPipeline(modelId);
  const source = options.source ?? await describeSource(src);
  const entry = subjectCacheEntry(source, modelId, options.cacheDir ?? defaultCacheDir());
  const file = path.join(entry, "probe.json");
  if (!options.force) {
    const cached = await readValid(file, validateSubjectProbe);
    if (cached) return { probe: cached, path: file, cached: true };
  }
  const rate = Math.min(1, PROBE_MAX_SAMPLES / source.duration);
  const size = evenSize(PROBE_WIDTH, source);
  const segmenter = options.segmenter ?? await createSubjectSegmenter(modelId, options);
  const samples = [];
  try {
    let index = 0;
    for await (const frame of readFrames(src, { start: 0, duration: source.duration, fps: rate, ...size, ffmpeg: options.ffmpeg })) {
      const alpha = await segmenter.segment(frame, size.width, size.height);
      samples.push({ t: round(index / rate, 3), ...maskStats(alpha, size.width, size.height) });
      index += 1;
    }
  } finally {
    if (!options.segmenter) await segmenter.release();
  }
  const probe = { schema: SUBJECT_PROBE_SCHEMA, source, model: modelId, ...summarizeSamples(samples), samples };
  await writeChecked(file, probe, validateSubjectProbe);
  return { probe, path: file, cached: false };
}

/**
 * Matte one source range. range: {in, out} source seconds.
 * → {info, dir, matte, plate, subject, cached, seconds}
 * plate.jpg is the room without the presenter (src/subject/plate.js).
 */
export async function runSubjectMatte(src, range, options = {}) {
  const modelId = options.model ?? DEFAULT_SUBJECT_MODEL;
  subjectPipeline(modelId);
  const source = options.source ?? await describeSource(src);
  const checked = checkRange(range, source);
  const dir = path.join(subjectCacheEntry(source, modelId, options.cacheDir ?? defaultCacheDir()), "ranges", rangeDirName(checked));
  const matte = path.join(dir, "matte.webm");
  const subject = path.join(dir, "subject.json");
  const plate = path.join(dir, "plate.jpg");
  if (!options.force) {
    const cached = await readValid(subject, validateSubjectInfo);
    // Ranges matted before plates existed are redone once.
    if (cached?.plate) return { info: cached, dir, matte, plate, subject, cached: true, seconds: 0 };
  }
  await mkdir(dir, { recursive: true });
  const began = Date.now();
  const { fps } = source;
  const { width, height } = matteSize(source);
  const stats = evenSize(Math.min(STATS_WIDTH, width), source);
  const segmenter = options.segmenter ?? await createSubjectSegmenter(modelId, options);
  const partial = path.join(dir, "matte.partial.webm");
  const writer = openMatteWriter(partial, { width, height, fps, ffmpeg: options.ffmpeg });
  const frames = [];
  const room = createPlateAccumulator(width, height);
  try {
    let index = 0;
    for await (const frame of readFrames(src, { start: checked.in, duration: checked.out - checked.in, width, height, ffmpeg: options.ffmpeg })) {
      const alpha = await segmenter.segment(frame, width, height);
      await writer.write(withAlpha(frame, alpha));
      room.add(frame, alpha);
      frames.push({ t: round(checked.in + index / fps, 4), ...maskStats(downscale(alpha, width, height, stats), stats.width, stats.height) });
      index += 1;
      options.onFrame?.(index);
    }
    await writer.close();
  } catch (error) {
    await writer.close().catch(() => {});
    await rm(partial, { force: true });
    throw error;
  } finally {
    if (!options.segmenter) await segmenter.release();
  }
  if (!frames.length) throw new Error(`No frames decoded from ${src} between ${checked.in} and ${checked.out} s`);
  await rename(partial, matte);
  const still = room.finish();
  await writeImage(plate, still.rgb, { width: still.width, height: still.height, ffmpeg: options.ffmpeg });
  const info = { schema: SUBJECT_SCHEMA, source, model: modelId, range: checked, matte: "matte.webm", matte_size: { width, height },
    plate: "plate.jpg", plate_size: { width: still.width, height: still.height }, plate_seen: still.seen, ...summarizeSamples(frames), frames };
  await writeChecked(subject, info, validateSubjectInfo);
  return { info, dir, matte, plate, subject, cached: false, seconds: round((Date.now() - began) / 1000, 2) };
}

/** Parse "4-10.5" or "4:10.5" into {in, out}. */
export function parseRange(value) {
  const match = String(value ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*[-:]\s*(\d+(?:\.\d+)?)$/);
  if (!match) throw new Error(`--range must be <in>-<out> in source seconds, e.g. --range 4-10.5 (got "${value}")`);
  return { in: Number(match[1]), out: Number(match[2]) };
}

function checkRange(range, source) {
  const start = Number(range?.in);
  const end = Math.min(Number(range?.out), source.duration);
  if (!(start >= 0) || !(end > start)) throw new Error(`range must be {in, out} with 0 ≤ in < out ≤ ${source.duration} s (got ${JSON.stringify(range)})`);
  return { in: round(start, 3), out: round(end, 3) };
}

export function matteSize(source) {
  const scale = Math.min(1, MATTE_MAX_SHORT_EDGE / Math.min(source.width, source.height));
  return evenSize(source.width * scale, source);
}

function evenSize(targetWidth, source) {
  const width = Math.max(2, Math.round(targetWidth / 2) * 2);
  const height = Math.max(2, Math.round((width * source.height) / source.width / 2) * 2);
  return { width, height };
}

// Nearest-neighbour downscale of a 0–255 mask; enough for box statistics.
function downscale(alpha, width, height, size) {
  const out = new Uint8Array(size.width * size.height);
  for (let y = 0; y < size.height; y += 1) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / size.height));
    for (let x = 0; x < size.width; x += 1) out[y * size.width + x] = alpha[sy * width + Math.min(width - 1, Math.floor(((x + 0.5) * width) / size.width))];
  }
  return out;
}

async function readValid(file, validate) {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return validate(value).ok ? value : null;
  } catch {
    return null;
  }
}

async function writeChecked(file, value, validate) {
  const { ok, errors } = validate(value);
  if (!ok) throw new Error(`internal: ${path.basename(file)} failed its schema: ${errors.join("; ")}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseRate(value) {
  const [num, den] = String(value ?? "").split("/").map(Number);
  const rate = den ? num / den : num;
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
}

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
