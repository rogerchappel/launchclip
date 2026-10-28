// Which source ranges of the base a planned storyboard needs matted: every
// scene that needs the subject (a behind or split layer, a subjectCamera,
// a room, or a traced outline) and every footage layout section that treats
// the room, its window mapped back through the base's
// trims to source seconds, padded and merged. `launchclip make` mattes exactly these.

import { resolveModule } from "@launchclip/core/modules.mjs";
import { storyBase } from "@launchclip/core/story.mjs";
import { needsSubject, subjectWindows } from "@launchclip/core/subject-layer.mjs";
import { SECTION_ROOMS, storySections } from "@launchclip/core/footage-layout.mjs";

export const MATTE_PAD_SECONDS = 0.5;

/** Timeline windows of the scenes that need the subject: [[start, end]], merged. */
export function plannedSubjectWindows(resolved) {
  const entries = (resolved?.scenes ?? []).map((scene) => {
    let model = null;
    try { model = resolveModule(scene, resolved); } catch { /* a scene that does not resolve is reported by validate */ }
    return { scene, model, start: Number(scene.start), end: Number(scene.end) };
  });
  const rooms = storySections(resolved).filter((section) => SECTION_ROOMS[section.room]).map((section) => ({ scene: { id: `layout:${section.id}` }, model: { room: SECTION_ROOMS[section.room] }, start: section.start, end: section.end }));
  return subjectWindows([...entries, ...rooms], { include: (entry) => needsSubject(entry.scene, entry.model) || Boolean(entry.model?.usesOutline) });
}

/**
 * Source ranges ({in, out}, seconds) to matte for those windows: each window
 * mapped through the base segments, padded by `pad`, clamped to
 * [0, sourceDuration] and merged. Ranges are rounded outward to 1 ms.
 */
export function plannedSubjectRanges(resolved, { pad = MATTE_PAD_SECONDS, sourceDuration = Infinity } = {}) {
  const base = storyBase(resolved);
  if (!base) return [];
  const spans = [];
  for (const [start, end] of plannedSubjectWindows(resolved)) {
    for (const segment of base.segments) {
      const from = Math.max(start, segment.start);
      const to = Math.min(end, segment.end);
      if (to <= from) continue;
      spans.push([segment.sourceStart + (from - segment.start) - pad, segment.sourceStart + (to - segment.start) + pad]);
    }
  }
  const clamped = spans
    .map(([a, b]) => [Math.max(0, a), Math.min(sourceDuration, b)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of clamped) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged.map(([a, b]) => ({ in: Math.floor(a * 1000) / 1000, out: Math.ceil(b * 1000) / 1000 }));
}
