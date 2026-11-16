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
import { frameBackdrop } from "@launchclip/core/brand-frame.mjs";
import { contrastRatio } from "@launchclip/core/style.mjs";

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

/** RGBA pixels → true when the image's edges are see-through (a mark on no background of its own). */
export function logoClear(bytes, size = SIZE) {
  if ((bytes?.length ?? 0) < size * size * 4) return false;
  let edges = 0, clear = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
    edges += 1;
    if (bytes[(y * size + x) * 4 + 3] < 24) clear += 1;
  }
  return clear / edges > 0.85;
}

/** RGBA pixels → the average colour of an opaque edge (a logo's own box), as #rrggbb, or null. */
export function logoBox(bytes, size = SIZE) {
  if ((bytes?.length ?? 0) < size * size * 4) return null;
  let n = 0, r = 0, g = 0, b = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
    const i = (y * size + x) * 4;
    if (bytes[i + 3] < 240) continue;
    n += 1; r += bytes[i]; g += bytes[i + 1]; b += bytes[i + 2];
  }
  if (!n) return null;
  return `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
}

const cache = new Map();

/** An image file → {tone?, aspect?, trim?, clear} (each may be missing), or null when ffmpeg cannot read it. */
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
  return tone || aspect ? { ...(tone ? { tone } : {}), ...(aspect ? { aspect } : {}), ...(trim ? { trim } : {}), clear: logoClear(stdout), ...(logoClear(stdout) ? {} : { box: logoBox(stdout) }) } : null;
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
  const found = await measureLogoMark(path.resolve(projectDir, frame.logo.trim()));
  if (!found) return story;
  const { clear: _clear, box: _box, ...measured } = found;
  // A stated aspect belongs with its own trim (or none), not the measured one.
  const logo_mark = { ...(known.aspect ? { ...measured, trim: undefined } : measured), ...known };
  if (logo_mark.trim === undefined) delete logo_mark.trim;
  if (logo_mark.tone === known.tone && logo_mark.aspect === known.aspect) return story;
  return { ...story, frame: { ...frame, logo_mark } };
}

/**
 * The tint a brand-lockup image needs to read on `backdrop` (a hex, or null
 * for footage or an unknown base, taken as dark): "paper" for a dark mark on a
 * dark backdrop, "ink" for a light mark on a light one, else null. Only a mark
 * with a see-through background is tinted; one that carries its own box keeps
 * it, since a tint would paint the box solid.
 */
export function lockupTint(measured, backdrop) {
  if (!measured?.clear || !["dark", "light"].includes(measured.tone)) return null;
  const dark = !backdrop || contrastRatio("#ffffff", backdrop) >= contrastRatio("#000000", backdrop);
  return measured.tone === "dark" && dark ? "paper" : measured.tone === "light" && !dark ? "ink" : null;
}

/**
 * An end-card's logo with what was measured filled in ({src, ratio, tone,
 * clear, box}), keeping anything the story states. → null when there is
 * nothing to add or the file cannot be read.
 */
async function endCardLogo(value, projectDir, measure) {
  const given = typeof value === "string" ? { src: value } : value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!given || typeof given.src !== "string" || !given.src.trim() || (given.tone && typeof given.clear === "boolean" && given.ratio)) return null;
  const found = await measure(path.resolve(projectDir, given.src.trim()));
  if (!found) return null;
  const measured = { ...(found.aspect ? { ratio: Math.min(12, Math.max(0.2, found.aspect)) } : {}), ...(found.tone ? { tone: found.tone } : {}), clear: found.clear === true, ...(found.box ? { box: found.box } : {}) };
  return { ...measured, ...given };
}

const IMAGE = /^assets\/.+\.(svg|png|jpe?g|webp)$/i;

/**
 * `value` (scene params, or anything inside them) with every brand-mark
 * member (`{mark: "assets/…"}` or `{mark: {src, …}}` nested in a set, see
 * kit/core/member-mark.mjs) measured like an end-card logo. A module's own
 * top-level `mark` param is not a member and is left alone. → the same value
 * when nothing changes.
 */
async function withMemberMarks(value, projectDir, measure, top = false) {
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => {
    if (key === "mark" && !top && (typeof item === "string" ? IMAGE.test(item.trim()) : typeof item?.src === "string")) {
      const logo = await endCardLogo(item, projectDir, measure);
      if (logo) { changed = true; return [key, logo]; }
      return [key, item];
    }
    const next = await withMemberMarks(item, projectDir, measure);
    if (next !== item) changed = true;
    return [key, next];
  }));
  if (!changed) return value;
  return Array.isArray(value) ? entries.map(([, item]) => item) : Object.fromEntries(entries);
}

/**
 * The story with every brand-lockup scene's untinted mark and wordmark tinted
 * to read on its backdrop (lockupTint), measured from the files. A stated
 * tint or markTint (even "none") wins. Brand-mark members in any other
 * scene are measured like an end-card logo (withMemberMarks). → the same
 * story when nothing changes.
 */
export async function withLockupTints(story, projectDir = process.cwd(), measure = measureLogoMark) {
  const scenes = Array.isArray(story?.scenes) ? story.scenes : [];
  let changed = false;
  const next = await Promise.all(scenes.map(async (scene) => {
    if (scene?.module === "end-card") {
      const logo = await endCardLogo(scene.params?.logo, projectDir, measure);
      if (!logo) return scene;
      changed = true;
      return { ...scene, params: { ...scene.params, logo } };
    }
    if (scene?.module !== "brand-lockup") {
      const params = await withMemberMarks(scene?.params, projectDir, measure, true);
      if (params === scene?.params) return scene;
      changed = true;
      return { ...scene, params };
    }
    if (!scene.params || typeof scene.params !== "object") return scene;
    const params = { ...scene.params };
    let tinted = false;
    const src = (value) => (typeof value === "string" ? value : value?.src);
    for (const [image, key] of [["mark", "markTint"], ["wordmark", "tint"]]) {
      const file = src(params[image]);
      if (params[key] !== undefined || typeof file !== "string" || !file.trim()) continue;
      const tint = lockupTint(await measure(path.resolve(projectDir, file.trim())), frameBackdrop(scene, story));
      if (tint) { params[key] = tint; tinted = changed = true; }
    }
    return tinted ? { ...scene, params } : scene;
  }));
  return changed ? { ...story, scenes: next } : story;
}
