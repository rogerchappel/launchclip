// Subject fallbacks (docs/EXPLAINER_CLAIMS_RFC.md §3.2): a direction-map line
// with a subject (the fact it says) must show it. Three ways of not showing it
// stop counting as a fallback: a flat brand panel, a small boxed photo (an
// object-card, or a photo-scene under half the frame on a plain plate) and a
// gradient-only plate. Read from the layout check's element rects and the
// scenes' plates, like src/visual_density.js, so the plan and finish agree.
//
//   subjectFallbackNotes(story, rects, {direction, words}) → ["subject: …"] planner repair notes
import { scenePlateSpec } from "@launchclip/core/plates.mjs";

// These ship as warnings for one release (RFC §6). They become errors (flip
// this to true) once the golden samples and real runs show the planner
// resolves subjects to footage, an illustration or hero type in most runs.
export const SUBJECT_FALLBACK_IS_ERROR = false;
// A photo under this share of the frame is a boxed photo.
export const BOXED_PHOTO_SHARE = 0.5;

const FOOTAGE = new Set(["video", "image"]);
const FILLING = new Set(["media", "hero"]);

function plateKind(story, scene) {
  try { return scenePlateSpec(story, scene)?.kind ?? null; } catch { return null; }
}

/**
 * story: a resolved story; rects: [{id, role, rect, start, end}] (the layout
 * elements); direction: the map; words: the narration's timed words.
 * → ["subject: <why> …"], one per line whose subject falls back.
 */
export function subjectFallbackNotes(story, rects = [], { direction = null, words = [] } = {}) {
  const W = Number(story?.format?.width), H = Number(story?.format?.height);
  if (!(W > 0 && H > 0) || !Array.isArray(direction?.sections) || story?.base) return [];
  const timed = Array.isArray(words) ? words : [];
  const frame = W * H;
  const notes = [];
  for (const line of direction.sections.flatMap((section) => section?.lines ?? [])) {
    const subject = typeof line?.subject === "string" ? line.subject.trim() : "";
    const [a, b] = Array.isArray(line?.words) ? line.words : [];
    if (!subject || !timed[a] || !timed[b]) continue;
    const start = Number(timed[a].start), end = Number(timed[b].end ?? timed[b].start);
    const mid = (start + end) / 2;
    const live = (entry) => Number(entry.start) <= mid + 1e-6 && Number(entry.end) > mid + 1e-6;
    const scenes = (story.scenes ?? []).filter(live);
    if (!scenes.length) continue;
    const ids = scenes.map((scene) => String(scene.id));
    const own = (entry) => ids.some((id) => entry.id === id || String(entry.id).startsWith(`${id}-`));
    const footagePlate = scenes.some((scene) => FOOTAGE.has(plateKind(story, scene)));
    const filled = rects.filter((entry) => FILLING.has(entry.role) && entry.rect && live(entry) && own(entry));
    const area = Math.max(0, ...filled.map(({ rect }) => rect.width * rect.height)) / frame;
    const words = `words [${a}, ${b}] "${subject}"`;
    let why = null;
    if (scenes.some((scene) => scene.module === "object-card")) why = "shows it as an object-card, a small boxed object";
    else if (!footagePlate && scenes.some((scene) => scene.module === "photo-scene") && area < BOXED_PHOTO_SHARE) why = `shows it as a photo in ${Math.round(area * 100)}% of the frame on a plain plate, a boxed photo`;
    else if (!footagePlate && !filled.length) why = scenes.some((scene) => /gradient/.test(String(plateKind(story, scene)))) ? "puts it on a gradient-only plate" : "puts it on a flat brand panel";
    if (why) notes.push(`subject: ${words} @${Math.round(mid * 100) / 100}s ${why}; show it with footage that shows it, an illustration scene of it, or full-bleed hero type (kinetic-words)`);
  }
  return notes;
}
