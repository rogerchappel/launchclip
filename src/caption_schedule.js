// Planned captions (kit/core/captions.mjs captionSchedule): captions are
// part of the motion design. Before the layout check, the planner and finish
// turn the captions off for every scene that draws designed text, so the card
// carries the line's words and the captions come back when it goes. A scene
// the author planned ("on", "off" or {position}) keeps its choice, and a
// captions overlay with schedule "fit" opts out (the caption-band fit alone,
// as before). The fit stays as the safety net for what is left.

import { captionSchedule, captionsOverlayOf } from "@launchclip/core/captions.mjs";
import { resolveModule } from "@launchclip/core/modules.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";
import { captionBandFor } from "./layout_check.js";

/**
 * The storyboard with its captions planned. resolved: the story resolved
 * (else it is resolved here with options.words / options.beats).
 * → {storyboard, off: [scene id]} (the same storyboard when nothing changes)
 */
export function planCaptions(storyboard, { resolved = null, words = [], beats = null } = {}) {
  const overlay = captionsOverlayOf(storyboard);
  if (!overlay || overlay.schedule === "fit" || !Array.isArray(storyboard?.scenes)) return { storyboard, off: [] };
  let story = resolved;
  try { story ??= resolveStory(storyboard, { words, beats }); } catch { return { storyboard, off: [] }; }
  const models = new Map();
  for (const scene of story.scenes ?? []) {
    try { models.set(scene.id, resolveModule(scene, story)); } catch { /* reported by validation */ }
  }
  let band = null;
  try { band = captionBandFor(story, { width: Number(story.format?.width), height: Number(story.format?.height) }); } catch { band = null; }
  const off = new Set(captionSchedule(story, models, { band }));
  if (!off.size) return { storyboard, off: [] };
  const scenes = storyboard.scenes.map((scene) => (off.has(scene?.id) && scene.captions === undefined ? { ...scene, captions: "off" } : scene));
  return { storyboard: { ...storyboard, scenes }, off: [...off] };
}
