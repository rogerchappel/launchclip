// Remotion component for catalogue D's photo-scene.
//
// Frame-pure: reads only useCurrentFrame()/fps and the model. The element
// trees are the ones the HyperFrames emitter serialises (kit/core/catalog-d.mjs
// photoSceneView); per-frame values come from the same op list via
// frameState(). A video becomes an <OffthreadVideo> trimmed to
// media.sourceStart, an image an <Img>; the overlay (scrim and text) is drawn
// after it.
import React, {useMemo} from 'react';
import {AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig} from 'remotion';
import {assetUrl} from '../media';
// @ts-ignore plain ESM core module
import {photoSceneTimeline, photoSceneView} from '../../core/catalog-d.mjs';
// @ts-ignore plain ESM core module
import {frameState, propsToStyle} from '../../core/catalog-b-view.mjs';

type ViewNode = {tag: string; id?: string; style?: Record<string, unknown>; attrs?: Record<string, unknown>; children?: Array<ViewNode | string>};
type FrameProps = Record<string, number | string>;

function styleOf(node: ViewNode, state: Map<string, FrameProps>): React.CSSProperties {
  const props = node.id ? state.get(node.id) : undefined;
  return (props ? {...(node.style ?? {}), ...propsToStyle(props)} : node.style ?? {}) as React.CSSProperties;
}

function renderNode(node: ViewNode | string, state: Map<string, FrameProps>, key: string | number): React.ReactNode {
  if (typeof node === 'string') return node;
  return React.createElement(node.tag, {key, id: node.id, style: styleOf(node, state)},
    ...(node.children ?? []).map((child, index) => renderNode(child, state, index)));
}

export const PhotoScene: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'photo-scene') throw new Error(`photo-scene component got a ${model.module} model`);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = model.start + frame / fps;
  const view = useMemo(() => photoSceneView(model) as {media: ViewNode; overlay: ViewNode}, [model]);
  const ops = useMemo(() => photoSceneTimeline(model), [model]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  const media = model.content.media;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {media.kind === 'video'
        ? <OffthreadVideo id={view.media.id} src={assetUrl(media.src)} muted trimBefore={Math.round(media.sourceStart * fps)} style={styleOf(view.media, state)} />
        : <Img id={view.media.id} src={assetUrl(media.src)} alt={String(view.media.attrs?.alt ?? '')} style={styleOf(view.media, state)} />}
      {renderNode(view.overlay, state, model.id)}
    </AbsoluteFill>
  );
};
