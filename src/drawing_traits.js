// Drawing traits: how a reference is drawn, measured from sampled frames
// (launchclip.drawing-traits.v1). `style create --from-reference` stores the
// block at reference_stats.drawing; `style compare` measures a sample render
// the same way and reports the distance per trait
// (kit/core/style-distance.mjs drawingDistanceReport).
//
// Everything is local: ffmpeg decodes frames, the maths is plain JS, no model.
// Each trait carries its numbers, a label and a confidence (0–1):
//
// - outline  scan lines across every frame for thin ridges (a run darker, or
//            lighter, than both sides, at most 2.2% of the short side wide)
//            and for steps (one tone to another with no line between).
//            presence = lines that separate two tones / (those + steps): the
//            share of region boundaries that are inked. weight = the typical
//            ridge width (full width at half depth), in px of a frame 1080 px
//            on its short side. Line art on plain paper has no boundaries, so
//            it is read from line_share (ridges / all crossings).
// - fill     8 px blocks with no edge in them: a plane is fitted to each;
//            flat (no slope, no residual), gradient (a slope) or textured (a
//            residual). cel = steps between two tones of one hue (a shade
//            shape on a fill) / all steps.
// - palette  saturation (OKLCH chroma: mean and 90th percentile), contrast
//            (lightness p95 − p5) and the median lightness. The colours
//            themselves are reference_stats.palette (src/style_reference.js).
// - shape    along every edge, the direction 6 px ahead and behind: the same
//            (straight), turning (curved), or no edge there (a corner or an
//            end). roundness = curved / (curved + corner).
// - grain    the residual of the flat blocks (luma levels) and the share of
//            blocks that carry it; from a video, whether it holds still
//            between frames (paper) or moves (grain, a boiling texture).
// - stepping frame differences over runs of consecutive frames: how many
//            frames each drawing is held while something moves (ones, twos,
//            threes), and the drawings per second.
//
// What these cannot tell is listed by drawingLimits(): text reads as lines,
// footage reads as texture, and a pen's taper or wobble is not measured.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const DRAWING_TRAITS_SCHEMA = "launchclip.drawing-traits.v1";
export const DRAWING_TRAITS = Object.freeze(["outline", "fill", "palette", "shape", "grain", "stepping"]);
// Frames are measured at up to this width (never upscaled).
export const DRAWING_WIDTH = 960;
// Fills are read in blocks of this many px; grain motion in blocks twice that.
const BLOCK = 8;
const GRAIN_BLOCK = 16;
// A ridge or a step is at least this many luma levels deep.
const DEPTH = 30;
// Flat blocks: residual and slope limits (luma levels, levels per px).
const RESIDUAL = 1.6;
const SLOPE = 0.06;
const FILL_COUNTS = ["blocks", "smooth", "flat", "gradient", "textured", "sloped", "figure", "figure_sloped"];

const round = (value, places = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null);
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const quantile = (sorted, p) => { if (!sorted.length) return null; const at = (sorted.length - 1) * p; const lo = Math.floor(at), hi = Math.ceil(at); return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo); };
const hex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

// ---------------------------------------------------------------------------
// Planes

/** Luma (0–255) of an rgb24 frame. */
export function lumaPlane(frame) {
  const { width, height, data } = frame;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 3) out[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  return out;
}

function blur3(plane, width, height) {
  const out = new Float32Array(plane.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1);
      let sum = 0;
      for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) sum += plane[yy * width + xx];
      out[y * width + x] = sum / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}

