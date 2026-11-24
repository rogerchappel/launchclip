// Carousels and single-image posts (docs/CAROUSELS_RFC.md): a story whose
// scenes are slides. This module is the contract every carousel stage shares:
// the slide fields, the arcs, the destinations and when each slide's still is
// taken. It has no I/O.

import { CAROUSEL_TEMPLATE_IDS } from "./carousel-templates.mjs";
import { continuityProblems } from "./carousel-continuity.mjs";

export const CAROUSEL_ROLES = Object.freeze(["cover", "body", "payoff", "cta"]);
export const CAROUSEL_MEDIA = Object.freeze(["still", "motion"]);
export const CAROUSEL_GOALS = Object.freeze(["save", "comment", "follow", "visit", "install"]);
// carousel.background: a generated background under the slides' reading layer (one shared, one per slide, or none).
export const CAROUSEL_BACKGROUND_MODES = Object.freeze(["shared", "per-slide", "none"]);

// slides: [min, max] the arc expects; payoff: the arc promises a list, steps or
// data, so it needs a payoff slide (RFC §5.2, §6 `payoff`).
export const CAROUSEL_ARCS = Object.freeze({
  listicle: { slides: [4, 12], payoff: true, describe: "cover (the number and the promise), one item per slide, a summary to save, cta" },
  "how-to": { slides: [4, 12], payoff: true, describe: "cover (the result), one step per slide, the finished result, cta" },
  "myth-fact": { slides: [3, 10], payoff: false, describe: "cover, a myth then its fact per slide, cta" },
  "before-after": { slides: [4, 7], payoff: true, describe: "cover, the before, what changed, the after, the proof, cta" },
  story: { slides: [3, 12], payoff: true, describe: "cover (the moment), photos or illustrations with one line each, the lesson, cta" },
  data: { slides: [3, 10], payoff: true, describe: "cover (the surprising number), one chart or stat per slide, what it means, cta" },
  ad: { slides: [2, 5], payoff: false, describe: "the problem, the product doing it, proof, the offer" },
  quote: { slides: [1, 6], payoff: false, describe: "one slide, or a short series by one person" },
  single: { slides: [1, 1], payoff: false, describe: "one slide" }
});
export const CAROUSEL_ARC_IDS = Object.freeze(Object.keys(CAROUSEL_ARCS));

// shortcut: platform limits and safe zones are from public guidance as of
// 2026-11 (RFC §8, §14), not the platforms' own docs; check them before relying
// on a figure. safe: px each side keeps clear of text at the canvas size, as a
// production carousel system sets them (4:5 feeds 96/72/96/72, 1:1 72 all
// round, TikTok 180 top and 240 bottom over its caption and buttons).
// captionPreview: characters shown before the caption is cut ("… more").
export const CAROUSEL_DESTINATIONS = Object.freeze({
  instagram: { aspect: "4:5", width: 1080, height: 1350, slides: [1, 20], motion: true, exports: ["png", "mp4"], captionPreview: 125, tags: true, safe: { top: 96, right: 72, bottom: 96, left: 72 } },
  tiktok: { aspect: "9:16", width: 1080, height: 1920, slides: [1, 35], motion: false, exports: ["jpg"], captionPreview: 90, tags: true, safe: { top: 180, right: 72, bottom: 240, left: 72 } },
  linkedin: { aspect: "4:5", width: 1080, height: 1350, slides: [1, 300], motion: false, exports: ["pdf", "png"], captionPreview: 210, tags: false, safe: { top: 96, right: 72, bottom: 96, left: 72 } },
  facebook: { aspect: "4:5", width: 1080, height: 1350, slides: [1, 10], motion: true, exports: ["png", "mp4"], captionPreview: 125, tags: false, safe: { top: 96, right: 72, bottom: 96, left: 72 } },
  "meta-ads": { aspect: "1:1", width: 1080, height: 1080, slides: [2, 10], motion: true, exports: ["png", "mp4", "cards"], captionPreview: 125, tags: false, safe: { top: 72, right: 72, bottom: 72, left: 72 } },
  x: { aspect: "4:5", width: 1080, height: 1350, slides: [1, 4], motion: true, exports: ["png", "mp4"], captionPreview: 280, tags: false, safe: { top: 96, right: 72, bottom: 96, left: 72 } },
  threads: { aspect: "4:5", width: 1080, height: 1350, slides: [1, 20], motion: true, exports: ["png", "mp4"], captionPreview: 150, tags: false, safe: { top: 96, right: 72, bottom: 96, left: 72 } }
});
export const CAROUSEL_DESTINATION_IDS = Object.freeze(Object.keys(CAROUSEL_DESTINATIONS));

