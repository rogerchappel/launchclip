// Remotion component for catalogue D's media layouts (split-screen,
// landscape-card, picture-in-picture, media-compare, media-stat, media-list,
// media-grid).
//
// Frame-pure: reads only useCurrentFrame()/fps and the model. The element
// trees are the ones the HyperFrames emitter serialises (kit/core/
// catalog-d-media-layouts.mjs mediaLayoutView); per-frame values come from
// the same op list via frameState(). A video window becomes an
// <OffthreadVideo> trimmed to its sourceStart, a still an <Img> in its frame;
// both keep the view's object-fit and object-position, so the crop matches
// HyperFrames. Drawn base, windows, overlay, as HyperFrames stacks them.
import React, {useMemo} from 'react';
import {AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig} from 'remotion';
import {assetUrl} from '../media';
// @ts-ignore plain ESM core module
import {mediaLayoutTimeline, mediaLayoutView} from '@launchclip/core/catalog-d.mjs';
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
  const style = styleOf(node, state);
  if (node.tag === 'img') return <Img key={key} id={node.id} src={assetUrl(String(node.attrs?.src))} alt={String(node.attrs?.alt ?? '')} style={style} />;
  const props = node.id ? state.get(node.id) : undefined;
  const children = props && props.text !== undefined ? [String(props.text)] : node.children ?? [];
  return React.createElement(node.tag, {key, id: node.id, style}, ...children.map((child, index) => renderNode(child, state, index)));
}

export const MediaLayout: React.FC<{model: any}> = ({model}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = model.start + frame / fps;
  const view = useMemo(() => mediaLayoutView(model) as {base: ViewNode; windows: ViewNode[]; overlay: ViewNode}, [model]);
  const ops = useMemo(() => mediaLayoutTimeline(model), [model]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  return (
    <AbsoluteFill style={{pointerEvents: 'none'}}>
      {renderNode(view.base, state, 'base')}
      {view.windows.map((node, i) => {
        const media = model.content.windows[i].media;
        if (media.kind !== 'video') return renderNode(node, state, `win-${i}`);
        return <OffthreadVideo key={`win-${i}`} id={node.id} src={assetUrl(media.src)} muted trimBefore={Math.round(media.sourceStart * fps)} style={styleOf(node, state)} />;
      })}
      {renderNode(view.overlay, state, 'overlay')}
    </AbsoluteFill>
  );
};

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    return <MediaLayout model={model} />;
  };
  Component.displayName = id;
  return Component;
};

/** One component per media layout, keyed by module id. */
export const MEDIA_LAYOUT_COMPONENTS: Record<string, React.FC<{model: any}>> = Object.fromEntries(
  ['split-screen', 'landscape-card', 'picture-in-picture', 'media-compare', 'media-stat', 'media-list', 'media-grid'].map(id => [id, typed(id)]));
