// Remotion editorial components, registry A (docs/KIT_CONTRACTS.md, "Wave 2").
// Each component takes {model} (the resolved editorial model) and draws at
// absolute canvas coordinates inside a full-canvas AbsoluteFill.
import type React from 'react';
import {Callout} from './Callout';
import {Checklist} from './Checklist';
import {GrowthChart} from './GrowthChart';
import {Metric} from './Metric';
import {Progress} from './Progress';
import {StepRail} from './StepRail';
import {TrendChart} from './TrendChart';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  metric: Metric,
  progress: Progress,
  'growth-chart': GrowthChart,
  'trend-chart': TrendChart,
  checklist: Checklist,
  'step-rail': StepRail,
  callout: Callout
};

export default COMPONENTS;
