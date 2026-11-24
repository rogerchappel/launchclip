// Limb weight from pixels: how thick a drawn figure's limbs are relative to
// its head width, measured on a decoded frame so a candidate video and a
// reference clip (which has no character data) are compared the same way.
//
//   limbWeight(gray, width, height) → {head_px, stroke_px, ratio, figure} | {ratio: null, reason}
//   measureFrame(video, at, {width, height}) → the same, from one decoded frame
//
// The figure is the largest connected patch of "ink" (pixels far from the
// frame's median luminance). Its head width is the widest row from the top of
// the figure down to the neck (where the row narrows again); its stroke width
// is twice the median distance-to-edge along the limbs' centre lines (the
// ridge of a chamfer distance transform) below the head.
//
// shortcut: one upright figure on a plain ground. Arms raised above the head,
// two figures touching, or a busy painted background make the number
// meaningless, so it is reported as evidence for the reviewer and never
// decides the limb-weight check; upgrade to a pose-aware measure (the rig's
// own limb data) when one exists for both sides.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INK_CONTRAST = 64;
// The head ends where a row is narrower than this share of the widest row so far.
const NECK_SHARE = 0.4;
// A "head" deeper than this share of the figure is not a head (arms up, or no figure).
const MAX_HEAD_SHARE = 0.45;
const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The largest 4-connected component of the ink mask → {pixels: Int32Array of indices, mask, box}. */
function largestComponent(ink, width, height) {
  const label = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  let best = null;
  let next = 0;
  for (let start = 0; start < ink.length; start += 1) {
    if (!ink[start] || label[start]) continue;
    next += 1;
    let head = 0, tail = 0;
    queue[tail++] = start;
    label[start] = next;
    while (head < tail) {
      const at = queue[head++];
      const x = at % width, y = (at - x) / width;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (ink[n] && !label[n]) { label[n] = next; queue[tail++] = n; }
      }
    }
    if (!best || tail > best.size) best = { id: next, size: tail };
  }
  if (!best) return null;
  const mask = new Uint8Array(width * height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < label.length; i += 1) {
    if (label[i] !== best.id) continue;
    mask[i] = 1;
    const x = i % width, y = (i - x) / width;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { mask, size: best.size, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/** Chamfer (3-4) distance to the nearest non-ink pixel, in pixels (edge pixels are 1). */
function distanceTransform(mask, width, height) {
  const BIG = 1e9;
  const d = new Float64Array(width * height);
  for (let i = 0; i < d.length; i += 1) d[i] = mask[i] ? BIG : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x]);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const i = y * width + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  for (let i = 0; i < d.length; i += 1) d[i] /= 3;
  return d;
}

/** gray: one byte per pixel, row-major. → {head_px, stroke_px, ratio, figure} or {ratio: null, reason}. */
export function limbWeight(gray, width, height) {
  if (gray.length < width * height) throw new Error(`limbWeight: ${gray.length} bytes for a ${width}x${height} frame`);
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < width * height; i += 1) histogram[gray[i]] += 1;
  let ground = 0;
  for (let seen = 0; ground < 256; ground += 1) { seen += histogram[ground]; if (seen >= (width * height) / 2) break; }
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i += 1) ink[i] = Math.abs(gray[i] - ground) > INK_CONTRAST ? 1 : 0;
  const figure = largestComponent(ink, width, height);
  if (!figure || figure.size < 50) return { ratio: null, reason: "no drawn figure: nothing stands out from the ground" };
  const { mask, box } = figure;
  if (box.w * box.h > 0.8 * width * height) return { ratio: null, reason: "the largest ink patch fills the frame (a busy or dark background), not a figure" };

  // Head: widest row from the top until the row narrows to the neck.
  let widest = 0, neck = null;
  for (let y = box.y; y < box.y + box.h; y += 1) {
    let left = -1, right = -1;
    for (let x = box.x; x < box.x + box.w; x += 1) if (mask[y * width + x]) { if (left < 0) left = x; right = x; }
    const span = left < 0 ? 0 : right - left + 1;
    if (span > widest) widest = span;
    else if (widest && span < widest * NECK_SHARE) { neck = y; break; }
  }
  if (neck === null || neck - box.y > box.h * MAX_HEAD_SHARE) return { ratio: null, reason: "no head found at the top of the figure (arms raised, or not an upright figure)", figure: box };

  const distance = distanceTransform(mask, width, height);
  const ridge = [];
  for (let y = Math.max(neck, 1); y < Math.min(box.y + box.h, height - 1); y += 1) {
    for (let x = Math.max(box.x, 1); x < Math.min(box.x + box.w, width - 1); x += 1) {
      const v = distance[y * width + x];
      if (!v) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (distance[(y + dy) * width + x + dx] > v) { top = false; break; }
      if (top) ridge.push(v);
    }
  }
  const half = median(ridge);
  if (!half) return { ratio: null, reason: "no limbs below the head", figure: box };
  const stroke = Math.max(1, 2 * half - 1);
  return { head_px: widest, stroke_px: round(stroke, 2), ratio: round(stroke / widest), figure: box };
}

/** One decoded frame of a video at `at` seconds, measured. width/height: the video's. */
export async function measureFrame(video, at, { width, height, exec = execFileAsync } = {}) {
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-ss", String(Math.max(0, at)), "-i", video, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (stdout.length < width * height) return { ratio: null, reason: `no frame decoded at ${at}s` };
  return limbWeight(stdout, width, height);
}

/** The median ratio of a list of measures (nulls left out) → number | null. */
export function medianRatio(measures) {
  return median(measures.map((entry) => entry?.ratio).filter((value) => typeof value === "number"));
}
