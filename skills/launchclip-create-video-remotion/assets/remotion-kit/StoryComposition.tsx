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
// - <BrandFrame> (kit/core/brand-frame.mjs): kicker, section labels and the
//   progress line over every scene, under the captions;
// - the loop ending (the loop_to scene's first state over the final window);
// - ambient motion (kit/core/ambient.mjs): the background field inside every
//   track-0 plate and the hold-drift wrapper around each scene's content,
//   evaluated per frame from the same functions the HyperFrames compiler
//   turns into GSAP;
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
import { captionChunksFrom, captionMoveHide, captionsOverlayOf, chunkWords, narrationWords } from "../core/captions.mjs";
// @ts-ignore plain ESM from kit/core
import { baseMediaStyle, storyBase } from "../core/story.mjs";
// @ts-ignore plain ESM from kit/core
import { backgroundFieldTiles, backgroundLayer, blurAt, cameraPlan, captionDipWindows, containerTransform, opsStateAt, overlayOps, placementTransform, sceneObjectLookup } from "../core/camera-world.mjs";
// @ts-ignore plain ESM from kit/core
import { ambientField, blobBackground, blobStyle, fieldTileTransform, driftStyle, sceneDrift } from "../core/ambient.mjs";
// @ts-ignore plain ESM from kit/core
import { backgroundPlan, layerStyle as backgroundLayerStyle, sceneBackground } from "../core/backgrounds.mjs";
// @ts-ignore plain ESM from kit/core
import { profileGeometry } from "../core/layout-check.mjs";
// @ts-ignore plain ESM from kit/core
import { needsSubject, roomStateAt, sceneLayerOf, subjectCameraAt, subjectCameraOps, subjectFilterAt, subjectSegments, subjectWindows } from "../core/subject-layer.mjs";
// @ts-ignore plain ESM from kit/core
import { propsToStyle } from "../core/catalog-b-view.mjs";
// @ts-ignore plain ESM from kit/core
import { layoutPlan, withLayoutCameras } from "../core/footage-layout.mjs";
import { LayoutFrame } from "./LayoutFrame";
import { moduleComponent } from "./modules";
import { baseCameraOps, cameraStyle } from "./catalog/CatalogC";
import { Placeholder } from "./Placeholder";
import { WordCaptions } from "./captions/WordCaptions";
import { BrandFrame } from "./frame/BrandFrame";
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

// part: "behind" | "front" for split modules (kit/core/subject-layer.mjs); the
// component reads it as model.part.
type Resolved = { model: any; render: (part?: "behind" | "front") => React.ReactNode };

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
    render: (part) => (
      <ModuleBoundary fallback={(error) => <Placeholder model={placeholderModel(scene, story, error.message, { end })} />}>
        <Component model={part ? { ...model, part } : model} />
      </ModuleBoundary>
    )
  };
}

// Background field (kit/core/ambient.mjs): soft brand-colour blobs at their
// absolute-time positions, drawn under the plate content.
// style: an outer transform a world camera may drive (parallaxStyle(camera, FIELD_PARALLAX)).
export const AmbientField: React.FC<{ blobs: any[]; t: number; style?: React.CSSProperties }> = ({ blobs, t, style }) => (
  <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none", ...style }} aria-hidden>
    {blobs.map((blob: any) => (
      <div key={blob.id} style={{ position: "absolute", left: 0, top: 0, width: blob.size, height: blob.size, borderRadius: "50%", transformOrigin: "50% 50%", background: blobBackground(blob), ...blobStyle(blob, t) }} />
    ))}
  </AbsoluteFill>
);

// Background kinds (kit/core/backgrounds.mjs): the story's background layers
// at absolute time t, in place of the blob field. Matches the HyperFrames
// .lc-bg-layer markup.
export const BackgroundField: React.FC<{ plan: any; t: number }> = ({ plan, t }) => (
  <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }} aria-hidden>
    {plan.layers.map((layer: any) => (
      <div key={layer.id} style={backgroundLayerStyle(layer, t) as React.CSSProperties} dangerouslySetInnerHTML={layer.svg ? { __html: layer.svg } : undefined} />
    ))}
  </AbsoluteFill>
);

