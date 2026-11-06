// The overlay talking head (`make --layout overlay`): one continuous take of
// the presenter, full frame, never cut away from. The graphics live in the
// free space around them: a structure that builds above their head, props
// beside them or in front of their chest, some behind them through the
// subject matte (scene layer "behind"), a title in the headroom, and a small
// word caption at chest height.
//
// applyOverlayLayout turns the plan into that: inserts become overlays (the
// take never cuts), one full section holds the whole video so the captions
// sit at the chest, and every overlay without a rect is placed in a free zone
// (freeZones, from the presenter's head). overlayLayoutErrors checks it.

import { captionBandFor } from "@launchclip/core/captions.mjs";
import { DEFAULT_HEAD } from "@launchclip/core/footage-layout.mjs";
import { catalogModules, moduleFit } from "@launchclip/core/modules.mjs";
import { DEFAULT_BRAND } from "@launchclip/core/planning-prompt.mjs";
import { profileGeometry } from "@launchclip/core/layout-check.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { presenterHead } from "./presenter_box.js";

// Where an overlay story's captions go: one word at a time, at the chest.
export const OVERLAY_CAPTIONS = Object.freeze({ position: "chest", preset: "seam-word", max_words: 1 });
export const OVERLAY = Object.freeze({
  // The body is about this many head-widths wide around the head's middle.
  bodyWidths: 2.6,
  // A zone narrower or shorter than this share of the canvas takes no graphic.
  minZone: Object.freeze({ width: 0.22, height: 0.08 }),
  // Zones are used in this order, round and round, for overlays with no rect.
  order: Object.freeze(["above", "front", "right", "left"]),
  // An overlay may cover this share of the face before a warning.
  faceOverlap: 0.1
});

const EPS = 1e-6;
const round = (value) => Math.round(value);

/** Planner instructions for an overlay run. */
export function overlayPrompt() {
  return [
    "## Overlay talking head (this run)",
    "",
    "The presenter's take plays full frame from the first word to the last and is never cut away from: no insert scenes, no sections (tooling turns any insert into an overlay). Every graphic lives in the free space around them: above their head, beside them, or in front of their chest.",
    "- Build ONE structure across the video: a checklist, process-steps or paper-stack scene that runs over most of the video and gains a row as each part is said (the document that grows above their head). Put `layer: \"behind\"` on it when it should sit behind them (their head covers its lower edge).",
    "- Open with a title in the headroom: a motion-title (variant soft-blur-in or focus-blur-resolve) with one highlighted word, 3–6 words.",
    "- Each idea gets a prop beside them or between their hands: a count-up or stat-card for a number, a cell-grid for a count (\"1,000 comments\"), a social-stack for comments or people, an icon-row for a choice. Keep props small and off the face; tooling places them in the free zones.",
    "- Captions are one small word at a time at chest height; keep props clear of the chest band.",
    "- Track 1 or higher for every graphic; no punch-in more often than every 6 s (the take should feel continuous)."
  ].join("\n");
}

/**
 * The free space around the presenter over timeline [start, end], inside the
 * profile's safe zone: {above, front, left, right} rects (px; null where
 * there is no room) and the face and body boxes they were cut from. above is
 * the headroom; front is in front of their hands, under the chest caption;
 * left and right are beside their body. With no subject data the head is
 * kit/core/footage-layout.mjs DEFAULT_HEAD.
 */
export function freeZones(story, start = 0, end = start) {
  const canvas = { width: Number(story?.format?.width), height: Number(story?.format?.height) };
  const { safeZone, captionBand } = profileGeometry(canvas);
  const head = presenterHead(story, start, end) ?? DEFAULT_HEAD(canvas);
  const gap = Math.round(0.03 * Math.min(canvas.width, canvas.height));
  const centre = head.x + head.width / 2;
  const half = (head.width * OVERLAY.bodyWidths) / 2;
  const body = { x: round(centre - half), y: round(head.y), width: round(2 * half), height: round(canvas.height - head.y) };
  const top = safeZone.y, bottom = Math.min(safeZone.y + safeZone.height, captionBand.y) - gap;
  const fits = (rect) => rect.width >= OVERLAY.minZone.width * canvas.width - EPS && rect.height >= OVERLAY.minZone.height * canvas.height - EPS;
  const zone = (x0, y0, x1, y1) => {
    const rect = { x: round(x0), y: round(y0), width: round(x1 - x0), height: round(y1 - y0) };
    return rect.width > 0 && rect.height > 0 && fits(rect) ? rect : null;
  };
  // Under the chest caption (kit/core/footage-layout.mjs chestZone) to the safe zone's bottom.
  const chestBottom = head.y + head.height * 1.6 + captionBandFor(canvas).height * canvas.height / 2;
  return {
    face: head,
    body,
    above: zone(safeZone.x, top, safeZone.x + safeZone.width, head.y - gap),
    front: zone(Math.max(safeZone.x, body.x), chestBottom + gap, Math.min(safeZone.x + safeZone.width, body.x + body.width), safeZone.y + safeZone.height),
    left: zone(safeZone.x, head.y, body.x - gap, bottom),
    right: zone(body.x + body.width + gap, head.y, safeZone.x + safeZone.width, bottom)
  };
}

// A module tooling can place: an editorial module (every one takes a rect) or
// a catalogue module with a rect param. Camera moves (punch-in) and modules
// that place themselves around the subject are left alone.
function placeable(scene) {
  if (!scene?.module || scene.module === "checklist") return false;
  const definition = catalogModules()[scene.module];
  if (!definition) return true;
  if (definition.needs?.includes("subject")) return false;
  return Object.hasOwn(definition.params ?? {}, "rect");
}

