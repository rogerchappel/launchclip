// Catalogue B Remotion components, keyed by module id (docs/KIT_CONTRACTS.md, "Wave 2").
import type React from 'react';
import {GaugeCompare} from './GaugeCompare';
import {FunctionChart} from './FunctionChart';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'gauge-compare': GaugeCompare,
  'function-chart': FunctionChart,
};
