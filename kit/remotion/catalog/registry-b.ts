// Catalogue B Remotion components, keyed by module id (docs/KIT_CONTRACTS.md, "Wave 2").
import type React from 'react';
import {FunctionChart} from './FunctionChart';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'function-chart': FunctionChart,
};
