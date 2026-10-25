// Remotion components for catalogue H (the element library), drawn from the
// same view tree and op list as HyperFrames (kit/core/catalog-h.mjs).
// Frame-pure: the scene clock and the model only.
import React, {useMemo} from 'react';
import {AbsoluteFill, staticFile} from 'remotion';
import {useSceneTime} from '../clock';
// @ts-ignore plain ESM core module
import {MODULES, catalogHStyle, catalogHTimeline, catalogHView} from '../../core/catalog-h.mjs';
// @ts-ignore plain ESM core module
import {frameState} from '../../core/catalog-b-view.mjs';
import type {FrameProps, ViewNode} from './CatalogB';

function renderNode(node: ViewNode | string, state: Map<string, FrameProps>, key: string | number): React.ReactNode {
  if (typeof node === 'string') return node;
  const props = node.id ? state.get(node.id) : undefined;
  const style = props ? {...(node.style ?? {}), ...catalogHStyle(props)} : node.style;
  const attrs: Record<string, unknown> = {...(node.attrs ?? {})};
  if (node.tag === 'img' && typeof attrs.src === 'string') attrs.src = staticFile(attrs.src as string);
  const children = props && props.text !== undefined ? [String(props.text)] : node.children ?? [];
  return React.createElement(node.tag, {key, id: node.id, style, ...attrs},
    ...(node.tag === 'img' ? [] : children.map((child, index) => renderNode(child, state, index))));
}

const CatalogHModule: React.FC<{model: any}> = ({model}) => {
  const t = useSceneTime(model.start);
  const view = useMemo(() => catalogHView(model) as ViewNode, [model]);
  const ops = useMemo(() => catalogHTimeline(model), [model]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  return <AbsoluteFill style={{pointerEvents: 'none'}}>{renderNode(view, state, model.id)}</AbsoluteFill>;
};

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    return <CatalogHModule model={model} />;
  };
  Component.displayName = id;
  return Component;
};

/** One component per catalogue H module, keyed by module id. */
export const COMPONENTS: Record<string, React.FC<{model: any}>> = Object.fromEntries(Object.keys(MODULES).map(id => [id, typed(id)]));
