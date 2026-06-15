// Whole-canvas camera derived from punch_zoom events. The camera is editorial:
// a deliberate ease into the object being inspected, then a calm ease out.
// Springs made proof zooms feel rubbery; Bezier curves keep them directed.

import { Easing, interpolate } from "remotion";

const EASE_INTO_PROOF = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_OUT_OF_PROOF = Easing.bezier(0.45, 0, 0.55, 1);

export function cameraAt({ events, frame, fps }) {
  let scale = 1;
  let originX = 0.5;
  let originY = 0.42;
  for (const event of events) {
    if (event.type !== "punch_zoom") continue;
    const startFrame = event.start * fps;
    const endFrame = event.end * fps;
    if (frame < startFrame) continue;
    const enter = interpolate(frame, [startFrame, startFrame + fps * 0.36], [0, 1], {
      easing: EASE_INTO_PROOF,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    });
    const exit = frame >= endFrame
      ? interpolate(frame, [endFrame, endFrame + fps * 0.42], [0, 1], {
          easing: EASE_OUT_OF_PROOF,
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp"
        })
      : 0;
    const amount = enter * (1 - exit);
    if (amount <= 0.001) continue;
    scale = 1 + (event.scale - 1) * amount;
    originX = event.origin_x;
    originY = event.origin_y;
  }
  return { scale, originX, originY };
}