// sRGB (0–255) → OKLab.
const linear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function oklab(r, g, b) {
  const lr = linear(r), lg = linear(g), lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

// ---------------------------------------------------------------------------
// Lines and steps along one scan line

/**
 * Ridges of one scan line `s` (n luma values): thin runs darker than both
 * sides. A ridge starts at the first minimum after a fall; each side must rise
 * at least DEPTH within `maxWidth` px, and the width is the full width at half
 * depth (sub-pixel). → [{at, from, to, width, left, right}] (left/right: the
 * flank positions, where the tone beside the line is read).
 */
export function lineRidges(s, n, maxWidth, mask = null) {
  const found = [];
  const reach = maxWidth + 4;
  let x = 1;
  while (x < n - 1) {
    if (!(s[x - 1] > s[x] + 2 && s[x] <= s[x + 1]) || (mask && mask[x])) { x += 1; continue; }
    let top = s[x], left = x, i = x, steps = 0;
    while (i > 0 && steps < reach && s[i - 1] >= top - 6) { i -= 1; steps += 1; if (s[i] > top + 1) { top = s[i]; left = i; } }
    const leftTop = top;
    top = s[x]; let right = x; i = x; steps = 0;
    while (i < n - 1 && steps < reach && s[i + 1] >= top - 6) { i += 1; steps += 1; if (s[i] > top + 1) { top = s[i]; right = i; } }
    const depth = Math.min(leftTop, top) - s[x];
    if (depth < DEPTH) { x += 1; continue; }
    const half = s[x] + depth / 2;
    let a = x; while (a > left && s[a] < half) a -= 1;
    let b = x; while (b < right && s[b] < half) b += 1;
    const from = s[a] > s[a + 1] ? a + (s[a] - half) / (s[a] - s[a + 1]) : a;
    const to = s[b] > s[b - 1] ? b - (s[b] - half) / (s[b] - s[b - 1]) : b;
    const width = to - from;
    if (width > maxWidth || width <= 0) { x += 1; continue; }
    found.push({ at: x, from, to, width, left, right });
    x = Math.ceil(to) + 1;
  }
  return found;
}

/** Steps of one scan line: a rise or fall of at least DEPTH within 6 px, outside `mask`. → [{from, to}] */
export function lineSteps(s, n, mask = null) {
  const found = [];
  let i = 0;
  while (i < n - 1) {
    const d = s[i + 1] - s[i];
    if (Math.abs(d) <= 2) { i += 1; continue; }
    const sign = d > 0 ? 1 : -1;
    let j = i + 1;
    while (j < n - 1 && (s[j + 1] - s[j]) * sign > 2) j += 1;
    if (Math.abs(s[j] - s[i]) >= DEPTH && j - i <= 6 && !(mask && (mask[i] || mask[j]))) found.push({ from: i, to: j });
    i = j;
  }
  return found;
}

/**
 * Lines and steps of a frame, over every second row and column.
 * → {dark, light: {boundary, inner, widths, colors}, steps, tonal}
 */
export function frameLines(frame, luma = lumaPlane(frame)) {
  const { width, height, data } = frame;
  const maxWidth = Math.max(4, Math.round(Math.min(width, height) * 0.022));
  const out = { dark: { boundary: 0, inner: 0, widths: [], colors: [] }, light: { boundary: 0, inner: 0, widths: [], colors: [] }, steps: 0, tonal: 0 };
  const longest = Math.max(width, height);
  const s = new Float32Array(longest), inv = new Float32Array(longest), mask = new Uint8Array(longest);
  const scan = (n, index) => {
    mask.fill(0, 0, n);
    for (let i = 0; i < n; i += 1) { s[i] = luma[index(i)]; inv[i] = 255 - s[i]; }
    for (const [signal, bucket] of [[s, out.dark], [inv, out.light]]) {
      for (const ridge of lineRidges(signal, n, maxWidth, mask)) {
        const l = index(ridge.left) * 3, r = index(ridge.right) * 3, c = index(ridge.at) * 3;
        const apart = Math.max(Math.abs(data[l] - data[r]), Math.abs(data[l + 1] - data[r + 1]), Math.abs(data[l + 2] - data[r + 2]));
        if (apart > 24) bucket.boundary += 1; else bucket.inner += 1;
        bucket.widths.push(ridge.width);
        if (bucket.colors.length < 4000) bucket.colors.push([data[c], data[c + 1], data[c + 2]]);
        for (let i = Math.max(0, Math.floor(ridge.from) - 2); i <= Math.min(n - 1, Math.ceil(ridge.to) + 2); i += 1) mask[i] = 1;
      }
    }
    for (const step of lineSteps(s, n, mask)) {
      out.steps += 1;
      const a = index(Math.max(0, step.from - 2)) * 3, b = index(Math.min(n - 1, step.to + 2)) * 3;
      const p = oklab(data[a], data[a + 1], data[a + 2]), q = oklab(data[b], data[b + 1], data[b + 2]);
      const cp = Math.hypot(p[1], p[2]), cq = Math.hypot(q[1], q[2]);
      if (cp < 0.035 || cq < 0.035) continue;
      let gap = Math.abs(Math.atan2(p[2], p[1]) - Math.atan2(q[2], q[1])) * (180 / Math.PI);
      if (gap > 180) gap = 360 - gap;
      const dl = Math.abs(p[0] - q[0]);
      if (gap < 25 && dl > 0.03 && dl < 0.25) out.tonal += 1;
    }
  };
  for (let y = 1; y < height; y += 2) scan(width, (i) => y * width + i);
  for (let x = 1; x < width; x += 2) scan(height, (i) => i * width + x);
  return out;
}

// ---------------------------------------------------------------------------
// Fills and grain: blocks with no edge in them

/**
 * Blocks of a frame with no edge in them, each fitted with a plane.
 * → {blocks, smooth, flat, gradient, textured, residuals: [per smooth block]}
 */
export function frameFills(frame, luma = lumaPlane(frame), soft = blur3(luma, frame.width, frame.height)) {
  const { width, height } = frame;
  const out = { blocks: 0, smooth: 0, flat: 0, gradient: 0, textured: 0, sloped: 0, figure: 0, figure_sloped: 0, residuals: [] };
  const mid = (BLOCK - 1) / 2, n = BLOCK * BLOCK;
  let sxx = 0;
  for (let k = 0; k < BLOCK; k += 1) sxx += (k - mid) ** 2;
  sxx *= BLOCK;
  // A slope this many times the residual clears the noise the residual puts on it (3 sigma).
  const noisy = 3 / Math.sqrt(sxx);
  const tones = new Uint32Array(64), found = [];
  for (let by = 0; by + BLOCK <= height; by += BLOCK) for (let bx = 0; bx + BLOCK <= width; bx += BLOCK) {
    out.blocks += 1;
    let lo = 255, hi = 0, sum = 0, sx = 0, sy = 0, sq = 0, bsum = 0, bsx = 0, bsy = 0, bsq = 0;
    for (let y = 0; y < BLOCK; y += 1) for (let x = 0; x < BLOCK; x += 1) {
      const i = (by + y) * width + bx + x;
      const b = soft[i];
      if (b < lo) lo = b; if (b > hi) hi = b;
      const v = luma[i];
      sum += v; sq += v * v; sx += (x - mid) * v; sy += (y - mid) * v;
      bsum += b; bsq += b * b; bsx += (x - mid) * b; bsy += (y - mid) * b;
    }
    if (hi - lo >= 24) continue;
    const gx = sx / sxx, gy = sy / sxx;
    // Variance left once the mean and the plane are taken out; the same of the blurred block.
    const residual = Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2 - (gx * gx + gy * gy) * (sxx / n)));
    const coarse = Math.sqrt(Math.max(0, bsq / n - (bsum / n) ** 2 - ((bsx / sxx) ** 2 + (bsy / sxx) ** 2) * (sxx / n)));
    const slope = Math.hypot(gx, gy);
    // Fine texture mostly blurs away; a faint edge or a soft shape does not, and is not texture.
    const textured = residual >= RESIDUAL && coarse < residual * 0.6;
    // A gradient is a plane: a faint edge or a soft shadow inside the block leaves a coarse residual and is not one.
    const sloped = slope >= Math.max(SLOPE, textured ? residual * noisy : 0) && (textured || coarse < Math.max(0.5, slope * BLOCK * 0.1));
    out.smooth += 1;
    out.residuals.push(textured ? residual : Math.min(residual, RESIDUAL * 0.5));
    if (sloped) out.sloped += 1;
    if (textured) out.textured += 1; else if (sloped) out.gradient += 1; else out.flat += 1;
    const tone = Math.min(63, Math.floor(sum / n / 4));
    tones[tone] += 1;
    found.push(tone, sloped ? 1 : 0);
  }
  // The figure: even blocks away from the frame's most common tone (the background).
  let ground = 0;
  for (let t = 1; t < 64; t += 1) if (tones[t] > tones[ground]) ground = t;
  for (let k = 0; k < found.length; k += 2) if (Math.abs(found[k] - ground) > 1) { out.figure += 1; out.figure_sloped += found[k + 1]; }
  return out;
}

