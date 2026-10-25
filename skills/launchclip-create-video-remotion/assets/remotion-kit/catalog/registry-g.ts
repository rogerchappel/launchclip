// Catalogue G Remotion components (the visual vocabulary), keyed by module
// id (docs/KIT_CONTRACTS.md, "Catalogue G").
import type React from 'react';
import {ConceptCard, IconRow, ObjectCard, SectionCard} from './CatalogG';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'concept-card': ConceptCard,
  'icon-row': IconRow,
  'section-card': SectionCard,
  'object-card': ObjectCard,
};
