// Remotion component for the world module. The tree and op list are the
// ones the HyperFrames emitter uses (kit/core/catalog-world.mjs), drawn by
// the shared catalogue E parts renderer.
import React from 'react';
// @ts-ignore plain ESM core module
import {worldTimeline, worldView} from '@launchclip/core/catalog-world.mjs';
import {PartsModule} from './CatalogE';

export const World: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'world') throw new Error(`world component got a ${model.module} model`);
  return <PartsModule model={model} viewOf={worldView} timelineOf={worldTimeline} />;
};
World.displayName = 'world';