// ---------------------------------------------------------------------------
// Shape language

/**
 * Edge pixels of a frame by how the edge runs through them: straight, curved
 * (the direction turns between `reach` px behind and ahead) or a corner (the
 * edge is not there `reach` px along its own direction). → {straight, curved, corner}
 */
export function frameShapes(frame, soft) {
  const { width, height } = frame;
  const blurred = soft ?? blur3(lumaPlane(frame), width, height);
  const gx = new Float32Array(width * height), gy = new Float32Array(width * height), mag = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const i = y * width + x;
    const a = blurred[i - width - 1], b = blurred[i - width], c = blurred[i - width + 1], d = blurred[i - 1], f = blurred[i + 1], g = blurred[i + width - 1], h = blurred[i + width], k = blurred[i + width + 1];
    gx[i] = (c + 2 * f + k - a - 2 * d - g) / 4; gy[i] = (g + 2 * h + k - a - 2 * b - c) / 4;
    mag[i] = Math.hypot(gx[i], gy[i]);
  }
  const edge = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const i = y * width + x;
    if (mag[i] < 20) continue;
    const dx = Math.round(gx[i] / mag[i]), dy = Math.round(gy[i] / mag[i]);
    if (mag[i] >= mag[i + dy * width + dx] && mag[i] > mag[i - dy * width - dx]) edge[i] = 1;
  }
  const reach = Math.max(4, Math.round((6 * width) / DRAWING_WIDTH)), near = 3;
  // The edge near q: within `near` px across the direction of travel, but no
  // more than 1.5 px back along it, so an edge that stops short (a corner) is not found.
  const find = (qx, qy, i, tx, ty) => {
    let best = -1, bestD = Infinity;
    for (let dy = -near; dy <= near; dy += 1) for (let dx = -near; dx <= near; dx += 1) {
      if (Math.abs(dx * tx + dy * ty) > 1.5) continue;
      const x = qx + dx, y = qy + dy;
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
      const j = y * width + x;
      if (!edge[j] || gx[j] * gx[i] + gy[j] * gy[i] < 0.3 * mag[j] * mag[i]) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = j; }
    }
    return best;
  };
  const out = { straight: 0, curved: 0, corner: 0 };
  const margin = reach + near + 1;
  for (let y = margin; y < height - margin; y += 1) for (let x = margin; x < width - margin; x += 1) {
    const i = y * width + x;
    if (!edge[i]) continue;
    const tx = -gy[i] / mag[i], ty = gx[i] / mag[i];
    const a = find(Math.round(x + tx * reach), Math.round(y + ty * reach), i, tx, ty), b = find(Math.round(x - tx * reach), Math.round(y - ty * reach), i, tx, ty);
    if (a < 0 || b < 0) { out.corner += 1; continue; }
    const between = (m, n) => Math.acos(Math.max(-1, Math.min(1, (gx[m] * gx[n] + gy[m] * gy[n]) / (mag[m] * mag[n])))) * (180 / Math.PI);
    const turn = between(a, b);
    if (turn < 6) out.straight += 1;
    // A curve turns on both sides of the pixel; a turn on one side only is the blurred tip of a corner.
    else if (Math.min(between(a, i), between(i, b)) < turn * 0.25) out.corner += 1;
    else out.curved += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Palette numbers

/** Saturation, contrast and lightness over frames (every `step`-th pixel). */
export function paletteNumbers(frames, { step = 3 } = {}) {
  const chroma = [], light = [];
  for (const frame of frames) for (let p = 0; p + 2 < frame.data.length; p += 3 * step) {
    const lab = oklab(frame.data[p], frame.data[p + 1], frame.data[p + 2]);
    chroma.push(Math.hypot(lab[1], lab[2])); light.push(lab[0]);
  }
  if (!light.length) return null;
  const mean = chroma.reduce((a, b) => a + b, 0) / chroma.length;
  chroma.sort((a, b) => a - b); light.sort((a, b) => a - b);
  return { saturation: mean, saturation_p90: quantile(chroma, 0.9), contrast: quantile(light, 0.95) - quantile(light, 0.05), lightness: quantile(light, 0.5) };
}

// ---------------------------------------------------------------------------
// Frame stepping and grain motion (video only)

/**
 * How long each drawing is held, from the mean absolute difference between
 * consecutive frames (`diffs`, one per frame pair, in play order; `breaks`
 * marks the first pair of each separate run). A frame is a new drawing when
 * its difference clears a tenth of the run's strong differences; holds longer
 * than 5 frames are pauses, not stepping. → {frames (moving), shares: {ones,
 * twos, threes, fours}, hold (mean frames per drawing)} or null with too
 * little movement.
 */
export function steppingFromDiffs(diffs, breaks = []) {
  const starts = [0, ...breaks.filter((at) => at > 0 && at < diffs.length), diffs.length];
  const held = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let frames = 0;
  for (let r = 0; r + 1 < starts.length; r += 1) {
    const run = diffs.slice(starts[r], starts[r + 1]);
    if (run.length < 6) continue;
    const sorted = [...run].sort((a, b) => a - b);
    const strong = quantile(sorted, 0.9);
    if (strong < 0.25) continue;
    const floor = Math.max(0.06, strong * 0.1);
    let last = -1;
    run.forEach((value, at) => {
      if (value < floor) return;
      const gap = last < 0 ? 0 : at - last;
      if (gap >= 1 && gap <= 5) { held[Math.min(4, gap)] += gap; frames += gap; }
      last = at;
    });
  }
  if (frames < 8) return null;
  const shares = { ones: held[1] / frames, twos: held[2] / frames, threes: held[3] / frames, fours: held[4] / frames };
  // Drawings per frame, so a mix of ones and twos averages by time on screen.
  const drawings = held[1] + held[2] / 2 + held[3] / 3 + held[4] / 4;
  return { frames, shares, hold: frames / drawings };
}

/**
 * Whether the fine texture of flat areas holds still between two frames of
 * one crop (gray planes at source resolution): 0 = the same texture (paper),
 * 1 = unrelated (grain or a boiling texture). null when the crops have no
 * flat textured area to compare.
 */
export function grainMotion(a, b, width, height) {
  const softA = blur3(a, width, height), softB = blur3(b, width, height);
  let own = 0, between = 0, blocks = 0;
  for (let by = 0; by + GRAIN_BLOCK <= height; by += GRAIN_BLOCK) for (let bx = 0; bx + GRAIN_BLOCK <= width; bx += GRAIN_BLOCK) {
    let lo = 255, hi = 0, va = 0, vb = 0, vd = 0;
    for (let y = 0; y < GRAIN_BLOCK; y += 1) for (let x = 0; x < GRAIN_BLOCK; x += 1) {
      const i = (by + y) * width + bx + x;
      const s = softA[i], t = softB[i];
      if (Math.min(s, t) < lo) lo = Math.min(s, t); if (Math.max(s, t) > hi) hi = Math.max(s, t);
      const ra = a[i] - s, rb = b[i] - t;
      va += ra * ra; vb += rb * rb; vd += (ra - rb) * (ra - rb);
    }
    if (hi - lo >= 24) continue;
    const n = GRAIN_BLOCK * GRAIN_BLOCK;
    if (Math.sqrt((va + vb) / (2 * n)) < 1) continue;
    own += va + vb; between += vd; blocks += 1;
  }
  return blocks >= 4 ? clamp01(between / own) : null;
}

async function runBuffer(command, args, options = {}) {
  return execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 512, encoding: options.encoding ?? "utf8" });
}

