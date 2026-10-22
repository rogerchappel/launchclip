// Catalogue B Remotion components, keyed by module id (docs/KIT_CONTRACTS.md, "Wave 2").
import type React from 'react';
import {ProcessSteps} from './ProcessSteps';
import {FlowCompare} from './FlowCompare';
import {GaugeCompare} from './GaugeCompare';
import {FunctionChart} from './FunctionChart';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'process-steps': ProcessSteps,
  'flow-compare': FlowCompare,
  'gauge-compare': GaugeCompare,
  'function-chart': FunctionChart,
};
