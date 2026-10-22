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
// - the world camera (kit/core/camera-world.mjs): in world mode, or when a
//   cuts story uses a camera transition, plates sit at their world placements
//   inside pan / zoom / drift containers evaluated per frame from the same op
//   list the HyperFrames compiler turns into GSAP, with the parallax
//   background, overlay parallax and the velocity-shaped motion blur;
// - the bundled registry fonts (kit/remotion/fonts.ts, kit/core/fonts.mjs).
import React from "react";
import { AbsoluteFill, Audio, Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CalculateMetadataFunction } from "remotion";
// @ts-ignore plain ESM from kit/core
import { placeholderModel, resolveModule } from "../core/modules.mjs";
// @ts-ignore plain ESM from kit/core
import { layerStateAt, layerStyle, sceneWindows } from "../core/transitions.mjs";
// @ts-ignore plain ESM from kit/core
import { getEase } from "../core/motion.mjs";
// @ts-ignore plain ESM from kit/core
import { CAPTION_DEFAULT_COLORS, captionChunksFrom, chunkWords, narrationWords } from "../core/captions.mjs";
// @ts-ignore plain ESM from kit/core
import { storyBase } from "../core/story.mjs";
// @ts-ignore plain ESM from kit/core
import { backgroundLayer, blurAt, cameraPlan, containerTransform, opsStateAt, overlayOps, placementTransform, sceneObjectLookup } from "../core/camera-world.mjs";
import { moduleComponent } from "./modules";
import { baseCameraOps, cameraStyle } from "./catalog/CatalogC";
import { Placeholder } from "./Placeholder";
import { WordCaptions } from "./captions/WordCaptions";
import { SceneStartFrame } from "./clock";
import { ensureFonts } from "./fonts";

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