async function probeVideo(file, run) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height,avg_frame_rate,r_frame_rate", "-of", "json", file]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const rate = (text) => { const [n, d] = String(text ?? "").split("/").map(Number); return n > 0 ? n / (d > 0 ? d : 1) : 0; };
  return { duration: Number(data.format?.duration ?? 0), width: Number(stream.width ?? 0), height: Number(stream.height ?? 0), fps: rate(stream.avg_frame_rate) || rate(stream.r_frame_rate) };
}

/**
 * Decode runs of consecutive frames of a video and measure stepping
 * (steppingFromDiffs, on 160 px gray frames) and grain motion (grainMotion, on
 * a centre crop at source resolution). Up to six 3 s runs spread over the
 * video; a clip under 20 s is read whole. → {fps, stepping, grain_motion}
 */
export async function measureVideoMotion(file, run = runBuffer) {
  const info = await probeVideo(file, run);
  if (!(info.duration > 0) || !info.width || !(info.fps > 0)) return { fps: info.fps || null, stepping: null, grain_motion: null };
  const whole = info.duration <= 20;
  const windows = whole ? [[0, info.duration]] : Array.from({ length: 6 }, (_, i) => [(info.duration * (i + 0.5)) / 6 - 1.5, 3]);
  const w = 160, h = Math.max(2, Math.round((w * info.height) / info.width / 2) * 2);
  const crop = Math.min(256, Math.floor(Math.min(info.width, info.height) / 16) * 16);
  const diffs = [], breaks = [], motions = [];
  for (const [at, length] of windows) {
    const seek = ["-ss", String(round(Math.max(0, at), 3)), "-t", String(round(length, 3))];
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...seek, "-i", file, "-vf", `scale=${w}:${h}:flags=area,format=gray`, "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
    const size = w * h, count = Math.floor(buffer.length / size);
    if (count >= 2) breaks.push(diffs.length);
    for (let f = 1; f < count; f += 1) {
      let sum = 0;
      for (let i = 0; i < size; i += 1) sum += Math.abs(buffer[f * size + i] - buffer[(f - 1) * size + i]);
      diffs.push(sum / size);
    }
    if (crop >= 64) {
      const frames = 4;
      const grain = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(round(Math.max(0, at), 3)), "-i", file, "-frames:v", String(frames), "-vf", `crop=${crop}:${crop},format=gray`, "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
      const raw = Buffer.isBuffer(grain.stdout) ? grain.stdout : Buffer.from(grain.stdout ?? "");
      const plane = (f) => Float32Array.from(raw.subarray(f * crop * crop, (f + 1) * crop * crop));
      for (let f = 1; f < Math.floor(raw.length / (crop * crop)); f += 1) { const value = grainMotion(plane(f - 1), plane(f), crop, crop); if (value !== null) motions.push(value); }
    }
  }
  return { fps: round(info.fps, 3), stepping: steppingFromDiffs(diffs, breaks.slice(1)), grain_motion: motions.length ? motions.reduce((a, b) => a + b, 0) / motions.length : null };
}

