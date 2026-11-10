// Caption legibility (docs/DIRECTION_GUARDRAILS.md §3): every caption line
// read against what is actually behind it in the render.
//
//   measureCaptionLegibility(video, story, {chunks}) → {lines, failed}
//     one frame per line, at the middle of its spoken words: the glyphs are
//     the pixels near the line's own text colours inside the caption band;
//     the background is everything else around and between them. A line
//     fails below CAPTION_LEGIBILITY.contrast (WCAG large text, at the worst
//     quarter of its background) or when more than
//     CAPTION_LEGIBILITY.camouflage of the band around it shares the text's
//     colour (teal words on a teal shirt).
//   predictCaptionPlates(story, chunks, elements) → line ids whose band
//     crosses a character or a media window at their time (the layout
//     check's element rects), plated before the first render.
//
// finish plates the predicted lines, renders, measures, plates any line
// that still fails and renders once more; the layout gate fails on a line
// that is still illegible after that.

import { spawn } from "node:child_process";
import { castCaptionZones } from "@launchclip/core/cast-captions.mjs";
import { captionOptions, captionPlan, captionZoneIndex, captionsOverlayOf, chunksForCaptions } from "@launchclip/core/captions.mjs";
import { decodePng } from "./visual_snapshot.js";
import { renderedModels } from "./direction_guardrails.js";

export const CAPTION_LEGIBILITY = Object.freeze({ contrast: 3, camouflage: 0.35, textDistance: 56, backgroundDistance: 100, found: 0.0015 });

