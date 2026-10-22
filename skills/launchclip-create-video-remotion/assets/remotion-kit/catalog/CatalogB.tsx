// Shared Remotion renderer for catalogue B modules.
//
// Frame-pure: the component reads only the scene clock (useSceneTime) and the model.
// The element tree is the same one the HyperFrames emitter serialises
// (kit/core/catalog-b-view.mjs); per-frame values come from the same op list,
// evaluated with kit/core/motion.mjs eases by frameState(). Nothing is cached
// between frames, so any frame can render in any order.
import React, {useMemo} from 'react';
import {AbsoluteFill, staticFile} from 'remotion';
import {useSceneTime} from '../clock';
// @ts-ignore plain ESM core module
import {catalogBView, catalogBTimeline} from '../../core/catalog-b.mjs';
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
  const children = props && props.text !== undefined ? [String(props.text)] : node.children ?? [];
  return React.createElement(node.tag, {key, id: node.id, style, ...attrs},
    ...(node.tag === 'img' ? [] : children.map((child, index) => renderNode(child, state, index))));
}

export const CatalogBModule: React.FC<{model: any}> = ({model}) => {
  const t = useSceneTime(model.start);
  const view = useMemo(() => catalogBView(model) as ViewNode, [model]);
  const ops = useMemo(() => catalogBTimeline(model), [model]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  return <AbsoluteFill style={{pointerEvents: 'none'}}>{renderNode(view, state, model.id)}</AbsoluteFill>;
};
