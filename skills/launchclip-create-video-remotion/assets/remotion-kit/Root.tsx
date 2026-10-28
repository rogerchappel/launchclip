// The kit's Remotion root: the compositions (compositions.tsx) plus every
// registry font file (font-files.ts):
//   LaunchclipStory  props: the resolved story (.launchclip/story.resolved.json)
//   ModuleReview     props: {scene, story}, one module on brand.colors.bg
//   SceneOverlay     props: {story, sceneId, loop?, plate?}, one scene on a
//                    transparent background (launchclip export overlays)
// Size, fps and duration always come from the props (calculateMetadata).
//
// A project with bespoke modules registers the same compositions with its
// own map from remotion/entry.tsx:
//   import { registerRoot } from "remotion";
//   import { LaunchclipCompositions } from "../kit/remotion/Root";
//   import SignalLabel from "./modules/SignalLabel";
//   registerRoot(() => <LaunchclipCompositions customModules={{ SignalLabel }} />);
import React from "react";
import "./font-files";
import { LaunchclipCompositions } from "./compositions";

export { DEFAULT_STORY, LaunchclipCompositions } from "./compositions";

export const Root: React.FC = () => <LaunchclipCompositions />;

export default Root;
