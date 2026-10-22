// Mimic a reference: measure one or more reference videos (and/or still
// images) and draft a launchclip.style.v2 pack plus reference-report.md that
// explains every inferred value and its confidence.
//
//   launchclip style create <name> --from-reference a.mp4 [b.mp4 ...] [--from-images x.png ...]
//   launchclip style check <project> --against <name>
//
// Measurements (all local, ffmpeg + plain JS; no models, no uploads):
// - palette: k-means (k = 8, deterministic k-means++ seeding) over pixels of
//   frames sampled across each video, downsampled to 160 px wide; roles by
//   luminance and saturation with contrast enforced (kit/core/style.mjs);
// - pacing: cuts and shot lengths from src/render_motion_analysis.js (ffmpeg
//   scene scores), mapped to a motion grammar and transition preference;
// - energy: frame-difference activity (1 - hold ratio) → ambient level;
// - captions (approximate): text-like edge density per horizontal band →
//   position, text height → size, the most saturated colour in the band →
//   highlight colour;
// - sound: integrated loudness, silence ratio and transient rate
//   (src/render_audio_analysis.js) → SFX density and music presence;
// - fonts: never read or copied; a nearest bundled family is suggested from
//   the measured text weight (or from --font-hint names).
// Reference media is never copied into the pack: only file names, hashes and
// statistics are recorded.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { assignPaletteRoles, colorDistance, contrastRatio, hexToHsl, nearestBundledFont, rgbToHex, STYLE_SCHEMA } from "../kit/core/style.mjs";
import { FONT_REGISTRY } from "../kit/core/fonts.mjs";
import { analyzeRenderMotion } from "./render_motion_analysis.js";
import { analyzeProductionAudio } from "./render_audio_analysis.js";

const execFileAsync = promisify(execFile);
export const REFERENCE_SAMPLE_WIDTH = 160;

// ---------------------------------------------------------------------------
// Palette: k-means in plain JS

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * k-means over RGB pixels ([r, g, b] triples, 0–255). Deterministic
 * (k-means++ seeding from a fixed PRNG). → [{hex, weight, rgb}] sorted by weight.
 */
export function kmeansColors(pixels, { k = 8, iterations = 14, seed = 7 } = {}) {
  const n = pixels.length;
  if (!n) return [];
  const random = mulberry32(seed);
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const centers = [pixels[Math.floor(random() * n)].slice()];
  const nearest = new Float64Array(n).fill(Infinity);
  while (centers.length < Math.min(k, n)) {
    let total = 0;
    const last = centers.at(-1);
    for (let i = 0; i < n; i += 1) { nearest[i] = Math.min(nearest[i], dist2(pixels[i], last)); total += nearest[i]; }
    if (total === 0) break;
    let pick = random() * total;
    let index = 0;
    for (; index < n - 1; index += 1) { pick -= nearest[index]; if (pick <= 0) break; }
    centers.push(pixels[index].slice());
  }
  const assign = new Int32Array(n);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i += 1) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c += 1) { const d = dist2(pixels[i], centers[c]); if (d < bestD) { bestD = d; best = c; } }
      assign[i] = best;
      const s = sums[best]; s[0] += pixels[i][0]; s[1] += pixels[i][1]; s[2] += pixels[i][2]; s[3] += 1;
    }
    let moved = 0;
    sums.forEach((s, c) => {
      if (!s[3]) return;
      const next = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      moved += dist2(next, centers[c]);
      centers[c] = next;
    });
    if (moved < 0.5) break;
  }
  const counts = centers.map(() => 0);
  for (let i = 0; i < n; i += 1) counts[assign[i]] += 1;
  // Merge clusters that landed on visually the same colour.
  const clusters = centers.map((rgb, c) => ({ rgb, count: counts[c] })).filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
  const merged = [];
  for (const entry of clusters) {
    const twin = merged.find((other) => colorDistance(rgbToHex(other.rgb), rgbToHex(entry.rgb)) < 0.045);
    if (twin) {
      const total = twin.count + entry.count;
      twin.rgb = twin.rgb.map((v, i) => (v * twin.count + entry.rgb[i] * entry.count) / total);
      twin.count = total;
    } else merged.push({ ...entry, rgb: entry.rgb.slice() });
  }
  return merged.sort((a, b) => b.count - a.count).map((entry) => ({ hex: rgbToHex(entry.rgb), weight: Math.round((entry.count / n) * 10000) / 10000, rgb: entry.rgb.map(Math.round) }));
}

/**
 * Palette clusters in two passes: the dominant colour first, then k-means over
 * the pixels that are not that colour, so small but deliberate colours (text,
 * accents) are not swallowed by a large background. Weights stay shares of
 * all pixels.
 */
