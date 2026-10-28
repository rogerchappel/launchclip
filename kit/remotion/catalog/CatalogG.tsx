// Remotion components for catalogue G (the visual vocabulary), drawn from
// the same view tree and op list as HyperFrames (kit/core/catalog-g.mjs).
// Frame-pure: the scene clock and the model only.
import React, {useMemo} from 'react';
import {AbsoluteFill} from 'remotion';
import {useSceneTime} from '../clock';
// @ts-ignore plain ESM core module
import {catalogGTimeline, catalogGView} from '@launchclip/core/catalog-g.mjs';
// @ts-ignore plain ESM core module
import {frameState} from '@launchclip/core/catalog-b-view.mjs';
import {renderNode, type FrameProps, type ViewNode} from './CatalogB';

const CatalogGModule: React.FC<{model: any}> = ({model}) => {
  const t = useSceneTime(model.start);
  const view = useMemo(() => catalogGView(model) as ViewNode, [model]);
  const ops = useMemo(() => catalogGTimeline(model), [model]);
  const state = frameState(ops, t) as Map<string, FrameProps>;
  return <AbsoluteFill style={{pointerEvents: 'none'}}>{renderNode(view, state, model.id)}</AbsoluteFill>;
};

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    return <CatalogGModule model={model} />;
  };
  Component.displayName = id;
  return Component;
};

export const ConceptCard = typed('concept-card');
export const IconRow = typed('icon-row');
export const SectionCard = typed('section-card');
export const ObjectCard = typed('object-card');
export const StatCard = typed('stat-card');
export const QuoteCard = typed('quote-card');
export const Excerpt = typed('excerpt');
export const Compare = typed('compare');
export const Timeline = typed('timeline');
