// LaunchclipStory: the resolved storyboard.json as one Remotion composition.
//
// Props are the resolved story (kit/core/story.mjs resolveStory) plus an
// optional `customModules` map for bespoke "custom" scenes. The timeline is
// built from absolute story times, exactly like the HyperFrames compiler:
//
// - one <Sequence premountFor={fps}> per scene, over its render window
//   (kit/core/transitions.mjs sceneWindows: the outgoing track-0 scene stays
//   on screen until the incoming transition settles);
// - typed transitions as frame-pure layer styles from the same tween table
//   the HyperFrames compiler turns into GSAP (same durations, eases, offsets);
//   no TransitionSeries, so story times stay authoritative;
// - one root <Audio> for audio.mix (or the voice);
// - <WordCaptions> from captions.json or chunked NARRATION words;
// - the loop ending (the loop_to scene's first state over the final window);
// - brand fonts through @remotion/google-fonts with fallback stacks.
import React from "react";
import { AbsoluteFill, Audio, Freeze, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
// @ts-ignore plain ESM from kit/core
import { placeholderModel, resolveModule } from "../core/modules.mjs";
// @ts-ignore plain ESM from kit/core
import { layerStateAt, layerStyle, sceneWindows } from "../core/transitions.mjs";
// @ts-ignore plain ESM from kit/core
import { getEase } from "../core/motion.mjs";
// @ts-ignore plain ESM from kit/core
import { CAPTION_DEFAULT_COLORS, captionChunksFrom, chunkWords, narrationWords } from "../core/captions.mjs";
import { moduleComponent } from "./modules";
import { Placeholder } from "./Placeholder";
import { WordCaptions } from "./captions/WordCaptions";
import { ensureBrandFonts } from "./fonts";

export type CustomModuleProps = { scene: any; params: any; brand: any; format: any; model: any };
export type StoryProps = Record<string, any> & {
  customModules?: Record<string, React.ComponentType<CustomModuleProps>>;
  /** Filled by calculateStoryMetadata: caption chunks loaded from captions.json or NARRATION.json. */
  __captions?: any[] | null;
};

// Error boundary so one failing module renders the placeholder instead of
// aborting the whole render. It keeps no animation state.
class ModuleBoundary extends React.Component<{ fallback: (error: Error) => React.ReactNode; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.warn(`[launchclip] module failed: ${error.message}`); }
  render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children; }
}

type Resolved = { model: any; render: () => React.ReactNode };

/** Scene → model + renderer, falling back to the labelled placeholder. */
export function resolveSceneElement(scene: any, story: any, { end, customModules }: { end?: number; customModules?: StoryProps["customModules"] } = {}): Resolved {
  const placeholder = (reason: string): Resolved => {
    const model = placeholderModel(scene, story, reason, { end });
    return { model, render: () => <Placeholder model={model} /> };
  };
  if (scene.module === "custom") {
    const name = scene.params?.component;
    const Custom = name ? customModules?.[name] : undefined;
    if (!Custom) return placeholder(`custom module "${name ?? "(params.component missing)"}" is not registered; pass it in customModules from remotion/entry.tsx`);
    const model = { id: scene.id, module: "custom", start: scene.start, end: end ?? scene.end, duration: (end ?? scene.end) - scene.start, hidesCaptions: Boolean(scene.params?.hidesCaptions) };
    return { model, render: () => <Custom scene={scene} params={scene.params ?? {}} brand={story.brand} format={story.format} model={model} /> };
  }
  let model: any;
  try { model = resolveModule(scene, story, { end }); }
  catch (error: any) { return placeholder(error.message); }
  const Component = moduleComponent(model.module);
  if (!Component) return placeholder(`no Remotion component for module "${model.module}"`);
  return {
    model,
    render: () => (
      <ModuleBoundary fallback={(error) => <Placeholder model={placeholderModel(scene, story, error.message, { end })} />}>
        <Component model={model} />
      </ModuleBoundary>
    )
  };
}

