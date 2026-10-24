// Catalogue F Remotion components (the creative set around the presenter),
// keyed by module id (docs/KIT_CONTRACTS.md, "Catalogue F").
import type React from 'react';
import {DoodleOutline, GlassWord, OrbitCards, ProofWall, Scrapbook} from './CatalogF';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'glass-word': GlassWord,
  'orbit-cards': OrbitCards,
  'proof-wall': ProofWall,
  'scrapbook': Scrapbook,
  'doodle-outline': DoodleOutline,
};
