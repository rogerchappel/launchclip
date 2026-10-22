// Scene clock for the Remotion kit. HyperFrames evaluates every scene at the
// absolute composition time frame / fps. A Remotion <Sequence> must start on a
// whole frame, Math.round(start * fps), so `start + localFrame / fps` drifts
// from that time by up to half a frame whenever a scene starts between frames
// (start = 5.75 s at 30 fps starts the Sequence at frame 173 = 5.7667 s). In a
// fast push that half frame is ~130 px. StoryComposition publishes each scene
// Sequence's start frame here, and modules read absolute time through
// useSceneTime(), so both renderers sample the same instant.
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

/** Start frame of the enclosing scene Sequence; null outside StoryComposition (ModuleReview, Freeze). */
export const SceneStartFrame = React.createContext<number | null>(null);

/** Absolute composition seconds for the current frame of a scene that starts at `start`. */
export function sceneSeconds(start: number, frame: number, fps: number, startFrame: number | null): number {
  return startFrame == null ? start + frame / fps : (startFrame + frame) / fps;
}

export function useSceneTime(start: number): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return sceneSeconds(start, frame, fps, React.useContext(SceneStartFrame));
}
