// Remotion component for catalogue D's set-prop.
//
// Frame-pure: reads only useCurrentFrame()/fps and the model. The element
// trees are the ones the HyperFrames emitter serialises (kit/core/catalog-d.mjs
// setPropView); per-frame values come from the same op list via frameState().
// A drawn prop is its SVG tree, an image an <Img>, a video an
// <OffthreadVideo> trimmed to media.sourceStart; each keeps the view's
// object-fit and object-position, so the fit matches HyperFrames.
import React, {useMemo} from 'react';
import {AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig} from 'remotion';
import {assetUrl} from '../media';
// @ts-ignore plain ESM core module
import {setPropTimeline, setPropView} from '@launchclip/core/catalog-d.mjs';
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
  if (node.tag === 'img') return <Img key={key} id={node.id} src={assetUrl(String(node.attrs?.src ?? ''))} alt={String(node.attrs?.alt ?? '')} style={styleOf(node, state)} />;
  return React.createElement(node.tag, {key, id: node.id, style: styleOf(node, state), ...(node.attrs ?? {})},
    ...(node.children ?? []).map((child, index) => renderNode(child, state, index)));
}

export const SetProp: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'set-prop') throw new Error(`set-prop component got a ${model.module} model`);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = model.start + frame / fps;
  const view = useMemo(() => setPropView(model) as {front: ViewNode | null; media: ViewNode | null}, [model]);
  const ops = useMemo(() => setPropTimeline(model), [model]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  const media = model.content.media;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {view.front ? renderNode(view.front, state, model.id) : null}
      {view.media && media?.kind === 'video'
        ? <OffthreadVideo id={view.media.id} src={assetUrl(media.src)} muted trimBefore={Math.round(media.sourceStart * fps)} style={styleOf(view.media, state)} />
        : null}
    </AbsoluteFill>
  );
};
SetProp.displayName = 'set-prop';