// The rect a scene takes in a zone: the zone's width and the least height the
// module needs there (moduleFit), against the head (above: its bottom edge;
// elsewhere: its top edge), or null when the module needs more than the zone.
function fitInZone(scene, story, zone, key) {
  if (!story) return zone;
  let fit;
  try { fit = moduleFit({ ...scene, params: { ...(scene.params ?? {}), rect: zone } }, story, { width: zone.width }); } catch { return null; }
  if (fit.minHeight === null || fit.minHeight > zone.height + EPS) return null;
  const height = Math.min(zone.height, Math.max(fit.minHeight, Math.round(zone.height * 0.6)));
  return { x: zone.x, y: key === "above" ? zone.y + zone.height - height : zone.y, width: zone.width, height };
}

/**
 * The storyboard laid out for the overlay layout. options: {words, beats,
 * duration}. → {storyboard, changed: [..], skipped: reason | null}
 */
export function applyOverlayLayout(storyboard, { words = [], beats = null, duration = null } = {}) {
  if (!storyboard || storyboard.lane !== "footage-led") return { storyboard, changed: [], skipped: "the overlay layout needs a footage-led (talking-head) story" };
  const total = Number(duration ?? storyboard.format?.duration);
  if (!(total > 0)) return { storyboard, changed: [], skipped: "the story has no duration" };
  const copy = structuredClone(storyboard);
  const changed = [];
  // The take never cuts: an insert becomes an overlay.
  for (const scene of copy.scenes ?? []) {
    if (scene?.insert !== true) continue;
    delete scene.insert;
    scene.track = 1;
    changed.push(`insert ${scene.id} became an overlay (the take is never cut away from)`);
  }
  if (Array.isArray(storyboard.sections) && storyboard.sections.some((section) => section?.layout !== "full")) changed.push("sections replaced by one full-frame take");
  copy.sections = [{ id: "take", start: 0, end: total, layout: "full", transition: { type: "cut" } }];
  // Overlays with no rect go to the free zones in turn.
  let resolved = null;
  // Module sizes are measured on the resolved story (with a brand to draw in).
  try { resolved = resolveStory(structuredClone({ ...copy, brand: copy.brand ?? DEFAULT_BRAND }), { words, beats }); } catch { resolved = null; }
  const times = new Map((resolved?.scenes ?? []).map((scene) => [scene.id, scene]));
  let turn = 0;
  for (const scene of copy.scenes ?? []) {
    if (!scene || !(Number(scene.track) >= 1) || scene.params?.rect !== undefined || !placeable(scene)) continue;
    const time = times.get(scene.id);
    const zones = freeZones(resolved ?? copy, Number(time?.start ?? 0), Number(time?.end ?? time?.start ?? 0));
    const order = OVERLAY.order.map((_, index) => OVERLAY.order[(turn + index) % OVERLAY.order.length]);
    const placed = order.map((key) => ({ key, rect: zones[key] && fitInZone(time ?? scene, resolved, zones[key], key) })).find((entry) => entry.rect);
    if (!placed) { changed.push(`${scene.id} kept its own placement: no free zone around the presenter is big enough for it`); continue; }
    scene.params = { ...(scene.params ?? {}), rect: placed.rect };
    turn += 1;
    changed.push(`${scene.id} placed ${placed.key === "above" ? "above the presenter" : placed.key === "front" ? "in front of the presenter" : `to the presenter's ${placed.key}`}`);
  }
  const captions = (Array.isArray(copy.overlays) ? copy.overlays : []).find((overlay) => overlay?.type === "captions");
  if (captions) {
    if (captions.position !== OVERLAY_CAPTIONS.position) changed.push(`captions moved to the ${OVERLAY_CAPTIONS.position} (was ${captions.position ?? "auto"})`);
    delete captions.style;
    Object.assign(captions, OVERLAY_CAPTIONS);
  }
  return { storyboard: copy, changed, skipped: null };
}

/**
 * The overlay layout's rules, as repair errors ("overlay: …") and warnings:
 * no inserts, one full-frame take, captions at the chest; an overlay over the
 * face (not behind the presenter) is a warning. story: the storyboard, with
 * resolved times where the face check should run.
 */
export function overlayLayoutErrors(storyboard) {
  const errors = [], warnings = [];
  for (const scene of storyboard?.scenes ?? []) if (scene?.insert === true) errors.push(`overlay: scene ${scene.id} cuts away from the take (insert); show it as an overlay beside the presenter`);
  if ((storyboard?.sections ?? []).some((section) => section?.layout !== "full")) errors.push("overlay: the take holds the full frame; remove the footage-layout sections");
  const captions = (storyboard?.overlays ?? []).find((overlay) => overlay?.type === "captions");
  if (captions && captions.position !== OVERLAY_CAPTIONS.position) errors.push(`overlay: the captions sit at "${captions.position ?? "auto"}"; an overlay story puts them at the ${OVERLAY_CAPTIONS.position}`);
  for (const scene of storyboard?.scenes ?? []) {
    const rect = scene?.params?.rect;
    if (!rect || scene.layer === "behind" || typeof scene.start !== "number") continue;
    const face = presenterHead(storyboard, scene.start, typeof scene.end === "number" ? scene.end : scene.start);
    if (!face) continue;
    const w = Math.min(rect.x + rect.width, face.x + face.width) - Math.max(rect.x, face.x);
    const h = Math.min(rect.y + rect.height, face.y + face.height) - Math.max(rect.y, face.y);
    if (w > 0 && h > 0 && (w * h) / (face.width * face.height) > OVERLAY.faceOverlap) warnings.push(`overlay: ${scene.id} covers ${Math.round((100 * w * h) / (face.width * face.height))}% of the presenter's face; move it to a free zone or set layer "behind"`);
  }
  return { errors, warnings };
}
