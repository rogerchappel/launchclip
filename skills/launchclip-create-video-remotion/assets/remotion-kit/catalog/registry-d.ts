// Catalogue D Remotion components (product demo, photo scene, evidence clip, clip and the
// media layouts), keyed by module id (docs/KIT_CONTRACTS.md, "Product demo", "Photo scene",
// "Clip" and "Media layouts").
import type React from 'react';
import {ProductDemo} from './ProductDemo';
import {PhotoScene} from './PhotoScene';
import {EvidenceClip} from './EvidenceClip';
import {Clip} from './Clip';
import {SetProp} from './SetProp';
import {MEDIA_LAYOUT_COMPONENTS} from './MediaLayout';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'product-demo': ProductDemo,
  'photo-scene': PhotoScene,
  'evidence-clip': EvidenceClip,
  clip: Clip,
  'set-prop': SetProp,
  ...MEDIA_LAYOUT_COMPONENTS,
};
