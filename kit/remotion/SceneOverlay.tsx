// SceneOverlay: one scene of the resolved story on a transparent background,
// for `launchclip export` (editable NLE timelines, src/nle/).
//
// Props: {story, sceneId, loop?, plate?, part?}. Frame 0 is the scene start; the
// clip runs over the scene's render window (kit/core/transitions.mjs
// sceneWindows: an outgoing track-0 scene stays until the incoming transition
// settles), with the same transition tweens and the same absolute scene clock
// LaunchclipStory uses, so the clip composites over the base exactly where the
// scene sits in the full render. No base, no captions, no audio.
//   loop:  the loop ending (ending.loop_to's first state, frozen, over the final window)
//   plate: paint brand.colors.bg behind the scene, as LaunchclipStory does for
//          track-0 scenes (export passes it for track 0 and the loop)
//   part:  "behind" | "front": one part of a split scene (model.part), so the
//          export can put the behind part under the subject track
// Render with an alpha codec: --codec prores --prores-profile 4444
// --pixel-format yuva444p10le --image-format png, or --sequence --image-format png.
import React from "react";
import { AbsoluteFill, Freeze, useCurrentFrame, useVideoConfig } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
// @ts-ignore plain ESM from kit/core
import { layerStateAt, layerStyle, sceneWindows } from "@launchclip/core/transitions.mjs";
// @ts-ignore plain ESM from kit/core
import { getEase } from "@launchclip/core/motion.mjs";
import { resolveSceneElement } from "./StoryComposition";
import type { StoryProps } from "./StoryComposition";
import { SceneStartFrame } from "./clock";
import { ensureFonts } from "./fonts";

export type SceneOverlayProps = { story: any; sceneId: string; loop?: boolean; plate?: boolean; part?: "behind" | "front"; customModules?: StoryProps["customModules"] };

type OverlayWindow = { scene: any; start: number; end: number; tweens: any[]; loop: boolean };

/** The render window of one scene (or of the loop ending) in a resolved story. */
export function sceneOverlayWindow(story: any, sceneId: string, loop = false): OverlayWindow {
  const windows = sceneWindows(story);
  if (loop) {
    if (!windows.loop || windows.loop.sceneId !== sceneId) throw new Error(`SceneOverlay: the story has no loop ending onto "${sceneId}"`);
    return { scene: { ...windows.loop.scene, id: `${sceneId}-loop` }, start: windows.loop.start, end: windows.loop.end, tweens: windows.loop.tweens, loop: true };
  }
  const entry = windows.scenes.find((candidate: any) => candidate.id === sceneId);
  if (!entry) throw new Error(`SceneOverlay: no scene "${sceneId}" (scenes: ${windows.scenes.map((candidate: any) => candidate.id).join(", ")})`);
  return { scene: entry.scene, start: entry.start, end: entry.renderEnd, tweens: entry.tweens, loop: false };
}

export const SceneOverlay: React.FC<SceneOverlayProps> = ({ story, sceneId, loop = false, plate = false, part, customModules }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fonts = ensureFonts(story.brand);
  const span = React.useMemo(() => sceneOverlayWindow(story, sceneId, loop), [story, sceneId, loop]);
  const element = React.useMemo(() => resolveSceneElement(span.scene, story, { end: span.loop ? undefined : span.end, customModules }), [span, story, customModules]);
  const startFrame = Math.round(span.start * fps);
  const style = layerStyle(layerStateAt((startFrame + frame) / fps, span.tweens, getEase));
  const content = span.loop
    ? <Freeze frame={0}>{element.render()}</Freeze>
    : <SceneStartFrame.Provider value={startFrame}>{element.render(part)}</SceneStartFrame.Provider>;
  return (
    <AbsoluteFill style={{ fontFamily: fonts.body, ["--lc-font-display" as any]: fonts.display, ["--lc-font-body" as any]: fonts.body, ["--lc-font-meta" as any]: fonts.meta }}>
      <AbsoluteFill style={{ overflow: "hidden", isolation: "isolate" }}>
        <AbsoluteFill style={{ ...style, transformOrigin: "50% 50%", ...(plate ? { backgroundColor: story.brand?.colors?.bg ?? "#000000" } : {}) }}>
          {content}
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const calculateSceneOverlayMetadata: CalculateMetadataFunction<SceneOverlayProps> = async ({ props }) => {
  const fps = Number(props.story?.resolved?.fps ?? props.story?.format?.fps ?? 30);
  const span = sceneOverlayWindow(props.story, props.sceneId, Boolean(props.loop));
  const durationInFrames = Math.max(1, Math.round(span.end * fps) - Math.round(span.start * fps));
  return { width: props.story.format.width, height: props.story.format.height, fps, durationInFrames };
};
