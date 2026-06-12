// Camera travel between scenes: one continuous canvas, swiped and zoomed
// across, with blur scoped to the motion. Shared by the scene track and the
// paper ground (which parallaxes at a fraction of content speed).

import { spring } from "remotion";
import { TRAVEL_SECONDS } from "./schema.js";

export const TRAVEL_SPRING = { damping: 15, stiffness: 140, mass: 0.9 };

// Progress of a travel move; frame is relative to the travel's first frame.
export function travelProgress(frame, fps) {
  if (frame < 0) return 0;
  return spring({ frame, fps, config: TRAVEL_SPRING });
}

// Cumulative horizontal paper offset: every swipe drags the grid a fraction
// of the content distance (depth parallax), and the drag persists.
export function paperOffsetAt({ scenes, frame, fps, width }) {
  const PARALLAX = 0.3;
  let offset = 0;
  for (const scene of scenes) {
    if (scene.transition !== "swipe_left" && scene.transition !== "swipe_right") continue;
    const travelStartFrame = (scene.start - TRAVEL_SECONDS) * fps;
    const p = travelProgress(frame - travelStartFrame, fps);
    if (p <= 0) continue;
    const direction = scene.transition === "swipe_left" ? -1 : 1;
    offset += direction * p * width * PARALLAX;
  }
  return offset;
}
