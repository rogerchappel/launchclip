// GaugeCompare (gauge-compare): Two gauges fill to their values; a bracket (shared object) measures the gap.
// Frame-pure; see CatalogB.tsx for the shared tree renderer and evaluator.
import React from 'react';
import {CatalogBModule} from './CatalogB';

export const GaugeCompare: React.FC<{model: any}> = ({model}) => {
  if (model.module !== 'gauge-compare') throw new Error(`GaugeCompare expects a gauge-compare model, got ${model.module}`);
  return <CatalogBModule model={model} />;
};
