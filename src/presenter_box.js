// The presenter's face and subject box, which every talking-head layout
// (src/talking_head_layout.js) measures the presenter by.

import { subjectContext } from "@launchclip/core/subject-layer.mjs";
import { resolveStory } from "@launchclip/core/story.mjs";

/**
 * The presenter's head over timeline [start, end]: {x, y, width, height} in
 * canvas px, from the subject matte or the whole-video track, or null when
 * the story has no subject data.
 */
export function presenterHead(story, start, end = start) {
  return subjectContext(story, start, { end })?.head ?? null;
}

/**
 * Where a point of the recording lands on the canvas under a base camera
 * ({scale, x, y}: scaled about the canvas centre, then moved).
 */
export function cameraPoint(camera, canvas, px, py) {
  const { scale = 1, x = 0, y = 0 } = camera ?? {};
  return [canvas.width / 2 + scale * (px - canvas.width / 2) + x, canvas.height / 2 + scale * (py - canvas.height / 2) + y];
}

// A presenter framed this tightly (the head's share of a portrait frame's width) leaves no room for a card beside them.
export const TIGHT_HEAD_SHARE = 0.6;

/**
 * Is the presenter framed too tightly for cards beside them? A portrait
 * recording whose tracked head, as the frame crops it, is at least
 * TIGHT_HEAD_SHARE of the width. inputs: {format, base, brand}; track: the
 * whole-video head track. False with no track (nothing is measured).
 */
export function tightlyFramed({ format, base, brand } = {}, track = null) {
  const width = Number(format?.width), height = Number(format?.height);
  if (!track || !base || !(height > width)) return false;
  try {
    const resolved = resolveStory({ schema: "launchclip.story.v1", lane: "footage-led", format, brand, base, scenes: [] }, { words: [], track });
    const head = presenterHead(resolved, 0, Number(format.duration) || 0);
    return Boolean(head) && head.width / width >= TIGHT_HEAD_SHARE;
  } catch { return false; }
}