const hexRgb = (hex) => { const v = String(hex).replace("#", ""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

function luminance([r, g, b]) {
  const c = (value) => { const s = value / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
const contrast = (a, b) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };

/** The caption plan both compilers draw, and its lines with their text colours and sample times. */
export function captionLines(story, chunks) {
  const overlay = captionsOverlayOf(story);
  if (!overlay || !chunks?.length) return { plan: null, lines: [] };
  const format = story.format;
  // Hidden as the compilers hide them: under a scene that hides captions, and overlay.hide.
  const hide = (Array.isArray(overlay.hide) ? overlay.hide : []).map((range) => [Number(range[0]), Number(range[1])]);
  try { for (const { entry, model } of renderedModels(story).entries.values()) if (model.hidesCaptions) hide.push([entry.start, entry.renderEnd]); } catch { /* unresolvable story: no scene hides */ }
  // A character story's captions sit clear of its cast (castCaptionZones), as both compilers draw them.
  const plan = captionPlan(chunks, overlay, { brand: story.brand, format, story, hide, zones: castCaptionZones(story) });
  const o = plan.options;
  // The plan's own lines: a preset with its own chunk size re-chunks the words.
  const byId = new Map(chunksForCaptions(chunks, o).map((chunk) => [chunk.id, chunk]));
  const lines = [];
  for (const node of plan.nodes) {
    if (!String(node.cls ?? "").split(" ").includes("lc-cap")) continue;
    const chunk = byId.get(node.id) ?? null;
    const words = (node.children ?? []).map((child) => child.text ?? child.children?.map((kid) => kid.text).join("") ?? "").join(" ");
    const tone = String(node.cls).match(/lc-cap-on-(\w+)/)?.[1] ?? null;
    const colors = tone && o.tones?.[tone]?.swapped ? { ...o.colors, idle: o.tones[tone].idle, accent: o.tones[tone].accent } : o.colors;
    const start = chunk ? chunk.start : null, end = chunk ? Math.max(chunk.start, chunk.words?.at(-1)?.end ?? chunk.end) : null;
    if (start === null) continue;
    const time = round(Math.min(end - 0.15, Math.max(start + 0.35, (start + end) / 2)), 3);
    const plated = /lc-cap-(plate|legible)/.test(node.cls);
    // A scrim fades into what is behind it, so the line is judged on the pixels, as an unplated one.
    const plate = /lc-cap-legible/.test(node.cls) ? (o.plateStyle === 'scrim' ? null : o.legiblePlate) : /lc-cap-plate/.test(node.cls) ? o.colors.plate : null;
    const backing = captionBacking(o, node.cls);
    lines.push({ id: node.id, text: words, chars: words.replace(/\s+/g, "").length, start, end, time: Math.max(start, time), colors: [colors.idle, colors.active, colors.spoken, colors.accent].filter(Boolean), plated, plate, backing });
  }
  return { plan, lines, options: o };
}

/**
 * What the preset draws right behind a line's words, as captionPlanCss draws
 * it: each word's chip (word "chip"), the band (layout "band"), else the
 * line's plate (the preset's own at 85%, or a card, opaque) or its legibility
 * plate (92%; a scrim fades out, so it is no backing). → {color, alpha} | null
 */
export function captionBacking(o, cls = "") {
  if (o.word === "chip" && o.colors.chip) return { color: o.colors.chip, alpha: 1 };
  if (o.layout === "band" && o.colors.band) return { color: o.colors.band, alpha: 1 };
  // A plate is one box around the whole line, centred where the plan centres
  // the line (the band's middle): its padding (em, top right bottom left, as
  // captionPlanCss draws it) and the line's type let the measurement find it
  // there (plateBoxAt).
  const line = (pad) => ({ pad, lineHeight: o.lineHeight, advance: captionAdvance(o) });
  if (/lc-cap-legible/.test(cls) && o.plateStyle !== "scrim") return { color: o.legiblePlate, alpha: 0xeb / 255, line: line([0.18, 0.5, 0.22, 0.5]) };
  if (/lc-cap-plate/.test(cls)) return o.plate === "card" ? { color: o.colors.plate, alpha: 1, line: line([0.3, 0.55, 0.38, 0.55]) } : { color: o.colors.plate, alpha: 0xd9 / 255, line: line([0.32, 0.6, 0.32, 0.6]) };
  return null;
}

// A low estimate of the em a character of the line advances: narrow enough
// that the plate box it implies never runs past the real plate.
function captionAdvance(o) {
  const spacing = Number.parseFloat(String(o.letterSpacing ?? "0")) || 0;
  return Math.max(0.3, (o.case === "upper" ? 0.56 : 0.48) + spacing);
}

/** The caption band in canvas px, a little taller than the plan's band so a line that wraps stays inside. */
export function captionBandRect(options, format) {
  const W = Number(format.width), H = Number(format.height);
  const b = options.band;
  const pad = 0.04 * H;
  return { x: Math.round(b.left * W), y: Math.round(options.bandTop * H - pad), width: Math.round((1 - b.left - b.right) * W), height: Math.round(b.height * H + 2 * pad) };
}

/**
 * Where one line is read: its caption zone (a character story's captions
 * sit clear of its cast, castCaptionZones) with the band's margin, else the
 * caption band. line: {start, end} (its spoken span).
 */
export function lineBandRect(options, format, line, zones = []) {
  const index = captionZoneIndex(zones, line.start, line.end);
  if (index < 0) return captionBandRect(options, format);
  const pad = 0.04 * Number(format.height), rect = zones[index].rect;
  return { x: Math.round(rect.x), y: Math.round(rect.y - pad), width: Math.round(rect.width), height: Math.round(rect.height + 2 * pad) };
}

/**
 * Legibility of one line in a decoded frame (canvas-sized RGBA image).
 * → {found, contrast, camouflage, legible}
 */
export function lineLegibility(image, rect, colors, { size = 74, chars = 0, plate = null, plateAlpha = 1, plateLine = null } = {}) {
  const L = CAPTION_LEGIBILITY;
  // On a plate, a preset colour close to the plate's own (a light active
  // colour on a light plate) is the plate, not the text.
  const plateRgb = plate ? hexRgb(plate) : null;
  const text = colors.map(hexRgb).filter((color, i) => i === 0 || !plateRgb || distance(color, plateRgb) >= L.textDistance);
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y), x1 = Math.min(image.width, rect.x + rect.width), y1 = Math.min(image.height, rect.y + rect.height);
  const at = (x, y) => { const o = (y * image.width + x) * 4; return [image.pixels[o], image.pixels[o + 1], image.pixels[o + 2]]; };
  const near = (p) => Math.min(...text.map((c) => distance(p, c)));
  if (plateRgb) {
    const onPlate = plateLegibility(image, { x0, y0, x1, y1 }, plateRgb, text, { at, near, size, chars, alpha: plateAlpha, line: plateLine });
    if (onPlate) return onPlate;
  }
  const xs = [], ys = [];
  let area = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    area += 1;
    if (near(at(x, y)) < L.textDistance) { xs.push(x); ys.push(y); }
  }
  // Glyphs cover about a tenth of each character's em box: fewer text-coloured
  // pixels than a third of that is not the line (it is hidden, or only an
  // outline in the drawing shares the colour). Samples are every 2 px.
  const expected = chars * 0.55 * size * size * 0.1 / 4;
  if (!area || xs.length < Math.max(area * L.found, expected / 3)) return { found: false, contrast: null, camouflage: null, legible: null };
  const pct = (list, q) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
  const box = { x0: pct(xs, 0.05), x1: pct(xs, 0.95), y0: pct(ys, 0.05), y1: pct(ys, 0.95) };
  const pad = Math.round(size * 0.3);
  const outer = { x0: Math.max(x0, box.x0 - pad), x1: Math.min(x1 - 1, box.x1 + pad), y0: Math.max(y0, box.y0 - pad), y1: Math.min(y1 - 1, box.y1 + pad) };
  const main = text[0];
  let ring = 0, ringText = 0;
  const contrasts = [];
  for (let y = outer.y0; y <= outer.y1; y += 2) for (let x = outer.x0; x <= outer.x1; x += 2) {
    const p = at(x, y);
    const d = near(p);
    const inside = x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
    if (!inside) { ring += 1; if (d < L.textDistance) ringText += 1; }
    if (d > L.backgroundDistance) contrasts.push(contrast(main, p));
  }
  const camouflage = ring ? ringText / ring : 0;
  const worst = contrasts.length ? pct(contrasts, 0.25) : 1;
  return { found: true, contrast: round(worst), camouflage: round(camouflage, 3), legible: worst >= L.contrast && camouflage <= L.camouflage, box: { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 } };
}

/**
 * A line on a backing (its plate, a legibility plate, the chips or band the
 * preset draws behind its words): the text against that backing, not the
 * floor around it. The backing is found by its colour inside the band, with
 * room for its own transparency (a plate at 85% shows a little of what is
 * behind it); inside the backing's box, the glyphs must be there, and the
 * pixels just around each glyph (a ring from 2 px to ~0.1 em out, what the
 * eye reads the letter against) must reach the contrast floor at their worst
 * quarter. → result | null (no backing in the band: judge it like any other
 * line, against what is behind it).
 */
function plateLegibility(image, band, plateRgb, text, { at, near, size, chars, alpha = 1, line = null }) {
  const L = CAPTION_LEGIBILITY;
  const tolerance = 40 + (1 - Math.max(0, Math.min(1, alpha))) * 255 * Math.sqrt(3);
  // A line plate is found where the plan puts it. Searched for by colour
  // alone, a plate the colour of the scene's own panels (a dark word chip
  // over a dark interface) spreads to the whole band, and the scene's text
  // and motion-blurred edges in it are read as the caption's.
  const pct = (list, q) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
  let box = line ? plateBoxAt(band, (x, y) => distance(at(x, y), plateRgb) < tolerance, { size, chars, line }) : null;
  if (!box) {
    const xs = [], ys = [];
    for (let y = band.y0; y < band.y1; y += 2) for (let x = band.x0; x < band.x1; x += 2) if (distance(at(x, y), plateRgb) < tolerance) { xs.push(x); ys.push(y); }
    const expectedArea = chars * 0.55 * size * size * 0.6 / 4;
    if (xs.length < expectedArea / 3) return null;
    box = { x0: pct(xs, 0.03), x1: pct(xs, 0.97), y0: pct(ys, 0.03), y1: pct(ys, 0.97) };
  }
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  if (w < 2 || h < 2) return null;
  const glyph = new Uint8Array(w * h);
  let glyphs = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (near(at(box.x0 + x, box.y0 + y)) < L.textDistance) { glyph[y * w + x] = 1; glyphs += 1; }
  if (glyphs < chars * 0.55 * size * size * 0.1 / 3) return { found: false, contrast: null, camouflage: null, legible: null };
  const inner = dilate(glyph, w, h, 1), outer = dilate(glyph, w, h, Math.max(4, Math.round(size * 0.1)));
  const main = text[0];
  const contrasts = [];
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x;
    if (!outer[i] || inner[i]) continue;
    const p = at(box.x0 + x, box.y0 + y);
    if (near(p) > L.backgroundDistance) contrasts.push(contrast(main, p));
  }
  const worst = contrasts.length ? pct(contrasts, 0.25) : 1;
  return { found: true, contrast: round(worst), camouflage: 0, legible: worst >= L.contrast, onPlate: true, box: { x: box.x0, y: box.y0, width: w - 1, height: h - 1 } };
}