export function paletteClusters(pixels, { k = 8 } = {}) {
  const first = kmeansColors(pixels, { k });
  if (!first.length) return [];
  const dominant = first[0];
  const rest = pixels.filter((rgb) => colorDistance(rgbToHex(rgb), dominant.hex) > 0.08);
  if (rest.length < 16) return first;
  const share = rest.length / pixels.length;
  const second = kmeansColors(rest, { k, seed: 11 }).map((entry) => ({ ...entry, weight: Math.round(entry.weight * share * 10000) / 10000 }));
  // Third pass over saturated pixels only: accent hues that cover a sliver of
  // the frame (a green tick, a red badge) still get a cluster.
  const vividPixels = rest.filter((rgb) => { const { s, l } = hexToHsl(rgbToHex(rgb)); return s > 0.35 && l > 0.2 && l < 0.85; });
  const out = [{ ...dominant, weight: Math.round((1 - share) * 10000) / 10000 }, ...second];
  if (vividPixels.length >= 16) {
    const vividShare = vividPixels.length / pixels.length;
    for (const entry of kmeansColors(vividPixels, { k: 6, seed: 23 })) {
      if (out.some((other) => colorDistance(other.hex, entry.hex) < 0.06)) continue;
      out.push({ ...entry, weight: Math.round(entry.weight * vividShare * 10000) / 10000 });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Pixels from raw rgb24 frames, every `step`-th pixel. */
export function pixelsFromFrames(frames, { step = 2 } = {}) {
  const pixels = [];
  for (const frame of frames) for (let i = 0; i + 2 < frame.data.length; i += 3 * step) pixels.push([frame.data[i], frame.data[i + 1], frame.data[i + 2]]);
  return pixels;
}

// ---------------------------------------------------------------------------
// Frames

async function probe(file, run) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file]);
  const data = JSON.parse(stdout);
  const video = (data.streams ?? []).find((stream) => stream.codec_type === "video");
  const audio = (data.streams ?? []).some((stream) => stream.codec_type === "audio");
  return { duration: Number(data.format?.duration ?? 0), width: Number(video?.width ?? 0), height: Number(video?.height ?? 0), audio };
}

/** Sample up to `count` rgb24 frames spread across a video (or one frame from an image). */
export async function sampleFrames(file, { count = 24, width = REFERENCE_SAMPLE_WIDTH, image = false } = {}, run = runBuffer) {
  const info = await probe(file, run);
  if (!info.width || !info.height) throw new Error(`${file} has no video stream`);
  const height = Math.max(2, Math.round((width * info.height) / info.width / 2) * 2);
  const frames = [];
  const times = image || !(info.duration > 0) ? [null] : Array.from({ length: count }, (_, i) => (info.duration * (i + 0.5)) / count);
  for (const at of times) {
    const args = ["-hide_banner", "-loglevel", "error", ...(at === null ? [] : ["-ss", String(Math.round(at * 1000) / 1000)]), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:${height}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"];
    const { stdout } = await run("ffmpeg", args, { encoding: "buffer" });
    const data = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
    if (data.length >= width * height * 3) frames.push({ at, width, height, data: data.subarray(0, width * height * 3) });
  }
  return { info, frames };
}

// ---------------------------------------------------------------------------
// Captions (approximate)

const BANDS = Object.freeze([
  { position: "top", from: 0.06, to: 0.3 },
  { position: "middle", from: 0.36, to: 0.64 },
  { position: "bottom", from: 0.6, to: 0.8 },
  { position: "bottom", from: 0.78, to: 0.94 }
]);

function lumaAt(frame, x, y) {
  const i = (y * frame.width + x) * 3;
  return 0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2];
}

/**
 * Caption heuristics over sampled frames: text-like rows (dense, strong
 * horizontal luminance edges with bright strokes) per band, how much they
 * change between frames (captions change, layouts hold), their height and
 * the most saturated colour inside them. Best effort; confidence is reported.
 */
