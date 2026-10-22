// FlowCompare (flow-compare): Two pipes whose particles stream at different rates (frame-pure belts).
// Frame-pure; see CatalogB.tsx for the shared tree renderer and evaluator.
import React from 'react';
import {CatalogBModule} from './CatalogB';

export const FlowCompare: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'flow-compare') throw new Error(`FlowCompare expects a flow-compare model, got ${model.module}`);
  return <CatalogBModule model={model} />;
};
