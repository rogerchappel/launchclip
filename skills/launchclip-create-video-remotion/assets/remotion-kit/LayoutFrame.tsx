// The footage layout's frame element (kit/core/footage-layout.mjs): a box at
// the presenter's window whose box-shadow paints the panel around it, set per
// frame from the same op list the HyperFrames compiler turns into tl.set
// calls on #lc-layout-frame.
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
// @ts-ignore plain ESM from kit/core
import { layoutFrameStyle, layoutStateAt, layoutUnderFrameStyle } from "../core/footage-layout.mjs";

// under: the frame's copy beneath the subject in a story with a breakout
// section (#lc-layout-frame-under); the frame above the subject is then
// clipped away over the breakout zone (layoutFrameStyle's clipPath).
export const LayoutFrame: React.FC<{ plan: any; under?: boolean }> = ({ plan, under = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const state = layoutStateAt(plan, frame / fps);
  const style = under ? layoutUnderFrameStyle(state, plan.canvas) : layoutFrameStyle(state, plan.canvas);
  return <div aria-hidden style={{ position: "absolute", pointerEvents: "none", ...style }} />;
};