export function detectCaptions(frames) {
  if (!frames.length) return { position: null, confidence: 0, notes: ["no frames"] };
  const { width, height } = frames[0];
  const rowEdges = frames.map((frame) => {
    const rows = new Float64Array(height);
    for (let y = 0; y < height; y += 1) {
      let edges = 0;
      for (let x = 1; x < width; x += 1) if (Math.abs(lumaAt(frame, x, y) - lumaAt(frame, x - 1, y)) > 60) edges += 1;
      rows[y] = edges / width;
    }
    return rows;
  });
  const scores = BANDS.map((band) => {
    const y0 = Math.floor(band.from * height), y1 = Math.ceil(band.to * height);
    const perFrame = rowEdges.map((rows) => { let sum = 0; for (let y = y0; y < y1; y += 1) sum += rows[y] > 0.08 ? rows[y] : 0; return sum / (y1 - y0); });
    const mean = perFrame.reduce((a, b) => a + b, 0) / perFrame.length;
    const present = perFrame.filter((value) => value > 0.01).length / perFrame.length;
    // Change between consecutive samples: caption text changes, panels hold.
    let change = 0;
    for (let f = 1; f < frames.length; f += 1) {
      let diff = 0;
      for (let y = y0; y < y1; y += 1) diff += Math.abs(rowEdges[f][y] - rowEdges[f - 1][y]);
      change += diff / (y1 - y0);
    }
    change = frames.length > 1 ? change / (frames.length - 1) : 0;
    return { ...band, y0, y1, mean, present, change, score: mean * (0.4 + present) * (0.5 + Math.min(1, change * 20)) };
  });
  const best = scores.slice().sort((a, b) => b.score - a.score)[0];
  if (!best || best.mean < 0.004) return { position: null, confidence: 0.2, notes: ["no persistent text-like band found; captions may be absent"], bands: scores };
  // Text height: the run of text-like rows in the band, median across frames.
  const heights = rowEdges.map((rows) => { let count = 0; for (let y = best.y0; y < best.y1; y += 1) if (rows[y] > 0.08) count += 1; return count; }).filter((value) => value > 0).sort((a, b) => a - b);
  const textRows = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const textHeightFraction = textRows / height;
  // Highlight: the most saturated colour among bright pixels in the band.
  const vivid = [];
  let bright = 0, total = 0;
  for (const frame of frames) for (let y = best.y0; y < best.y1; y += 1) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 3;
    const rgb = [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
    const hex = rgbToHex(rgb);
    const { s, l } = hexToHsl(hex);
    total += 1;
    if (l > 0.55) bright += 1;
    if (s > 0.55 && l > 0.35 && l < 0.8) vivid.push(rgb);
  }
  const highlight = vivid.length > total * 0.002 ? kmeansColors(vivid, { k: 3 })[0]?.hex ?? null : null;
  const position = best.position;
  const confidence = Math.round(Math.min(0.75, 0.25 + best.score * 8 + (scores.filter((band) => band !== best).every((band) => band.score < best.score * 0.6) ? 0.15 : 0)) * 100) / 100;
  return {
    position,
    text_height_fraction: Math.round(textHeightFraction * 1000) / 1000,
    bright_ratio: total ? Math.round((bright / total) * 1000) / 1000 : 0,
    highlight,
    confidence,
    bands: scores.map(({ position: p, from, to, mean, present, change, score }) => ({ position: p, from, to, edge_density: round(mean, 4), present: round(present, 3), change: round(change, 4), score: round(score, 5) })),
    notes: []
  };
}

// ---------------------------------------------------------------------------
// One reference

/**
 * Measure one reference video: palette clusters, pacing, energy, captions and
 * sound. adapters: {run, motion, audio} to replace ffmpeg-backed steps in tests.
 */
export async function analyzeReference(file, options = {}, adapters = {}) {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) throw new Error(`Reference not found: ${file}`);
  const run = adapters.run ?? runBuffer;
  const image = Boolean(options.image);
  const { info, frames } = await sampleFrames(resolved, { count: options.frames ?? 24, image }, run);
  const palette = paletteClusters(pixelsFromFrames(frames), { k: 8 });
  const captions = image ? null : detectCaptions(frames);
  let pacing = null, energy = null, sound = null;
  if (!image) {
    const motion = await (adapters.motion ?? ((video) => analyzeRenderMotion(video)))(resolved);
    const duration = Number(motion.duration_seconds ?? info.duration);
    // Hard cuts (ffmpeg scene scores) plus structural boundaries (motion
    // graphics change scenes through transitions that scene scores miss).
    const structural = await (adapters.boundaries ?? ((video) => structuralBoundaries(video, {}, run)))(resolved);
    const boundaries = mergeTimes([...(Array.isArray(motion.cuts) ? motion.cuts : []), ...structural], 0.4).filter((time) => time > 0.3 && time < duration - 0.5);
    const shots = shotStats([0, ...boundaries, duration]);
    pacing = {
      duration_seconds: round(duration, 3),
      cuts: boundaries.length,
      hard_cuts: Array.isArray(motion.cuts) ? motion.cuts.length : 0,
      boundaries: boundaries.map((time) => round(time, 2)),
      cut_rate_per_minute: round((boundaries.length / Math.max(1, duration)) * 60, 2),
      shot_seconds: shots
    };
    const hold = Number(motion.motion?.hold_ratio ?? 1);
    energy = {
      activity: round(1 - hold, 4),
      hold_ratio: round(hold, 4),
      bursts_per_minute: round(Number(motion.motion_bursts_per_minute ?? 0), 2),
      velocity_p75: motion.optical_flow?.velocity_pixels_per_second?.p75 ?? null
    };
    if (info.audio) {
      const audio = await (adapters.audio ?? ((video) => analyzeProductionAudio(video, null)))(resolved);
      const peaks = (audio.output?.peaks ?? []).map((entry) => entry.peak_dbfs).filter(Number.isFinite);
      let transients = 0;
      for (let i = 1; i < peaks.length; i += 1) if (peaks[i] - peaks[i - 1] > 9) transients += 1;
      const duration = Number(audio.duration_seconds ?? info.duration) || 1;
      sound = {
        audio: true,
        integrated_lufs: audio.output?.integrated_lufs ?? null,
        true_peak_dbfs: audio.output?.true_peak_dbfs ?? null,
        silence_ratio: audio.output?.silence_ratio ?? null,
        transients_per_minute: round((transients / duration) * 60, 2)
      };
    } else sound = { audio: false };
  }
  return { file: resolved, name: path.basename(resolved), sha256: await sha256(resolved), kind: image ? "image" : "video", width: info.width, height: info.height, duration_seconds: round(info.duration, 3), palette, captions, pacing, energy, sound };
}