// A still slide's scene runs SLIDE_SECONDS by default; its still is taken
// SETTLE_MARGIN before the scene ends: after every entrance (a cascade is over
// within two seconds, DIRECTION_GUARDRAILS §8) and before any exit (≤ 0.3 s
// in every grammar). slide.still_at (seconds into the scene) overrides it.
export const SLIDE_SECONDS = 4;
export const SETTLE_MARGIN = 0.75;
// A motion slide is its own short clip (RFC §5.3): 2 to 10 s, SLIDE_SECONDS
// (4) unless what happens in it needs other. loop: true makes it a seamless
// loop; without it the clip plays once and ends on a settled frame.
export const MOTION_SLIDE_SECONDS = Object.freeze([2, 10]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;

export const isCarousel = (story) => isObject(story?.format) && story.format.kind === "carousel";
export const carouselSlides = (story) => (Array.isArray(story?.scenes) ? story.scenes : []).filter((scene) => isObject(scene));

/** Errors in a carousel story's slide fields; [] for a story that is not a carousel. */
export function carouselProblems(story) {
  if (!isObject(story?.format) || story.format.kind === undefined) return [];
  const errors = [];
  const err = (message) => errors.push(message);
  if (story.format.kind !== "carousel") { err('format.kind must be "carousel" or left out (a video)'); return errors; }
  const carousel = story.carousel;
  if (!isObject(carousel)) err("carousel must be {arc, goal?, caption?, destinations?, seams?, panorama?, template?, background?, density?}");
  const arc = isObject(carousel) ? carousel.arc : undefined;
  if (isObject(carousel)) {
    for (const key of Object.keys(carousel)) if (!["arc", "goal", "caption", "destinations", "seams", "panorama", "template", "background", "density"].includes(key)) err(`carousel.${key} is not a carousel field (arc, goal, caption, destinations, seams, panorama, template, background, density)`);
    if (!CAROUSEL_ARC_IDS.includes(arc)) err(`carousel.arc must be one of ${CAROUSEL_ARC_IDS.join(", ")}`);
    if (carousel.density !== undefined && carousel.density !== "detailed") err('carousel.density must be "detailed" or left out');
    if (carousel.goal !== undefined && !CAROUSEL_GOALS.includes(carousel.goal)) err(`carousel.goal must be one of ${CAROUSEL_GOALS.join(", ")}`);
    if (carousel.caption !== undefined) {
      if (!isObject(carousel.caption)) err("carousel.caption must be {hook, body?, cta?, tags?}");
      else {
        for (const key of Object.keys(carousel.caption)) if (!["hook", "body", "cta", "tags"].includes(key)) err(`carousel.caption.${key} is not a caption field (hook, body, cta, tags)`);
        for (const key of ["hook", "body", "cta"]) if (carousel.caption[key] !== undefined && typeof carousel.caption[key] !== "string") err(`carousel.caption.${key} must be a string`);
        if (carousel.caption.tags !== undefined && !(Array.isArray(carousel.caption.tags) && carousel.caption.tags.every(nonEmpty))) err("carousel.caption.tags must be a list of non-empty strings");
      }
    }
    if (carousel.template !== undefined && !CAROUSEL_TEMPLATE_IDS.includes(carousel.template)) err(`carousel.template must be one of ${CAROUSEL_TEMPLATE_IDS.join(", ")}`);
    if (carousel.destinations !== undefined && !(Array.isArray(carousel.destinations) && carousel.destinations.length && carousel.destinations.every((id) => CAROUSEL_DESTINATION_IDS.includes(id)))) err(`carousel.destinations must be a non-empty list of ${CAROUSEL_DESTINATION_IDS.join(", ")}`);
  }
  const slides = carouselSlides(story);
  slides.forEach((scene, i) => {
    const path = `scenes[${i}].slide`;
    const slide = scene.slide;
    if (!isObject(slide)) { err(`${path} must be {role, medium, alt, still_at?}`); return; }
    for (const key of Object.keys(slide)) if (!["role", "medium", "alt", "still_at"].includes(key)) err(`${path}.${key} is not a slide field (role, medium, alt, still_at)`);
    if (!CAROUSEL_ROLES.includes(slide.role)) err(`${path}.role must be one of ${CAROUSEL_ROLES.join(", ")}`);
    if (!CAROUSEL_MEDIA.includes(slide.medium)) err(`${path}.medium must be one of ${CAROUSEL_MEDIA.join(", ")}`);
    if (slide.alt !== undefined && typeof slide.alt !== "string") err(`${path}.alt must be a string describing the slide`);
    const length = Number(scene.end) - Number(scene.start);
    if (slide.still_at !== undefined && !(typeof slide.still_at === "number" && slide.still_at >= 0 && (!Number.isFinite(length) || slide.still_at < length))) err(`${path}.still_at must be seconds into the slide, before it ends`);
    if (slide.medium === "motion") {
      if (Number.isFinite(length) && (length < MOTION_SLIDE_SECONDS[0] || length > MOTION_SLIDE_SECONDS[1])) err(`scenes[${i}] is a motion slide of ${length} s; motion slides run ${MOTION_SLIDE_SECONDS[0]} to ${MOTION_SLIDE_SECONDS[1]} s`);
    }
    if (scene.in !== undefined && scene.in?.type !== "cut") err(`scenes[${i}].in must be {type: "cut"} or left out: each slide is shown on its own`);
  });
  const roles = slides.map((scene) => scene.slide?.role);
  if (slides.length && roles[0] !== "cover") err("the first slide must be the cover (slide.role \"cover\")");
  if (roles.filter((role) => role === "cover").length > 1) err("a carousel has one cover");
  const cta = roles.indexOf("cta");
  if (cta !== -1 && (cta !== roles.length - 1 || roles.lastIndexOf("cta") !== cta)) err("the cta slide must be the last slide, and there is at most one");
  if (CAROUSEL_ARCS[arc]) {
    const [min, max] = CAROUSEL_ARCS[arc].slides;
    if (slides.length < min || slides.length > max) err(`a ${arc} carousel has ${min === max ? min : `${min} to ${max}`} slide${max === 1 ? "" : "s"}; this one has ${slides.length}`);
    if (CAROUSEL_ARCS[arc].payoff && slides.length > 2 && !roles.includes("payoff")) err(`a ${arc} carousel promises a list, steps or data, so it needs a payoff slide (slide.role "payoff")`);
  }
  // Swipe continuity: seams and the panorama (kit/core/carousel-continuity.mjs, RFC §6.1).
  errors.push(...continuityProblems(story));
  // The generated background (carousel make --background): what was asked for; the files are the slides' plates.
  const background = isObject(carousel) ? carousel.background : undefined;
  if (background !== undefined && !(isObject(background) && CAROUSEL_BACKGROUND_MODES.includes(background.mode) && Object.keys(background).every((key) => ["mode", "shows"].includes(key)) && (background.shows === undefined || nonEmpty(background.shows)))) err(`carousel.background must be {mode: ${CAROUSEL_BACKGROUND_MODES.join(" | ")}, shows?: what it shows}`);
  return errors;
}

/**
 * Problems with sending a carousel to one destination: errors that block the
 * export, warnings the export works around (a motion slide where only images
 * go uses its still).
 */
export function destinationProblems(story, id) {
  const dest = CAROUSEL_DESTINATIONS[id];
  if (!dest) return { errors: [`unknown destination ${id}; use ${CAROUSEL_DESTINATION_IDS.join(", ")}`], warnings: [] };
  const errors = [];
  const warnings = [];
  const slides = carouselSlides(story);
  const [min, max] = dest.slides;
  if (slides.length < min || slides.length > max) errors.push(`${id} takes ${min} to ${max} slides; this carousel has ${slides.length}`);
  if (!dest.motion) slides.forEach((scene, i) => { if (scene.slide?.medium === "motion") warnings.push(`${id} takes images only, so slide ${i + 1} (${scene.id}) is sent as its still`); });
  return { errors, warnings };
}

/**
 * When each slide's still is taken: [{id, index, role, medium, at, frame}],
 * at in story seconds, frame at the story's fps. Works on a validated or a
 * resolved story (scenes with numeric start and end).
 */
export function slideStills(story) {
  const fps = Number(story?.format?.fps) || 30;
  return carouselSlides(story).map((scene, index) => {
    const start = Number(scene.start);
    const end = Number(scene.end);
    const at = typeof scene.slide?.still_at === "number" ? start + scene.slide.still_at : Math.max(start, end - SETTLE_MARGIN);
    // The last whole frame at or before `at`, and never past the scene's own last frame.
    const frame = Math.min(Math.floor(at * fps + 1e-6), Math.ceil(end * fps) - 1);
    return { id: scene.id, index, role: scene.slide?.role ?? null, medium: scene.slide?.medium ?? null, at, frame };
  });
}

/** Zero-padded slide file stem: 01, 02 … (three digits past 99). */
export const slideStem = (index, count) => String(index + 1).padStart(count > 99 ? 3 : 2, "0");
