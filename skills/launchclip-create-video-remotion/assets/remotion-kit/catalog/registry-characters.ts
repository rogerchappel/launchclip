// Character module Remotion components, keyed by module id
// (docs/KIT_CONTRACTS.md, "Character modules").
import type React from 'react';
import {CastScene, CharacterCameo} from './CatalogCharacters';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'cast-scene': CastScene,
  'character-cameo': CharacterCameo,
};
