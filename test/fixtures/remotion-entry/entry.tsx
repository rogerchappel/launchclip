// Tiny stand-in for kit/remotion/entry.tsx used by test/renderers.test.js.
// It registers a LaunchclipStory composition whose size, fps and duration come
// from the (resolved story) props, and draws a coloured box that moves.
import React from "react";
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig } from "remotion";

type StoryProps = {
  format?: { width?: number; height?: number; fps?: number; duration?: number };
  resolved?: { duration?: number; fps?: number };
  brand?: { colors?: { bg?: string; primary?: string } };
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
};

const read = (props: StoryProps) => {
  const format = props.format ?? props;
  const fps = Number(props.resolved?.fps ?? format.fps ?? 30);
  const duration = Number(props.resolved?.duration ?? format.duration ?? 1);
  return { fps, duration, width: Number(format.width ?? 320), height: Number(format.height ?? 240) };
};

const Story: React.FC<StoryProps> = (props) => {
  const frame = useCurrentFrame();
  const { width, durationInFrames } = useVideoConfig();
  const size = Math.round(width / 4);
  const x = Math.round(((width - size) * frame) / Math.max(1, durationInFrames - 1));
  return (
    <AbsoluteFill style={{ backgroundColor: props.brand?.colors?.bg ?? "#101018" }}>
      <div style={{ position: "absolute", left: x, top: size / 2, width: size, height: size, backgroundColor: props.brand?.colors?.primary ?? "#ff3366" }} />
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition
    id="LaunchclipStory"
    component={Story}
    durationInFrames={30}
    fps={30}
    width={320}
    height={240}
    defaultProps={{} as StoryProps}
    calculateMetadata={({ props }) => {
      const { fps, duration, width, height } = read(props);
      return { fps, width, height, durationInFrames: Math.max(1, Math.round(duration * fps)) };
    }}
  />
);

registerRoot(Root);
