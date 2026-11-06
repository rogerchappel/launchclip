// The presenter's face and subject box, which every talking-head layout
// (src/talking_head_layout.js) measures the presenter by.

import { subjectContext } from "@launchclip/core/subject-layer.mjs";

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
