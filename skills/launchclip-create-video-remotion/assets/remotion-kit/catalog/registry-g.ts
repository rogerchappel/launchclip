// Catalogue G Remotion components (the visual vocabulary), keyed by module
// id (docs/KIT_CONTRACTS.md, "Catalogue G").
import type React from 'react';
import {ConceptCard, Excerpt, IconRow, ObjectCard, QuoteCard, SectionCard, StatCard} from './CatalogG';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'concept-card': ConceptCard,
  'icon-row': IconRow,
  'section-card': SectionCard,
  'object-card': ObjectCard,
  'stat-card': StatCard,
  'quote-card': QuoteCard,
  'excerpt': Excerpt,
};