// World mode: the field as one continuous backdrop in the depth layer, each
// blob repeated on its own lattice (camera-world.mjs backgroundFieldTiles) in
// static translate wrappers, never clipped, so it has no edge anywhere the
// camera travels. Matches the HyperFrames .lc-world-tile markup.
export const WorldField: React.FC<{ blobs: any[]; tiles: any[]; t: number }> = ({ blobs, tiles, t }) => {
  const { width, height } = useVideoConfig();
  const byId = React.useMemo(() => new Map(blobs.map((blob: any) => [blob.id, blob])), [blobs]);
  const box: React.CSSProperties = { position: "absolute", left: 0, top: 0, width, height, overflow: "visible", pointerEvents: "none" };
  return (
    <div style={box} aria-hidden>
      {tiles.map((tile: any, index: number) => {
        const blob: any = byId.get(tile.blob);
        return (
          <div key={index} style={{ ...box, transform: fieldTileTransform(tile) }}>
            <div style={{ position: "absolute", left: 0, top: 0, width: blob.size, height: blob.size, borderRadius: "50%", transformOrigin: "50% 50%", background: blobBackground(blob), ...blobStyle(blob, t) }} />
          </div>
        );
      })}
    </div>
  );
};

// startFrame: the enclosing Sequence's from; tweens carry absolute times, so the
// layer samples them at the absolute composition time (kit/remotion/clock.tsx).
// World camera: placement = the plate's world transform; transparent = a
// world-mode plate (the parallax background shows through); parallax = the
// overlay's parallax ops (camera-world.mjs overlayOps). Ambient: field = the
// background blobs (plates only, not in world mode); drift = the hold-drift
// wrapper.
type CameraProps = { placement?: any; transparent?: boolean; parallax?: any[] };
const SceneLayer: React.FC<{ startFrame: number; tweens: any[]; plate: boolean; background: string; freeze?: boolean; field?: any[] | null; backdrop?: any; drift?: any; children: React.ReactNode } & CameraProps> = ({ startFrame, tweens, plate, background, freeze, field, backdrop, drift, placement, transparent, parallax, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (startFrame + frame) / fps;
  const style = layerStyle(layerStateAt(t, tweens, getEase));
  const content = freeze ? <Freeze frame={0}>{children}</Freeze> : children;
  const layer = (
    <AbsoluteFill style={{ ...style, transformOrigin: "50% 50%", ...(plate && !transparent ? { backgroundColor: background } : {}) }}>
      {field ? <AmbientField blobs={field} t={t} /> : null}
      {backdrop ? <BackgroundField plan={backdrop} t={t} /> : null}
      {drift ? <AbsoluteFill style={driftStyle(drift, t)}>{content}</AbsoluteFill> : content}
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
export const CameraWorld: React.FC<{ plan: any; brand: any; field?: any | null; glowing?: boolean; children: React.ReactNode }> = ({ plan, brand, field, glowing = true, children }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  // The depth layer exists in every world story (0.3× with parallax, 1× without).
  // It is the tiled ambient field when the story has one, else the brand glows (never both).
  const tiles = React.useMemo(() => backgroundFieldTiles(plan, field), [plan, field]);
  const layer = React.useMemo(() => (plan.background ? { glows: tiles.length || !glowing ? [] : backgroundLayer(plan, brand).glows } : null), [plan, brand, tiles, glowing]);
  const blur = plan.blurSamples.length ? blurAt(plan, t) : { x: 0, y: 0 };
  const blurring = blur.x > 0 || blur.y > 0;
  const box: React.CSSProperties = { position: "absolute", left: 0, top: 0, width, height, transformOrigin: "50% 50%" };
  return (
    <>
      {layer ? (
        <div style={{ ...box, pointerEvents: "none", transform: containerTransform(opsStateAt(plan.ops, "background", t)) }} aria-hidden>
          {layer.glows.map((glow: any, index: number) => (
            <div key={index} style={{ position: "absolute", left: glow.left, top: glow.top, width: glow.size, height: glow.size, borderRadius: "50%", background: glow.background }} />
          ))}
          {field && tiles.length ? <WorldField blobs={field.blobs} tiles={tiles} t={t} /> : null}
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
// rooms: models whose room hides, dims or blurs the recording (subject layer).
export const BaseLayer: React.FC<{ base: any; cameraOps: any[]; offset?: number; muted?: boolean; rooms?: any[] }> = ({ base, cameraOps, offset = 0, muted = false, rooms = [] }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = offset + frame / fps;
  const { transformOrigin, ...media } = baseMediaStyle(base, { width, height });
  const style: React.CSSProperties = { position: "absolute", ...media } as React.CSSProperties;
  const shift = Math.round(offset * fps);
  const room = rooms.length ? roomStateAt(rooms, t) : null;
  const camera = cameraStyle(cameraOps, t);
  // A blurred camera sample already carries the room's filter.
  return (
    <AbsoluteFill style={{ transformOrigin: "50% 50%", ...camera, ...(room ? { opacity: room.opacity, filter: camera.filter ?? room.filter } : {}) }}>
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

// The cut-out subject: matte clips (alpha WebM) over the base, placed exactly
// like it and moved by the merged subject camera (kit/core/subject-layer.mjs).
export const SubjectLayer: React.FC<{ base: any; clips: any[]; ops: any[]; offset?: number; styles?: any[] }> = ({ base, clips, ops, offset = 0, styles = [] }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = offset + frame / fps;
  const { transformOrigin, ...media } = baseMediaStyle(base, { width, height });
  const style: React.CSSProperties = { position: "absolute", ...media } as React.CSSProperties;
  const shift = Math.round(offset * fps);
  return (
    <AbsoluteFill style={{ transformOrigin: "50% 50%", ...subjectLayerStyle(ops, styles, t) }}>
      {clips.map((clip: any) => {
        const from = Math.round(clip.start * fps), to = Math.round(clip.end * fps);
        return (
          <Sequence key={clip.index} name={`subject ${clip.index}`} from={from - shift} durationInFrames={Math.max(1, to - from)} layout="none">
            <OffthreadVideo src={staticFile(clip.src)} trimBefore={Math.round(clip.mediaStart * fps)} transparent muted style={style} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// The cut-out's camera transform, and its filter: a blurred camera sample
// already carries the style's filter; otherwise the style alone.
function subjectLayerStyle(ops: any[], styles: any[], t: number): React.CSSProperties {
  const props = ops.length ? subjectCameraAt(ops, t) : null;
  const style: React.CSSProperties = props ? { ...(propsToStyle(props) as React.CSSProperties) } : {};
  const filter = props?.filter ?? (styles.length ? subjectFilterAt(styles, t) : undefined);
  if (filter !== undefined && filter !== "none") style.filter = filter;
  else if (props?.filter === "none") style.filter = "none";
  return style;
}

/**
 * Subject layer inputs for resolved layers: {needed, depth(layer), clips, ops, rooms}.
 * layout: the footage layout plan (kit/core/footage-layout.mjs), whose
 * sections reframe the presenter and may treat the room.
 */
function subjectPlan(story: any, base: any, layers: any[], layout: any = null) {
  const rooms = layout?.rooms ?? [];
  const needed = Boolean(base) && (rooms.length > 0 || layers.some((layer: any) => needsSubject(layer.entry.scene, layer.model)));
  if (!needed) return { needed, depth: () => "front", clips: [], ops: [], rooms: [], styles: [] };
  const models = layers.map((layer: any) => layer.model);
  const fps = Number(story.resolved?.fps ?? story.format?.fps ?? 30);
  const cameraModels = withLayoutCameras(models, layout, { fps, duration: Number(story.resolved?.duration ?? story.format?.duration) });
  const clips = subjectSegments(story, subjectWindows([
    ...layers.map((layer: any) => ({ scene: layer.entry.scene, model: layer.model, start: layer.entry.start, end: layer.entry.renderEnd })),
    ...rooms.map((room: any) => ({ scene: { id: room.sceneId }, model: room, start: room.start, end: room.end }))
  ]));
  return {
    needed,
    depth: (layer: any) => sceneLayerOf(layer.entry.scene, layer.model).layer as string,
    clips,
    ops: clips.length ? subjectCameraOps(cameraModels, { subjectFilterAt: (t: number) => subjectFilterAt(models, t) }) : [],
    rooms: [...models.filter((model: any) => model?.room), ...rooms],
    styles: models.filter((model: any) => model?.subjectStyle)
  };
}

function captionOverlay(story: any) {
  return captionsOverlayOf(story);
}

export const StoryComposition: React.FC<StoryProps> = (props) => {
  const { customModules, __captions, ...story } = props;
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
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
  // Footage layouts: the sections' frame and the reframing base camera.
  const layout = React.useMemo(() => (base ? layoutPlan(story) : null), [story, base]);
  const cameraOps = React.useMemo(() => {
    const models = layers.map((layer: any) => layer.model);
    const rooms = [...models, ...(layout?.rooms ?? [])];
    const cameraModels = withLayoutCameras(models, layout, { fps, duration: Number(story.resolved?.duration ?? story.format?.duration) });
    return baseCameraOps(cameraModels, { roomFilterAt: (t: number) => roomStateAt(rooms, t).filter });
  }, [layers, layout, fps, story]);
  // Footage-led: the recording carries the voice; audio.mix is the bed.
  const audio = base ? story.audio?.mix ?? null : story.audio?.mix ?? story.audio?.voice ?? null;
  const mixVolume = typeof story.audio?.mix_volume === "number" && audio === story.audio?.mix ? story.audio.mix_volume : 1;
  const frames = (seconds: number) => Math.round(seconds * fps);
  // A background kind other than blobs (kit/core/backgrounds.mjs) replaces the field.
  const backdrop = React.useMemo(() => backgroundPlan(story), [story]);
  const field = React.useMemo(() => (backdrop ? null : ambientField(story)), [story, backdrop]);
  const geometry = React.useMemo(() => profileGeometry({ width: story.format.width, height: story.format.height }), [story]);
  const fieldFor = (scene: any) => (field && sceneBackground(story, scene) ? field.blobs : null);
  const backdropFor = (scene: any) => (backdrop && sceneBackground(story, scene) ? backdrop : null);
  const plan = React.useMemo(() => cameraPlan(story, { windows, objects: sceneObjectLookup(story, (scene: any, value: any) => resolveModule(scene, value)) }), [story, windows]);
  // Camera moves that sweep panels through the band dip the captions out
  // (captions.hide_during_moves), as the HyperFrames compiler does.
  const dips = React.useMemo(() => captionDipWindows(plan, captionMoveHide(overlay)), [plan, overlay]);
  const subject = React.useMemo(() => subjectPlan(story, base, layers, layout), [story, base, layers, layout]);
  if (plan) {
    const world = plan.mode === "world";
    // World mode: one ambient field, in the camera's parallax depth layer.
    const sceneLayer = ({ entry, render, model }: any) => (
      <Sequence key={entry.id} name={`${entry.id} · ${entry.scene.module}`} from={frames(entry.start)} durationInFrames={Math.max(1, frames(entry.renderEnd) - frames(entry.start))} premountFor={fps}>
        <SceneLayer startFrame={frames(entry.start)} tweens={entry.tweens} plate={entry.plate} background={background}
          field={entry.plate && !world ? fieldFor(entry.scene) : null} backdrop={entry.plate && !world ? backdropFor(entry.scene) : null} drift={sceneDrift(story, entry.scene, model, { window: { start: entry.start, end: entry.renderEnd }, geometry })}
          placement={entry.plate ? plan.placements[entry.id] : undefined} transparent={world && entry.plate}
          parallax={entry.plate ? undefined : overlayOps(plan, { start: entry.start, end: entry.renderEnd })}>
          <SceneStartFrame.Provider value={frames(entry.start)}>{render()}</SceneStartFrame.Provider>
        </SceneLayer>
      </Sequence>
    );
    return (
      <AbsoluteFill style={{ backgroundColor: background, fontFamily: fonts.body, ["--lc-font-display" as any]: fonts.display, ["--lc-font-body" as any]: fonts.body, ["--lc-font-meta" as any]: fonts.meta }}>
        {world && backdrop ? <BackgroundField plan={backdrop} t={frame / fps} /> : null}
        <CameraWorld plan={plan} brand={story.brand} field={world ? field : null} glowing={!(world && backdrop)}>
          {layers.filter((layer: any) => layer.entry.plate).map(sceneLayer)}
          {loop ? (
            <Sequence key="loop" name={`loop → ${loop.sceneId}`} from={frames(loop.start)} durationInFrames={Math.max(1, frames(loop.end) - frames(loop.start))} premountFor={fps}>
              <SceneLayer startFrame={frames(loop.start)} tweens={loop.tweens} plate background={background} freeze field={world ? null : fieldFor(loop.scene)} backdrop={world ? null : backdropFor(loop.scene)} placement={plan.loop ?? undefined} transparent={world}>{loop.render()}</SceneLayer>
            </Sequence>
          ) : null}
        </CameraWorld>
        {layers.filter((layer: any) => !layer.entry.plate).map(sceneLayer)}
        <BrandFrame story={story} />
        {overlay && Array.isArray(__captions) && __captions.length ? (
          <WordCaptions chunks={__captions} hide={hide} overlay={overlay} story={story} dips={dips} zones={layout?.captions} />
        ) : null}
        {audio ? <Audio src={staticFile(audio)} volume={mixVolume} /> : null}
      </AbsoluteFill>
    );
  }
  // One scene, or one part of a split scene. A split scene's behind part has
  // no hold drift, as in the HyperFrames compiler.
  const sceneElement = ({ entry, render, model }: any, part?: "behind" | "front") => (
    <Sequence key={part === "behind" ? `${entry.id}-behind` : entry.id} name={`${entry.id} · ${entry.scene.module}${part === "behind" ? " (behind)" : ""}`} from={frames(entry.start)} durationInFrames={Math.max(1, frames(entry.renderEnd) - frames(entry.start))} premountFor={fps}>
      <SceneLayer startFrame={frames(entry.start)} tweens={entry.tweens} plate={entry.plate} background={background} field={entry.plate ? fieldFor(entry.scene) : null} backdrop={entry.plate ? backdropFor(entry.scene) : null} drift={part === "behind" ? undefined : sceneDrift(story, entry.scene, model, { window: { start: entry.start, end: entry.renderEnd }, geometry })}>
        <SceneStartFrame.Provider value={frames(entry.start)}>{render(part)}</SceneStartFrame.Provider>
      </SceneLayer>
    </Sequence>
  );
  return (
    <AbsoluteFill style={{ backgroundColor: background, fontFamily: fonts.body, ["--lc-font-display" as any]: fonts.display, ["--lc-font-body" as any]: fonts.body, ["--lc-font-meta" as any]: fonts.meta }}>
      {base ? <BaseLayer base={base} cameraOps={cameraOps} rooms={subject.rooms} /> : null}
      {subject.needed ? layers.filter((layer: any) => subject.depth(layer) !== "front").map((layer: any) => sceneElement(layer, subject.depth(layer) === "split" ? "behind" : undefined)) : null}
      {subject.clips.length ? <SubjectLayer base={base} clips={subject.clips} ops={subject.ops} styles={subject.styles} /> : null}
      {layout ? <LayoutFrame plan={layout} /> : null}
      {layers.filter((layer: any) => subject.depth(layer) !== "behind").map((layer: any) => sceneElement(layer, subject.depth(layer) === "split" ? "front" : undefined))}
      {loop ? (
        <Sequence key="loop" name={`loop → ${loop.sceneId}`} from={frames(loop.start)} durationInFrames={Math.max(1, frames(loop.end) - frames(loop.start))} premountFor={fps}>
          <SceneLayer startFrame={frames(loop.start)} tweens={loop.tweens} plate background={background} freeze field={fieldFor(loop.scene)} backdrop={backdropFor(loop.scene)}>{loop.render()}</SceneLayer>
        </Sequence>
      ) : null}
      <BrandFrame story={story} />
      {overlay && Array.isArray(__captions) && __captions.length ? (
        <WordCaptions chunks={__captions} hide={hide} overlay={overlay} story={story} dips={dips} zones={layout?.captions} />
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
  // A module behind the subject is reviewed under its matte, like the
  // HyperFrames sceneFilter compile.
  const subject = React.useMemo(() => subjectPlan(story, base, [{ entry: { scene, start: Number(scene.start), renderEnd: Number(scene.end) }, model: element.model }]), [story, base, scene, element]);
  const depth = subject.needed ? subject.depth({ entry: { scene }, model: element.model }) : "front";
  const offset = Number(scene.start);
  return (
    <AbsoluteFill style={{ backgroundColor: story.brand?.colors?.bg ?? "#000000" }}>
      {base ? <BaseLayer base={base} cameraOps={cameraOps} offset={offset} muted rooms={subject.rooms} /> : null}
      {depth !== "front" ? element.render(depth === "split" ? "behind" : undefined) : null}
      {subject.clips.length ? <SubjectLayer base={base} clips={subject.clips} ops={subject.ops} offset={offset} styles={subject.styles} /> : null}
      {depth === "behind" ? null : scene.insert && base ? <AbsoluteFill style={{ backgroundColor: story.brand?.colors?.bg ?? "#000000" }}>{element.render()}</AbsoluteFill> : element.render(depth === "split" ? "front" : undefined)}
    </AbsoluteFill>
  );
};

export const calculateModuleReviewMetadata: CalculateMetadataFunction<ModuleReviewProps> = async ({ props }) => {
  const fps = Number(props.story?.resolved?.fps ?? props.story?.format?.fps ?? 30);
  const seconds = Number(props.scene.end) - Number(props.scene.start);
  return { width: props.story.format.width, height: props.story.format.height, fps, durationInFrames: Math.max(1, Math.round(seconds * fps)) };
};
