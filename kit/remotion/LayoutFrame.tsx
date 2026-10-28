// The footage layout's frame element (kit/core/footage-layout.mjs): a box at
// the presenter's window whose box-shadow paints the panel around it, set per
// frame from the same op list the HyperFrames compiler turns into tl.set
// calls on #lc-layout-frame.
import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
// @ts-ignore plain ESM from kit/core
import { layoutFrameStyle, layoutStateAt } from "@launchclip/core/footage-layout.mjs";

export const LayoutFrame: React.FC<{ plan: any }> = ({ plan }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = layoutFrameStyle(layoutStateAt(plan, frame / fps), plan.canvas);
  return <div aria-hidden style={{ position: "absolute", pointerEvents: "none", ...style }} />;
};