// ---------------------------------------------------------------------------
// One reference → raw numbers → traits

/**
 * The raw drawing numbers of one reference: counts and sums over its frames
 * (rgb24, up to DRAWING_WIDTH wide), plus `motion` (measureVideoMotion) for a
 * video. Raw numbers add up across references (combineDrawingNumbers).
 */
export function drawingNumbers(frames, motion = null) {
  const lines = { dark: { boundary: 0, inner: 0, widths: [], colors: [] }, light: { boundary: 0, inner: 0, widths: [], colors: [] }, steps: 0, tonal: 0 };
  const fills = { blocks: 0, smooth: 0, flat: 0, gradient: 0, textured: 0, sloped: 0, figure: 0, figure_sloped: 0, residuals: [] };
  const shapes = { straight: 0, curved: 0, corner: 0 };
  let short = 0;
  for (const frame of frames) {
    const luma = lumaPlane(frame), soft = blur3(luma, frame.width, frame.height);
    const found = frameLines(frame, luma);
    // Widths in px of a frame 1080 px on its short side.
    const scale = 1080 / Math.min(frame.width, frame.height);
    short = Math.min(frame.width, frame.height);
    for (const tone of ["dark", "light"]) {
      lines[tone].boundary += found[tone].boundary; lines[tone].inner += found[tone].inner;
      for (const width of found[tone].widths) lines[tone].widths.push(width * scale);
      for (const color of found[tone].colors) if (lines[tone].colors.length < 12000) lines[tone].colors.push(color);
    }
    lines.steps += found.steps; lines.tonal += found.tonal;
    const fill = frameFills(frame, luma, soft);
    for (const key of FILL_COUNTS) fills[key] += fill[key];
    for (const value of fill.residuals) fills.residuals.push(value);
    const shape = frameShapes(frame, soft);
    for (const key of Object.keys(shapes)) shapes[key] += shape[key];
  }
  return { frames: frames.length, short_side: short, lines, fills, shapes, palette: paletteNumbers(frames), motion: motion ?? null };
}

