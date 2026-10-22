// Compositions of the LaunchClip Remotion kit:
//   LaunchclipStory  props: the resolved story (.launchclip/story.resolved.json)
//   ModuleReview     props: {scene, story}, one module on brand.colors.bg
// Size, fps and duration always come from the props (calculateMetadata).
//
// A project with bespoke modules registers the same compositions with its
// own map from remotion/entry.tsx:
//   import { registerRoot } from "remotion";
//   import { LaunchclipCompositions } from "../kit/remotion/Root";
//   import SignalLabel from "./modules/SignalLabel";
//   registerRoot(() => <LaunchclipCompositions customModules={{ SignalLabel }} />);
import React from "react";
import { Composition } from "remotion";
import { ModuleReview, StoryComposition, calculateModuleReviewMetadata, calculateStoryMetadata } from "./StoryComposition";
import type { ModuleReviewProps, StoryProps } from "./StoryComposition";

// Placeholder props so `remotion compositions` and Studio open without
// --props. Real renders always pass the resolved storyboard.
export const DEFAULT_STORY: StoryProps = {
  schema: "launchclip.story.v1",
  lane: "motion",
  format: { width: 1080, height: 1920, fps: 30, duration: 3 },
  brand: { colors: { bg: "#06070d", primary: "#fdb022", paper: "#f2eee6", ink: "#06070d" }, fonts: { display: "anton", body: "inter", meta: "jetbrains-mono" } },
  scenes: [{ id: "s1", module: "storyboard-missing", start: 0, end: 3 }],
  resolved: { duration: 3, fps: 30, frames: 90 }
};

export const LaunchclipCompositions: React.FC<{ customModules?: StoryProps["customModules"] }> = ({ customModules }) => {
  // Components are not serialisable props, so custom modules ride in a closure.
  const Story = React.useMemo(() => (customModules ? (props: StoryProps) => <StoryComposition {...props} customModules={customModules} /> : StoryComposition), [customModules]);
  const Review = React.useMemo(() => (customModules ? (props: ModuleReviewProps) => <ModuleReview {...props} customModules={customModules} /> : ModuleReview), [customModules]);
  return (
  <>
    <Composition
      id="LaunchclipStory"
      component={Story}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={90}
      defaultProps={DEFAULT_STORY}
      calculateMetadata={calculateStoryMetadata}
    />
    <Composition
      id="ModuleReview"
      component={Review}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={90}
      defaultProps={{ scene: DEFAULT_STORY.scenes[0], story: DEFAULT_STORY } as ModuleReviewProps}
      calculateMetadata={calculateModuleReviewMetadata}
    />
  </>
  );
};

export const Root: React.FC = () => <LaunchclipCompositions />;

export default Root;
