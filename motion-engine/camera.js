// Whole-canvas camera derived from punch_zoom events. Every zoom is a spring
// in and a spring out — no linear interpolation anywhere in this engine.

import { spring } from "remotion";

const ZOOM_IN = { damping: 14, stiffness: 220, mass: 0.8 };
const ZOOM_OUT = { damping: 18, stiffness: 130, mass: 0.9 };

export function cameraAt({ events, frame, fps }) {
  let scale = 1;
  let originX = 0.5;
  let originY = 0.42;
  for (const event of events) {
    if (event.type !== "punch_zoom") continue;
    const startFrame = event.start * fps;
    const endFrame = event.end * fps;
    if (frame < startFrame) continue;
    const enter = spring({ frame: frame - startFrame, fps, config: ZOOM_IN });
    const exit = frame >= endFrame ? spring({ frame: frame - endFrame, fps, config: ZOOM_OUT }) : 0;
    const amount = enter * (1 - exit);
    if (amount <= 0.001) continue;
    scale = 1 + (event.scale - 1) * amount;
    originX = event.origin_x;
    originY = event.origin_y;
  }
  return { scale, originX, originY };
}