// startFrame: the enclosing Sequence's from; tweens carry absolute times, so the
// layer samples them at the absolute composition time (kit/remotion/clock.tsx).
// World camera: placement = the plate's world transform; transparent = a
// world-mode plate (the parallax background shows through); parallax = the
// overlay's parallax ops (camera-world.mjs overlayOps).
type CameraProps = { placement?: any; transparent?: boolean; parallax?: any[] };
const SceneLayer: React.FC<{ startFrame: number; tweens: any[]; plate: boolean; background: string; freeze?: boolean; children: React.ReactNode } & CameraProps> = ({ startFrame, tweens, plate, background, freeze, placement, transparent, parallax, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (startFrame + frame) / fps;
  const style = layerStyle(layerStateAt(t, tweens, getEase));
  const layer = (
    <AbsoluteFill style={{ ...style, transformOrigin: "50% 50%", ...(plate && !transparent ? { backgroundColor: background } : {}) }}>
      {freeze ? <Freeze frame={0}>{children}</Freeze> : children}
    </AbsoluteFill>
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden", isolation: "isolate", ...(placement ? { transformOrigin: "0 0", transform: placementTransform(placement) } : {}) }}>
      {parallax?.length ? <AbsoluteFill style={{ transform: containerTransform(opsStateAt(parallax, "overlay", t)) }}>{layer}</AbsoluteFill> : layer}
    </AbsoluteFill>
  );
};

// The world camera containers (kit/core/camera-world.mjs), evaluated per
// frame from the plan's ops exactly as GSAP plays them in HyperFrames:
// parallax background, then the blur-filtered camera with drift, zoom (about
// the canvas centre) and pan around the plates.
export const CameraWorld: React.FC<{ plan: any; brand: any; children: React.ReactNode }> = ({ plan, brand, children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const layer = React.useMemo(() => (plan.parallax ? backgroundLayer(plan, brand) : null), [plan, brand]);
  const blur = plan.blurSamples.length ? blurAt(plan, t) : { x: 0, y: 0 };
  const blurring = blur.x > 0 || blur.y > 0;
  const box: React.CSSProperties = { position: "absolute", left: 0, top: 0, width, height, transformOrigin: "50% 50%" };
  return (
    <>
      {layer ? (
        <div style={{ ...box, pointerEvents: "none", transform: containerTransform(opsStateAt(plan.ops, "background", t)) }} aria-hidden>
          <div style={{ position: "absolute", left: layer.left, top: layer.top, width: layer.width, height: layer.height, background: layer.background }} />
        </div>
      ) : null}
      {plan.blurSamples.length ? (
        <svg width={0} height={0} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden>
          <defs>
            <filter id="lc-cam-blur" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceGraphic" stdDeviation={`${blur.x} ${blur.y}`} />
            </filter>
          </defs>
        </svg>
      ) : null}
      <div style={{ ...box, overflow: "hidden", zIndex: 5, ...(blurring ? { filter: "url(#lc-cam-blur)" } : {}) }}>
        <div style={{ ...box, transform: containerTransform(opsStateAt(plan.ops, "drift", t)) }}>
          <div style={{ ...box, transform: containerTransform(opsStateAt(plan.ops, "zoom", t)) }}>
            <div style={{ ...box, transform: containerTransform(opsStateAt(plan.ops, "pan", t)) }}>{children}</div>
          </div>
        </div>
      </div>
    </>
  );
};

// Footage-led base: one <OffthreadVideo> per frame-snapped trim segment in its
// own Sequence (trimBefore = the segment's source in-point), under a wrapper
// that the punch-in cameras transform. `offset` (seconds) shifts the base for
// ModuleReview, whose frame 0 is the scene start. Muted there.
export const BaseLayer: React.FC<{ base: any; cameraOps: any[]; offset?: number; muted?: boolean }> = ({ base, cameraOps, offset = 0, muted = false }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = offset + frame / fps;
  const style: React.CSSProperties = { position: "absolute", left: 0, top: 0, width, height, objectFit: base.fit, objectPosition: `${base.focus.x * 100}% ${base.focus.y * 100}%` };
  const shift = Math.round(offset * fps);
  return (
    <AbsoluteFill style={{ transformOrigin: "50% 50%", ...cameraStyle(cameraOps, t) }}>
      {base.segments.map((segment: any) => {
        const from = Math.round(segment.start * fps), to = Math.round(segment.end * fps);
        return (
          <Sequence key={segment.index} name={`base ${segment.index}`} from={from - shift} durationInFrames={Math.max(1, to - from)} layout="none">
            <OffthreadVideo src={staticFile(base.src)} trimBefore={Math.round(segment.sourceStart * fps)} volume={muted ? 0 : base.volume} muted={muted || base.volume === 0} style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

function captionOverlay(story: any) {
  return (Array.isArray(story.overlays) ? story.overlays : []).find((overlay: any) => overlay?.type === "captions" && overlay.style !== "none") ?? null;
}

export const StoryComposition: React.FC<StoryProps> = (props) => {
  const { customModules, __captions, ...story } = props;
  const { fps } = useVideoConfig();
  const fonts = ensureFonts(story.brand);
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
  const base = React.useMemo(() => storyBase(story), [story]);
  const cameraOps = React.useMemo(() => baseCameraOps(layers.map((layer: any) => layer.model)), [layers]);
  // Footage-led: the recording carries the voice; audio.mix is the bed.
  const audio = base ? story.audio?.mix ?? null : story.audio?.mix ?? story.audio?.voice ?? null;
  const mixVolume = typeof story.audio?.mix_volume === "number" && audio === story.audio?.mix ? story.audio.mix_volume : 1;
  const frames = (seconds: number) => Math.round(seconds * fps);
  const plan = React.useMemo(() => cameraPlan(story, { windows, objects: sceneObjectLookup(story, (scene: any, value: any) => resolveModule(scene, value)) }), [story, windows]);
  if (plan) {
    const world = plan.mode === "world";
    const sceneLayer = ({ entry, render }: any) => (
      <Sequence key={entry.id} name={`${entry.id} · ${entry.scene.module}`} from={frames(entry.start)} durationInFrames={Math.max(1, frames(entry.renderEnd) - frames(entry.start))} premountFor={fps}>
        <SceneLayer startFrame={frames(entry.start)} tweens={entry.tweens} plate={entry.plate} background={background}
          placement={entry.plate ? plan.placements[entry.id] : undefined} transparent={world && entry.plate}
          parallax={entry.plate ? undefined : overlayOps(plan, { start: entry.start, end: entry.renderEnd })}>
          <SceneStartFrame.Provider value={frames(entry.start)}>{render()}</SceneStartFrame.Provider>
        </SceneLayer>
      </Sequence>
    );
    return (
      <AbsoluteFill style={{ backgroundColor: background, fontFamily: fonts.body, ["--lc-font-display" as any]: fonts.display, ["--lc-font-body" as any]: fonts.body, ["--lc-font-meta" as any]: fonts.meta }}>
        <CameraWorld plan={plan} brand={story.brand}>
          {layers.filter((layer: any) => layer.entry.plate).map(sceneLayer)}
          {loop ? (
            <Sequence key="loop" name={`loop → ${loop.sceneId}`} from={frames(loop.start)} durationInFrames={Math.max(1, frames(loop.end) - frames(loop.start))} premountFor={fps}>
              <SceneLayer startFrame={frames(loop.start)} tweens={loop.tweens} plate background={background} freeze placement={plan.loop ?? undefined} transparent={world}>{loop.render()}</SceneLayer>
            </Sequence>
          ) : null}
        </CameraWorld>
        {layers.filter((layer: any) => !layer.entry.plate).map(sceneLayer)}
        {overlay && Array.isArray(__captions) && __captions.length ? (
          <WordCaptions chunks={__captions} hide={hide} idle={colors.paper ?? CAPTION_DEFAULT_COLORS.idle} active={colors.primary ?? CAPTION_DEFAULT_COLORS.active} fontFamily={fonts.display} />
        ) : null}
        {audio ? <Audio src={staticFile(audio)} volume={mixVolume} /> : null}
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ backgroundColor: background, fontFamily: fonts.body, ["--lc-font-display" as any]: fonts.display, ["--lc-font-body" as any]: fonts.body, ["--lc-font-meta" as any]: fonts.meta }}>
      {base ? <BaseLayer base={base} cameraOps={cameraOps} /> : null}
      {layers.map(({ entry, render }: any) => (
        <Sequence key={entry.id} name={`${entry.id} · ${entry.scene.module}`} from={frames(entry.start)} durationInFrames={Math.max(1, frames(entry.renderEnd) - frames(entry.start))} premountFor={fps}>
          <SceneLayer startFrame={frames(entry.start)} tweens={entry.tweens} plate={entry.plate} background={background}>
            <SceneStartFrame.Provider value={frames(entry.start)}>{render()}</SceneStartFrame.Provider>
          </SceneLayer>
        </Sequence>
      ))}
      {loop ? (
        <Sequence key="loop" name={`loop → ${loop.sceneId}`} from={frames(loop.start)} durationInFrames={Math.max(1, frames(loop.end) - frames(loop.start))} premountFor={fps}>
          <SceneLayer startFrame={frames(loop.start)} tweens={loop.tweens} plate background={background} freeze>{loop.render()}</SceneLayer>
        </Sequence>
      ) : null}
      {overlay && Array.isArray(__captions) && __captions.length ? (
        <WordCaptions chunks={__captions} hide={hide} idle={colors.paper ?? CAPTION_DEFAULT_COLORS.idle} active={colors.primary ?? CAPTION_DEFAULT_COLORS.active} fontFamily={fonts.display} />
      ) : null}
      {audio ? <Audio src={staticFile(audio)} volume={mixVolume} /> : null}
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
  ensureFonts(story.brand);
  const element = React.useMemo(() => resolveSceneElement(scene, story, { customModules }), [scene, story, customModules]);
  // Footage-led stories review the module over the (muted) base, moved by the
  // module's own camera, like the HyperFrames sceneFilter compile.
  const base = React.useMemo(() => storyBase(story), [story]);
  const cameraOps = React.useMemo(() => baseCameraOps([element.model]), [element]);
  return (
    <AbsoluteFill style={{ backgroundColor: story.brand?.colors?.bg ?? "#000000" }}>
      {base ? <BaseLayer base={base} cameraOps={cameraOps} offset={Number(scene.start)} muted /> : null}
      {scene.insert && base ? <AbsoluteFill style={{ backgroundColor: story.brand?.colors?.bg ?? "#000000" }}>{element.render()}</AbsoluteFill> : element.render()}
    </AbsoluteFill>
  );
};

export const calculateModuleReviewMetadata: CalculateMetadataFunction<ModuleReviewProps> = async ({ props }) => {
  const fps = Number(props.story?.resolved?.fps ?? props.story?.format?.fps ?? 30);
  const seconds = Number(props.scene.end) - Number(props.scene.start);
  return { width: props.story.format.width, height: props.story.format.height, fps, durationInFrames: Math.max(1, Math.round(seconds * fps)) };
};