// ---------------------------------------------------------------------------
// Shot boundaries

/** Times closer than `gap` seconds merged into their mean-free first entry. */
export function mergeTimes(times, gap = 1) {
  const sorted = times.filter(Number.isFinite).sort((a, b) => a - b);
  const out = [];
  for (const time of sorted) if (!out.length || time - out.at(-1).last > gap) out.push({ first: time, last: time }); else out.at(-1).last = time;
  return out.map((entry) => (entry.first + entry.last) / 2);
}

function shotStats(edges) {
  const lengths = [];
  for (let i = 1; i < edges.length; i += 1) if (edges[i] > edges[i - 1]) lengths.push(edges[i] - edges[i - 1]);
  const sorted = lengths.sort((a, b) => a - b);
  const q = (p) => { if (!sorted.length) return null; const position = (sorted.length - 1) * p; const lo = Math.floor(position), hi = Math.ceil(position); return round(sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo), 3); };
  return { count: sorted.length, p25: q(0.25), median: q(0.5), p75: q(0.75), mean: sorted.length ? round(sorted.reduce((a, b) => a + b, 0) / sorted.length, 3) : null };
}

/**
 * Structural scene boundaries for motion graphics: grey frames at 6 fps,
 * 45 px on the short side; at each time, the share of content pixels (not the
 * background luma) that changed strongly between t - 0.5 s and t + 0.5 s.
 * Peaks above `threshold` (default 0.7) are boundaries, merged within 1 s.
 */
export async function structuralBoundaries(file, { fps = 10, threshold = 0.7 } = {}, run = runBuffer) {
  const info = await probe(file, run);
  const short = 45, long = 80;
  const portrait = info.height >= info.width;
  const w = portrait ? short : long, h = portrait ? long : short;
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
  return boundariesFromGrayFrames(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ""), w, h, fps, { threshold });
}

export function boundariesFromGrayFrames(buffer, width, height, fps, { threshold = 0.7 } = {}) {
  const size = width * height;
  const count = Math.floor(buffer.length / size);
  if (count < 3) return [];
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < count * size; i += 7) histogram[buffer[i]] += 1;
  const bg = histogram.indexOf(Math.max(...histogram));
  const frame = (i) => buffer.subarray(i * size, (i + 1) * size);
  const change = (a, b) => {
    let changed = 0, content = 0;
    for (let k = 0; k < size; k += 1) {
      if (Math.abs(a[k] - bg) > 14 || Math.abs(b[k] - bg) > 14) { content += 1; if (Math.abs(a[k] - b[k]) > 24) changed += 1; }
    }
    return content > size * 0.01 ? changed / content : 0;
  };
  const gap = Math.max(1, Math.round(fps * 0.5));
  const series = Array.from({ length: count }, (_, i) => (i - gap >= 0 && i + gap < count ? change(frame(i - gap), frame(i + gap)) : 0));
  const peaks = [];
  for (let i = 1; i < count - 1; i += 1) if (series[i] >= series[i - 1] && series[i] >= series[i + 1] && series[i] > threshold) peaks.push(i / fps);
  // Hard cuts between neighbouring samples: a large change into a frame that
  // then holds (animation keeps changing; a cut lands and settles).
  const step = Array.from({ length: count }, (_, i) => (i > 0 ? change(frame(i - 1), frame(i)) : 0));
  const cuts = [];
  for (let i = 1; i < count - 1; i += 1) if (step[i] > 0.55 && step[i + 1] < step[i] * 0.4) cuts.push((i - 0.5) / fps);
  const merged = mergeTimes(peaks, 0.6);
  for (const cut of cuts) if (!merged.some((time) => Math.abs(time - cut) < 0.6)) merged.push(cut);
  return merged.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Draft a pack

