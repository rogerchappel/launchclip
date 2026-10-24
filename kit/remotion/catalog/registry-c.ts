// Catalogue C Remotion components (footage-led), keyed by module id
// (docs/KIT_CONTRACTS.md, "Footage-led lane").
import type React from 'react';
import {DollyZoom, EmphasisCaption, FootageCallout, LowerThird, Masthead, PunchIn} from './CatalogC';

export const COMPONENTS: Record<string, React.FC<{model: any}>> = {
  'punch-in': PunchIn,
  'footage-callout': FootageCallout,
  'lower-third': LowerThird,
  'emphasis-caption': EmphasisCaption,
  'masthead': Masthead,
  'dolly-zoom': DollyZoom,
};
