// Mimic a reference: measure one or more reference videos (and/or still
// images) and draft a launchclip.style.v3 pack plus reference-report.md that
// explains every inferred value and its confidence.
//
//   launchclip style create <name> --from-reference a.mp4 [b.mp4 ...] [--from-images x.png ...]
//   launchclip style check <project> --against <name>
//
// Measurements (all local, ffmpeg + plain JS; no models, no uploads):
// - palette: k-means (k = 8, deterministic k-means++ seeding) over pixels of
//   frames sampled across each video, downsampled to 160 px wide; roles by
//   luminance and saturation with contrast enforced (kit/core/style.mjs);
//   plus a vivid-hue histogram, so small accents are seen (style check);
// - pacing: cuts and shot lengths from src/render_motion_analysis.js (ffmpeg
//   scene scores), mapped to a motion grammar and transition preference;
// - energy: frame-difference activity (1 - hold ratio) → ambient level;
// - captions (approximate): text-like edge density per horizontal band →
//   position, text height → size, the most saturated colour in the band →
//   highlight colour, the shape of the text rows → case (upper or sentence);
// - layouts (approximate): persistent flat panel regions beside textured
//   footage → full / split-left / split-right / framed per sampled frame, the
//   layout mix and layout changes;
// - cadence profile: shot lengths, visual changes and layout changes per
//   minute as p10/p50/p90 over the references (launchclip.cadence-profile.v1);
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
import { assignPaletteRoles, CADENCE_PROFILE_SCHEMA, colorDistance, contrastRatio, hexToHsl, nearestBundledFont, rgbToHex, STYLE_SCHEMA, STYLE_V3_DEFAULTS } from "../kit/core/style.mjs";
import { FONT_REGISTRY } from "../kit/core/fonts.mjs";
import { analyzeRenderMotion } from "./render_motion_analysis.js";
import { analyzeProductionAudio } from "./render_audio_analysis.js";

const execFileAsync = promisify(execFile);
export const REFERENCE_SAMPLE_WIDTH = 160;
export const REFERENCE_DETAIL_WIDTH = 480;

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

/**
 * Saturated pixels by hue: the share of all sampled pixels (every `step`-th)
 * that are vivid (HSL saturation > 0.4, lightness 0.2–0.85) in each of `bins`
 * hue bins (bin 0 starts at red). A small accent (an orange kicker, icons, one
 * caption word) shows here even when k-means folds it into a bigger cluster.
 * → {share, hues: [share per bin]}
 */
export function vividHues(frames, { bins = 24, step = 2 } = {}) {
  const hues = new Array(bins).fill(0);
  let total = 0, vivid = 0;
  for (const frame of frames) for (let i = 0; i + 2 < frame.data.length; i += 3 * step) {
    total += 1;
    const r = frame.data[i] / 255, g = frame.data[i + 1] / 255, b = frame.data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2, d = max - min;
    if (!d || l < 0.2 || l > 0.85) continue;
    if ((l > 0.5 ? d / (2 - max - min) : d / (max + min)) <= 0.4) continue;
    const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
    hues[Math.min(bins - 1, Math.floor(h / (360 / bins)))] += 1;
    vivid += 1;
  }
  return { share: total ? round(vivid / total, 5) : 0, hues: hues.map((count) => (total ? round(count / total, 5) : 0)) };
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

/**
 * A frame averaged down to `width` px (box filter; heights keep the aspect,
 * even). Frames already that narrow are returned as they are.
 */
export function downsampleFrame(frame, width) {
  if (frame.width <= width) return frame;
  const height = Math.max(2, Math.round((width * frame.height) / frame.width / 2) * 2);
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const sy0 = Math.floor((y * frame.height) / height), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * frame.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx0 = Math.floor((x * frame.width) / width), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * frame.width) / width));
      const sum = [0, 0, 0];
      for (let sy = sy0; sy < sy1; sy += 1) for (let sx = sx0; sx < sx1; sx += 1) { const i = (sy * frame.width + sx) * 3; sum[0] += frame.data[i]; sum[1] += frame.data[i + 1]; sum[2] += frame.data[i + 2]; }
      const n = (sy1 - sy0) * (sx1 - sx0), o = (y * width + x) * 3;
      data[o] = Math.round(sum[0] / n); data[o + 1] = Math.round(sum[1] / n); data[o + 2] = Math.round(sum[2] / n);
    }
  }
  return { at: frame.at, width, height, data };
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

function lumaAt(frame, x, y) {
  const i = (y * frame.width + x) * 3;
  return 0.2126 * frame.data[i] + 0.7152 * frame.data[i + 1] + 0.0722 * frame.data[i + 2];
}

const positionOf = (y) => (y >= 0.6 ? 'bottom' : y >= 0.36 ? 'middle' : 'top');

/**
 * Text lines in one frame: runs of rows where some window a tenth of the
 * frame wide is dense with strong edges into bright strokes (text is bright
 * strokes on a darker ground), at most `maxHeight` of the frame tall. Each line: {y0, y1, x0, x1, rows (edge
 * density per row inside the line)}. Works on
 * left-aligned or short captions, which a full-width row density misses.
 */
