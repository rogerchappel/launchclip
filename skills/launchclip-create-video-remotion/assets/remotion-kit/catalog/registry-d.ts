// Catalogue D Remotion components (product demo, photo scene), keyed by module
// id (docs/KIT_CONTRACTS.md, "Product demo" and "Photo scene").
import type React from 'react';
import {ProductDemo} from './ProductDemo';
import {PhotoScene} from './PhotoScene';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'product-demo': ProductDemo,
  'photo-scene': PhotoScene,
};