/** Raw numbers of several references as one (counts add; palette numbers and motion average). */
export function combineDrawingNumbers(list) {
  const all = list.filter(Boolean);
  if (all.length <= 1) return all[0] ?? null;
  const out = drawingNumbers([]);
  const mean = (values) => { const found = values.filter(Number.isFinite); return found.length ? found.reduce((a, b) => a + b, 0) / found.length : null; };
  for (const entry of all) {
    out.frames += entry.frames; out.short_side = Math.max(out.short_side, entry.short_side);
    for (const tone of ["dark", "light"]) {
      out.lines[tone].boundary += entry.lines[tone].boundary; out.lines[tone].inner += entry.lines[tone].inner;
      for (const width of entry.lines[tone].widths) out.lines[tone].widths.push(width);
      for (const color of entry.lines[tone].colors) out.lines[tone].colors.push(color);
    }
    out.lines.steps += entry.lines.steps; out.lines.tonal += entry.lines.tonal;
    for (const key of FILL_COUNTS) out.fills[key] += entry.fills[key];
    for (const value of entry.fills.residuals) out.fills.residuals.push(value);
    for (const key of Object.keys(out.shapes)) out.shapes[key] += entry.shapes[key];
  }
  const palettes = all.map((entry) => entry.palette).filter(Boolean);
  out.palette = palettes.length ? Object.fromEntries(Object.keys(palettes[0]).map((key) => [key, mean(palettes.map((entry) => entry[key]))])) : null;
  const motions = all.map((entry) => entry.motion).filter(Boolean);
  const steppings = motions.map((entry) => entry.stepping).filter(Boolean);
  if (motions.length) {
    const frames = steppings.reduce((sum, entry) => sum + entry.frames, 0);
    out.motion = {
      fps: mean(motions.map((entry) => entry.fps)),
      grain_motion: mean(motions.map((entry) => entry.grain_motion)),
      stepping: steppings.length ? { frames, shares: Object.fromEntries(["ones", "twos", "threes", "fours"].map((key) => [key, steppings.reduce((sum, entry) => sum + entry.shares[key] * entry.frames, 0) / frames])), hold: steppings.reduce((sum, entry) => sum + entry.hold * entry.frames, 0) / frames } : null,
      // Drawings per second is per reference: frame rates differ.
      drawings_per_second: mean(motions.filter((entry) => entry.stepping && entry.fps).map((entry) => entry.fps / entry.stepping.hold))
    };
  }
  return out;
}

const medianColor = (colors) => { if (!colors.length) return null; const channel = (c) => { const sorted = colors.map((rgb) => rgb[c]).sort((a, b) => a - b); return sorted[sorted.length >> 1]; }; return hex([channel(0), channel(1), channel(2)]); };
// Confidence from how much was counted (enough at `full`) and how clear the reading is (0–1).
const sure = (count, full, clear = 1) => round(clamp01(0.15 + 0.65 * clamp01(count / full) * clamp01(clear) + 0.1 * clamp01(count / (full * 4))), 2);