export function textLines(frame, { maxHeight: tallest = 0.08 } = {}) {
  const { width, height } = frame;
  const window = Math.max(4, Math.round(width / 10));
  // Edges are measured across `gap` pixels, so anti-aliased strokes at high resolution still count.
  const gap = Math.max(1, Math.round(width / 480));
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const edges = new Uint8Array(width);
    for (let x = gap; x < width; x += 1) {
      const a = lumaAt(frame, x, y), b = lumaAt(frame, x - gap, y);
      if (Math.abs(a - b) > 45 && Math.max(a, b) > 165) edges[x] = 1;
    }
    let count = 0, best = 0, at = 0;
    for (let x = 0; x < width; x += 1) { count += edges[x]; if (x >= window) count -= edges[x - window]; if (count > best) { best = count; at = Math.max(0, x - window + 1); } }
    rows.push({ density: best / window, at, edges });
  }
  const lines = [];
  const minHeight = Math.max(2, Math.round(height * 0.008)), maxHeight = Math.max(minHeight + 1, Math.round(height * tallest));
  let run = null;
  const close = () => {
    if (!run) return;
    const tall = run.y1 - run.y0 + 1;
    if (tall >= minHeight && tall <= maxHeight) {
      const x0 = Math.min(...run.at), x1 = Math.min(width, Math.max(...run.at) + window);
      const density = [];
      for (let y = run.y0; y <= run.y1; y += 1) {
        let n = 0;
        for (let x = x0; x < x1; x += 1) n += rows[y].edges[x];
        density.push(n / Math.max(1, x1 - x0));
      }
      // Rows just outside the dense core: ascenders and descenders of lowercase text, nothing for capitals.
      const reach = Math.max(1, Math.round(tall * 0.5));
      const outside = [];
      for (const y of [...Array.from({ length: reach }, (_, k) => run.y0 - 1 - k), ...Array.from({ length: reach }, (_, k) => run.y1 + 1 + k)]) {
        if (y < 0 || y >= height) continue;
        let n = 0;
        for (let x = x0; x < x1; x += 1) n += rows[y].edges[x];
        outside.push(n / Math.max(1, x1 - x0));
      }
      lines.push({ y0: run.y0, y1: run.y1, x0, x1, rows: density, outside: outside.length ? outside.reduce((a, b) => a + b, 0) / outside.length : 0 });
    }
    run = null;
  };
  rows.forEach((row, y) => {
    if (row.density >= 0.12) { if (run) { run.y1 = y; run.at.push(row.at); } else run = { y0: y, y1: y, at: [row.at] }; }
    else close();
  });
  close();
  return lines;
}

/**
 * How much the text in two lines' boxes differs between two frames: the
 * share of strong edge pixels (textLines' edges) in the union of the boxes
 * that are not edges in the other frame. Held text (a sign, a logo) scores
 * near 0; new words score high.
 */
function boxChange(a, b, lineA, lineB) {
  const y0 = Math.min(lineA.y0, lineB.y0), y1 = Math.max(lineA.y1, lineB.y1);
  const x0 = Math.max(1, Math.min(lineA.x0, lineB.x0)), x1 = Math.max(lineA.x1, lineB.x1);
  const edge = (frame, x, y) => { const p = lumaAt(frame, x, y), q = lumaAt(frame, x - 1, y); return Math.abs(p - q) > 45 && Math.max(p, q) > 165; };
  let edges = 0, differ = 0;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x < x1; x += 1) {
    const ea = edge(a, x, y), eb = edge(b, x, y);
    if (ea || eb) { edges += 1; if (ea !== eb) differ += 1; }
  }
  return edges ? differ / edges : 0;
}

/**
 * Caption heuristics over sampled frames: text lines (textLines) grouped by
 * height on the frame; captions are the group that is there in most samples
 * and whose words change between samples (a logo, a sign or a kicker holds
 * still; cards come and go at different heights), preferring the lower part
 * of the frame. With `layouts` (detectLayouts frames), changes count only
 * between samples in the same layout: a split moves the footage, and text
 * in the room moves with it. Then its position, text height, highlight colour (the most
 * saturated colour inside the caption lines) and case. Best effort;
 * confidence is reported.
 */
