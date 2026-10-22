// Catalogue D Remotion components (product demo), keyed by module id
// (docs/KIT_CONTRACTS.md, "Product demo").
import type React from 'react';
import {ProductDemo} from './ProductDemo';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'product-demo': ProductDemo,
};
