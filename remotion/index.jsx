import React from "react";
import { Composition, registerRoot } from "remotion";
import { LaunchclipPremiumShort } from "./premium.jsx";
import { LaunchclipSocial } from "./social.jsx";
import { MotionLayer } from "../motion-engine/MotionLayer.jsx";
import goldenTimeline from "../examples/motion/golden-timeline.json";

const defaultProps = {
  width: 720,
  height: 1280,
  fps: 30,
  durationSeconds: 30,
  repo: {
    name: "launchclip",
    summary: "turns repo proof into a launch packet",
    url: ""
  },
  timeline: [],
  terminal: "$ npm run smoke\n\nSmoke OK",
  artifacts: ["brief.md", "render-plan.json", "captions/*.md", "REVIEW.md", "dry-run.json"]
};

const Root = () => {
  return (
    <>
      <Composition
        id="LaunchclipSocial"
        component={LaunchclipSocial}
        durationInFrames={900}
        fps={30}
        width={720}
        height={1280}
        defaultProps={defaultProps}
        calculateMetadata={metadataFromProps}
      />
      <Composition
        id="LaunchclipPremiumShort"
        component={LaunchclipPremiumShort}
        durationInFrames={1440}
        fps={30}
        width={720}
        height={1280}
        defaultProps={{ ...defaultProps, durationSeconds: 48, style: "premium-product-short" }}
        calculateMetadata={metadataFromProps}
      />
      <Composition
        id="MotionGolden"
        component={MotionLayer}
        durationInFrames={Math.ceil(goldenTimeline.duration_seconds * 30)}
        fps={30}
        width={720}
        height={1280}
        defaultProps={{ timeline: goldenTimeline, enableSfx: true }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.ceil(Number(props.timeline?.duration_seconds ?? 30) * 30))
        })}
      />
    </>
  );
};

const metadataFromProps = ({ props }) => {
  const fps = Number(props.fps ?? 30);
  return {
    fps,
    width: Number(props.width ?? 720),
    height: Number(props.height ?? 1280),
    durationInFrames: Math.max(1, Math.ceil(Number(props.durationSeconds ?? 30) * fps))
  };
};

registerRoot(Root);