function mean(values) { const list = values.filter(Number.isFinite); return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null; }

/** Weighted union of palette clusters across references (each reference weighs the same). */
export function combinePalettes(palettes) {
  const all = palettes.flatMap((palette) => palette.map((entry) => ({ ...entry, weight: entry.weight / palettes.length })));
  const merged = [];
  for (const entry of all.sort((a, b) => b.weight - a.weight)) {
    const twin = merged.find((other) => colorDistance(other.hex, entry.hex) < 0.06);
    if (twin) twin.weight += entry.weight;
    else merged.push({ hex: entry.hex, weight: entry.weight });
  }
  return merged.sort((a, b) => b.weight - a.weight).map((entry) => ({ hex: entry.hex, weight: round(entry.weight, 4) }));
}

/** Motion grammar and transition preference from shot length and activity. */
export function grammarFromPacing(pacing, energy) {
  const median = Number(pacing?.median_shot_seconds ?? pacing?.shot_seconds?.median);
  const activity = Number(energy?.activity ?? 0.3);
  if (!Number.isFinite(median)) return { grammar: 'editorial', transitions: ['fade', 'push'], confidence: 0.2, reason: 'no shot lengths measured' };
  if (median < 1.6) return { grammar: 'snappy', transitions: ['cut', 'whip', 'push'], confidence: 0.75, reason: `median shot ${median.toFixed(2)} s (fast cuts)` };
  if (median < 3.2) return activity > 0.45 ? { grammar: 'playful', transitions: ['push', 'zoom', 'whip'], confidence: 0.55, reason: `median shot ${median.toFixed(2)} s with high activity (${activity.toFixed(2)})` } : { grammar: 'editorial', transitions: ['push', 'fade'], confidence: 0.55, reason: `median shot ${median.toFixed(2)} s` };
  if (median < 6.5) return { grammar: activity > 0.5 ? 'playful' : 'editorial', transitions: ['fade', 'push', 'morph'], confidence: 0.6, reason: `median shot ${median.toFixed(2)} s (measured holds)` };
  return activity < 0.25 ? { grammar: 'documentary', transitions: ['fade'], confidence: 0.6, reason: `long shots (median ${median.toFixed(2)} s) and low activity` } : { grammar: 'smooth', transitions: ['fade', 'push'], confidence: 0.5, reason: `long shots (median ${median.toFixed(2)} s) with steady motion` };
}

/** Ambient level from frame-difference activity (share of frames that are not holds). */
export function ambientFromEnergy(energy) {
  const activity = Number(energy?.activity);
  if (!Number.isFinite(activity)) return { level: 'subtle', confidence: 0.2 };
  const level = activity < 0.08 ? 'off' : activity < 0.22 ? 'subtle' : activity < 0.45 ? 'standard' : 'lively';
  return { level, confidence: 0.55 };
}

/** SFX density and music presence from loudness, silence and transients. */
export function soundFromAudio(sounds) {
  const withAudio = sounds.filter((sound) => sound?.audio);
  if (!withAudio.length) return { sfx_density: 'low', music: null, confidence: 0.2, notes: ['references have no audio track; sound settings are defaults'] };
  const transients = mean(withAudio.map((sound) => sound.transients_per_minute));
  const silence = mean(withAudio.map((sound) => sound.silence_ratio));
  const lufs = mean(withAudio.map((sound) => sound.integrated_lufs));
  const sfx = transients > 24 ? 'high' : transients < 8 ? 'low' : 'normal';
  const musicPresent = Number.isFinite(silence) && silence < 0.12 && Number.isFinite(lufs) && lufs > -32;
  return {
    sfx_density: sfx,
    music: musicPresent ? { prompt_hints: [`continuous bed under the voice (reference loudness ${lufs.toFixed(1)} LUFS)`], energy_curve: 'steady' } : null,
    confidence: 0.45,
    notes: [`transients ${transients?.toFixed(1)}/min → ${sfx}`, musicPresent ? `audio is continuous (silence ${(silence * 100).toFixed(1)}%), so a music bed is likely` : `audio has gaps (silence ${((silence ?? 0) * 100).toFixed(1)}%); music presence unclear`],
    stats: { transients_per_minute: round(transients, 2), silence_ratio: round(silence, 4), integrated_lufs: round(lufs, 2) }
  };
}