const SceneLayer: React.FC<{ start: number; tweens: any[]; plate: boolean; background: string; freeze?: boolean; children: React.ReactNode }> = ({ start, tweens, plate, background, freeze, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = layerStyle(layerStateAt(start + frame / fps, tweens, getEase));
  return (
    <AbsoluteFill style={{ overflow: "hidden", isolation: "isolate" }}>
      <AbsoluteFill style={{ ...style, transformOrigin: "50% 50%", ...(plate ? { backgroundColor: background } : {}) }}>
        {freeze ? <Freeze frame={0}>{children}</Freeze> : children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

function captionOverlay(story: any) {
  return (Array.isArray(story.overlays) ? story.overlays : []).find((overlay: any) => overlay?.type === "captions" && overlay.style !== "none") ?? null;
}

export const StoryComposition: React.FC<StoryProps> = (props) => {
  const { customModules, __captions, ...story } = props;
  const { fps } = useVideoConfig();
  const fonts = ensureBrandFonts(story.brand);
  const colors = story.brand?.colors ?? {};
  const background = colors.bg ?? "#000000";
  const windows = React.useMemo(() => sceneWindows(story), [story]);
  const layers = React.useMemo(() => windows.scenes.map((entry: any) => ({ entry, ...resolveSceneElement(entry.scene, story, { end: entry.renderEnd, customModules }) })), [windows, story, customModules]);
  const loop = windows.loop ? { ...windows.loop, ...resolveSceneElement({ ...windows.loop.scene, id: `${windows.loop.scene.id}-loop` }, story, { customModules }) } : null;
  const overlay = captionOverlay(story);
  const hide: Array<[number, number]> = [
    ...((overlay?.hide ?? []) as Array<[number, number]>),
    ...layers.filter((layer: any) => layer.model?.hidesCaptions).map((layer: any) => [layer.entry.start, layer.entry.renderEnd] as [number, number])
  ];
  const audio = story.audio?.mix ?? story.audio?.voice ?? null;
  const frames = (seconds: number) => Math.round(seconds * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: background, fontFamily: fonts.body, ["--lc-font-display" as any]: fonts.display, ["--lc-font-body" as any]: fonts.body, ["--lc-font-meta" as any]: fonts.meta }}>
      {layers.map(({ entry, render }: any) => (
        <Sequence key={entry.id} name={`${entry.id} · ${entry.scene.module}`} from={frames(entry.start)} durationInFrames={Math.max(1, frames(entry.renderEnd) - frames(entry.start))} premountFor={fps}>
          <SceneLayer start={entry.start} tweens={entry.tweens} plate={entry.plate} background={background}>{render()}</SceneLayer>
        </Sequence>
      ))}
      {loop ? (
        <Sequence key="loop" name={`loop → ${loop.sceneId}`} from={frames(loop.start)} durationInFrames={Math.max(1, frames(loop.end) - frames(loop.start))} premountFor={fps}>
          <SceneLayer start={loop.start} tweens={loop.tweens} plate background={background} freeze>{loop.render()}</SceneLayer>
        </Sequence>
      ) : null}
      {overlay && Array.isArray(__captions) && __captions.length ? (
        <WordCaptions chunks={__captions} hide={hide} idle={colors.paper ?? CAPTION_DEFAULT_COLORS.idle} active={colors.primary ?? CAPTION_DEFAULT_COLORS.active} fontFamily={fonts.display} />
      ) : null}
      {audio ? <Audio src={staticFile(audio)} /> : null}
    </AbsoluteFill>
  );
};

/** Caption chunks for a story: overlay src (captions.json), else chunked audio.words. */
export async function loadStoryCaptions(story: any): Promise<any[] | null> {
  const overlay = captionOverlay(story);
  if (!overlay) return null;
  try {
    if (overlay.src) return captionChunksFrom(await (await fetch(staticFile(overlay.src))).json());
    if (!story.audio?.words) return null;
    const words = narrationWords(await (await fetch(staticFile(story.audio.words))).json());
    return words.length ? chunkWords(words) : null;
  } catch (error: any) {
    console.warn(`[launchclip] captions skipped: ${error?.message ?? error}`);
    return null;
  }
}

export const calculateStoryMetadata: CalculateMetadataFunction<StoryProps> = async ({ props }) => {
  const fps = Number(props.resolved?.fps ?? props.format?.fps ?? 30);
  const duration = Number(props.resolved?.duration ?? props.format?.duration);
  const durationInFrames = Math.max(1, Number(props.resolved?.frames ?? Math.round(duration * fps)));
  const captions = Array.isArray(props.__captions) ? props.__captions : await loadStoryCaptions(props);
  return { width: props.format.width, height: props.format.height, fps, durationInFrames, props: { ...props, __captions: captions } };
};

// ModuleReview: one scene's module on brand.colors.bg for its duration, with
// the same input as resolveModule ({scene, story}). Frame 0 is scene.start.
export type ModuleReviewProps = { scene: any; story: any; customModules?: StoryProps["customModules"] };

export const ModuleReview: React.FC<ModuleReviewProps> = ({ scene, story, customModules }) => {
  ensureBrandFonts(story.brand);
  const element = React.useMemo(() => resolveSceneElement(scene, story, { customModules }), [scene, story, customModules]);
  return <AbsoluteFill style={{ backgroundColor: story.brand?.colors?.bg ?? "#000000" }}>{element.render()}</AbsoluteFill>;
};

export const calculateModuleReviewMetadata: CalculateMetadataFunction<ModuleReviewProps> = async ({ props }) => {
  const fps = Number(props.story?.resolved?.fps ?? props.story?.format?.fps ?? 30);
  const seconds = Number(props.scene.end) - Number(props.scene.start);
  return { width: props.story.format.width, height: props.story.format.height, fps, durationInFrames: Math.max(1, Math.round(seconds * fps)) };
};
