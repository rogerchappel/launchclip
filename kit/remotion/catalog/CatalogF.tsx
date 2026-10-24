// Remotion components for catalogue F (the creative set around the
// presenter), drawn by catalogue E's PartsModule from the same view and ops
// as HyperFrames.
import React from 'react';
// @ts-ignore plain ESM core module
import {catalogFTimeline, catalogFView} from '../../core/catalog-f.mjs';
import {PartsModule} from './CatalogE';

const typed = (id: string): React.FC<{model: any}> => {
  const Component: React.FC<{model: any}> = ({model}) => {
    if (model.module !== id) throw new Error(`${id} component got a ${model.module} model`);
    return <PartsModule model={model} viewOf={catalogFView} timelineOf={catalogFTimeline} />;
  };
  Component.displayName = id;
  return Component;
};

export const GlassWord = typed('glass-word');
export const OrbitCards = typed('orbit-cards');
export const ProofWall = typed('proof-wall');
export const Scrapbook = typed('scrapbook');
export const DoodleOutline = typed('doodle-outline');
