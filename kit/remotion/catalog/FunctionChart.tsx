// FunctionChart (function-chart): Plots fn as a drawn line with probe readout, baseline, gap bars and tail-zoom inset.
// Frame-pure; see CatalogB.tsx for the shared tree renderer and evaluator.
import React from 'react';
import {CatalogBModule} from './CatalogB';

export const FunctionChart: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'function-chart') throw new Error(`FunctionChart expects a function-chart model, got ${model.module}`);
  return <CatalogBModule model={model} />;
};