export function detectCaptions(frames, { layouts = null } = {}) {
  if (!frames.length) return { position: null, confidence: 0, notes: ["no frames"] };
  const { width, height } = frames[0];
  const perFrame = frames.map((frame) => textLines(frame).map((line) => ({ ...line, y: (line.y0 + line.y1 + 1) / 2 / height })));
  const step = 0.03;
  const groups = [];
  for (let bin = 0; bin < 1 / step; bin += 1) {
    const centre = (bin + 0.5) * step;
    const hits = perFrame.map((lines) => lines.filter((line) => Math.abs(line.y - centre) <= step).sort((a, b) => Math.abs(a.y - centre) - Math.abs(b.y - centre))[0] ?? null);
    const present = hits.filter(Boolean).length / frames.length;
    let pairs = 0, changed = 0;
    for (let f = 1; f < hits.length; f += 1) {
      if (!hits[f] || !hits[f - 1]) continue;
      // Footage moves when the layout changes (a sign in the room shifts); words change within a layout too.
      if (layouts && layouts[f] !== layouts[f - 1]) continue;
      pairs += 1;
      if (boxChange(frames[f - 1], frames[f], hits[f - 1], hits[f]) > 0.25) changed += 1;
    }
    const change = pairs >= 2 ? changed / pairs : 0;
    groups.push({ centre, hits, present, change, score: present * change * (centre >= 0.55 ? 1.25 : 1) });
  }
  const ranked = groups.filter((group) => group.present >= 0.25 && group.change >= 0.4).sort((a, b) => b.score - a.score);
  const bands = groups.filter((group) => group.present >= 0.15).sort((a, b) => b.score - a.score).slice(0, 4).map((group) => ({ position: positionOf(group.centre), y: round(group.centre, 3), present: round(group.present, 3), change: round(group.change, 3), score: round(group.score, 4) }));
  const best = ranked[0];
  if (!best) return { position: null, confidence: 0.2, notes: ["no text band with changing words found; captions may be absent"], bands };
  const lines = best.hits.filter(Boolean);
  const heights = lines.map((line) => line.y1 - line.y0 + 1).sort((a, b) => a - b);
  const y = lines.reduce((sum, line) => sum + line.y, 0) / lines.length;
  // Highlight: the most saturated colour among the caption lines' pixels.
  const vivid = [];
  let bright = 0, total = 0;
  best.hits.forEach((line, f) => {
    if (!line) return;
    const frame = frames[f];
    for (let yy = line.y0; yy <= line.y1; yy += 1) for (let x = line.x0; x < line.x1; x += 1) {
      const i = (yy * width + x) * 3;
      const rgb = [frame.data[i], frame.data[i + 1], frame.data[i + 2]];
      const { s, l } = hexToHsl(rgbToHex(rgb));
      total += 1;
      if (l > 0.55) bright += 1;
      if (s > 0.55 && l > 0.35 && l < 0.8) vivid.push(rgb);
    }
  });
  const highlight = vivid.length > total * 0.002 ? kmeansColors(vivid, { k: 3 })[0]?.hex ?? null : null;
  const textCase = lineCase(lines);
  const runnerUp = ranked[1] && Math.abs(ranked[1].centre - best.centre) > step * 2 ? ranked[1].score : 0;
  const confidence = round(Math.min(0.75, 0.3 + best.present * best.change * 0.4 + (runnerUp < best.score * 0.6 ? 0.1 : 0)), 2);
  return {
    position: positionOf(y),
    y: round(y, 3),
    present: round(best.present, 3),
    change: round(best.change, 3),
    text_height_fraction: round(heights[Math.floor(heights.length / 2)] / height, 3),
    bright_ratio: total ? round(bright / total, 3) : 0,
    highlight,
    case: textCase.case,
    case_ratio: textCase.ratio,
    confidence,
    bands,
    samples: best.hits.map(Boolean),
    notes: []
  };
}

/**
 * Where each text column of a line starts and where the line sits: for every
 * column of the line's box (widened by 60% of its height above and below),
 * the top-most stroke pixel (luma 50 above the box's median, at least 130).
 * → {tops: [row], base (median bottom row)} or null with too few columns.
 */
export function lineColumns(frame, line) {
  const { width, height } = frame;
  const tall = line.y1 - line.y0 + 1;
  const y0 = Math.max(0, line.y0 - Math.round(tall * 0.6)), y1 = Math.min(height - 1, line.y1 + Math.round(tall * 0.6));
  const values = [];
  for (let y = y0; y <= y1; y += 1) for (let x = line.x0; x < Math.min(width, line.x1); x += 2) values.push(lumaAt(frame, x, y));
  values.sort((a, b) => a - b);
  const threshold = Math.max(130, (values[values.length >> 1] ?? 0) + 50);
  const tops = [], bottoms = [];
  for (let x = line.x0; x < Math.min(width, line.x1); x += 1) {
    let top = -1, bottom = -1;
    for (let y = y0; y <= y1; y += 1) if (lumaAt(frame, x, y) > threshold) { if (top < 0) top = y; bottom = y; }
    if (top >= 0) { tops.push(top); bottoms.push(bottom); }
  }
  if (tops.length < 10) return null;
  bottoms.sort((a, b) => a - b);
  return { tops, base: bottoms[bottoms.length >> 1] };
}

/**
 * Caption case from column tops across many caption lines of one video.
 * Caption text keeps one size, so the tallest lines (90th percentile of
 * base - top) give the cap and ascender height H. Capitals start nearly every
 * column within 0.15 H of that height; lowercase starts most columns lower,
 * at the x-height, and only ascenders and initials reach it, even in a line
 * with no tall letters. share = columns that reach it over all columns.
 * → {case: "upper" | "as-is" | null, share}
 */
export function columnCase(lines) {
  const usable = lines.filter((line) => line?.tops?.length);
  if (usable.length < 2) return { case: null, share: null };
  const heights = usable.map((line) => line.base - [...line.tops].sort((a, b) => a - b)[Math.floor(line.tops.length * 0.02)]).sort((a, b) => a - b);
  const H = heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.9))];
  if (!(H >= 6)) return { case: null, share: null };
  let reach = 0, total = 0;
  for (const line of usable) for (const top of line.tops) { total += 1; if (top <= line.base - H * 0.85) reach += 1; }
  const share = reach / total;
  return { case: share >= 0.7 ? 'upper' : share <= 0.5 ? 'as-is' : null, share: round(share, 3) };
}

/**
 * Re-read the caption case from the caption band at the source resolution
 * (up to 3840 px wide): small captions are a few pixels tall in the sampled
 * frames, too few to tell x-height from capitals. Crops the band (± 2.5 text
 * heights) from up to `count` samples that showed captions and reads the
 * case from the caption line's column tops (columnCase). → captions with
 * case, case_share and case_source, or unchanged when nothing was read.
 */
