// Swipe continuity for carousels (docs/CAROUSELS_RFC.md §6.1): what each
// slide draws so the carousel reads as one wide canvas when the slides sit
// side by side. Both renderers draw the boxes this module returns; it has no I/O.
//
//   carousel.seams: [{after, kind, x, y, w, h, color?, text?}]
//     An element laid across the seam after slide `after` (a scene id). x and
//     w are in slide widths from the seam (x < 0 < x + w: it crosses it), y
//     and h in slide heights. kind: "word" (text set h tall from x, y),
//     "rule" (a filled bar; a thin one is a line), "card" (a rounded bar),
//     "circle" (the ellipse in the box). color: a brand colour role or #hex.
//   carousel.panorama: {src, slides: [from, to], reading?}
//     One plate laid over slides from..to (1-based, inclusive): it covers
//     (to - from + 1) × width by height once and each slide shows its slice.
//     reading: a reading gradient (kit/core/reading-gradient.mjs) over each
//     slide's slice, in the brand's colours; it runs top to bottom, so the
//     slices still meet at every seam.
//
// The carry mapping (kit/core/carry.mjs) between two slides is a fixed offset
// of one slide width, so each element is placed once on the pair's canvas in
// whole pixels and each slide draws it shifted by its own whole-pixel offset:
// the two halves meet exactly at the seam.

import { readingGradient, readingGradientErrors } from "./reading-gradient.mjs";

export const SEAM_KINDS = Object.freeze(["word", "rule", "card", "circle"]);
const SEAM_KEYS = ["after", "kind", "x", "y", "w", "h", "color", "text"];
const HEX = /^#[0-9a-f]{6}$/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const num = (value) => typeof value === "number" && Number.isFinite(value);
const slidesOf = (story) => (Array.isArray(story?.scenes) ? story.scenes : []).filter(isObject);

/** Errors in carousel.seams and carousel.panorama; [] when neither is set. */
export function continuityProblems(story) {
  const carousel = story?.carousel;
  if (!isObject(carousel)) return [];
  const errors = [];
  const ids = slidesOf(story).map((scene) => scene.id);
  if (carousel.seams !== undefined) {
    if (!Array.isArray(carousel.seams)) errors.push("carousel.seams must be a list of {after, kind, x, y, w, h, color?, text?}");
    else carousel.seams.forEach((seam, i) => {
      const at = `carousel.seams[${i}]`;
      if (!isObject(seam)) { errors.push(`${at} must be {after, kind, x, y, w, h, color?, text?}`); return; }
      for (const key of Object.keys(seam)) if (!SEAM_KEYS.includes(key)) errors.push(`${at}.${key} is not a seam field (${SEAM_KEYS.join(", ")})`);
      const index = ids.indexOf(seam.after);
      if (index === -1 || index === ids.length - 1) errors.push(`${at}.after must be the id of a slide that has a slide after it`);
      if (!SEAM_KINDS.includes(seam.kind)) errors.push(`${at}.kind must be one of ${SEAM_KINDS.join(", ")}`);
      if (!["x", "y", "w", "h"].every((key) => num(seam[key])) || seam.w <= 0 || seam.h <= 0) errors.push(`${at} needs numbers x, y, w > 0 and h > 0 (x, w in slide widths from the seam; y, h in slide heights)`);
      else if (!(seam.x < 0 && seam.x + seam.w > 0)) errors.push(`${at} must cross the seam: x < 0 < x + w`);
      else if (seam.x < -1 || seam.x + seam.w > 1) errors.push(`${at} must stay on its two slides: -1 ≤ x and x + w ≤ 1`);
      if (seam.kind === "word" && !(typeof seam.text === "string" && seam.text.trim())) errors.push(`${at} is a word, so it needs text`);
      if (seam.color !== undefined && !(typeof seam.color === "string" && (HEX.test(seam.color) || /^[a-z]+$/.test(seam.color)))) errors.push(`${at}.color must be a brand colour role or #rrggbb`);
    });
  }
  const pano = carousel.panorama;
  if (pano !== undefined) {
    if (!isObject(pano)) errors.push("carousel.panorama must be {src, slides: [from, to], reading?}");
    else {
      for (const key of Object.keys(pano)) if (!["src", "slides", "reading"].includes(key)) errors.push(`carousel.panorama.${key} is not a panorama field (src, slides, reading)`);
      if (pano.reading !== undefined) errors.push(...readingGradientErrors(pano.reading, "carousel.panorama.reading"));
      if (!(typeof pano.src === "string" && pano.src.trim())) errors.push("carousel.panorama.src must be the plate's path in the project (assets/…)");
      const [from, to] = Array.isArray(pano.slides) ? pano.slides : [];
      if (!(Array.isArray(pano.slides) && pano.slides.length === 2 && Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to > from && to <= ids.length)) errors.push(`carousel.panorama.slides must be [from, to], slide numbers 1 to ${ids.length} with from < to`);
    }
  }
  return errors;
}