/**
 * The drawing-traits block (launchclip.drawing-traits.v1) from raw numbers:
 * every trait with its numbers, a label and a confidence, and `unmeasured`
 * for what the references could not show.
 */
export function drawingTraits(numbers) {
  const unmeasured = [];
  if (!numbers?.frames) return { schema: DRAWING_TRAITS_SCHEMA, frames: 0, traits: {}, unmeasured: DRAWING_TRAITS.map((trait) => ({ trait, reason: "no frames" })) };
  const { lines, fills, shapes, palette, motion } = numbers;
  const traits = {};

  // Outline: the tone with more lines is the pen.
  const tone = lines.light.boundary + lines.light.inner > (lines.dark.boundary + lines.dark.inner) * 1.5 ? "light" : "dark";
  const pen = lines[tone];
  const ridges = pen.boundary + pen.inner;
  const crossings = ridges + lines.steps;
  if (crossings < 40) unmeasured.push({ trait: "outline", reason: `only ${crossings} lines and edges found: nothing drawn to read` });
  else {
    const presence = pen.boundary + lines.steps ? pen.boundary / (pen.boundary + lines.steps) : 0;
    const share = ridges / crossings;
    const widths = [...pen.widths].sort((a, b) => a - b);
    const label = presence >= 0.6 ? "outlined" : share >= 0.7 ? "line-art" : presence >= 0.25 ? "partial" : "none";
    const has = label !== "none" && widths.length >= 20;
    traits.outline = {
      label,
      presence: round(presence),
      line_share: round(share),
      // Scan lines cross slanted strokes at an angle, which widens them: the 40th percentile sits near the true width.
      weight: has ? round(quantile(widths, 0.4), 2) : null,
      weight_spread: has ? round(quantile(widths, 0.75) / Math.max(0.1, quantile(widths, 0.25)), 2) : null,
      tone,
      color: has ? medianColor(pen.colors) : null,
      confidence: sure(crossings, 600, 0.4 + Math.min(0.6, Math.abs(presence - 0.42) * 2))
    };
  }

  // Fill and grain share the flat blocks.
  if (fills.smooth < 96) {
    unmeasured.push({ trait: "fill", reason: "no even areas to read: the frames are detail from edge to edge (footage or dense texture)" });
    unmeasured.push({ trait: "grain", reason: "no even areas to read grain in" });
  } else {
    const residuals = [...fills.residuals].sort((a, b) => a - b);
    const coverage = fills.textured / fills.smooth;
    const area = fills.smooth / fills.blocks;
    // Texture in nearly every block is the frame's grain or paper, not a fill: the fills under it are read by slope alone.
    const overall = coverage >= 0.7;
    // The grain's strength: the typical residual of the blocks that carry it.
    const amount = overall ? quantile(residuals.filter((value) => value >= RESIDUAL), 0.5) : quantile(residuals, 0.5);
    const gradient = overall ? fills.sloped / fills.smooth : fills.gradient / fills.smooth;
    const textured = overall ? 0 : coverage;
    const cel = lines.steps >= 40 ? lines.tonal / lines.steps : 0;
    // Shading inside the figure: sloped blocks among those off the background tone.
    const shaded = fills.figure >= 60 ? fills.figure_sloped / fills.figure : null;
    const type = area < 0.2 || textured >= 0.3 ? "textured" : gradient >= 0.3 || shaded >= 0.35 ? "gradient" : cel >= 0.2 ? "cel-shaded" : "flat";
    const flat = Math.max(0, 1 - gradient - textured);
    const lead = type === "textured" ? Math.max(textured, 1 - area) : type === "gradient" ? Math.max(gradient, shaded ?? 0) : type === "cel-shaded" ? cel : Math.min(flat, 1 - cel);
    traits.fill = { type, flat: round(flat), gradient: round(gradient), textured: round(textured), cel: round(cel), shaded: round(shaded), even_area: round(area), confidence: round(sure(fills.smooth, 1600, 0.3 + lead * 0.7) * (overall ? 0.8 : 1), 2) };
    const moving = motion?.grain_motion;
    const label = !overall ? "none" : !Number.isFinite(moving) ? "texture" : moving < 0.35 ? "paper" : "grain";
    traits.grain = { label, amount: round(amount, 2), coverage: round(coverage), motion: Number.isFinite(moving) ? round(moving, 2) : null, confidence: sure(fills.smooth, 1600, 0.4 + Math.min(0.6, Math.abs(coverage - 0.7) * 2)) };
    if (label === "texture") unmeasured.push({ trait: "grain.motion", reason: "still images cannot show whether the texture holds still (paper) or moves (grain)" });
  }

  if (palette) traits.palette = { saturation: round(palette.saturation), saturation_p90: round(palette.saturation_p90), contrast: round(palette.contrast), lightness: round(palette.lightness), theme: palette.lightness < 0.6 ? "dark" : "light", confidence: 0.8 };

  const turns = shapes.curved + shapes.corner;
  const edges = turns + shapes.straight;
  if (edges < 400 || turns < 80) unmeasured.push({ trait: "shape", reason: edges < 400 ? "too few edges to read shapes from" : "edges run straight off the frame: no corners or curves to read" });
  else {
    const roundness = shapes.curved / turns;
    // Footage and dense texture make edges everywhere; shapes read from them mean little.
    const drawn = traits.fill ? clamp01(traits.fill.even_area / 0.5) : 0.3;
    traits.shape = { label: roundness >= 0.6 ? "rounded" : roundness <= 0.4 ? "angular" : "mixed", roundness: round(roundness), straight: round(shapes.straight / edges), curved: round(shapes.curved / edges), corner: round(shapes.corner / edges), confidence: round(sure(turns, 600, 0.4 + Math.min(0.6, Math.abs(roundness - 0.5) * 2)) * (0.5 + 0.5 * drawn), 2) };
  }

  if (!motion) unmeasured.push({ trait: "stepping", reason: "still images have no frames to step between" });
  else if (!motion.stepping) unmeasured.push({ trait: "stepping", reason: "too little movement in the sampled runs to read how long drawings are held" });
  else {
    const { shares, frames, hold } = motion.stepping;
    const [lead, share] = Object.entries(shares).sort((a, b) => b[1] - a[1])[0];
    const perSecond = motion.drawings_per_second ?? (motion.fps ? motion.fps / hold : null);
    traits.stepping = { label: share >= 0.55 ? lead : "mixed", hold_frames: round(hold, 2), drawings_per_second: round(perSecond, 1), fps: round(motion.fps, 2), shares: Object.fromEntries(Object.entries(shares).map(([key, value]) => [key, round(value)])), confidence: sure(frames, 120, (share - 0.4) / 0.5) };
  }
  return { schema: DRAWING_TRAITS_SCHEMA, frames: numbers.frames, traits, unmeasured };
}

