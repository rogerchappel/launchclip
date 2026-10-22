// ProcessSteps (process-steps): Connected numbered nodes that light up in order.
// Frame-pure; see CatalogB.tsx for the shared tree renderer and evaluator.
import React from 'react';
import {CatalogBModule} from './CatalogB';

export const ProcessSteps: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'process-steps') throw new Error(`ProcessSteps expects a process-steps model, got ${model.module}`);
  return <CatalogBModule model={model} />;
};
