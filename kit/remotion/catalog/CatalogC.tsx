// Remotion components for catalogue C (footage-led overlays) plus the base
// camera evaluator.
//
// Frame-pure: each component reads only useCurrentFrame()/fps and the model.
// The element tree is the one the HyperFrames emitter serialises
// (kit/core/catalog-c.mjs catalogCView); per-frame values come from the same
// op list, evaluated with kit/core/motion.mjs eases by frameState(). punch-in
// renders nothing here: its model.camera moves the base layer, which
// StoryComposition owns (see cameraStyle).
import React, {useMemo} from 'react';
import {AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
// @ts-ignore plain ESM core module
import {BASE_CAMERA, cameraOps, catalogCTimeline, catalogCView} from '../../core/catalog-c.mjs';
// @ts-ignore plain ESM core module
import {frameState, propsToStyle} from '../../core/catalog-b-view.mjs';

type ViewNode = {tag: string; id?: string; style?: Record<string, unknown>; attrs?: Record<string, unknown>; children?: Array<ViewNode | string>};
type FrameProps = Record<string, number | string>;

function renderNode(node: ViewNode | string, state: Map<string, FrameProps>, key: string | number): React.ReactNode {
  if (typeof node === 'string') return node;
  const props = node.id ? state.get(node.id) : undefined;
  const style = props ? {...(node.style ?? {}), ...propsToStyle(props)} : node.style;
  const attrs: Record<string, unknown> = {...(node.attrs ?? {})};
  if (node.tag === 'img' && typeof attrs.src === 'string') attrs.src = staticFile(attrs.src as string);
  const children = node.children ?? [];
  return React.createElement(node.tag, {key, id: node.id, style, ...attrs},
    ...(node.tag === 'img' ? [] : children.map((child, index) => renderNode(child, state, index))));
}

export const CatalogCModule: React.FC<{model: any}> = ({model}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = model.start + frame / fps;
  const view = useMemo(() => catalogCView(model) as ViewNode, [model]);
  const ops = useMemo(() => catalogCTimeline(model), [model]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  return <AbsoluteFill style={{pointerEvents: 'none'}}>{renderNode(view, state, model.id)}</AbsoluteFill>;
};

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    return <CatalogCModule model={model} />;
  };
  Component.displayName = id;
  return Component;
};

export const PunchIn = typed('punch-in');
export const FootageCallout = typed('footage-callout');
export const LowerThird = typed('lower-third');
export const EmphasisCaption = typed('emphasis-caption');

/** Camera op list for a set of resolved models (memoise it per story). */
export function baseCameraOps(models: any[], options: { roomFilterAt?: (t: number) => string } = {}): any[] {
  return cameraOps(models, options);
}

/** Base-layer style at absolute time t for a camera op list. */
export function cameraStyle(ops: any[], t: number): React.CSSProperties {
  if (!ops.length) return {};
  const props = (frameState(ops, t) as Map<string, FrameProps>).get(BASE_CAMERA);
  // Zoom blur (punch-in blur) rides along as a CSS filter.
  return props ? ({ ...propsToStyle(props), ...(props.filter !== undefined ? { filter: props.filter } : {}) } as React.CSSProperties) : {};
}