/** Caption preset and options from the caption heuristics. */
export function captionsFromDetection(detections, palette) {
  const found = detections.filter((entry) => entry?.position);
  if (!found.length) return { captions: { preset: 'minimal-line' }, confidence: 0.2, notes: ['no caption band detected; minimal-line is a quiet default'] };
  const votes = {};
  for (const entry of found) votes[entry.position] = (votes[entry.position] ?? 0) + entry.confidence;
  const position = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
  const heightFraction = mean(found.map((entry) => entry.text_height_fraction));
  const size = heightFraction ? Math.max(0.5, Math.min(2, round((heightFraction * 1920) / 74 / 1.1, 2))) : 1;
  const highlight = found.map((entry) => entry.highlight).find(Boolean) ?? null;
  const preset = highlight ? (size >= 1.15 ? 'outline-heavy' : 'word-highlight') : size < 0.8 ? 'minimal-line' : 'word-highlight';
  const captions = { preset, position: position === 'bottom' ? 'auto' : position, ...(Math.abs(size - 1) > 0.08 ? { size } : {}) };
  const notes = [`text-like band: ${position} (confidence ${mean(found.map((entry) => entry.confidence)).toFixed(2)})`, `text height ≈ ${heightFraction ? (heightFraction * 100).toFixed(1) : '?'}% of the frame → size ×${size}`];
  if (highlight) {
    const nearest = palette.map((entry) => entry.hex).sort((a, b) => colorDistance(a, highlight) - colorDistance(b, highlight))[0];
    notes.push(`highlight colour ≈ ${highlight}${nearest ? ` (nearest palette colour ${nearest})` : ''}`);
  } else notes.push('no saturated highlight colour found in the band');
  return { captions, highlight, confidence: round(Math.min(0.6, mean(found.map((entry) => entry.confidence))), 2), notes };
}

/** Bundled fonts by role from measured text weight, or from user hints. */
export function fontsFromReference(detections, hints = []) {
  if (hints.length) {
    const [display, body] = hints;
    return { fonts: { display: slug(nearestBundledFont(display, 'display')), body: slug(nearestBundledFont(body ?? display, 'body')), meta: 'jetbrains-mono' }, confidence: 0.7, notes: [`from --font-hint ${hints.join(', ')}: nearest bundled families (reference fonts are never downloaded or copied)`] };
  }
  const brightness = mean(detections.map((entry) => entry?.bright_ratio));
  const tall = mean(detections.map((entry) => entry?.text_height_fraction));
  const heavy = Number.isFinite(brightness) && brightness > 0.18;
  const display = heavy && tall > 0.02 ? 'Anton' : tall > 0.02 ? 'Archivo Black' : 'Space Grotesk';
  return { fonts: { display: slug(display), body: 'inter', meta: 'jetbrains-mono' }, confidence: 0.25, notes: [`display ${display}: guessed from caption stroke weight (bright ratio ${brightness?.toFixed(3) ?? '?'}) and height; LaunchClip cannot identify typefaces from pixels. Pass --font-hint "<display>, <body>" to map named fonts to the nearest bundled families.`] };
}

const slug = (family) => FONT_REGISTRY[family]?.slug ?? String(family).toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * Draft a v2 pack from analysed references. → {pack, report (markdown), inferred}
 */
export function draftStyleFromReferences(name, references, { fontHints = [] } = {}) {
  const videos = references.filter((entry) => entry.kind === 'video');
  const palette = combinePalettes(references.map((entry) => entry.palette));
  const roles = assignPaletteRoles(palette);
  const pacingStats = videos.length ? {
    cut_rate_per_minute: round(mean(videos.map((entry) => entry.pacing?.cut_rate_per_minute)), 2),
    median_shot_seconds: round(mean(videos.map((entry) => entry.pacing?.shot_seconds?.median)), 3),
    p25_shot_seconds: round(mean(videos.map((entry) => entry.pacing?.shot_seconds?.p25)), 3),
    p75_shot_seconds: round(mean(videos.map((entry) => entry.pacing?.shot_seconds?.p75)), 3)
  } : null;
  const energyStats = videos.length ? { activity: round(mean(videos.map((entry) => entry.energy?.activity)), 4), bursts_per_minute: round(mean(videos.map((entry) => entry.energy?.bursts_per_minute)), 2) } : null;
  const grammar = grammarFromPacing(pacingStats, energyStats);
  const ambient = ambientFromEnergy(energyStats);
  const sound = soundFromAudio(videos.map((entry) => entry.sound));
  const captions = captionsFromDetection(videos.map((entry) => entry.captions), palette);
  const fonts = fontsFromReference(videos.map((entry) => entry.captions), fontHints);
  const colors = { ...roles.colors };
  if (captions.highlight && contrastRatio(captions.highlight, colors.bg) >= 3 && colorDistance(captions.highlight, colors.primary) > 0.12) captions.notes.push(`caption highlight ${captions.highlight} differs from primary ${colors.primary}; set captions.colors.active to use it`);
  const pack = {
    schema: STYLE_SCHEMA,
    name,
    description: `Drafted from ${references.length} reference${references.length === 1 ? '' : 's'} (${references.map((entry) => entry.name).join(', ')}). Review reference-report.md.`,
    brand: { colors, fonts: fonts.fonts },
    motion: { grammar: grammar.grammar, transition_preference: grammar.transitions },
    ambient: { level: ambient.level },
    captions: captions.captions,
    sound: { sfx_density: sound.sfx_density, ...(sound.music ? { music: sound.music } : {}) },
    modules: { prefer: [], avoid: [], params: {} },
    references: references.map((entry) => ({ name: entry.name, sha256: entry.sha256, kind: entry.kind, width: entry.width, height: entry.height, duration_seconds: entry.duration_seconds })),
    reference_stats: {
      palette: palette.slice(0, 8),
      ...(pacingStats ? { pacing: pacingStats } : {}),
      ...(energyStats ? { energy: energyStats } : {}),
      ...(sound.stats ? { sound: sound.stats } : {})
    },
    created_at: new Date().toISOString()
  };
  const inferred = { palette: roles, grammar, ambient, sound, captions, fonts };
  return { pack, inferred, report: referenceReport(pack, references, inferred) };
}

