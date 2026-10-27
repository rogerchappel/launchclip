// Catalogue D Remotion components (product demo, photo scene, evidence clip), keyed by module
// id (docs/KIT_CONTRACTS.md, "Product demo" and "Photo scene").
import type React from 'react';
import {ProductDemo} from './ProductDemo';
import {PhotoScene} from './PhotoScene';
import {EvidenceClip} from './EvidenceClip';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'product-demo': ProductDemo,
  'photo-scene': PhotoScene,
  'evidence-clip': EvidenceClip,
};
