// The LaunchClip Remotion compositions, for registerRoot() in any Remotion
// bundle (the kit's own Root, a project's remotion/entry.tsx, or an app that
// embeds @launchclip/remotion):
//   LaunchclipStory  props: the resolved story (.launchclip/story.resolved.json)
//   ModuleReview     props: {scene, story}, one module on brand.colors.bg
//   SceneOverlay     props: {story, sceneId, loop?, plate?}, one scene on a
//                    transparent background (launchclip export overlays)
// Size, fps and duration always come from the props (calculateMetadata).
// Importing this module loads no fonts: Root.tsx (or the app) imports
// font-files.ts.
import React from "react";
import { Composition } from "remotion";
import { ModuleReview, StoryComposition, calculateModuleReviewMetadata, calculateStoryMetadata } from "./StoryComposition";
import type { ModuleReviewProps, StoryProps } from "./StoryComposition";
import { SceneOverlay, calculateSceneOverlayMetadata } from "./SceneOverlay";
import type { SceneOverlayProps } from "./SceneOverlay";

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
  const Overlay = React.useMemo(() => (customModules ? (props: SceneOverlayProps) => <SceneOverlay {...props} customModules={customModules} /> : SceneOverlay), [customModules]);
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
    <Composition
      id="SceneOverlay"
      component={Overlay}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={90}
      defaultProps={{ story: DEFAULT_STORY, sceneId: DEFAULT_STORY.scenes[0].id } as SceneOverlayProps}
      calculateMetadata={calculateSceneOverlayMetadata}
    />
  </>
  );
};