const pct = (value) => `${Math.round(value * 100)}%`;

export function referenceReport(pack, references, inferred) {
  const { palette, grammar, ambient, sound, captions, fonts } = inferred;
  const lines = [
    `# Reference report: ${pack.name}`,
    '',
    `Drafted by \`launchclip style create ${pack.name} --from-reference\` from ${references.length} reference${references.length === 1 ? '' : 's'}. Every value below is measured locally with ffmpeg and plain JavaScript; confidence is 0–1. Reference media was not copied into this pack: only names, SHA-256 hashes and statistics are kept.`,
    '',
    '## References',
    '',
    '| File | Kind | Size | Duration | SHA-256 |',
    '| --- | --- | --- | --- | --- |',
    ...references.map((entry) => `| ${entry.name} | ${entry.kind} | ${entry.width}x${entry.height} | ${entry.duration_seconds ?? '—'} s | \`${entry.sha256.slice(0, 16)}…\` |`),
    '',
    '## Palette',
    '',
    'k-means (k = 8) over pixels of frames sampled evenly across each video, downsampled to 160 px wide; clusters closer than 6% RGB distance are merged. Roles: bg = dominant cluster; paper (text) = most contrast against bg; ink = the darker of the two; primary/accent = the most saturated, distinct hues.',
    '',
    '| Role | Colour | Confidence |',
    '| --- | --- | --- |',
    ...Object.entries(pack.brand.colors).map(([role, hex]) => `| ${role} | \`${hex}\` | ${(palette.confidence[role] ?? 0).toFixed(2)} |`),
    '',
    `Dominant clusters: ${pack.reference_stats.palette.map((entry) => `\`${entry.hex}\` ${pct(entry.weight)}`).join(', ')}.`,
    ...(palette.notes.length ? ['', ...palette.notes.map((note) => `- ${note}`)] : []),
    '',
    '## Pacing → motion grammar',
    ''
  ];
  if (pack.reference_stats.pacing) {
    const p = pack.reference_stats.pacing;
    lines.push(`Cut rate ${p.cut_rate_per_minute}/min; shot length median ${p.median_shot_seconds} s (p25 ${p.p25_shot_seconds} s, p75 ${p.p75_shot_seconds} s), from ffmpeg scene scores (src/render_motion_analysis.js).`, '', `- motion.grammar: **${grammar.grammar}** (confidence ${grammar.confidence.toFixed(2)}): ${grammar.reason}.`, `- transition preference: ${grammar.transitions.join(', ')}.`);
  } else lines.push('No video reference: the grammar is the editorial default (confidence 0.20).');
  lines.push('', '## Energy → ambient', '');
  if (pack.reference_stats.energy) lines.push(`Activity (share of frames that are not holds) ${pack.reference_stats.energy.activity}; ${pack.reference_stats.energy.bursts_per_minute} motion bursts/min.`, '', `- ambient.level: **${ambient.level}** (confidence ${ambient.confidence.toFixed(2)}).`);
  else lines.push('No video reference: subtle (confidence 0.20).');
  lines.push('', '## Captions (approximate)', '', 'Bottom-band text heuristics: text-like rows are runs of dense, strong horizontal luminance edges; a band whose text changes between samples scores as captions. Position, size and highlight colour are estimates; case and font are not detected.', '', `- captions: \`${JSON.stringify(pack.captions)}\` (confidence ${captions.confidence.toFixed(2)}).`, ...captions.notes.map((note) => `- ${note}`));
  lines.push('', '## Sound', '', `- sound.sfx_density: **${pack.sound.sfx_density}** (confidence ${sound.confidence.toFixed(2)}).`, ...sound.notes.map((note) => `- ${note}`), `- music: ${pack.sound.music ? 'a bed is suggested; set provider and prompt hints to taste' : 'not inferred'}. Tempo (bpm) is not measured.`);
  lines.push('', '## Fonts', '', `- brand.fonts: \`${JSON.stringify(pack.brand.fonts)}\` (confidence ${fonts.confidence.toFixed(2)}).`, ...fonts.notes.map((note) => `- ${note}`));
  lines.push('', '## Next steps', '', '- Review the palette roles and fonts above; edit style.json by hand where the confidence is low.', `- Render a storyboard with \`"style": "${pack.name}"\` and run \`launchclip style check <project> --against ${pack.name}\` to measure drift against these reference statistics.`, '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Drift check

/** Weighted mean distance from each cluster of `a` to its nearest cluster in `b` (0–1). */
export function paletteDistance(a, b) {
  if (!a?.length || !b?.length) return null;
  const total = a.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  return round(a.reduce((sum, entry) => sum + entry.weight * Math.min(...b.map((other) => colorDistance(entry.hex, other.hex))), 0) / total, 4);
}

const GRAMMAR_SHOT = Object.freeze({ snappy: [0.6, 1.8], playful: [1.4, 3.5], editorial: [2.5, 6], smooth: [3.5, 8], documentary: [4.5, 12] });

/**
 * Compare a render's measured stats with a pack's reference stats (or, when
 * the pack has none, with its palette and grammar). → {status, metrics: [{metric, expected, measured, drift, ok}]}
 */
export function compareToStyle(measured, pack, thresholds = {}) {
  const T = { palette: 0.12, cutRate: 0.5, shot: 0.5, activity: 0.2, loudness: 3, ...thresholds };
  const stats = pack.reference_stats ?? {};
  const metrics = [];
  const expectedPalette = stats.palette ?? Object.values(pack.brand?.colors ?? {}).map((hex) => ({ hex, weight: 1 }));
  const distance = paletteDistance(measured.palette, expectedPalette);
  if (distance !== null) metrics.push({ metric: 'palette distance', expected: `≤ ${T.palette}`, measured: distance, drift: distance, ok: distance <= T.palette });
  const median = measured.pacing?.shot_seconds?.median;
  if (stats.pacing && Number.isFinite(median)) {
    const ratio = Math.abs(Math.log(median / stats.pacing.median_shot_seconds));
    metrics.push({ metric: 'median shot (s)', expected: stats.pacing.median_shot_seconds, measured: median, drift: round(ratio, 3), ok: ratio <= T.shot });
    const rate = measured.pacing.cut_rate_per_minute;
    const rateDrift = Math.abs(rate - stats.pacing.cut_rate_per_minute) / Math.max(1, stats.pacing.cut_rate_per_minute);
    metrics.push({ metric: 'cut rate (/min)', expected: stats.pacing.cut_rate_per_minute, measured: rate, drift: round(rateDrift, 3), ok: rateDrift <= T.cutRate });
  } else if (Number.isFinite(median)) {
    const grammar = typeof pack.motion?.grammar === 'string' ? pack.motion.grammar : pack.motion?.grammar?.base ?? 'editorial';
    const [lo, hi] = GRAMMAR_SHOT[grammar] ?? GRAMMAR_SHOT.editorial;
    metrics.push({ metric: `median shot vs ${grammar} grammar (s)`, expected: `${lo}–${hi}`, measured: median, drift: median < lo ? round(lo - median, 3) : median > hi ? round(median - hi, 3) : 0, ok: median >= lo * 0.8 && median <= hi * 1.25 });
  }
  if (stats.energy && Number.isFinite(measured.energy?.activity)) {
    const drift = Math.abs(measured.energy.activity - stats.energy.activity);
    metrics.push({ metric: 'activity', expected: stats.energy.activity, measured: measured.energy.activity, drift: round(drift, 4), ok: drift <= T.activity });
  }
  if (stats.sound && Number.isFinite(stats.sound.integrated_lufs) && Number.isFinite(measured.sound?.integrated_lufs)) {
    const drift = Math.abs(measured.sound.integrated_lufs - stats.sound.integrated_lufs);
    metrics.push({ metric: 'loudness (LUFS)', expected: stats.sound.integrated_lufs, measured: measured.sound.integrated_lufs, drift: round(drift, 2), ok: drift <= T.loudness });
  }
  return { status: metrics.every((entry) => entry.ok) ? 'consistent' : 'drift', metrics };
}

// ---------------------------------------------------------------------------

function round(value, places = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function sha256(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject));
  return hash.digest('hex');
}

async function runBuffer(command, args, options = {}) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 256, encoding: options.encoding ?? 'utf8' });
}

