// Catalogue D Remotion components (product demo, photo scene, evidence clip, clip), keyed by
// module id (docs/KIT_CONTRACTS.md, "Product demo", "Photo scene" and "Clip").
import type React from 'react';
import {ProductDemo} from './ProductDemo';
import {PhotoScene} from './PhotoScene';
import {EvidenceClip} from './EvidenceClip';
import {Clip} from './Clip';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'product-demo': ProductDemo,
  'photo-scene': PhotoScene,
  'evidence-clip': EvidenceClip,
  clip: Clip,
};
