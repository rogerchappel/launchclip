// Remotion components for catalogue E (product moments around the presenter).
//
// Frame-pure: reads only useCurrentFrame()/fps and the model. The trees are
// the ones the HyperFrames emitter serialises (kit/core/catalog-e.mjs
// catalogEView), per-frame values come from the same op list via
// frameState(). Drawing order matches HyperFrames: the module's layer, then
// its media (a video as an <OffthreadVideo> trimmed to sourceStart), then the
// overlay. A split module is rendered once per part: model.part "behind"
// draws the behind tree, "front" the front tree.
import React, {useMemo} from 'react';
import {AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig} from 'remotion';
import {assetUrl} from '../media';
// @ts-ignore plain ESM core module
import {catalogETimeline, catalogEView} from '@launchclip/core/catalog-e.mjs';
// @ts-ignore plain ESM core module
import {frameState, propsToStyle} from '@launchclip/core/catalog-b-view.mjs';

type ViewNode = {tag: string; id?: string; style?: Record<string, unknown>; attrs?: Record<string, unknown>; children?: Array<ViewNode | string>};
type FrameProps = Record<string, number | string>;

function styleOf(node: ViewNode, state: Map<string, FrameProps>): React.CSSProperties {
  const props = node.id ? state.get(node.id) : undefined;
  return (props ? {...(node.style ?? {}), ...propsToStyle(props)} : node.style ?? {}) as React.CSSProperties;
}

function renderNode(node: ViewNode | string, state: Map<string, FrameProps>, key: string | number): React.ReactNode {
  if (typeof node === 'string') return node;
  const props = node.id ? state.get(node.id) : undefined;
  const attrs: Record<string, unknown> = {...(node.attrs ?? {})};
  if (node.tag === 'img' && typeof attrs.src === 'string') attrs.src = assetUrl(attrs.src as string);
  const children = props && props.text !== undefined ? [String(props.text)] : node.children ?? [];
  return React.createElement(node.tag, {key, id: node.id, style: styleOf(node, state), ...attrs},
    ...(node.tag === 'img' ? [] : children.map((child, index) => renderNode(child, state, index))));
}

type PartsView = {front: ViewNode | null; behind: ViewNode | null; media: ViewNode | null; overlay: ViewNode | null};

export const CatalogEModule: React.FC<{model: any}> = ({model}) => <PartsModule model={model} viewOf={catalogEView} timelineOf={catalogETimeline} />;

/** The shared renderer for {front, behind, media, overlay} views (catalogues E and F). */
export const PartsModule: React.FC<{model: any; viewOf: (model: any) => any; timelineOf: (model: any) => any[]}> = ({model, viewOf, timelineOf}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = model.start + frame / fps;
  const view = useMemo(() => viewOf(model) as PartsView, [model, viewOf]);
  const ops = useMemo(() => timelineOf(model), [model, timelineOf]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  if (model.layer === 'split') {
    const tree = model.part === 'behind' ? view.behind : view.front;
    return <AbsoluteFill style={{pointerEvents: 'none'}}>{tree ? renderNode(tree, state, model.id) : null}</AbsoluteFill>;
  }
  const main = model.layer === 'behind' ? view.behind : view.front;
  const m = view.media;
  const source = model.content.media ?? model.content.backdrop ?? null;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {main ? renderNode(main, state, model.id) : null}
      {m && m.tag === 'video' && source ? (
        <OffthreadVideo id={m.id} src={assetUrl(source.src)} muted trimBefore={Math.round(source.sourceStart * fps)} style={styleOf(m, state)} />
      ) : m ? renderNode(m, state, `${model.id}-media`) : null}
      {view.overlay ? renderNode(view.overlay, state, `${model.id}-overlay`) : null}
    </AbsoluteFill>
  );
};

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    return <CatalogEModule model={model} />;
  };
  Component.displayName = id;
  return Component;
};

export const FeedFrame = typed('feed-frame');
export const PullBack = typed('pull-back');
export const BackdropSwap = typed('backdrop-swap');
export const AppStage = typed('app-stage');
export const PhoneStage = typed('phone-stage');
export const GrowthLine = typed('growth-line');