/**
 * A line plate's box in the frame, found where the plan centres the line:
 * the middle of the band. Its size comes from the plan (rows of type plus the
 * plate's padding, a low estimate of the text's width) and is then measured:
 * along its padding rows and columns (glyph-free) from the middle out, as
 * far as the plate's colour runs, never past the estimate (a scene the
 * plate's own colour beside it would carry the run on). The box may fall
 * short of the plate; it never runs past it into the scene. → {x0, y0, x1, y1}
 * | null (no plate at the middle: the caller searches the band by colour).
 */
function plateBoxAt(band, isPlate, { size, chars, line }) {
  const [pt, pr, pb, pl] = line.pad.map((v) => v * size);
  const cx = Math.round((band.x0 + band.x1) / 2), cy = Math.round((band.y0 + band.y1) / 2);
  const room = band.x1 - band.x0 - pl - pr;
  const textWidth = chars * size * line.advance;
  if (room <= 0 || textWidth <= 0) return null;
  const rows = Math.max(1, Math.ceil(textWidth / room));
  let hw = (Math.min(room, textWidth) + pl + pr) / 2, hh = (rows * size * line.lineHeight + pt + pb) / 2;
  const inside = (x, y) => x >= band.x0 && x < band.x1 && y >= band.y0 && y < band.y1 && isPlate(x, y);
  // How far the plate runs from (x, y) in steps (dx, dy), up to cap px; one stray pixel (compression) does not end it.
  const run = (x, y, dx, dy, cap) => {
    let n = 0, miss = 0;
    for (let k = 1; k <= cap; k += 1) {
      if (inside(x + dx * k, y + dy * k)) { n = k; miss = 0; } else if (++miss > 1) break;
    }
    return n;
  };
  // Twice: the width from the padding rows, then the height from the padding columns.
  for (let pass = 0; pass < 2; pass += 1) {
    const rowsAt = [Math.round(cy - hh + pt * 0.5), Math.round(cy + hh - pb * 0.5)];
    if (!rowsAt.every((y) => inside(cx, y))) return null;
    const cap = Math.ceil(hw);
    hw = Math.min(...rowsAt.flatMap((y) => [run(cx, y, -1, 0, cap), run(cx, y, 1, 0, cap)]));
    if (hw < size * 0.5) return null;
    // Only a run that ended at the plate's edge puts the columns in its
    // padding; one the estimate stopped may stand on a glyph, and the plan's
    // height stands.
    if (hw >= cap) break;
    const colsAt = [Math.round(cx - hw + pl * 0.5), Math.round(cx + hw - pr * 0.5)];
    if (!colsAt.every((x) => inside(x, cy))) break;
    hh = Math.min(...colsAt.flatMap((x) => [run(x, cy, 0, -1, Math.ceil(hh)), run(x, cy, 0, 1, Math.ceil(hh))]));
    if (hh < size * 0.4) return null;
  }
  // A pixel in from each edge: the plate's anti-aliased border is not its colour.
  return { x0: Math.ceil(cx - hw + 1), x1: Math.floor(cx + hw - 1), y0: Math.ceil(cy - hh + 1), y1: Math.floor(cy + hh - 1) };
}

