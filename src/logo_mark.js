// The brand frame's logo, measured (kit/core/brand-frame.mjs frameLogoPlate):
// its tone (dark, light or mixed, from the opaque pixels' luminance), its
// aspect (width / height) and the visible part inside any transparent or
// plain white margin (trim), so a logo-only kicker gets the plate that keeps
// it readable and fills its box with the mark rather than empty space. Read with ffprobe and ffmpeg; a file they cannot
// read (an SVG without a decoder, say) gets no measurement, and the frame
// falls back to the white plate, which holds any dark mark.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SIZE = 128;
// sRGB relative luminance cut-offs for a dark or light mark.
export const DARK_MARK_MAX = 0.42;
export const LIGHT_MARK_MIN = 0.62;

const linear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/**
 * RGBA pixels of a `size` × `size` image → "dark" | "light" | "mixed" | null.
 * A logo with a transparent background is judged by its opaque pixels. One
 * that fills its own rectangle (its edges opaque) already carries a
 * background, so the plate should match that: a light background reads as a
 * dark mark (a white plate), a dark one as a light mark.
 */
export function logoTone(bytes, size = SIZE) {
  const pixels = Math.floor((bytes?.length ?? 0) / 4);
  if (!pixels) return null;
  let weighted = 0, weight = 0, edges = 0, opaqueEdges = 0, edgeLight = 0;
  for (let i = 0; i < pixels; i += 1) {
    const [r, g, b, a] = [bytes[i * 4], bytes[i * 4 + 1], bytes[i * 4 + 2], bytes[i * 4 + 3]];
    const x = i % size, y = Math.floor(i / size);
    if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
      edges += 1;
      if (a >= 240) { opaqueEdges += 1; edgeLight += luminance(r, g, b); }
    }
    if (a < 16) continue;
    weighted += luminance(r, g, b) * (a / 255);
    weight += a / 255;
  }
  if (edges && opaqueEdges / edges > 0.85) return edgeLight / opaqueEdges >= 0.5 ? "dark" : "light";
  if (!weight) return null;
  const mean = weighted / weight;
  return mean <= DARK_MARK_MAX ? "dark" : mean >= LIGHT_MARK_MIN ? "light" : "mixed";
}

/**
 * RGBA pixels of a `size` × `size` image → the visible part {x, y, width,
 * height} as shares of the image, inside a transparent or plain white
 * margin, or null when there is no margin to trim (or the image is a photo).
 */
export function logoTrim(bytes, size = SIZE) {
  if ((bytes?.length ?? 0) < size * size * 4) return null;
  const at = (x, y) => { const i = (y * size + x) * 4; return [bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]; };
  let edges = 0, clear = 0, white = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
    const [r, g, b, a] = at(x, y);
    edges += 1;
    if (a < 24) clear += 1;
    else if (a >= 240 && Math.min(r, g, b) >= 245) white += 1;
  }
  const background = clear / edges > 0.85 ? "clear" : white / edges > 0.95 ? "white" : null;
  if (!background) return null;
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const [r, g, b, a] = at(x, y);
    if (a < 24 || (background === "white" && Math.min(r, g, b) >= 230)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < minX) return null;
  const pad = Math.max(1, Math.round(Math.max(maxX - minX + 1, maxY - minY + 1) * 0.03));
  const left = Math.max(0, minX - pad), top = Math.max(0, minY - pad);
  const right = Math.min(size, maxX + pad + 1), bottom = Math.min(size, maxY + pad + 1);
  if (right - left >= size * 0.9 && bottom - top >= size * 0.9) return null;
  const share = (value) => Math.round((value / size) * 10000) / 10000;
  return { x: share(left), y: share(top), width: share(right - left), height: share(bottom - top) };
}

const cache = new Map();

/** An image file → {tone?, aspect?, trim?} (each may be missing), or null when ffmpeg cannot read it. */
export async function measureLogoMark(file) {
  const key = `${file}:${(await stat(file).catch(() => null))?.mtimeMs ?? "missing"}`;
  if (!cache.has(key)) cache.set(key, readLogoMark(file).catch(() => null));
  return cache.get(key);
}

async function readLogoMark(file) {
  const { stdout: probe } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file]);
  const stream = JSON.parse(probe).streams?.[0] ?? {};
  const aspect = stream.width > 0 && stream.height > 0 ? Math.round((stream.width / stream.height) * 1000) / 1000 : null;
  const { stdout } = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-frames:v", "1", "-vf", `scale=${SIZE}:${SIZE},format=rgba`, "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: 1024 * 1024 });
  const tone = logoTone(stdout);
  const trim = aspect ? logoTrim(stdout) : null;
  return tone || aspect ? { ...(tone ? { tone } : {}), ...(aspect ? { aspect } : {}), ...(trim ? { trim } : {}) } : null;
}

/**
 * The story with story.frame.logo_mark measured from frame.logo (a project
 * path), filling only what the story does not already say. → the same story
 * when there is no logo, nothing to add, or the file cannot be read.
 */
export async function withLogoMark(story, projectDir = process.cwd()) {
  const frame = story?.frame;
  if (!frame || typeof frame !== "object" || Array.isArray(frame) || typeof frame.logo !== "string" || !frame.logo.trim()) return story;
  const known = frame.logo_mark && typeof frame.logo_mark === "object" ? frame.logo_mark : {};
  if (known.tone && known.aspect) return story;
  const measured = await measureLogoMark(path.resolve(projectDir, frame.logo.trim()));
  if (!measured) return story;
  // A stated aspect belongs with its own trim (or none), not the measured one.
  const logo_mark = { ...(known.aspect ? { ...measured, trim: undefined } : measured), ...known };
  if (logo_mark.trim === undefined) delete logo_mark.trim;
  if (logo_mark.tone === known.tone && logo_mark.aspect === known.aspect) return story;
  return { ...story, frame: { ...frame, logo_mark } };
}
