// @remotion/player props for a LaunchClip story. The Player takes size, fps
// and duration up front and runs no calculateMetadata, so this does what
// calculateStoryMetadata does for a render (including loading captions) and
// hands back everything <Player> needs:
//   const props = await storyPlayerProps(resolvedStory);
//   <Player {...props} controls />
import React from "react";
import { StoryComposition, calculateStoryMetadata } from "./StoryComposition";
import type { StoryProps } from "./StoryComposition";

export type StoryPlayerProps = {
  component: React.ComponentType<StoryProps>;
  inputProps: StoryProps;
  durationInFrames: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
};

export async function storyPlayerProps(story: StoryProps, options: { customModules?: StoryProps["customModules"] } = {}): Promise<StoryPlayerProps> {
  const metadata: any = await calculateStoryMetadata({ props: story, defaultProps: story, abortSignal: new AbortController().signal, compositionId: "LaunchclipStory", isRendering: false } as any);
  const { customModules } = options;
  const component = customModules ? (props: StoryProps) => React.createElement(StoryComposition, { ...props, customModules }) : StoryComposition;
  return {
    component,
    inputProps: metadata.props,
    durationInFrames: metadata.durationInFrames,
    fps: metadata.fps,
    compositionWidth: metadata.width,
    compositionHeight: metadata.height
  };
}
