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
import { captionOptions, captionPlan, captionsOverlayOf, chunksForCaptions } from "../kit/core/captions.mjs";
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
  const plan = captionPlan(chunks, overlay, { brand: story.brand, format, story, hide });
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
    const plate = /lc-cap-legible/.test(node.cls) ? o.legiblePlate : /lc-cap-plate/.test(node.cls) ? o.colors.plate : null;
    lines.push({ id: node.id, text: words, chars: words.replace(/\s+/g, "").length, start, end, time: Math.max(start, time), colors: [colors.idle, colors.active, colors.spoken, colors.accent].filter(Boolean), plated, plate });
  }
  return { plan, lines, options: o };
}

/** The caption band in canvas px, a little taller than the plan's band so a line that wraps stays inside. */
export function captionBandRect(options, format) {
  const W = Number(format.width), H = Number(format.height);
  const b = options.band;
  const pad = 0.04 * H;
  return { x: Math.round(b.left * W), y: Math.round(options.bandTop * H - pad), width: Math.round((1 - b.left - b.right) * W), height: Math.round(b.height * H + 2 * pad) };
}

/**
 * Legibility of one line in a decoded frame (canvas-sized RGBA image).
 * → {found, contrast, camouflage, legible}
 */
export function lineLegibility(image, rect, colors, { size = 74, chars = 0, plate = null } = {}) {
  const L = CAPTION_LEGIBILITY;
  // On a plate, a preset colour close to the plate's own (a light active
  // colour on a light plate) is the plate, not the text.
  const plateRgb = plate ? hexRgb(plate) : null;
  const text = colors.map(hexRgb).filter((color, i) => i === 0 || !plateRgb || distance(color, plateRgb) >= L.textDistance);
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y), x1 = Math.min(image.width, rect.x + rect.width), y1 = Math.min(image.height, rect.y + rect.height);
  const at = (x, y) => { const o = (y * image.width + x) * 4; return [image.pixels[o], image.pixels[o + 1], image.pixels[o + 2]]; };
  const near = (p) => Math.min(...text.map((c) => distance(p, c)));
  if (plateRgb) {
    const onPlate = plateLegibility(image, { x0, y0, x1, y1 }, plateRgb, text, { at, near, size, chars });
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
 * A plated line: the text against its own plate. The plate is found by its
 * colour inside the band; inside it, the glyphs must be there and reach the
 * contrast floor against the plate. → result | null (no plate in the band:
 * judge it like any other line).
 */
function plateLegibility(image, band, plateRgb, text, { at, near, size, chars }) {
  const L = CAPTION_LEGIBILITY;
  const xs = [], ys = [];
  for (let y = band.y0; y < band.y1; y += 2) for (let x = band.x0; x < band.x1; x += 2) if (distance(at(x, y), plateRgb) < 40) { xs.push(x); ys.push(y); }
  const expectedArea = chars * 0.55 * size * size * 0.6 / 4;
  if (xs.length < expectedArea / 3) return null;
  const pct = (list, q) => { const sorted = [...list].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]; };
  const box = { x0: pct(xs, 0.03), x1: pct(xs, 0.97), y0: pct(ys, 0.03), y1: pct(ys, 0.97) };
  const main = text[0];
  let glyphs = 0;
  const contrasts = [];
  for (let y = box.y0; y <= box.y1; y += 2) for (let x = box.x0; x <= box.x1; x += 2) {
    const p = at(x, y);
    if (near(p) < L.textDistance) glyphs += 1;
    else if (near(p) > L.backgroundDistance) contrasts.push(contrast(main, p));
  }
  if (glyphs < chars * 0.55 * size * size * 0.1 / 4 / 3) return { found: false, contrast: null, camouflage: null, legible: null };
  const worst = contrasts.length ? pct(contrasts, 0.25) : 1;
  return { found: true, contrast: round(worst), camouflage: 0, legible: worst >= L.contrast, onPlate: true, box: { x: box.x0, y: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 } };
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
  const rect = captionBandRect(options, format);
  const out = [];
  for (const line of lines) {
    const image = await frame(video, line.time, format);
    out.push({ id: line.id, text: line.text, time: line.time, plated: line.plated, ...lineLegibility(image, rect, line.colors, { size: options.size, chars: line.chars, plate: line.plate }) });
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
  const band = captionBandRect(options, story.format);
  // Characters and media under the band (a card in the band is already a layout collision).
  const busy = elements.filter((element) => element.role === "media" && element.rect && element.id !== "base");
  return lines.filter((line) => busy.some((element) => element.start < line.end && element.end > line.start && overlaps(element.rect, band))).map((line) => line.id);
}

/** The plates an overlay should carry: predicted and measured ids, merged and sorted. */
export function mergePlates(...lists) {
  return [...new Set(lists.flat().filter((id) => typeof id === "string"))].sort();
}

export { captionOptions };