// A square dilation of a w × h mask by r px (separable running max).
function dilate(mask, w, h, r) {
  const rows = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    let last = -Infinity;
    for (let x = 0; x < w; x += 1) { if (mask[y * w + x]) last = x; if (x - last <= r) rows[y * w + x] = 1; }
    last = Infinity;
    for (let x = w - 1; x >= 0; x -= 1) { if (mask[y * w + x]) last = x; if (last - x <= r) rows[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x += 1) {
    let last = -Infinity;
    for (let y = 0; y < h; y += 1) { if (rows[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
    last = Infinity;
    for (let y = h - 1; y >= 0; y -= 1) { if (rows[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
  }
  return out;
}

/** One frame of a video at t (s), decoded, scaled to the canvas. */
export function videoFrame(video, t, { width, height }) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-ss", String(Math.max(0, t)), "-i", video, "-frames:v", "1", "-vf", `scale=${width}:${height}`, "-f", "image2pipe", "-vcodec", "png", "-"];
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    child.stdout.on("data", (data) => out.push(data));
    child.stderr.on("data", (data) => err.push(data));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg frame at ${t}s failed: ${Buffer.concat(err).toString().trim()}`));
      try { resolve(decodePng(Buffer.concat(out))); } catch (error) { reject(error); }
    });
  });
}

/**
 * Measure every caption line of a rendered video.
 * → {lines: [{id, text, time, plated, found, contrast, camouflage, legible}], failed: [ids]}
 */
export async function measureCaptionLegibility(video, story, { chunks, frame = videoFrame } = {}) {
  const { lines, options } = captionLines(story, chunks);
  if (!lines.length) return { lines: [], failed: [] };
  const format = { width: Number(story.format.width), height: Number(story.format.height) };
  const zones = castCaptionZones(story);
  const out = [];
  for (const line of lines) {
    const rect = lineBandRect(options, format, line, zones);
    const image = await frame(video, line.time, format);
    out.push({ id: line.id, text: line.text, time: line.time, plated: line.plated, ...(line.backing ? { backing: line.backing.color } : {}), ...lineLegibility(image, rect, line.colors, { size: options.size, chars: line.chars, plate: line.backing?.color ?? null, plateAlpha: line.backing?.alpha ?? 1, plateLine: line.backing?.line ?? null }) });
  }
  return { lines: out, failed: out.filter((line) => line.found && !line.legible).map((line) => line.id) };
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Lines to plate before the first render: those whose band crosses a
 * character (a cast scene's rect) or a card or text block at their time.
 * elements: the layout check's [{id, role, rect, start, end}].
 */
export function predictCaptionPlates(story, chunks, elements = []) {
  const { lines, options } = captionLines(story, chunks);
  if (!lines.length) return [];
  const zones = castCaptionZones(story);
  // Characters and media under the band (a card in the band is already a layout collision).
  // A photo-scene's picture (fullFrame, src/layout_check.js) is judged on the render, as before.
  const busy = elements.filter((element) => element.role === "media" && element.rect && element.id !== "base" && !element.fullFrame);
  return lines.filter((line) => { const band = lineBandRect(options, story.format, line, zones); return busy.some((element) => element.start < line.end && element.end > line.start && overlaps(element.rect, band)); }).map((line) => line.id);
}

/** The plates an overlay should carry: predicted and measured ids, merged and sorted. */
export function mergePlates(...lists) {
  return [...new Set(lists.flat().filter((id) => typeof id === "string"))].sort();
}

export { captionOptions };