export async function refineCaptionCase(file, captions, times, { count = 12 } = {}, run = runBuffer) {
  if (!captions?.position || !Number.isFinite(captions.y) || !Array.isArray(captions.samples)) return captions;
  const info = await probe(file, run);
  const width = Math.min(3840, info.width || 1920);
  const picks = times.filter((at, i) => captions.samples[i] && Number.isFinite(at));
  const chosen = picks.filter((_, i) => i % Math.max(1, Math.ceil(picks.length / count)) === 0).slice(0, count);
  const half = Math.max(0.04, (captions.text_height_fraction ?? 0.03) * 2.5);
  const top = Math.max(0, captions.y - half), span = Math.min(1 - top, half * 2);
  const height = Math.max(2, Math.round((width * info.height * span) / info.width / 2) * 2);
  const lines = [];
  for (const at of chosen) {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(Math.round(at * 1000) / 1000), "-i", file, "-frames:v", "1", "-vf", `crop=iw:ih*${round(span, 4)}:0:ih*${round(top, 4)},scale=${width}:${height}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
    const data = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
    if (data.length < width * height * 3) continue;
    const frame = { width, height, data: data.subarray(0, width * height * 3) };
    // The caption line: the one nearest the band's centre.
    const line = textLines(frame, { maxHeight: 0.7 }).sort((a, b) => Math.abs((a.y0 + a.y1) / 2 - height / 2) - Math.abs((b.y0 + b.y1) / 2 - height / 2))[0];
    if (line) lines.push(lineColumns(frame, line));
  }
  const read = columnCase(lines);
  if (!read.case) return { ...captions, case_share: read.share };
  return { ...captions, case: read.case, case_share: read.share, case_source: `column tops in the caption band at ${width} px (${lines.filter(Boolean).length} samples)` };
}

/**
 * Case of caption lines (textLines). Lowercase letters leave sparse rows of
 * ascenders and descenders just outside the dense x-height core; capitals
 * fill the line from top to bottom and leave nothing outside it. outside =
 * the edge density in the rows above and below the core over the core's,
 * and ratio = the top quarter of the core over its middle half (captionCase),
 * medians over the lines. → {case: "upper" | "as-is" | null, ratio, outside}
 */
export function lineCase(lines) {
  const ratios = [], outsides = [];
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  for (const line of lines) {
    const rows = line.rows ?? [];
    if (rows.length < 4) continue;
    const quarter = Math.max(1, Math.floor(rows.length / 4));
    const middle = rows.slice(quarter, rows.length - quarter);
    if (!middle.length || !(avg(middle) > 0)) continue;
    ratios.push(avg(rows.slice(0, quarter)) / avg(middle));
    outsides.push((line.outside ?? 0) / avg(rows));
  }
  if (!ratios.length) return { case: null, ratio: null, outside: null };
  const median = (list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const ratio = median(ratios), outside = median(outsides);
  const textCase = outside >= 0.1 || ratio <= 0.55 ? 'as-is' : ratio >= 0.75 && outside < 0.04 ? 'upper' : null;
  return { case: textCase, ratio: round(ratio, 3), outside: round(outside, 3) };
}

/**
 * Case of the caption text from the shape of its rows: lowercase text has
 * sparse ascender rows above a dense x-height core, while capitals are about
 * as dense at the top of the line as in the middle. ratio = edge density of
 * the top quarter of the text rows over the middle half, median over frames.
 * → {case: "upper" | "as-is" | null, ratio}
 */
export function captionCase(rowEdges, band) {
  const ratios = [];
  for (const rows of rowEdges) {
    const text = [];
    for (let y = band.y0; y < band.y1; y += 1) if (rows[y] > 0.08) text.push(rows[y]);
    if (text.length < 8) continue;
    const quarter = Math.max(1, Math.floor(text.length / 4));
    const top = text.slice(0, quarter);
    const middle = text.slice(quarter, text.length - quarter);
    const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    if (middle.length) ratios.push(avg(top) / avg(middle));
  }
  if (!ratios.length) return { case: null, ratio: null };
  const ratio = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
  return { case: ratio >= 0.75 ? 'upper' : ratio <= 0.55 ? 'as-is' : null, ratio: round(ratio, 3) };
}

// ---------------------------------------------------------------------------
// Layouts

/**
 * The share of a region that looks like a designed panel: very smooth pixels
 * (luma changes by less than 3 to the right and below) whose luma sits within
 * 10 of the region's most common smooth luma. A flat panel stays mostly panel
 * even with cards and text on it; footage, even smooth clothing or a wall
 * once downsampled, carries shading and grain.
 */
export function panelShare(frame, x0, x1, y0, y1) {
  const histogram = new Array(256).fill(0);
  const smooth = [];
  let n = 0;
  for (let y = y0; y < y1 - 1; y += 1) for (let x = x0; x < x1 - 1; x += 1) {
    n += 1;
    const v = lumaAt(frame, x, y);
    if (Math.abs(v - lumaAt(frame, x + 1, y)) + Math.abs(v - lumaAt(frame, x, y + 1)) >= 3) continue;
    smooth.push(v);
    histogram[Math.round(v)] += 1;
  }
  if (!n || !smooth.length) return 0;
  let mode = 0, best = -1;
  for (let v = 0; v < 256; v += 1) {
    let count = 0;
    for (let k = Math.max(0, v - 3); k <= Math.min(255, v + 3); k += 1) count += histogram[k];
    if (count > best) { best = count; mode = v; }
  }
  return smooth.filter((v) => Math.abs(v - mode) <= 10).length / n;
}

/**
 * Footage layouts per sampled frame (RFC §7.1, approximate): a split is a
 * panel side (panelShare ≥ 0.6 over the outer 40% of the width) beside a
 * side that is not (≤ 0.4 and at least 0.3 less: footage); a side that is
 * panel only in part (≥ 0.38, a light card covering it) beside footage
 * (≤ 0.35) counts when a neighbouring sample shows the same split strongly. Framed is a panel border around
 * footage; anything else is full. A panel counts only when a neighbouring
 * sample shows the same layout (panels hold for a section; a flat frame for
 * one sample is a cut or a fade). → {frames: [layout], mix: {layout: share}, changes, sides, notes}
 */
export function detectLayouts(frames) {
  if (!frames.length) return { frames: [], mix: {}, changes: 0, notes: ['no frames'] };
  const reads = frames.map((frame) => {
    const { width: w, height: h } = frame;
    const left = panelShare(frame, 0, Math.round(w * 0.4), 0, h), right = panelShare(frame, Math.round(w * 0.6), w, 0, h);
    const strong = left >= 0.6 && right <= 0.4 && left - right >= 0.3 ? 'split-left' : right >= 0.6 && left <= 0.4 && right - left >= 0.3 ? 'split-right' : null;
    const weak = strong ? null : left >= 0.38 && right <= 0.35 ? 'split-left' : right >= 0.38 && left <= 0.35 ? 'split-right' : null;
    let framed = false;
    if (!strong && !weak) {
      const b = Math.max(2, Math.round(Math.min(w, h) * 0.08));
      const border = [panelShare(frame, 0, w, 0, b), panelShare(frame, 0, w, h - b, h), panelShare(frame, 0, b, b, h - b), panelShare(frame, w - b, w, b, h - b)];
      const centre = panelShare(frame, Math.round(w * 0.2), Math.round(w * 0.8), Math.round(h * 0.2), Math.round(h * 0.8));
      framed = border.every((share) => share >= 0.7) && centre <= 0.3;
    }
    return { strong: strong ?? (framed ? 'framed' : null), weak, left: round(left, 3), right: round(right, 3) };
  });
  const raw = reads.map((read, i) => read.strong ?? (read.weak && [reads[i - 1], reads[i + 1]].some((other) => other?.strong === read.weak) ? read.weak : 'full'));
  const layouts = raw.map((layout, i) => (layout === 'full' || raw[i - 1] === layout || raw[i + 1] === layout ? layout : 'full'));
  const counts = {};
  for (const layout of layouts) counts[layout] = (counts[layout] ?? 0) + 1;
  const mix = Object.fromEntries(Object.entries(counts).map(([layout, count]) => [layout, round(count / layouts.length, 4)]));
  let changes = 0;
  for (let i = 1; i < layouts.length; i += 1) if (layouts[i] !== layouts[i - 1]) changes += 1;
  return { frames: layouts, mix, changes, sides: reads.map(({ left, right }) => [left, right]), notes: [] };
}

// ---------------------------------------------------------------------------
// One reference

/**
 * Measure one reference video: palette clusters, pacing, energy, captions and
 * sound. adapters: {run, motion, audio, changes, refineCase (null skips the
 * caption-case re-read)} to replace ffmpeg-backed steps in tests.
 */
export async function analyzeReference(file, options = {}, adapters = {}) {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) throw new Error(`Reference not found: ${file}`);
  const run = adapters.run ?? runBuffer;
  const image = Boolean(options.image);
  // Frames at 480 px for layouts and captions (small captions need the
  // pixels); the palette reads them averaged down to 160 px.
  const { info, frames: detail } = await sampleFrames(resolved, { count: options.frames ?? 24, width: REFERENCE_DETAIL_WIDTH, image }, run);
  const frames = detail.map((frame) => downsampleFrame(frame, REFERENCE_SAMPLE_WIDTH));
  const palette = paletteClusters(pixelsFromFrames(frames), { k: 8 });
  const vivid = vividHues(frames);
  const layouts = image ? null : detectLayouts(detail);
  let captions = image ? null : detectCaptions(detail, { layouts: layouts.frames });
  if (captions?.position && adapters.refineCase !== null) captions = await (adapters.refineCase ?? ((video, found, times) => refineCaptionCase(video, found, times, {}, run)))(resolved, captions, detail.map((frame) => frame.at));
  let pacing = null, energy = null, sound = null;
  if (!image) {
    const motion = await (adapters.motion ?? ((video) => analyzeRenderMotion(video)))(resolved);
    const duration = Number(motion.duration_seconds ?? info.duration);
    // Visual changes: hard cuts (ffmpeg scene scores), structural boundaries
    // (motion graphics change scenes through transitions that scene scores
    // miss) and overlay events (cards and panels appearing or leaving over
    // footage that holds), as a storyboard counts scene starts and ends.
    const band = captions?.position ? [captions.y - Math.max(0.03, captions.text_height_fraction ?? 0.03), captions.y + Math.max(0.03, captions.text_height_fraction ?? 0.03)] : null;
    const changes = adapters.boundaries
      ? { structural: await adapters.boundaries(resolved), overlays: [] }
      : await (adapters.changes ?? ((video) => screenChanges(video, { exclude: band }, run)))(resolved);
    const boundaries = mergeTimes([...(Array.isArray(motion.cuts) ? motion.cuts : []), ...changes.structural, ...(changes.overlays ?? [])], 0.4).filter((time) => time > 0.3 && time < duration - 0.5);
    const shots = shotStats([0, ...boundaries, duration]);
    pacing = {
      duration_seconds: round(duration, 3),
      cuts: boundaries.length,
      hard_cuts: Array.isArray(motion.cuts) ? motion.cuts.length : 0,
      overlay_events: changes.overlays?.length ?? 0,
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
  return { file: resolved, name: path.basename(resolved), sha256: await sha256(resolved), kind: image ? "image" : "video", width: info.width, height: info.height, duration_seconds: round(info.duration, 3), palette, vivid, captions, layouts, pacing, energy, sound };
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
 * Structural scene boundaries for motion graphics: grey frames at 10 fps,
 * 45 px on the short side; at each time, the share of content pixels (not the
 * background luma) that changed strongly between t - 0.5 s and t + 0.5 s.
 * Peaks above `threshold` (default 0.7) are boundaries, merged within 1 s.
 */
export async function structuralBoundaries(file, { fps = 10, threshold = 0.7 } = {}, run = runBuffer) {
  return (await screenChanges(file, { fps, threshold }, run)).structural;
}

/**
 * Screen changes from one grey decode at `fps` (90 px on the short side):
 * structural boundaries (boundariesFromGrayFrames, on a 2x box downsample,
 * 45 px) and overlay events (overlayEventsFromGrayFrames: graphics appearing
 * or leaving over footage, which neither cuts nor structural changes see).
 * options.exclude: [from, to] fractions of the height to leave out of the
 * overlay events (the caption band: words change, nothing appears).
 * → {structural: [s], overlays: [s]}
 */
export async function screenChanges(file, { fps = 10, threshold = 0.7, exclude = null } = {}, run = runBuffer) {
  const info = await probe(file, run);
  const portrait = info.height >= info.width;
  const w = portrait ? 90 : 160, h = portrait ? 160 : 90;
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=${fps},scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
  const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
  const size = w * h, count = Math.floor(buffer.length / size);
  const half = Buffer.alloc(count * (size / 4));
  for (let f = 0; f < count; f += 1) for (let y = 0; y < h / 2; y += 1) for (let x = 0; x < w / 2; x += 1) {
    const at = f * size + y * 2 * w + x * 2;
    half[f * (size / 4) + y * (w / 2) + x] = (buffer[at] + buffer[at + 1] + buffer[at + w] + buffer[at + w + 1] + 2) >> 2;
  }
  return { structural: boundariesFromGrayFrames(half, w / 2, h / 2, fps, { threshold }), overlays: overlayEventsFromGrayFrames(buffer.subarray(0, count * size), w, h, fps, { exclude }) };
}

/**
 * Overlay events: times where a block of the frame steps from one steady
 * state to another (a card, a lower third or a panel appearing or leaving)
 * while the rest of the shot plays on. Per cell (a 16th of the width), the
 * mean luma over 0.8 s before and after t; a cell steps when the means differ
 * by more than 18 and both sides hold steady (spread under a quarter of the
 * step: a moving hand or face does not hold). An event is a peak where at
 * least 2.5% of the cells step (outside `exclude`, [from, to] height
 * fractions), merged within 0.8 s. → [seconds]
 */
export function overlayEventsFromGrayFrames(buffer, width, height, fps, { exclude = null } = {}) {
  const size = width * height;
  const count = Math.floor(buffer.length / size);
  const cell = Math.max(2, Math.floor(Math.max(width, height) / 16));
  const cols = Math.floor(width / cell), rows = Math.floor(height / cell);
  const skip = (cy) => exclude && (cy + 1) * cell > exclude[0] * height && cy * cell < exclude[1] * height;
  const cells = [];
  for (let cy = 0; cy < rows; cy += 1) if (!skip(cy)) for (let cx = 0; cx < cols; cx += 1) cells.push([cx, cy]);
  if (count < 4 || !cells.length) return [];
  const means = cells.map(() => new Float32Array(count));
  for (let f = 0; f < count; f += 1) cells.forEach(([cx, cy], c) => {
    let sum = 0;
    for (let y = cy * cell; y < (cy + 1) * cell; y += 1) for (let x = cx * cell; x < (cx + 1) * cell; x += 1) sum += buffer[f * size + y * width + x];
    means[c][f] = sum / (cell * cell);
  });
  const win = Math.max(2, Math.round(fps * 0.8)), gap = 1;
  const stats = (series, from, to) => { let a = 0, q = 0; for (let k = from; k < to; k += 1) { a += series[k]; q += series[k] * series[k]; } const n = to - from; const mean = a / n; return { mean, spread: Math.sqrt(Math.max(0, q / n - mean * mean)) }; };
  const share = new Float32Array(count);
  for (let f = win + gap; f + gap + win <= count; f += 1) {
    let stepped = 0;
    for (const series of means) {
      const before = stats(series, f - gap - win, f - gap), after = stats(series, f + gap, f + gap + win);
      const step = Math.abs(after.mean - before.mean);
      if (step > 18 && before.spread < step * 0.25 && after.spread < step * 0.25) stepped += 1;
    }
    share[f] = stepped / cells.length;
  }
  const events = [];
  for (let f = 1; f < count - 1; f += 1) {
    if (share[f] >= 0.025 && share[f] >= share[f - 1] && share[f] > share[f + 1] && (!events.length || f / fps - events.at(-1) > 0.8)) events.push(f / fps);
  }
  return events;
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
  // Case: a majority of the references that could tell (sentence case picks the quiet presets).
  const cases = found.map((entry) => entry.case).filter(Boolean);
  const textCase = cases.length ? (cases.filter((value) => value === 'as-is').length > cases.length / 2 ? 'as-is' : cases.filter((value) => value === 'upper').length > cases.length / 2 ? 'upper' : null) : null;
  const preset = textCase === 'as-is'
    ? (highlight ? 'quiet-accent' : 'minimal-line')
    : highlight ? (size >= 1.15 ? 'outline-heavy' : 'word-highlight') : size < 0.8 ? 'minimal-line' : 'word-highlight';
  const captions = { preset, position: position === 'bottom' ? 'auto' : position, ...(Math.abs(size - 1) > 0.08 ? { size } : {}) };
  const notes = [`text-like band: ${position} (confidence ${mean(found.map((entry) => entry.confidence)).toFixed(2)})`, `text height ≈ ${heightFraction ? (heightFraction * 100).toFixed(1) : '?'}% of the frame → size ×${size}`, `case: ${textCase === 'as-is' ? 'sentence case' : textCase === 'upper' ? 'capitals' : 'not clear'} (${found.some((entry) => Number.isFinite(entry.case_share)) ? `letter columns reaching the cap height ${found.map((entry) => entry.case_share).filter(Number.isFinite).map((value) => pct(value)).join(', ')}; capitals ≥ 70%, sentence case ≤ 50%` : `top-of-line row density ${found.map((entry) => entry.case_ratio).filter(Number.isFinite).map((value) => value.toFixed(2)).join(', ') || '?'} of the middle; capitals ≥ 0.75, sentence case ≤ 0.55`})`];
  if (highlight) {
    const nearest = palette.map((entry) => entry.hex).sort((a, b) => colorDistance(a, highlight) - colorDistance(b, highlight))[0];
    notes.push(`highlight colour ≈ ${highlight}${nearest ? ` (nearest palette colour ${nearest})` : ''}`);
  } else notes.push('no saturated highlight colour found in the band');
  const treatment = { position, case: textCase, highlight: Boolean(highlight), size, preset };
  return { captions, highlight, treatment, confidence: round(Math.min(0.6, mean(found.map((entry) => entry.confidence))), 2), notes };
}

/**
 * The layout mix over the references (each weighs the same) and the layouts
 * it suggests: a split used for at least 15% of the frames becomes the
 * preferred layout for list lines. → {mix, layouts, confidence, notes}
 */
export function layoutsFromDetection(detections) {
  const found = detections.filter((entry) => entry?.frames?.length);
  const layouts = structuredClone(STYLE_V3_DEFAULTS.layouts);
  if (!found.length) return { mix: null, layouts, confidence: 0.2, notes: ['no video reference: no layout mix'] };
  const sums = {};
  for (const entry of found) for (const [layout, share] of Object.entries(entry.mix)) sums[layout] = (sums[layout] ?? 0) + share;
  const mix = Object.fromEntries(Object.entries(sums).map(([layout, sum]) => [layout, round(sum / found.length, 4)]));
  const splits = Object.entries(mix).filter(([layout]) => layout.startsWith('split-')).sort((a, b) => b[1] - a[1]);
  const notes = [`layout mix: ${Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([layout, share]) => `${layout} ${Math.round(share * 100)}%`).join(', ')}`];
  if (splits[0] && splits[0][1] >= 0.15) { layouts.by_intent.list = splits[0][0]; notes.push(`lists prefer ${splits[0][0]} (the most used split)`); }
  if ((mix.framed ?? 0) >= 0.15) { layouts.by_intent.product = 'framed'; notes.push('product lines prefer framed'); }
  return { mix, layouts, confidence: 0.3, notes };
}

const percentiles = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const q = (p) => { const at = (sorted.length - 1) * p; const lo = Math.floor(at), hi = Math.ceil(at); return round(sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo), 3); };
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9) };
};

/**
 * A cadence profile (launchclip.cadence-profile.v1, RFC §5.1) measured from
 * the video references: shot lengths pooled over every shot; visual changes
 * and layout changes per minute, one value per 30 s window (or per reference
 * when shorter). Only measurements are kept, and the result is a valid
 * profile (kit/core/profiles.mjs validateProfile): `format` is the kind of
 * video measured (footage-led by default), `rights` the references' rights
 * (own by default: a channel's own videos). → profile or null (no video).
 */
export function profileFromReferences(name, references, { format = 'footage-led', rights = 'own', now = () => new Date().toISOString() } = {}) {
  const videos = references.filter((entry) => entry.kind === 'video' && entry.pacing);
  if (!videos.length) return null;
  const shots = [], changes = [], layoutChanges = [];
  for (const entry of videos) {
    const duration = Number(entry.pacing.duration_seconds ?? entry.duration_seconds) || 0;
    if (!(duration > 0)) continue;
    const edges = [0, ...(entry.pacing.boundaries ?? []), duration];
    for (let i = 1; i < edges.length; i += 1) if (edges[i] > edges[i - 1]) shots.push(edges[i] - edges[i - 1]);
    const windows = Math.max(1, Math.floor(duration / 30));
    const span = duration / windows;
    for (let w = 0; w < windows; w += 1) {
      const count = (entry.pacing.boundaries ?? []).filter((time) => time >= w * span && time < (w + 1) * span).length;
      changes.push((count / span) * 60);
    }
    if (entry.layouts?.frames?.length) layoutChanges.push((entry.layouts.changes / duration) * 60);
  }
  const measures = {};
  const add = (key, values) => { const range = percentiles(values); if (range) measures[key] = range; };
  add('shot_seconds', shots);
  add('visual_changes_per_min', changes);
  add('layout_changes_per_min', layoutChanges);
  if (!Object.keys(measures).length) return null;
  const durations = videos.map((entry) => Number(entry.duration_seconds)).filter(Number.isFinite);
  const measuredAt = now();
  return {
    schema: CADENCE_PROFILE_SCHEMA,
    id: `${name.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-references`,
    title: `${name} (from references)`,
    format,
    duration_seconds: [Math.floor(Math.min(...durations)), Math.ceil(Math.max(...durations)) + 1],
    references: videos.length,
    provenance: {
      kind: 'measured',
      tool: 'launchclip style create --from-reference',
      measured_at: measuredAt,
      note: `Measured from ${videos.length} reference video${videos.length === 1 ? '' : 's'} (${rights}). Only statistics are stored.`,
      sources: videos.map((entry, index) => ({ id: `ref-${String(index + 1).padStart(2, '0')}`, title: entry.name, rights, ...(entry.sha256 ? { sha256: entry.sha256 } : {}), ...(Number.isFinite(entry.duration_seconds) ? { duration_seconds: entry.duration_seconds } : {}), ...(entry.width ? { width: entry.width, height: entry.height } : {}), measured_at: measuredAt }))
    },
    measures
  };
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
 * Draft a v3 pack from analysed references: palette, fonts, grammar, ambient,
 * captions, sound, the layout mix and a measured cadence profile.
 * → {pack, report (markdown), inferred}
 */
export function draftStyleFromReferences(name, references, { fontHints = [], format, rights } = {}) {
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
  const layouts = layoutsFromDetection(videos.map((entry) => entry.layouts));
  const profile = profileFromReferences(name, references, { ...(format ? { format } : {}), ...(rights ? { rights } : {}) });
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
    layouts: layouts.layouts,
    vocabulary: structuredClone(STYLE_V3_DEFAULTS.vocabulary),
    ...(profile ? { profile } : {}),
    brand_frame: structuredClone(STYLE_V3_DEFAULTS.brand_frame),
    dials: structuredClone(STYLE_V3_DEFAULTS.dials),
    references: references.map((entry) => ({ name: entry.name, sha256: entry.sha256, kind: entry.kind, width: entry.width, height: entry.height, duration_seconds: entry.duration_seconds })),
    reference_stats: {
      palette: palette.slice(0, 8),
      ...(pacingStats ? { pacing: pacingStats } : {}),
      ...(energyStats ? { energy: energyStats } : {}),
      ...(sound.stats ? { sound: sound.stats } : {}),
      ...(layouts.mix ? { layout_mix: layouts.mix } : {}),
      ...(captions.treatment ? { captions: captions.treatment } : {})
    },
    created_at: new Date().toISOString()
  };
  const inferred = { palette: roles, grammar, ambient, sound, captions, fonts, layouts, profile };
  return { pack, inferred, report: referenceReport(pack, references, inferred) };
}

const pct = (value) => `${Math.round(value * 100)}%`;

export function referenceReport(pack, references, inferred) {
  const { palette, grammar, ambient, sound, captions, fonts, layouts, profile } = inferred;
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
  lines.push('', '## Captions (approximate)', '', 'Bottom-band text heuristics: text-like rows are runs of dense, strong horizontal luminance edges; a band whose text changes between samples scores as captions. Position, size, highlight colour and case (from how dense the top of the text line is) are estimates; the font is not detected.', '', `- captions: \`${JSON.stringify(pack.captions)}\` (confidence ${captions.confidence.toFixed(2)}).`, ...captions.notes.map((note) => `- ${note}`));
  lines.push('', '## Layouts (approximate)', '', 'Per sampled frame: a flat side (low luma spread, few edges) beside textured footage is a split, a flat border round a textured centre is framed, anything else is full; a panel counts only when a neighbouring sample shows it too.', '');
  if (layouts?.mix) lines.push(`- layouts: \`${JSON.stringify(pack.layouts)}\` (confidence ${layouts.confidence.toFixed(2)}).`, ...layouts.notes.map((note) => `- ${note}`));
  else lines.push('- No video reference: no layout mix.');
  lines.push('', '## Cadence profile', '');
  if (profile) lines.push(`Measured from ${profile.references} video reference${profile.references === 1 ? '' : 's'} as p10 / p50 / p90 (\`profile\` in style.json; the dials move targets inside these bands). With fewer than three references the bands are narrow: add more of your best videos to widen them.`, '', '| Measure | p10 | p50 | p90 |', '| --- | --- | --- | --- |', ...Object.entries(profile.measures).map(([key, range]) => `| ${key} | ${range.p10} | ${range.p50} | ${range.p90} |`));
  else lines.push('No video reference: no profile; pick a shipped one by id in `profile`.');
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

const GRAMMAR_SHOT = Object.freeze({ snappy: [0.6, 1.8], playful: [1.4, 3.5], editorial: [2.5, 6], smooth: [3.5, 8], documentary: [4.5, 12], cinematic: [3.5, 9] });

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