const colorOf = (value, brand, fallback) => (HEX.test(String(value)) ? value : brand?.colors?.[value] ?? brand?.colors?.[fallback] ?? "#000000");

/**
 * Where a seam element sits on its pair's canvas (two slides side by side, the
 * seam at x = width), in whole px. Each slide draws it at left - offset, where
 * offset is 0 for the left slide and width for the right one.
 */
export function seamBox(seam, width, height) {
  const left = Math.round(width + seam.x * width);
  const top = Math.round(seam.y * height);
  return { left, top, width: Math.round(width + (seam.x + seam.w) * width) - left, height: Math.round((seam.y + seam.h) * height) - top };
}

/**
 * The panorama's slice for slide `index` (0-based): the plate is laid over
 * span × width by height and the slide shows [offset, offset + width).
 */
export function panoramaSlice(panorama, index, width, height) {
  const [from, to] = panorama.slides;
  if (index < from - 1 || index > to - 1) return null;
  return { src: panorama.src, offset: (index - (from - 1)) * width, width: (to - from + 1) * width, height };
}

/**
 * What one slide draws for continuity: {panorama, seams} or null.
 * panorama: {src, left, width, height, reading?} for an <img> with object-fit
 * cover, reading the CSS background of a layer over it;
 * seams: [{kind, text?, style}] with style a CSS property map in px.
 */
export function slideContinuity(story, sceneId) {
  const carousel = story?.carousel;
  if (!isObject(carousel) || story?.format?.kind !== "carousel") return null;
  const ids = slidesOf(story).map((scene) => scene.id);
  const index = ids.indexOf(sceneId);
  if (index === -1) return null;
  const { width, height } = story.format;
  const slice = isObject(carousel.panorama) ? panoramaSlice(carousel.panorama, index, width, height) : null;
  const seams = [];
  for (const seam of Array.isArray(carousel.seams) ? carousel.seams : []) {
    const at = ids.indexOf(seam.after);
    if (at !== index && at + 1 !== index) continue;
    const box = seamBox(seam, width, height);
    const color = colorOf(seam.color, story.brand, seam.kind === "word" ? "ink" : "primary");
    const style = { position: "absolute", left: `${box.left - (at === index ? 0 : width)}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` };
    if (seam.kind === "word") Object.assign(style, { color, fontFamily: "var(--lc-font-display)", fontSize: `${box.height}px`, fontWeight: "800", lineHeight: "1", letterSpacing: "-0.02em", whiteSpace: "nowrap", width: "auto" });
    else Object.assign(style, { background: color, borderRadius: seam.kind === "circle" ? "50%" : seam.kind === "card" ? `${Math.round(Math.min(box.width, box.height) * 0.08)}px` : "0" });
    seams.push({ kind: seam.kind, text: seam.kind === "word" ? seam.text : undefined, style });
  }
  if (!slice && !seams.length) return null;
  const reading = slice && isObject(carousel.panorama.reading) ? readingGradient(carousel.panorama.reading, story.brand?.colors ?? {}) : null;
  return { panorama: slice ? { src: slice.src, left: -slice.offset, width: slice.width, height: slice.height, ...(reading ? { reading } : {}) } : null, seams };
}

/** True when a seam element or the panorama crosses from slide `index` (0-based) into the next. */
export function crossesSeam(story, index) {
  const carousel = story?.carousel;
  if (!isObject(carousel)) return false;
  const ids = slidesOf(story).map((scene) => scene.id);
  const [from, to] = Array.isArray(carousel.panorama?.slides) ? carousel.panorama.slides : [];
  return (Array.isArray(carousel.seams) && carousel.seams.some((seam) => seam?.after === ids[index])) || (index >= from - 1 && index < to - 1);
}

/** A style map as inline CSS (HyperFrames markup). */
export const cssText = (style) => Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${value}`).join(";");