/** What the measurements cannot tell, for reports. */
export function drawingLimits() {
  return [
    "Text reads as lines: a reference with a lot of on-screen text shows a higher line share and a thinner line weight than its drawings have.",
    "Footage and photographs read as textured fills with mixed shapes; the traits describe drawn frames.",
    "Line weight is the typical width across every line in the frame. A pen's taper, wobble and pressure are not measured.",
    "Cel shading is read from steps between two tones of one hue, so a tinted shape on a background of the same hue counts too.",
    "Grain is read at the analysis width (960 px), so fine grain in a 4K reference reads weaker than it looks.",
    "Stepping reads the whole frame: a camera move on ones over characters on twos reads as ones or mixed.",
    "The drawing style is matched on line and shading only, from whatever is in the frame: styles that differ by proportions (stick figures, avatars) are not told apart, and a reference with no figures in it can still match one.",
    "Not measured: character proportions, face design, perspective, lighting direction, line colour variety, brush shape."
  ];
}

/**
 * Sample rgb24 frames of a reference for the drawing traits (up to
 * DRAWING_WIDTH wide, never upscaled): `count` spread over the video, or over
 * `window` ([from, to] seconds) of it.
 */
export async function sampleDrawingFrames(file, { image = false, count = 10, window = null } = {}, run = runBuffer) {
  const info = await probeVideo(file, run);
  if (!info.width || !info.height) throw new Error(`${file} has no video stream`);
  const width = Math.min(DRAWING_WIDTH, Math.floor(info.width / 2) * 2);
  const height = Math.max(2, Math.round((width * info.height) / info.width / 2) * 2);
  const [from, to] = window ?? [0, info.duration];
  const times = image || !(info.duration > 0) ? [null] : Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 0.5)) / count);
  const frames = [];
  for (const at of times) {
    const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...(at === null ? [] : ["-ss", String(round(at, 3))]), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:${height}:flags=area,format=rgb24`, "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
    const data = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
    if (data.length >= width * height * 3) frames.push({ at, width, height, data: data.subarray(0, width * height * 3) });
  }
  return frames;
}

/** Measure one reference file → raw drawing numbers (drawingNumbers). With `window`, frames from those seconds only and no motion. */
export async function measureDrawing(file, { image = false, count = 10, window = null } = {}, run = runBuffer) {
  const frames = await sampleDrawingFrames(file, { image, count, window }, run);
  return drawingNumbers(frames, image || window ? null : await measureVideoMotion(file, run));
}
